/**
 * `slopweaver briefing card --open-pages <path> --row <path|->` — one validated open-pages row, appended
 * atomically, refused rather than truncated. `--drop <url>` is the other arm, dispatched to
 * `./cardDropRun.ts` before anything here runs. The decision is `../../../briefing/openPageRow.ts`; this edge
 * reads the row and the document, resolves the home's ledger, voice rules and pages directory, and writes.
 *
 * It replaces `cardsN-M.py` and the `jq`/heredoc edits that followed it — the row's own header carries the
 * measurement. The write shares `./formEditIo.ts`'s seams with the three form-editing verbs: atomic, single
 * writer, and a refusal, a dry run or a failed gate all leave the file exactly as it was.
 */
import { readFileSync } from "node:fs";

import {
  composedCardDrift,
  type PagesOpened,
  pageAddressesOf,
  pinPagesOpened,
} from "../../../briefing/composedCardDrift.js";
import { CARD_FRAMING_OVERRIDE_ENV } from "../../../briefing/fleetJargon.js";
import {
  gateOpenPageRow,
  type OpenPageRowGate,
  otherRowRefusals,
  placeOpenPageRow,
} from "../../../briefing/openPageRow.js";
import { type OpenPageRowError, OpenPageRowErrors } from "../../../briefing/openPageRowErrors.js";
import type { PrefetchPublishedPages, ReadPublishedPage } from "../../../briefing/publishedPageRead.js";
import { hatchOpenNow } from "../../../hatch/open.js";
import { slopweaverHome } from "../../../homeDir.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import { VOICE_RULES_HATCH } from "../../../outbound/voice/exactRules.js";
import { localPageSlug } from "../../../pages/url.js";
import { type ProfileReadError, readExactVoiceRules } from "../../../profileStore.js";
import { readLockInLedger, readLockInLedgerExact } from "../../../sessionStart/lockIn.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type BriefingCardDropDeps, boardRowOnDisk, runBriefingCardDrop } from "./cardDropRun.js";
import { type CardReport, cardReportOf, printCardReport } from "./cardReport.js";
import { VERB_ARG_OFFSET } from "./core.js";
import { type BriefingCardPlaceArgs, parseBriefingCardArgs } from "./formEditArgs.js";
import { formJsonText, productionFormEditDeps, readFormJson, writeFormText } from "./formEditIo.js";
import { pagesOpenedOnDisk, prefetchPublishedPages } from "./publishedPageReader.js";
import { BRIEFING_CARD_USAGE } from "./usage.js";

/**
 * Everything `briefing card` touches outside itself, injected so a test drives the whole verb. The drop arm's
 * seams — the lock-in ledger, the settling board row, the clock — are a subset, so one deps object serves both.
 */
export interface BriefingCardDeps extends BriefingCardDropDeps {
  /** The raw lock-in ledger of a home, empty when it has none — the place arm's lenient read. */
  readonly readLockIns: (args: { home: string }) => string;
  /** Reads the row's text: a path, or stdin for `-`. Throws when it cannot. */
  readonly readRow: (args: { source: string }) => string;
  /** Fetches the pages a row reads from the store, answering the reader its card reads its question and lean through. */
  readonly prefetchPublishedPages: PrefetchPublishedPages;
  /** The seam onto the files a path opens, so the card is held to the page its url opens however it is spelled. */
  readonly pagesOpened: PagesOpened;
  /** The operator's private exact voice rules for a home, empty when none are configured, or why its profile cannot be trusted. */
  readonly voiceRules: (args: { home: string }) => Result<readonly ExactVoiceRule[], ProfileReadError>;
  /** Whether the packing and voice pass runs at all, asked of the resolved home's grant journal. */
  readonly applyVoice: (args: { home: string }) => boolean;
  /** Whether the four card-framing rules run, read from their own break-glass at the edge. */
  readonly applyFraming: boolean;
}

/**
 * Run `briefing card` against injected seams.
 *
 * @param rest the argv tail after `briefing card`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code: usage for a bad invocation, error when the row or document is refused or
 *   the write fails, ok otherwise
 */
export async function runBriefingCard({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: BriefingCardDeps;
}): Promise<number> {
  const args = parseBriefingCardArgs({ rest });
  if (args.isErr()) {
    for (const line of args.error) {
      deps.writeDiagnostic(`briefing card: ${line}`);
    }
    deps.writeDiagnostic(BRIEFING_CARD_USAGE);
    return EXIT_USAGE;
  }
  if (args.value.mode === "drop") {
    return runBriefingCardDrop({ args: args.value, deps });
  }
  // The row's pages are collected, fetched, then read: one answer per path across all three.
  const pinned = { ...deps, pagesOpened: pinPagesOpened({ pagesOpened: deps.pagesOpened }) };
  return runBriefingCardPlace({ args: args.value, deps: pinned });
}

/**
 * The `--row` arm: read the row, hold it to every gate the rendered card meets, then place it.
 *
 * @param args the parsed place arm
 * @returns the process exit code
 */
async function runBriefingCardPlace({
  args,
  deps,
}: {
  args: BriefingCardPlaceArgs;
  deps: BriefingCardDeps;
}): Promise<number> {
  const { home = slopweaverHome() } = args;
  const nowIso = deps.now();
  const row = readRowJson({ deps, source: args.rowSource });
  if (row.isErr()) {
    refuse({ deps, error: row.error, path: args.openPagesPath });
    return EXIT_ERROR;
  }
  const rules = deps.voiceRules({ home });
  if (rules.isErr()) {
    deps.writeDiagnostic(`briefing card: refused: ${rules.error.message}.`);
    deps.writeDiagnostic(`briefing card: nothing was written to ${args.openPagesPath}`);
    return EXIT_ERROR;
  }
  const document = readFormJson({ deps, path: args.openPagesPath });
  if (document.isErr()) {
    deps.writeDiagnostic(`briefing card: ${document.error.message}`);
    return EXIT_ERROR;
  }
  const ledgerText = deps.readLockIns({ home });
  const pagesDirectory = stateHomePaths({ home }).pages;
  const readPage = await pagesFor({ args, deps, document: document.value, home, row: row.value });
  if (readPage === undefined) {
    return EXIT_ERROR;
  }
  const gated = gateOpenPageRow({
    applyFraming: deps.applyFraming,
    applyVoice: deps.applyVoice({ home }),
    ledgerText,
    nowIso,
    pagesDirectory,
    readPage,
    row: row.value,
    rules: rules.value,
  });
  if (gated.isErr()) {
    refuse({ deps, error: gated.error, path: args.openPagesPath });
    return EXIT_ERROR;
  }
  // The gate reads the page the url SPELLS; a symlinked slug opens another, so the card is held to both readings
  // exactly as `briefing render` holds it.
  const drift = composedCardDrift({
    block: { meFacing: [gated.value.card], teamFacing: [] },
    pagesDirectory,
    readPage,
    pagesOpened: deps.pagesOpened,
  });
  if (drift.length > 0) {
    refuse({ deps, error: OpenPageRowErrors.rowRefused({ defects: drift }), path: args.openPagesPath });
    return EXIT_ERROR;
  }
  const where = { ledgerText, nowIso, pagesDirectory, readPage };
  return place({ args, deps, document: document.value, gated: gated.value, row: row.value, where });
}

/**
 * Every page the row's gate, its drift check and the other-row report may read, fetched from the store over one
 * connection: each row's page, and every page the row's own address opens however it is spelled. A row a later
 * `--replace` drops is fetched too; one fetched and unread costs a read, one read and unfetched is a defect.
 *
 * @param row the proposed row, as parsed JSON
 * @param document the current `open-pages.json`, as parsed JSON
 * @param home the state home whose store and `pages/` directory are read
 * @returns the reader over those pages, or `undefined` once the refusal naming the unreadable page is written
 */
async function pagesFor({
  args,
  deps,
  document,
  home,
  row,
}: {
  args: BriefingCardPlaceArgs;
  deps: BriefingCardDeps;
  document: unknown;
  home: string;
  row: unknown;
}): Promise<ReadPublishedPage | undefined> {
  const rows = [row, ...(Array.isArray(document) ? document : [])];
  const urls = rows.flatMap((entry) => (isRecord(entry) && typeof entry["url"] === "string" ? [entry["url"]] : []));
  const local = urls.filter((url) => localPageSlug({ url }) !== undefined);
  const opened = pageAddressesOf({
    pagesDirectory: stateHomePaths({ home }).pages,
    pagesOpened: deps.pagesOpened,
    urls,
  });
  const readPage = await deps.prefetchPublishedPages({ home, urls: [...local, ...opened] });
  if (readPage.isErr()) {
    deps.writeDiagnostic(`briefing card: ${readPage.error.message}`);
    deps.writeDiagnostic(`briefing card: nothing was written to ${args.openPagesPath}`);
    return undefined;
  }
  return readPage.value;
}

/**
 * Place the gated row in the document already read, and either report the dry run or write.
 *
 * Split from {@link runBriefingCardPlace} for the line cap: everything above it decides WHAT is being written,
 * and everything here decides WHERE it goes and whether it lands.
 *
 * @param document the parsed `open-pages.json`, read before the pages were fetched
 * @param gated what the row's own gate produced, whose artifact carries the url a duplicate is judged on
 * @param where what the other-row report reads beside the document — the ledger read once, the run's instant,
 *   the pages directory and the page seam the row's own gate used
 * @returns the process exit code
 */
function place({
  args,
  deps,
  document,
  gated,
  row,
  where,
}: {
  args: BriefingCardPlaceArgs;
  deps: BriefingCardDeps;
  document: unknown;
  gated: OpenPageRowGate;
  row: unknown;
  where: { ledgerText: string; nowIso: string; pagesDirectory: string; readPage: ReadPublishedPage };
}): number {
  const placed = placeOpenPageRow({
    document,
    nowIso: where.nowIso,
    replace: args.replace,
    row,
    url: gated.artifact.url,
  });
  if (placed.isErr()) {
    refuse({ deps, error: placed.error, path: args.openPagesPath });
    return EXIT_ERROR;
  }
  const others = otherRowRefusals({ ...where, document: placed.value.document, url: gated.artifact.url });
  const report = cardReportOf({ args, gated, others, placed: placed.value });
  if (args.dryRun) {
    printCardReport({ json: args.json, report, writeOut: deps.writeOut });
    return EXIT_OK;
  }
  return commit({ args, deps, document: placed.value.document, report });
}

/**
 * Serialise the edited document and replace the file atomically, then print the report as written.
 *
 * @returns error when the document could not be serialised or the write did not complete, ok otherwise
 */
function commit({
  args,
  deps,
  document,
  report,
}: {
  args: BriefingCardPlaceArgs;
  deps: BriefingCardDeps;
  document: readonly unknown[];
  report: CardReport;
}): number {
  const text = formJsonText({ form: document });
  if (text.isErr()) {
    deps.writeDiagnostic(`briefing card: ${text.error.message}; nothing was written to ${args.openPagesPath}`);
    return EXIT_ERROR;
  }
  const written = writeFormText({ deps, path: args.openPagesPath, text: text.value });
  if (written.isErr()) {
    deps.writeDiagnostic(`briefing card: ${written.error.message}`);
    return EXIT_ERROR;
  }
  printCardReport({ json: args.json, report: { ...report, written: true }, writeOut: deps.writeOut });
  return EXIT_OK;
}

/**
 * Read and parse the row: a path, or stdin for `-`.
 *
 * @param source the `--row` value
 * @param deps the injected reader
 * @returns the parsed JSON, or one line naming the source and what went wrong
 */
function readRowJson({ source, deps }: { source: string; deps: BriefingCardDeps }): Result<unknown, OpenPageRowError> {
  try {
    return ok(safeJsonParse({ label: source, text: deps.readRow({ source }) }));
  } catch (error: unknown) {
    return err(OpenPageRowErrors.rowUnreadable({ cause: error, source }));
  }
}

/**
 * Say why nothing was written: the message, then — for a refusal that carries them — one line per defect.
 *
 * The branch on `code` is the one this verb takes: a row or document refusal is a LIST a composer works
 * through, and a list joined into one line is the wall of text every gate here exists to refuse.
 */
function refuse({ deps, error, path }: { deps: BriefingCardDeps; error: OpenPageRowError; path: string }): void {
  deps.writeDiagnostic(`briefing card: ${error.message}`);
  if (error.code === "ROW_REFUSED" || error.code === "DOCUMENT_REFUSED") {
    for (const defect of error.defects) {
      deps.writeDiagnostic(`  ${defect}`);
    }
  }
  deps.writeDiagnostic(`briefing card: nothing was written to ${path}`);
}

/**
 * The real seams: the filesystem, the home's ledger, board and profile, the clock and the two break-glasses.
 *
 * @returns the production dependencies
 */
export function productionBriefingCardDeps(): BriefingCardDeps {
  return {
    ...productionFormEditDeps(),
    applyFraming: process.env[CARD_FRAMING_OVERRIDE_ENV] !== "1",
    applyVoice: ({ home }) => !hatchOpenNow({ home, id: VOICE_RULES_HATCH }),
    now: () => new Date().toISOString(),
    readBoardRow: boardRowOnDisk,
    readLockIns: ({ home }) => readLockInLedger({ home }),
    readLockInsExact: ({ home }) => readLockInLedgerExact({ home }),
    prefetchPublishedPages,
    pagesOpened: pagesOpenedOnDisk,
    readRow: ({ source }) => readFileSync(source === "-" ? 0 : source, "utf8"),
    voiceRules: ({ home }) => readExactVoiceRules({ home }),
  };
}

/** `slopweaver briefing card`. */
export const briefingCardCommand = defineCommand({
  run: (argv) => runBriefingCard({ deps: productionBriefingCardDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
