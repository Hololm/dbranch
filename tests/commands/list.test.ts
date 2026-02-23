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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-list-test-"));
  await fs.mkdir(path.join(tmpDir, ".dbranch", "snapshots"), { recursive: true });
  dbPath = path.join(tmpDir, "dev.db");
  await createFakeSqliteDb(dbPath);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("list command logic", () => {
  it("returns empty list when no snapshots", async () => {
    const driver = new SqliteDriver("dev.db", tmpDir);
    const snapshots = await driver.listSnapshots();
    expect(snapshots).toEqual([]);
  });

  it("lists snapshots sorted by most recent first", async () => {
    const driver = new SqliteDriver("dev.db", tmpDir);
    await driver.snapshot("main");
    await new Promise((r) => setTimeout(r, 50));
    await driver.snapshot("feature");

    const snapshots = await driver.listSnapshots();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].branch).toBe("feature");
    expect(snapshots[1].branch).toBe("main");
  });
});
