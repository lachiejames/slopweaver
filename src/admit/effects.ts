/**
 * `throughDoor` — the seam every side-effecting verb wraps its effect in. It admits the request, RECORDS the
 * decision to the ledger, and performs the effect ONLY on `pass`; on `warn`/`hold` it performs nothing and
 * hands the decision back so the caller can surface the self-correctable findings.
 *
 * It is in live use: the Slack post/reply/poll/drip/lifecycle paths and the Linear issue write all route
 * through it. (The previous version of this comment said "No verb uses it yet (slopweaver is read-only)",
 * which stopped being true several PRs ago.)
 *
 * **It is not an approval PROMPT.** Nothing here asks a human anything mid-run: `gates` is a list of pure
 * policy functions supplied by the caller, and for most paths that list is still nearly empty — see
 * `door.ts` for which paths run which gates. So for most verbs, routing an effect through this function
 * proves the effect was RECORDED, not that it was checked against any rule.
 *
 * The two exceptions are the verbs whose door request declares `meta.requiresApproval`: `gmail send` and
 * `write vanta deactivate`. Each passes an APPROVAL GATE (`src/admit/approval.ts`) that HOLDS unless the
 * caller supplied the digest of the exact content, so their unapproved attempt is refused here and recorded
 * as refused. A request that declares `requiresApproval` with no such gate in its list is refused by
 * `admitDoor` itself — the label cannot outrun the check.
 *
 * One gate is composed onto EVERY list here rather than chosen by a caller: `./profileLoadGate.ts`, which warns on
 * an `external-write` from a session whose own load of the owner's profile is recorded as failed. That is why
 * the door, and not each lane, is where "you can only act as me if you can load my profile" is enforced.
 */
import { randomUUID } from "node:crypto";

import { resolveHome } from "../cli/optionParsers.js";
import { admitDoor } from "./door.js";
import type { DoorLedgerPort } from "./doorLedgerPort.js";
import type { DoorStoreError } from "./doorStoreErrors.js";
import { profileLoadGate } from "./profileLoadGate.js";
import type { DoorDecision, DoorGate, DoorRequest } from "./types.js";

/**
 * The outcome of routing an effect through the door — a discriminated union so `result` EXISTS iff the
 * effect actually ran (`performed: true`). A caller can't read a `result` that never happened.
 *
 * Two ways not to perform, and they are not the same fact. `door-refused` is POLICY: the door warned or held, and
 * `decision.findings` says why. `recording-refused` is INFRASTRUCTURE: the decision could not be written to the
 * store, so nothing was performed even when the door passed — an effect with no audit row is the one outcome the
 * door exists to prevent. `notPerformedLines` (`./doorRefusal.ts`) renders either.
 */
export type ThroughDoorResult<T> =
  | { readonly kind: "performed"; readonly decision: DoorDecision; readonly performed: true; readonly result: T }
  | { readonly kind: "door-refused"; readonly decision: DoorDecision; readonly performed: false }
  | {
      readonly kind: "recording-refused";
      readonly decision: DoorDecision;
      readonly error: DoorStoreError;
      readonly performed: false;
    };

/**
 * The decision `throughDoor` would reach for this request, with the same gates composed, recording nothing and
 * performing nothing. For a dry run that has to say whether the door would admit the write it describes: a dry run
 * that skipped the door would answer `would` for a write the door then holds.
 *
 * @param gates the caller's gate list, before the profile-load gate every request gets
 * @param env the environment the override token and the calling session's ids are read from
 * @param home the state home the profile-load gate reads the load ledger under
 * @returns the door's decision
 */
export function doorDecisionWithoutRecording({
  env,
  gates,
  home,
  request,
}: {
  env: Readonly<Record<string, string | undefined>>;
  gates: readonly DoorGate[];
  home: string | undefined;
  request: DoorRequest;
}): DoorDecision {
  // Composed here rather than into each caller's list: a session acting outward without the owner's profile is refused
  // on EVERY external write, and a gate a caller had to remember is a gate the next caller forgets.
  return admitDoor({ env, gates: [...gates, profileLoadGate({ env, home })], request });
}

/**
 * Route a side effect through the door: admit → record → perform only on `pass` AND a recorded decision. `gates`
 * and `ledger` are REQUIRED (the caller states its policy explicitly — pass `DEFAULT_GATES` for none — and names
 * the audit trail it writes). `env`/`home`/`runId`/`nowIso` stay optional at this runtime edge because their
 * defaults are real behaviour (the live env / the resolved home / a fresh id / now), not type appeasement.
 * `perform` is the caller's effect thunk.
 *
 * @param request the action + artifact + meta
 * @param perform the effect to run only if the door passes and the decision is recorded
 * @param gates the gate list (pass `DEFAULT_GATES` for the empty compose seam)
 * @param ledger the door ledger the decision is recorded through, before anything is performed
 * @param env the environment (for the override token; defaults to `process.env`)
 * @param home the state home whose store records the decision (defaults to the resolved home)
 * @param runId the run id to record (defaults to a fresh uuid)
 * @param nowIso the timestamp to record (defaults to now)
 * @returns the decision, which of the three outcomes it reached, and (iff it ran) its result
 */
export async function throughDoor<T>({
  request,
  perform,
  gates,
  ledger,
  env = process.env,
  home,
  runId = randomUUID(),
  nowIso = new Date().toISOString(),
}: {
  request: DoorRequest;
  perform: () => Promise<T> | T;
  gates: readonly DoorGate[];
  ledger: DoorLedgerPort;
  env?: Readonly<Record<string, string | undefined>>;
  home?: string;
  runId?: string;
  nowIso?: string;
}): Promise<ThroughDoorResult<T>> {
  const decision = doorDecisionWithoutRecording({ env, gates, home, request });
  const recorded = await ledger.appendDecision({
    decision,
    doorRequest: request,
    home: resolveHome({ named: home }),
    runId,
    tsIso: nowIso,
  });
  if (recorded.isErr()) {
    return { decision, error: recorded.error, kind: "recording-refused", performed: false };
  }
  if (decision.status === "pass") {
    return { decision, kind: "performed", performed: true, result: await perform() };
  }
  return { decision, kind: "door-refused", performed: false };
}
