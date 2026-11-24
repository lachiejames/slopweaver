/**
 * `chatgpt import-export` and `chatgpt sync` — their ChatGPT history, from the official export they download, into
 * the corpus.
 *
 * - `import-export` takes one export in (`corpus/chatgpt/exportStore.ts`) and writes nothing else.
 * - `sync` is the scheduled pass: take in a newer export if one has arrived, then run `refresh --source chatgpt
 *   --store` through the CLI's own router, in process — so the ruling gate and every other dispatch rule a hand
 *   run meets apply here too — and write the receipt last.
 *
 * Neither reaches the network or a browser: an export is a file the owner downloaded, read whole. The web session's
 * reads (`chatgpt list`, `chatgpt conversation`) are separate verbs (docs/security/chatgpt-conversation-boundary.md).
 */
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import { type ChatgptArchiveDeps, unzipArchiveDeps } from "../../../corpus/chatgpt/archive.js";
import { takeInArchive } from "../../../corpus/chatgpt/archiveIndex.js";
import { ChatgptExportErrors } from "../../../corpus/chatgpt/errors.js";
import { currentAsOfIso, type SeenArchive } from "../../../corpus/chatgpt/exportFreshness.js";
import { forgetReceipts, hasReceipt, writeReceipt } from "../../../corpus/chatgpt/exportReceipts.js";
import {
  heldExports,
  type ImportOutcome,
  importChatgptExport,
  type StoredExport,
  verifiedHeldExports,
} from "../../../corpus/chatgpt/exportStore.js";
import { slopweaverHome } from "../../../homeDir.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { main } from "../../main.js";
import { parseFlags } from "../../parseFlags.js";
import { locateExport } from "./exportLocation.js";
import { alreadyInEnding, certifiedEnding } from "./syncEnding.js";
import { CHATGPT_IMPORT_EXPORT_USAGE, CHATGPT_SYNC_USAGE } from "./usage.js";

/** Where a `chatgpt` verb's own arguments start: past the runtime, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The options both verbs take. */
interface ExportVerbOptions {
  /** A zip, an unzipped export directory, a conversations file, or a directory to find the newest export zip in. */
  readonly from: string | undefined;
  readonly json: boolean;
  readonly home: string;
  /** `sync` only: forget every receipt first, so every held export is read again. */
  readonly replay: boolean;
}

/** The edges both verbs read through. */
export interface ChatgptExportVerbDeps {
  readonly archive: ChatgptArchiveDeps;
  /** Where an export is looked for when `--from` names none — their Downloads folder in production. */
  readonly downloadsDir: string;
  readonly nowIso: () => string;
  /** One CLI invocation through the router, in process — `sync`'s refresh leg. */
  readonly runVerb: (argv: readonly string[]) => Promise<number>;
  /** The owner's protect list every import and receipt is judged against — the home's own registry when absent. */
  readonly protection?: OwnerProtectionResolver | undefined;
}

/**
 * Parse either verb's argv tail. Pure.
 *
 * `sync` takes no `--json`: its refresh leg runs in process and prints refresh's own summary to stdout, so it has
 * no single document to promise.
 *
 * @param rest the argv after the verb
 * @param verb which verb's flags to accept
 * @returns the options, or one sentence per refusal
 *
 * @internal
 */
export function parseExportVerbArgs({
  rest,
  verb,
}: {
  rest: readonly string[];
  verb: "import-export" | "sync";
}): Result<ExportVerbOptions> {
  const boolean = verb === "import-export" ? ["json"] : ["replay"];
  const parsed = parseFlags({ args: rest, spec: { boolean, string: ["from", "home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const from = values["from"];
  const home = values["home"];
  return ok({
    from: typeof from === "string" ? from : undefined,
    home: typeof home === "string" ? home : slopweaverHome(),
    json: values["json"] === true,
    replay: values["replay"] === true,
  });
}

/** Print each line to stderr. */
function diagnose({ lines }: { lines: readonly string[] }): void {
  for (const line of lines) {
    logger.error({ msg: line });
  }
}

/** The import line a person reads. */
function importLine({ outcome }: { outcome: ImportOutcome }): string {
  const { stored } = outcome;
  const files = `${String(stored.files.length)} conversations file(s)`;
  if (!outcome.fresh) {
    return `chatgpt: export ${stored.contentHash.slice(0, 12)} is already held (${files}, taken in ${stored.importedAtIso})`;
  }
  return `chatgpt: took in export ${stored.contentHash.slice(0, 12)} — ${files} → ${stored.directory}`;
}

/**
 * Run `chatgpt import-export`.
 *
 * @param rest the argv after the verb
 * @param deps the edges
 * @returns the exit code: 0 for a new export, 3 for one already held or none found, 1 for a refusal
 */
export function runChatgptImportExport({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ChatgptExportVerbDeps;
}): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CHATGPT_IMPORT_EXPORT_USAGE });
    return EXIT_OK;
  }
  const options = parseExportVerbArgs({ rest, verb: "import-export" });
  if (options.isErr()) {
    diagnose({ lines: [...options.error, CHATGPT_IMPORT_EXPORT_USAGE] });
    return EXIT_USAGE;
  }
  const { from, home, json } = options.value;
  const location = locateExport({ archive: deps.archive, downloadsDir: deps.downloadsDir, from });
  if (location.kind === "unreadable") {
    diagnose({ lines: [location.line] });
    return EXIT_ERROR;
  }
  if (location.kind === "none") {
    diagnose({
      lines: [`chatgpt: no ChatGPT export zip in ${location.looked}`, ChatgptExportErrors.noImportedExport().message],
    });
    return EXIT_EXPECTED_EMPTY;
  }
  // One export, the newest: this verb takes in what they point it at. `sync` is the pass that takes in every one.
  const [path] = location.paths;
  const outcome = importChatgptExport({
    archive: deps.archive,
    from: path,
    home,
    nowIso: deps.nowIso(),
    protection: deps.protection,
    root: stateHomePaths({ home }).corpus.chatgptExports,
  });
  if (outcome.isErr()) {
    diagnose({ lines: [`chatgpt: ${outcome.error.message}`] });
    return EXIT_ERROR;
  }
  if (json) {
    logger.out({
      line: JSON.stringify({ fresh: outcome.value.fresh, from: path, stored: outcome.value.stored }, null, 1),
    });
  } else {
    logger.out({ line: importLine({ outcome: outcome.value }) });
  }
  return outcome.value.fresh ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/** A path's last-modified instant, or `undefined` when it cannot be read — the import already read it, so rare. */
function modifiedIso({ path }: { path: string }): string | undefined {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Take in every export `--from` or Downloads holds, oldest file first. Which export is newest is read from its
 * content (`corpus/chatgpt/exportFreshness.ts`); the import time this order sets only breaks a tie.
 *
 * @returns each archive taken in, or the exit code that ends the pass
 */
function takeInExports({
  deps,
  from,
  home,
  root,
}: {
  deps: ChatgptExportVerbDeps;
  from: string | undefined;
  home: string;
  root: string;
}): { readonly exit: number } | { readonly seen: readonly SeenArchive[] } {
  const location = locateExport({ archive: deps.archive, downloadsDir: deps.downloadsDir, from });
  if (location.kind === "unreadable") {
    diagnose({ lines: [location.line] });
    // A path they NAMED that cannot be read is their mistake to see; Downloads unreadable on a scheduled pass is not,
    // since an export already held but not yet in the corpus can still be refreshed. A zip there that will not list,
    // or holds conversations but not as one export, is: going on would call the older corpus current over their new
    // download.
    if (from !== undefined || location.malformed) {
      return { exit: EXIT_ERROR };
    }
  }
  if (location.kind !== "paths") {
    return { seen: [] };
  }
  const seen: SeenArchive[] = [];
  const heldHashes = new Set(heldExports({ root }).exports.map((stored) => stored.contentHash));
  for (const path of location.paths.toReversed()) {
    const taken = takeInArchive({
      archive: deps.archive,
      from: path,
      heldHashes,
      home,
      nowIso: deps.nowIso(),
      protection: deps.protection,
      root,
    });
    if (taken.isErr()) {
      diagnose({ lines: [`chatgpt: ${taken.error.message}`] });
      return { exit: EXIT_ERROR };
    }
    if (taken.value.kind === "known") {
      const { contentHash, modifiedIso: modified } = taken.value;
      logger.out({ line: `chatgpt: ${path} is unchanged since it was taken in as export ${contentHash.slice(0, 12)}` });
      seen.push({ contentHash, modifiedIso: modified });
      continue;
    }
    logger.out({ line: importLine({ outcome: taken.value.outcome }) });
    const modified = modifiedIso({ path });
    if (modified !== undefined) {
      seen.push({ contentHash: taken.value.outcome.stored.contentHash, modifiedIso: modified });
    }
  }
  return { seen };
}

/**
 * Refresh the pending exports into the corpus and the store through the router, then write each receipt last.
 *
 * A refresh that exits 3 SUCCEEDED — the export was read whole and every record was already in bronze — so it is
 * receipted like a 0. Anything else withholds every receipt and the next sync tries the same exports again.
 *
 * What it closes and what it does not: a receipt names the content the refresh READ, so a held file rewritten
 * after the refresh read it is not re-checked here, and that pass's receipt and as-of stand. Closing that window
 * would take a lock every writer to the home honours, and a process that can rewrite a 0600 file under this
 * 0700 root can write the receipt itself. The next sync re-hashes every held export, receipted ones included,
 * and fails by name on the rewritten copy.
 */
async function refreshAndReceipt({
  deps,
  home,
  root,
  pending,
}: {
  deps: ChatgptExportVerbDeps;
  home: string;
  root: string;
  pending: readonly StoredExport[];
}): Promise<number> {
  const shorts = pending.map((stored) => stored.contentHash.slice(0, 12)).join(", ");
  const code = await deps.runVerb(["node", "slopweaver", "refresh", "--source", "chatgpt", "--store", "--home", home]);
  if (code !== EXIT_OK && code !== EXIT_EXPECTED_EMPTY) {
    diagnose({
      lines: [`chatgpt: the refresh of export ${shorts} exited ${String(code)}; held, and the next sync retries it`],
    });
    return EXIT_ERROR;
  }
  for (const stored of pending) {
    const receipt = writeReceipt({
      contentHash: stored.contentHash,
      home,
      nowIso: deps.nowIso(),
      protection: deps.protection,
      root,
    });
    if (receipt.isErr()) {
      diagnose({
        lines: [`chatgpt: export ${stored.contentHash.slice(0, 12)} reached the corpus, but ${receipt.error.message}`],
      });
      return EXIT_ERROR;
    }
  }
  logger.out({ line: `chatgpt: export ${shorts} is in the corpus and the store` });
  return EXIT_OK;
}

/** `--replay`: forget every receipt so the refresh reads every held export again; false once that was refused. */
function forgotten({ deps, home, root }: { deps: ChatgptExportVerbDeps; home: string; root: string }): boolean {
  const forgot = forgetReceipts({ home, protection: deps.protection, root });
  if (forgot.isErr()) {
    diagnose({ lines: [`chatgpt: ${forgot.error.message}`] });
    return false;
  }
  logger.out({ line: `chatgpt: replaying — forgot ${String(forgot.value)} receipt(s), so every held export is read` });
  return true;
}

/**
 * Run `chatgpt sync`: take in every export zip it finds (only one not yet held is new), refresh every held export
 * with no receipt into the corpus and the store, and write their receipts last.
 *
 * @param rest the argv after the verb
 * @param deps the edges
 * @returns 0 when an export reached the corpus; 3 when every held export is already in and the corpus is within
 *   ChatGPT's freshness window, or none was ever taken in; 4 when they are all in and it is past the window; 1 when
 *   an import or the refresh leg failed
 */
export async function runChatgptSync({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: ChatgptExportVerbDeps;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CHATGPT_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseExportVerbArgs({ rest, verb: "sync" });
  if (options.isErr()) {
    diagnose({ lines: [...options.error, CHATGPT_SYNC_USAGE] });
    return EXIT_USAGE;
  }
  const { from, home, replay } = options.value;
  const root = stateHomePaths({ home }).corpus.chatgptExports;
  const taken = takeInExports({ deps, from, home, root });
  if ("exit" in taken) {
    return taken.exit;
  }
  // Fail closed on ANY held export that will not read or no longer hashes to its name, a receipted older one included:
  // a 3 here would let the resync row stamp a verified sync off store rows whose archive is gone.
  const held = verifiedHeldExports({ root });
  if (held.isErr()) {
    diagnose({ lines: [held.error.message] });
    return EXIT_ERROR;
  }
  const newest = held.value[0];
  if (newest === undefined) {
    diagnose({ lines: [ChatgptExportErrors.noImportedExport().message] });
    return EXIT_EXPECTED_EMPTY;
  }
  if (replay && !forgotten({ deps, home, root })) {
    return EXIT_ERROR;
  }
  // Any held export with no receipt, not only the newest, calls for a refresh (which reads every held export,
  // `exportsToRead`), so one whose earlier refresh failed is retried, and receipted, beside a newer one.
  const pending = held.value.filter((stored) => !hasReceipt({ contentHash: stored.contentHash, root }));
  if (pending.length > 0) {
    const refreshed = await refreshAndReceipt({ deps, home, pending, root });
    if (refreshed !== EXIT_OK) {
      return refreshed;
    }
    const asOfIso = currentAsOfIso({ newest, nowIso: deps.nowIso(), seen: taken.seen });
    return certifiedEnding({ asOfIso, code: EXIT_OK, newest, root });
  }
  const nowIso = deps.nowIso();
  return alreadyInEnding({ asOfIso: currentAsOfIso({ newest, nowIso, seen: taken.seen }), newest, nowIso, root });
}

/** The production edges. */
function productionDeps(): ChatgptExportVerbDeps {
  return {
    archive: unzipArchiveDeps,
    downloadsDir: join(homedir(), "Downloads"),
    nowIso: () => new Date().toISOString(),
    runVerb: (argv) => main(argv),
  };
}

/** `slopweaver chatgpt import-export [--from <zip|dir|file>]` — one export taken in, nothing else written. */
export const chatgptImportExportCommand = defineCommand({
  run: (argv) => runChatgptImportExport({ deps: productionDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});

/** `slopweaver chatgpt sync` — a newer export taken in, then refreshed into the corpus and the store. */
export const chatgptSyncCommand = defineCommand({
  run: (argv) => runChatgptSync({ deps: productionDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
