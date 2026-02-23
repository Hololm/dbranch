import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { snapshotCommand } from "./commands/snapshot.js";
import { switchCommand } from "./commands/switch.js";
import { listCommand } from "./commands/list.js";
import { statusCommand } from "./commands/status.js";
import { deleteCommand } from "./commands/delete.js";
import { DbranchError } from "./utils/errors.js";
import { logger, setVerbose } from "./utils/logger.js";

const program = new Command();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapCommand(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof DbranchError) {
        logger.error(err.userMessage);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Unexpected error: ${message}`);
        logger.error("Run with --verbose for more details.");
      }
      process.exit(1);
    }
  };
}

program
  .name("dbranch")
  .description("Git-style branching for local development databases")
  .version("0.1.0")
  .option("--verbose", "Enable verbose output")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) {
      setVerbose(true);
    }
  });

program
  .command("init")
  .description("Initialize dbranch in the current git repository")
  .action(wrapCommand(initCommand));

program
  .command("snapshot [name]")
  .description("Snapshot current database state (defaults to current branch name)")
  .action(wrapCommand(async (name: string | undefined) => {
    await snapshotCommand(name);
  }));

program
  .command("switch")
  .description("Switch database state between branches (used by git hook)")
  .requiredOption("--from <branch>", "Source branch")
  .requiredOption("--to <branch>", "Target branch")
  .action(wrapCommand(async (opts: { from: string; to: string }) => {
    await switchCommand(opts.from, opts.to);
  }));

program
  .command("list")
  .description("List all stored snapshots")
  .action(wrapCommand(listCommand));

program
  .command("status")
  .description("Show current dbranch status")
  .action(wrapCommand(statusCommand));

program
  .command("delete <branch>")
  .description("Delete a snapshot for a branch")
  .action(wrapCommand(async (branch: string) => {
    await deleteCommand(branch);
  }));

program.parse();
