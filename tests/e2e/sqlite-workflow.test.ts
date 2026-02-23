import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { writeConfig, readConfig, type DbranchConfig } from "../../src/config/config.js";
import { createDriver } from "../../src/drivers/index.js";
import { installHook } from "../../src/hooks/post-checkout.js";

const SQLITE_HEADER = "SQLite format 3\0";

let tmpDir: string;
let dbPath: string;

async function createFakeSqliteDb(filePath: string, content: string = "default"): Promise<void> {
  const header = Buffer.from(SQLITE_HEADER, "utf-8");
  const body = Buffer.from(content, "utf-8");
  await fs.writeFile(filePath, Buffer.concat([header, body]));
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-e2e-"));
  // Set up a real git repo
  await execa("git", ["init"], { cwd: tmpDir });
  await execa("git", ["commit", "--allow-empty", "-m", "init"], { cwd: tmpDir });

  // Create a fake SQLite database
  dbPath = path.join(tmpDir, "dev.db");
  await createFakeSqliteDb(dbPath, "initial-data");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("SQLite end-to-end workflow", () => {
  it("full init → snapshot → switch → list → status cycle", async () => {
    const config: DbranchConfig = {
      version: 1,
      driver: "sqlite",
      connection: { path: "./dev.db" },
    };

    // 1. Init: write config, install hook
    await writeConfig(tmpDir, config);
    await installHook(tmpDir);

    // Verify config
    const readBack = await readConfig(tmpDir);
    expect(readBack.driver).toBe("sqlite");

    // Verify hook installed
    const hookPath = path.join(tmpDir, ".git", "hooks", "post-checkout");
    const hookContent = await fs.readFile(hookPath, "utf-8");
    expect(hookContent).toContain("dbranch");

    // 2. Snapshot main
    const driver = await createDriver(config, tmpDir);
    await driver.snapshot("main");
    expect(await driver.hasSnapshot("main")).toBe(true);

    // 3. Simulate switching to feature branch
    // Modify DB
    await createFakeSqliteDb(dbPath, "feature-data");
    await driver.snapshot("feature");

    // 4. Switch back to main
    await driver.restore("main");
    let content = await fs.readFile(dbPath, "utf-8");
    expect(content).toContain("initial-data");

    // 5. Switch to feature
    await driver.restore("feature");
    content = await fs.readFile(dbPath, "utf-8");
    expect(content).toContain("feature-data");

    // 6. List
    const snapshots = await driver.listSnapshots();
    expect(snapshots).toHaveLength(2);
    const branches = snapshots.map((s) => s.branch).sort();
    expect(branches).toEqual(["feature", "main"]);

    // 7. Validate
    expect(await driver.validate()).toBe(true);
  });

  it("handles branch names with slashes", async () => {
    const config: DbranchConfig = {
      version: 1,
      driver: "sqlite",
      connection: { path: "./dev.db" },
    };
    await writeConfig(tmpDir, config);

    const driver = await createDriver(config, tmpDir);

    await driver.snapshot("feature/auth/v2");
    expect(await driver.hasSnapshot("feature/auth/v2")).toBe(true);

    // Verify file name on disk is sanitized
    const snapshotsDir = path.join(tmpDir, ".dbranch", "snapshots");
    const files = await fs.readdir(snapshotsDir);
    expect(files).toContain("feature-SLASH-auth-SLASH-v2.sqlite3");

    // List should desanitize
    const snapshots = await driver.listSnapshots();
    expect(snapshots[0].branch).toBe("feature/auth/v2");
  });

  it("delete removes a snapshot", async () => {
    const config: DbranchConfig = {
      version: 1,
      driver: "sqlite",
      connection: { path: "./dev.db" },
    };
    await writeConfig(tmpDir, config);
    const driver = await createDriver(config, tmpDir);

    await driver.snapshot("main");
    await driver.snapshot("feature");
    expect((await driver.listSnapshots()).length).toBe(2);

    await driver.deleteSnapshot("feature");
    expect(await driver.hasSnapshot("feature")).toBe(false);
    expect((await driver.listSnapshots()).length).toBe(1);
  });
});
