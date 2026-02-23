import { readConfig } from "../config/config.js";
import { createDriver } from "../drivers/index.js";
import { getRepoRoot, getCurrentBranch } from "../utils/git.js";
import { logger } from "../utils/logger.js";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export async function listCommand(): Promise<void> {
  const repoRoot = await getRepoRoot();
  const config = await readConfig(repoRoot);
  const driver = await createDriver(config, repoRoot);
  const currentBranch = await getCurrentBranch();

  const snapshots = await driver.listSnapshots();
  if (snapshots.length === 0) {
    logger.info("No snapshots found.");
    return;
  }

  logger.info(`Snapshots (${snapshots.length}):\n`);
  for (const snap of snapshots) {
    const marker = snap.branch === currentBranch ? " *" : "";
    const date = snap.createdAt.toLocaleString();
    logger.info(`  ${snap.branch}${marker}  ${formatSize(snap.size)}  ${date}`);
  }
}
