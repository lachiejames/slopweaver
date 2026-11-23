/**
 * Whether a sender group is ALREADY CARDED — one pin's card row, read off the board, decided. Pure.
 *
 * The inbox-triage recipe skips a group "already carded and unanswered" (`skills/automation/reference/inbox-triage.md`
 * step 4), and that used to be the seat's own reading of the board. It read one shape wrong every firing: a card
 * settled `filed` derives `done` (`../../handover/derivedRowState.ts`), so a card filed INTO an ask that is still open
 * read as settled, and the same unread mail was carded again on every pass. So `filed` is followed here ONE step, the
 * way `../automation/failureHold.ts` follows it, and the group is carded while the row it was filed into stands open.
 *
 * The failure direction is the OPPOSITE of the failure hold's, and that is the policy rather than a slip: an unread
 * finding keeps a recipe held, while an unread card row must never hide mail from the owner. So only a row PROVEN open says
 * carded; a missing, closed or unreadable one says not carded, and an unreadable one carries `reason: "unreadable"`
 * so the shell can say so rather than card silently over damaged state.
 */
import type { Result } from "#lib/result.js";

import { isTerminalDocStatus } from "../../handover/doc.js";
import type { DerivedRowReadError, ReadableDerivedRowState } from "../../handover/rowState.js";
import type { GmailTriageCard } from "./triageCards.js";

/** One board row's read, as `readDerivedRowState` answers it. */
export type TriageRowRead = Result<ReadableDerivedRowState, DerivedRowReadError>;

/**
 * Why a pin's card stands the way it does — what the shell branches on, so it never parses {@link
 * TriageCardStanding.line}: `open-row` and `filed-open` are carded; the rest are not, and `unreadable` and
 * `missing` are reported.
 */
type TriageCardStandingReason = "open-row" | "filed-open" | "terminal" | "settled" | "missing" | "unreadable";

/** One pin's card, decided. */
export interface TriageCardStanding {
  /** True only when the card row, or the row it was filed into, is PROVEN open. */
  readonly carded: boolean;
  readonly reason: TriageCardStandingReason;
  /** The card's own slug — the pin's. */
  readonly slug: string;
  /** The key the pin was read from. */
  readonly key: string;
  /** The row a `filed` settlement names, or `null` when the card was not settled `filed` or named none. */
  readonly filedInto: string | null;
  /** One line a reader can act on. */
  readonly line: string;
}

/**
 * Why an `unknown` status proves nothing: the doc parser answers `unknown` for a status it could not read, so it is
 * damaged state rather than an open card — reported, never a skip.
 */
const UNKNOWN_STATUS = "declares a status the board could not read (unknown), so nothing proves it open";

/** The standing for a `filed` card: carded while the row it was filed into is open, one step and no further. */
function filedStanding({
  card,
  filedInto,
  witness,
}: {
  card: GmailTriageCard;
  filedInto: string | undefined;
  witness: TriageRowRead | null;
}): TriageCardStanding {
  const base = { key: card.key, slug: card.slug } as const;
  if (filedInto === undefined || witness === null) {
    return {
      ...base,
      carded: false,
      filedInto: null,
      line: `card ${card.slug} was settled filed into no board row, so nothing says it is still open`,
      reason: "unreadable",
    };
  }
  if (witness.isErr()) {
    const reason = witness.error.code === "ROW_MISSING" ? "missing" : "unreadable";
    return {
      ...base,
      carded: false,
      filedInto,
      line: `card ${card.slug} was filed into ${filedInto}, and ${witness.error.message}`,
      reason,
    };
  }
  if (witness.value.authoredStatus === "unknown" || witness.value.status === "unknown") {
    return {
      ...base,
      carded: false,
      filedInto,
      line: `card ${card.slug} was filed into ${filedInto}, ${UNKNOWN_STATUS}`,
      reason: "unreadable",
    };
  }
  if (witness.value.archived || isTerminalDocStatus(witness.value.status)) {
    const state = witness.value.archived ? "archived" : witness.value.status;
    return {
      ...base,
      carded: false,
      filedInto,
      line: `card ${card.slug} was filed into ${filedInto}, which is ${state}`,
      reason: "terminal",
    };
  }
  return {
    ...base,
    carded: true,
    filedInto,
    line: `card ${card.slug} was filed into ${filedInto}, still ${witness.value.status}`,
    reason: "filed-open",
  };
}

/**
 * Decide whether one pin's card still stands open on the board.
 *
 * @param card the pin, whose slug names the card row
 * @param row the card row, read
 * @param witness the row a `filed` settlement names, read — `null` when the card was not settled `filed`, or named
 *   no row the run store can open
 * @returns whether the group is carded by this pin, why, and the line saying so
 */
export function triageCardStanding({
  card,
  row,
  witness,
}: {
  readonly card: GmailTriageCard;
  readonly row: TriageRowRead;
  readonly witness: TriageRowRead | null;
}): TriageCardStanding {
  const base = { filedInto: null, key: card.key, slug: card.slug } as const;
  if (row.isErr()) {
    const reason = row.error.code === "ROW_MISSING" ? "missing" : "unreadable";
    return { ...base, carded: false, line: row.error.message, reason };
  }
  const { archived, authoredStatus, settlement, settlementWitness, status } = row.value;
  // Before the settlement: a `filed` card derives `done` whatever it declared, so a status the parser could not read
  // would vanish under it and a damaged row would card through its witness.
  if (authoredStatus === "unknown" || status === "unknown") {
    return { ...base, carded: false, line: `card ${card.slug} ${UNKNOWN_STATUS}`, reason: "unreadable" };
  }
  // An archived card is off the board, so it stands for nothing open — and its settlement is not followed either.
  if (archived) {
    return { ...base, carded: false, line: `card ${card.slug} is archived`, reason: "terminal" };
  }
  // Before the status: a `filed` card derives `done`, which is the very misreading this module exists to end.
  if (settlement === "filed") {
    return filedStanding({ card, filedInto: settlementWitness, witness });
  }
  if (settlement !== undefined) {
    return { ...base, carded: false, line: `card ${card.slug} was settled ${settlement}`, reason: "settled" };
  }
  if (isTerminalDocStatus(status)) {
    return { ...base, carded: false, line: `card ${card.slug} is ${status}`, reason: "terminal" };
  }
  return { ...base, carded: true, line: `card ${card.slug} is ${status}, unanswered`, reason: "open-row" };
}

/** How strongly a standing speaks for its key: a carded one over an unreadable one over any other. */
function weight({ standing }: { standing: TriageCardStanding }): number {
  if (standing.carded) {
    return 2;
  }
  return standing.reason === "unreadable" ? 1 : 0;
}

/**
 * Fold every pin's standing into one per key: one proven-open card carries the key whatever its other pins say, and
 * an unreadable one outranks a plainly closed one so it is reported. Ties keep the first in the given order.
 *
 * @param standings every pin's standing, in a deterministic order
 * @returns one standing per key
 */
export function standingsByKey({
  standings,
}: {
  readonly standings: readonly TriageCardStanding[];
}): ReadonlyMap<string, TriageCardStanding> {
  const byKey = new Map<string, TriageCardStanding>();
  for (const standing of standings) {
    const held = byKey.get(standing.key);
    if (held === undefined || weight({ standing }) > weight({ standing: held })) {
      byKey.set(standing.key, standing);
    }
  }
  return byKey;
}
