/**
 * The pure half of `slopweaver briefing card --drop <url>`: take ONE row out of `open-pages.json` because the
 * owner's ruling has overtaken the page it names — and refuse to, writing nothing, when nothing on record says so.
 *
 * ## Why it exists
 *
 * `--row` can only append or replace, so a page the owner had already ruled on would stay on the chair's list
 * until a `jq` or heredoc edit took it off, and both are banned. One chair file carried 38 rows, one of them an
 * already-approved page.
 *
 * ## The drop needs EVIDENCE, and there are exactly two kinds
 *
 * 1. **The lock-in ledger** — the owner's ruling recorded against the page, under any key `./openArtifacts.ts`'s
 *    `ledgerKeys` tries. Only a DECIDING outcome counts: approved, edited, rejected or dropped. A `noted` is a
 *    comment and a `deferred` is "not yet", so neither takes a question off the owner's page. `resolutionHolds`
 *    is deliberately NOT asked: it compares `againstWhenIso` as a string, and the real ledger carries
 *    truncated instants (`"…T20:0xZ"`) on exactly the rows this verb exists to drop. A ruling that decided a page decided
 *    it; whether it LAPSED against a republish is the render's question, not one a drop needs answered.
 * 2. **A board row, named by `--settled-by <slug>`** — when the row publishes this exact url (its `artifact:`
 *    line or any `artifact` journal event) AND it is over: a settlement, a terminal derived status, or a dated
 *    ruling. The row is read whole or not at all; the shell hands an unreadable one in as such.
 *
 * Lock-in wins when it decides, and the report names which evidence carried the drop either way.
 *
 * ## What it preserves
 *
 * The edit is on the RAW parsed array: every other row, every key a projection never reads and their order
 * pass through untouched. Only the row matching the url EXACTLY goes, and a url two rows name is refused
 * rather than guessed at. The document left behind is held to the render's own index gate, so the file this
 * produces is one `briefing render` reads.
 *
 * Pure: a document, a ledger's text and an already-read board row in; a verdict or an edited document out.
 */
import { derivedRowState } from "../handover/derivedRowState.js";
import { type HandoverDoc, isTerminalDocStatus } from "../handover/doc.js";
import type { RunEvent } from "../handover/ledger.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeJsonParse } from "../lib/safeJson.js";
import { type LockInOutcome, parseLockInRows } from "../sessionStart/lockIn.js";
import { briefingErrorLines } from "./errors.js";
import { ledgerKeys, projectOpenArtifacts } from "./openArtifacts.js";
import { type DropReason, DropReasons, type OpenPageDropError, OpenPageDropErrors } from "./openPageDropErrors.js";

/** Every lock-in outcome that DECIDES a page; `noted` and `deferred` are absent on purpose. */
const DECIDING_OUTCOMES: ReadonlySet<LockInOutcome> = new Set<LockInOutcome>([
  "approved-as-proposed",
  "edited",
  "rejected",
  "dropped",
]);

/** The board row `--settled-by` names, as the shell read it: whole, or the reason it would not read. */
export type SettlingRowReading =
  | { readonly kind: "read"; readonly slug: string; readonly doc: HandoverDoc; readonly events: readonly RunEvent[] }
  | { readonly kind: "unreadable"; readonly slug: string; readonly why: string };

/** What carried a drop: the owner's ruling in the lock-in ledger, or a finished board row publishing the page. */
export type OpenPageDropEvidence =
  | {
      readonly kind: "lock-in";
      /** The ledger key the deciding resolution was recorded under. */
      readonly key: string;
      readonly outcome: LockInOutcome;
      readonly resolvedAtIso: string;
    }
  | {
      readonly kind: "board-row";
      readonly slug: string;
      /** Where the row names the url: its `artifact:` line, or an `artifact` journal event. */
      readonly artifactFrom: "front-matter" | "journal";
      /** What makes the row over, as one phrase. */
      readonly settledBecause: string;
    };

/** One row dropped, and what the document looks like after. */
export interface OpenPageDrop {
  /** The edited document, every other row exactly as it was and in the same order. */
  readonly document: readonly unknown[];
  /** The dropped row's 1-based position in the document as it was. */
  readonly position: number;
  /** How many rows remain. */
  readonly rows: number;
  readonly evidence: OpenPageDropEvidence;
}

/**
 * How many ledger lines do not decode and may name this page: their identity, in any casing, is one of the lowercased
 * aliases, or cannot be read at all.
 */
function undecodedLinesNaming({ aliases, ledgerText }: { aliases: ReadonlySet<string>; ledgerText: string }): number {
  return ledgerText.split("\n").filter((line) => {
    if (line.trim().length === 0 || parseLockInRows({ text: line }).length > 0) {
      return false;
    }
    let value: unknown;
    try {
      value = safeJsonParse({ label: "lock-in ledger line", text: line });
    } catch {
      return true;
    }
    const identity = isRecord(value) ? value["identity"] : undefined;
    return typeof identity !== "string" || aliases.has(identity.toLowerCase());
  }).length;
}

/**
 * The lock-in ledger's latest word about the page, across every key a recorder uses for it. The aliases are one
 * page, so the owner's LAST word under any of them is the one that stands — last in file order, which is the
 * ledger's own append order (`foldLockInLedger`): an approval under the short id does not settle a page the owner
 * deferred later under its url, even at the same instant.
 *
 * @param url the page's exact address
 * @param ledgerText the raw `lock-in.jsonl` contents, empty when the home has none
 * @returns the evidence, or the line saying why the owner's latest word does not settle the page
 */
function lockInEvidence({
  url,
  ledgerText,
}: {
  url: string;
  ledgerText: string;
}): Result<OpenPageDropEvidence, readonly DropReason[]> {
  const keys = ledgerKeys({ url });
  const aliases = new Set(keys);
  const latest = parseLockInRows({ text: ledgerText }).findLast((row) => aliases.has(row.identity));
  if (latest === undefined) {
    return err([DropReasons.lockInAbsent({ keys })]);
  }
  const key = latest.identity;
  if (DECIDING_OUTCOMES.has(latest.outcome)) {
    return ok({ key, kind: "lock-in", outcome: latest.outcome, resolvedAtIso: latest.tsIso });
  }
  return err([DropReasons.lockInUndecided({ key, outcome: latest.outcome })]);
}

/**
 * Where a board row names the url, if it does: its `artifact:` line first, then any `artifact` journal event.
 *
 * @returns which register names it, or undefined when neither does
 */
function artifactSource({
  doc,
  events,
  url,
}: {
  doc: HandoverDoc;
  events: readonly RunEvent[];
  url: string;
}): "front-matter" | "journal" | undefined {
  // A bare `artifact: null` parses as the string "null" with the placeholder flag: none published yet.
  if (doc.artifact === url && doc.artifactIsPlaceholder !== true) {
    return "front-matter";
  }
  return events.some((event) => event.kind === "artifact" && event.url === url) ? "journal" : undefined;
}

/**
 * What makes a board row over, as one phrase — a settlement, a terminal derived status, or a dated ruling.
 *
 * @returns the phrase, or undefined when the row is still live and undecided
 */
function rowSettledBecause({ doc, events }: { doc: HandoverDoc; events: readonly RunEvent[] }): string | undefined {
  const derived = derivedRowState({ doc, events });
  if (derived.settlement !== undefined) {
    return `settlement: ${derived.settlement}`;
  }
  if (isTerminalDocStatus(derived.status)) {
    return `status ${derived.status} (from ${derived.statusFrom})`;
  }
  // A ruling is DATED only when its instant parses: the journal decoder admits any string.
  const ruling = derived.datedRulings.findLast((held) => !Number.isNaN(Date.parse(held.decidedIso)));
  if (ruling !== undefined) {
    return `a ruling decided ${ruling.decidedIso}`;
  }
  return undefined;
}

/**
 * The named board row's word about the page: it must publish this exact url AND be over.
 *
 * @param reading the row as the shell read it
 * @returns the evidence, or the one line saying why the row does not settle the page
 */
function boardRowEvidence({
  url,
  reading,
}: {
  url: string;
  reading: SettlingRowReading;
}): Result<OpenPageDropEvidence, readonly DropReason[]> {
  if (reading.kind === "unreadable") {
    return err([DropReasons.rowUnreadable({ slug: reading.slug, why: reading.why })]);
  }
  // A row publishes an ADDRESS: a url that is none — `null` however a parser spelled it — is no page.
  if (!URL.canParse(url)) {
    return err([DropReasons.rowNotAnAddress({ slug: reading.slug, url })]);
  }
  const artifactFrom = artifactSource({ doc: reading.doc, events: reading.events, url });
  if (artifactFrom === undefined) {
    return err([DropReasons.rowNotPublished({ slug: reading.slug, url })]);
  }
  const settledBecause = rowSettledBecause({ doc: reading.doc, events: reading.events });
  if (settledBecause === undefined) {
    return err([DropReasons.rowNotOver({ slug: reading.slug })]);
  }
  return ok({ artifactFrom, kind: "board-row", settledBecause, slug: reading.slug });
}

/**
 * The evidence a drop stands on: lock-in when it decides, else the named board row, else every reason neither did.
 * A ledger line that does not decode and may name the page vetoes both: the parser skips it, and the skipped word
 * could be the owner's last one, which no board row outranks.
 *
 * @param settledBy the `--settled-by` row as read, or undefined when none was named
 * @returns the evidence, or every source's reason it does not settle the page
 */
function settlementEvidence({
  url,
  ledgerText,
  settledBy,
}: {
  url: string;
  ledgerText: string;
  settledBy: SettlingRowReading | undefined;
}): Result<OpenPageDropEvidence, readonly DropReason[]> {
  // The veto errs wide: any casing of any alias, the lowercased url's own included — an uppercase artifact id yields
  // none from `ledgerKeys`. It only ever refuses more; what DECIDES a page stays exact.
  const vetoAliases = [...ledgerKeys({ url }), ...ledgerKeys({ url: url.toLowerCase() })];
  const aliases = new Set(vetoAliases.map((alias) => alias.toLowerCase()));
  const unread = undecodedLinesNaming({ aliases, ledgerText });
  if (unread > 0) {
    return err([DropReasons.lockInUndecoded({ lines: unread })]);
  }
  const ledger = lockInEvidence({ ledgerText, url });
  if (ledger.isOk() || settledBy === undefined) {
    return ledger;
  }
  const row = boardRowEvidence({ reading: settledBy, url });
  if (row.isOk()) {
    return row;
  }
  return err([...ledger.error, ...row.error]);
}

/**
 * Drop the one row naming `url` exactly, when the owner's ruling or a finished board row settles its page.
 *
 * @param document the parsed `open-pages.json`
 * @param url the row's exact address — never a prefix, a slug or a similarity match
 * @param ledgerText the raw `lock-in.jsonl` contents, empty when the home has none
 * @param settledBy the `--settled-by` board row as the shell read it, or undefined when none was named
 * @param nowIso the run's own instant, for the remaining document's index projection
 * @returns the edited document, the dropped row's position, the rows left and the evidence, or the refusal
 */
export function dropOpenPageRow({
  document,
  url,
  ledgerText,
  settledBy,
  nowIso,
}: {
  document: unknown;
  url: string;
  ledgerText: string;
  settledBy: SettlingRowReading | undefined;
  nowIso: string;
}): Result<OpenPageDrop, OpenPageDropError> {
  if (!Array.isArray(document)) {
    return err(OpenPageDropErrors.documentNotAnArray());
  }
  const rows: readonly unknown[] = document;
  const positions = rows.flatMap((entry, index) => (isRecord(entry) && entry["url"] === url ? [index + 1] : []));
  const [position] = positions;
  if (position === undefined) {
    return err(OpenPageDropErrors.urlNotFound({ rows: rows.length, url }));
  }
  if (positions.length > 1) {
    return err(OpenPageDropErrors.urlDuplicated({ positions, url }));
  }
  const evidence = settlementEvidence({ ledgerText, settledBy, url });
  if (evidence.isErr()) {
    return err(OpenPageDropErrors.unsettled({ reasons: evidence.error.map((reason) => reason.message), url }));
  }
  const remaining = rows.filter((_entry, index) => index !== position - 1);
  const index = projectOpenArtifacts({ document: remaining, ledgerText: "", nowIso });
  if (index.isErr()) {
    return err(OpenPageDropErrors.documentRefused({ defects: briefingErrorLines({ error: index.error }) }));
  }
  return ok({ document: remaining, evidence: evidence.value, position, rows: remaining.length });
}

/**
 * The evidence as one clause a report line carries.
 *
 * @param evidence what carried the drop
 * @returns the clause, naming the ledger key or the board row
 */
export function dropEvidenceText({ evidence }: { evidence: OpenPageDropEvidence }): string {
  if (evidence.kind === "lock-in") {
    return `the owner's lock-in ${evidence.outcome} under ${evidence.key} (${evidence.resolvedAtIso})`;
  }
  return `board row ${evidence.slug} (${evidence.settledBecause}; its ${evidence.artifactFrom} artifact names the page)`;
}
