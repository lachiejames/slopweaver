/**
 * The effectful half of `./relayTakenUp.ts`'s landing source: where one relay's landing on its `ask:` card stands,
 * and what the ask's row shows was done since the relay registered. Read by the relay settle the chair's acts trigger
 * (`../cli/commands/handover/relaySettleAtAct.ts`), by the hook `handover start` and `handover settle` fire on the
 * ask (`../cli/commands/handover/relaySettleForWork.ts`), and by `handover prune`, so none of them can disagree.
 *
 * The ledger is read ONCE per pass ({@link readRelayLandingLedger}) and handed to every relay, so a prune over the
 * whole board does not reread the whole JSONL file per row. Whether the ask's row was acted on is
 * `../talk/steeredCardsEvidence.ts`'s `rowActionSince`, the exact reader `talk steers` uses: a run event of work
 * taken up at or after the relay registered, or a settlement that cannot predate it.
 *
 * Fails CLOSED in one direction only. A turn, ledger, doc or journal that would not read is `unreadable`, which lets
 * no lower source answer the relay — a hidden landing could need it filed instead. For a relay over an `ask:` card, a
 * ledger line that did not read and may be about that card — it recorded that card's key, or no card key at all —
 * makes it unreadable: the line could be its landing, a restore that lifted it, or a later landing that put it back,
 * so no reading of the rest is safe. A refused line recording another card, or a key that is no card key, cannot be
 * any of those (`../talk/cardLedgerFile.ts`). A relay over no ask never reads the ledger.
 */
import { err, ok, type Result } from "../lib/result.js";
import { stateHomePaths } from "../stateHome.js";
import { activeCardLandings, type CardLandedRow, type CardLandingRow } from "../talk/cardLanding.js";
import type { CardLandingError } from "../talk/cardLandingErrors.js";
import { readCardLandings } from "../talk/cardLandingStore.js";
import { type CardLedgerUnreadableLine, unreadableCardLinesForKeys } from "../talk/cardLedgerFile.js";
import { readTurn } from "../talk/relayStore.js";
import { relayLanding, rowActionSince } from "../talk/steeredCardsEvidence.js";
import type { RelayLandingEvidence } from "./relayTakenUp.js";

/** The card kind whose own row carries the work the owner's words over it are a ruling on. */
const ASK_PREFIX = "ask:";

/** A relay's own landing is one `talk relay` wrote — the hooks' filter too — never a transcript landing. */
const fromRelay = (row: CardLandingRow): boolean => row.kind !== "landed" || row.source === "relay";

/** The card-landing ledger, prepared once for a pass over many relays. */
export interface RelayLandingLedger {
  readonly rows: readonly CardLandingRow[];
  /** The landings still holding a card off the Queue. */
  readonly active: readonly CardLandedRow[];
  /** The ledger lines that did not read, each with the card it recorded — one may be a relay's landing. */
  readonly unreadableLines: readonly CardLedgerUnreadableLine[];
}

/**
 * Read the card-landing ledger once, for every relay a pass judges.
 *
 * @returns the rows, the active landings and the lines that did not read, or why the ledger would not read
 */
export function readRelayLandingLedger({ home }: { home: string }): Result<RelayLandingLedger, CardLandingError> {
  const read = readCardLandings({ home });
  if (read.isErr()) {
    return err(read.error);
  }
  return ok({
    active: activeCardLandings({ rows: read.value.rows }),
    rows: read.value.rows,
    unreadableLines: read.value.unreadableLines,
  });
}

/**
 * A landing reader for a pass over many relays: the ledger is read on the first relay that reaches the landing source
 * and reused for every later one, so a board with no uncut relay never opens it.
 *
 * @param handoverDir the board directory the asks' rows are read from
 * @returns a reader of one relay's landing evidence, by its anchor and slug
 */
export function relayLandingReader({
  handoverDir,
  home,
}: {
  handoverDir: string;
  home: string;
}): (relay: { readonly anchor: string; readonly slug: string }) => RelayLandingEvidence {
  let read: Result<RelayLandingLedger, CardLandingError> | undefined;
  // Read once, on the first relay that reaches the landing source, and shared by every later one.
  const ledgerOnce = (): Result<RelayLandingLedger, CardLandingError> => {
    if (read !== undefined) {
      return read;
    }
    const fresh = readRelayLandingLedger({ home });
    read = fresh;
    return fresh;
  };
  return ({ anchor, slug }) =>
    readRelayLandingEvidence({ anchor, handoverDir, home, ledger: ledgerOnce(), relaySlug: slug });
}

/**
 * Where one relay's landing on its `ask:` card stands, and what the ask's row shows was done since it registered.
 *
 * @param anchor the relay row's normalised `talk:<turnId>` anchor
 * @param handoverDir the board directory the ask's row is read from
 * @param ledger the prepared card-landing ledger, or why it would not read
 * @param relaySlug the relay row's own slug — a landing naming it carries no other row's work
 * @returns `inactive` for a relay over no ask or with no standing landing, `active` with the ask's action, or why a
 *   register would not read
 */
export function readRelayLandingEvidence({
  anchor,
  handoverDir,
  home,
  ledger,
  relaySlug,
}: {
  anchor: string;
  handoverDir: string;
  home: string;
  ledger: Result<RelayLandingLedger, CardLandingError>;
  relaySlug: string;
}): RelayLandingEvidence {
  const turn = readTurn({ home, turnId: anchor.slice(anchor.indexOf(":") + 1) });
  if (turn.isErr()) {
    return { kind: "unreadable", why: `the relay's turn would not read: ${turn.error.message}` };
  }
  const { about, registeredAtIso } = turn.value;
  if (!about.startsWith(ASK_PREFIX)) {
    return { kind: "inactive" };
  }
  if (ledger.isErr()) {
    return { kind: "unreadable", why: `the card-landing ledger would not read: ${ledger.error.message}` };
  }
  const { active, rows, unreadableLines } = ledger.value;
  // A line that did not read and may be about this ask could be this relay's landing, a restore that lifted it, or a
  // later landing that put it back — so whatever the readable rows say, its standing is unknown.
  const unreadable = unreadableCardLinesForKeys({ cardKeys: new Set([about]), lines: unreadableLines }).length;
  if (unreadable > 0) {
    return { kind: "unreadable", why: `${String(unreadable)} line(s) of the card-landing ledger did not read` };
  }
  const landing = relayLanding({
    active: active.filter(fromRelay),
    anchor,
    cardKey: about,
    rows: rows.filter(fromRelay),
  });
  // Only a landing naming the ask's own row as the work files the relay into it — the hooks' filter
  // (`../cli/commands/handover/relaySettleForWork.ts`); one naming another row is not this source's to follow.
  if (landing.kind !== "active" || landing.workSlug !== about.slice(ASK_PREFIX.length)) {
    return { kind: "inactive" };
  }
  // No registration instant leaves nothing to date the ask's action against, so this source decides nothing.
  if (landing.workSlug === relaySlug || registeredAtIso === null) {
    return { action: undefined, kind: "active", workSlug: landing.workSlug };
  }
  const action = rowActionSince({
    anchor: undefined,
    datedSettlementOnly: true,
    handoverDir,
    registeredAtIso,
    runsDir: stateHomePaths({ home }).runs,
    slug: landing.workSlug,
  });
  if (action?.kind === "unread") {
    return { kind: "unreadable", why: `${landing.workSlug}'s row would not read: ${action.why}` };
  }
  return { action, kind: "active", workSlug: landing.workSlug };
}
