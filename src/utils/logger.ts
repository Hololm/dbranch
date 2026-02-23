import chalk from "chalk";
import ora, { type Ora } from "ora";

let verboseMode = false;
let silentMode = false;

export function setVerbose(v: boolean): void {
  verboseMode = v;
}

export function setSilent(s: boolean): void {
  silentMode = s;
}

export const logger = {
  info(message: string): void {
    if (!silentMode) {
      console.log(message);
    }
  },

  success(message: string): void {
    if (!silentMode) {
      console.log(chalk.green(`✓ ${message}`));
    }
  },

  warn(message: string): void {
    if (!silentMode) {
      console.warn(chalk.yellow(`⚠ ${message}`));
    }
  },

  error(message: string): void {
    console.error(chalk.red(`✗ ${message}`));
  },

  verbose(message: string): void {
    if (verboseMode && !silentMode) {
      console.log(chalk.dim(message));
    }
  },

  spin(message: string): Ora {
    return ora({ text: message, isSilent: silentMode }).start();
  },
};
