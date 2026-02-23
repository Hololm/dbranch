# CLAUDE.md

## Project Overview

**dbranch** — a CLI tool that automatically snapshots and restores your local database when you switch git branches. Like `git stash` for your dev database.

```bash
$ dbranch init                    # one-time setup, installs git hooks
$ git checkout feature-payments   # DB auto-switches to feature-payments state
$ git checkout main               # DB auto-switches back to main state
```

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js >= 18
- **Package Manager:** npm
- **Distribution:** npm package (`npm install -g dbranch`)

### Core Dependencies

- `commander` — CLI argument parsing
- `execa` — shell command execution (pg_dump, pg_restore, mysqldump, etc.)
- `chalk` — terminal colors
- `ora` — loading spinners
- `yaml` — config file parsing
- `prompts` — interactive setup prompts during `dbranch init`

### Dev Dependencies

- `vitest` — testing
- `tsup` — bundling (outputs single CJS entry point)
- `typescript` — strict mode, ES2022 target
- `eslint` + `prettier` — linting and formatting

## Architecture

```
src/
├── cli.ts                 # Entry point, commander setup
├── commands/
│   ├── init.ts            # `dbranch init` — detect DB, create .dbranch/, install git hooks
│   ├── snapshot.ts        # `dbranch snapshot` — manually snapshot current branch state
│   ├── switch.ts          # `dbranch switch --from=X --to=Y` — called by git hook
│   ├── list.ts            # `dbranch list` — show all snapshots
│   └── delete.ts          # `dbranch delete <branch>` — remove a snapshot
├── drivers/
│   ├── base.ts            # Abstract DatabaseDriver interface
│   ├── sqlite.ts          # SQLite: file copy to .dbranch/snapshots/
│   ├── postgres.ts        # Postgres: pg_dump / pg_restore
│   └── mysql.ts           # MySQL: mysqldump / mysql
├── hooks/
│   └── post-checkout.ts   # Generates the git post-checkout hook script
├── config/
│   └── config.ts          # Read/write .dbranch/config.yaml
└── utils/
    ├── git.ts             # Git helpers (current branch, repo root, etc.)
    ├── detect.ts          # Auto-detect database type and connection
    └── logger.ts          # Consistent logging with chalk + ora
```

### Storage Structure (created in project root)

```
.dbranch/
├── config.yaml            # DB type, connection string, settings
└── snapshots/
    ├── main.dump          # pg_dump output / mysqldump output / sqlite file copy
    ├── feature-auth.dump
    └── feature-pay.dump
```

## Database Driver Strategy

Each driver implements a common interface:

```typescript
interface DatabaseDriver {
  snapshot(branchName: string): Promise<void>;   // Save current DB state
  restore(branchName: string): Promise<void>;    // Restore DB to branch state
  hasSnapshot(branchName: string): Promise<boolean>;
  deleteSnapshot(branchName: string): Promise<void>;
  validate(): Promise<boolean>;                  // Check DB connection works
}
```

- **SQLite:** Copy `.db` file → `.dbranch/snapshots/<branch>.sqlite3`. Restore = copy back. Fastest path.
- **Postgres:** `pg_dump --format=custom` → `.dbranch/snapshots/<branch>.dump`. Restore = `dropdb` + `createdb` + `pg_restore`. For speed, explore `CREATE DATABASE ... TEMPLATE` for near-instant cloning.
- **MySQL:** `mysqldump` → `.dbranch/snapshots/<branch>.sql`. Restore = `DROP DATABASE` + `CREATE DATABASE` + pipe sql file into `mysql`.

## Git Hook Integration

`dbranch init` installs a `.git/hooks/post-checkout` script:

```bash
#!/bin/bash
# Installed by dbranch
PREV_REF=$1
NEW_REF=$2
IS_BRANCH_CHECKOUT=$3

if [ "$IS_BRANCH_CHECKOUT" = "1" ]; then
  PREV_BRANCH=$(git name-rev --name-only "$PREV_REF" 2>/dev/null)
  NEW_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
  npx dbranch switch --from="$PREV_BRANCH" --to="$NEW_BRANCH"
fi
```

## Key Design Principles

1. **Zero config by default.** `dbranch init` auto-detects DB type and connection. No YAML editing needed for standard setups (localhost postgres, local sqlite file, etc.).
2. **Non-destructive.** Never touch the database without a snapshot of the current state saved first. Always snapshot before restoring.
3. **Silent by default in hooks.** Git hook output should be minimal (one line: "✓ Switched database to branch feature-auth"). Verbose mode available via flag.
4. **Fail gracefully.** If snapshot/restore fails, print a clear error and leave the DB untouched. Never leave DB in a half-restored state.
5. **Fast for small DBs.** Target audience has local dev databases (MBs to low GBs). Optimize for that. Don't over-engineer for TB-scale.

## Commands Reference

| Command | Description |
|---|---|
| `dbranch init` | Auto-detect DB, create `.dbranch/`, install git hook, take initial snapshot |
| `dbranch snapshot [name]` | Manually snapshot current state (defaults to current branch name) |
| `dbranch switch --from=X --to=Y` | Internal: called by git hook. Snapshots X, restores Y (or creates fresh snapshot if Y is new) |
| `dbranch list` | List all stored snapshots with size and timestamp |
| `dbranch delete <branch>` | Delete a specific snapshot |
| `dbranch status` | Show current branch, DB type, snapshot info |

## Coding Conventions

- Use `async/await` everywhere, no callbacks
- All shell commands via `execa` (never `child_process` directly)
- Errors should be user-friendly messages, not raw stack traces — catch and format at the command level
- Use `process.exit(1)` only in `cli.ts`, throw errors everywhere else
- All file paths use `path.join()` and `path.resolve()`, never string concatenation
- Config and snapshot paths are always relative to git repo root
- Add `.dbranch/` to the project's `.gitignore` during `dbranch init`

## Testing Strategy

- Unit tests for each driver (mock `execa` calls, verify correct commands are built)
- Unit tests for git utilities (mock git output)
- Integration tests with real SQLite databases (fast, no external deps)
- Integration tests with Postgres/MySQL via Docker containers in CI
- Test edge cases: no existing snapshot for target branch, corrupt snapshots, missing DB tools (`pg_dump` not installed), concurrent operations

## MVP Scope (v0.1.0)

Priority order:
1. SQLite driver (simplest, fastest to build and test)
2. Postgres driver
3. Core commands: init, snapshot, switch, list, status
4. Git hook installation
5. Auto-detection of DB type
6. README with demo GIF
7. npm publishing

### Deferred to v0.2.0+
- MySQL driver
- `dbranch delete` command
- Migration-aware diffing (track which migrations ran per branch)
- Config file customization (custom dump flags, excluded tables)
- Compression for large snapshots
- `dbranch clone <from> <to>` — copy one branch's snapshot to another
