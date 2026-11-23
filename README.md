# OpenCode session compaction

An experimental OpenCode V2 plugin for per-session compaction modes. It can request compaction earlier than OpenCode's normal threshold and shows the active mode in the terminal footer. The Desktop header indicator is experimental and has not been verified in a real Desktop app; browser-only web clients do not load it.

## Installation

The Git package's server component was verified on OpenCode 2.4.0. Dependency installation succeeds; the packaged TUI entry is tested for import and OpenTUI rendering. Interactive terminal behavior and the real Desktop indicator still need validation. Add this entry to `plugins` in your global `opencode.json(c)`, preserving existing entries:

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

Run `bun install` and `bun run test`. The test script builds the TUI with the OpenTUI Solid compiler before testing the packed artifact. The package exports committed `dist/tui.js`, not raw TSX: OpenCode's runtime may ignore a dependency's tsconfig and otherwise fall back to React. The packed TUI is imported from an unrelated working directory and rendered without a JSX preload. Run `bun run build:tui` and commit the updated artifact whenever `tui.tsx` or its RPC contract changes. Runtime imports stay external so OpenCode can provide its own Solid/OpenTUI host. The Desktop entry is a standalone CommonJS file using host-provided modules; its RPC contract is duplicated and must stay in sync with `rpc.ts`. See [OpenCode plugin documentation](https://opencode.ai/docs/build/plugins). No npm release is implied by the GitHub repository.

MIT licensed; see [LICENSE](LICENSE).

The build script is deliberately named `build:tui`, not `build`: npm prepares Git dependencies that declare `build` or install/prepare lifecycle scripts. Git consumers use the committed artifact and must not need a build during installation.
