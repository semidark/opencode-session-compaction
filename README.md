# OpenCode session compaction

An experimental OpenCode V2 plugin for per-session compaction modes. It can request compaction earlier than OpenCode's normal threshold and shows the active mode in the terminal footer. The Desktop header indicator is experimental and has not been verified in a real Desktop app; browser-only web clients do not load it.

## Installation

The original local plugin was tested for loading on OpenCode 2.2.7. **The standalone Git package has not yet been verified:** installation currently fails against the development registry because a required OpenCode SDK dependency is unavailable. Once resolved, add this entry to `plugins` in your global `opencode.json(c)`, preserving existing entries:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{
    "package": "github:semidark/opencode-session-compaction",
    "options": {
      "fraction": 0.3,
      "minContext": 272000,
    },
  }],
}
```

Both options are optional. `fraction` is greater than zero and at most one; `minContext` is a positive integer. In auto mode models with context limits at or above `minContext` use Short; smaller models use Long. These defaults are heuristics, not a provider pricing rule; adjust them for your models. Configuring globally is required for Desktop. Use `/reload` if needed.

## Usage

- `/context-mode short`: request early compaction around `fraction` of the selected model's context window.
- `/context-mode long`: use normal OpenCode compaction.
- `/context-mode auto`: clear the session override and use the model-dependent default.
- `/context-mode`: refresh the mode without changing it.

Click the indicator to toggle Short and Long; the override persists for the current session. Children do not inherit it. The indicator may show Unknown if the model or its limit is unavailable.

**This is a soft post-request trigger, not a hard context or spending cap.** It uses the last completed step's reported input, output, reasoning and cache usage. Subsequent tool output, provider reporting differences, queue timing, retries, missing data, and fixed-context loop prevention can delay compaction. Already queued compactions cannot be cancelled by switching modes. Autonomous-run behavior needs more validation. Compaction itself may cost tokens.

## Development

Run `bun install` and `bun test`. The Desktop entry is a standalone CommonJS file using host-provided modules; its RPC contract is duplicated and must stay in sync with `rpc.ts`. See [OpenCode plugin documentation](https://opencode.ai/docs/build/plugins). No npm release is implied by the GitHub repository.

MIT licensed; see [LICENSE](LICENSE).
