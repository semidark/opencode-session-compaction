// @bun
// tui.tsx
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createSignal, onCleanup } from "solid-js";

// rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var CompactionMode = Rpc.define({
  id: "semidark-session-compaction",
  methods: {
    read: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string", minLength: 1 } },
        required: ["sessionID"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: { mode: { type: "string", enum: ["short", "long", "unknown"] } },
        required: ["mode"],
        additionalProperties: false
      }
    },
    toggle: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string", minLength: 1 } },
        required: ["sessionID"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: { mode: { type: "string", enum: ["short", "long"] } },
        required: ["mode"],
        additionalProperties: false
      }
    }
  },
  events: {
    selected: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          mode: { type: "string", enum: ["short", "long", "unknown"] }
        },
        required: ["sessionID", "mode"],
        additionalProperties: false
      }
    }
  }
});

// tui.tsx
var tui_default = Plugin.define({
  id: "semidark.session-compaction.tui",
  setup(ctx) {
    return ctx.ui.slot({
      append: "prompt.footer.status",
      render: (props) => {
        const [mode, setMode] = createSignal("unknown");
        let toggle = () => {};
        createEffect(() => {
          const sessionID = props.sessionID;
          const location = ctx.location ?? ctx.data.location.default();
          setMode("unknown");
          toggle = () => {};
          if (!sessionID || !location)
            return;
          let active = true;
          let version = 0;
          let pending = false;
          let toggling = false;
          const rpc = ctx.client.rpc(CompactionMode);
          toggle = async () => {
            if (!active || toggling || mode() === "unknown")
              return;
            toggling = true;
            const started = ++version;
            try {
              const result = await rpc.toggle({
                sessionID
              }, {
                location,
                signal: AbortSignal.timeout(8000)
              });
              if (active && version === started) {
                version++;
                setMode(result.mode);
              }
            } catch {
              if (active && version === started) {
                version++;
                setMode("unknown");
              }
            } finally {
              toggling = false;
            }
          };
          const stop = rpc.events.on("selected", (event) => {
            if (!active || event.data.sessionID !== sessionID || event.location.directory !== location.directory || event.location.workspaceID !== location.workspaceID)
              return;
            version++;
            setMode(event.data.mode);
          });
          const refresh = async () => {
            if (pending)
              return;
            pending = true;
            const started = version;
            try {
              const result = await rpc.read({
                sessionID
              }, {
                location,
                signal: AbortSignal.timeout(8000)
              });
              if (active && version === started)
                setMode(result.mode);
            } catch {
              if (active && version === started)
                setMode("unknown");
            } finally {
              pending = false;
            }
          };
          refresh();
          const timer = setInterval(refresh, 15000);
          onCleanup(() => {
            active = false;
            toggle = () => {};
            clearInterval(timer);
            stop();
          });
        });
        return (() => {
          var _el$ = _$createElement("text");
          _$setProp(_el$, "onMouseUp", (event) => {
            if (event.button === 0) {
              event.stopPropagation();
              toggle();
            }
          });
          _$insert(_el$, (() => {
            var _c$ = _$memo(() => !!props.sessionID);
            return () => _c$() ? `Context: ${mode() === "short" ? "Short" : mode() === "long" ? "Long" : "Unknown"}` : "";
          })());
          _$effect((_$p) => _$setProp(_el$, "fg", ctx.theme.text.muted, _$p));
          return _el$;
        })();
      }
    });
  }
});
export {
  tui_default as default
};
