#!/usr/bin/env bash
#
# Run the end-to-end journeys WITHOUT taking down a dev server you are using.
#
# Next allows one dev server per project directory, so `npm run e2e` requires
# killing whatever is serving the demo -- and a page reloaded during that
# window comes back half-loaded, which looks exactly like a broken interface.
# This runs the journeys in a detached worktree with its own node_modules and
# its own port, so nothing you have open goes down.
#
#   npm run e2e:isolated
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="${MM_E2E_WORKTREE:-${TMPDIR:-/tmp}/mm-e2e-worktree}"

git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
rm -rf "$WT"
git -C "$ROOT" worktree add -q --detach "$WT" HEAD

# The worktree is at HEAD, so lay the working tree over it: what runs should be
# what you have edited, not what you last committed.
rsync -a --exclude node_modules --exclude .next --exclude .git \
      "$ROOT/src" "$ROOT/tests" "$ROOT/scripts" "$ROOT/mmparser" "$WT/"
cp "$ROOT/next.config.ts" "$ROOT/package.json" "$ROOT/tsconfig.json" "$WT/"

# Turbopack refuses a symlinked node_modules ("points out of the filesystem
# root"), so clone it. -c is copy-on-write on APFS: about a second, no disk.
cp -Rc "$ROOT/node_modules" "$WT/node_modules" 2>/dev/null \
  || cp -R "$ROOT/node_modules" "$WT/node_modules"

cd "$WT" && node tests/e2e/journeys.mjs
