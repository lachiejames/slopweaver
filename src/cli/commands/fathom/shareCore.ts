/**
 * `slopweaver fathom share <url>` over injected edges — read one share page, store its raw transcript,
 * retire the hand-written row it replaces.
 *
 * ## The order is the crash-safety argument
 *
 * 1. Validate the address — a URL that is not a share link costs nothing and opens no browser.
 * 2. Read the page and project the record. A read that fails writes nothing at all.
 * 3. Commit the record through the ONE bronze committer ({@link ../../../corpus/corpusWriter.createBronzeCommitter}):
 *    the same denylist, redaction and dedup every refresh write takes. Re-reading an unchanged call dedups.
 * 4. Only then remove the hand-written `share:<token>` row from bronze. A crash between 3 and 4 leaves both — a
 *    superset — and the next settle removes it again.
 * 5. Settle the store ({@link settleFathomStore}): retire the hand-written identity of EVERY token bronze holds
 *    a verb-read transcript for, then replay the fathom source, so the store says what bronze says.
 *
 * Step 5 derives what it retires from bronze, never from the one share just read, because it is withheld while
 * any hand-written row remains: four shares read one at a time replay once, on the last, and that replay has
 * to retire all four. Deleting an identity already gone deletes nothing, so the set is safe to repeat, and a
 * run that died after step 3 is repaired by the next settle rather than by anything remembering it.
 *
 * It never touches the fathom API lane's watermark: a share read is not a crawl, and moving that cursor for
 * a call the API cannot see would make the next `refresh` skip calls it can.
 */
import type { BrowserTransportError } from "../../../browser/pageTransport.js";
import { createBronzeCommitter } from "../../../corpus/corpusWriter.js";
import {
  handWrittenShareSourceId,
  handWrittenShareTokens,
  readShareTokens,
  removeHandWrittenShareRows,
} from "../../../corpus/fathom/shareBronze.js";
import {
  type FathomShareAddress,
  parseFathomShareUrl,
  projectFathomShareCall,
  readFathomShareCapture,
} from "../../../corpus/fathom/sharePage.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { err, ok, type Result } from "../../../lib/result.js";

import { type FathomCommandError, FathomCommandErrors } from "./errors.js";

/** What retiring and replaying the fathom rows in the store did. */
export interface FathomStoreLegReport {
  /** Rows whose identity was retired — the hand-written `share:<token>` rows. */
  readonly retired: number;
  /** Rows the fathom replay upserted. */
  readonly stored: number;
}

/** The edges one share read touches. */
export interface FathomShareDeps {
  /** Read one share page in the owner's Chrome and hand back what the snippet printed. */
  readonly readPage: (args: {
    home: string;
    url: string;
  }) => Promise<Result<Record<string, unknown>, BrowserTransportError | readonly string[]>>;
  /** Retire these fathom identities in the store, then replay the fathom source into it. */
  readonly storeLeg: (args: { home: string; retire: readonly string[] }) => Promise<Result<FathomStoreLegReport>>;
}

/** What one share read did. */
export interface FathomShareOutcome {
  readonly url: string;
  readonly token: string;
  readonly recordingId: number;
  readonly title: string | null;
  readonly recordingStartIso: string;
  readonly speakers: readonly string[];
  readonly lines: number;
  /** Fathom's own action-item notes the page carried and the read dropped unread. */
  readonly providerNotesDropped: number;
  /** Whether bronze gained a line; false when this exact transcript was already held, or on a dry run. */
  readonly written: boolean;
  readonly dryRun: boolean;
  /** Hand-written `share:<token>` lines removed from bronze. */
  readonly handWrittenLinesRemoved: number;
  /** The store leg, or null when it was skipped (`--no-store`, `--dry-run`) or withheld. */
  readonly store: FathomStoreLegReport | null;
  /**
   * Other hand-written share rows still in bronze, which WITHHELD the store leg: its replay is whole-source,
   * so it would write their Fathom action items to the store. Empty when nothing was withheld.
   */
  readonly storeWithheldFor: readonly string[];
}

/** The speaker list a record carries in its attrs. */
function speakersOf({ record }: { record: CorpusRecord }): readonly string[] {
  const speakers = record.attrs?.["speakers"];
  return Array.isArray(speakers) ? speakers.filter((one): one is string => typeof one === "string") : [];
}

/**
 * A failure from the transport, whichever of its two shapes it came in, as display lines.
 *
 * @param error the transport's typed error, or the relay setup's lines
 * @returns one line per problem
 */
function transportLines({ error }: { error: BrowserTransportError | readonly string[] }): readonly string[] {
  if ("code" in error) {
    return [`${error.code}: ${error.message}`];
  }
  return error;
}

/**
 * Read one share page and store what it said.
 *
 * @param address the validated share address
 * @param home the Slopweaver home
 * @param dryRun read and project only; write nothing
 * @param store whether to retire and replay the store rows after bronze
 * @param deps the page reader and the store leg
 * @returns what was read and what was written, or why nothing was
 */
export async function shareOne({
  address,
  home,
  dryRun,
  store,
  deps,
}: {
  address: FathomShareAddress;
  home: string;
  dryRun: boolean;
  store: boolean;
  deps: FathomShareDeps;
}): Promise<Result<FathomShareOutcome, FathomCommandError>> {
  const page = await deps.readPage({ home, url: address.url });
  if (page.isErr()) {
    return err(FathomCommandErrors.pageUnread({ problems: transportLines({ error: page.error }) }));
  }
  const call = readFathomShareCapture({ address, output: page.value });
  if (call.isErr()) {
    return err(FathomCommandErrors.pageRefused({ cause: call.error }));
  }
  const record = projectFathomShareCall({ address, call: call.value });
  const shared = {
    dryRun,
    lines: call.value.cues.length,
    providerNotesDropped: call.value.droppedNotes,
    recordingId: call.value.recordingId,
    recordingStartIso: call.value.recordingStartIso,
    speakers: speakersOf({ record }),
    title: call.value.title,
    token: address.token,
    url: address.url,
  };
  if (dryRun) {
    return ok({ ...shared, handWrittenLinesRemoved: 0, store: null, storeWithheldFor: [], written: false });
  }
  const day = call.value.recordingStartIso.slice(0, "YYYY-MM-DD".length);
  const committed = createBronzeCommitter({ home, window: { since: day, until: day } }).commit({ records: [record] });
  if (committed.isErr()) {
    return err(FathomCommandErrors.bronzeWriteFailed({ problems: committed.error }));
  }
  if (committed.value.excluded > 0) {
    return err(FathomCommandErrors.denylistExcluded({ url: address.url }));
  }
  const removed = removeHandWrittenShareRows({ home, token: address.token });
  if (removed.isErr()) {
    return err(FathomCommandErrors.bronzeWriteFailed({ problems: removed.error }));
  }
  const base = { ...shared, handWrittenLinesRemoved: removed.value.removed, written: committed.value.written > 0 };
  if (!store) {
    return ok({ ...base, store: null, storeWithheldFor: [] });
  }
  const settled = await settleFathomStore({ deps, home });
  if (settled.isErr()) {
    return err(settled.error);
  }
  return ok({ ...base, ...settled.value });
}

/** What settling the store did: the leg it ran, or the hand-written rows that withheld it. */
export interface FathomSettleReport {
  readonly store: FathomStoreLegReport | null;
  readonly storeWithheldFor: readonly string[];
}

/**
 * Bring the store to what fathom bronze says. First remove any hand-written row whose token bronze already
 * holds a verb-read transcript for (a run that died between its commit and its removal left both). Then, while
 * a hand-written row still stands, withhold: the replay is whole-source and would store that row's Fathom action
 * items. Otherwise retire the hand-written identity of every held token and replay.
 *
 * @returns the leg that ran or the tokens that withheld it, or why bronze or the store could not be settled
 */
export async function settleFathomStore({
  deps,
  home,
}: {
  deps: Pick<FathomShareDeps, "storeLeg">;
  home: string;
}): Promise<Result<FathomSettleReport, FathomCommandError>> {
  const tokens = readShareTokens({ home }).andThen((heldSet) =>
    handWrittenShareTokens({ home }).map((standing) => ({
      held: [...heldSet].toSorted(),
      standing: new Set(standing),
    })),
  );
  if (tokens.isErr()) {
    return err(FathomCommandErrors.bronzeWriteFailed({ problems: tokens.error }));
  }
  const { held, standing } = tokens.value;
  for (const token of held.filter((one) => standing.has(one))) {
    const removed = removeHandWrittenShareRows({ home, token });
    if (removed.isErr()) {
      return err(FathomCommandErrors.bronzeWriteFailed({ problems: removed.error }));
    }
  }
  const pending = handWrittenShareTokens({ home });
  if (pending.isErr()) {
    return err(FathomCommandErrors.bronzeWriteFailed({ problems: pending.error }));
  }
  if (pending.value.length > 0) {
    return ok({ store: null, storeWithheldFor: pending.value });
  }
  const retire = held.map((token) => handWrittenShareSourceId({ token }));
  const replayed = await deps.storeLeg({ home, retire });
  if (replayed.isErr()) {
    return err(FathomCommandErrors.storeLegFailed({ problems: replayed.error }));
  }
  return ok({ store: replayed.value, storeWithheldFor: [] });
}

/** What one `discover --ingest` pass read: the shares it stored, why each other one was not, and the settle. */
export interface FathomIngestReport {
  readonly outcomes: readonly FathomShareOutcome[];
  readonly failures: readonly string[];
  /**
   * The closing settle, run when no share in this pass ended with a store leg of its own — nothing was new, or
   * the last one failed or was withheld — so a share whose store leg failed on an earlier pass is repaired by
   * this one rather than skipped as held. Null when the pass's last share already settled it.
   */
  readonly settle: FathomSettleReport | null;
}

/**
 * Read and store every share link discovery found that the fathom source does not hold yet, one at a time,
 * carrying on past a failure so one bad link never hides the rest.
 *
 * @param shares every share link discovery found; the held ones are skipped
 * @param home the Slopweaver home
 * @param deps the page reader and the store leg each link is read through
 * @returns what was stored, and one line per link that was not
 */
export async function ingestNewShares({
  shares,
  home,
  deps,
}: {
  shares: readonly { readonly url: string; readonly held: boolean }[];
  home: string;
  deps: FathomShareDeps;
}): Promise<FathomIngestReport> {
  const outcomes: FathomShareOutcome[] = [];
  const failures: string[] = [];
  let settledByLast = false;
  for (const share of shares.filter((one) => !one.held)) {
    settledByLast = false;
    const address = parseFathomShareUrl({ url: share.url });
    if (address.isErr()) {
      failures.push(address.error.message);
      continue;
    }
    const outcome = await shareOne({ address: address.value, deps, dryRun: false, home, store: true });
    if (outcome.isErr()) {
      failures.push(outcome.error.message);
      continue;
    }
    outcomes.push(outcome.value);
    settledByLast = outcome.value.store !== null;
  }
  if (settledByLast) {
    return { failures, outcomes, settle: null };
  }
  const settled = await settleFathomStore({ deps, home });
  if (settled.isErr()) {
    return { failures: [...failures, settled.error.message], outcomes, settle: null };
  }
  return { failures, outcomes, settle: settled.value };
}

/**
 * The line a closing settle prints.
 *
 * @param settle what the closing settle did, or null when the pass's last share settled the store itself
 * @returns zero or one line
 */
export function settleLines({ settle }: { settle: FathomSettleReport | null }): readonly string[] {
  if (settle === null) {
    return [];
  }
  if (settle.store === null) {
    return [
      `fathom store: withheld, hand-written rows still in bronze for share token(s) ${settle.storeWithheldFor.join(", ")}`,
    ];
  }
  return [
    `fathom store: settled, retired ${String(settle.store.retired)} row(s), replayed fathom (${String(settle.store.stored)} upserted)`,
  ];
}

/** The title a report prints: the call's own, or a placeholder said out loud when the page carried none. */
function displayTitle({ title }: { title: string | null }): string {
  if (title !== null) {
    return title;
  }
  return "(untitled call)";
}

/**
 * The human report of one share read.
 *
 * @param outcome what the read did
 * @returns the lines to print, in order
 */
export function shareLines({ outcome }: { outcome: FathomShareOutcome }): readonly string[] {
  const lines = [
    `fathom share — ${displayTitle({ title: outcome.title })} (recording ${String(outcome.recordingId)}), recorded ${outcome.recordingStartIso}`,
    `  ${String(outcome.lines)} spoken line(s) by ${outcome.speakers.join(", ")}`,
    `  ${outcome.url}`,
  ];
  if (outcome.providerNotesDropped > 0) {
    lines.push(`  dropped unread: ${String(outcome.providerNotesDropped)} Fathom action-item note(s)`);
  }
  if (outcome.dryRun) {
    lines.push("  dry run: nothing written");
    return lines;
  }
  lines.push(outcome.written ? "  bronze: stored" : "  bronze: already held, unchanged");
  if (outcome.handWrittenLinesRemoved > 0) {
    lines.push(
      `  bronze: removed ${String(outcome.handWrittenLinesRemoved)} hand-written share:${outcome.token} line(s)`,
    );
  }
  if (outcome.storeWithheldFor.length > 0) {
    lines.push(
      `  store: withheld, hand-written rows still in bronze for share token(s) ${outcome.storeWithheldFor.join(", ")}; ` +
        "the replay is whole-source and would store their Fathom action items. Share each of those links; the last one replays",
    );
  } else if (outcome.store === null) {
    lines.push("  store: skipped");
  } else {
    lines.push(
      `  store: retired ${String(outcome.store.retired)} row(s), replayed fathom (${String(outcome.store.stored)} upserted)`,
    );
  }
  return lines;
}
