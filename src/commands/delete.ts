import { readConfig, getDbranchDir } from "../config/config.js";
import { createDriver } from "../drivers/index.js";
import { getRepoRoot } from "../utils/git.js";
import { withLock } from "../utils/lock.js";
import { logger } from "../utils/logger.js";
import { DbranchError } from "../utils/errors.js";

export async function deleteCommand(branch: string): Promise<void> {
  const repoRoot = await getRepoRoot();
  const config = await readConfig(repoRoot);
  const driver = await createDriver(config, repoRoot);
  const dbranchDir = getDbranchDir(repoRoot);

  await withLock(dbranchDir, async () => {
    const hasSnap = await driver.hasSnapshot(branch);
    if (!hasSnap) {
      throw new DbranchError(`No snapshot found for branch "${branch}".`);
    }
    await driver.deleteSnapshot(branch);
    logger.success(`Deleted snapshot for "${branch}"`);
  });
}
