/**
 * Fire the `steer-at-risk` monitor the moment a verb writes something that can put an explicitly steered deliverable
 * at risk — `handover risk`, `ask`, `park`, `abandon`, `reap` (and settle's residue reap), the steer's own `rule`,
 * and `session close-done`'s idle park — so the note reaches the owner's screen with the event, never a supervisor tick
 * later and never at the deadline. Each caller fires after its append and before any receipt
 * line, so an output channel that fails cannot stop the note. An ending (`finished`, a settlement) puts nothing at
 * risk and fires nothing.
 *
 * In-process through `monitor check --only steer-at-risk --fire`, the shape `../turn/signInCard.ts` uses: only the
 * pinned chair posts a note by hand (`../../../hand/seatPost.ts`), and the monitor lane is the sanctioned route for
 * a note a ledger raises. It fires only on a row whose standing ruling IS a steer, read back off the journal the
 * verb just wrote, so an ordinary park costs nothing. A pass that fails is REPORTED and changes nothing above it:
 * the event is already appended, and the chair's next tick runs the same pass.
 */
import { standingExplicitSteer } from "../../../handover/ruling.js";
import { readRunJournal } from "../../../handover/runStore.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { runMonitorCheck } from "../monitor/check.js";
import { hostedPassDeps, type MonitorDeps } from "../monitor/deps.js";

/** The command the chair's tick runs, named on the one line a failed pass prints. */
const STEER_AT_RISK_FIRE = "slopweaver monitor check --only steer-at-risk --fire";

/** What one fire did: nothing on an unsteered row, the pass's exit on a steered one, or why it could not tell. */
export type SteerRiskFireResult =
  | { readonly kind: "not-steered" }
  | { readonly kind: "fired"; readonly exitCode: number }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Run the `steer-at-risk` pass once when the row is explicitly steered, posting what newly arrived and settling
 * what left.
 *
 * @param home the state home the event was written in
 * @param slug the row the verb just appended to — an empty reread is a lost read, never an unsteered row
 * @param verb the handover verb firing it, recorded as the pass's actor and named if it fails
 * @param deps the monitor seams — `productionMonitorDeps()` from a verb, plain fakes from a test
 * @returns `not-steered` when the row carries no standing steer and nothing ran, `fired` with the pass's exit code,
 *   or `unreadable` when the journal would not reread — never read as "not steered"
 */
export async function fireSteerAtRiskIfSteered({
  home,
  slug,
  verb,
  deps,
}: {
  home: string;
  slug: string;
  verb: string;
  deps: MonitorDeps;
}): Promise<SteerRiskFireResult> {
  const journal = readRunJournal({ runsDir: stateHomePaths({ home }).runs, slug });
  if (journal.isErr()) {
    const why = `could not reread ${slug}'s journal to check for the owner's steer —${journal.error.message}`;
    logger.error({ msg: `${verb}: ${why}; the chair's next tick runs \`${STEER_AT_RISK_FIRE}\`` });
    return { kind: "unreadable", why };
  }
  if (standingExplicitSteer({ events: journal.value.events }) === undefined) {
    // A line this build cannot decode may be the steer itself, so finding none over one is not finding none. A steer
    // that DID decode fires regardless: the pass names the blind spot, and firing is the direction the owner asked for.
    // Every caller has just appended to this journal, so one that reads back empty was lost between the two.
    if (journal.value.events.length === 0) {
      const why = `${slug}'s journal read back empty straight after a write, so whether the owner steered it is unknown`;
      logger.error({ msg: `${verb}: ${why}; the chair's next tick runs \`${STEER_AT_RISK_FIRE}\`` });
      return { kind: "unreadable", why };
    }
    const unreadable = journal.value.unreadable.length;
    if (unreadable === 0) {
      return { kind: "not-steered" };
    }
    const why = `${String(unreadable)} line(s) of ${slug}'s journal would not decode, so whether the owner steered it is unknown`;
    logger.error({ msg: `${verb}: ${why}; the chair's next tick runs \`${STEER_AT_RISK_FIRE}\`` });
    return { kind: "unreadable", why };
  }
  const code = await runMonitorCheck({
    // The host verb owns stdout — `session close-done --json` among them — so the pass reports on stderr.
    deps: hostedPassDeps({ deps }),
    rest: ["--only", "steer-at-risk", "--fire", "--by-session", verb, "--home", home],
  });
  if (code !== 0) {
    logger.error({
      msg:
        `${verb}: the steer-at-risk pass exited ${String(code)} — the event stands; ` +
        `the chair's next tick runs \`${STEER_AT_RISK_FIRE}\` again`,
    });
  }
  return { exitCode: code, kind: "fired" };
}
