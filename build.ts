import solidPlugin from "@opentui/solid/bun-plugin"

const result = await Bun.build({
  entrypoints: ["./tui.tsx"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  packages: "external",
  plugins: [solidPlugin],
})
if (!result.success) {
  console.error(result.logs)
  process.exit(1)
}
