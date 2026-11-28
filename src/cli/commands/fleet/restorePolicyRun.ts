/**
 * `slopweaver fleet restore-policy [--apply] [--config <path>] [--json]` — read, and with `--apply` turn off,
 * cmux's own restore of agent sessions (`terminal.autoResumeAgentSessions` in `~/.config/cmux/cmux.json`).
 *
 * On, cmux reopens every Claude seat as a bare `claude --resume <id>` with no setup-token descriptor, in no order,
 * so a seat on a setup token comes back without it; a seat on its plan store has none to lose. Off, cmux restores idle shells and `slopweaver fleet resume` brings the seats back, the supervisor first. The
 * edit itself, and why it is a splice rather than a rewrite, is `../../../cmux/restorePolicy.ts`; this file is the
 * flags, the file effects and the exit codes; the real file system and `cmux` binary it runs over are
 * `./restorePolicyDeps.ts`.
 *
 * Read mode exits 0 when the policy is off, 3 when it is on (the finding), 1 when the file cannot be read safely.
 * `--apply` backs the file up beside itself, writes atomically at the original mode, re-reads, restores the backup
 * if the re-read is not byte for byte the planned text, then asks cmux to reload its config — best effort, because
 * the setting is read at launch either way. It refuses, rather than edits, a file it could only rewrite lossily: a
 * symlink or a hard link (the rename would cut the other name loose), bytes that are not UTF-8 (decoding would replace
 * them, inside a comment the re-read cannot see), and a byte-order mark (the splice could move it mid-file). RESIDUE,
 * stated: nothing re-checks the path between the read and the rename, so a write cmux makes in that instant is lost —
 * the backup holds what was read.
 */
import { err, ok, type Result } from "#lib/result.js";

import { planRestorePolicyOff, type RestorePolicyReading, readRestorePolicy } from "../../../cmux/restorePolicy.js";
import { type RestorePolicyError, RestorePolicyErrors } from "../../../cmux/restorePolicyErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { boolFlag, fleetUsage, parseFleetArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import type { FleetCommandError } from "./errors.js";
import { productionRestorePolicyDeps } from "./restorePolicyDeps.js";

/** The verb's name, as its spec and usage are keyed. */
const VERB = "restore-policy";

/** Only the permission bits of a file's mode survive into the rewritten file. */
const PERMISSION_BITS = 0o777;

/** U+FEFF, refused anywhere in the file rather than carried through a splice. */
const BYTE_ORDER_MARK = "\uFEFF";

/** What sits at the config path, as `lstat` sees it — a symlink is NOT followed. */
export type ConfigFileState =
  | { readonly kind: "absent" }
  | { readonly kind: "symlink" }
  | { readonly kind: "not-a-file" }
  | { readonly kind: "file"; readonly mode: number; readonly links: number }
  | { readonly kind: "unreadable"; readonly detail: string };

/** What `cmux reload-config` did, as `--json` reports it. */
export type ReloadOutcome =
  | { readonly kind: "reloaded"; readonly output: string }
  | { readonly kind: "failed"; readonly detail: string }
  | { readonly kind: "skipped"; readonly why: string };

/** Everything `fleet restore-policy` touches outside itself. */
export interface RestorePolicyDeps {
  /** `~/.config/cmux/cmux.json`, the path cmux reads. */
  readonly defaultConfigPath: () => string;
  readonly inspect: (request: { path: string }) => ConfigFileState;
  readonly readText: (request: { path: string }) => Result<string, FleetCommandError>;
  /** Copy to a path that must not exist yet, so a backup never overwrites an older one. */
  readonly backupFile: (request: { from: string; to: string }) => Result<void, string>;
  /** Put a backup back over the config, atomically and at the config's own mode. */
  readonly restoreFile: (request: { from: string; to: string; fileMode: number }) => Result<void, string>;
  readonly writeText: (request: { path: string; contents: string; fileMode: number }) => Result<void, string>;
  readonly reloadConfig: () => Result<string, string>;
  readonly now: () => Date;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** The `--json` document. */
interface RestorePolicyDocument {
  readonly policy: RestorePolicyReading["kind"];
  readonly configPath: string;
  readonly wrote: boolean;
  readonly backupPath?: string;
  readonly reload?: ReloadOutcome;
}

/** Two digits, zero-padded. */
function pad2({ value }: { value: number }): string {
  return String(value).padStart(2, "0");
}

/**
 * The stamp a backup's name carries, `YYYYMMDD-HHMMSS` in LOCAL time — the shape their own existing
 * `cmux.json.<stamp>.bak` files already use, so they sort together in one listing.
 *
 * @param date the instant of the edit
 * @returns the stamp
 */
export function backupStamp({ date }: { date: Date }): string {
  const day = `${String(date.getFullYear())}${pad2({ value: date.getMonth() + 1 })}${pad2({ value: date.getDate() })}`;
  const time = `${pad2({ value: date.getHours() })}${pad2({ value: date.getMinutes() })}${pad2({ value: date.getSeconds() })}`;
  return `${day}-${time}`;
}

/** The human line for one reading. */
function readingLine({ reading, configPath }: { reading: RestorePolicyReading["kind"]; configPath: string }): string {
  switch (reading) {
    case "off":
      return `cmux restore policy: off — cmux restores idle shells and slopweaver fleet resume brings the seats back (${configPath})`;
    case "on-explicit":
      return `cmux restore policy: on, set true in ${configPath} — cmux relaunches Claude seats bare, so a seat on a setup token comes back without it; slopweaver fleet restore-policy --apply turns it off`;
    case "on-default":
      return `cmux restore policy: on, cmux's default (no autoResumeAgentSessions key in ${configPath}) — cmux relaunches Claude seats bare, so a seat on a setup token comes back without it; slopweaver fleet restore-policy --apply turns it off`;
    default: {
      const unreachable: never = reading;
      return unreachable;
    }
  }
}

/** Print one typed failure and answer the exit code it earns. */
function refuse({ deps, error }: { deps: RestorePolicyDeps; error: RestorePolicyError }): number {
  deps.writeDiagnostic(`fleet restore-policy: ${error.message}`);
  return EXIT_ERROR;
}

/** Print the outcome, as one JSON line or as the human lines. */
function report({
  deps,
  json,
  document,
  lines,
}: {
  deps: RestorePolicyDeps;
  json: boolean;
  document: RestorePolicyDocument;
  lines: readonly string[];
}): void {
  if (json) {
    deps.writeOut(JSON.stringify(document));
    return;
  }
  for (const line of lines) {
    deps.writeOut(line);
  }
}

/** Read the config's text, answering the typed failure for a path `lstat` could not read or that is not a file. */
function readableText({
  deps,
  configPath,
  state,
}: {
  deps: RestorePolicyDeps;
  configPath: string;
  state: ConfigFileState;
}): Result<string, RestorePolicyError> {
  if (state.kind === "unreadable") {
    return err(RestorePolicyErrors.unreadable({ detail: state.detail, path: configPath }));
  }
  if (state.kind === "not-a-file") {
    return err(RestorePolicyErrors.unreadable({ detail: "it is not a regular file", path: configPath }));
  }
  return deps
    .readText({ path: configPath })
    .mapErr((error): RestorePolicyError => RestorePolicyErrors.unreadable({ detail: error.message, path: configPath }));
}

/** Read mode: report the policy, exit 0 when off and 3 when on. */
function readMode({ deps, configPath, json }: { deps: RestorePolicyDeps; configPath: string; json: boolean }): number {
  const state = deps.inspect({ path: configPath });
  let policy: RestorePolicyReading["kind"] = "on-default";
  if (state.kind !== "absent") {
    const text = readableText({ configPath, deps, state });
    if (text.isErr()) {
      return refuse({ deps, error: text.error });
    }
    const reading = readRestorePolicy({ configText: text.value });
    if (reading.isErr()) {
      return refuse({ deps, error: reading.error });
    }
    policy = reading.value.kind;
  }
  const lines = [readingLine({ configPath, reading: policy })];
  if (state.kind === "absent") {
    lines.push(`  (no config file at ${configPath}; cmux writes its template there on launch)`);
  }
  report({ deps, document: { configPath, policy, wrote: false }, json, lines });
  return policy === "off" ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Ask cmux to re-read its config. Best effort: the policy is read at launch whether or not this lands. Skipped
 * when `--config` named a file other than the one cmux reads, so editing a copy never pokes their live cmux.
 */
function reload({ deps, configPath }: { deps: RestorePolicyDeps; configPath: string }): ReloadOutcome {
  if (configPath !== deps.defaultConfigPath()) {
    return { kind: "skipped", why: "--config names a file cmux does not read" };
  }
  const ran = deps.reloadConfig();
  if (ran.isErr()) {
    return { detail: ran.error, kind: "failed" };
  }
  return { kind: "reloaded", output: ran.value.trim() };
}

/** The line a reload outcome prints as. */
function reloadLine({ outcome }: { outcome: ReloadOutcome }): string {
  if (outcome.kind === "failed") {
    return `  cmux reload-config did not run (${outcome.detail}); nothing lost — the policy is read at launch`;
  }
  if (outcome.kind === "skipped") {
    return `  cmux reload-config skipped: ${outcome.why}`;
  }
  const said = outcome.output.length > 0 ? `: ${outcome.output}` : "";
  return `  cmux reload-config ran${said}`;
}

/**
 * The config's text and mode when it is a file `--apply` can edit losslessly, else the typed refusal: absent, a
 * symlink, unreadable, hard-linked, or carrying a byte-order mark.
 */
function editableFile({
  deps,
  configPath,
}: {
  deps: RestorePolicyDeps;
  configPath: string;
}): Result<{ readonly text: string; readonly mode: number }, RestorePolicyError> {
  const state = deps.inspect({ path: configPath });
  if (state.kind === "absent") {
    return err(RestorePolicyErrors.absent({ path: configPath }));
  }
  if (state.kind === "symlink") {
    return err(RestorePolicyErrors.symlink({ path: configPath }));
  }
  // An unreadable path or a non-file answers its own typed failure here, so past this the state is a file.
  const text = readableText({ configPath, deps, state });
  if (text.isErr()) {
    return err(text.error);
  }
  if (state.kind !== "file") {
    return err(RestorePolicyErrors.unreadable({ detail: state.kind, path: configPath }));
  }
  if (state.links > 1) {
    return err(RestorePolicyErrors.hardLinked({ links: state.links, path: configPath }));
  }
  if (text.value.includes(BYTE_ORDER_MARK)) {
    return err(RestorePolicyErrors.shapeRefused({ reason: "the file carries a byte-order mark" }));
  }
  return ok({ mode: state.mode, text: text.value });
}

/** Apply mode: back up, write, verify, restore on a bad re-read, reload. */
function applyMode({ deps, configPath, json }: { deps: RestorePolicyDeps; configPath: string; json: boolean }): number {
  const file = editableFile({ configPath, deps });
  if (file.isErr()) {
    return refuse({ deps, error: file.error });
  }
  const now = deps.now();
  const plan = planRestorePolicyOff({ configText: file.value.text, nowIso: now.toISOString() });
  if (plan.isErr()) {
    return refuse({ deps, error: plan.error });
  }
  if (plan.value.kind === "unchanged") {
    report({
      deps,
      document: { configPath, policy: "off", wrote: false },
      json,
      lines: [`${readingLine({ configPath, reading: "off" })}; nothing to write`],
    });
    return EXIT_OK;
  }
  const backupPath = `${configPath}.${backupStamp({ date: now })}.bak`;
  const backedUp = deps.backupFile({ from: configPath, to: backupPath });
  if (backedUp.isErr()) {
    const detail = `the backup ${backupPath} failed (${backedUp.error}), so nothing was written`;
    return refuse({ deps, error: RestorePolicyErrors.writeFailed({ detail, path: configPath }) });
  }
  const fileMode = file.value.mode & PERMISSION_BITS;
  const written = deps.writeText({ contents: plan.value.configText, fileMode, path: configPath });
  if (written.isErr()) {
    return refuse({ deps, error: RestorePolicyErrors.writeFailed({ detail: written.error, path: configPath }) });
  }
  const verified = verifyWritten({ backupPath, configPath, deps, fileMode, planned: plan.value.configText });
  if (verified !== undefined) {
    return refuse({ deps, error: verified });
  }
  const outcome = reload({ configPath, deps });
  report({
    deps,
    document: { backupPath, configPath, policy: "off", reload: outcome, wrote: true },
    json,
    lines: [
      `cmux restore policy: off — wrote ${configPath} (${plan.value.how}); backup ${backupPath}`,
      "  takes effect at the next cmux launch: cmux restores idle shells, and slopweaver fleet resume brings the seats back, supervisor first",
      "  this relies on the MAIN checkout's slopweaver fleet resume already carrying the cold-seat recovery — apply it only once that build is on main",
      reloadLine({ outcome }),
      `  revert: cp ${backupPath} ${configPath}`,
    ],
  });
  return EXIT_OK;
}

/**
 * Re-read the written file; unless it is byte for byte the planned text, put the backup back. `undefined` when it
 * verified. The whole text is compared, not only the policy, because a comment the policy read cannot see is their too.
 */
function verifyWritten({
  deps,
  configPath,
  backupPath,
  fileMode,
  planned,
}: {
  deps: RestorePolicyDeps;
  configPath: string;
  backupPath: string;
  fileMode: number;
  planned: string;
}): RestorePolicyError | undefined {
  const reread = deps.readText({ path: configPath });
  if (reread.isOk() && reread.value === planned) {
    return undefined;
  }
  const restored = deps.restoreFile({ fileMode, from: backupPath, to: configPath });
  const restoredText = restored.isOk()
    ? `restored ${configPath} from ${backupPath}`
    : `and restoring it from ${backupPath} failed too (${restored.error}): cp ${backupPath} ${configPath} by hand`;
  return RestorePolicyErrors.editUnverified({
    detail: `the written file did not re-read as the planned text; ${restoredText}`,
  });
}

/**
 * Run `fleet restore-policy` against injected seams.
 *
 * @param rest the argv tail after `fleet restore-policy`
 * @param deps the file system, the cmux CLI, the clock and the two output channels
 * @returns 0 when the policy is (now) off, 3 when read mode finds it on, 2 on a usage error, 1 on any refusal
 */
export function runFleetRestorePolicy({ rest, deps }: { rest: readonly string[]; deps: RestorePolicyDeps }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(fleetUsage({ verb: VERB }));
    return EXIT_OK;
  }
  const parsed = parseFleetArgs({ rest, verb: VERB });
  if (parsed.isErr()) {
    deps.writeDiagnostic(`fleet ${VERB}: ${parsed.error.join("; ")}`);
    deps.writeDiagnostic(fleetUsage({ verb: VERB }));
    return EXIT_USAGE;
  }
  if (parsed.value.positionals.length > 0) {
    deps.writeDiagnostic(`fleet ${VERB}: takes no positional argument (got ${parsed.value.positionals.join(" ")})`);
    deps.writeDiagnostic(fleetUsage({ verb: VERB }));
    return EXIT_USAGE;
  }
  const configPath = configPathOf({ deps, named: stringFlag({ name: "config", parsed: parsed.value }) });
  const json = boolFlag({ name: "json", parsed: parsed.value });
  if (boolFlag({ name: "apply", parsed: parsed.value })) {
    return applyMode({ configPath, deps, json });
  }
  return readMode({ configPath, deps, json });
}

/** The config file to read or write: the one `--config` named, else cmux's own. */
function configPathOf({ named, deps }: { named: string | undefined; deps: RestorePolicyDeps }): string {
  if (named !== undefined) {
    return named;
  }
  return deps.defaultConfigPath();
}

/** `slopweaver fleet restore-policy`. */
export const fleetRestorePolicyCommand = defineCommand({
  run: (argv) => runFleetRestorePolicy({ deps: productionRestorePolicyDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
