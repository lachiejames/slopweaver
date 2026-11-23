# Download a release

A child page of the [desktop README](../README.md): the app for somebody without a `desktop install` build of their
own. The workflow is `.github/workflows/desktop-release.yml`; the clone picker is `checkoutSelectionShell.ts`.

## Install it

Download `Slopweaver-desktop-arm64.zip` (Apple silicon, macOS 13 or later) from this repository's Releases page,
expand it and move `Slopweaver.app` into Applications. The app is the console's shell, not the console: it still
serves it from a clone you set up by [getting started](../../docs/getting-started.md). On first open, with no clone
remembered, its note offers **Choose a Slopweaver clone…**, a folder picker; a folder holding `scripts/docs-site.sh`
and `site/package.json` is remembered and served from, any other is named on the note with the picker offered
again. The note offers the same picker whenever a remembered clone stops being one.

## How a release is built

The workflow builds each release on a `desktop-v<version>` tag (or a dispatch naming one), refusing a tag whose
version is not `desktop/package.json`'s, stamps the bundle with the tagged commit exactly as `desktop install` does,
and publishes the zip and its SHA-256. Which signing it gets is decided by the repository's secrets, and each
release's notes say which it got (six settings, named below):

- **None of the six set: ad-hoc signed, not notarised.** macOS refuses a downloaded copy of it ("damaged", or
  "cannot be checked for malicious software") until `xattr -dr com.apple.quarantine /Applications/Slopweaver.app`
  takes the download mark off. That skips Gatekeeper's check for that one app, so only for a copy downloaded from
  the Releases page on purpose. A rebuilt release is a new ad-hoc identity, so macOS asks for its permissions again.
- **All six set: Developer ID signed with the hardened runtime (`signing/entitlements.mac.plist`), notarised by
  Apple and stapled**, each checked (`codesign --verify`, `stapler validate`, `spctl --assess`) before anything is
  published. Four are secrets: `CSC_LINK`, the base64 of a Developer ID Application `.p12`, `CSC_KEY_PASSWORD`
  its password, and `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD`, which `notarytool` signs in with. Two are
  repository variables, `CSC_NAME` (the certificate's name) and `APPLE_TEAM_ID`, because the signature publishes
  both in every copy of the app (`codesign -dv` shows them to anybody). Obtaining that certificate needs an Apple
  Developer Program membership.
- **Some set: refused**, naming the missing ones, so a half-configured repository never publishes an ad-hoc build
  it meant to notarise.

The job runs on `macos-15`, the one runner outside `RUNNER_SELECTOR` that the lint gate allows, registered by
workflow and job in `SPECIAL_WORKFLOW_RUNNERS` (`src/devLint/ciRunnerFacts.ts`), so the exception never covers a
job added later.

## What is not proven yet

- The Developer ID lane has never run: no certificate is set on any repository yet. Its first release is the proof
  that the hardened runtime, the entitlements and the native System Audio helper all pass notarisation.
- The app cannot clone Slopweaver or install its dependencies for you; it serves an existing clone. A clone, a
  `yarn install` and the store are still [getting started](../../docs/getting-started.md)'s steps 1 to 3.
