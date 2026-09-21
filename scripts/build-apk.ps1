<#
.SYNOPSIS
Builds and signs the Android APK with official SDK tools, without Gradle.
.DESCRIPTION
Requires JDK 17, Android platform 36 and build-tools 35.0.0. The signing key and
password file must be outside the source repository. See android/README.md.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$JdkHome,
    [Parameter(Mandatory=$true)][string]$SdkPlatform,
    [Parameter(Mandatory=$true)][string]$BuildTools,
    [Parameter(Mandatory=$true)][string]$KeyStore,
    [Parameter(Mandatory=$true)][string]$StorePasswordFile,
    [string]$KeyAlias = 'mandelbrot-infinity',
    [Parameter(Mandatory=$true)][string]$Output,
    [string]$BuildDirectory = (Join-Path ([IO.Path]::GetTempPath()) ('mandelbrot-build-' + [guid]::NewGuid().ToString('N')))
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $projectRoot 'android/app/src/main'
$androidJar = Join-Path $SdkPlatform 'android.jar'
foreach ($required in @($androidJar, (Join-Path $JdkHome 'bin/javac.exe'), (Join-Path $BuildTools 'aapt2.exe'), $KeyStore, $StorePasswordFile, (Join-Path $projectRoot 'web/index.html'))) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required input is missing: $required" }
}
$keyFullPath = [IO.Path]::GetFullPath($KeyStore)
if ($keyFullPath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($StorePasswordFile).StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Keep the release signing key and password file outside the published source repository.'
}
$BuildDirectory = [IO.Path]::GetFullPath($BuildDirectory)
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $BuildDirectory, (Join-Path $BuildDirectory 'classes'), (Join-Path $BuildDirectory 'dex'), (Join-Path $BuildDirectory 'generated'), (Split-Path -Parent $Output) -Force | Out-Null

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build tool failed ($LASTEXITCODE): $Program" }
}

# AGP normally merges these attributes. The standalone build adds them to a copy.
$manifest = [xml](Get-Content -Raw (Join-Path $sourceRoot 'AndroidManifest.xml'))
$manifest.manifest.SetAttribute('package', 'net.urbanrunnerx.mandelbrot')
$manifestPath = Join-Path $BuildDirectory 'AndroidManifest.xml'
$manifest.Save($manifestPath)
$resources = Join-Path $BuildDirectory 'resources.zip'
$baseApk = Join-Path $BuildDirectory 'base.apk'
$alignedApk = Join-Path $BuildDirectory 'aligned.apk'
$stagedAssets = Join-Path $BuildDirectory 'assets'
New-Item -ItemType Directory -Path $stagedAssets -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'web') | Where-Object Name -ne 'tests' | Copy-Item -Destination $stagedAssets -Recurse -Force
Invoke-Checked (Join-Path $BuildTools 'aapt2.exe') @('compile', '--dir', (Join-Path $sourceRoot 'res'), '-o', $resources)
Invoke-Checked (Join-Path $BuildTools 'aapt2.exe') @('link', '-o', $baseApk, '--manifest', $manifestPath, '--min-sdk-version', '26', '--target-sdk-version', '36', '--version-code', '1', '--version-name', '1.0.0', '-I', $androidJar, '-A', $stagedAssets, $resources, '--java', (Join-Path $BuildDirectory 'generated'))
$javaSources = @(Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'java') -Filter '*.java' -Recurse | ForEach-Object FullName)
Invoke-Checked (Join-Path $JdkHome 'bin/javac.exe') (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-classpath', $androidJar, '-d', (Join-Path $BuildDirectory 'classes')) + $javaSources)
Invoke-Checked (Join-Path $JdkHome 'bin/jar.exe') @('cf', (Join-Path $BuildDirectory 'classes.jar'), '-C', (Join-Path $BuildDirectory 'classes'), '.')
Invoke-Checked (Join-Path $JdkHome 'bin/java.exe') @('-cp', (Join-Path $BuildTools 'lib/d8.jar'), 'com.android.tools.r8.D8', '--min-api', '26', '--lib', $androidJar, '--output', (Join-Path $BuildDirectory 'dex'), (Join-Path $BuildDirectory 'classes.jar'))
Invoke-Checked (Join-Path $JdkHome 'bin/jar.exe') @('uf', $baseApk, '-C', (Join-Path $BuildDirectory 'dex'), 'classes.dex')
Invoke-Checked (Join-Path $BuildTools 'zipalign.exe') @('-p', '-f', '4', $baseApk, $alignedApk)
Invoke-Checked (Join-Path $JdkHome 'bin/java.exe') @('-jar', (Join-Path $BuildTools 'lib/apksigner.jar'), 'sign', '--ks', $keyFullPath, '--ks-key-alias', $KeyAlias, '--ks-pass', ('file:' + [IO.Path]::GetFullPath($StorePasswordFile)), '--out', $Output, $alignedApk)
Invoke-Checked (Join-Path $JdkHome 'bin/java.exe') @('-jar', (Join-Path $BuildTools 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', $Output)
Invoke-Checked (Join-Path $BuildTools 'zipalign.exe') @('-c', '-p', '4', $Output)
Write-Output "APK built and verified: $Output"
Get-FileHash -LiteralPath $Output -Algorithm SHA256
