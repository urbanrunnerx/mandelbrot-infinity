# Android app

The Android app bundles the complete `web/` folder. It runs offline in Android
System WebView and requests **no Android permissions**. Minimum OS is Android 8
(API 26); compile and target SDK are 36. Keep Android System WebView updated for
JavaScript BigInt and module-worker support. No network server, account, analytics,
or native dependencies are included.

The shell intercepts local HTTPS requests at
`https://appassets.androidplatform.net/assets/`, including worker requests, and
serves APK assets. Navigation to other origins, filesystem access, content-provider
access, and network loading are disabled. Status/navigation-bar insets are applied
natively, and Android Back closes open HTML dialogs before leaving the app.

## Build with Gradle

Install JDK 17 and the official Android SDK packages `platforms;android-36` and
`build-tools;35.0.0`. Set `ANDROID_HOME` to your SDK location (or create an ignored
`local.properties` with `sdk.dir=...`). The checked-in Gradle wrapper downloads
Gradle 8.13 and verifies its SHA-256 checksum. AGP is pinned to 8.13.2.

```sh
cd android
./gradlew assembleDebug
```

On Windows use `gradlew.bat assembleDebug`. The installable development APK is
`app/build/outputs/apk/debug/app-debug.apk`. A debug build has a different signing
identity from the downloadable release; Android will not install one as an update
over the other.

For a release, set these environment variables before `assembleRelease`:

- `ANDROID_KEYSTORE_FILE`: absolute path to your private PKCS12 or JKS key store
- `ANDROID_KEYSTORE_PASSWORD`: key store password
- `ANDROID_KEY_ALIAS`: signing alias
- `ANDROID_KEY_PASSWORD`: private key password

Retain the same signing key for all updates and increment `versionCode` in
`app/build.gradle` (and the manual build script). Never commit a key or password.

## Lightweight Windows build

`../scripts/build-apk.ps1` uses only official `javac`, `aapt2`, `d8`, `zipalign`, and
`apksigner`. It produces and verifies a release APK without installing Gradle or
Android Studio. Provide paths to a JDK 17, unpacked SDK platform 36, and unpacked
SDK build-tools 35.0.0:

```powershell
./scripts/build-apk.ps1 `
  -JdkHome 'C:\tools\jdk-17' `
  -SdkPlatform 'C:\tools\android-sdk\platforms\android-36' `
  -BuildTools 'C:\tools\android-sdk\build-tools\35.0.0' `
  -KeyStore 'C:\private\mandelbrot-infinity.p12' `
  -StorePasswordFile 'C:\private\keystore-password.txt' `
  -Output 'C:\builds\Mandelbrot-Infinity-v1.0.0.apk'
```

Use `keytool -genkeypair -storetype PKCS12 -keyalg RSA -keysize 3072 -validity 10000
-alias mandelbrot-infinity -keystore <private-path>` to create your own key. The
script accepts a password file so secrets do not appear on the command line. Both
the key and password file must remain private and outside the repository.

## GitHub Actions

The Android workflow builds and uploads a development APK for pull requests and
branch pushes. A manual release build requires these repository Actions secrets:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and
`ANDROID_KEY_PASSWORD`. Base64-encode the existing release key for the first secret.
The workflow builds and uploads a signed release artifact; it does not publish
unsigned APKs as releases or replace the existing signing identity.

## Verification and device testing

Every standalone build runs `apksigner verify --verbose --print-certs` and
`zipalign -c`. Signature and package checks verify the archive, but do not replace
running the application on an actual Android device. Install with `adb install
path/to/app.apk`, or download the APK on a phone and open it. Permit installation
from that browser/file app when Android prompts. Test pinch zoom, panning,
random start, deep zoom, rotation, background/resume, and airplane-mode launch.

Build references: [AGP compatibility](https://developer.android.com/build/releases/agp-8-13-0-release-notes),
[loading offline web content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content),
[APK signing](https://developer.android.com/tools/apksigner).
