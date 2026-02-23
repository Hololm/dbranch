import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { DatabaseDriver, SnapshotInfo } from "./base.js";
import type { PostgresConnection } from "../config/config.js";
import { getSnapshotsDir } from "../config/config.js";
import { sanitizeBranchName, desanitizeBranchName } from "../utils/git.js";
import { DbranchError } from "../utils/errors.js";

const EXTENSION = ".dump";

function findWindowsPgBinDir(): string | null {
  const searchDirs = [
    "C:\\Program Files\\PostgreSQL",
    "C:\\Program Files (x86)\\PostgreSQL",
  ];
  for (const dir of searchDirs) {
    try {
      const versions = fsSync.readdirSync(dir).sort().reverse();
      for (const version of versions) {
        const bin = path.join(dir, version, "bin", "pg_dump.exe");
        if (fsSync.existsSync(bin)) {
          return path.join(dir, version, "bin");
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }
  return null;
}

function resolvePgCommand(command: string): string {
  if (process.platform !== "win32") return command;
  const pgBin = findWindowsPgBinDir();
  if (pgBin) return path.join(pgBin, command + ".exe");
  return command;
}

export class PostgresDriver implements DatabaseDriver {
  private connection: PostgresConnection;
  private snapshotsDir: string;

  constructor(connection: PostgresConnection, repoRoot: string) {
    this.connection = connection;
    this.snapshotsDir = getSnapshotsDir(repoRoot);
  }

  private getSnapshotPath(branchName: string): string {
    return path.join(this.snapshotsDir, sanitizeBranchName(branchName) + EXTENSION);
  }

  private getEnv(): Record<string, string> {
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (this.connection.password) {
      env.PGPASSWORD = this.connection.password;
    }
    return env;
  }

  private getConnectionArgs(): string[] {
    return [
      "--host",
      this.connection.host,
      "--port",
      String(this.connection.port),
      "--username",
      this.connection.user,
    ];
  }

  async snapshot(branchName: string): Promise<void> {
    await fs.mkdir(this.snapshotsDir, { recursive: true });
    const snapshotPath = this.getSnapshotPath(branchName);
    const tmpPath = snapshotPath + ".tmp";

    try {
      await execa(
        resolvePgCommand("pg_dump"),
        [
          "--format=custom",
          `--file=${tmpPath}`,
          ...this.getConnectionArgs(),
          this.connection.database,
        ],
        { env: this.getEnv() },
      );
      await fs.rename(tmpPath, snapshotPath);
    } catch (err) {
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore
      }
      throw new DbranchError(
        `Failed to snapshot Postgres database "${this.connection.database}": ${(err as Error).message}`,
        { cause: err as Error },
      );
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

    const env = this.getEnv();
    const connArgs = this.getConnectionArgs();

    // Create a safety backup before destructive operations
    const backupPath = path.join(this.snapshotsDir, `_pre_restore_backup${EXTENSION}`);
    try {
      await execa(
        resolvePgCommand("pg_dump"),
        [
          "--format=custom",
          `--file=${backupPath}`,
          ...connArgs,
          this.connection.database,
        ],
        { env },
      );
    } catch {
      // If backup fails (e.g. DB doesn't exist yet), proceed without it
    }

    // Drop and recreate database
    try {
      await execa(resolvePgCommand("dropdb"), ["--if-exists", ...connArgs, this.connection.database], { env });
    } catch (err) {
      throw new DbranchError(
        `Failed to drop database "${this.connection.database}". Make sure no applications are connected to it.\n${(err as Error).message}`,
        { cause: err as Error },
      );
    }

    try {
      await execa(resolvePgCommand("createdb"), [...connArgs, this.connection.database], { env });
    } catch (err) {
      throw new DbranchError(
        `Failed to create database "${this.connection.database}": ${(err as Error).message}`,
        { cause: err as Error },
      );
    }

    try {
      await execa(
        resolvePgCommand("pg_restore"),
        [
          `--dbname=${this.connection.database}`,
          ...connArgs,
          "--no-owner",
          "--no-privileges",
          snapshotPath,
        ],
        { env },
      );
      // Restore succeeded, clean up backup
      try {
        await fs.unlink(backupPath);
      } catch {
        // Ignore — backup may not exist
      }
    } catch (err) {
      // pg_restore returns non-zero on warnings too, check if it's a real error
      const stderr = (err as { stderr?: string }).stderr ?? "";
      if (stderr.includes("ERROR")) {
        // Attempt to recover from backup
        try {
          await execa(resolvePgCommand("dropdb"), ["--if-exists", ...connArgs, this.connection.database], { env });
          await execa(resolvePgCommand("createdb"), [...connArgs, this.connection.database], { env });
          await execa(
            "pg_restore",
            [
              `--dbname=${this.connection.database}`,
              ...connArgs,
              "--no-owner",
              "--no-privileges",
              backupPath,
            ],
            { env },
          );
          await fs.unlink(backupPath);
          throw new DbranchError(
            `Failed to restore branch "${branchName}" — database has been rolled back to its previous state.`,
            { cause: err as Error },
          );
        } catch (rollbackErr) {
          if (rollbackErr instanceof DbranchError) throw rollbackErr;
          throw new DbranchError(
            `Failed to restore branch "${branchName}" and rollback also failed. A backup of your previous state is at: ${backupPath}`,
            { cause: err as Error },
          );
        }
      }
      // Warnings are OK — pg_restore often warns about existing extensions etc.
      try {
        await fs.unlink(backupPath);
      } catch {
        // Ignore
      }
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
  }

  async validate(): Promise<boolean> {
    try {
      await execa(resolvePgCommand("pg_dump"), ["--version"]);
    } catch {
      throw new DbranchError(
        "pg_dump not found. Install PostgreSQL client tools (e.g., `brew install postgresql` or `apt install postgresql-client`).",
      );
    }

    // Verify the server is reachable
    try {
      await execa(resolvePgCommand("pg_isready"), [...this.getConnectionArgs()], {
        env: this.getEnv(),
      });
    } catch {
      return false;
    }

    // Verify credentials by running a simple query via pg_dump
    try {
      await execa(
        resolvePgCommand("pg_dump"),
        [...this.getConnectionArgs(), "--schema-only", "-t", "pg_catalog.pg_class", this.connection.database],
        { env: this.getEnv() },
      );
      return true;
    } catch {
      throw new DbranchError(
        `Could not connect to database "${this.connection.database}". Check your credentials and make sure the database exists.`,
      );
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
