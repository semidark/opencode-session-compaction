import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("TUI shows compact mode labels and keeps click toggling", async () => {
  const child = Bun.spawn([process.execPath, "--conditions=browser", "-e", `
    import plugin from "./dist/tui.js";
    import { testRender } from "@opentui/solid";
    let slot;
    let mode = "short";
    const rpc = { read: async () => ({ mode }), toggle: async () => ({ mode: mode = mode === "short" ? "long" : "short" }), events: { on: () => () => {} } };
    plugin.setup({
      ui: { slot: value => { slot = value; } },
      theme: { text: { muted: "#888888" } },
      location: { directory: "/test" },
      data: { location: { default: () => ({ directory: "/test" }) } },
      client: { rpc: () => rpc },
    });
    const test = await testRender(() => slot.render({ sessionID: "session" }), { width: 40, height: 4 });
    const flush = () => new Promise(resolve => setImmediate(resolve));
    try {
      await test.renderOnce(); await flush(); await test.renderOnce();
      if (!test.captureCharFrame().includes("Ctx: S")) throw new Error("Missing short mode: " + test.captureCharFrame());
      await test.mockMouse.click(2, 0, 0); await flush(); await test.renderOnce();
      if (!test.captureCharFrame().includes("Ctx: L")) throw new Error("Missing long mode");
    } finally { test.renderer.destroy(); }
  `], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" })
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(0)
})

test("Git consumers install the committed artifact without dependency preparation", async () => {
  const manifest = await Bun.file(join(import.meta.dir, "package.json")).json()
  for (const name of ["build", "prepare", "prepack", "preinstall", "install", "postinstall"]) {
    expect(manifest.scripts[name]).toBeUndefined()
  }
  expect(manifest.exports["./tui"]).toBe("./dist/tui.js")
})

test("published TUI entry imports and renders without falling back to React", async () => {
  const directory = await mkdtemp(join(tmpdir(), "session-compaction-package-"))
  try {
    const pack = Bun.spawn(["npm", "pack", "--pack-destination", directory, "--json"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = await new Response(pack.stdout).text()
    const errors = await new Response(pack.stderr).text()
    expect(await pack.exited, errors).toBe(0)
    const [manifest] = JSON.parse(output)
    expect(manifest.files.some((file: { path: string }) => file.path === "dist/tui.js")).toBe(true)
    const extract = Bun.spawn(["tar", "-xzf", join(directory, manifest.filename), "-C", directory])
    expect(await extract.exited).toBe(0)
    // Resolve dependencies from the development checkout, but load the shipped
    // files outside it so a checkout-only tsconfig cannot mask packaging bugs.
    const { symlink } = await import("node:fs/promises")
    await symlink(join(import.meta.dir, "node_modules"), join(directory, "package", "node_modules"))
    const entrypoint = join(directory, "package", "dist", "tui.js")
    const child = Bun.spawn([process.execPath, "-e", `await import(${JSON.stringify(entrypoint)}); console.log("TUI imported")`], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = await new Response(child.stdout).text()
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited, stderr).toBe(0)
    expect(stdout).toContain("TUI imported")
    const render = Bun.spawn([process.execPath, "-e", `
      import plugin from "./dist/tui.js";
      import { testRender } from "@opentui/solid";
      let slot;
      plugin.setup({
        ui: { slot: value => { slot = value; } },
        theme: { text: { muted: "#888888" } },
        data: { location: { default: () => undefined } },
      });
      const test = await testRender(() => slot.render({}), { width: 40, height: 4 });
      try { await test.renderOnce(); console.log("TUI rendered"); }
      finally { test.renderer.destroy(); }
    `], { cwd: join(directory, "package"), stdout: "pipe", stderr: "pipe" })
    const rendered = await new Response(render.stdout).text()
    const renderErrors = await new Response(render.stderr).text()
    expect(await render.exited, renderErrors).toBe(0)
    expect(rendered).toContain("TUI rendered")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
