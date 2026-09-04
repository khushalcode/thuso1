# GitHub Actions CI/CD

Three workflows live in `.github/workflows/`:

| Workflow | File | Builds | Runner | Trigger |
|----------|------|--------|--------|---------|
| Build .exe | `build-exe.yml` | Windows installer (.exe) | `windows-latest` | Push to main, PRs, manual |
| Build APK | `build-apk.yml` | Android APK | `ubuntu-latest` | Push to main, PRs, manual |
| Release | `release.yml` | Both (.exe + APK) | Both | Push tag `v*` or manual |

---

## Quick start

### 1. Windows .exe — works immediately

Push to `main` → GitHub Actions will build the .exe automatically.

**Manual build:** GitHub repo → **Actions** tab → **Build Windows .exe** → **Run workflow**

**Download:** After the build finishes, click into the run → scroll down to **Artifacts** → download `servingsync-windows-exe.zip` → unzip → run `ServingSync POS Setup.exe`.

### 2. Android APK — needs one-time setup

The .exe workflow works today. The APK workflow needs Capacitor added to your project first. Run this **once on your dev machine**:

```bash
bash scripts/setup-capacitor.sh
git add android/ capacitor.config.ts next.config.ts package.json
git commit -m "Add Capacitor for Android APK builds"
git push
```

This script:
- Installs `@capacitor/core @capacitor/cli @capacitor/android`
- Switches `next.config.ts` from `output: "standalone"` to `output: "export"` (Capacitor needs static files)
- Creates `capacitor.config.ts` with `webDir: 'out'`
- Generates the `android/` Gradle project

After that, every push to `main` will build the APK automatically.

### 3. Release workflow — builds both, attaches to GitHub Release

Push a version tag:
```bash
git tag v1.0.0
git push origin v1.0.0
```

This triggers `release.yml`, which:
1. Builds the .exe on Windows runner
2. Builds the APK on Ubuntu runner (in parallel)
3. Creates a **draft** GitHub Release with both files attached

Go to your repo → **Releases** → find the draft → edit description → click **Publish**.

---

## Build artifacts

| Workflow | Artifact name | What's inside |
|----------|--------------|---------------|
| `build-exe.yml` | `servingsync-windows-exe` | `ServingSync POS Setup.exe` + portable exe |
| `build-apk.yml` | `servingsync-android-apk` | `app-debug.apk` |
| `release.yml` | `release-windows-exe`, `release-android-apk` | Same as above, then attached to Release |

Artifacts are kept for **30 days** (single workflows) or **7 days** (release workflow).

---

## Cost / runner minutes

| Workflow | Runner | Approx minutes per run |
|----------|--------|------------------------|
| `build-exe.yml` | Windows | ~10–15 min |
| `build-apk.yml` | Ubuntu | ~20–30 min |
| `release.yml` | Both (parallel) | ~20–30 min wall time |

GitHub gives **2000 free minutes/month** for private repos (unlimited for public). The Windows runner counts at **2× rate** (15 min = 30 billable min).

---

## Optional: signed Android release APK

The current `build-apk.yml` builds a **debug** APK (works on any Android device with "Install from unknown sources" enabled, but shows "Debug" in the build name). To produce a **signed release APK**:

1. Generate a keystore locally:
   ```bash
   keytool -genkey -v -keystore servingsync.keystore -alias servingsync \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Base64-encode it and add as a GitHub repo secret:
   ```bash
   base64 -i servingsync.keystore | pbcopy   # macOS
   # or:  base64 -w 0 servingsync.keystore    # Linux
   ```
   Go to **Settings → Secrets and variables → Actions → New repository secret**:
   - `ANDROID_KEYSTORE_BASE64` = the base64 string
   - `ANDROID_KEYSTORE_PASSWORD` = your keystore password
   - `ANDROID_KEY_ALIAS` = `servingsync`
   - `ANDROID_KEY_PASSWORD` = your key password

3. Add a `signingConfigs` block to `android/app/build.gradle`:
   ```gradle
   android {
     signingConfigs {
       release {
         storeFile file(System.getenv("KEYSTORE_FILE") ?: "servingsync.keystore")
         storePassword System.getenv("KEYSTORE_PASSWORD")
         keyAlias System.getenv("KEY_ALIAS")
         keyPassword System.getenv("KEY_PASSWORD")
       }
     }
     buildTypes {
       release {
         signingConfig signingConfigs.release
       }
     }
   }
   ```

4. Add a decode step at the top of `build-apk.yml`'s build job:
   ```yaml
   - name: Decode keystore
     run: echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > android/servingsync.keystore
     env:
       KEYSTORE_FILE: ${{ github.workspace }}/android/servingsync.keystore
       KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
       KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
       KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
   ```

5. Swap `assembleDebug` for `assembleRelease` in the gradle step.

Skip this until you're ready to publish to the Play Store — debug APK is fine for direct side-load distribution.
