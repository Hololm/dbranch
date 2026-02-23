import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { DbranchError } from "../utils/errors.js";

export interface SqliteConnection {
  path: string;
}

export interface PostgresConnection {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface DbranchConfig {
  version: 1;
  driver: "sqlite" | "postgres";
  connection: SqliteConnection | PostgresConnection;
}

export function getDbranchDir(repoRoot: string): string {
  return path.join(repoRoot, ".dbranch");
}

export function getSnapshotsDir(repoRoot: string): string {
  return path.join(repoRoot, ".dbranch", "snapshots");
}

export function getConfigPath(repoRoot: string): string {
  return path.join(repoRoot, ".dbranch", "config.yaml");
}

export async function readConfig(repoRoot: string): Promise<DbranchConfig> {
  const configPath = getConfigPath(repoRoot);
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const config = parse(content) as DbranchConfig;
    if (!config || !config.driver) {
      throw new DbranchError(
        "Invalid config file: missing `driver` field. Run `dbranch init` to reinitialize.",
      );
    }
    if (!config.connection) {
      throw new DbranchError(
        "Invalid config file: missing `connection` field. Run `dbranch init` to reinitialize.",
      );
    }
    if (config.driver === "sqlite") {
      const conn = config.connection as SqliteConnection;
      if (!conn.path) {
        throw new DbranchError(
          "Invalid config file: SQLite connection requires a `path` field. Run `dbranch init` to reinitialize.",
        );
      }
    } else if (config.driver === "postgres") {
      const conn = config.connection as PostgresConnection;
      if (!conn.host || !conn.database || !conn.user) {
        throw new DbranchError(
          "Invalid config file: Postgres connection requires `host`, `database`, and `user` fields. Run `dbranch init` to reinitialize.",
        );
      }
    }
    return config;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DbranchError(
        "No .dbranch/config.yaml found. Run `dbranch init` first.",
      );
    }
    if (err instanceof DbranchError) throw err;
    throw new DbranchError("Failed to read config file. Run `dbranch init` to reinitialize.", {
      cause: err as Error,
    });
  }
}

export async function writeConfig(repoRoot: string, config: DbranchConfig): Promise<void> {
  const dbranchDir = getDbranchDir(repoRoot);
  const snapshotsDir = getSnapshotsDir(repoRoot);
  const configPath = getConfigPath(repoRoot);

  await fs.mkdir(dbranchDir, { recursive: true });
  await fs.mkdir(snapshotsDir, { recursive: true });
  await fs.writeFile(configPath, stringify(config), "utf-8");
}
