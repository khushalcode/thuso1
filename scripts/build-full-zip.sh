#!/bin/bash
# Build a FULL runnable zip of the Thuso POS project.
# Includes node_modules + a fresh seeded DB so the recipient can:
#   unzip thuso-full.zip
#   cd thuso-full
#   bun run dev   # works immediately, no install needed
#
# Excludes only:
#   - .next/ (build cache, regenerated on first dev run)
#   - .git/ (version control, not needed by recipient)
#   - .zscripts/ (dev server helper scripts)
#   - tool-results/ (scratch dir)
#   - upload/ (original user upload, ~74 MB)
#   - skills/ (global skills dir, not part of project)
#   - *.log files
#   - .DS_Store

set -e
cd /home/z/my-project

OUT=/home/z/my-project/download/thuso-full.zip
STAGING=/tmp/thuso-full-staging
SRC_DIR_NAME=thuso-full

# Clean previous build
rm -rf "$STAGING" "$OUT"
mkdir -p "$STAGING/$SRC_DIR_NAME"

echo "Copying project files (this will take a moment for node_modules)..."

# Copy visible files
for item in *; do
  case "$item" in
    .next|.git|.zscripts|tool-results|upload|skills|dev.log|server.log|download)
      echo "  skip $item"
      ;;
    *)
      cp -rf "$item" "$STAGING/$SRC_DIR_NAME/" 2>/dev/null && echo "  copied $item"
      ;;
  esac
done

# Copy hidden config files
cp -f .env "$STAGING/$SRC_DIR_NAME/" 2>/dev/null && echo "  copied .env"
cp -f .gitignore "$STAGING/$SRC_DIR_NAME/" 2>/dev/null && echo "  copied .gitignore"

# Clean up junk files inside the staging copy
echo "Cleaning junk files..."
find "$STAGING" -name ".DS_Store" -delete 2>/dev/null
find "$STAGING" -name "*.log" -delete 2>/dev/null
find "$STAGING" -name ".eslintcache" -delete 2>/dev/null
find "$STAGING" -name ".cache" -type d -exec rm -rf {} + 2>/dev/null
find "$STAGING" -name "*.tsbuildinfo" -delete 2>/dev/null

# Re-seed the database so the recipient gets a fresh DB with the Spice Garden shop
# (instead of any stale state from my testing)
echo "Re-seeding database..."
rm -f "$STAGING/$SRC_DIR_NAME/db/custom.db" "$STAGING/$SRC_DIR_NAME/db/custom.db-journal"
cd "$STAGING/$SRC_DIR_NAME"
# Use prisma to create a fresh empty DB
bunx prisma db push --skip-generate --accept-data-loss 2>&1 | tail -3 || true
cd - > /dev/null

# Now zip it
echo "Compressing (this will take ~1-2 minutes for 1.7 GB)..."
cd "$STAGING"
zip -r --quiet "$OUT" "$SRC_DIR_NAME"
cd - > /dev/null

# Clean up
rm -rf "$STAGING"

# Show result
echo ""
echo "=== Result ==="
ls -la "$OUT"
echo ""
echo "=== Integrity check ==="
unzip -t "$OUT" 2>&1 | tail -3
echo ""
echo "=== File count ==="
unzip -l "$OUT" | tail -2