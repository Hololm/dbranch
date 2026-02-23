import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock execa
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { PostgresDriver } from "../../src/drivers/postgres.js";
import type { PostgresConnection } from "../../src/config/config.js";

const mockedExeca = vi.mocked(execa);

const defaultConnection: PostgresConnection = {
  host: "localhost",
  port: 5432,
  database: "myapp_dev",
  user: "postgres",
  password: "secret",
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-pg-test-"));
  await fs.mkdir(path.join(tmpDir, ".dbranch", "snapshots"), { recursive: true });
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("PostgresDriver", () => {
  describe("snapshot", () => {
    it("calls pg_dump with correct arguments", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      mockedExeca.mockResolvedValue({} as any);

      // pg_dump creates a file, so we need to simulate that
      mockedExeca.mockImplementation(async (cmd: any, args: any, opts: any) => {
        if (cmd === "pg_dump") {
          const fileArg = (args as string[]).find((a: string) => a.startsWith("--file="));
          if (fileArg) {
            await fs.writeFile(fileArg.replace("--file=", ""), "dump data");
          }
        }
        return {} as any;
      });

      await driver.snapshot("main");

      expect(mockedExeca).toHaveBeenCalledWith(
        "pg_dump",
        expect.arrayContaining([
          "--format=custom",
          expect.stringMatching(/--file=.*main\.dump\.tmp$/),
          "--host",
          "localhost",
          "--port",
          "5432",
          "--username",
          "postgres",
          "myapp_dev",
        ]),
        expect.objectContaining({
          env: expect.objectContaining({ PGPASSWORD: "secret" }),
        }),
      );
    });

    it("creates snapshot file in correct location", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);

      mockedExeca.mockImplementation(async (cmd: any, args: any) => {
        if (cmd === "pg_dump") {
          const fileArg = (args as string[]).find((a: string) => a.startsWith("--file="));
          if (fileArg) {
            await fs.writeFile(fileArg.replace("--file=", ""), "dump data");
          }
        }
        return {} as any;
      });

      await driver.snapshot("main");
      expect(await driver.hasSnapshot("main")).toBe(true);
    });
  });

  describe("restore", () => {
    it("calls pg_dump (backup), dropdb, createdb, pg_restore in order", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);

      // Create a fake snapshot
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.dump");
      await fs.writeFile(snapshotPath, "dump data");

      const callOrder: string[] = [];
      mockedExeca.mockImplementation(async (cmd: any, args: any) => {
        callOrder.push(cmd as string);
        if (cmd === "pg_dump") {
          // Simulate backup file creation
          const fileArg = (args as string[]).find((a: string) => a.startsWith("--file="));
          if (fileArg) {
            await fs.writeFile(fileArg.replace("--file=", ""), "backup data");
          }
        }
        return {} as any;
      });

      await driver.restore("main");

      expect(callOrder).toEqual(["pg_dump", "dropdb", "createdb", "pg_restore"]);
    });

    it("passes correct args to dropdb", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.dump");
      await fs.writeFile(snapshotPath, "dump data");

      mockedExeca.mockImplementation(async (cmd: any, args: any) => {
        if (cmd === "pg_dump") {
          const fileArg = (args as string[]).find((a: string) => a.startsWith("--file="));
          if (fileArg) {
            await fs.writeFile(fileArg.replace("--file=", ""), "backup data");
          }
        }
        return {} as any;
      });
      await driver.restore("main");

      expect(mockedExeca).toHaveBeenCalledWith(
        "dropdb",
        expect.arrayContaining(["--if-exists", "myapp_dev"]),
        expect.any(Object),
      );
    });

    it("passes correct args to pg_restore", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.dump");
      await fs.writeFile(snapshotPath, "dump data");

      mockedExeca.mockImplementation(async (cmd: any, args: any) => {
        if (cmd === "pg_dump") {
          const fileArg = (args as string[]).find((a: string) => a.startsWith("--file="));
          if (fileArg) {
            await fs.writeFile(fileArg.replace("--file=", ""), "backup data");
          }
        }
        return {} as any;
      });
      await driver.restore("main");

      expect(mockedExeca).toHaveBeenCalledWith(
        "pg_restore",
        expect.arrayContaining([
          "--dbname=myapp_dev",
          "--no-owner",
          "--no-privileges",
          snapshotPath,
        ]),
        expect.any(Object),
      );
    });

    it("throws when no snapshot exists", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      await expect(driver.restore("nonexistent")).rejects.toThrow(/No snapshot found/);
    });

    it("attempts rollback on pg_restore failure", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.dump");
      await fs.writeFile(snapshotPath, "dump data");

      const callOrder: string[] = [];
      mockedExeca.mockImplementation(async (cmd: any, args: any) => {
        callOrder.push(cmd as string);
        if (cmd === "pg_dump") {
          const fileArg = (args as string[]).find((a: string) => a.startsWith("--file="));
          if (fileArg) {
            await fs.writeFile(fileArg.replace("--file=", ""), "backup data");
          }
          return {} as any;
        }
        if (cmd === "pg_restore") {
          // First pg_restore call fails, second (rollback) succeeds
          if (callOrder.filter((c) => c === "pg_restore").length === 1) {
            const err = new Error("restore failed");
            (err as any).stderr = "ERROR: something went wrong";
            throw err;
          }
          return {} as any;
        }
        return {} as any;
      });

      await expect(driver.restore("main")).rejects.toThrow(/rolled back/);
      // Should have tried: pg_dump(backup), dropdb, createdb, pg_restore(fail), dropdb(rollback), createdb(rollback), pg_restore(rollback)
      expect(callOrder).toEqual([
        "pg_dump",
        "dropdb",
        "createdb",
        "pg_restore",
        "dropdb",
        "createdb",
        "pg_restore",
      ]);
    });

    it("reports backup path when rollback also fails", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.dump");
      await fs.writeFile(snapshotPath, "dump data");

      let pgRestoreCount = 0;
      mockedExeca.mockImplementation(async (cmd: any, args: any) => {
        if (cmd === "pg_dump") {
          const fileArg = (args as string[]).find((a: string) => a.startsWith("--file="));
          if (fileArg) {
            await fs.writeFile(fileArg.replace("--file=", ""), "backup data");
          }
          return {} as any;
        }
        if (cmd === "pg_restore") {
          pgRestoreCount++;
          const err = new Error("restore failed");
          (err as any).stderr = "ERROR: something went wrong";
          throw err;
        }
        return {} as any;
      });

      await expect(driver.restore("main")).rejects.toThrow(/backup.*previous state/i);
    });

    it("handles password with special characters in env", async () => {
      const connWithSpecialPass: PostgresConnection = {
        ...defaultConnection,
        password: "p@ss$w0rd!#%&*",
      };
      const driver = new PostgresDriver(connWithSpecialPass, tmpDir);
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.dump");
      await fs.writeFile(snapshotPath, "dump data");

      mockedExeca.mockImplementation(async (cmd: any, args: any) => {
        if (cmd === "pg_dump") {
          const fileArg = (args as string[]).find((a: string) => a.startsWith("--file="));
          if (fileArg) {
            await fs.writeFile(fileArg.replace("--file=", ""), "backup data");
          }
        }
        return {} as any;
      });
      await driver.restore("main");

      // Verify PGPASSWORD is set correctly with special chars
      expect(mockedExeca).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ PGPASSWORD: "p@ss$w0rd!#%&*" }),
        }),
      );
    });
  });

  describe("validate", () => {
    it("checks pg_dump version and pg_isready", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      mockedExeca.mockResolvedValue({} as any);

      const result = await driver.validate();
      expect(result).toBe(true);
      expect(mockedExeca).toHaveBeenCalledWith("pg_dump", ["--version"]);
      expect(mockedExeca).toHaveBeenCalledWith(
        "pg_isready",
        expect.arrayContaining(["--host", "localhost"]),
        expect.any(Object),
      );
    });

    it("throws when pg_dump is not available", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      mockedExeca.mockRejectedValue(new Error("not found"));
      await expect(driver.validate()).rejects.toThrow(/pg_dump not found/);
    });
  });

  describe("hasSnapshot / deleteSnapshot", () => {
    it("returns false when no snapshot", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      expect(await driver.hasSnapshot("main")).toBe(false);
    });

    it("returns true when snapshot exists", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.dump");
      await fs.writeFile(snapshotPath, "data");
      expect(await driver.hasSnapshot("main")).toBe(true);
    });

    it("deletes a snapshot", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      const snapshotPath = path.join(tmpDir, ".dbranch", "snapshots", "main.dump");
      await fs.writeFile(snapshotPath, "data");
      await driver.deleteSnapshot("main");
      expect(await driver.hasSnapshot("main")).toBe(false);
    });
  });

  describe("listSnapshots", () => {
    it("lists .dump files", async () => {
      const driver = new PostgresDriver(defaultConnection, tmpDir);
      await fs.writeFile(
        path.join(tmpDir, ".dbranch", "snapshots", "main.dump"),
        "data1",
      );
      await fs.writeFile(
        path.join(tmpDir, ".dbranch", "snapshots", "feature-SLASH-auth.dump"),
        "data2",
      );

      const snapshots = await driver.listSnapshots();
      expect(snapshots).toHaveLength(2);
      const branches = snapshots.map((s) => s.branch).sort();
      expect(branches).toEqual(["feature/auth", "main"]);
    });
  });
});
