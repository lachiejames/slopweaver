/**
 * A live read of the owner's Airwallex card page, mapped into the same `CardSnapshot` a pasted export becomes.
 *
 * ## Calibrated, never assumed
 *
 * The backend's amounts are bare numbers: nothing says whether `2500` is dollars or cents, and nothing says
 * which card the page's other cards' answers belong to. So the mapper is handed the snapshot already stored
 * for `--last4` and refuses unless the live read agrees with it: the card is the one whose nickname matches,
 * the unit is whichever scale makes the live monthly limit equal the stored one, and a transaction the stored
 * snapshot also holds (same day, status and currency) must carry one of its amounts at that scale. The card
 * number is never read — `--last4` is the operator's, exactly as `spend import`'s `--as-of` is.
 *
 * Every problem found is collected in one pass, because each live run needs a fresh sign-in (the console
 * signs itself out after about twenty minutes idle), and a refusal that
 * names one unknown code at a time costs a sign-in per code.
 */
import type { CapturedResponse } from "../browser/pageTransport.js";
import { err, ok, type Result } from "../lib/result.js";
import {
  type CardDetailsBody,
  type CardLimitsBody,
  type LiveBodies,
  type LiveTransaction,
  liveBodiesOf,
} from "./liveBodies.js";
import { type LiveCaptureError, LiveCaptureErrors } from "./liveErrors.js";
import { checkAmounts, dayOf, minorOf, rowsOf, transactionsOf } from "./liveRows.js";
import type { CardSnapshot, Money } from "./types.js";

/**
 * The monthly window types whose period is the calendar month in UTC. A pasted page reads
 * "resets <Mon> <day> (reset at 10:00 AM UTC+10 the following day)", which is midnight UTC on the 1st.
 * The owner's card answers `MONTHLY` on a live read, the window that page describes.
 */
const CALENDAR_MONTH_WINDOWS: ReadonlySet<string> = new Set(["CALENDAR_MONTH", "MONTHLY"]);

/** The `source.path` a live snapshot carries: where its numbers were read. */
const LIVE_SOURCE_PATH = "the owner's Airwallex card page, read live";

/** A snapshot built from a live read, and how much of the card's history the page's one page of rows held. */
export interface LiveSnapshot {
  readonly snapshot: CardSnapshot;
  readonly rowsRead: number;
  readonly rowsOnCard: number;
}

/**
 * Build a snapshot from one capture of the card page, calibrated against the one already stored.
 *
 * @param responses what the card page heard
 * @param calibration the newest snapshot stored for `last4`
 * @param capturedAt when the capture settled, ISO-8601
 * @param timeZone the IANA zone the page prints days in — the owner's machine's own
 * @returns the snapshot, or the typed refusal naming every problem found
 */
export function snapshotFromCapture({
  calibration,
  capturedAt,
  responses,
  timeZone,
}: {
  responses: readonly CapturedResponse[];
  calibration: CardSnapshot;
  capturedAt: string;
  timeZone: string;
}): Result<LiveSnapshot, LiveCaptureError> {
  const bodies = liveBodiesOf({ responses });
  if (bodies.isErr()) {
    return err(bodies.error);
  }
  const card = cardOnPage({ bodies: bodies.value, calibration });
  if (card.isErr()) {
    return err(card.error);
  }
  const limits = bodies.value.limits.findLast((body) => body.data.getCard.id === card.value.data.getCard.id);
  if (limits === undefined) {
    return err(LiveCaptureErrors.operationMissing({ operation: "GetCardLimits for the card" }));
  }
  const problems: string[] = [];
  const page = rowsOf({ bodies: bodies.value, cardId: card.value.data.getCard.id });
  const snapshot = liveSnapshotOf({
    calibration,
    capturedAt,
    card: card.value,
    limits,
    problems,
    rows: page.rows,
    timeZone,
  });
  if (problems.length > 0) {
    return err(LiveCaptureErrors.uncalibrated({ problems: [...new Set(problems)] }));
  }
  return ok({ rowsOnCard: page.rowsOnCard, rowsRead: snapshot.transactions.length, snapshot });
}

/**
 * The snapshot one calibrated capture describes, every problem found recorded rather than returned early.
 *
 * @param card the card's details
 * @param limits the card's limits
 * @param rows the card's transaction rows
 * @param calibration the stored snapshot
 * @param capturedAt when the capture settled
 * @param timeZone the zone the page prints days in
 * @param problems where every failed calibration is recorded; the snapshot is meaningless unless it stays empty
 * @returns the snapshot
 */
function liveSnapshotOf({
  calibration,
  capturedAt,
  card,
  limits,
  problems,
  rows,
  timeZone,
}: {
  calibration: CardSnapshot;
  capturedAt: string;
  card: CardDetailsBody;
  limits: CardLimitsBody;
  problems: string[];
  rows: readonly LiveTransaction[];
  timeZone: string;
}): CardSnapshot {
  const { monthly, perTransactionLimit } = limits.data.getCard;
  const stored = calibration.monthly.limit;
  const calibrated = monthlyUnitOf({ monthly, problems, stored });
  // An uncalibrated unit has already refused the read; major units keep the pass collecting every OTHER problem.
  let scale = 100;
  if (calibrated !== null) {
    scale = calibrated;
  }
  const transactions = transactionsOf({ problems, rows, scale, timeZone });
  if (calibrated !== null) {
    checkAmounts({ problems, stored: calibration.transactions, transactions });
  }
  let asOf = dayOf({ text: capturedAt, timeZone });
  if (asOf === null) {
    problems.push("the capture's own time is not an instant");
    asOf = capturedAt;
  }
  const money = ({ amount }: { amount: number }): Money => ({
    currency: monthly.currency,
    minor: minorOf({ amount, problems, scale }),
  });
  return {
    asOf,
    last4: calibration.last4,
    merchantAllow: null,
    monthly: {
      limit: stored,
      resetNote: null,
      resetsOn: utcMonthEnd({ iso: capturedAt }),
      used: money({ amount: monthly.spendAmount }),
    },
    nickname: card.data.getCard.nickname,
    organisation: organisationOf({ card, problems }),
    provider: "airwallex",
    schemaVersion: 1,
    source: { importedAt: capturedAt, kind: "live", path: LIVE_SOURCE_PATH },
    transactionLimit: money({ amount: perTransactionLimit }),
    transactions,
  };
}

/**
 * The card on the page whose nickname is the stored snapshot's — the page also answers for the owner's other cards.
 *
 * @param bodies the parsed operations
 * @param calibration the stored snapshot
 * @returns the card's details, `LIVE_CARD_NOT_ON_PAGE` when none matches, or `LIVE_UNCALIBRATED` when two do
 */
function cardOnPage({
  bodies,
  calibration,
}: {
  bodies: LiveBodies;
  calibration: CardSnapshot;
}): Result<CardDetailsBody, LiveCaptureError> {
  const named = bodies.details.filter((body) => body.data.getCard.nickname === calibration.nickname);
  const ids = new Set(named.map((body) => body.data.getCard.id));
  const first = named[0];
  if (first === undefined) {
    return err(LiveCaptureErrors.cardNotOnPage({ last4: calibration.last4 }));
  }
  if (ids.size > 1) {
    return err(
      LiveCaptureErrors.uncalibrated({
        problems: [`${String(ids.size)} cards on the page carry the stored nickname, so which is --last4 is not known`],
      }),
    );
  }
  return ok(first);
}

/**
 * The monthly window's unit, with its currency and window type checked against the stored snapshot.
 *
 * @param monthly the live monthly window
 * @param stored the stored monthly limit
 * @param problems where every disagreement is recorded
 * @returns the calibrated scale, or null when the limits do not agree in either unit
 */
function monthlyUnitOf({
  monthly,
  problems,
  stored,
}: {
  monthly: CardLimitsBody["data"]["getCard"]["monthly"];
  problems: string[];
  stored: Money;
}): number | null {
  if (monthly.currency !== stored.currency) {
    problems.push(`the monthly limit is in ${monthly.currency}, the stored one in ${stored.currency}`);
  }
  if (!CALENDAR_MONTH_WINDOWS.has(monthly.windowType)) {
    problems.push(
      `monthly window type ${monthly.windowType} is not in CALENDAR_MONTH_WINDOWS, so its reset is not known`,
    );
  }
  return scaleOf({ limitAmount: monthly.limitAmount, problems, stored });
}

/**
 * The scale from the backend's amounts to minor units: whichever makes the live monthly limit the stored one.
 *
 * @param limitAmount the live monthly limit, null when the window carries none
 * @param stored the stored monthly limit
 * @param problems where a failed calibration is recorded
 * @returns 100 for major units, 1 for minor, null when neither makes the limits agree
 */
function scaleOf({
  limitAmount,
  problems,
  stored,
}: {
  limitAmount: number | null;
  problems: string[];
  stored: Money;
}): number | null {
  if (limitAmount === null) {
    problems.push("the monthly window carries no limit, so the amounts' unit cannot be calibrated");
    return null;
  }
  if (Math.round(limitAmount * 100) === stored.minor) {
    return 100;
  }
  if (limitAmount === stored.minor) {
    return 1;
  }
  problems.push(
    "the live monthly limit is the stored one in neither major nor minor units — the limit changed, or the unit is " +
      "neither; re-import a pasted export to recalibrate",
  );
  return null;
}

/**
 * The cardholders' one entity name.
 *
 * @param card the card's details
 * @param problems where anything but exactly one entity is recorded
 * @returns the entity name, or the empty string beside a recorded problem
 */
function organisationOf({ card, problems }: { card: CardDetailsBody; problems: string[] }): string {
  const names = [
    ...new Set(
      card.data.getCard.cardExtension.allCardholders.map((holder) => holder.userOrgEnrollment.employmentEntityName),
    ),
  ];
  const only = names[0];
  if (names.length !== 1 || only === undefined) {
    problems.push(`the card's cardholders name ${String(names.length)} entities, not one`);
    return "";
  }
  return only;
}

/**
 * The last day of an instant's UTC month — the day the monthly window resets after.
 *
 * @param iso an ISO instant
 * @returns the `YYYY-MM-DD` month end, or the text itself when it is no instant — already a recorded problem
 */
function utcMonthEnd({ iso }: { iso: string }): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return iso;
  }
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}
