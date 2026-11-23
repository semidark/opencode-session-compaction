// Desktop GUI entry. The host provides these modules; no bundled dependencies.
const { Plugin, Slot } = require("@opencode/plugin/gui")
const { Rpc } = require("@opencode/plugin/rpc")
const { createEffect, createSignal, onCleanup } = require("solid-js")

const CompactionMode = Rpc.define({
  id: "semidark-session-compaction",
  methods: {
    read: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string", minLength: 1 } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { mode: { type: "string", enum: ["short", "long", "unknown"] } },
        required: ["mode"],
        additionalProperties: false,
      },
    },
    toggle: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string", minLength: 1 } },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { mode: { type: "string", enum: ["short", "long"] } },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  },
  events: {
    selected: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          mode: { type: "string", enum: ["short", "long", "unknown"] },
        },
        required: ["sessionID", "mode"],
        additionalProperties: false,
      },
    },
  },
})

module.exports = {
  default: Plugin.define({
    setup(ctx) {
      ctx.add(Slot, {
        at: "session.header",
        render: (props) => {
          const [mode, setMode] = createSignal("unknown")
          const [busy, setBusy] = createSignal(false)
          let toggle = () => {}
          const label = document.createElement("button")
          label.type = "button"
          label.className = "text-12-regular text-text-weak whitespace-nowrap cursor-pointer"
          label.onclick = () => toggle()
          createEffect(() => {
            const value = mode()
            label.textContent = `Context: ${value === "short" ? "Short" : value === "long" ? "Long" : "Unknown"}`
            label.disabled = value === "unknown" || busy()
            label.title = [
              value === "short" ? "Short: requests compaction at the configured fraction of the model's context window." : value === "long" ? "Long: uses normal OpenCode compaction." : "Context mode unavailable: waiting for the session, model, or server.",
              "Short is a soft target, not a hard context or spending cap.",
              value === "unknown" ? "Toggle unavailable until the mode can be read." : `Click to switch to ${value === "short" ? "Long" : "Short"} for this session.`,
              "Use /context-mode auto to restore the configured model-dependent default.",
            ].join("\n")
          })
          createEffect(() => {
            const session = props.session
            const sessionID = session.id
            const location = session.location
            const server = session.server
            const connected = server.connected
            const client = server.client
            const activeView = props.active
            setMode("unknown")
            setBusy(false)
            toggle = () => {}
            if (!sessionID || !location || !connected || !activeView) return
            let active = true
            let version = 0
            let pending = false
            const rpc = client.rpc(CompactionMode)
            toggle = async () => {
              if (!active || busy() || mode() === "unknown") return
              setBusy(true)
              const started = ++version
              try {
                const result = await rpc.toggle({ sessionID }, { location, signal: AbortSignal.timeout(8000) })
                if (active && version === started) { version++; setMode(result.mode) }
              } catch {
                if (active && version === started) { version++; setMode("unknown") }
              } finally { if (active) setBusy(false) }
            }
            const unsubscribe = rpc.events.on("selected", (event) => {
              if (!active || event.data.sessionID !== sessionID || event.location.directory !== location.directory || event.location.workspaceID !== location.workspaceID) return
              version++
              setMode(event.data.mode)
            })
            const refresh = async () => {
              if (pending) return
              pending = true
              const started = version
              try {
                const result = await rpc.read({ sessionID }, { location, signal: AbortSignal.timeout(8000) })
                if (active && version === started) setMode(result.mode)
              } catch {
                if (active && version === started) setMode("unknown")
              } finally { pending = false }
            }
            void refresh()
            const timer = setInterval(refresh, 15000)
            onCleanup(() => { active = false; toggle = () => {}; clearInterval(timer); unsubscribe() })
          })
          return label
        },
      })
    },
  }),
}
