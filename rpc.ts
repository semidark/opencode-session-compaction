import { Rpc } from "@opencode/plugin/rpc"

export const CompactionMode = Rpc.define({
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
