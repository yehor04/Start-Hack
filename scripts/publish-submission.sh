#!/usr/bin/env bash
# Publish a CLEAN, judge-facing copy of this repo to the PUBLIC submission remote.
#
# It excludes AI/team docs and dev junk so judges never see them — not even in git
# history (the output is a brand-new single-commit repo).
#
# Usage:
#   bash scripts/publish-submission.sh https://github.com/<org-or-user>/<public-repo>.git
#
# Run this from the dev repo root. Edit the EXCLUDES list to taste.

set -euo pipefail

PUBLIC_REMOTE="${1:?Usage: publish-submission.sh <public-repo-git-url>}"
SRC="$(git rev-parse --show-toplevel)"
OUT="$(mktemp -d)"

# Files/dirs that must NEVER reach the public submission repo.
EXCLUDES=(
  ".git"
  "node_modules"
  ".next"
  "*.db"
  ".env"
  "CLAUDE.md"          # team/AI context — keep private
  "team-docs"          # any other AI/planning notes — keep private
  "scripts"            # dev tooling, incl. this script
  "fonio-case.pdf"     # the track's own brief — judges don't need it
)

RSYNC_ARGS=(-a --delete)
for e in "${EXCLUDES[@]}"; do RSYNC_ARGS+=(--exclude="$e"); done

rsync "${RSYNC_ARGS[@]}" "$SRC"/ "$OUT"/

cd "$OUT"
git init -q -b main
git add -A
git commit -q -m "Refill — START Hack Vienna '26 submission (fonio.ai track)"
git remote add origin "$PUBLIC_REMOTE"
git push -f origin main

echo ""
echo "✅ Published a clean submission to: $PUBLIC_REMOTE"
echo "   Single commit, no AI/team files, no secrets."
echo "   Verify on GitHub: the repo should NOT contain CLAUDE.md, team-docs/, or .env."
