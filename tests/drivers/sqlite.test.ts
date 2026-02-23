import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SqliteDriver } from "../../src/drivers/sqlite.js";

const SQLITE_HEADER = "SQLite format 3\0";

let tmpDir: string;
let dbPath: string;
let driver: SqliteDriver;

async function createFakeSqliteDb(filePath: string, content: string = "default"): Promise<void> {
  const header = Buffer.from(SQLITE_HEADER, "utf-8");
  const body = Buffer.from(content, "utf-8");
  await fs.writeFile(filePath, Buffer.concat([header, body]));
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-sqlite-test-"));
  await fs.mkdir(path.join(tmpDir, ".dbranch", "snapshots"), { recursive: true });
  dbPath = path.join(tmpDir, "dev.db");
  await createFakeSqliteDb(dbPath);
  driver = new SqliteDriver("dev.db", tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("SqliteDriver", () => {
  describe("validate", () => {
    it("returns true for valid SQLite file", async () => {
      expect(await driver.validate()).toBe(true);
    });

    it("returns false for non-SQLite file", async () => {
      await fs.writeFile(dbPath, "not a sqlite file");
      expect(await driver.validate()).toBe(false);
    });

    it("returns false for missing file", async () => {
      await fs.unlink(dbPath);
      expect(await driver.validate()).toBe(false);
    });
  });

  describe("snapshot", () => {
    it("creates a snapshot file", async () => {
      await driver.snapshot("main");
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.sqlite3");
      const exists = await fs.access(snapshotPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it("snapshot content matches original", async () => {
      await driver.snapshot("main");
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.sqlite3");
      const original = await fs.readFile(dbPath);
      const snapshot = await fs.readFile(snapshotPath);
      expect(snapshot.equals(original)).toBe(true);
    });

    it("sanitizes branch names with slashes", async () => {
      await driver.snapshot("feature/auth");
      const snapshotPath = path.join(
        tmpDir,
        ".dbranch",
        "snapshots",
        "feature-SLASH-auth.sqlite3",
      );
      const exists = await fs.access(snapshotPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it("copies WAL sidecar files", async () => {
      await fs.writeFile(dbPath + "-wal", "wal data");
      await driver.snapshot("main");
      const walSnapshot = path.join(tmpDir, ".dbranch", "snapshots", "main.sqlite3-wal");
      const content = await fs.readFile(walSnapshot, "utf-8");
      expect(content).toBe("wal data");
    });

    it("throws when DB file is missing", async () => {
      await fs.unlink(dbPath);
      await expect(driver.snapshot("main")).rejects.toThrow(/not found/);
    });

    it("snapshots a zero-byte DB file", async () => {
      await fs.writeFile(dbPath, "");
      // validate will fail but snapshot should still work (it's just a copy)
      expect(await driver.validate()).toBe(false);
      await driver.snapshot("main");
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.sqlite3");
      const stat = await fs.stat(snapshotPath);
      expect(stat.size).toBe(0);
    });
  });

  describe("restore", () => {
    it("restores snapshot to DB path", async () => {
      await driver.snapshot("main");
      // Modify the DB
      await createFakeSqliteDb(dbPath, "modified");
      await driver.restore("main");
      const content = await fs.readFile(dbPath);
      // Should be back to original (with "default" content)
      expect(content.toString("utf-8")).toContain("default");
    });

    it("restores WAL sidecar files", async () => {
      await fs.writeFile(dbPath + "-wal", "wal data");
      await driver.snapshot("main");
      // Remove the wal
      await fs.unlink(dbPath + "-wal");
      await driver.restore("main");
      const content = await fs.readFile(dbPath + "-wal", "utf-8");
      expect(content).toBe("wal data");
    });

    it("removes WAL sidecar when snapshot has none", async () => {
      await driver.snapshot("main");
      // Add a wal file that shouldn't be there
      await fs.writeFile(dbPath + "-wal", "stale wal");
      await driver.restore("main");
      const exists = await fs.access(dbPath + "-wal").then(() => true).catch(() => false);
      expect(exists).toBe(false);
    });

    it("throws when snapshot is missing", async () => {
      await expect(driver.restore("nonexistent")).rejects.toThrow(/No snapshot found/);
    });

    it("restores a zero-byte snapshot file", async () => {
      // Create a zero-byte snapshot manually
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "empty.sqlite3");
      await fs.writeFile(snapshotPath, "");
      await driver.restore("empty");
      const stat = await fs.stat(dbPath);
      expect(stat.size).toBe(0);
    });
  });

  describe("hasSnapshot", () => {
    it("returns true when snapshot exists", async () => {
      await driver.snapshot("main");
      expect(await driver.hasSnapshot("main")).toBe(true);
    });

    it("returns false when snapshot does not exist", async () => {
      expect(await driver.hasSnapshot("nonexistent")).toBe(false);
    });
  });

  describe("deleteSnapshot", () => {
    it("removes the snapshot file", async () => {
      await driver.snapshot("main");
      await driver.deleteSnapshot("main");
      expect(await driver.hasSnapshot("main")).toBe(false);
    });

    it("does not throw when snapshot does not exist", async () => {
      await expect(driver.deleteSnapshot("nonexistent")).resolves.not.toThrow();
    });

    it("removes sidecar files", async () => {
      await fs.writeFile(dbPath + "-wal", "wal data");
      await driver.snapshot("main");
      await driver.deleteSnapshot("main");
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.sqlite3");
      const walExists = await fs.access(snapshotPath + "-wal").then(() => true).catch(() => false);
      expect(walExists).toBe(false);
    });
  });

  describe("listSnapshots", () => {
    it("returns empty array when no snapshots", async () => {
      const snapshots = await driver.listSnapshots();
      expect(snapshots).toEqual([]);
    });

    it("lists all snapshots", async () => {
      await driver.snapshot("main");
      await driver.snapshot("feature/auth");
      const snapshots = await driver.listSnapshots();
      expect(snapshots).toHaveLength(2);
      const branches = snapshots.map((s) => s.branch);
      expect(branches).toContain("main");
      expect(branches).toContain("feature/auth");
    });

    it("includes size and date information", async () => {
      await driver.snapshot("main");
      const snapshots = await driver.listSnapshots();
      expect(snapshots[0].size).toBeGreaterThan(0);
      expect(snapshots[0].createdAt).toBeInstanceOf(Date);
      expect(snapshots[0].fileName).toBe("main.sqlite3");
    });
  });
});
