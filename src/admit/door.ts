/**
 * The door itself — the decision engine every side-effecting action passes through. It runs the ordered
 * gate list, applies any explicit per-action override, enforces the one rule the door owns rather than
 * delegates, and returns `pass` / `warn` / `hold`. It writes nothing: `ledger.ts` records the decision, the
 * caller (a verb, via `effects.ts`) performs the effect only on `pass`. It is not pure, though: a `warn`
 * whose override is journalled is waived by a live grant, read from the hatch-grant journal for the
 * session in `process.env` (`isGranted`).
 *
 * Warn-first, never silent (D9): a gate's `warn` is returned as a structured, self-correctable finding
 * the agent sees and can re-issue past with `$SLOPWEAVER_DOOR_OVERRIDE=<token>`; a `hold` is the
 * irreversible-harm core and is NOT waivable by that per-action token.
 *
 * ## The one rule the door itself enforces
 *
 * A request whose `meta.requiresApproval` is true, whose gate list carries no gate built by
 * {@link ../admit/approval.approvalGate}, is `hold`. `requiresApproval` was a boolean nothing read until
 * this rule existed — see `approval.ts` for the defect and why the check lives inside the decision rather
 * than in a linter. Everything else the door does is delegated to the gates a caller supplies.
 */
import { hatchGrantOpen } from "../hatch/lookup.js";
import { ESCAPE_HATCHES } from "../hatch/registry.js";
import { approvalUnbackedFinding, isApprovalGate } from "./approval.js";
import type { DoorDecision, DoorFinding, DoorGate, DoorRequest, DoorStatus } from "./types.js";

/**
 * The empty compose seam — genuinely empty, and worth stating plainly because callers spread it and the
 * result reads like policy.
 *
 * What actually runs today, measured from the call sites (`grep -rn "gates:" src/cli/commands`):
 *   - `slack post` / `reply` / drip          → the voice-profile gate plus duplicate-send within a window;
 *   - `slack edit` / `delete` / `progress`   → the voice-profile gate (`gatesFor({ voice })`), which finds
 *     nothing on a lane that authors no prose — a delete, a progress tick — and says so by passing
 *     `NO_AUTHORED_PROSE` rather than by omitting the gate;
 *   - the bot's own answer (`live/turn/posterAnswer.ts`) → the voice-profile gate plus `answerQualityGate`,
 *     and its `as-bot` pain point, which is the arm `PainPointLane` was parameterised for;
 *   - the bot's THREAD TITLE (`nameThreadThroughDoor`) → the voice-profile gate over the one string it
 *     writes; a title is composed per turn and is the first line a reader meets;
 *   - `slack poll`                           → the voice-profile gate over the question, the reason and every
 *     option label, plus duplicate-send;
 *   - `slack canvas create` / `replace`      → the voice-profile gate over the title and the markdown body,
 *     plus duplicate-send on the create; `delete` passes `NO_AUTHORED_PROSE` for the same reason a Slack
 *     delete does;
 *   - `slack channel create`                 → the voice-profile gate over the purpose and the topic, which
 *     are the only two strings a create authors; `invite` and `archive`, and `slack dm`, move people rather
 *     than words and pass `NO_AUTHORED_PROSE`;
 *   - `linear issue create` / `update`       → none (passes `DEFAULT_GATES` directly);
 *   - `gmail send`, `write vanta deactivate`,
 *     `github review-draft post`, `github repo`'s
 *     rename, transfer, archive, create,
 *     set-public, apply-manifest and
 *     enable-actions                        → an APPROVAL gate that holds without the owner's digest.
 *
 * So for every path but the last one, "routed through the door" means recorded in the ledger, not refused
 * by a rule. Adding more real rules is a product decision; until then no gate should describe a routed path
 * as protected. What is no longer possible is a path that CLAIMS to be: a request passing this list while
 * declaring `requiresApproval` is now refused by {@link admitDoor} itself.
 */
export const DEFAULT_GATES: readonly DoorGate[] = [];

/** Whether `$SLOPWEAVER_DOOR_OVERRIDE` (a comma-separated token list) carries this warn's override token. */
function isOverridden({ token, overrideEnv }: { token: string; overrideEnv: string | undefined }): boolean {
  if (overrideEnv === undefined) {
    return false;
  }
  return overrideEnv
    .split(",")
    .map((t) => t.trim())
    .includes(token);
}

/**
 * Whether a live journalled grant waives this warn — the outbound half of the journalled-hatch rule.
 *
 * Every door token is an OUTBOUND row of `../hatch/registry.ts`, and those are journalled rather than
 * ambient. Both mechanisms are honoured here rather than one replacing the other, and that is deliberate:
 * the token in the environment is what a HOOK and a subprocess lane can still set, while the grant is what a
 * session takes when it has weighed the exceptions and written down why. Removing the token path would make
 * the door unoverridable anywhere a grant cannot be taken, which is the wedge shape a hatch must never be.
 *
 * @param token the warn's override token
 * @param nowIso the instant to judge expiry against
 * @param home the state home the journal lives under
 * @returns true when this session holds a live grant for the register row that owns the token
 */
function isGranted({ token, nowIso, home }: { token: string; nowIso: string; home: string | null }): boolean {
  const hatch = ESCAPE_HATCHES.find((row) => row.key.kind === "door-token" && row.key.token === token);
  if (hatch === undefined) {
    return false;
  }
  // The session is this PROCESS's own, not the injected `env`'s: a door caller hands `admitDoor` an env built
  // for the override token (`queue release` spreads one token into it), and the grant is the session's.
  return hatchGrantOpen({ env: process.env, id: hatch.id, nowIso, ...(home === null ? {} : { home }) });
}

/**
 * Decide a request: refuse an unbacked approval claim, run the gates, waive overridden `warn` findings
 * (recording them), and fold the rest into a status — `hold` if any survives, else `warn` if any survives,
 * else `pass`. `env` and `gates` are injected, while a journalled grant is read from disk — `gates` is REQUIRED (pass the exported
 * {@link DEFAULT_GATES} for "no gates"), so a caller never accidentally admits an ungated action by
 * omission.
 *
 * The unbacked-approval finding is prepended rather than appended so a reader of a refusal sees WHY the
 * request could never have passed before whatever else a gate had to say about it.
 *
 * @param request the action + artifact + meta being admitted
 * @param env the environment (read only for the override token)
 * @param gates the ordered gate list (pass {@link DEFAULT_GATES} for the empty compose seam)
 * @param nowIso the instant a journalled grant's expiry is judged against
 * @returns the decision: status + surviving findings + the findings an override waived
 */
export function admitDoor({
  request,
  env,
  gates,
  nowIso = new Date().toISOString(),
}: {
  request: DoorRequest;
  env: Readonly<Record<string, string | undefined>>;
  gates: readonly DoorGate[];
  nowIso?: string;
}): DoorDecision {
  const overrideEnv = env["SLOPWEAVER_DOOR_OVERRIDE"];
  const overridden: DoorFinding[] = [];
  const active: DoorFinding[] = [];
  if (request.meta.requiresApproval && !gates.some((gate) => isApprovalGate(gate))) {
    active.push(approvalUnbackedFinding({ request }));
  }
  for (const finding of gates.flatMap((gate) => gate(request))) {
    const waived =
      finding.severity === "warn" &&
      (isOverridden({ overrideEnv, token: finding.override }) ||
        isGranted({ home: request.meta.home, nowIso, token: finding.override }));
    if (waived) {
      overridden.push(finding);
    } else {
      active.push(finding);
    }
  }
  let status: DoorStatus;
  if (active.some((f) => f.severity === "hold")) {
    status = "hold";
  } else if (active.some((f) => f.severity === "warn")) {
    status = "warn";
  } else {
    status = "pass";
  }
  return { findings: active, overridden, status };
}
