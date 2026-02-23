import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SqliteDriver } from "../../src/drivers/sqlite.js";

const SQLITE_HEADER = "SQLite format 3\0";

let tmpDir: string;
let dbPath: string;

async function createFakeSqliteDb(filePath: string, content: string = "default"): Promise<void> {
  const header = Buffer.from(SQLITE_HEADER, "utf-8");
  const body = Buffer.from(content, "utf-8");
  await fs.writeFile(filePath, Buffer.concat([header, body]));
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-switch-test-"));
  await fs.mkdir(path.join(tmpDir, ".dbranch", "snapshots"), { recursive: true });
  dbPath = path.join(tmpDir, "dev.db");
  await createFakeSqliteDb(dbPath, "main-data");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("switch command logic", () => {
  it("snapshots from-branch and restores to-branch", async () => {
    const driver = new SqliteDriver("dev.db", tmpDir);

    // Snapshot main
    await driver.snapshot("main");

    // Modify DB to simulate feature branch state
    await createFakeSqliteDb(dbPath, "feature-data");
    await driver.snapshot("feature");

    // Restore back to main state
    await createFakeSqliteDb(dbPath, "feature-data");
    await driver.restore("main");

    const content = await fs.readFile(dbPath, "utf-8");
    expect(content).toContain("main-data");
  });

  it("keeps DB as-is for new branch with no snapshot", async () => {
    const driver = new SqliteDriver("dev.db", tmpDir);

    // No snapshot exists for "new-branch"
    expect(await driver.hasSnapshot("new-branch")).toBe(false);

    // DB should still have its current content
    const content = await fs.readFile(dbPath, "utf-8");
    expect(content).toContain("main-data");
  });

  it("handles full switch workflow", async () => {
    const driver = new SqliteDriver("dev.db", tmpDir);

    // 1. On main, take snapshot
    await driver.snapshot("main");

    // 2. Switch to feature — no snapshot exists, take initial snapshot
    await driver.snapshot("feature");

    // 3. Modify DB on feature branch
    await createFakeSqliteDb(dbPath, "feature-v2");
    await driver.snapshot("feature");

    // 4. Switch back to main
    await driver.restore("main");
    let content = await fs.readFile(dbPath, "utf-8");
    expect(content).toContain("main-data");

    // 5. Switch to feature again
    await driver.restore("feature");
    content = await fs.readFile(dbPath, "utf-8");
    expect(content).toContain("feature-v2");
  });
});
