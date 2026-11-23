import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"

// Exercise the unbundled Desktop entry with a small reactive host, without Desktop itself.
function host() {
  let current: any
  const effects: any[] = []
  function createSignal(initial: any) {
    let value = initial
    const listeners = new Set<any>()
    return [() => { if (current) listeners.add(current); return value }, (next: any) => {
      if (next === value) return
      value = next
      for (const effect of [...listeners]) effect.run()
    }]
  }
  function createEffect(fn: () => void) {
    const effect = { cleanups: [] as (() => void)[], run() {
      for (const cleanup of effect.cleanups.splice(0)) cleanup()
      const previous = current
      current = effect
      try { fn() } finally { current = previous }
    } }
    effects.push(effect)
    effect.run()
  }
  const timers = new Set<() => void>()
  const calls: { sessionID: string; location: any; resolve: (v: any) => void; reject: (e: Error) => void }[] = []
  const toggles: { sessionID: string; location: any; resolve: (v: any) => void; reject: (e: Error) => void }[] = []
  const listeners = new Set<(event: any) => void>()
  const rpc = {
    read: ({ sessionID }: any, { location }: any) => new Promise((resolve, reject) => calls.push({ sessionID, location, resolve, reject })),
    toggle: ({ sessionID }: any, { location }: any) => new Promise((resolve, reject) => toggles.push({ sessionID, location, resolve, reject })),
    events: { on: (_: string, callback: any) => { listeners.add(callback); return () => listeners.delete(callback) } },
  }
  const server = { connected: true, client: { rpc: () => rpc } }
  const [session, setSession] = createSignal({ id: "a", location: { directory: "/p", workspaceID: "w" }, server })
  const [active, setActive] = createSignal(true)
  const props = { get session() { return session() }, get active() { return active() } }
  let contribution: any
  const module = { exports: {} as any }
  const solid = { createEffect, createSignal, onCleanup: (fn: () => void) => current.cleanups.push(fn) }
  runInNewContext(readFileSync(import.meta.dir + "/gui-experimental.cjs", "utf8"), {
    module, document: { createElement: () => ({}) }, AbortSignal,
    setInterval: (fn: () => void) => { timers.add(fn); return fn },
    clearInterval: (fn: () => void) => timers.delete(fn),
    require: (name: string) => name === "solid-js" ? solid : name === "@opencode/plugin/rpc" ? { Rpc: { define: (v: any) => v } } : { Plugin: { define: (v: any) => v }, Slot: {} },
  })
  module.exports.default.setup({ add: (_: any, item: any) => { contribution = item } })
  const label = contribution.render(props)
  const flush = async () => { await Promise.resolve(); await Promise.resolve() }
  return { label, calls, toggles, listeners, timers, setSession, setActive, server, flush }
}

test("Desktop status follows the active session, rejects stale reads, and recovers after errors", async () => {
  const h = host()
  expect(h.label.textContent).toBe("Context: Unknown")
  expect(h.calls[0].location).toEqual({ directory: "/p", workspaceID: "w" })
  for (const listener of h.listeners) listener({ data: { sessionID: "a", mode: "long" }, location: { directory: "/p", workspaceID: "w" } })
  h.calls[0].resolve({ mode: "short" })
  await h.flush()
  expect(h.label.textContent).toBe("Context: Long")
  h.setSession({ id: "b", location: { directory: "/p", workspaceID: "w" }, server: h.server })
  expect(h.label.textContent).toBe("Context: Unknown")
  for (const listener of h.listeners) listener({ data: { sessionID: "a", mode: "long" }, location: { directory: "/p", workspaceID: "w" } })
  h.calls[1].reject(new Error("offline"))
  await h.flush()
  expect(h.label.textContent).toBe("Context: Unknown")
  for (const timer of h.timers) timer()
  h.calls[2].resolve({ mode: "short" })
  await h.flush()
  expect(h.label.textContent).toBe("Context: Short")
  h.setActive(false)
  expect(h.label.textContent).toBe("Context: Unknown")
  expect(h.listeners.size).toBe(0)
  h.setActive(true)
  h.calls[3].resolve({ mode: "long" })
  await h.flush()
  expect(h.label.textContent).toBe("Context: Long")
})

test("Desktop button toggles the session, blocks repeat clicks and handles failure and switching", async () => {
  const h = host()
  expect(h.label.disabled).toBe(true)
  expect(h.label.title).toContain("Context mode unavailable")
  expect(h.label.title).toContain("Toggle unavailable")
  h.label.onclick()
  expect(h.toggles).toHaveLength(0)
  h.calls[0].resolve({ mode: "short" })
  await h.flush()
  expect(h.label.disabled).toBe(false)
  expect(h.label.title).toContain("configured fraction")
  expect(h.label.title).toContain("not a hard context or spending cap")
  expect(h.label.title).toContain("Click to switch to Long")
  expect(h.label.title).toContain("/context-mode auto")
  h.label.onclick()
  h.label.onclick()
  expect(h.toggles).toHaveLength(1)
  expect(h.toggles[0].sessionID).toBe("a")
  expect(h.label.disabled).toBe(true)
  h.toggles[0].resolve({ mode: "long" })
  await h.flush()
  expect(h.label.textContent).toBe("Context: Long")
  expect(h.label.title).toContain("normal OpenCode compaction")
  expect(h.label.title).toContain("Click to switch to Short")
  h.label.onclick()
  h.toggles[1].reject(new Error("offline"))
  await h.flush()
  expect(h.label.textContent).toBe("Context: Unknown")
  for (const timer of h.timers) timer()
  h.calls[1].resolve({ mode: "long" })
  await h.flush()
  h.label.onclick()
  h.setSession({ id: "b", location: { directory: "/p", workspaceID: "w" }, server: h.server })
  h.toggles[2].resolve({ mode: "short" })
  await h.flush()
  expect(h.label.textContent).toBe("Context: Unknown")
  h.calls[2].resolve({ mode: "long" })
  await h.flush()
  expect(h.label.textContent).toBe("Context: Long")
})

test("Desktop ignores a stale poll that began while toggling", async () => {
  const h = host()
  h.calls[0].resolve({ mode: "short" })
  await h.flush()
  h.label.onclick()
  for (const timer of h.timers) timer()
  h.toggles[0].resolve({ mode: "long" })
  await h.flush()
  h.calls[1].resolve({ mode: "short" })
  await h.flush()
  expect(h.label.textContent).toBe("Context: Long")
})

test("Desktop ignores reads and events from a previously displayed session", async () => {
  const h = host()
  const oldListener = [...h.listeners][0]
  h.setSession({ id: "b", location: { directory: "/p", workspaceID: "w" }, server: h.server })
  h.calls[0].resolve({ mode: "long" })
  oldListener({ data: { sessionID: "a", mode: "long" }, location: { directory: "/p", workspaceID: "w" } })
  await h.flush()
  expect(h.label.textContent).toBe("Context: Unknown")
  h.calls[1].resolve({ mode: "short" })
  await h.flush()
  expect(h.label.textContent).toBe("Context: Short")
})
