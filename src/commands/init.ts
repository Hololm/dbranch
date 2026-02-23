import fs from "node:fs/promises";
import path from "node:path";
import prompts from "prompts";
import {
  writeConfig,
  getDbranchDir,
  type DbranchConfig,
  type SqliteConnection,
  type PostgresConnection,
} from "../config/config.js";
import { createDriver } from "../drivers/index.js";
import { getRepoRoot, getCurrentBranch, isInsideGitRepo } from "../utils/git.js";
import { detectDatabase } from "../utils/detect.js";
import { installHook } from "../hooks/post-checkout.js";
import { logger } from "../utils/logger.js";
import { DbranchError } from "../utils/errors.js";

async function appendToGitignore(repoRoot: string): Promise<void> {
  const gitignorePath = path.join(repoRoot, ".gitignore");
  let content = "";
  try {
    content = await fs.readFile(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  if (!content.includes(".dbranch/")) {
    const newLine = content.endsWith("\n") || content === "" ? "" : "\n";
    await fs.writeFile(gitignorePath, content + newLine + ".dbranch/\n", "utf-8");
    logger.verbose("Added .dbranch/ to .gitignore");
  }
}

async function promptSqliteConnection(repoRoot: string): Promise<SqliteConnection> {
  const response = await prompts({
    type: "text",
    name: "path",
    message: "Path to SQLite database file:",
    initial: "./dev.db",
  });
  if (!response.path) throw new DbranchError("Setup cancelled.");
  return { path: response.path };
}

async function promptPostgresConnection(): Promise<PostgresConnection> {
  const response = await prompts([
    { type: "text", name: "host", message: "Postgres host:", initial: "localhost" },
    { type: "number", name: "port", message: "Postgres port:", initial: 5432 },
    { type: "text", name: "database", message: "Database name:", initial: "myapp_dev" },
    { type: "text", name: "user", message: "Postgres user:", initial: "postgres" },
    { type: "password", name: "password", message: "Postgres password:", initial: "" },
  ]);
  if (!response.host) throw new DbranchError("Setup cancelled.");
  return {
    host: response.host,
    port: response.port,
    database: response.database,
    user: response.user,
    password: response.password ?? "",
  };
}

export async function initCommand(): Promise<void> {
  if (!(await isInsideGitRepo())) {
    throw new DbranchError("Not a git repository. Initialize git first: `git init`");
  }

  const repoRoot = await getRepoRoot();
  const dbranchDir = getDbranchDir(repoRoot);

  // Check if already initialized
  try {
    await fs.access(path.join(dbranchDir, "config.yaml"));
    const { overwrite } = await prompts({
      type: "confirm",
      name: "overwrite",
      message: "dbranch is already initialized. Reinitialize?",
      initial: false,
    });
    if (!overwrite) {
      logger.info("Cancelled.");
      return;
    }
  } catch {
    // Not initialized yet — good
  }

  // Try auto-detection
  logger.info("Detecting database...");
  const detected = await detectDatabase(repoRoot);

  let driver: "sqlite" | "postgres";
  let connection: SqliteConnection | PostgresConnection;

  if (detected) {
    logger.info(`Detected: ${detected.driver}`);
    const { confirm } = await prompts({
      type: "confirm",
      name: "confirm",
      message: `Use detected ${detected.driver} database?`,
      initial: true,
    });

    if (confirm) {
      driver = detected.driver;
      connection = detected.connection as SqliteConnection | PostgresConnection;
    } else {
      const chosen = await promptDriverChoice();
      driver = chosen.driver;
      connection = chosen.connection;
    }
  } else {
    logger.info("Could not auto-detect database.");
    const chosen = await promptDriverChoice();
    driver = chosen.driver;
    connection = chosen.connection;
  }

  const config: DbranchConfig = {
    version: 1,
    driver,
    connection,
  };

  // Write config (creates .dbranch/ dirs)
  await writeConfig(repoRoot, config);
  logger.verbose("Wrote .dbranch/config.yaml");

  // Validate connection
  const driverInstance = await createDriver(config, repoRoot);
  const isValid = await driverInstance.validate();
  if (!isValid) {
    throw new DbranchError("Could not connect to database. Check that the server is running and your credentials are correct.");
  }
  logger.verbose("Database connection validated.");

  // Install git hook
  await installHook(repoRoot);
  logger.verbose("Installed post-checkout hook.");

  // Add to .gitignore
  await appendToGitignore(repoRoot);

  // Take initial snapshot
  const currentBranch = await getCurrentBranch();
  if (currentBranch && isValid) {
    try {
      await driverInstance.snapshot(currentBranch);
      logger.verbose(`Initial snapshot taken for "${currentBranch}".`);
    } catch (err) {
      logger.warn(`Could not take initial snapshot: ${(err as Error).message}`);
    }
  }

  logger.success("dbranch initialized!");
  logger.info("Database snapshots will now auto-switch when you change git branches.");
}

async function promptDriverChoice(): Promise<{
  driver: "sqlite" | "postgres";
  connection: SqliteConnection | PostgresConnection;
}> {
  const { driverChoice } = await prompts({
    type: "select",
    name: "driverChoice",
    message: "Select database type:",
    choices: [
      { title: "SQLite", value: "sqlite" },
      { title: "PostgreSQL", value: "postgres" },
    ],
  });

  if (!driverChoice) throw new DbranchError("Setup cancelled.");

  if (driverChoice === "sqlite") {
    const connection = await promptSqliteConnection(
      await getRepoRoot(),
    );
    return { driver: "sqlite", connection };
  } else {
    const connection = await promptPostgresConnection();
    return { driver: "postgres", connection };
  }
}
