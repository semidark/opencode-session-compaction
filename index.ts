import { Plugin } from "@opencode/plugin"
import { createController } from "./policy"
import { CompactionMode } from "./rpc"

export default Plugin.define({
  id: "semidark.session-compaction",
  async setup(ctx) {
    const controller = createController(ctx, undefined, ctx.options)
    const rpc = await ctx.rpc.register(CompactionMode, {
      read: async (input) => ({ mode: await controller.read((input as { sessionID: string }).sessionID) }),
      toggle: async (input) => {
        const sessionID = (input as { sessionID: string }).sessionID
        const mode = await controller.toggle(sessionID)
        await rpc.events.emit("selected", { sessionID, mode })
        return { mode }
      },
    })
    await ctx.command.transform((editor) => {
      editor.add({
        name: "context-mode",
        description: "Set per-session compaction: short, long or auto; omit to show mode",
        execute: async ({ sessionID, prompt }) => {
          const mode = await controller.command(sessionID, prompt.text ?? "")
          await rpc.events.emit("selected", { sessionID, mode })
        },
      })
    })

    const abort = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          types: ["session.step.started", "session.step.ended", "session.compaction.started", "session.compaction.ended", "session.compaction.failed", "session.deleted"],
          signal: abort.signal,
        })) {
          controller.event(event)
        }
      } catch (error) {
        if (!abort.signal.aborted) console.error("[session-compaction] event stream stopped", error)
      }
    })()
    return () => abort.abort()
  },
})
