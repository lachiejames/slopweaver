"use client";

import type { ReactElement } from "react";

import type { CurrencyReading } from "../../lib/cardCurrency";
import { type ProofCard, proofGapsOf } from "../../lib/prProof";
import type { QueueRow } from "../../lib/queueRows";
import { readCurrencyReading } from "../live/readCurrency";
import type { Reading } from "../live/reading";
import { readyValueOf, useLive } from "../live/useLive";
import { FAST_POLL_MS } from "./useQueueRows";

/**
 * The part of a row the gap match reads: its keys, on a pull request's own card its address, and the pull requests
 * the board row it opens names now — an ask's own row, or the ask a hand step opens.
 *
 * @param row the row
 * @returns what `proofGapsOf` matches on
 */
export function proofCardOf({ row }: { row: QueueRow }): ProofCard {
  const keys = [row.key, ...(row.aliases ?? [])];
  const { record } = row;
  if (record.kind === "pr") {
    return { keys, named: undefined, pullRequest: `${record.row.repoSlug}#${String(record.row.number)}` };
  }
  if (record.kind === "ask") {
    return { keys, named: record.row.prNamed, pullRequest: undefined };
  }
  if (record.kind === "hand" && record.decision !== undefined) {
    return { keys, named: record.decision.ask.prNamed, pullRequest: undefined };
  }
  return { keys, named: undefined, pullRequest: undefined };
}

/**
 * The line a card about a pull request leads with when the owner asked for proof its body still lacks — drawn ahead of the
 * question, on the collapsed row as what is missing and on the opened card as the sentence carrying the owner's words.
 * Nothing at all when no unmet ask covers the card, so a card with no gap looks as it always did.
 *
 * @param row the row
 * @param opened whether this is the opened card, which draws the whole sentence rather than the short line
 * @returns the line, or nothing
 */
export function ProofGapLead({ row, opened }: { row: QueueRow; opened: boolean }): ReactElement | null {
  const currency = useLive<Reading<CurrencyReading>>({
    everyMs: FAST_POLL_MS,
    read: readCurrencyReading,
    slug: "currency-reading",
  });
  const gaps = proofGapsOf({ card: proofCardOf({ row }), reading: readyValueOf({ state: currency })?.value });
  if (gaps.length === 0) {
    return null;
  }
  return (
    <span
      className="mb-[0.2rem] block text-[0.8rem] leading-[1.4] font-semibold wrap-anywhere text-warning"
      data-proof-gap
    >
      {gaps.map((gap) => (
        <span key={gap.identity} className="block">
          {opened ? gap.sentence : gap.short}
        </span>
      ))}
    </span>
  );
}
