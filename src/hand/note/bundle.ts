/**
 * The application bundle the floating note runs as — composed as bytes, written by `./raise.ts`.
 *
 * ## Why a bundle at all
 *
 * `no-headless` (`src/devLint/noHeadless.ts`) bans every asynchronous `node:child_process` member outright,
 * with no allowlist and no marker, so a verb cannot start something that outlives it by spawning. What it
 * CAN do is `execFileSync("open", …)`, which hands the launch to LaunchServices and returns — the same
 * primitive `../../browser/foreground.ts` already uses to bring an app back to the front. `open` needs an
 * app to open, so the note is one.
 *
 * That is not a way around the rule. Rule 2's property is VISIBILITY, and a floating window is the most
 * visible thing this repository draws: the owner can see it, move it and close it, and it runs no model.
 *
 * ## Why NH005 does not fire on this `Info.plist`
 *
 * NH005 bans a launchd JOB DEFINITION — a `.plist` carrying `Program` or `ProgramArguments`. An application
 * bundle's `Info.plist` names its executable with `CFBundleExecutable`, which is a different key describing
 * a different thing: nothing here asks launchd to keep anything running.
 * `src/__tests__/unit/hand/bundle.test.ts` asserts the absence of both banned keys rather than trusting it.
 *
 * ## `LSUIElement`
 *
 * The note has no Dock tile and no menu bar. Without it, raising a step would put an icon in the owner's Dock for
 * the duration, which is a second thing to notice about a feature whose whole job is to be the one thing.
 *
 * Pure: a program in, files out. No I/O.
 */

/** The bundle's identifier. Stable, so macOS treats a re-raise as the same app rather than a new one. */
const NOTE_BUNDLE_ID = "dev.slopweaver.hand-note";

/** The executable's name inside `Contents/MacOS`, and the value `CFBundleExecutable` carries. */
export const NOTE_EXECUTABLE = "slopweaver-hand-note";

/** What the bundle is called, which is what macOS shows if it ever names the app. */
const NOTE_BUNDLE_NAME = "Slopweaver";

/** One file of the bundle: where it goes under the `.app`, what is in it, and whether it must be runnable. */
export interface BundleFile {
  /** Path relative to the `.app` directory, always with `/` separators. */
  readonly relativePath: string;
  readonly contents: string;
  readonly executable: boolean;
}

/**
 * The bundle's `Info.plist`.
 *
 * Written as a literal rather than serialised from a structure: it is nine fixed keys that never vary per
 * step, and a plist writer would be a dependency earning nothing.
 *
 * @returns the plist's exact bytes
 */
function infoPlist(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "\t<key>CFBundleName</key>",
    `\t<string>${NOTE_BUNDLE_NAME}</string>`,
    "\t<key>CFBundleIdentifier</key>",
    `\t<string>${NOTE_BUNDLE_ID}</string>`,
    "\t<key>CFBundleExecutable</key>",
    `\t<string>${NOTE_EXECUTABLE}</string>`,
    "\t<key>CFBundlePackageType</key>",
    "\t<string>APPL</string>",
    "\t<key>CFBundleInfoDictionaryVersion</key>",
    "\t<string>6.0</string>",
    "\t<key>LSUIElement</key>",
    "\t<true/>",
    "\t<key>NSHighResolutionCapable</key>",
    "\t<true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

/**
 * The launcher macOS runs, which does one thing: hand the panel program to `osascript`.
 *
 * It resolves the program's path from its OWN location rather than taking an argument, because `open -a`
 * passes nothing. A bundle is therefore self-contained: every path in it is relative to itself.
 *
 * @returns the launcher script's exact bytes
 */
function launcher(): string {
  return [
    "#!/bin/sh",
    "set -eu",
    'exec /usr/bin/osascript -l JavaScript "$(dirname "$0")/../Resources/panel.js"',
    "",
  ].join("\n");
}

/**
 * Every file of the note's application bundle.
 *
 * @param panelSource the JXA program `../note/panel.ts` composed for this step
 * @returns the three files to write under the `.app`, each with the mode it needs
 */
export function handNoteBundleFiles({ panelSource }: { panelSource: string }): readonly BundleFile[] {
  return [
    { contents: infoPlist(), executable: false, relativePath: "Contents/Info.plist" },
    { contents: launcher(), executable: true, relativePath: `Contents/MacOS/${NOTE_EXECUTABLE}` },
    { contents: panelSource, executable: false, relativePath: "Contents/Resources/panel.js" },
  ];
}
