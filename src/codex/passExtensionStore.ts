/**
 * The review-pass extension register on disk — the effectful half of `./passExtension.ts`.
 *
 * One append-only JSONL file, `$SLOPWEAVER_HOME/codex-pass-extensions/extensions.jsonl`, owner-only. An ABSENT file
 * is an empty register: no extension was ever granted. A line that will not decode grants nothing and is reported
 * beside the rows that did, so a reader can say the cap it applied may be lower than the supervisor approved —
 * reading a damaged row as zero only ever refuses a pass, never admits one. A file that exists and cannot be read
 * at all is an error, never an empty register, and so is a register whose directory is a symbolic link: both the
 * read and the append refuse one, since `noFollow` guards only the file's own name. `home` is REQUIRED, never
 * defaulted, so a test cannot write into the operator's own register.
 */
import { lstatSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { appendLines } from "#lib/appendSeparator.js";
import { err, ok, type Result } from "#lib/result.js";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import {
  type CodexPassExtension,
  decodePassExtension,
  type PassExtensionError,
  PassExtensionErrors,
} from "./passExtension.js";

/**
 * The operation-lock key `codex extend` holds across its read of the register, its sequence check and its append,
 * so two concurrent grants cannot both read the same register and both pass the one-per-run-and-lane rule.
 */
export const PASS_EXTENSION_LOCK_KEY = "codex-pass-extensions";

/** Owner-only permissions, matching the other journals under the state home. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * One register line that would not decode: what was wrong with it, and the run it names when that much can still
 * be read — so `codex extend` can tell a damaged row of ANOTHER run from one that may be this run's own.
 *
 * @internal a field of the exported read, never imported by name.
 */
export interface UnreadableExtensionLine {
  readonly detail: string;
  readonly run: string | undefined;
}

/** What the register held: every row that decoded, and one entry per line that did not. */
export interface PassExtensionRead {
  readonly rows: readonly CodexPassExtension[];
  readonly unreadable: readonly UnreadableExtensionLine[];
}

/** The failure's message, whatever was thrown. */
function messageOf({ error }: { error: unknown }): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a thrown value is the filesystem saying the file is not there. */
function isAbsent({ error }: { error: unknown }): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The `run` a parsed but undecodable line names, when it names one as a non-empty string. */
function runNamedBy({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "object" || value === null || !("run" in value)) {
    return undefined;
  }
  const { run } = value;
  if (typeof run !== "string" || run.length === 0) {
    return undefined;
  }
  return run;
}

/**
 * Why the register's own directory may not be trusted: it is a symbolic link. `noFollow` guards only the file's
 * own name, so a linked DIRECTORY would let a caller-chosen `--home` read or write another home's register.
 *
 * @param path the register file, whose parent directory is checked
 * @returns the sentence saying the directory is a link, or undefined when it is a real directory or absent
 */
function linkedDirectory({ path }: { path: string }): string | undefined {
  const directory = dirname(path);
  try {
    if (lstatSync(directory).isSymbolicLink()) {
      return `its directory ${directory} is a symbolic link, which a register never is`;
    }
  } catch (error) {
    if (isAbsent({ error })) {
      return undefined;
    }
    return `its directory ${directory} would not stat: ${messageOf({ error })}`;
  }
  return undefined;
}

/**
 * Every row the register holds, in grant order, and every line that would not decode.
 *
 * @param home the state home the register lives under
 * @returns the read, or the error saying the file could not be read at all
 */
export function readPassExtensions({ home }: { home: string }): Result<PassExtensionRead, PassExtensionError> {
  const path = stateHomePaths({ home }).codexPassExtensionsJsonl;
  const linked = linkedDirectory({ path });
  if (linked !== undefined) {
    return err(PassExtensionErrors.registerUnreadable({ cause: linked, path }));
  }
  const rows: CodexPassExtension[] = [];
  const unreadable: UnreadableExtensionLine[] = [];
  try {
    readJsonlLines({
      noFollow: true,
      onLine: ({ line, index }) => {
        if (line.trim().length === 0) {
          return;
        }
        let value: unknown;
        try {
          value = JSON.parse(line);
        } catch {
          unreadable.push({ detail: `line ${String(index + 1)}: not JSON`, run: undefined });
          return;
        }
        const decoded = decodePassExtension({ value });
        if (decoded.isErr()) {
          unreadable.push({
            detail: `line ${String(index + 1)}: ${decoded.error.message}`,
            run: runNamedBy({ value }),
          });
          return;
        }
        rows.push(decoded.value);
      },
      path,
    });
  } catch (error) {
    if (isAbsent({ error })) {
      return ok({ rows: [], unreadable: [] });
    }
    return err(PassExtensionErrors.registerUnreadable({ cause: messageOf({ error }), path }));
  }
  return ok({ rows, unreadable });
}

/**
 * Append one extension, durably, refusing a symlink at the register's own name.
 *
 * @param home the state home the register lives under
 * @param row the extension the pinned supervisor approved
 * @returns nothing, or why the append failed — an extension nobody recorded is one no gate can read
 */
export function appendPassExtension({
  home,
  row,
}: {
  home: string;
  row: CodexPassExtension;
}): Result<undefined, PassExtensionError> {
  const path = stateHomePaths({ home }).codexPassExtensionsJsonl;
  try {
    mkdirSync(dirname(path), { mode: DIR_MODE, recursive: true });
    const linked = linkedDirectory({ path });
    if (linked !== undefined) {
      return err(PassExtensionErrors.appendFailed({ cause: linked, path }));
    }
    appendLines({ durable: true, mode: FILE_MODE, noFollow: true, path, text: `${JSON.stringify(row)}\n` });
  } catch (error) {
    return err(PassExtensionErrors.appendFailed({ cause: messageOf({ error }), path }));
  }
  return ok(undefined);
}
