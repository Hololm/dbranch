import type { DatabaseDriver } from "./base.js";
import type { DbranchConfig, SqliteConnection, PostgresConnection } from "../config/config.js";
import { SqliteDriver } from "./sqlite.js";
import { DbranchError } from "../utils/errors.js";

export async function createDriver(
  config: DbranchConfig,
  repoRoot: string,
): Promise<DatabaseDriver> {
  switch (config.driver) {
    case "sqlite": {
      const conn = config.connection as SqliteConnection;
      return new SqliteDriver(conn.path, repoRoot);
    }
    case "postgres": {
      const { PostgresDriver } = await import("./postgres.js");
      const conn = config.connection as PostgresConnection;
      return new PostgresDriver(conn, repoRoot);
    }
    default:
      throw new DbranchError(
        `Unsupported database driver: "${config.driver}". Supported: sqlite, postgres.`,
      );
  }
}
