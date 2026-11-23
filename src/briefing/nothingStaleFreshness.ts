/**
 * Whether one document the "Nothing stale" section reads is still the producer's CURRENT answer — judged
 * against the producing standing row's own cadence, never against a number this section picked.
 *
 * ## The rule: a document is current until a firing of its row passes without replacing it
 *
 * A document landed shortly after the slot of a `0 7 * * *` row is current until the next day's slot, and from that
 * slot on it is YESTERDAY'S answer — whether that morning's run is still in flight, failed, or never started,
 * the page cannot tell which, and in none of them is the old read today's. So it becomes a named gap the moment
 * one firing has passed, and the gap names the slot it is waiting on. There is no tolerance window: any number
 * would be one this section picked, and a briefing rendered before the morning run lands saying "not an
 * all-clear" is the truth. A looser "more than one firing" bound lets a failed run leave
 * yesterday's queue and reviewers read as current all day.
 *
 * The firings are counted by `../live/automation/firingCalculus.ts`'s `firingsBetween`, the helper `automation due`
 * counts missed slots with, so this judgement and the schedule's own cannot disagree about when a slot was.
 *
 * A cadence that will not parse, or an instant that is not one, is never read as fresh: the document becomes
 * a named gap, exactly as a missing one does.
 *
 * Pure: `nowIso` is supplied.
 */
import { firingsBetween } from "../live/automation/firingCalculus.js";
import type { DocumentInput } from "./nothingStaleTypes.js";

/** Whether a document is current, or the one sentence saying why it is not. */
export type FreshnessVerdict = { readonly fresh: true } | { readonly fresh: false; readonly reason: string };

/**
 * Judge one document's age against its producing row's cadence.
 *
 * @param observedAtIso when the document's producer last succeeded
 * @param cadence the producing standing row's cron cadence
 * @param nowIso the instant the section is read at
 * @param label the document as the reason names it
 * @returns fresh, or the reason it is not
 */
export function judgeDocumentFreshness({
  observedAtIso,
  cadence,
  nowIso,
  label,
}: {
  readonly observedAtIso: string;
  readonly cadence: string;
  readonly nowIso: string;
  readonly label: string;
}): FreshnessVerdict {
  if (Number.isNaN(Date.parse(observedAtIso))) {
    return { fresh: false, reason: `${label} carries no readable instant (${observedAtIso})` };
  }
  const firings = firingsBetween({ afterIso: observedAtIso, cadence, nowIso });
  if ("error" in firings) {
    return { fresh: false, reason: `${label}'s row cadence \`${cadence}\` does not schedule: ${firings.error}` };
  }
  if (firings.count > 0) {
    return {
      fresh: false,
      reason:
        `${label} last landed ${observedAtIso}, and ${String(firings.count)} firing(s) of \`${cadence}\` have ` +
        `passed since (the latest ${String(firings.latestIso)}) without replacing it`,
    };
  }
  return { fresh: true };
}

/**
 * Turn an available document that is no longer current into the gap it is; pass everything else through.
 *
 * @param input the document as it was read
 * @param nowIso the instant the section is read at
 * @param label the document as a reason names it
 * @returns the same input when current or already a gap, else a `could-not-see` naming why
 */
export function currentOnly<T>({
  input,
  nowIso,
  label,
}: {
  readonly input: DocumentInput<T>;
  readonly nowIso: string;
  readonly label: string;
}): DocumentInput<T> {
  if (input.kind === "could-not-see") {
    return input;
  }
  const verdict = judgeDocumentFreshness({
    cadence: input.value.cadence,
    label,
    nowIso,
    observedAtIso: input.value.observedAtIso,
  });
  if (verdict.fresh) {
    return input;
  }
  return { kind: "could-not-see", reason: verdict.reason };
}
