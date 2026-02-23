#!/bin/bash
set -e

# Configuration
COVERAGE_FILE="server/coverage/coverage-summary.json"
README_FILE="README.md"

if [ ! -f "$COVERAGE_FILE" ]; then
  echo "Error: Coverage summary file not found at $COVERAGE_FILE"
  exit 1
fi

# Extract coverage and determine color using jq
COVERAGE=$(jq -r '.total.lines.pct' "$COVERAGE_FILE")
COLOR=$(jq -r '.total.lines.pct | if . >= 90 then "green" elif . >= 80 then "yellow" else "red" end' "$COVERAGE_FILE")

echo "Extracted coverage: $COVERAGE%"
echo "Determined color: $COLOR"

# Replace the badge in README.md
# Using | as delimiter for sed to avoid issues with / in the badge URL
sed -i "s|<!-- coverage-badge -->.*<!-- /coverage-badge -->|<!-- coverage-badge -->![Coverage](https://img.shields.io/badge/coverage-$COVERAGE%25-$COLOR)<!-- /coverage-badge -->|" "$README_FILE"

# Commit and push if there are changes
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add "$README_FILE"

if git diff --staged --quiet; then
  echo "No changes in $README_FILE. Skipping commit."
else
  echo "Changes detected in $README_FILE. Committing..."
  git commit -m "docs: update coverage badge [skip ci]"
  git push
fi
