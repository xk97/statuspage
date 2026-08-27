#!/usr/bin/env bash
# Health-checks LLM API endpoints listed in llm-urls.cfg, authenticating with
# API keys pulled from your local .env file.
#
# This script is for LOCAL/PRIVATE use only:
#   - It never commits or pushes anything to git.
#   - llm-urls.cfg, .env, and private-logs/ are all gitignored, so your
#     endpoints, model names, and API keys never leave your machine.
#
# Setup:
#   1. cp llm-urls.cfg.example llm-urls.cfg
#   2. Edit llm-urls.cfg with your real endpoints (see format in the example).
#   3. Make sure your .env file defines the API key env vars referenced there
#      (e.g. OPENAI_API_KEY=sk-...).
#   4. Run: bash llm-health-check.sh
#
# Results are appended to private-logs/<key>_report.log in the same
# "YYYY-MM-DD HH:MM, success|failed" format used by health-check.sh, so they
# can be viewed locally with index.html (it also reads private-logs/ when
# llm-urls.cfg is present) or by just tailing the log files directly.

set -uo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

configFile="./llm-urls.cfg"
if [ ! -f "$configFile" ]; then
  echo "No $configFile found."
  echo "Copy llm-urls.cfg.example to llm-urls.cfg and fill in your real endpoints first."
  exit 1
fi

mkdir -p private-logs

echo "Reading $configFile"
while IFS= read -r line || [ -n "$line" ]; do
  # Skip blank lines and comments.
  [[ -z "$line" || "$line" == \#* ]] && continue

  key="${line%%=*}"
  rest="${line#*=}"
  IFS='|' read -r url model apiKeyVar <<< "$rest"

  if [ -z "$key" ] || [ -z "$url" ] || [ -z "$apiKeyVar" ]; then
    echo "  Skipping malformed line: $line"
    continue
  fi

  apiKey="${!apiKeyVar:-}"
  if [ -z "$apiKey" ]; then
    echo "  $key: skipped (env var $apiKeyVar is not set in .env)"
    continue
  fi

  response=$(curl --write-out '%{http_code}' --silent --output /dev/null \
    --max-time 15 \
    -H "Authorization: Bearer $apiKey" \
    "$url")

  if [[ "$response" =~ ^2 ]]; then
    result="success"
  elif [[ "$response" == "401" || "$response" == "403" ]]; then
    # Reachable, but the API key was rejected (e.g. expired/invalid). Recorded
    # as "partial" rather than "failed" so the status page shows it as a
    # partial outage instead of a full one.
    result="partial"
  else
    result="failed"
  fi

  dateTime=$(date +'%Y-%m-%d %H:%M')
  echo "  $key ($model): $result (HTTP $response)"
  echo "$dateTime, $result" >> "private-logs/${key}_report.log"
  # Keep only the last 2000 entries per log, matching health-check.sh.
  echo "$(tail -2000 "private-logs/${key}_report.log")" > "private-logs/${key}_report.log"
done < "$configFile"

echo "Done. Nothing was committed or pushed - results stay local in private-logs/."
