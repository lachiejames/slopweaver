/**
 * Where the two captured-turn sources live on this machine — the one decision the `dictations` and
 * `codex-messages` legs make about a path OUTSIDE the state home. Pure: every input is passed in.
 *
 * An explicit flag always wins. Without one, a source is read only when the import runs against the default home,
 * `~/.slopweaver` itself: the same rule `claudeProjectsForHome` (`./claudeMemorySync.ts`) applies to Claude Code's
 * memory, and for the same reason — a `--home` rehearsal or a test must never read the operator's own dictations
 * into a throwaway home. So for any other home, no flag means the source is not read, and the leg says so.
 */
import { join, resolve } from "node:path";

/** What every resolution is given. */
interface CaptureSourceInput {
  /** The directory a flag named, if one did. */
  readonly flag: string | undefined;
  /** The state home the import runs against. */
  readonly home: string;
  /** `~/.slopweaver` — the one home whose user's sources are read by default. */
  readonly defaultHome: string;
  /** The account's home directory. */
  readonly userHome: string;
}

/**
 * The dictations folder for this import.
 *
 * @returns the flag's directory; `<user home>/Documents/superwhisper/recordings` (Superwhisper's own default, the one
 *   layout read today) for the default home; or `undefined` when neither applies
 */
export function resolveDictationsFolder({ flag, home, defaultHome, userHome }: CaptureSourceInput): string | undefined {
  if (flag !== undefined) {
    return flag;
  }
  if (resolve(home) !== resolve(defaultHome)) {
    return undefined;
  }
  return join(userHome, "Documents", "superwhisper", "recordings");
}

/**
 * The Codex home for this import.
 *
 * @param codexHomeEnv `$CODEX_HOME`, which Codex itself honours, when set
 * @returns the flag's directory; `$CODEX_HOME` or `<user home>/.codex` for the default home; or `undefined` when
 *   neither applies
 */
export function resolveCodexHome({
  flag,
  home,
  defaultHome,
  userHome,
  codexHomeEnv,
}: CaptureSourceInput & { codexHomeEnv: string | undefined }): string | undefined {
  if (flag !== undefined) {
    return flag;
  }
  if (resolve(home) !== resolve(defaultHome)) {
    return undefined;
  }
  if (codexHomeEnv !== undefined && codexHomeEnv !== "") {
    return codexHomeEnv;
  }
  return join(userHome, ".codex");
}

/**
 * The note a leg prints when its source was not resolved for this home.
 *
 * @param flag the flag that would name the source
 * @returns the note
 */
export function sourceNotResolvedNote({ flag }: { flag: string }): string {
  return `not read: this is not the default home ~/.slopweaver, so its user's own files are left alone — pass ${flag} <dir> to read one`;
}
