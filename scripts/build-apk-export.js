#!/usr/bin/env node
/**
 * build-apk-export.js
 *
 * Runs the Next.js static export build for the Android/Capacitor APK
 * (BUILD_TARGET=apk -> output: "export" in next.config.ts).
 *
 * Static export can't ship API routes (no server at runtime — the APK
 * uses client-side SQLite via use-shop-fetch.ts instead), so this
 * script temporarily moves src/app/api out of the tree, runs the
 * build, and restores it afterwards — even if the build fails.
 *
 * NOTE: the backup lives OUTSIDE src/app (at the repo root) rather
 * than as a dot-prefixed folder inside src/app. Next.js's App Router
 * only excludes "_"-prefixed (private) folders and "(group)" folders
 * from route scanning — a dot-prefix has no special meaning to Next,
 * so a route like src/app/.api-backup/bills/[id]/route.js still gets
 * picked up during "Collecting page data" and breaks static export.
 *
 * This replaces relying on scripts/build-apk.sh (which also expects
 * ANDROID_HOME/JAVA_HOME and runs the full Gradle build) for CI steps
 * that only need the Next.js export step in isolation, e.g.:
 *
 *   npm run build:apk
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const apiDir = path.join(root, "src", "app", "api");
const backupDir = path.join(root, ".api-backup"); // outside src/app on purpose

function moveApiOut() {
  if (fs.existsSync(apiDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    fs.renameSync(apiDir, backupDir);
    console.log("  Moved src/app/api out of the tree for static export.");
    return true;
  }
  console.log("  src/app/api not found (already moved?) — continuing.");
  return false;
}

function restoreApi() {
  if (fs.existsSync(backupDir)) {
    fs.rmSync(apiDir, { recursive: true, force: true });
    fs.renameSync(backupDir, apiDir);
    console.log("  Restored src/app/api.");
  }
}

const isApkTarget =
  process.env.BUILD_TARGET === "apk" || process.argv.includes("--apk");

if (!isApkTarget) {
  // Not an APK build (e.g. plain `npm run build` with no BUILD_TARGET
  // set) — run the normal standalone build, untouched.
  console.log("==> BUILD_TARGET != apk, running standalone build...");

  execSync("next build", { cwd: root, stdio: "inherit" });

  // Cross-platform copy (no bash/cp dependency — works on Windows CI
  // runners where /bin/bash doesn't exist, as well as macOS/Linux).
  const staticSrc = path.join(root, ".next", "static");
  const staticDest = path.join(root, ".next", "standalone", ".next", "static");
  const publicSrc = path.join(root, "public");
  const publicDest = path.join(root, ".next", "standalone", "public");

  console.log("==> Copying .next/static -> .next/standalone/.next/static ...");
  fs.cpSync(staticSrc, staticDest, { recursive: true });

  console.log("==> Copying public -> .next/standalone/public ...");
  fs.cpSync(publicSrc, publicDest, { recursive: true });

  console.log("==> Standalone build assembled.");
  process.exit(0);
}

let moved = false;
try {
  console.log("==> Preparing static export build (BUILD_TARGET=apk)...");
  moved = moveApiOut();

  console.log("==> Running next build...");
  execSync("next build", {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, BUILD_TARGET: "apk" },
  });

  console.log("==> Static export build succeeded.");
} finally {
  if (moved) restoreApi();
}