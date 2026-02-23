import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execa } from "execa";

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

export interface DetectedDatabase {
  driver: "sqlite" | "postgres";
  connection: {
    path?: string;
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
  };
}

async function findSqliteFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(repoRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (
      entry.name.endsWith(".db") ||
      entry.name.endsWith(".sqlite") ||
      entry.name.endsWith(".sqlite3")
    ) {
      results.push(path.join(repoRoot, entry.name));
    }
  }
  return results;
}

async function detectPostgresFromEnv(repoRoot: string): Promise<DetectedDatabase | null> {
  const envPath = path.join(repoRoot, ".env");
  try {
    const content = await fs.readFile(envPath, "utf-8");
    const urlMatch = content.match(
      /DATABASE_URL\s*=\s*["']?postgres(?:ql)?:\/\/([^:]+):([^@]*)@([^:]+):(\d+)\/([^\s"']+)/,
    );
    if (urlMatch) {
      return {
        driver: "postgres",
        connection: {
          user: urlMatch[1],
          password: urlMatch[2],
          host: urlMatch[3],
          port: parseInt(urlMatch[4], 10),
          database: urlMatch[5],
        },
      };
    }
  } catch {
    // No .env file
  }
  return null;
}

async function isPgDumpAvailable(): Promise<boolean> {
  try {
    await execa(resolvePgCommand("pg_dump"), ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function detectDatabase(repoRoot: string): Promise<DetectedDatabase | null> {
  // Check for SQLite files first (simplest)
  const sqliteFiles = await findSqliteFiles(repoRoot);
  if (sqliteFiles.length > 0) {
    return {
      driver: "sqlite",
      connection: { path: path.relative(repoRoot, sqliteFiles[0]) },
    };
  }

  // Check for Postgres connection in .env
  const pgFromEnv = await detectPostgresFromEnv(repoRoot);
  if (pgFromEnv && (await isPgDumpAvailable())) {
    return pgFromEnv;
  }

  return null;
}
