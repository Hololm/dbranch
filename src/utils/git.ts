import { execa } from "execa";
import { DbranchError } from "./errors.js";

export async function getRepoRoot(): Promise<string> {
  try {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"]);
    return stdout.trim();
  } catch {
    throw new DbranchError("Not a git repository. Run this command from inside a git repo.");
  }
}

export async function getCurrentBranch(): Promise<string | null> {
  try {
    const { stdout } = await execa("git", ["symbolic-ref", "--short", "HEAD"]);
    return stdout.trim();
  } catch {
    // Detached HEAD state
    return null;
  }
}

export async function isInsideGitRepo(): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeBranchName(branch: string): string {
  return branch.replace(/\//g, "-SLASH-");
}

export function desanitizeBranchName(sanitized: string): string {
  return sanitized.replace(/-SLASH-/g, "/");
}
