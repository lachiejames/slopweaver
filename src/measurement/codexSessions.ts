/**
 * Whether a Codex thread is LIVE, from the files Codex processes hold open — positive evidence only.
 *
 * Codex exposes no live-thread registry the way Claude Code's `~/.claude/sessions/<pid>.json` does. What a live
 * thread does leave is two open files, MEASURED on `codex` v0.157.1 with `lsof -a -c codex -F pcfn`
 * (0.13 s; it exits 1 when nothing matches):
 *
 * - its rollout, `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<local time>-<thread id>.jsonl`, whose basename's
 *   trailing uuid is the `id` its own `session_meta` line records;
 * - its writer lock, `<CODEX_HOME>/thread-writer-locks/<thread id>.lock`.
 *
 * `CODEX_HOME` varies per install (`~/.codex`, `~/.codex-two`, …), so a scan carries the homes it judges against,
 * and a path counts only directly under one of them: the same shape anywhere else — a project fixture a Codex
 * process opened — names no thread. The holding process is `codex` or
 * `codex-code-mode-host`. The residue, stated: a Codex process that deliberately writes a decoy INSIDE a real
 * Codex home would still read live — this judges Codex's own layout, it authenticates no file.
 *
 * Absence proves NOTHING. One live process dropped its rollout between two reads of the same measurement, and a
 * thread whose rollout is not yet created, mid I/O recovery, or owned by an app server holds no file a scan would
 * see. So a match is `live`, and everything else is `not-observed` with why — never `dead`.
 */

/** One open file a Codex process holds, as `lsof -F pcfn` reports it. */
export interface CodexOpenFile {
  readonly pid: number;
  readonly command: string;
  readonly path: string;
}

/** One scan of every file Codex processes hold open, with the Codex homes it is judged against, or why it failed. */
export type CodexOpenFilesScan =
  | { readonly kind: "read"; readonly files: readonly CodexOpenFile[]; readonly homes: readonly string[] }
  | { readonly kind: "failed"; readonly why: string };

/** What a scan of Codex's open files says about one thread. */
export type CodexThreadObservation =
  | { readonly kind: "live"; readonly pid: number; readonly path: string }
  | { readonly kind: "not-observed"; readonly why: string };

/** Asks what Codex's open files say about one thread — the seam a caller injects, lazy `lsof` in production. */
export type CodexThreadObserver = (args: { readonly threadId: string }) => CodexThreadObservation;

/** The uuid Codex names a thread by — the shape both the rollout and the lock end in. */
const UUID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;

/**
 * A rollout, relative to its Codex home: `sessions/YYYY/MM/DD/rollout-<time>-<uuid>.jsonl`, the dated layout Codex
 * writes, so a directory merely named like a rollout is not one.
 */
const ROLLOUT_PATH = new RegExp(String.raw`^sessions/\d{4}/\d{2}/\d{2}/rollout-[^/]*-(${UUID})\.jsonl$`, "u");

/** A numeric descriptor: an open FILE, never `cwd`, `txt`, `rtd` or a memory map, which name no held thread. */
const OPEN_FILE_DESCRIPTOR = /^\d+$/u;

/** A writer lock, relative to its Codex home: `thread-writer-locks/<uuid>.lock`. */
const LOCK_PATH = new RegExp(String.raw`^thread-writer-locks/(${UUID})\.lock$`, "u");

/** The code-mode host's full command. */
const CODE_MODE_HOST = "codex-code-mode-host";

/**
 * The commands a Codex process runs under: `codex`, the code-mode host whole, and the code-mode host as an lsof
 * built on the kernel's 16-byte command name prints it — fifteen characters and the terminator, `codex-code-mode`.
 */
const CODEX_COMMANDS: ReadonlySet<string> = new Set(["codex", CODE_MODE_HOST, CODE_MODE_HOST.slice(0, 15)]);

/**
 * Whether lsof's command field names a Codex process. This machine's lsof printed `codex-code-mode-host` whole
 * (repro: `lsof -a -c codex -F c | sort -u`), but an lsof that reports the kernel's `MAXCOMLEN` name
 * cuts it to exactly `codex-code-mode`; any other cut is no name a kernel writes, so it is
 * refused rather than matched as a prefix.
 *
 * @param command the `c` field, without its tag
 * @returns whether the process is Codex's own
 */
function isCodexCommand({ command }: { command: string }): boolean {
  return CODEX_COMMANDS.has(command);
}

/**
 * The thread id a Codex rollout or writer-lock path names, or `undefined` when the path is neither or lies under
 * none of the given Codex homes.
 *
 * @param path an absolute path a Codex process holds open
 * @param homes every Codex home the path may lie under, each absolute
 * @returns the lowercase thread uuid
 */
export function codexThreadIdOfPath({ path, homes }: { path: string; homes: readonly string[] }): string | undefined {
  for (const home of homes) {
    const root = home.endsWith("/") ? home : `${home}/`;
    // A blank, relative or root home is no Codex home: an empty `CODEX_HOME` would otherwise make `/` one, and every
    // lock-shaped file on the disk would name a thread.
    if (!root.startsWith("/") || root === "/" || !path.startsWith(root)) {
      continue;
    }
    const relative = path.slice(root.length);
    const rollout = ROLLOUT_PATH.exec(relative);
    if (rollout !== null) {
      return rollout[1];
    }
    const lock = LOCK_PATH.exec(relative);
    if (lock !== null) {
      return lock[1];
    }
  }
  return undefined;
}

/**
 * Decode `lsof -F pcfn`'s field output into the open files of each Codex process.
 *
 * Each process opens with a `p<pid>` line and a `c<command>` line, then an `f<descriptor>` line and an `n<path>`
 * line per open object. Only a name under a NUMERIC descriptor is an open file: the working directory (`fcwd`), the
 * executable (`ftxt`) and memory maps are names too, and a directory named like a rollout would otherwise read as
 * one. A name before any process or descriptor, or under a command that is not Codex's, is
 * dropped rather than attributed to the wrong process.
 *
 * @param text the command's stdout
 * @returns every file a Codex process holds open on a numeric descriptor
 */
export function parseCodexOpenFiles({ text }: { text: string }): readonly CodexOpenFile[] {
  const files: CodexOpenFile[] = [];
  let cursor: LsofCursor = { command: undefined, descriptor: undefined, pid: undefined };
  for (const line of text.split("\n")) {
    const holder = line.startsWith("n") ? codexHolder(cursor) : undefined;
    if (holder !== undefined) {
      files.push({ ...holder, path: line.slice(1) });
    }
    cursor = advanceCursor({ cursor, line });
  }
  return files;
}

/** Where `lsof -F pcfn`'s field stream stands: the process and descriptor the next name line belongs to. */
interface LsofCursor {
  readonly pid: number | undefined;
  readonly command: string | undefined;
  readonly descriptor: string | undefined;
}

/**
 * The cursor after one field line: a process line opens a fresh process, a command or descriptor line sets its field,
 * and a name line spends the descriptor, so a second name never inherits it.
 */
function advanceCursor({ cursor, line }: { cursor: LsofCursor; line: string }): LsofCursor {
  const value = line.slice(1);
  switch (line.charAt(0)) {
    case "p": {
      const parsed = Number(value);
      return { command: undefined, descriptor: undefined, pid: Number.isInteger(parsed) ? parsed : undefined };
    }
    case "c":
      return { ...cursor, command: value };
    case "f":
      return { ...cursor, descriptor: value };
    case "n":
      return { ...cursor, descriptor: undefined };
    default:
      return cursor;
  }
}

/**
 * The Codex process a name line belongs to, when it is a file one holds: a known process, Codex's own command, and
 * a numeric descriptor.
 *
 * @returns the holding process, or `undefined` when the name is not a file a Codex process holds
 */
function codexHolder({
  pid,
  command,
  descriptor,
}: {
  pid: number | undefined;
  command: string | undefined;
  descriptor: string | undefined;
}): { readonly pid: number; readonly command: string } | undefined {
  if (pid === undefined || command === undefined || descriptor === undefined) {
    return undefined;
  }
  if (!isCodexCommand({ command }) || !OPEN_FILE_DESCRIPTOR.test(descriptor)) {
    return undefined;
  }
  return { command, pid };
}

/**
 * Whether a Codex thread is live, judged from one scan of Codex's open files.
 *
 * @param threadId the thread the caller asks about — a run writer's recorded session id
 * @param scan the files the scan found, or why it could not be taken
 * @returns `live` with the holding process when a rollout or writer lock for that thread is open, else
 *   `not-observed` with why — never a death verdict, because absence proves none
 */
export function observeCodexThread({
  threadId,
  scan,
}: {
  threadId: string;
  scan: CodexOpenFilesScan;
}): CodexThreadObservation {
  if (scan.kind === "failed") {
    return { kind: "not-observed", why: `Codex's open files could not be read — ${scan.why}` };
  }
  const wanted = threadId.toLowerCase();
  const held = scan.files.find((file) => codexThreadIdOfPath({ homes: scan.homes, path: file.path }) === wanted);
  if (held !== undefined) {
    return { kind: "live", path: held.path, pid: held.pid };
  }
  return {
    kind: "not-observed",
    why:
      "no Codex process holds this thread's rollout or writer lock, and Codex has no live-thread registry, so " +
      "absence does not prove death (a rollout not yet created, mid I/O recovery or owned by an app server holds none)",
  };
}
