#!/bin/bash
# Build a clean, distributable ZIP of the working Thuso POS project.
# Excludes heavy/transient dirs that the recipient doesn't need
# (node_modules, .next build cache, dev logs, .git, etc.) —
# they will run `bun install` themselves.

set -e
cd /home/z/my-project

OUT=/home/z/my-project/download/thuso-working.zip
TMP_STAGING=/tmp/thuso-working-staging
SRC_DIR_NAME=thuso-working

# Clean any previous build
rm -rf "$TMP_STAGING" "$OUT"
mkdir -p "$TMP_STAGING/$SRC_DIR_NAME"

# Copy project files (exclude transient + heavy dirs)
# Use rsync-style excludes via a tar pipe (works on every system).
tar --create \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='dev.log' \
  --exclude='server.log' \
  --exclude='db/custom.db' \
  --exclude='db/custom.db-journal' \
  --exclude='.zscripts' \
  --exclude='tool-results' \
  --exclude='upload' \
  --exclude='download' \
  --exclude='tsconfig.tsbuildinfo' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --transform 's,^,$SRC_DIR_NAME/,' \
  --directory=/home/z/my-project \
  . 2>/dev/null | tar --extract --directory="$TMP_STAGING"

# Move into place
cd "$TMP_STAGING"
zip -r --quiet "$OUT" "$SRC_DIR_NAME"
cd - > /dev/null

# Clean up staging
rm -rf "$TMP_STAGING"

# Show the result
ls -la "$OUT"
echo "---zip integrity---"
unzip -t "$OUT" 2>&1 | tail -5
echo "---file count---"
unzip -l "$OUT" | tail -3