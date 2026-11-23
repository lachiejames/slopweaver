/**
 * The sweep's own entrance gate: which of the asks it selected are PERMANENTLY IGNORED, and therefore not
 * its business at all.
 *
 * ## The measurement
 *
 * `slopweaver turn dispatch --sweep` printed
 * `ready: D0SYN000001/1789422881.103369 — <path> (unposted 9045m, check its reviewer)` for an ask
 * `live/slack/ignored-asks.jsonl` had carried for days, ignored on the owner's own word.
 * The answer file that line named had long since been reaped, so the sweep was inviting a
 * session to re-answer an ask the owner had killed, with a path that no longer resolved. Six days, every ten
 * minutes.
 *
 * ## Why the state is permanent without this
 *
 * `slopweaver turn ignore` writes the registry entry and settles the message's live indicators
 * (`../../cli/commands/turn/ignoreIndicators.ts`); it appends NOTHING to the ask-lifecycle log, and
 * `../ask/lifecycleEvents.ts#terminalAskLifecycleEvent` admits only `answered`, `triaged-no-response`,
 * `withheld` and `satisfied-elsewhere`. So an ask ignored AFTER it was dispatched keeps its `activeDispatch`
 * forever, and every arm of the sweep keys on exactly that. A new terminal event kind was considered and
 * rejected: it would be retroactive for nothing already on disk, while the registry read fixes the standing
 * state with no migration — and the registry is deliberately not the lifecycle log (`../ask/ignore.ts`'s own
 * header says why).
 *
 * ## The whole ask is excluded, not just the `ready` arm
 *
 * Three of the five things the sweep does to a dispatched ask are outbound WRITES: `assertAskReaction`
 * converges the message's reaction back to `working` — undoing the settle `turn ignore` just performed —
 * `settleSweptTerminal` posts a finalised card, and `reconcileStrandedReviewer` presses ENTER on a live
 * surface. Suppressing only the `ready` reading would leave the same defect standing one arm over, so the
 * partition runs over the sweep's whole selection and both of its passes.
 *
 * **The residue, stated rather than discovered**: a worker still holding an ask that was ignored mid-turn is
 * no longer reaped by the sweep, so its workspace is not released. That is what {@link ignoredSweepLine}
 * exists for — the ask is NAMED on every tick, with the registry that caught it and the reason recorded, so
 * an operator can close the workspace by hand rather than find out from a leak.
 */
import type { IgnoredAsk } from "../ask/ignore.js";
import type { IgnoredConversation } from "../ask/ignoredConversation.js";
import { ignoredEntranceVerdict } from "../ask/ignoredEntrance.js";
import type { AskLifecycle } from "../ask/lifecycle.js";

/** One ask the sweep will not touch, and the registry entry that decided it. */
export interface IgnoredSweepAsk {
  readonly entry: AskLifecycle;
  readonly registry: "ask" | "conversation";
  readonly reason: string;
  readonly since: string;
}

/**
 * Split the asks a sweep selected into the ones it may judge and the ones a permanent ignore registry has
 * already answered for. Pure and total.
 *
 * Both registries are consulted through `../ask/ignoredEntrance.ts`'s single verdict, which is the one call
 * every other entrance in the tree makes — the listener's capture, `turn brief`, `turn dispatch`'s admit
 * path, `turn resume`, `turn answer` and `listen recover`. A sweep honouring one registry and not the other
 * would be the only entrance asking half the question.
 *
 * Order is preserved within both halves, which is what keeps `../../cli/commands/turn/dispatchSweep.ts`'s
 * two-pass ordering — unrouted findings print first, as the owner asked — untouched by this filter.
 *
 * @param entries the asks this sweep selected, in log order
 * @param ignoredAsks the folded exact-ask registry
 * @param ignoredConversations the folded conversation registry
 * @returns the asks to sweep, and the ones a registry suppressed
 */
export function partitionIgnoredSweepAsks({
  entries,
  ignoredAsks,
  ignoredConversations,
}: {
  entries: readonly AskLifecycle[];
  ignoredAsks: ReadonlyMap<string, IgnoredAsk>;
  ignoredConversations: ReadonlyMap<string, IgnoredConversation>;
}): { readonly sweep: readonly AskLifecycle[]; readonly ignored: readonly IgnoredSweepAsk[] } {
  const sweep: AskLifecycle[] = [];
  const ignored: IgnoredSweepAsk[] = [];
  for (const entry of entries) {
    const verdict = ignoredEntranceVerdict({ askIdentity: entry, ignoredAsks, ignoredConversations });
    if (verdict === undefined) {
      sweep.push(entry);
      continue;
    }
    ignored.push({ entry, reason: verdict.entry.reason, registry: verdict.kind, since: verdict.entry.ignoredAtIso });
  }
  return { ignored, sweep };
}

/**
 * The sweep's line for one ask a registry suppressed — never a finding, always printed, and carrying the
 * command that lifts it.
 *
 * It names the lift rather than leaving a reader to find it because the one case this is wrong in is an ask
 * ignored by mistake, and a suppression with no visible way out is how a correct gate becomes a dead end.
 *
 * @param ask the suppressed ask and the registry entry that decided it
 * @returns the line to write
 */
export function ignoredSweepLine({ ask }: { ask: IgnoredSweepAsk }): string {
  const where = ask.registry === "ask" ? "this exact ask is" : "this whole conversation is";
  const lift =
    ask.registry === "ask"
      ? `slopweaver turn ignore --remove --channel ${ask.entry.channel} --message-ts ${ask.entry.messageTs} --reason "<why>"`
      : `slopweaver turn ignore-conversation --remove --channel ${ask.entry.channel} --reason "<why>"`;
  return (
    `ignored (not swept): ${ask.entry.channel}/${ask.entry.messageTs} — ${where} permanently ignored ` +
    `since ${ask.since} (${ask.reason}); lift it with ${lift}`
  );
}
