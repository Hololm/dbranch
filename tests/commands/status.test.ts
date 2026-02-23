import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readConfig, writeConfig, type DbranchConfig } from "../../src/config/config.js";
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-status-test-"));
  dbPath = path.join(tmpDir, "dev.db");
  await createFakeSqliteDb(dbPath);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("status command logic", () => {
  it("reads config and reports driver type", async () => {
    const config: DbranchConfig = {
      version: 1,
      driver: "sqlite",
      connection: { path: "./dev.db" },
    };
    await writeConfig(tmpDir, config);
    const readBack = await readConfig(tmpDir);
    expect(readBack.driver).toBe("sqlite");
  });

  it("reports snapshot status", async () => {
    const config: DbranchConfig = {
      version: 1,
      driver: "sqlite",
      connection: { path: "./dev.db" },
    };
    await writeConfig(tmpDir, config);
    const driver = new SqliteDriver("dev.db", tmpDir);

    expect(await driver.hasSnapshot("main")).toBe(false);
    await driver.snapshot("main");
    expect(await driver.hasSnapshot("main")).toBe(true);
  });
});
