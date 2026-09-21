# Android installation and builds

Download **Mandelbrot-Infinity-v1.0.0.apk** from the
[GitHub releases page](https://github.com/urbanrunnerx/mandelbrot-infinity/releases).
Open it on your Android device and allow installation from your browser or file
manager when Android prompts. The app supports Android 8 and newer with an updated
Android System WebView. It runs offline and requests no Android permissions.

The release APK is signed. Later updates must use the same private signing key;
a development APK uses a different key and cannot update an installed release.

See [the Android build documentation](android/README.md) for the Gradle project,
the lightweight Windows build, signing, CI, and verification commands.
