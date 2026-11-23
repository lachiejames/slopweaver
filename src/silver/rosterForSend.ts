/**
 * The derived roster AS AN OUTBOUND SURFACE MUST SEE IT — refreshed just-in-time when the freshness
 * contract says to, and handed back unchanged when it does not.
 *
 * This lived inside `../cli/commands/slack/wiring.ts` while Slack was the only surface that addressed a
 * person. `linear issue`'s `assignee` is the second, and assigning the wrong colleague is the same class of
 * failure as mentioning them — so the JIT policy is shared rather than reimplemented. Sharing it also keeps
 * {@link jitAttempts} genuinely process-wide: two surfaces with two dedup maps would derive the same corpus
 * twice for one send, which is exactly the cost the map exists to avoid.
 *
 * Every verdict is judged against the moment the send was ASKED FOR (`askedAtIso`), not the moment it is
 * checked: a derive that observed its sources after the ask has seen everything ingested before it, and what
 * lands after is concurrent with the send (`./derive/freshness.settledForAsk`).
 */
import type { HeapGuard } from "#lib/heapBudget.js";
import { logger } from "../lib/logger.js";

import {
  type DeriveFreshness,
  freshnessAction,
  freshnessReason,
  SILVER_ROSTER_ARTEFACT,
  settledForAsk,
} from "./derive/freshness.js";
import { runDerivePipeline, writeSilverArtifacts } from "./derive/pipeline.js";
import type { DerivedRoster } from "./derivedRoster.js";
import type { IdentityRosterSnapshot } from "./identityRoster.js";
import { loadDerivedRoster } from "./loadDerivedRoster.js";

/**
 * When this process last STARTED a just-in-time derive for each home, in epoch ms. One send resolves the
 * roster more than once, and deriving the same corpus twice for it would double a cost the contract already
 * accepted paying once — so a send whose ask is no later than the last attempt does not derive again, and a
 * failed attempt is not retried for it either. Keyed by attempt time rather than a bare set because one
 * process can carry more than one send: `automation run-due` posts every card row's `slack post` leg in its own
 * process (`cli/commands/automation/collectLeg.ts`), and a process-wide
 * "already derived" would leave a later row's send holding a roster it can never refresh.
 */
const jitAttempts = new Map<string, number>();

/** The roster and a verdict for it, settled against the ask. */
function loadSettled({
  home,
  askedAtIso,
  rosterRevision,
}: {
  home: string;
  askedAtIso: string;
  rosterRevision: number | null;
}): {
  readonly roster: DerivedRoster;
  readonly freshness: DeriveFreshness;
} {
  const loaded = loadDerivedRoster({ home, rosterRevision });
  const freshness = settledForAsk({
    askedAtIso,
    freshness: loaded.freshness,
    observed: loaded.observed,
    stamp: loaded.stamp,
  });
  if (loaded.freshness.kind === "stale" && freshness.kind === "fresh") {
    logger.info({
      msg:
        `${freshnessReason({ artefact: SILVER_ROSTER_ARTEFACT, freshness: loaded.freshness })} — all of it after ` +
        `this send was asked for (${askedAtIso}), so the roster is used as it stands`,
    });
  }
  return { freshness, roster: loaded.roster };
}

/**
 * Load the derived roster, refreshing it FIRST when the freshness contract says to.
 *
 * `derive` is the case the contract sends down the just-in-time path rather than the refusal path: it is
 * local, deterministic, needs no network and no token, and finishes in minutes. So the consumer runs it and
 * proceeds, logging the one line that says what had moved — rather than warning and sending against a roster
 * that cannot see whoever arrived since.
 *
 * A JIT that FAILS does not become a warning either: the stale verdict comes back unchanged, and the send
 * path refuses on it (`../outbound/slack/mentionIndex.staleRosterRefusals`, and its Linear counterpart).
 *
 * @param home the state home holding the derived roster
 * @param affectsOutput whether this send actually addresses anyone — a message that mentions nobody is not
 *   made wrong by a roster that has not seen this week's joiners, so it does not pay for a refresh
 * @param askedAtIso when this send was asked for, read once per send and no earlier than the real ask
 * @param identityRoster the identity roster snapshot this send resolves people with — read ONCE by the caller,
 *   so a just-in-time derive and the freshness verdict both describe the roster the overrides came from
 * @param heapGuard what judges whether the derive's synthesis fits under this process's ceiling — the real
 *   isolate's unless a test passes a plain fake. A refusal is a failed JIT like any other: the send refuses on
 *   the stale verdict and exits non-zero, rather than the whole process dying at the ceiling mid-send
 * @returns the roster and the freshness verdict AFTER any refresh, settled against the ask
 */
export function rosterForSend({
  home,
  affectsOutput,
  askedAtIso,
  identityRoster,
  heapGuard,
}: {
  home: string;
  affectsOutput: boolean;
  askedAtIso: string;
  identityRoster: IdentityRosterSnapshot;
  heapGuard?: HeapGuard;
}): {
  readonly roster: DerivedRoster;
  readonly freshness: DeriveFreshness;
} {
  const rosterRevision = identityRoster.revision;
  const loaded = loadSettled({ askedAtIso, home, rosterRevision });
  const action = freshnessAction({ affectsOutput, artefact: SILVER_ROSTER_ARTEFACT, freshness: loaded.freshness });
  const lastAttemptMs = jitAttempts.get(home);
  if (action.kind !== "jit" || (lastAttemptMs !== undefined && lastAttemptMs >= Date.parse(askedAtIso))) {
    return loaded;
  }
  jitAttempts.set(home, Date.now());
  logger.warn({ msg: action.line });
  const derived = runDerivePipeline({
    home,
    roster: identityRoster,
    ...(heapGuard !== undefined ? { heapGuard } : {}),
  });
  if (derived.isErr()) {
    logger.warn({ msg: `just-in-time \`${action.command}\` failed: ${derived.error.join("; ")}` });
    return loaded;
  }
  writeSilverArtifacts({ derivedAtIso: new Date().toISOString(), home, result: derived.value });
  return loadSettled({ askedAtIso, home, rosterRevision });
}
