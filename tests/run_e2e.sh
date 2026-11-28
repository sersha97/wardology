#!/usr/bin/env bash
# Build the site, start a local copy (wrangler pages dev + local D1 + mock mail API) and run the
# QBank highlight/feedback tests in Chromium, Firefox and WebKit, desktop and touch.
#   pip install playwright markdown pyyaml emoji && python3 -m playwright install chromium firefox webkit
#   npm i -g wrangler
#   bash tests/run_e2e.sh            (all platforms)   bash tests/run_e2e.sh iPhone   (one platform)
set -euo pipefail
cd "$(dirname "$0")/.."
WR=${WRANGLER:-wrangler}
STATE=$(mktemp -d)
python3 build.py >/dev/null
$WR d1 execute wardology-qbank --local --persist-to "$STATE" --file qbank/schema.sql >/dev/null
python3 tests/mock_mail.py 9999 & MAIL=$!
$WR pages dev site --port 8788 --persist-to "$STATE" \
  --binding CF_ACCOUNT_ID=test-account CF_EMAIL_TOKEN=test-token FEEDBACK_TO=inbox@example.com \
            FEEDBACK_FROM=qbank@wardology.com EMAIL_API_URL=http://127.0.0.1:9999/send >/tmp/wardology-dev.log 2>&1 & DEV=$!
trap 'kill $MAIL $DEV 2>/dev/null || true' EXIT
for i in $(seq 60); do curl -s -o /dev/null localhost:8788/qbank/ && break; sleep 1; done
DB=$(python3 -c "import sqlite3,glob,sys
for f in glob.glob(sys.argv[1]+'/**/*.sqlite', recursive=True):
  try:
    if sqlite3.connect(f).execute(\"select 1 from sqlite_master where name='feedback'\").fetchone(): print(f); break
  except Exception: pass" "$STATE")
python3 tests/qbank_e2e.py --base http://localhost:8788 --mail http://127.0.0.1:9999 --db "$DB" --only "${1:-}"
