/**
 * Build step: compile the System Audio Recording helper (`native/SystemAudioPermission.swift`) to
 * `build/native/slopweaver-system-audio`, where a dev run finds it and `yarn app` copies it into `Contents/MacOS`. Run
 * as `node build/makeSystemAudioPermission.js` by both `yarn start` and `yarn app`, so neither path runs without it. A
 * compiler failure stops the build with the compiler's own words rather than packaging an app whose guide cannot
 * read the permission. `xcrun` resolves the SDK: a bare `swiftc` from the Command Line Tools does not find the
 * standard library (measured, `swiftc -o /tmp/x native/SystemAudioPermission.swift` → "unable to load
 * standard library for target 'arm64-apple-macosx27.0.0'").
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { SYSTEM_AUDIO_HELPER_NAME } from "./systemAudioPermission";

const source = join(__dirname, "..", "native", "SystemAudioPermission.swift");
const outDir = join(__dirname, "native");
mkdirSync(outDir, { recursive: true });
const compiled = spawnSync("/usr/bin/xcrun", ["swiftc", "-O", source, "-o", join(outDir, SYSTEM_AUDIO_HELPER_NAME)], {
  stdio: "inherit",
});
if (compiled.error !== undefined || compiled.status !== 0) {
  const why = compiled.error === undefined ? `exit ${String(compiled.status)}` : compiled.error.message;
  process.stderr.write(`makeSystemAudioPermission: swiftc did not build the helper (${why})\n`);
  process.exit(1);
}
