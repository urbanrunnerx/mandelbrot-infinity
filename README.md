# Mandelbrot Infinity

An offline Mandelbrot explorer for Android, with continuous zoom, randomized starting views, and a touch-friendly interface.

**[Download the Android APK](https://github.com/urbanrunnerx/mandelbrot-infinity/releases/latest)**

## Explore

- Pinch to zoom and drag to move. On a computer, use the mouse wheel and drag.
- Hold **+** or **−** to keep zooming; use **Home** to return to the whole set.
- Choose **Random** to visit a different location. Enable **Random start** to begin somewhere new each time.
- Change the palette and increase iteration detail when exploring intricate boundaries.
- GPU previews make wide-view movement responsive. Background workers refine the image without blocking the controls.
- Everything is bundled in the APK. No account, ads, tracking, or network permission.

## What “unlimited zoom” means

There is no preset maximum or minimum zoom level. Coordinates use adaptive arbitrary precision, and deep rendering uses a high-precision reference orbit and perturbation with a direct high-precision fallback. Zooming does not stop at ordinary floating-point precision.

No finite device can calculate literal infinity. Available memory, calculation time, numeric exponent representation, and the chosen iteration budget remain practical limits. Very deep or difficult regions render more slowly. Black areas can mean either interior points or points that have not escaped within the selected iteration budget; increase detail when necessary.

The Mandelbrot set occupies a bounded part of the complex plane. Zooming far out naturally makes it smaller than a pixel; the app does not repeat or invent extra sets.

## Install on Android

1. Open the latest release on your Android phone and download `Mandelbrot-Infinity-v1.0.0.apk`.
2. Open the APK. If Android asks, allow installation from the browser or file manager you used.
3. Install **Mandelbrot Infinity**. The app works offline.

Requires Android 8.0 or newer and an up-to-date Android System WebView/Chrome with JavaScript BigInt and module-worker support. This is a directly downloadable, signed APK; it is not a Google Play listing. The release includes a SHA-256 checksum.

## Run in a desktop browser

Install Node.js 20 or newer, then run:

```sh
npm start
```

Open <http://127.0.0.1:4173>. There are no npm runtime dependencies and no installation step. Serve the `web` directory over HTTP(S); opening `index.html` directly with a `file:` URL does not support module workers reliably.

## Validate and build

```sh
npm test
cd android
./gradlew assembleDebug
```

On Windows use `gradlew.bat`. The Android build uses JDK 17+, SDK platform 36 and build-tools 35.0.0. The project includes a pinned Gradle wrapper. GitHub Actions validates the renderer and builds an Android artifact. See [Android build instructions](ANDROID.md) for release signing and the standalone Windows build.

## Design

The web application is plain JavaScript, CSS, Canvas and WebGL. It has no remote runtime dependencies. The Android shell is a small Java Activity serving bundled assets from a local HTTPS origin. Navigation and resource requests are restricted to those assets. Signing keys are kept outside the repository.

The numerical method follows the standard Mandelbrot recurrence `z(n+1) = z(n)^2 + c`; deep-zoom perturbation evaluates nearby orbits relative to an arbitrary-precision reference. For mathematical background, see [Claude Heiland-Allen’s perturbation notes](https://mathr.co.uk/mandelbrot/perturbation.pdf). Android’s [local content guidance](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) explains the local HTTPS asset pattern.

MIT licensed. See [LICENSE](LICENSE).
