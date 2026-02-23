# dbranch

Git-style branching for local development databases.

[![npm version](https://img.shields.io/npm/v/dbranch)](https://www.npmjs.com/package/dbranch)
[![license](https://img.shields.io/npm/l/dbranch)](https://github.com/Hololm/dbranch/blob/main/LICENSE)

Switch git branches without losing your database state. dbranch automatically snapshots and restores your local database when you check out a branch.

```bash
dbranch init                  # one-time setup in your repo
git checkout feature/signup   # database state auto-switches with you
git checkout main             # back to main's data, instantly
```

## Installation

```bash
npm install -g dbranch
```

Requires Node.js 18+.

## Getting Started

Run `dbranch init` inside a git repository. The interactive wizard will:

1. Detect your database (or prompt you to choose SQLite / PostgreSQL)
2. Create a `.dbranch/` directory with your config
3. Install a git `post-checkout` hook
4. Take an initial snapshot of the current branch

```bash
cd my-project
dbranch init
```

That's it — every future `git checkout` will automatically snapshot the old branch and restore the new one.

## Commands

| Command | Description |
|---|---|
| `dbranch init` | Initialize dbranch in the current git repository |
| `dbranch snapshot [name]` | Snapshot current database state (defaults to current branch name) |
| `dbranch switch --from <branch> --to <branch>` | Switch database state between branches (used by git hook) |
| `dbranch list` | List all stored snapshots |
| `dbranch status` | Show current dbranch status |
| `dbranch delete <branch>` | Delete a snapshot for a branch |

All commands support `--verbose` for detailed output.

## Supported Databases

| Database | Status |
|---|---|
| SQLite | Stable |
| PostgreSQL | Stable |
| MySQL | Planned |

## How It Works

dbranch installs a git `post-checkout` hook. Every time you switch branches:

1. The current database is **snapshotted** and stored under the old branch name
2. If a snapshot exists for the new branch, it is **restored**
3. If no snapshot exists (new branch), an initial snapshot is created

Snapshots are stored locally in `.dbranch/snapshots/` and are excluded from version control.

## Configuration

dbranch stores its config in `.dbranch/config.yaml`:

```yaml
version: 1
driver: sqlite
connection:
  path: ./dev.db
```

```yaml
version: 1
driver: postgres
connection:
  host: localhost
  port: 5432
  database: myapp_dev
  user: postgres
  password: ""
```

| Field | Description |
|---|---|
| `version` | Config format version (always `1`) |
| `driver` | `sqlite` or `postgres` |
| `connection` | Driver-specific connection parameters |

## License

MIT
