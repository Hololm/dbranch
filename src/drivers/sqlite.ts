import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { DatabaseDriver, SnapshotInfo } from "./base.js";
import { getSnapshotsDir } from "../config/config.js";
import { sanitizeBranchName, desanitizeBranchName } from "../utils/git.js";
import { DbranchError } from "../utils/errors.js";

const SQLITE_MAGIC = "SQLite format 3\0";
const EXTENSION = ".sqlite3";

export class SqliteDriver implements DatabaseDriver {
  private dbPath: string;
  private snapshotsDir: string;

  constructor(dbPath: string, repoRoot: string) {
    this.dbPath = path.resolve(repoRoot, dbPath);
    this.snapshotsDir = getSnapshotsDir(repoRoot);
  }

  private getSnapshotPath(branchName: string): string {
    return path.join(this.snapshotsDir, sanitizeBranchName(branchName) + EXTENSION);
  }

  async snapshot(branchName: string): Promise<void> {
    await fs.mkdir(this.snapshotsDir, { recursive: true });

    try {
      await fs.access(this.dbPath);
    } catch {
      throw new DbranchError(`SQLite database not found at ${this.dbPath}`);
    }

    const snapshotPath = this.getSnapshotPath(branchName);
    const tmpPath = snapshotPath + ".tmp";

    try {
      await fs.copyFile(this.dbPath, tmpPath);
      await fs.rename(tmpPath, snapshotPath);

      // Copy WAL and SHM sidecar files if they exist
      for (const suffix of ["-wal", "-shm"]) {
        const sidecar = this.dbPath + suffix;
        const sidecarSnapshot = snapshotPath + suffix;
        try {
          await fs.access(sidecar);
          await fs.copyFile(sidecar, sidecarSnapshot);
        } catch {
          // Sidecar doesn't exist, remove stale one if present
          try {
            await fs.unlink(sidecarSnapshot);
          } catch {
            // Doesn't exist either — fine
          }
        }
      }
    } catch (err) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore
      }
      if (err instanceof DbranchError) throw err;
      throw new DbranchError(`Failed to snapshot SQLite database: ${(err as Error).message}`, {
        cause: err as Error,
      });
    }
  }

  async restore(branchName: string): Promise<void> {
    const snapshotPath = this.getSnapshotPath(branchName);

    try {
      await fs.access(snapshotPath);
    } catch {
      throw new DbranchError(
        `No snapshot found for branch "${branchName}". Run \`dbranch snapshot\` first.`,
      );
    }

    const tmpPath = this.dbPath + ".tmp";

    try {
      await fs.copyFile(snapshotPath, tmpPath);
      await fs.rename(tmpPath, this.dbPath);

      // Restore WAL and SHM sidecar files
      for (const suffix of ["-wal", "-shm"]) {
        const sidecarSnapshot = snapshotPath + suffix;
        const sidecar = this.dbPath + suffix;
        try {
          await fs.access(sidecarSnapshot);
          await fs.copyFile(sidecarSnapshot, sidecar);
        } catch {
          // No sidecar in snapshot, remove existing one
          try {
            await fs.unlink(sidecar);
          } catch {
            // Doesn't exist either — fine
          }
        }
      }
    } catch (err) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore
      }
      if (err instanceof DbranchError) throw err;
      throw new DbranchError(`Failed to restore SQLite database: ${(err as Error).message}`, {
        cause: err as Error,
      });
    }
  }

  async hasSnapshot(branchName: string): Promise<boolean> {
    try {
      await fs.access(this.getSnapshotPath(branchName));
      return true;
    } catch {
      return false;
    }
  }

  async deleteSnapshot(branchName: string): Promise<void> {
    const snapshotPath = this.getSnapshotPath(branchName);
    try {
      await fs.unlink(snapshotPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new DbranchError(`Failed to delete snapshot for "${branchName}".`);
      }
    }
    // Clean up sidecars
    for (const suffix of ["-wal", "-shm"]) {
      try {
        await fs.unlink(snapshotPath + suffix);
      } catch {
        // Ignore
      }
    }
  }

  async validate(): Promise<boolean> {
    try {
      const fd = await fs.open(this.dbPath, "r");
      const buf = Buffer.alloc(16);
      await fd.read(buf, 0, 16, 0);
      await fd.close();
      return buf.toString("utf-8") === SQLITE_MAGIC;
    } catch {
      return false;
    }
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    try {
      const entries = await fs.readdir(this.snapshotsDir);
      const snapshots: SnapshotInfo[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(EXTENSION)) continue;
        const filePath = path.join(this.snapshotsDir, entry);
        const stat = await fs.stat(filePath);
        const baseName = entry.slice(0, -EXTENSION.length);
        snapshots.push({
          branch: desanitizeBranchName(baseName),
          fileName: entry,
          size: stat.size,
          createdAt: stat.mtime,
        });
      }
      return snapshots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch {
      return [];
    }
  }
}
