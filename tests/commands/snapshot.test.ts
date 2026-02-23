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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-snapshot-test-"));
  await fs.mkdir(path.join(tmpDir, ".dbranch", "snapshots"), { recursive: true });
  dbPath = path.join(tmpDir, "dev.db");
  await createFakeSqliteDb(dbPath);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("snapshot command logic", () => {
  it("creates a snapshot using the driver", async () => {
    const driver = new SqliteDriver("dev.db", tmpDir);
    await driver.snapshot("main");
    expect(await driver.hasSnapshot("main")).toBe(true);
  });

  it("overwrites existing snapshot", async () => {
    const driver = new SqliteDriver("dev.db", tmpDir);
    await driver.snapshot("main");
    await createFakeSqliteDb(dbPath, "updated");
    await driver.snapshot("main");

    const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.sqlite3");
    const content = await fs.readFile(snapshotPath, "utf-8");
    expect(content).toContain("updated");
  });
});
