import { readConfig } from "../config/config.js";
import { getDbranchDir } from "../config/config.js";
import { createDriver } from "../drivers/index.js";
import { getRepoRoot, getCurrentBranch } from "../utils/git.js";
import { withLock } from "../utils/lock.js";
import { logger } from "../utils/logger.js";
import { DbranchError } from "../utils/errors.js";

export async function snapshotCommand(name?: string): Promise<void> {
  const repoRoot = await getRepoRoot();
  const config = await readConfig(repoRoot);
  const driver = await createDriver(config, repoRoot);
  const dbranchDir = getDbranchDir(repoRoot);

  const branchName = name ?? (await getCurrentBranch());
  if (!branchName) {
    throw new DbranchError(
      "Cannot determine branch name (detached HEAD). Provide a name: `dbranch snapshot <name>`",
    );
  }

  await withLock(dbranchDir, async () => {
    const spinner = logger.spin(`Snapshotting "${branchName}"...`);
    try {
      await driver.snapshot(branchName);
      spinner.succeed(`Snapshot saved for "${branchName}"`);
    } catch (err) {
      spinner.fail(`Failed to snapshot "${branchName}"`);
      throw err;
    }
  });
}
