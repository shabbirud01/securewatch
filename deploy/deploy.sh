#!/usr/bin/env bash
# Updates this server to a commit on main and restarts what changed: a "git pull" and a
# rebuild, made safe to run unattended. The CI/CD pipeline runs it over SSH after every
# successful build of main. By hand:
#
#   bash deploy/deploy.sh             # the latest commit on main
#   bash deploy/deploy.sh <commit>    # a specific commit on main (its full 40-character SHA)
set -euo pipefail
cd "$(dirname "$0")/.."

# A restricted SSH key (command="..." in authorized_keys) runs this script whatever the
# client asked for, and passes the request in SSH_ORIGINAL_COMMAND: its last word is the commit.
requested="${1:-}"
if [[ -z "$requested" && -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  requested="${SSH_ORIGINAL_COMMAND##* }"
fi

git fetch --quiet origin main
if [[ -z "$requested" ]]; then
  commit="$(git rev-parse origin/main)"
elif [[ "$requested" =~ ^[0-9a-f]{40}$ ]]; then
  commit="$requested"
else
  echo "deploy: expected a full commit SHA, got '$requested'" >&2
  exit 2
fi

# Only commits that are on main, and only forwards: a late deploy of an older commit
# changes nothing, and local edits on the server stop the deploy instead of being lost.
if ! git merge-base --is-ancestor "$commit" origin/main 2>/dev/null; then
  echo "deploy: $commit is not on main" >&2
  exit 2
fi
git merge --ff-only --quiet "$commit"

compose=(docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml)
"${compose[@]}" up -d --build

# Done when the API answers through nginx; /api/health also queries the database.
if curl --fail --silent --show-error --retry 30 --retry-delay 2 --retry-all-errors \
  --output /dev/null http://127.0.0.1:8080/api/health; then
  echo "deploy: running $(git rev-parse --short HEAD)"
else
  echo "deploy: the API is not answering; recent server logs:" >&2
  "${compose[@]}" logs --tail 50 server >&2
  exit 1
fi
