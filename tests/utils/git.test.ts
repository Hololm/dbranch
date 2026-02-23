import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import {
  sanitizeBranchName,
  desanitizeBranchName,
  getRepoRoot,
  getCurrentBranch,
  isInsideGitRepo,
} from "../../src/utils/git.js";

describe("sanitizeBranchName", () => {
  it("replaces slashes with -SLASH-", () => {
    expect(sanitizeBranchName("feature/auth")).toBe("feature-SLASH-auth");
  });

  it("handles multiple slashes", () => {
    expect(sanitizeBranchName("feature/auth/login")).toBe("feature-SLASH-auth-SLASH-login");
  });

  it("leaves simple names unchanged", () => {
    expect(sanitizeBranchName("main")).toBe("main");
  });

  it("handles branch names with dashes", () => {
    expect(sanitizeBranchName("feature/my-branch")).toBe("feature-SLASH-my-branch");
  });

  it("leaves branch names with double underscores unchanged", () => {
    expect(sanitizeBranchName("my__branch")).toBe("my__branch");
  });
});

describe("desanitizeBranchName", () => {
  it("replaces -SLASH- with slashes", () => {
    expect(desanitizeBranchName("feature-SLASH-auth")).toBe("feature/auth");
  });

  it("handles multiple -SLASH-", () => {
    expect(desanitizeBranchName("feature-SLASH-auth-SLASH-login")).toBe("feature/auth/login");
  });

  it("leaves simple names unchanged", () => {
    expect(desanitizeBranchName("main")).toBe("main");
  });

  it("leaves double underscores unchanged", () => {
    expect(desanitizeBranchName("my__branch")).toBe("my__branch");
  });

  it("round-trips correctly for slashed branches", () => {
    const original = "feature/auth/v2";
    expect(desanitizeBranchName(sanitizeBranchName(original))).toBe(original);
  });

  it("round-trips correctly for branch names with double underscores", () => {
    const original = "my__branch";
    expect(desanitizeBranchName(sanitizeBranchName(original))).toBe(original);
  });

  it("round-trips correctly for branch names with dots", () => {
    const original = "release/v1.2.3";
    expect(desanitizeBranchName(sanitizeBranchName(original))).toBe(original);
  });

  it("round-trips correctly for branch names with dashes", () => {
    const original = "feature/my-cool-feature";
    expect(desanitizeBranchName(sanitizeBranchName(original))).toBe(original);
  });
});

describe("git utilities (real git repo)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-git-test-"));
    await execa("git", ["init", "-b", "main"], { cwd: tmpDir });
    await execa("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    await execa("git", ["config", "user.name", "Test"], { cwd: tmpDir });
    // Need at least one commit for getCurrentBranch to work
    await fs.writeFile(path.join(tmpDir, "file.txt"), "hello");
    await execa("git", ["add", "."], { cwd: tmpDir });
    await execa("git", ["commit", "-m", "initial"], { cwd: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("getRepoRoot", () => {
    it("returns the repo root path", async () => {
      const cwd = process.cwd();
      try {
        process.chdir(tmpDir);
        const root = await getRepoRoot();
        // Normalize both paths for comparison (resolve symlinks on macOS /tmp → /private/tmp)
        const realRoot = await fs.realpath(root);
        const realTmp = await fs.realpath(tmpDir);
        expect(realRoot).toBe(realTmp);
      } finally {
        process.chdir(cwd);
      }
    });
  });

  describe("getCurrentBranch", () => {
    it("returns the current branch name", async () => {
      const cwd = process.cwd();
      try {
        process.chdir(tmpDir);
        const branch = await getCurrentBranch();
        expect(branch).toBe("main");
      } finally {
        process.chdir(cwd);
      }
    });

    it("returns null in detached HEAD state", async () => {
      const cwd = process.cwd();
      try {
        process.chdir(tmpDir);
        // Get the commit hash and detach
        const { stdout: hash } = await execa("git", ["rev-parse", "HEAD"], { cwd: tmpDir });
        await execa("git", ["checkout", hash.trim()], { cwd: tmpDir });
        const branch = await getCurrentBranch();
        expect(branch).toBeNull();
      } finally {
        process.chdir(cwd);
      }
    });
  });

  describe("isInsideGitRepo", () => {
    it("returns true inside a git repo", async () => {
      const cwd = process.cwd();
      try {
        process.chdir(tmpDir);
        expect(await isInsideGitRepo()).toBe(true);
      } finally {
        process.chdir(cwd);
      }
    });

    it("returns false outside a git repo", async () => {
      const nonRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-no-git-"));
      const cwd = process.cwd();
      try {
        process.chdir(nonRepoDir);
        expect(await isInsideGitRepo()).toBe(false);
      } finally {
        process.chdir(cwd);
        await fs.rm(nonRepoDir, { recursive: true, force: true });
      }
    });
  });
});
