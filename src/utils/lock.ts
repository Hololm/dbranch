import fs from "node:fs/promises";
import path from "node:path";
import { DbranchError } from "./errors.js";

const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

interface LockInfo {
  pid: number;
  timestamp: number;
}

function getLockPath(dbranchDir: string): string {
  return path.join(dbranchDir, ".lock");
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isLockStale(lockPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(lockPath, "utf-8");
    const info: LockInfo = JSON.parse(content);
    const age = Date.now() - info.timestamp;
    if (age > LOCK_STALE_MS) return true;
    if (!isProcessRunning(info.pid)) return true;
    return false;
  } catch {
    return true;
  }
}

async function acquireLock(dbranchDir: string, attempt: number = 0): Promise<void> {
  if (attempt >= MAX_RETRIES) {
    throw new DbranchError(
      "Failed to acquire lock after multiple retries. Delete .dbranch/.lock if the problem persists.",
    );
  }

  const lockPath = getLockPath(dbranchDir);
  const lockData: LockInfo = { pid: process.pid, timestamp: Date.now() };

  try {
    const fd = await fs.open(lockPath, "wx");
    await fd.writeFile(JSON.stringify(lockData));
    await fd.close();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      if (await isLockStale(lockPath)) {
        await fs.unlink(lockPath);
        return acquireLock(dbranchDir, attempt + 1);
      }
      throw new DbranchError(
        "Another dbranch operation is in progress. If this is an error, delete .dbranch/.lock",
      );
    }
    throw err;
  }
}

async function releaseLock(dbranchDir: string): Promise<void> {
  const lockPath = getLockPath(dbranchDir);
  try {
    await fs.unlink(lockPath);
  } catch {
    // Lock already removed — not a problem
  }
}

export async function withLock<T>(dbranchDir: string, fn: () => Promise<T>): Promise<T> {
  await acquireLock(dbranchDir);
  try {
    return await fn();
  } finally {
    await releaseLock(dbranchDir);
  }
}
