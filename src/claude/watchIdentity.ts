/**
 * The identity half of a `claude watch` tick: which stores hold an account other than the one enrolled for
 * them, or one another store also holds — said on every tick, in the words `claude signin --status` uses.
 * Pure: the shell probes and reads the enrollments, this decides what they mean together.
 *
 * ## The gap this closes
 *
 * The watch already probed every store every five minutes and already received the organisation each probe
 * named, then used it only to decide which plan the active slot holds. Nothing compared it against the
 * standing enrollment. MEASURED in a keep export: a store silently switched account, two stores read
 * byte-identical gauges under one organisation, and every tick printed `plan drawdown: no anomaly` until a
 * session ran `claude signin --status` 37 minutes later and read DUPLICATE.
 *
 * ## One decider, so the two surfaces cannot disagree
 *
 * This module does not re-derive `duplicate` or `wrong-account`. It hands the tick's probes to
 * `signinPlan.ts`'s {@link planSignin} — the decider the sign-in walk, its status read and its page share —
 * and reports the rows that decider graded into either state. A second, smaller comparison here would be the
 * exact two-readers-of-one-fact shape `accountBinding.ts` was landed to end.
 *
 * ## The fleet it compares is the tick's, not the register's
 *
 * A tick probes only the LIVE plans — a paused or monthly-spend plan is never probed, because probing it is
 * spend — so the decider sees that fleet, where `signin --status` probes every configured store. Two
 * consequences, both pinned by a test: a probed store holding an unprobed store's account reads WRONG ACCOUNT
 * here (its own enrollment is still not what it holds) where `signin --status` reads DUPLICATE; and an
 * unprobed store that switched account is invisible to the watch until it is unpaused or a status read runs.
 *
 * Every organisation id goes in and none comes out: {@link planSignin}'s rows have no field for one, the
 * lines are built from those rows alone, and every id the tick holds is masked out of them besides, because a
 * row's detail quotes an enrollment's free-text address and nothing stops that text from being an id.
 */
import type { ClaudeAccount } from "./contracts.js";
import type { ClaudeGaugeOutcome } from "./gaugeRender.js";
import type { ClaudeIdentityAssertion } from "./identityAssertions.js";
import { planSignin, type SigninProbe, type SigninRowState } from "./signinPlan.js";
import { signinStateTag } from "./signinRender.js";

/**
 * What one store's probe this tick found, as the identity check needs it — the shape `probeStore.ts`'s
 * `probePlan` already returns, so the watch hands its results over whole.
 */
export interface WatchIdentityProbe {
  /** The renderable reading, whose absent `gauge` means unread — an unread store is never alarmed on. */
  readonly outcome: Pick<ClaudeGaugeOutcome, "alias" | "gauge" | "problem">;
  /** The account the provider named. A private identifier: consumed here, never returned. */
  readonly organizationId?: string;
}

/** The two sign-in states a store can be live in and still be the wrong store to spend. */
const ALARMED: ReadonlySet<SigninRowState> = new Set(["duplicate", "wrong-account"]);

/**
 * One line per configured store whose live account is not its own — the enrolled one changed, or another
 * store holds it too — worded exactly as `claude signin --status` tags that store.
 *
 * Only LIVE stores can alarm, and that is {@link planSignin}'s rule rather than this module's: a store that
 * answered no gauge grades `needs-sign-in` or `unverified`, which the tick's own problem lines already name.
 *
 * @param accounts the configured plans this tick probed
 * @param assertions every standing enrollment
 * @param probes what each store's probe found this tick
 * @returns the alarm lines, empty when every live store holds its own, distinct account
 */
export function watchIdentityAlarms({
  accounts,
  assertions,
  probes,
}: {
  accounts: readonly ClaudeAccount[];
  assertions: readonly ClaudeIdentityAssertion[];
  probes: readonly WatchIdentityProbe[];
}): readonly string[] {
  // No `life`: `planSignin` grades `duplicate` and `wrong-account` before it ever reads the credential axis.
  const signinProbes = probes.map(({ organizationId, outcome }): SigninProbe => ({
    alias: outcome.alias,
    ...(outcome.gauge === undefined ? {} : { gauge: outcome.gauge }),
    ...(outcome.problem === undefined ? {} : { problem: outcome.problem }),
    ...(organizationId === undefined ? {} : { organizationId }),
  }));
  const { rows } = planSignin({ accounts, assertions, probes: signinProbes, signIns: [] });
  const organizationIds = [
    ...probes.flatMap(({ organizationId }) => (organizationId === undefined ? [] : [organizationId])),
    ...assertions.map(({ organizationId }) => organizationId),
  ].filter((id) => id !== "");
  return rows
    .filter((row) => ALARMED.has(row.state))
    .map(
      (row) =>
        `${row.alias}: ${signinStateTag({ state: row.state })} — ` +
        `${withoutOrganizationIds({ detail: row.detail, organizationIds })}; ` +
        "`slopweaver claude signin` walks the repair",
    );
}

/**
 * Mask every organisation id this tick holds wherever it appears in a row's detail. A row carries no id FIELD,
 * but its detail quotes an enrollment's free-text address, and nothing stops that text from being an id. Only
 * the detail: the alias and the repair command are fixed text an id must not rewrite.
 *
 * @param detail the sign-in decider's own sentence for the row
 * @param organizationIds every id the probes and enrollments named
 * @returns the detail with each id replaced by `[organisation]`
 */
function withoutOrganizationIds({
  detail,
  organizationIds,
}: {
  detail: string;
  organizationIds: readonly string[];
}): string {
  // ONE left-to-right pass over the ORIGINAL text, longest id first at each position: a shorter id cannot
  // half-mask a longer one, and no id can match inside a placeholder already written.
  const longestFirst = [...new Set(organizationIds)].toSorted((a, b) => b.length - a.length);
  let masked = "";
  let at = 0;
  while (at < detail.length) {
    const id = longestFirst.find((candidate) => detail.startsWith(candidate, at));
    if (id === undefined) {
      masked += detail.charAt(at);
      at += 1;
    } else {
      masked += "[organisation]";
      at += id.length;
    }
  }
  return masked;
}
