/**
 * Where a scheduled firing posted, written at fire time while the admitted channel and the confirmed ts are both
 * in hand: the Automations page reads it (`../../../automations/outputs.ts`), and nothing could re-derive it once
 * the row or the profile moves on. A failed write costs that page one posting, never the firing — the post has
 * already gone out, so it is said on stderr and the tick carries on.
 *
 * `investigate` holds the ts itself, off its own post's answer. The two card kinds post through `slack post`, whose
 * exit code is all `runVerb` hands back, so their ts is read off the send ledger the verb confirmed it on — by the
 * same keyed duplicate key the send reserved under (`../../../outbound/slack/fingerprint.ts`), never re-derived
 * from the card's words.
 */
import { recordFiringPosting } from "../../../live/automation/postingLedger.js";
import { keyedDuplicateKey } from "../../../outbound/slack/fingerprint.js";
import { DUPLICATE_WINDOW_HOURS, peekSend } from "../../../outbound/slack/sendReservation.js";
import { EXIT_OK } from "../../exitCodes.js";
import type { RecipeRunDueDeps } from "./rowRunners.js";

/**
 * Record one firing's post, or say on stderr why the Automations page will not show it.
 *
 * @param channel the conversation the post landed in
 * @param ts the post's own Slack timestamp
 * @param slotIso the firing the post delivered
 */
export function notePosting({
  channel,
  deps,
  home,
  recipeId,
  slotIso,
  ts,
}: {
  channel: string;
  deps: Pick<RecipeRunDueDeps, "now" | "writeDiagnostic">;
  home: string;
  recipeId: string;
  slotIso: string;
  ts: string;
}): void {
  const recorded = recordFiringPosting({ home, posting: { channel, postedAtIso: deps.now(), recipeId, slotIso, ts } });
  if (recorded.isErr()) {
    deps.writeDiagnostic(`recipe ${recipeId} · ${recorded.error.join("; ")}`);
  }
}

/**
 * Record a card firing's post off the send ledger, once `slack post --as bot` has delivered it. A dry run and a
 * failed post record nothing; a post whose ledger row carries no ts is said rather than recorded as a guess.
 *
 * @param channel the conversation the card was admitted to and sent to
 * @param idempotencyKey the firing's own delivery id, which the send reserved its ledger row under
 * @param posted the post verb's exit code
 * @param slotIso the firing the card delivered
 */
export function noteCardPosting({
  channel,
  deps,
  dryRun,
  home,
  idempotencyKey,
  posted,
  recipeId,
  slotIso,
}: {
  channel: string;
  deps: Pick<RecipeRunDueDeps, "now" | "writeDiagnostic">;
  dryRun: boolean;
  home: string;
  idempotencyKey: string;
  posted: number;
  recipeId: string;
  slotIso: string;
}): void {
  if (dryRun || posted !== EXIT_OK) {
    return;
  }
  const duplicateKey = keyedDuplicateKey({ actor: "bot", channel, idempotencyKey });
  const sent = peekSend({ duplicateKey, home, nowIso: deps.now(), windowHours: DUPLICATE_WINDOW_HOURS });
  if (sent.kind !== "duplicate" || sent.sentTs === undefined) {
    deps.writeDiagnostic(
      `recipe ${recipeId} · the card posted but its send ledger carries no message ts — ` +
        "the Automations page will not show where this firing posted",
    );
    return;
  }
  notePosting({ channel, deps, home, recipeId, slotIso, ts: sent.sentTs });
}
