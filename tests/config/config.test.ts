import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  readConfig,
  writeConfig,
  getDbranchDir,
  getSnapshotsDir,
  type DbranchConfig,
} from "../../src/config/config.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-config-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getDbranchDir", () => {
  it("returns .dbranch under repo root", () => {
    expect(getDbranchDir("/repo")).toBe(path.join("/repo", ".dbranch"));
  });
});

describe("getSnapshotsDir", () => {
  it("returns .dbranch/snapshots under repo root", () => {
    expect(getSnapshotsDir("/repo")).toBe(path.join("/repo", ".dbranch", "snapshots"));
  });
});

describe("writeConfig / readConfig", () => {
  it("writes and reads a sqlite config", async () => {
    const config: DbranchConfig = {
      version: 1,
      driver: "sqlite",
      connection: { path: "./dev.db" },
    };
    await writeConfig(tmpDir, config);
    const read = await readConfig(tmpDir);
    expect(read).toEqual(config);
  });

  it("writes and reads a postgres config", async () => {
    const config: DbranchConfig = {
      version: 1,
      driver: "postgres",
      connection: {
        host: "localhost",
        port: 5432,
        database: "myapp_dev",
        user: "postgres",
        password: "",
      },
    };
    await writeConfig(tmpDir, config);
    const read = await readConfig(tmpDir);
    expect(read).toEqual(config);
  });

  it("creates .dbranch and snapshots directories", async () => {
    const config: DbranchConfig = {
      version: 1,
      driver: "sqlite",
      connection: { path: "./dev.db" },
    };
    await writeConfig(tmpDir, config);

    const dbranchStat = await fs.stat(getDbranchDir(tmpDir));
    expect(dbranchStat.isDirectory()).toBe(true);

    const snapshotsStat = await fs.stat(getSnapshotsDir(tmpDir));
    expect(snapshotsStat.isDirectory()).toBe(true);
  });

  it("throws DbranchError when config does not exist", async () => {
    await expect(readConfig(tmpDir)).rejects.toThrow(/Run `dbranch init` first/);
  });

  it("throws DbranchError for malformed YAML", async () => {
    const configDir = path.join(tmpDir, ".dbranch");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, "config.yaml"), ":::invalid yaml:::");
    await expect(readConfig(tmpDir)).rejects.toThrow(/reinitialize/);
  });

  it("throws DbranchError when driver field is missing", async () => {
    const configDir = path.join(tmpDir, ".dbranch");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "config.yaml"),
      "version: 1\nconnection:\n  path: ./dev.db\n",
    );
    await expect(readConfig(tmpDir)).rejects.toThrow(/missing `driver` field/);
  });

  it("throws DbranchError when connection field is missing", async () => {
    const configDir = path.join(tmpDir, ".dbranch");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "config.yaml"),
      "version: 1\ndriver: sqlite\n",
    );
    await expect(readConfig(tmpDir)).rejects.toThrow(/missing `connection` field/);
  });

  it("throws DbranchError when sqlite connection missing path", async () => {
    const configDir = path.join(tmpDir, ".dbranch");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "config.yaml"),
      "version: 1\ndriver: sqlite\nconnection:\n  host: localhost\n",
    );
    await expect(readConfig(tmpDir)).rejects.toThrow(/SQLite connection requires a `path` field/);
  });

  it("throws DbranchError when postgres connection missing required fields", async () => {
    const configDir = path.join(tmpDir, ".dbranch");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "config.yaml"),
      "version: 1\ndriver: postgres\nconnection:\n  port: 5432\n",
    );
    await expect(readConfig(tmpDir)).rejects.toThrow(
      /Postgres connection requires `host`, `database`, and `user` fields/,
    );
  });
});
