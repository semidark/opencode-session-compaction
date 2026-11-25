import { Plugin } from "@opencode/plugin/tui"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { CompactionMode } from "./rpc"

export default Plugin.define({
  id: "semidark.session-compaction.tui",
  setup(ctx) {
    return ctx.ui.slot({
      append: "prompt.footer.status",
      render: (props) => {
        const [mode, setMode] = createSignal<"short" | "long" | "unknown">("unknown")
        let toggle = () => {}
        createEffect(() => {
          const sessionID = props.sessionID
          const location = ctx.location ?? ctx.data.location.default()
          setMode("unknown")
          toggle = () => {}
          if (!sessionID || !location) return
          let active = true
          let version = 0
          let pending = false
          let toggling = false
          const rpc = ctx.client.rpc(CompactionMode)
          toggle = async () => {
            if (!active || toggling || mode() === "unknown") return
            toggling = true
            const started = ++version
            try {
              const result = await rpc.toggle({ sessionID }, { location, signal: AbortSignal.timeout(8000) }) as { mode: "short" | "long" }
              if (active && version === started) { version++; setMode(result.mode) }
            } catch {
              if (active && version === started) { version++; setMode("unknown") }
            } finally { toggling = false }
          }
          const stop = rpc.events.on("selected", (event) => {
            if (!active || event.data.sessionID !== sessionID || event.location.directory !== location.directory || event.location.workspaceID !== location.workspaceID) return
            version++
            setMode(event.data.mode as "short" | "long" | "unknown")
          })
          const refresh = async () => {
            if (pending) return
            pending = true
            const started = version
            try {
              const result = await rpc.read({ sessionID }, { location, signal: AbortSignal.timeout(8000) }) as { mode: "short" | "long" | "unknown" }
              if (active && version === started) setMode(result.mode)
            } catch {
              if (active && version === started) setMode("unknown")
            } finally { pending = false }
          }
          void refresh()
          const timer = setInterval(refresh, 15000)
          onCleanup(() => { active = false; toggle = () => {}; clearInterval(timer); stop() })
        })
        return <text fg={ctx.theme.text.muted} onMouseUp={(event) => { if (event.button === 0) { event.stopPropagation(); toggle() } }}>{props.sessionID ? `Ctx: ${mode() === "short" ? "S" : mode() === "long" ? "L" : "?"}` : ""}</text>
      },
    })
  },
})
