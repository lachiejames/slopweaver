/**
 * `slopweaver protect` — the one writer of the owner's protected-path registry, `$SLOPWEAVER_HOME/protected-paths.json`.
 *
 * `add` protects a path (`read-only` or `no-access`), `remove` unprotects one, `list` shows them, and `check` says
 * whether one access to one path is refused. What each mode refuses, and where, is `../../../protectedPaths/decide.ts`
 * and the `PreToolUse` guard (`../../../admit/protectedPathGuard.ts`); this verb only keeps the list.
 *
 * A path is stored ABSOLUTE: a `~` is expanded and a relative path resolved against the caller's directory here, so
 * nothing downstream ever expands one. A mutation reads, edits and writes under the home's operation lock, so two
 * concurrent `protect` calls never lose one another's change, and an unreadable or malformed registry is reported and
 * NEVER overwritten — a registry this cannot read is the owner's list in an unknown state.
 */
import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { slopweaverHome } from "../../../config.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { ambientHatchOpen } from "../../../hatch/open.js";
import { hatchRefusal } from "../../../hatch/render.js";
import type { Logger } from "../../../lib/logger.js";
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { writeFileAtomic } from "../../../lib/writeAtomic.js";
import { type PathAccess, protectionHit } from "../../../protectedPaths/decide.js";
import { editProtectedPaths, type ProtectedPathEdit } from "../../../protectedPaths/edit.js";
import {
  PROTECTION_MODES,
  type ProtectedPathRegistry,
  type ProtectionMode,
  readProtectedPaths,
  renderProtectedPaths,
} from "../../../protectedPaths/registry.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { PROTECT_ADD_USAGE, PROTECT_CHECK_USAGE, PROTECT_LIST_USAGE, PROTECT_REMOVE_USAGE } from "./protectUsage.js";

/** The parsed flags every `protect` verb shares. */
interface ProtectArgs {
  readonly path: string | undefined;
  readonly mode: string | undefined;
  readonly why: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
  readonly write: boolean;
}

/** The seams the shell composes — real fs, clock and environment in production, plain fakes in a test. */
export interface ProtectDeps {
  readonly home: () => string;
  readonly cwd: () => string;
  readonly userHome: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly nowIso: () => string;
  readonly readText: (args: { path: string }) => string | undefined;
  readonly writeText: (args: { path: string; text: string }) => void;
  /** Deletes a file; a file already gone is not an error. */
  readonly removeFile: (args: { path: string }) => void;
  readonly lock: (args: { home: string; nowIso: string }) => (() => void) | string;
  readonly logger: Pick<Logger, "out" | "error">;
}

/**
 * Each verb's own flags, as its usage line advertises them. The parser below accepts their union — the
 * valued ones in {@link VALUED}, `--json` and `--write` bare — and `helpTruth.test.ts` holds each verb's
 * usage to its row here, through that parser.
 */
export const PROTECT_FLAG_NAMES = {
  add: ["--home", "--mode", "--why"],
  check: ["--home", "--write"],
  list: ["--home", "--json"],
  remove: ["--home"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/** The flags that take a value. */
const VALUED = new Set(["--mode", "--why", "--home"]);

/** Each verb's usage line, which also says which verbs exist. */
const USAGE: ReadonlyMap<string, string> = new Map([
  ["add", PROTECT_ADD_USAGE],
  ["check", PROTECT_CHECK_USAGE],
  ["list", PROTECT_LIST_USAGE],
  ["remove", PROTECT_REMOVE_USAGE],
]);

/**
 * Parse the words after the verb.
 *
 * @param rest the words after `protect <verb>`
 * @returns the flags, or the problems with them
 */
export function parseProtectArgs({ rest }: { rest: readonly string[] }): Result<ProtectArgs> {
  const values = new Map<string, string>();
  const positional: string[] = [];
  const problems: string[] = [];
  const flags = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index]!;
    if (VALUED.has(word)) {
      const value = rest[index + 1];
      if (value === undefined) {
        problems.push(`${word} needs a value`);
      } else {
        values.set(word, value);
      }
      index += 1;
    } else if (word === "--json" || word === "--write") {
      flags.add(word);
    } else if (word.startsWith("--")) {
      problems.push(`unknown flag ${word}`);
    } else {
      positional.push(word);
    }
  }
  if (positional.length > 1) {
    problems.push(`one path at a time, got ${String(positional.length)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    home: values.get("--home"),
    json: flags.has("--json"),
    mode: values.get("--mode"),
    path: positional[0],
    why: values.get("--why"),
    write: flags.has("--write"),
  });
}

/**
 * A path as the registry stores it: `~` expanded, a relative path resolved against the caller's directory.
 *
 * @param raw the path as typed
 * @param cwd the caller's directory
 * @param userHome the directory `~` names
 * @returns the absolute, normalised path
 */
export function absoluteProtectedPath({ raw, cwd, userHome }: { raw: string; cwd: string; userHome: string }): string {
  // `resolve` normalises and drops a trailing separator, and an absolute `raw` ignores `cwd`.
  if (raw === "~") {
    return resolve(userHome);
  }
  if (raw.startsWith("~/")) {
    return resolve(userHome, raw.slice(2));
  }
  return resolve(cwd, raw);
}

/** Whether a string is one of the two modes. */
function isMode(value: string): value is ProtectionMode {
  return (PROTECTION_MODES as readonly string[]).includes(value);
}

/** The registry, or `undefined` after reporting why it cannot be trusted. */
function loadRegistry({ file, deps }: { file: string; deps: ProtectDeps }): ProtectedPathRegistry | undefined {
  const read = readProtectedPaths({ file, readText: deps.readText });
  if (read.isErr()) {
    deps.logger.error({ msg: `protect: ${read.error.message}` });
    return undefined;
  }
  return read.value;
}

/** `protect list`. */
function runList({ file, args, deps }: { file: string; args: ProtectArgs; deps: ProtectDeps }): number {
  const registry = loadRegistry({ deps, file });
  if (registry === undefined) {
    return EXIT_ERROR;
  }
  if (args.json) {
    deps.logger.out({ line: JSON.stringify({ file, paths: registry.paths }) });
    return EXIT_OK;
  }
  if (registry.paths.length === 0) {
    deps.logger.out({ line: `protect: nothing is protected (${file} is absent or empty)` });
    return EXIT_OK;
  }
  for (const entry of registry.paths) {
    deps.logger.out({ line: `${entry.mode.padEnd(9)}  ${entry.path}  — ${entry.why} (added ${entry.addedIso})` });
  }
  return EXIT_OK;
}

/** `protect check`. */
function runCheck({ file, args, deps }: { file: string; args: ProtectArgs; deps: ProtectDeps }): number {
  if (args.path === undefined) {
    deps.logger.error({ msg: PROTECT_CHECK_USAGE });
    return EXIT_USAGE;
  }
  const registry = loadRegistry({ deps, file });
  if (registry === undefined) {
    return EXIT_ERROR;
  }
  const target = absoluteProtectedPath({ cwd: deps.cwd(), raw: args.path, userHome: deps.userHome });
  const access: PathAccess = args.write ? "write" : "read";
  const hit = protectionHit({ access, entries: registry.paths, target });
  if (hit === undefined) {
    deps.logger.out({ line: `protect: a ${access} of ${target} is allowed` });
    return EXIT_OK;
  }
  deps.logger.out({
    line: `protect: a ${access} of ${target} is REFUSED — inside ${hit.path} (${hit.mode}): ${hit.why}`,
  });
  return EXIT_OK;
}

/** The edit `add` or `remove` asks for, or a usage problem. */
function editOf({
  verb,
  args,
  deps,
}: {
  verb: string;
  args: ProtectArgs;
  deps: ProtectDeps;
}): ProtectedPathEdit | string {
  if (args.path === undefined) {
    return verb === "add" ? PROTECT_ADD_USAGE : PROTECT_REMOVE_USAGE;
  }
  const path = absoluteProtectedPath({ cwd: deps.cwd(), raw: args.path, userHome: deps.userHome });
  if (verb === "remove") {
    return { kind: "remove", path };
  }
  if (args.mode === undefined || !isMode(args.mode)) {
    return `--mode must be one of ${PROTECTION_MODES.join(", ")}\n${PROTECT_ADD_USAGE}`;
  }
  if (args.why === undefined || args.why.trim() === "") {
    return `--why is required: every refusal prints it\n${PROTECT_ADD_USAGE}`;
  }
  return { kind: "add", mode: args.mode, path, why: args.why.trim() };
}

/** `protect add` and `protect remove`: lock, read, edit, write. */
function runEdit({
  file,
  home,
  edit,
  deps,
}: {
  file: string;
  home: string;
  edit: ProtectedPathEdit;
  deps: ProtectDeps;
}): number {
  const release = deps.lock({ home, nowIso: deps.nowIso() });
  if (typeof release === "string") {
    deps.logger.error({ msg: `protect: ${release}` });
    return EXIT_ERROR;
  }
  try {
    const registry = loadRegistry({ deps, file });
    if (registry === undefined) {
      return EXIT_ERROR;
    }
    const wideningHatchOpen = ambientHatchOpen({ env: deps.env, id: "protect-remove" });
    const edited = editProtectedPaths({ edit, nowIso: deps.nowIso(), registry, wideningHatchOpen });
    if (edited.isErr()) {
      const message =
        edited.error.code === "WIDENING_REFUSED"
          ? hatchRefusal({ detail: edited.error.message, hatch: hatchFor({ id: "protect-remove" }) })
          : `protect: ${edited.error.message}`;
      deps.logger.error({ msg: message });
      return EXIT_ERROR;
    }
    // An empty registry is DELETED, never written: the read-side hook row starts no Node process while no registry
    // file exists, so an empty one left behind would tax every `Read` on the machine to protect nothing.
    if (edited.value.change !== "unchanged" && edited.value.registry.paths.length === 0) {
      deps.removeFile({ path: file });
    } else if (edited.value.change !== "unchanged") {
      deps.writeText({ path: file, text: renderProtectedPaths({ registry: edited.value.registry }) });
    }
    deps.logger.out({ line: `protect: ${edited.value.change} ${edit.path}` });
    return EXIT_OK;
  } finally {
    release();
  }
}

/**
 * The state home a verb reads: `--home` when given, else the injected default.
 *
 * @param home the `--home` value, when one was passed
 * @param deps the effectful seams, whose `home()` is the default
 * @returns the state home to read
 */
function homeOf({ home, deps }: { home: string | undefined; deps: ProtectDeps }): string {
  if (home !== undefined) {
    return home;
  }
  return deps.home();
}

/**
 * Run a `protect` verb over injected dependencies — the testable shell.
 *
 * @param argv the full process argv (`protect <verb>` starts at index 2)
 * @param deps the effectful seams
 * @returns the process exit code
 */
export function runProtectWithDeps({ argv, deps }: { argv: readonly string[]; deps: ProtectDeps }): number {
  const verb = argv[3];
  const rest = argv.slice(4);
  const verbUsage = verb === undefined ? undefined : USAGE.get(verb);
  if (verb === undefined || verbUsage === undefined) {
    deps.logger.error({ msg: [...USAGE.values()].join("\n") });
    return EXIT_USAGE;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: verbUsage });
    return EXIT_OK;
  }
  const parsed = parseProtectArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.logger.error({ msg: problem });
    });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = homeOf({ deps, home: args.home });
  const file = stateHomePaths({ home }).protectedPathsJson;
  if (verb === "list") {
    return runList({ args, deps, file });
  }
  if (verb === "check") {
    return runCheck({ args, deps, file });
  }
  const edit = editOf({ args, deps, verb });
  if (typeof edit === "string") {
    deps.logger.error({ msg: edit });
    return EXIT_USAGE;
  }
  return runEdit({ deps, edit, file, home });
}

/** A file's text, `undefined` when there is none; any other failure throws. */
function readTextOrAbsent({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
}

/** Production dependencies. */
function productionProtectDeps(): ProtectDeps {
  return {
    cwd: () => process.cwd(),
    env: process.env,
    home: slopweaverHome,
    lock: ({ home, nowIso }) => {
      const held = acquireOperationLock({ home, key: "protected-paths", nowIso });
      return held.isOk() ? held.value.release : held.error;
    },
    logger,
    nowIso: () => new Date().toISOString(),
    readText: readTextOrAbsent,
    removeFile: ({ path }) => {
      rmSync(path, { force: true });
    },
    userHome: homedir(),
    writeText: ({ path, text }) => {
      writeFileAtomic({ contents: text, fileMode: 0o600, path });
    },
  };
}

/**
 * Run a `protect` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runProtect(argv: readonly string[]): number {
  return runProtectWithDeps({ argv, deps: productionProtectDeps() });
}

export const protectCommand = defineCommand({ run: runProtect });
