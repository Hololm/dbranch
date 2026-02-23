import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { withLock } from "../../src/utils/lock.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-lock-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("withLock", () => {
  it("executes the function and returns its result", async () => {
    const result = await withLock(tmpDir, async () => "hello");
    expect(result).toBe("hello");
  });

  it("removes the lock file after successful execution", async () => {
    await withLock(tmpDir, async () => {});
    const lockPath = path.join(tmpDir, ".lock");
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it("removes the lock file after failed execution", async () => {
    await expect(
      withLock(tmpDir, async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    const lockPath = path.join(tmpDir, ".lock");
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it("prevents concurrent operations", async () => {
    const order: string[] = [];
    const p1 = withLock(tmpDir, async () => {
      order.push("start-1");
      await new Promise((r) => setTimeout(r, 50));
      order.push("end-1");
    });

    // Small delay to ensure p1 acquires lock first
    await new Promise((r) => setTimeout(r, 10));

    const p2 = withLock(tmpDir, async () => {
      order.push("start-2");
    });

    // p2 should fail because p1 holds the lock
    await expect(p2).rejects.toThrow(/Another dbranch operation/);
    await p1;
    expect(order).toContain("start-1");
    expect(order).toContain("end-1");
  });

  it("recovers from stale lock with dead PID", async () => {
    const lockPath = path.join(tmpDir, ".lock");
    // Write a lock with a PID that doesn't exist
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: 999999, timestamp: Date.now() }),
    );

    const result = await withLock(tmpDir, async () => "recovered");
    expect(result).toBe("recovered");
  });

  it("recovers from corrupted/malformed lock file", async () => {
    const lockPath = path.join(tmpDir, ".lock");
    // Write garbage that won't parse as JSON
    await fs.writeFile(lockPath, "not valid json {{{");

    const result = await withLock(tmpDir, async () => "recovered");
    expect(result).toBe("recovered");
  });

  it("recovers from empty lock file", async () => {
    const lockPath = path.join(tmpDir, ".lock");
    await fs.writeFile(lockPath, "");

    const result = await withLock(tmpDir, async () => "recovered");
    expect(result).toBe("recovered");
  });
});
