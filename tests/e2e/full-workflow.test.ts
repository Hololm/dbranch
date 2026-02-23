/**
 * Full end-to-end workflow test.
 *
 * Creates a real git repo with a real SQLite database, then runs through
 * the complete dbranch lifecycle: init → snapshot → branch switch → restore → list → delete.
 * Verifies DB contents actually change when switching branches.
 *
 * NOTE: The post-checkout hook is NOT installed here because `npx dbranch`
 * won't resolve in a temp directory. Instead, we call the driver directly
 * to simulate what the hook would do—which is exactly the code path the
 * hook triggers. Hook installation is verified separately.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execa } from "execa";
import { writeConfig, readConfig, type DbranchConfig } from "../../src/config/config.js";
import { createDriver } from "../../src/drivers/index.js";
import { installHook, isHookInstalled } from "../../src/hooks/post-checkout.js";
import { setSilent } from "../../src/utils/logger.js";

let tmpDir: string;
let dbPath: string;
let config: DbranchConfig;

/** Write a recognizable SQLite file with a payload string baked into it. */
async function writeSqliteDb(filePath: string, payload: string): Promise<void> {
  const header = Buffer.from("SQLite format 3\0", "utf-8");
  // Pad to a realistic size (4096 = one SQLite page)
  const body = Buffer.alloc(4080, 0);
  body.write(payload, 0, "utf-8");
  await fs.writeFile(filePath, Buffer.concat([header, body]));
}

/** Read the payload string back from our fake SQLite file. */
async function readPayload(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  // payload starts right after the 16-byte header
  const raw = buf.subarray(16, 16 + 64).toString("utf-8");
  return raw.replace(/\0+$/, "");
}

beforeEach(async () => {
  setSilent(true);

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dbranch-full-e2e-"));

  // Initialise a real git repo on "main"
  await execa("git", ["init", "-b", "main"], { cwd: tmpDir });
  await execa("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
  await execa("git", ["config", "user.name", "Test"], { cwd: tmpDir });

  // Create a SQLite database with "main-data" payload
  dbPath = path.join(tmpDir, "dev.db");
  await writeSqliteDb(dbPath, "main-data");

  // Initial commit so we can create branches
  await execa("git", ["add", "."], { cwd: tmpDir });
  await execa("git", ["commit", "-m", "initial"], { cwd: tmpDir });

  // -- simulate `dbranch init` (without hook, see NOTE above) --
  config = {
    version: 1,
    driver: "sqlite",
    connection: { path: "./dev.db" },
  };
  await writeConfig(tmpDir, config);

  // Append .dbranch/ to .gitignore
  const gitignorePath = path.join(tmpDir, ".gitignore");
  await fs.writeFile(gitignorePath, ".dbranch/\n");
});

afterEach(async () => {
  setSilent(false);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("full workflow (git + SQLite)", () => {
  it("init: config file and hook are in place", async () => {
    // Verify config was written
    const readBack = await readConfig(tmpDir);
    expect(readBack.driver).toBe("sqlite");
    expect(readBack.version).toBe(1);

    // Install the hook and verify its content
    await installHook(tmpDir);
    const hookContent = await fs.readFile(
      path.join(tmpDir, ".git", "hooks", "post-checkout"),
      "utf-8",
    );
    expect(isHookInstalled(hookContent)).toBe(true);
    expect(hookContent).toContain("npx dbranch switch");
  });

  it("snapshot: saves current branch state", async () => {
    const driver = await createDriver(config, tmpDir);
    await driver.snapshot("main");

    expect(await driver.hasSnapshot("main")).toBe(true);

    const snapshots = await driver.listSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].branch).toBe("main");
    expect(snapshots[0].size).toBeGreaterThan(0);
  });

  it("full branch-switch cycle preserves per-branch DB state", async () => {
    const driver = await createDriver(config, tmpDir);

    // ---- on main ----
    expect(await readPayload(dbPath)).toBe("main-data");
    await driver.snapshot("main");

    // ---- create feature branch & modify the DB ----
    await execa("git", ["checkout", "-b", "feature-test"], { cwd: tmpDir });
    await writeSqliteDb(dbPath, "feature-data");
    await driver.snapshot("feature-test");

    // ---- switch back to main (simulates what the hook does) ----
    await driver.snapshot("feature-test");
    await execa("git", ["checkout", "main"], { cwd: tmpDir });
    await driver.restore("main");

    expect(await readPayload(dbPath)).toBe("main-data");

    // ---- switch to feature-test again ----
    await driver.snapshot("main");
    await execa("git", ["checkout", "feature-test"], { cwd: tmpDir });
    await driver.restore("feature-test");

    expect(await readPayload(dbPath)).toBe("feature-data");
  });

  it("switch command logic: snapshots from-branch and restores to-branch", async () => {
    const driver = await createDriver(config, tmpDir);

    // Snapshot main and create a feature branch snapshot with different data
    await driver.snapshot("main");
    await writeSqliteDb(dbPath, "feature-data");
    await driver.snapshot("feature-test");

    // Restore main so current DB = main
    await driver.restore("main");
    expect(await readPayload(dbPath)).toBe("main-data");

    // Simulate hook: switch from main → feature-test
    await driver.snapshot("main");
    await driver.restore("feature-test");
    expect(await readPayload(dbPath)).toBe("feature-data");

    // And back: feature-test → main
    await driver.snapshot("feature-test");
    await driver.restore("main");
    expect(await readPayload(dbPath)).toBe("main-data");
  });

  it("new branch with no snapshot keeps DB as-is and creates initial snapshot", async () => {
    const driver = await createDriver(config, tmpDir);
    await driver.snapshot("main");

    // Create a new branch — no snapshot exists yet
    await execa("git", ["checkout", "-b", "brand-new"], { cwd: tmpDir });
    expect(await driver.hasSnapshot("brand-new")).toBe(false);

    // Simulate switch behavior: no snapshot for target → keep DB, take initial snapshot
    await driver.snapshot("brand-new");
    expect(await driver.hasSnapshot("brand-new")).toBe(true);
    expect(await readPayload(dbPath)).toBe("main-data"); // unchanged
  });

  it("list: shows all snapshots with correct branch names", async () => {
    const driver = await createDriver(config, tmpDir);

    await driver.snapshot("main");
    await writeSqliteDb(dbPath, "feat");
    await driver.snapshot("feature/auth");
    await writeSqliteDb(dbPath, "dev");
    await driver.snapshot("develop");

    const snapshots = await driver.listSnapshots();
    expect(snapshots).toHaveLength(3);

    const branches = snapshots.map((s) => s.branch).sort();
    expect(branches).toEqual(["develop", "feature/auth", "main"]);

    // Slashed branch name should be desanitized in listing
    const authSnap = snapshots.find((s) => s.branch === "feature/auth")!;
    expect(authSnap.fileName).toBe("feature-SLASH-auth.sqlite3");
  });

  it("status: driver validates the database file", async () => {
    const driver = await createDriver(config, tmpDir);
    expect(await driver.validate()).toBe(true);
  });

  it("delete: removes a snapshot", async () => {
    const driver = await createDriver(config, tmpDir);
    await driver.snapshot("main");
    await driver.snapshot("to-delete");

    expect(await driver.hasSnapshot("to-delete")).toBe(true);
    await driver.deleteSnapshot("to-delete");
    expect(await driver.hasSnapshot("to-delete")).toBe(false);

    // main snapshot should still exist
    expect(await driver.hasSnapshot("main")).toBe(true);
  });

  it("multiple round-trips: DB state is always correct", async () => {
    const driver = await createDriver(config, tmpDir);

    // Snapshot main
    await driver.snapshot("main");

    // Create 3 branches each with unique data
    const branches = ["alpha", "beta", "gamma"];
    for (const branch of branches) {
      await writeSqliteDb(dbPath, `${branch}-data`);
      await driver.snapshot(branch);
    }

    // Restore each and verify
    for (const branch of branches) {
      await driver.restore(branch);
      expect(await readPayload(dbPath)).toBe(`${branch}-data`);
    }

    // Back to main
    await driver.restore("main");
    expect(await readPayload(dbPath)).toBe("main-data");

    // Update alpha and verify it doesn't affect others
    await driver.restore("alpha");
    await writeSqliteDb(dbPath, "alpha-v2");
    await driver.snapshot("alpha");

    await driver.restore("beta");
    expect(await readPayload(dbPath)).toBe("beta-data"); // unaffected

    await driver.restore("alpha");
    expect(await readPayload(dbPath)).toBe("alpha-v2"); // updated
  });

  it("same from and to branch is a no-op (snapshot self, restore self)", async () => {
    const driver = await createDriver(config, tmpDir);

    await driver.snapshot("main");
    const originalPayload = await readPayload(dbPath);

    // Simulate switch --from=main --to=main
    await driver.snapshot("main");
    await driver.restore("main");

    expect(await readPayload(dbPath)).toBe(originalPayload);
  });

  it("branch with / in name works through full switch cycle", async () => {
    const driver = await createDriver(config, tmpDir);

    // Snapshot main
    await driver.snapshot("main");

    // Create branch with slash and different data
    await execa("git", ["checkout", "-b", "feature/payments"], { cwd: tmpDir });
    await writeSqliteDb(dbPath, "payments-data");
    await driver.snapshot("feature/payments");

    // Switch back to main
    await driver.snapshot("feature/payments");
    await execa("git", ["checkout", "main"], { cwd: tmpDir });
    await driver.restore("main");
    expect(await readPayload(dbPath)).toBe("main-data");

    // Switch to feature/payments
    await driver.snapshot("main");
    await execa("git", ["checkout", "feature/payments"], { cwd: tmpDir });
    await driver.restore("feature/payments");
    expect(await readPayload(dbPath)).toBe("payments-data");

    // Verify the snapshot file uses sanitized name
    const snapshotPath = path.join(
      tmpDir,
      ".dbranch",
      "snapshots",
      "feature-SLASH-payments.sqlite3",
    );
    const exists = await fs
      .access(snapshotPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });
});
