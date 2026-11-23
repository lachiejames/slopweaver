/**
 * `slopweaver store share` — what still sits only under `$SLOPWEAVER_HOME` versus what is in the store.
 *
 * The atlas page asks how much is not yet in the Supabase and still sits in the home directory. Nothing answered it:
 * `store status` reports the connection and the migration state,
 * `store import-fleet` moves records without reporting what it left, and the home side was never counted at
 * all. This verb is that read, and it writes nothing on either side.
 *
 * The effectful edge is this file — it resolves the home, walks each register's own path (resolved in
 * `./sharePaths.ts`), and asks the database for one row count per mirrored table (`./shareRowCounts.ts`). The
 * declaration is `src/store/homeRegisters.ts`, and the fold
 * is `src/store/homeShare.ts`,
 * whose module doc carries the three things this measurement refuses to do and why.
 *
 * **A store it cannot reach is a report, not a failure.** Every `storeRows` comes back absent with a
 * `storeUnreadBecause` saying why, and the home side still prints, because "what is on disk" is the half of the
 * question that never depended on a connection, and a verb that refuses outright would answer neither half. A
 * table the store does not hold is absent with no reason: nothing failed, there is nothing there to count.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { readJsonlLines } from "../../../corpus/corpusStore.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { stateHomePaths } from "../../../stateHome.js";
import { declaredTableNames } from "../../../store/declared.js";
import { classifyHomeDirectory } from "../../../store/fleet/authoredDirectories.js";
import { HOME_REGISTERS, type HomeRegister } from "../../../store/homeRegisters.js";
import { type HomeResidue, type HomeShareReport, homeShare, type RegisterShare } from "../../../store/homeShare.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { homeShareLines } from "../../storeShare.js";

import { registerPathOf } from "./sharePaths.js";
import { type RowCountTarget, rowCountKey, storeRowsFor } from "./shareRowCounts.js";

const USAGE = "usage: slopweaver store share [--home <dir>] [--json]";

/** Every flag this verb accepts, exported so `helpTruth` compares its behaviour rather than its prose. */
export const STORE_SHARE_FLAG_NAMES: readonly string[] = ["--home", "--json"];

/** What the verb was asked for. */
export interface StoreShareArgs {
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse the verb tail through the real parser the runner uses.
 *
 * Stays on the default `Result<T>` per `.claude/rules/error-handling.md`: these are display-only messages
 * no caller branches on.
 *
 * @param rest the verb tail, after `slopweaver store share`
 * @returns the parsed arguments, or the refusal lines to print
 */
export function parseStoreShareArgs({ rest }: { rest: readonly string[] }): Result<StoreShareArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: { boolean: ["json"], string: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const home = parsed.value.values["home"];
  let resolved: string | undefined;
  if (typeof home === "string") {
    resolved = home;
  }
  return ok({ home: resolved, json: parsed.value.values["json"] === true });
}

/** What one register's own path measured to. */
interface PathMeasure {
  readonly bytes: number;
  readonly files: number;
}

/**
 * Walk one directory tree, summing every file's size.
 *
 * Iterative rather than recursive so a deep tree cannot blow the stack, and it counts files at ANY depth.
 * MEASURED (repro: `for d in corpus/bronze atlas; do find ~/.slopweaver/$d -maxdepth 1 -type f
 * | wc -l; find ~/.slopweaver/$d -type f | wc -l; done`): counting direct children answers 0 for
 * `corpus/bronze` and 1 for `atlas`, against 69 and 6,317 at any depth — both registers nest, so a
 * direct-children count would report each of them as very nearly empty.
 *
 * @param root the directory to walk
 * @returns its total bytes and file count
 */
function walkDirectory({ root }: { root: string }): PathMeasure {
  let bytes = 0;
  let files = 0;
  const pending: string[] = [root];
  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) {
      break;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
        continue;
      }
      if (entry.isFile()) {
        files += 1;
        bytes += statSync(full).size;
      }
    }
  }
  return { bytes, files };
}

/**
 * Count a JSONL file's lines without holding it in one string.
 *
 * Goes through `readJsonlLines`, which streams, per `typescript-patterns.md`'s whole-file-string rule: a
 * ledger is a record stream whose size comes from the data, so its line count must never require the whole
 * file resident. Counting lines is all this does — no line is parsed, because the count is the answer.
 *
 * @param path the `.jsonl` file
 * @returns its bytes and non-empty line count
 */
function measureJsonl({ path }: { path: string }): PathMeasure {
  const bytes = statSync(path).size;
  let files = 0;
  readJsonlLines({
    onLine: ({ line }): void => {
      if (line.trim().length > 0) {
        files += 1;
      }
    },
    path,
  });
  return { bytes, files };
}

/** Why a `declared-only` register carries no size, printed on the row rather than left to a reader to infer. */
const UNMEASURED_BECAUSE =
  "walking it costs more than this verb's whole budget — measured, orchestration took 157.7s " +
  "and supervisor-scratch 57.7s, against 1.1s for every other register together " +
  "(repro: time du -sk ~/.slopweaver/orchestration ~/.slopweaver/supervisor-scratch)";

/**
 * Measure one register's home side.
 *
 * @param register the row to measure
 * @param paths the resolved state-home contract
 * @returns the register's home-side figures, with the store side left absent for the caller to fill
 */
function measureRegister({
  register,
  paths,
}: {
  register: HomeRegister;
  paths: ReturnType<typeof stateHomePaths>;
}): RegisterShare {
  const path = registerPathOf({ paths, register });
  const base = {
    kind: register.kind,
    relativePath: register.relativePath,
    storeRows: undefined,
    storeUnreadBecause: undefined,
    table: register.table,
    tier: register.tier,
    unmirroredBecause: register.unmirroredBecause,
  };
  if (path === undefined || register.measure === "declared-only") {
    let displayPath = register.relativePath;
    if (path !== undefined) {
      displayPath = path;
    }
    return {
      ...base,
      homeBytes: undefined,
      homeRecords: undefined,
      path: displayPath,
      present: true,
      unmeasuredBecause: UNMEASURED_BECAUSE,
    };
  }
  let stat: ReturnType<typeof statSync> | undefined;
  try {
    stat = statSync(path);
  } catch {
    return {
      ...base,
      homeBytes: 0,
      homeRecords: 0,
      path,
      present: false,
      unmeasuredBecause: undefined,
    };
  }
  let measured: PathMeasure = { bytes: stat.size, files: 1 };
  if (register.shape === "directory") {
    measured = walkDirectory({ root: path });
  }
  if (register.shape === "jsonl") {
    measured = measureJsonl({ path });
  }
  return {
    ...base,
    homeBytes: measured.bytes,
    homeRecords: measured.files,
    path,
    present: true,
    unmeasuredBecause: undefined,
  };
}

/**
 * Count the home's top-level entries no register claims.
 *
 * ONE `readdir` of the home root, never a recursive walk — the bound this whole module is built around.
 *
 * @param home the home root
 * @returns the residue, or an empty one when the home root cannot be read
 */
function residueOf({ home }: { home: string }): HomeResidue {
  const claimed = new Set(HOME_REGISTERS.map((register) => register.relativePath.split("/")[0]));
  let names: readonly string[] = [];
  try {
    names = readdirSync(home);
  } catch {
    return { sample: [], topLevelEntries: 0, unclassified: 0 };
  }
  // A top-level directory the authored-state classification names is claimed too, whatever its class: where
  // it belongs is decided in that file, so it is not residue a reader has to chase.
  const unclaimed = names
    .filter((name) => !claimed.has(name) && classifyHomeDirectory({ name }) === undefined)
    .toSorted();
  return { sample: unclaimed.slice(0, 12), topLevelEntries: names.length, unclassified: unclaimed.length };
}

/**
 * Measure both sides and fold them into the report.
 *
 * @param home an explicit home, or `undefined` to resolve the ambient one
 * @returns the report
 */
export async function collectHomeShare({ home }: { home: string | undefined }): Promise<HomeShareReport> {
  let root = slopweaverHome();
  if (home !== undefined) {
    root = home;
  }
  const paths = stateHomePaths({ home: root });
  const measured = HOME_REGISTERS.map((register) => measureRegister({ paths, register }));
  const targets = HOME_REGISTERS.flatMap((register): RowCountTarget[] =>
    register.table === undefined ? [] : [{ rowFilter: register.rowFilter, table: register.table }],
  );
  const read = await storeRowsFor({ targets });
  return homeShare({
    declaredTables: declaredTableNames(),
    observedAtIso: new Date().toISOString(),
    registers: measured.map((register, index): RegisterShare => {
      if (register.table === undefined) {
        return register;
      }
      const target = { rowFilter: HOME_REGISTERS[index]!.rowFilter, table: register.table };
      const storeRows = read.counts.get(rowCountKey({ target }));
      let storeUnreadBecause: string | undefined;
      if (storeRows === undefined && !read.absentTables.has(register.table)) {
        storeUnreadBecause = read.unreadBecause;
      }
      return { ...register, storeRows, storeUnreadBecause };
    }),
    residue: residueOf({ home: root }),
  });
}

/**
 * Run the verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runStoreShare(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreShareArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: `store share: ${problem}` });
    });
    logger.error({ msg: USAGE });
    return EXIT_USAGE;
  }
  const report = await collectHomeShare({ home: parsed.value.home });
  if (parsed.value.json) {
    logger.out({ line: safeJsonStringify({ label: "store share report", value: report }) });
    return EXIT_OK;
  }
  for (const line of homeShareLines({ report })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const storeShareCommand = defineCommand({ run: runStoreShare });
