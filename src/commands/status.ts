import { readConfig } from "../config/config.js";
import { createDriver } from "../drivers/index.js";
import { getRepoRoot, getCurrentBranch } from "../utils/git.js";
import { logger } from "../utils/logger.js";

export async function statusCommand(): Promise<void> {
  const repoRoot = await getRepoRoot();
  const config = await readConfig(repoRoot);
  const driver = await createDriver(config, repoRoot);
  const currentBranch = await getCurrentBranch();

  logger.info(`Driver:  ${config.driver}`);
  if (config.driver === "sqlite") {
    logger.info(
      `Database: ${(config.connection as { path: string }).path}`,
    );
  } else {
    const conn = config.connection as { host: string; port: number; database: string };
    logger.info(`Database: ${conn.database} @ ${conn.host}:${conn.port}`);
  }

  if (currentBranch) {
    const hasSnap = await driver.hasSnapshot(currentBranch);
    logger.info(`Branch:  ${currentBranch}`);
    logger.info(`Snapshot: ${hasSnap ? "yes" : "none"}`);
  } else {
    logger.info("Branch:  (detached HEAD)");
  }

  const snapshots = await driver.listSnapshots();
  logger.info(`Total snapshots: ${snapshots.length}`);
}
