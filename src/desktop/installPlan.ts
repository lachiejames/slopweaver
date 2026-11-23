/**
 * The decisions `slopweaver desktop install` makes, as pure functions over what it read: where the app goes,
 * the names it is staged and backed up under, which other copies LaunchServices still knows by the same
 * identifier, which processes are the app, and what a Spotlight status line and the app's saved state say.
 * The effects live in `cli/commands/desktop/installRun.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type DesktopInstallError, DesktopInstallErrors } from "./errors.js";

/** The bundle identifier every build carries (`desktop/package.json` `build.appId`), so there is only ever one app. */
export const BUNDLE_ID = "ai.slopweaver.desktop";

/** Where the app is installed: the system Applications folder, which Launchpad, Raycast and Spotlight all list. */
export const APPLICATIONS = "/Applications";

/** The bundle's name, and so its path under {@link APPLICATIONS}. */
export const BUNDLE_NAME = "Slopweaver.app";

/** The one installed copy. */
export const INSTALLED_BUNDLE = `${APPLICATIONS}/${BUNDLE_NAME}`;

/**
 * The System Audio Recording helper inside any copy of the bundle (`desktop/src/systemAudioPermission.ts`): beside
 * the executable, so the re-sign signs it with the rest. Lower-case, so it never reads as the app's own process.
 */
export const SYSTEM_AUDIO_HELPER_BUNDLE_PATH = "Contents/MacOS/slopweaver-system-audio";

/** The main executable inside any copy of the bundle; a helper process's path differs after `MacOS/`. */
const EXECUTABLE_SUFFIX = `/${BUNDLE_NAME}/Contents/MacOS/Slopweaver`;

/**
 * Whether this machine can run the build: `yarn app` packages for macOS on Apple silicon only.
 *
 * @returns nothing when it can, else why not
 */
export function hostSupported({
  platform,
  arch,
}: {
  platform: string;
  arch: string;
}): Result<void, DesktopInstallError> {
  if (platform !== "darwin" || arch !== "arm64") {
    return err(DesktopInstallErrors.unsupportedHost({ arch, platform }));
  }
  return ok(undefined);
}

/** The three paths of one replacement. */
export interface SwapPaths {
  /** Where the app lives once installed. */
  readonly installed: string;
  /** The new build, copied beside it first so the final move is a rename on one volume. */
  readonly staged: string;
  /** The previous install, kept until the new one has been seen running and put back if it never runs. */
  readonly backup: string;
  /**
   * Where the backup is renamed once the new build is trusted, before it is deleted, so a deletion that fails
   * part way leaves a folder recovery deletes rather than a damaged backup it would restore.
   */
  readonly discard: string;
}

/**
 * The paths a replacement uses. The staged, backup and discard copies are hidden and do NOT end in `.app`, so none
 * is ever listed as a second Slopweaver while it exists.
 *
 * @param applications the folder the app is installed in
 * @param nonce a value unique to this run
 * @returns the installed, staged, backup and discard paths
 */
export function swapPaths({ applications, nonce }: { applications: string; nonce: string }): SwapPaths {
  return {
    backup: `${applications}/.Slopweaver-previous-${nonce}`,
    discard: `${applications}/.Slopweaver-discarded-${nonce}`,
    installed: `${applications}/${BUNDLE_NAME}`,
    staged: `${applications}/.Slopweaver-installing-${nonce}`,
  };
}

/** What an earlier install left behind in the Applications folder, and what to do with it. */
export interface LeftoverPlan {
  /** A backup to rename back to the install, replacing whatever is there; undefined when there is none. */
  readonly restore: string | undefined;
  /** Hidden staging, discarded and backup folders to delete. */
  readonly remove: readonly string[];
}

/**
 * Recover from an install that was killed part way. A backup outlives its install only until the new build has
 * been seen running, so finding one means the build in place never was — or that no build is in place at all,
 * the swap killed between its two renames, since nothing in Node exchanges two paths atomically. Either way a
 * backup goes back, over whatever is installed. Recovery runs first on every install, so a run killed alone
 * leaves one; several mean overlapping installs each backed up the one before, so every backup but the oldest is
 * an unvalidated build, and the oldest — built first — is the last app known to work. Every other staging or
 * backup folder is deleted, since none is that app, and so is every discarded one: a backup is renamed there
 * only once its replacement was trusted, so it is never restored even when its deletion stopped part way. The
 * install that found them then builds afresh.
 *
 * @param entries the Applications folder's entries, each name with its modification time
 * @returns the backup to restore, if any, and the folders to delete
 */
export function leftoverPlan({ entries }: { entries: readonly { name: string; mtimeMs: number }[] }): LeftoverPlan {
  const backups = entries
    .filter(({ name }) => name.startsWith(".Slopweaver-previous-"))
    .toSorted((a, b) => a.mtimeMs - b.mtimeMs)
    .map(({ name }) => name);
  const staged = entries.filter(({ name }) => name.startsWith(".Slopweaver-installing-")).map(({ name }) => name);
  const discarded = entries.filter(({ name }) => name.startsWith(".Slopweaver-discarded-")).map(({ name }) => name);
  return { remove: [...backups.slice(1), ...staged, ...discarded], restore: backups[0] };
}

/** One bundle LaunchServices has registered: where it is and the identifier it carries. */
export interface RegisteredBundle {
  readonly path: string;
  readonly identifier: string;
}

/**
 * Every bundle in `lsregister -dump`, read record by record — the dump separates records with a line of dashes,
 * and a path is only ever paired with the identifier in its own record.
 *
 * @param dump what `lsregister -dump` printed
 * @returns each record carrying both a path and an identifier, in dump order
 */
export function registeredBundles({ dump }: { dump: string }): readonly RegisteredBundle[] {
  const bundles: RegisteredBundle[] = [];
  for (const record of dump.split(/^-{20,}\s*$/mu)) {
    const path = fieldOf({ name: "path", record });
    const identifier = fieldOf({ name: "identifier", record });
    if (path !== undefined && identifier !== undefined && !/\s/u.test(identifier)) {
      bundles.push({ identifier, path: withoutHandle({ value: path }) });
    }
  }
  return bundles;
}

/** A record's `name:` line's value, trimmed; undefined when the record has none or it is empty. */
function fieldOf({ record, name }: { record: string; name: string }): string | undefined {
  const line = record.split("\n").find((each) => each.startsWith(`${name}:`));
  if (line === undefined) {
    return undefined;
  }
  const value = line.slice(name.length + 1).trim();
  return value === "" ? undefined : value;
}

/** A dump path without the ` (0x1648)` handle macOS appends to it. */
function withoutHandle({ value }: { value: string }): string {
  const open = value.lastIndexOf(" (0x");
  if (open < 0 || !value.endsWith(")") || !/^[0-9a-f]+$/u.test(value.slice(open + 4, -1))) {
    return value;
  }
  return value.slice(0, open).trimEnd();
}

/**
 * Every other copy of the app LaunchServices has registered — an old `desktop/dist` build in a checkout or a
 * worktree, which opens as a second "Slopweaver" — chosen by IDENTIFIER, so another app that happens to be called
 * Slopweaver.app (an old archive app, say) is never touched, and a helper bundle, which carries its own
 * identifier, never is either. The copies are left on disk; only their registration goes.
 *
 * @param bundles the registered bundles, from {@link registeredBundles}
 * @param identifier the app's bundle identifier
 * @param installed the canonical path, which is kept
 * @returns the other registered paths carrying that identifier, each once, in dump order
 */
export function staleRegistrations({
  bundles,
  identifier,
  installed,
}: {
  bundles: readonly RegisteredBundle[];
  identifier: string;
  installed: string;
}): readonly string[] {
  const paths = new Set<string>();
  for (const bundle of bundles) {
    if (bundle.identifier === identifier && bundle.path !== installed) {
      paths.add(bundle.path);
    }
  }
  return [...paths];
}

/**
 * The pids of every running copy of the app's main process, from `ps -axo pid=,command=`: any bundle path, so a
 * copy opened from a build folder quits too, and never a helper process, which exits with its app.
 *
 * @param ps what `ps -axo pid=,command=` printed
 * @param bundle only copies running from this bundle path; every copy when absent
 * @returns the pids, in the order listed
 */
export function runningPids({ ps, bundle }: { ps: string; bundle?: string }): readonly number[] {
  const pids: number[] = [];
  for (const line of ps.split("\n")) {
    const trimmed = line.trimStart();
    const gap = trimmed.search(/\s/u);
    const pid = trimmed.slice(0, gap);
    if (gap <= 0 || !/^\d+$/u.test(pid)) {
      continue;
    }
    const command = trimmed.slice(gap).trimStart();
    const isCopy = bundle === undefined ? runsExecutable({ command }) : runsFrom({ bundle, command });
    if (isCopy) {
      pids.push(Number(pid));
    }
  }
  return pids;
}

/** Whether any occurrence of the app's executable path in a command ends the line or is followed by a space. */
function runsExecutable({ command }: { command: string }): boolean {
  for (let at = command.indexOf(EXECUTABLE_SUFFIX); at >= 0; at = command.indexOf(EXECUTABLE_SUFFIX, at + 1)) {
    if (endsWord({ at: at + EXECUTABLE_SUFFIX.length, command })) {
      return true;
    }
  }
  return false;
}

/** Whether a command's executable is exactly this bundle's main executable, not a path that merely starts with it. */
function runsFrom({ command, bundle }: { command: string; bundle: string }): boolean {
  const executable = `${bundle}/Contents/MacOS/Slopweaver`;
  return command.startsWith(executable) && endsWord({ at: executable.length, command });
}

/** Whether a command ends at `at` or has a space there, so the path before it is the whole executable. */
function endsWord({ command, at }: { command: string; at: number }): boolean {
  const after = command.charAt(at);
  return after === "" || after === " ";
}

/** One look at the app just opened: whether a copy runs from the install, and whether its state names the checkout. */
export interface OpenPoll {
  readonly running: boolean;
  readonly saved: boolean;
}

/** How opening the new build ended: kept, never started, started then stopped, or running without the checkout. */
export type OpenVerdict = "ready" | "never-ran" | "stopped" | "not-saved";

/**
 * Judge the polls taken since the new build was opened. It is READY only once it has run for `hold` polls in a
 * row with the checkout saved — seen once is not enough, since a build that crashes a second after starting would
 * otherwise cost the previous app its backup, and the saved state may predate it. At the deadline, a copy never
 * seen is NEVER-RAN, one not running at the last poll STOPPED, and one still running is NOT-SAVED: slow, so kept.
 *
 * @param polls every poll so far, oldest first
 * @param hold how many consecutive running polls make the build trusted
 * @param deadline how many polls are taken before judging
 * @returns the verdict, or undefined while it is still to be decided
 */
export function openVerdict({
  polls,
  hold,
  deadline,
}: {
  polls: readonly OpenPoll[];
  hold: number;
  deadline: number;
}): OpenVerdict | undefined {
  let streak = 0;
  for (const poll of polls) {
    streak = poll.running ? streak + 1 : 0;
  }
  const last = polls.at(-1);
  if (last === undefined) {
    return undefined;
  }
  if (last.saved && streak >= hold) {
    return "ready";
  }
  if (polls.length < deadline) {
    return undefined;
  }
  if (!polls.some(({ running }) => running)) {
    return "never-ran";
  }
  if (!last.running) {
    return "stopped";
  }
  return "not-saved";
}

/** Whether Spotlight indexes this Mac's root volume. */
export type SpotlightState = "enabled" | "disabled" | "unknown";

/**
 * Spotlight's state, from `mdutil -s /`. Both spellings macOS uses for a switched-off index count as disabled.
 *
 * @param mdutil what `mdutil -s /` printed
 * @returns the state
 */
export function spotlightState({ mdutil }: { mdutil: string }): SpotlightState {
  if (/Indexing and searching disabled|Spotlight server is disabled/u.test(mdutil)) {
    return "disabled";
  }
  if (/Indexing enabled/u.test(mdutil)) {
    return "enabled";
  }
  return "unknown";
}

/**
 * The line the install prints about Spotlight. With indexing switched off, Spotlight's search finds nothing new
 * and the install does not ask it to, while Launchpad, Raycast and the Finder still list everything in
 * Applications.
 *
 * @param state Spotlight's state
 * @param mdutil what `mdutil -s /` printed, quoted when the state is unknown
 * @returns the line
 */
export function spotlightLine({ state, mdutil }: { state: SpotlightState; mdutil: string }): string {
  switch (state) {
    case "disabled":
      return "spotlight: indexing is switched off on this Mac, so Spotlight search lists nothing new — Launchpad, Raycast and the Finder list the app";
    case "enabled":
      return "spotlight: asked to index the app";
    case "unknown":
      return `spotlight: indexing state unread (${mdutil.trim().split("\n").at(-1)!.trim()}) — asked to index the app`;
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

/** What `desktop install` was asked for on its command line. */
export interface DesktopInstallArgs {
  /** Print the usage and stop. */
  readonly help: boolean;
  /** The Slopweaver home to resolve the main checkout from; the default home when undefined. */
  readonly home: string | undefined;
}

/**
 * Parse the verb's arguments strictly, before anything is touched: nothing, `--help`/`-h`, or one `--home <dir>`
 * whose value is not itself a flag.
 *
 * @param args the arguments after the verb
 * @returns what was asked for, or undefined when the arguments are not the verb's
 */
export function desktopInstallArgs({ args }: { args: readonly string[] }): DesktopInstallArgs | undefined {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { help: true, home: undefined };
  }
  if (args.length === 0) {
    return { help: false, home: undefined };
  }
  const value = args[1];
  if (args.length === 2 && args[0] === "--home" && value !== undefined && !value.startsWith("-") && value !== "") {
    return { help: false, home: value };
  }
  return undefined;
}

/**
 * The checkout the app's saved state names, from its `state.json`.
 *
 * @param text the file's contents
 * @returns the path, or undefined when the file names none or is not JSON
 */
export function rememberedCheckout({ text }: { text: string }): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("checkout" in parsed)) {
    return undefined;
  }
  const { checkout } = parsed;
  return typeof checkout === "string" ? checkout : undefined;
}
