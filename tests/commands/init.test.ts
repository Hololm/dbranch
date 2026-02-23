import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { readConfig } from "../../src/config/config.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-init-test-"));
  // Initialize a git repo in the temp dir
  await execa("git", ["init"], { cwd: tmpDir });
  await execa("git", ["commit", "--allow-empty", "-m", "init"], { cwd: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("init command prerequisites", () => {
  it("git repo has .git directory", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const stat = await fs.stat(gitDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("hooks directory exists or can be created", async () => {
    const hooksDir = path.join(tmpDir, ".git", "hooks");
    await fs.mkdir(hooksDir, { recursive: true });
    const stat = await fs.stat(hooksDir);
    expect(stat.isDirectory()).toBe(true);
  });
});

describe("init produces correct config", () => {
  it("writeConfig + readConfig round-trips for sqlite", async () => {
    const { writeConfig: wc } = await import("../../src/config/config.js");
    await wc(tmpDir, {
      version: 1,
      driver: "sqlite",
      connection: { path: "./dev.db" },
    });

    const config = await readConfig(tmpDir);
    expect(config.driver).toBe("sqlite");
    expect(config.version).toBe(1);
  });
});

describe("hook installation", () => {
  it("installs post-checkout hook", async () => {
    const { installHook } = await import("../../src/hooks/post-checkout.js");
    await installHook(tmpDir);

    const hookPath = path.join(tmpDir, ".git", "hooks", "post-checkout");
    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("# Installed by dbranch");
    expect(content).toContain("npx dbranch switch");
  });

  it("appends to existing hook", async () => {
    const hookPath = path.join(tmpDir, ".git", "hooks", "post-checkout");
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, "#!/bin/bash\necho 'existing hook'\n");

    const { installHook } = await import("../../src/hooks/post-checkout.js");
    await installHook(tmpDir);

    const content = await fs.readFile(hookPath, "utf-8");
    expect(content).toContain("existing hook");
    expect(content).toContain("# Installed by dbranch");
  });

  it("updates existing dbranch hook", async () => {
    const { installHook } = await import("../../src/hooks/post-checkout.js");
    await installHook(tmpDir);
    await installHook(tmpDir); // Install again

    const hookPath = path.join(tmpDir, ".git", "hooks", "post-checkout");
    const content = await fs.readFile(hookPath, "utf-8");
    // Should have exactly one marker
    const markers = content.match(/# Installed by dbranch/g);
    expect(markers).toHaveLength(1);
  });
});
