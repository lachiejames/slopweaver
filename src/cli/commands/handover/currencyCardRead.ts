/**
 * The registers behind every Queue card `handover currency` reads, read STRICTLY: the effectful edge over
 * `../../../handover/currencyCards.ts`.
 *
 * A reading is complete or it is not written. A register that would not read, or read while passing over lines it
 * could not make a row of, is an error here rather than a shorter list — a reading missing a card it cannot name
 * would tell the console that card was never checked while claiming the check ran. One read is the exception, because it does not lose a card: a monitor's last pass that will not read
 * leaves its step's card in the reading, its facts unconfirmed and saying why.
 */
import { err, ok, type Result } from "#lib/result.js";

import { foldQueue, parseQueueLog } from "../../../admit/queue.js";
import { readQueueTextOrError } from "../../../admit/queueStore.js";
import { readReviewDraftLines } from "../../../admit/reviewDraftStore.js";
import { readSlackDraftLinesOrError } from "../../../admit/slackDraftStore.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import type { CurrencyCardCandidate } from "../../../handover/currency.js";
import {
  type CurrencyCardReadError,
  CurrencyCardReadErrors,
  handCurrencyCards,
  landingCurrencyCards,
  monitorOfStep,
  monitorPassOf,
  type RecordedMonitorPass,
} from "../../../handover/currencyCards.js";
import {
  heldReplyCurrencyCards,
  reviewDraftCurrencyCards,
  slackDraftCurrencyCards,
} from "../../../handover/currencyHeldCards.js";
import type { MonitorId } from "../../../monitor/types.js";
import { foldReviewDrafts, parseReviewDraftLog } from "../../../outbound/github/reviewDraft.js";
import { foldSlackDraftLog, parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import { lastReading } from "../../../readings/store.js";

/** The producer the tick records `github landing --json` under. */
const LANDING_PRODUCER = "github landing";

/**
 * Each monitor's last recorded pass, for every monitor that owns an open step.
 *
 * @param monitorIds the monitors
 * @param home the state home
 * @returns each one's pass, a pass that would not read saying why
 */
function monitorPassesOf({
  monitorIds,
  home,
}: {
  monitorIds: ReadonlySet<MonitorId>;
  home: string;
}): Map<MonitorId, RecordedMonitorPass> {
  const passes = new Map<MonitorId, RecordedMonitorPass>();
  for (const monitorId of monitorIds) {
    const read = lastReading({ home, producer: `monitor check ${monitorId}` });
    if (read.isErr() && read.error.code === "NO_READING") {
      passes.set(monitorId, { kind: "unread", why: "no pass of its monitor is recorded" });
      continue;
    }
    // The error's message can name a path under the state home, so it rides `detail`, never the card's Facts line.
    if (read.isErr()) {
      passes.set(monitorId, {
        detail: read.error.message,
        kind: "unread",
        why: "its monitor's last pass would not read",
      });
      continue;
    }
    passes.set(
      monitorId,
      monitorPassOf({ document: read.value.document, monitorId, observedAtIso: read.value.record.observedAtIso }),
    );
  }
  return passes;
}

/**
 * The hand register's cards.
 *
 * @param home the state home
 * @param checkedIso the verb's clock
 * @returns the cards, or why the register is not whole
 */
function handCards({
  home,
  checkedIso,
}: {
  home: string;
  checkedIso: string;
}): Result<CurrencyCardCandidate[], CurrencyCardReadError> {
  const read = readOpenHandSteps({ home });
  if (read.isErr()) {
    return err(CurrencyCardReadErrors.unreadable({ source: "hand register", why: read.error.message }));
  }
  if (read.value.unparsed.length > 0) {
    return err(CurrencyCardReadErrors.partial({ lines: read.value.unparsed.length, source: "hand register" }));
  }
  const monitorIds = new Set(
    read.value.steps.flatMap((step) => {
      const monitorId = monitorOfStep({ stepId: step.id });
      return monitorId === undefined ? [] : [monitorId];
    }),
  );
  const passes = monitorPassesOf({ home, monitorIds });
  return ok(handCurrencyCards({ checkedIso, passes, steps: read.value.steps }));
}

/**
 * The held-reply queue's cards.
 *
 * @param home the state home
 * @param checkedIso the verb's clock
 * @returns the cards, or why the queue is not whole
 */
function heldReplyCards({
  home,
  checkedIso,
}: {
  home: string;
  checkedIso: string;
}): Result<CurrencyCardCandidate[], CurrencyCardReadError> {
  const text = readQueueTextOrError({ home });
  if (text.isErr()) {
    return err(CurrencyCardReadErrors.unreadable({ source: "held-reply queue", why: text.error.message }));
  }
  const parsed = parseQueueLog({ text: text.value });
  if (parsed.unreadable.length > 0) {
    return err(CurrencyCardReadErrors.partial({ lines: parsed.unreadable.length, source: "held-reply queue" }));
  }
  return ok(heldReplyCurrencyCards({ checkedIso, items: foldQueue({ events: parsed.events }) }));
}

/**
 * The parked posts' cards.
 *
 * @param home the state home
 * @param checkedIso the verb's clock
 * @returns the cards, or why the register is not whole
 */
function postCards({
  home,
  checkedIso,
}: {
  home: string;
  checkedIso: string;
}): Result<CurrencyCardCandidate[], CurrencyCardReadError> {
  const lines = readSlackDraftLinesOrError({ home });
  if (lines.isErr()) {
    return err(CurrencyCardReadErrors.unreadable({ source: "draft register", why: lines.error.message }));
  }
  const log = parseSlackDraftLog({ lines: lines.value });
  if (log.skipped.length > 0) {
    return err(CurrencyCardReadErrors.partial({ lines: log.skipped.length, source: "draft register" }));
  }
  return ok(slackDraftCurrencyCards({ checkedIso, items: foldSlackDraftLog({ log }) }));
}

/**
 * The parked reviews' cards.
 *
 * @param home the state home
 * @param checkedIso the verb's clock
 * @returns the cards, or why the register is not whole
 */
function reviewCards({
  home,
  checkedIso,
}: {
  home: string;
  checkedIso: string;
}): Result<CurrencyCardCandidate[], CurrencyCardReadError> {
  const lines = readReviewDraftLines({ home });
  if (lines.isErr()) {
    return err(CurrencyCardReadErrors.unreadable({ source: "review register", why: lines.error.message }));
  }
  const log = parseReviewDraftLog({ lines: lines.value });
  if (log.skipped > 0) {
    return err(CurrencyCardReadErrors.partial({ lines: log.skipped, source: "review register" }));
  }
  return ok(reviewDraftCurrencyCards({ checkedIso, items: foldReviewDrafts({ events: log.events }) }));
}

/**
 * The pull requests' cards, off the last landing reading the tick recorded. No reading at all is no pull-request
 * cards — the console draws none either — while a reading that will not read is an error.
 *
 * @param home the state home
 * @returns the cards, or why the reading is not one this reads
 */
function pullRequestCards({ home }: { home: string }): Result<CurrencyCardCandidate[], CurrencyCardReadError> {
  const read = lastReading({ home, producer: LANDING_PRODUCER });
  if (read.isErr()) {
    if (read.error.code === "NO_READING") {
      return ok([]);
    }
    return err(CurrencyCardReadErrors.unreadable({ source: "landing reading", why: read.error.message }));
  }
  const cards = landingCurrencyCards({ document: read.value.document, observedAtIso: read.value.record.observedAtIso });
  if (cards.kind === "unreadable") {
    return err(CurrencyCardReadErrors.unreadable({ source: "landing reading", why: cards.why }));
  }
  return ok(cards.cards);
}

/**
 * Every card but the asks, which the shell builds once each ask's done-check is read
 * (`../../../handover/currencyCards.ts` `askCurrencyCard`).
 *
 * @param home the state home
 * @param checkedIso the verb's clock — the instant a register still holding a card confirms it at
 * @returns the cards, or the first register that is not whole
 */
export function readCurrencyCardSources({
  home,
  checkedIso,
}: {
  home: string;
  checkedIso: string;
}): Result<readonly CurrencyCardCandidate[], CurrencyCardReadError> {
  const cards: CurrencyCardCandidate[] = [];
  for (const read of [
    () => handCards({ checkedIso, home }),
    () => heldReplyCards({ checkedIso, home }),
    () => postCards({ checkedIso, home }),
    () => reviewCards({ checkedIso, home }),
    () => pullRequestCards({ home }),
  ]) {
    const source = read();
    if (source.isErr()) {
      return err(source.error);
    }
    cards.push(...source.value);
  }
  return ok(cards);
}
