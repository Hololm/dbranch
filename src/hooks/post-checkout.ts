import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

const HOOK_MARKER = "# Installed by dbranch";

export function generateHookScript(): string {
  return `#!/bin/bash
${HOOK_MARKER}
PREV_REF=$1
NEW_REF=$2
IS_BRANCH_CHECKOUT=$3

if [ "$IS_BRANCH_CHECKOUT" = "1" ]; then
  PREV_BRANCH=$(git name-rev --name-only "$PREV_REF" 2>/dev/null | sed 's/~[0-9]*$//')
  NEW_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null)
  if [ -n "$PREV_BRANCH" ] && [ -n "$NEW_BRANCH" ] && [ "$PREV_BRANCH" != "$NEW_BRANCH" ]; then
    npx dbranch switch --from="$PREV_BRANCH" --to="$NEW_BRANCH"
  fi
fi
`;
}

export async function installHook(repoRoot: string): Promise<void> {
  const hooksDir = path.join(repoRoot, ".git", "hooks");
  const hookPath = path.join(hooksDir, "post-checkout");

  await fs.mkdir(hooksDir, { recursive: true });

  let existingContent = "";
  try {
    existingContent = await fs.readFile(hookPath, "utf-8");
  } catch {
    // No existing hook
  }

  if (existingContent.includes(HOOK_MARKER)) {
    logger.verbose("post-checkout hook already installed by dbranch, updating...");
    // Replace the dbranch section
    const lines = existingContent.split("\n");
    const markerIdx = lines.findIndex((l) => l.includes(HOOK_MARKER));
    // Keep everything before the marker (usually just the shebang from another tool)
    const before = lines.slice(0, markerIdx).filter((l) => l.trim() !== "");
    const hookScript = generateHookScript();
    // Remove shebang from our script if there's already content before
    const ourLines = hookScript.split("\n");
    if (before.length > 0) {
      const content = before.join("\n") + "\n\n" + ourLines.slice(1).join("\n");
      await fs.writeFile(hookPath, content, { mode: 0o755 });
    } else {
      await fs.writeFile(hookPath, hookScript, { mode: 0o755 });
    }
    return;
  }

  if (existingContent.trim()) {
    // There's an existing non-dbranch hook — append
    logger.warn("Existing post-checkout hook found. Appending dbranch hook.");
    const hookBody = generateHookScript()
      .split("\n")
      .filter((l) => !l.startsWith("#!/"))
      .join("\n");
    const merged = existingContent.trimEnd() + "\n\n" + hookBody;
    await fs.writeFile(hookPath, merged, { mode: 0o755 });
    return;
  }

  // Fresh install
  await fs.writeFile(hookPath, generateHookScript(), { mode: 0o755 });
}

export function isHookInstalled(hookContent: string): boolean {
  return hookContent.includes(HOOK_MARKER);
}
