import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SqliteDriver } from "../../src/drivers/sqlite.js";
import { writeConfig, type DbranchConfig } from "../../src/config/config.js";
import { setSilent } from "../../src/utils/logger.js";

const SQLITE_HEADER = "SQLite format 3\0";

let tmpDir: string;
let dbPath: string;
let driver: SqliteDriver;

beforeEach(async () => {
  setSilent(true);
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-delete-test-"));
  await fs.mkdir(path.join(tmpDir, ".dbranch", "snapshots"), { recursive: true });
  dbPath = path.join(tmpDir, "dev.db");
  const header = Buffer.from(SQLITE_HEADER, "utf-8");
  await fs.writeFile(dbPath, Buffer.concat([header, Buffer.from("test data")]));
  driver = new SqliteDriver("dev.db", tmpDir);
});

afterEach(async () => {
  setSilent(false);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("delete command logic", () => {
  it("deletes an existing snapshot successfully", async () => {
    await driver.snapshot("feature-branch");
    expect(await driver.hasSnapshot("feature-branch")).toBe(true);

    await driver.deleteSnapshot("feature-branch");
    expect(await driver.hasSnapshot("feature-branch")).toBe(false);
  });

  it("does not affect other snapshots when deleting one", async () => {
    await driver.snapshot("branch-a");
    await driver.snapshot("branch-b");
    await driver.snapshot("branch-c");

    await driver.deleteSnapshot("branch-b");

    expect(await driver.hasSnapshot("branch-a")).toBe(true);
    expect(await driver.hasSnapshot("branch-b")).toBe(false);
    expect(await driver.hasSnapshot("branch-c")).toBe(true);
  });

  it("deleteSnapshot is a no-op for nonexistent snapshot", async () => {
    // SqliteDriver.deleteSnapshot doesn't throw for ENOENT
    await expect(driver.deleteSnapshot("nonexistent")).resolves.not.toThrow();
  });
});
