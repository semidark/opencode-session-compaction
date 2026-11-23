import { describe, expect, test } from "bun:test"
import { createController, policyOptions, usageTotal } from "./policy"

function fixture() {
  let time = 1_000_000
  const storage = new Map<string, string>()
  const compacted: string[] = []
  let fail = false
  const ctx = {
    location: { directory: "/project" },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: string) => { storage.set(key, value) },
      remove: async (key: string) => { storage.delete(key) },
    },
    model: { list: async () => [{ providerID: "p", id: "sc", limit: { context: 1000 } }, { providerID: "p", id: "lc", limit: { context: 2000 } }] },
    session: {
      get: async () => ({ location: { directory: "/project" }, model: { providerID: "p", id: "sc" } }),
      compact: async ({ sessionID }: { sessionID: string }) => { if (fail) throw new Error("admission failed"); compacted.push(sessionID) },
    },
  }
  const c = createController(ctx, () => time)
  const emit = async (type: string, sessionID: string, data: object = {}) => {
    c.event({ type, location: ctx.location, data: { sessionID, ...data } })
    await c.drain(sessionID)
  }
  const step = async (id: string, amount: number, model = "sc") => {
    await emit("session.step.started", id, { assistantMessageID: "m", model: { providerID: "p", id: model } })
    await emit("session.step.ended", id, { assistantMessageID: "m", tokens: { input: amount, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })
  }
  return { c, ctx, emit, step, compacted, storage, advance: (n: number) => { time += n }, setFail: (v: boolean) => { fail = v } }
}

describe("session compaction", () => {
  test("validates and applies configurable thresholds", async () => {
    for (const fraction of [0, -1, 1.1, NaN, "0.5"]) expect(() => policyOptions({ fraction })).toThrow()
    for (const minContext of [0, -1, 1.5, Infinity, "1000"]) expect(() => policyOptions({ minContext })).toThrow()
    const f = fixture()
    const c = createController(f.ctx, undefined, { fraction: 0.5, minContext: 1000 })
    expect(await c.read("a")).toBe("short")
    c.event({ type: "session.step.started", location: f.ctx.location, data: { sessionID: "a", assistantMessageID: "m", model: { providerID: "p", id: "sc" } } })
    c.event({ type: "session.step.ended", location: f.ctx.location, data: { sessionID: "a", assistantMessageID: "m", tokens: { input: 499, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } })
    await c.drain("a")
    expect(f.compacted).toEqual([])
    c.event({ type: "session.step.started", location: f.ctx.location, data: { sessionID: "a", assistantMessageID: "n", model: { providerID: "p", id: "sc" } } })
    c.event({ type: "session.step.ended", location: f.ctx.location, data: { sessionID: "a", assistantMessageID: "n", tokens: { input: 500, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } })
    await c.drain("a")
    expect(f.compacted).toEqual(["a"])
  })
  test("counts reported input, cache and output like context usage", () => {
    expect(usageTotal({ input: 10, output: 2, reasoning: 1, cache: { read: 20, write: 3 } })).toBe(36)
    expect(usageTotal({ input: NaN } as any)).toBeUndefined()
  })
  test("explicit short respects the selected entry and does not affect other sessions", async () => {
    const f = fixture()
    await f.c.command("parent", "long")
    await f.c.command("child", "short")
    await f.c.command("other", "short")
    await f.step("parent", 700)
    await f.step("child", 299)
    await f.step("child", 300)
    await f.step("other", 500, "lc")
    await f.step("other", 600, "lc")
    expect(f.compacted).toEqual(["child", "other"])
    await f.c.command("parent", "short")
    await f.step("parent", 300)
    expect(f.compacted).toEqual(["child", "other", "parent"])
  })
  test("guards queued requests and avoids repeated compaction of fixed context", async () => {
    const f = fixture()
    await f.c.command("a", "short")
    await f.step("a", 400)
    await f.step("a", 500)
    await f.emit("session.compaction.ended", "a")
    f.advance(120_001)
    await f.step("a", 400)
    expect(f.compacted).toEqual(["a"])
    await f.step("a", 431)
    expect(f.compacted).toEqual(["a", "a"])
  })
  test("retries failures after cooldown", async () => {
    const f = fixture()
    await f.c.command("a", "short")
    f.setFail(true)
    const old = console.error
    console.error = () => {}
    try { await f.step("a", 300) } finally { console.error = old }
    f.setFail(false)
    await f.step("a", 300)
    expect(f.compacted).toEqual([])
    f.advance(120_001)
    await f.step("a", 300)
    await f.emit("session.compaction.failed", "a")
    f.advance(120_001)
    await f.step("a", 300)
    expect(f.compacted).toEqual(["a", "a"])
  })
  test("ignores other locations and unknown steps; mode persists and is removed on delete", async () => {
    const f = fixture()
    await f.c.command("a", "long")
    const restarted = createController(f.ctx)
    expect(await restarted.command("a", "")).toBe("long")
    await expect(f.c.command("a", "typo")).rejects.toThrow("Use")
    f.c.event({ type: "session.step.ended", location: { directory: "/other" }, data: { sessionID: "a" } })
    await f.c.drain("a")
    await f.emit("session.deleted", "a")
    expect(await f.c.command("a", "")).toBe("long")
  })
  test("reads the saved mode after queued writes and rejects sessions from other locations", async () => {
    const f = fixture()
    const write = f.c.command("a", "long")
    const read = f.c.read("a")
    await write
    expect(await read).toBe("long")
    expect(await f.c.read("child")).toBe("long")
    f.ctx.session.get = async () => ({ location: { directory: "/other" } }) as any
    await expect(f.c.read("a")).rejects.toThrow("Session not found")
  })
  test("does not act on a step from another location or a missing model", async () => {
    const f = fixture()
    f.c.event({ type: "session.step.started", location: { directory: "/other" }, data: { sessionID: "a", assistantMessageID: "m", model: { providerID: "p", id: "sc" } } })
    await f.c.drain("a")
    await f.emit("session.step.ended", "a", { assistantMessageID: "m", tokens: { input: 900, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })
    await f.step("a", 900, "unknown")
    expect(f.compacted).toEqual([])
  })
  test("ignores unlocated events belonging to a different workspace", async () => {
    const f = fixture()
    f.ctx.session.get = async () => ({ location: { directory: "/project", workspaceID: "other" } }) as any
    f.c.event({ type: "session.step.started", data: { sessionID: "a", assistantMessageID: "m", model: { providerID: "p", id: "sc" } } })
    await f.c.drain("a")
    await f.emit("session.step.ended", "a", { assistantMessageID: "m", tokens: { input: 900, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })
    expect(f.compacted).toEqual([])
    await expect(f.c.read("a")).rejects.toThrow("Session not found")
  })
  test("auto follows model context at the 272k boundary, explicit modes persist, and auto restores the default", async () => {
    const f = fixture()
    f.ctx.model.list = async () => [
      { providerID: "p", id: "small", limit: { context: 271_999 } },
      { providerID: "p", id: "boundary", limit: { context: 272_000 } },
      { providerID: "p", id: "large", limit: { context: 1_000_000 } },
    ]
    let model = "small"
    f.ctx.session.get = async () => ({ location: { directory: "/project" }, model: { providerID: "p", id: model } })
    expect(await f.c.read("a")).toBe("long")
    await f.step("a", 90_000, "small")
    expect(f.compacted).toEqual([])
    model = "boundary"
    expect(await f.c.read("a")).toBe("short")
    await f.step("a", 81_600, "boundary")
    expect(f.compacted).toEqual(["a"])
    model = "large"
    expect(await f.c.read("b")).toBe("short")
    await f.c.command("b", "long")
    expect(await f.c.read("b")).toBe("long")
    model = "small"
    await f.c.command("b", "short")
    expect(await createController(f.ctx).read("b")).toBe("short")
    expect(await f.c.read("child")).toBe("long")
    await f.step("b", 90_000, "small")
    expect(f.compacted).toEqual(["a", "b"])
    expect(await f.c.command("b", "auto")).toBe("long")
    model = "missing"
    expect(await f.c.read("b")).toBe("unknown")
    await f.step("c", 999_999, "missing")
    expect(f.compacted).toEqual(["a", "b"])
    model = "large"
    await f.c.command("d", "long")
    await f.step("d", 500_000, "large")
    expect(f.compacted).toEqual(["a", "b"])
    expect(await f.c.command("d", "auto")).toBe("short")
    await f.step("d", 300_000, "large")
    expect(f.compacted).toEqual(["a", "b", "d"])
  })
  test("toggle is serialized, session-scoped, and refuses an unknown or foreign session", async () => {
    const f = fixture()
    expect(await f.c.toggle("a")).toBe("short")
    expect(await f.c.read("a")).toBe("short")
    expect(await f.c.read("b")).toBe("long")
    expect(await Promise.all([f.c.toggle("a"), f.c.toggle("a")])).toEqual(["long", "short"])
    f.ctx.session.get = async () => ({ location: { directory: "/project" } }) as any
    await expect(f.c.toggle("b")).rejects.toThrow("unavailable")
    f.ctx.session.get = async () => ({ location: { directory: "/other" } }) as any
    await expect(f.c.toggle("a")).rejects.toThrow("Session not found")
    expect(f.storage.get("mode/a")).toBe("short")
  })
})
