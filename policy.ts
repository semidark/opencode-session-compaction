// A soft, post-request trigger, not an override of OpenCode's compaction threshold.
const FRACTION = 0.3
const MIN_CONTEXT = 272_000
const RETRY_MS = 120_000
const PENDING_MS = 600_000

type Model = { providerID: string; id: string }
type Mode = "short" | "long" | "unknown"
type Usage = { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
type Event = { type: string; location?: { directory: string; workspaceID?: string }; data: any }
type State = { models: Map<string, Model>; pendingUntil: number; retryAfter: number; lastAttempt?: number }

// The SDK is provided by OpenCode at runtime; this narrow interface also permits isolated tests.
type Context = {
  location: { directory: string; workspaceID?: string }
  storage: { get(key: string): Promise<unknown>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> }
  model: { list(): Promise<any> }
  session: { get(input: { sessionID: string }): Promise<any>; compact(input: { sessionID: string }): Promise<unknown> }
}

export function usageTotal(tokens: Usage): number | undefined {
  const values = [tokens?.input, tokens?.output, tokens?.reasoning, tokens?.cache?.read, tokens?.cache?.write]
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) return undefined
  return values.reduce((total, value) => total + value, 0)
}

export function policyOptions(options: Record<string, unknown> = {}) {
  const fraction = options.fraction ?? FRACTION
  const minContext = options.minContext ?? MIN_CONTEXT
  if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction <= 0 || fraction > 1) throw new Error("fraction must be greater than 0 and at most 1")
  if (typeof minContext !== "number" || !Number.isSafeInteger(minContext) || minContext < 1) throw new Error("minContext must be a positive integer")
  return { fraction, minContext }
}

export function createController(ctx: Context, now = () => Date.now(), options: Record<string, unknown> = {}) {
  const { fraction, minContext } = policyOptions(options)
  const states = new Map<string, State>()
  const queues = new Map<string, Promise<void>>()
  const state = (id: string) => {
    let value = states.get(id)
    if (!value) states.set(id, value = { models: new Map(), pendingUntil: 0, retryAfter: 0 })
    return value
  }
  const key = (id: string) => `mode/${id}`
  const selection = async (id: string) => {
    const saved = await ctx.storage.get(key(id))
    return saved === "short" || saved === "long" ? saved : undefined
  }
  async function contextWindow(model?: Model) {
    if (!model?.providerID || !model.id) return undefined
    const result = await ctx.model.list()
    const models = Array.isArray(result) ? result : result?.data
    const window = models?.find((entry: any) => entry.providerID === model.providerID && entry.id === model.id)?.limit?.context
    return typeof window === "number" && Number.isFinite(window) && window > 0 ? window : undefined
  }
  const automatic = (window?: number): Mode => window === undefined ? "unknown" : window < minContext ? "long" : "short"
  async function sessionMode(id: string): Promise<Mode> {
    const result = await ctx.session.get({ sessionID: id })
    const session = result?.data ?? result
    if (!session || session.location?.directory !== ctx.location.directory || session.location?.workspaceID !== ctx.location.workspaceID)
      throw new Error("Session not found in this location")
    const saved = await selection(id)
    if (saved) return saved
    return automatic(await contextWindow(session.model))
  }
  const serial = <T>(id: string, work: () => Promise<T>) => {
    const result = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work)
    const current = result.then(() => {}, () => {})
    queues.set(id, current)
    void current.then(() => { if (queues.get(id) === current) queues.delete(id) })
    return result
  }

  async function command(id: string, text: string) {
    return serial(id, async () => {
      const requested = text.trim().toLowerCase()
      if (!requested) return sessionMode(id)
      if (requested !== "short" && requested !== "long" && requested !== "auto") throw new Error("Use /context-mode short, /context-mode long, or /context-mode auto.")
      if (requested === "auto") {
        await ctx.storage.remove(key(id))
        return sessionMode(id)
      }
      await ctx.storage.set(key(id), requested)
      return requested
    })
  }

  async function read(id: string) {
    return serial(id, async () => {
      return sessionMode(id)
    })
  }

  async function toggle(id: string) {
    return serial(id, async () => {
      const current = await sessionMode(id)
      if (current === "unknown") throw new Error("Context mode unavailable")
      const next = current === "short" ? "long" : "short"
      await ctx.storage.set(key(id), next)
      return next
    })
  }

  async function handle(event: Event) {
    const id = event.data.sessionID as string
    if (event.location && (event.location.directory !== ctx.location.directory || event.location.workspaceID !== ctx.location.workspaceID)) return
    // Events without a location may still arrive from another location on the server.
    if (!event.location && event.type !== "session.deleted") {
      const result = await ctx.session.get({ sessionID: id })
      const session = result?.data ?? result
      if (session?.location?.directory !== ctx.location.directory || session?.location?.workspaceID !== ctx.location.workspaceID) return
    }
    if (event.type === "session.deleted") {
      states.delete(id)
      await ctx.storage.remove(key(id))
      return
    }
    const s = state(id)
    if (event.type === "session.step.started") {
      s.models.set(event.data.assistantMessageID, event.data.model)
      // Bound memory if a started step never ends.
      if (s.models.size > 16) s.models.delete(s.models.keys().next().value!)
      return
    }
    if (event.type === "session.compaction.started") {
      s.pendingUntil = now() + PENDING_MS
      return
    }
    if (event.type === "session.compaction.ended" || event.type === "session.compaction.failed") {
      s.pendingUntil = 0
      s.retryAfter = now() + RETRY_MS
      if (event.type === "session.compaction.failed") s.lastAttempt = undefined
      return
    }
    if (event.type !== "session.step.ended") return
    const model = s.models.get(event.data.assistantMessageID)
    s.models.delete(event.data.assistantMessageID)
    if (!model || now() < s.pendingUntil || now() < s.retryAfter) return
    const used = usageTotal(event.data.tokens)
    if (used === undefined) return
    const window = await contextWindow(model)
    if (window === undefined || (await selection(id) ?? automatic(window)) !== "short") return
    const target = window * fraction
    if (used < target) {
      s.lastAttempt = undefined
      return
    }
    // If compaction cannot reduce the fixed context, wait for meaningful growth.
    if (s.lastAttempt !== undefined && used < s.lastAttempt + target * 0.1) return
    s.pendingUntil = now() + PENDING_MS
    s.lastAttempt = used
    try {
      await ctx.session.compact({ sessionID: id })
    } catch (error) {
      s.pendingUntil = 0
      s.retryAfter = now() + RETRY_MS
      // Admission failed, so retry after the cooldown even without growth.
      s.lastAttempt = undefined
      throw error
    }
  }

  function event(event: Event) {
    if (!event.data?.sessionID) return
    void serial(event.data.sessionID, () => handle(event)).catch((error) => console.error("[session-compaction] event failed", error))
  }
  async function drain(id: string) { await queues.get(id)?.catch(() => {}) }
  return { command, read, toggle, event, drain }
}
