import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock execa so we don't need real pg_dump
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { detectDatabase } from "../../src/utils/detect.js";

const mockedExeca = vi.mocked(execa);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-detect-test-"));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("detectDatabase", () => {
  describe("SQLite detection", () => {
    it("finds .db files", async () => {
      await fs.writeFile(path.join(tmpDir, "dev.db"), "data");
      const result = await detectDatabase(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.driver).toBe("sqlite");
      expect(result!.connection.path).toBe("dev.db");
    });

    it("finds .sqlite files", async () => {
      await fs.writeFile(path.join(tmpDir, "app.sqlite"), "data");
      const result = await detectDatabase(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.driver).toBe("sqlite");
      expect(result!.connection.path).toBe("app.sqlite");
    });

    it("finds .sqlite3 files", async () => {
      await fs.writeFile(path.join(tmpDir, "app.sqlite3"), "data");
      const result = await detectDatabase(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.driver).toBe("sqlite");
      expect(result!.connection.path).toBe("app.sqlite3");
    });

    it("ignores directories with db-like names", async () => {
      await fs.mkdir(path.join(tmpDir, "data.db"));
      const result = await detectDatabase(tmpDir);
      expect(result).toBeNull();
    });

    it("returns empty when no matching files", async () => {
      await fs.writeFile(path.join(tmpDir, "readme.txt"), "hello");
      const result = await detectDatabase(tmpDir);
      expect(result).toBeNull();
    });
  });

  describe("Postgres detection from .env", () => {
    it("parses DATABASE_URL with postgres:// scheme", async () => {
      await fs.writeFile(
        path.join(tmpDir, ".env"),
        'DATABASE_URL=postgres://myuser:mypass@localhost:5432/mydb\n',
      );
      mockedExeca.mockResolvedValue({} as any);

      const result = await detectDatabase(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.driver).toBe("postgres");
      expect(result!.connection.user).toBe("myuser");
      expect(result!.connection.password).toBe("mypass");
      expect(result!.connection.host).toBe("localhost");
      expect(result!.connection.port).toBe(5432);
      expect(result!.connection.database).toBe("mydb");
    });

    it("parses DATABASE_URL with postgresql:// scheme", async () => {
      await fs.writeFile(
        path.join(tmpDir, ".env"),
        'DATABASE_URL=postgresql://user:pass@db.host:5433/appdb\n',
      );
      mockedExeca.mockResolvedValue({} as any);

      const result = await detectDatabase(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.driver).toBe("postgres");
      expect(result!.connection.host).toBe("db.host");
      expect(result!.connection.port).toBe(5433);
      expect(result!.connection.database).toBe("appdb");
    });

    it("returns null when .env is missing", async () => {
      const result = await detectDatabase(tmpDir);
      expect(result).toBeNull();
    });

    it("returns null when .env has no DATABASE_URL", async () => {
      await fs.writeFile(path.join(tmpDir, ".env"), "NODE_ENV=development\n");
      const result = await detectDatabase(tmpDir);
      expect(result).toBeNull();
    });

    it("returns null when pg_dump is not available", async () => {
      await fs.writeFile(
        path.join(tmpDir, ".env"),
        'DATABASE_URL=postgres://user:pass@localhost:5432/db\n',
      );
      mockedExeca.mockRejectedValue(new Error("not found"));

      const result = await detectDatabase(tmpDir);
      expect(result).toBeNull();
    });
  });

  describe("priority", () => {
    it("prefers SQLite over Postgres when both present", async () => {
      await fs.writeFile(path.join(tmpDir, "dev.db"), "data");
      await fs.writeFile(
        path.join(tmpDir, ".env"),
        'DATABASE_URL=postgres://user:pass@localhost:5432/db\n',
      );
      mockedExeca.mockResolvedValue({} as any);

      const result = await detectDatabase(tmpDir);
      expect(result).not.toBeNull();
      expect(result!.driver).toBe("sqlite");
    });
  });
});
