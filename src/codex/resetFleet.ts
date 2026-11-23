/**
 * Which Codex stores `codex reset --at-limit` claims a free reset on this run — the PURE planner over one batch
 * live read of every unpaused registered store and the claims journal.
 *
 * ## Why the fleet claims at all
 *
 * The owner's rule: take a store all the way up to 99 percent, do the reset for them so it is abstracted away,
 * and only reset when a store is actually at a limit. So the chair's tick runs this every pass: a store at its limit (`./resetEvidence.ts`'s
 * `storeAtLimit`) holding a reset is claimed, every other store is left alone with one line saying why, and nothing
 * reaches the owner unless a claim itself fails (`../monitor/codexResetFailed.ts`).
 *
 * ## The rules, in the order they decide
 *
 * 1. **An open attempt is always run**, at the limit or not: the single-store path settles it — a retry under its
 *    own key, or a close when the live read shows it over — and that path never mints a second key for it.
 * 2. **One account is claimed once.** Two registered stores signed into one provider account (`accountId`) are one
 *    allowance (`./fleetCap.ts`), so a batch read showing both at the limit would spend two resets on one refill.
 *    The first in register order is claimed, unless another store of that account owns the open attempt; two open
 *    attempts on one account is an ambiguity nothing here can settle safely, so neither is sent.
 * 3. **No fresh claim beside a stranded attempt.** An open attempt on a plan whose account this run cannot read —
 *    paused, gone from the register, or its store unreadable or signed out this pass — may be on the same account,
 *    and its account is unknown here, so every fresh claim fails with the `--plan` command that settles it. Past the
 *    plan, each fresh claim re-checks the journal as it stands (`otherOpenAttempts`, in `resetOne`) and waits while
 *    ANY other plan's attempt is open, one an earlier claim of this same run left unanswered included: an account id
 *    on one read and only an address on another cannot be joined, so rule 2 alone cannot prove two stores apart.
 * 4. **A fresh claim needs the limit and a held reset.** It names the soonest-expiring listed reset, so the one that
 *    would lapse first is the one spent, or lets the provider pick when nothing was itemised.
 * 5. **A store with no usable sign-in is skipped**, never failed: nothing can be claimed there, and a signed-out plan
 *    already reaches the owner as its own card (`codex-plan-signed-out`). A store whose read came back UNREADABLE is a
 *    failure of this run, so the tick reading says so, but it is not a failed claim and raises no note.
 *
 * **The residue, stated.** An open attempt is bound to its ALIAS, and the account it draws on is read live each run.
 * An alias re-registered onto a different account while its attempt is still unanswered moves that attempt with it,
 * so a fresh claim on the original account through another plan is not held. Recording the
 * account on the intent would close it; it was left for a journal change of its own. Coordination is per state home
 * (its lock and its journal): two installations signed into one account are two allowances to this code, by design.
 */
import type { CodexThresholds } from "../plans/thresholds.js";
import { type CodexAccountCandidate, codexAccountRoots } from "./accountIdentity.js";
import type { CodexAccountLive } from "./accountLiveParse.js";
import { type CodexResetJournalRow, openResetAttempt } from "./resetConsume.js";
import { soonestExpiringAvailableCredit, storeAtLimit } from "./resetEvidence.js";

/** One unpaused registered store, paired with what the batch live read found in it. */
export type CodexResetFleetCandidate = CodexAccountCandidate;

/** What the run does about one store. */
export type CodexResetFleetDecision =
  /** Claim on it: an open attempt to settle, or a fresh claim naming `creditId` (undefined = the provider picks). */
  | {
      readonly kind: "run";
      readonly candidate: CodexResetFleetCandidate;
      readonly creditId: string | undefined;
      readonly retry: boolean;
    }
  /** Nothing to do here, and nothing wrong. */
  | { readonly kind: "skip"; readonly alias: string; readonly reason: string }
  /** This run could not judge or safely claim on the store — the tick reading reports it, no note is raised. */
  | { readonly kind: "fail"; readonly alias: string; readonly reason: string };

/**
 * The account each candidate draws on, as a group key: two candidates sharing any identity, directly or through a
 * third, are one account (`./accountIdentity.ts`, the join the pass reservation stands on too).
 *
 * @param candidates the stores in register order
 * @returns one key per candidate, in the same order
 */
function accountGroups({ candidates }: { candidates: readonly CodexResetFleetCandidate[] }): readonly string[] {
  return codexAccountRoots({ candidates }).map((root) => `account-group:${String(root)}`);
}

/** The weekly-or-first window's percentage, for a skip line, or a plain phrase when the read carried none. */
function fullnessOf({ live }: { live: CodexAccountLive & { kind: "signed-in" } }): string {
  const windows = live.gauges.flatMap((gauge) => gauge.windows);
  const shown = windows.toSorted((a, b) => Number(b.label === "weekly") - Number(a.label === "weekly"))[0];
  if (shown === undefined) {
    return "no window reported";
  }
  return `${shown.label} ${String(shown.usedPercent)}% used`;
}

/**
 * The decision for one store with no open attempt, before account deduplication.
 *
 * @param candidate the store and its live read
 * @param thresholds the register's Codex bars, whose pause bar is the limit
 * @returns run (fresh), skip or fail
 */
function freshDecision({
  candidate,
  thresholds,
}: {
  candidate: CodexResetFleetCandidate;
  thresholds: CodexThresholds;
}): CodexResetFleetDecision {
  const { alias } = candidate.destination;
  const { live } = candidate;
  if (live.kind === "unreadable") {
    return { alias, kind: "fail", reason: `its live read failed (${live.reason})` };
  }
  if (live.kind !== "signed-in") {
    return { alias, kind: "skip", reason: `nothing is signed into it (${live.kind})` };
  }
  if (!storeAtLimit({ live, thresholds })) {
    return { alias, kind: "skip", reason: `not at its limit (${fullnessOf({ live })})` };
  }
  if (live.resetCreditsAvailable === 0) {
    return { alias, kind: "skip", reason: `at its limit (${fullnessOf({ live })}) but holds no free reset` };
  }
  const credit = soonestExpiringAvailableCredit({ credits: live.resetCreditsListed });
  return { candidate, creditId: credit === undefined ? undefined : credit.id, kind: "run", retry: false };
}

/**
 * Every journalled plan holding an open attempt whose account this run cannot read — paused, no longer registered, or
 * read this pass without a sign-in (an unreadable store hides its own open attempt). Its account
 * is unknown here, so it may be the same account a fresh claim would spend on.
 *
 * @param candidates the stores this run reads
 * @param rows the whole journal
 * @returns the stranded aliases, in first-journalled order
 */
function strandedOpenAttempts({
  candidates,
  rows,
}: {
  candidates: readonly CodexResetFleetCandidate[];
  rows: readonly CodexResetJournalRow[];
}): readonly string[] {
  const reached = new Set(
    candidates
      .filter((candidate) => candidate.live.kind === "signed-in")
      .map((candidate) => candidate.destination.alias),
  );
  const journalled = [...new Set(rows.map((row) => row.alias))].filter((alias) => !reached.has(alias));
  return journalled.filter((alias) => openResetAttempt({ alias, rows }) !== undefined);
}

/** Why a fresh claim is held while a stranded attempt stands, and the one command that settles it. */
function strandedReason({ stranded }: { stranded: readonly string[] }): string {
  const settle = stranded.map((alias) => `codex reset --plan ${alias}`).join(", ");
  return `${stranded.join(" and ")} holds an open attempt whose account this run cannot read (paused, unregistered or unreadable), and may share this account — no fresh claim is sent while it stands; settle it with ${settle}, re-registering a plan that is gone first`;
}

/**
 * Decide, store by store in register order, what `codex reset --at-limit` does this run.
 *
 * @param candidates every unpaused registered store with its live read, in register order
 * @param rows the claims journal, in file order
 * @param thresholds the register's Codex bars, read in the same register read as the candidates
 * @returns one decision per candidate, in the same order
 */
export function planCodexResetsAtLimit({
  candidates,
  rows,
  thresholds,
}: {
  candidates: readonly CodexResetFleetCandidate[];
  rows: readonly CodexResetJournalRow[];
  thresholds: CodexThresholds;
}): readonly CodexResetFleetDecision[] {
  const accounts = accountGroups({ candidates });
  const openByAccount = new Map<string, string[]>();
  for (const [index, candidate] of candidates.entries()) {
    if (openResetAttempt({ alias: candidate.destination.alias, rows }) === undefined) {
      continue;
    }
    const account = accounts[index]!;
    const holders = openByAccount.get(account);
    if (holders === undefined) {
      openByAccount.set(account, [candidate.destination.alias]);
    } else {
      holders.push(candidate.destination.alias);
    }
  }
  const unsettled = strandedOpenAttempts({ candidates, rows });
  const claimedAccounts = new Map<string, string>();
  return candidates.map((candidate, index): CodexResetFleetDecision => {
    const { alias } = candidate.destination;
    const account = accounts[index]!;
    const openOnAccount = openByAccount.get(account);
    if (openOnAccount !== undefined && openOnAccount.length > 1) {
      return {
        alias,
        kind: "fail",
        reason: `${openOnAccount.join(" and ")} share one account and each holds an open attempt — neither is sent`,
      };
    }
    if (openOnAccount !== undefined) {
      if (openOnAccount[0] !== alias) {
        return { alias, kind: "skip", reason: `shares its account with ${openOnAccount[0]!}, whose open attempt runs` };
      }
      return { candidate, creditId: undefined, kind: "run", retry: true };
    }
    const decision = freshDecision({ candidate, thresholds });
    if (decision.kind !== "run") {
      return decision;
    }
    if (unsettled.length > 0) {
      return { alias, kind: "fail", reason: strandedReason({ stranded: unsettled }) };
    }
    const claimedBy = claimedAccounts.get(account);
    if (claimedBy !== undefined) {
      return { alias, kind: "skip", reason: `shares its account with ${claimedBy}, claimed once for both` };
    }
    claimedAccounts.set(account, alias);
    return decision;
  });
}

/**
 * Every OTHER plan holding an open attempt, in first-journalled order. A fresh claim, in either form, waits while
 * this is non-empty (`cli/commands/codex/resetOne.ts`): two reads cannot always tell whether they share an account,
 * so sending beside an unsettled attempt could spend a second reset on the same refill under a fresh key. The tick's `--at-limit` settles open attempts every pass, so the wait is one tick.
 *
 * @param alias the plan about to claim
 * @param rows the whole journal
 * @returns the other aliases with an open attempt
 */
export function otherOpenAttempts({
  alias,
  rows,
}: {
  alias: string;
  rows: readonly CodexResetJournalRow[];
}): readonly string[] {
  const others = [...new Set(rows.map((row) => row.alias))].filter((other) => other !== alias);
  return others.filter((other) => openResetAttempt({ alias: other, rows }) !== undefined);
}
