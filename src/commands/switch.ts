import { readConfig, getDbranchDir } from "../config/config.js";
import { createDriver } from "../drivers/index.js";
import { getRepoRoot, getCurrentBranch } from "../utils/git.js";
import { withLock } from "../utils/lock.js";
import { logger } from "../utils/logger.js";

export async function switchCommand(from: string, to: string): Promise<void> {
  // Detect detached HEAD — skip silently
  const currentBranch = await getCurrentBranch();
  if (currentBranch === null) {
    logger.verbose("dbranch: skipping in detached HEAD state");
    return;
  }

  const repoRoot = await getRepoRoot();
  const config = await readConfig(repoRoot);
  const driver = await createDriver(config, repoRoot);
  const dbranchDir = getDbranchDir(repoRoot);

  await withLock(dbranchDir, async () => {
    // Always snapshot current state first (non-destructive principle)
    logger.verbose(`Snapshotting "${from}" before switch...`);
    try {
      await driver.snapshot(from);
    } catch (err) {
      logger.warn(`Could not snapshot "${from}": ${(err as Error).message}`);
    }

    // Check if target branch has a snapshot
    const hasTarget = await driver.hasSnapshot(to);
    if (hasTarget) {
      logger.verbose(`Restoring snapshot for "${to}"...`);
      await driver.restore(to);
      logger.success(`Switched database to branch "${to}"`);
    } else {
      // New branch — keep DB as-is, take initial snapshot
      logger.verbose(`No snapshot for "${to}", taking initial snapshot...`);
      try {
        await driver.snapshot(to);
      } catch {
        // If we can't snapshot (e.g. no DB yet), that's OK for a new branch
      }
      logger.success(`Database snapshot created for new branch "${to}"`);
    }
  });
}
