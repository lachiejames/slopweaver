/**
 * Makes the REAL door refuse a verb's external write — no mock, no injected gate — so a runner test can assert
 * exactly what the verb prints when the door says no.
 *
 * `throughDoor` composes `profileLoadGate` onto every request it admits, reading the calling session's id from
 * the environment and the load ledger from the home the verb was handed. A ledger row recording that this
 * session's profile never loaded therefore holds every external write the verb attempts under that home. The
 * fixture seeds that row, points the session id at it for the length of `run`, and restores the environment
 * afterwards whether `run` threw or not.
 *
 * It returns the decision the door reached, computed through the same gate rather than spelled out here, so a
 * test compares the verb's output against `doorRefusalLines` of THAT decision and a change to the gate's own
 * wording cannot make the runner test lie.
 */
import { admitDoor } from "../admit/door.js";
import { profileLoadGate } from "../admit/profileLoadGate.js";
import type { DoorDecision } from "../admit/types.js";
import { appendProfileLoad } from "../context/loadLedgerStore.js";
import { JUDGEMENT_NOTE } from "../hatch/render.js";
import { unwrap } from "../lib/result.js";
import { CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV } from "../supervisor/session.js";

/** The session id every held run is attributed to. */
const HELD_SESSION_ID = "door-refusal-fixture-session";

/**
 * The refusal a one-finding HOLD must print, spelled out literally rather than computed by `doorRefusalLines`,
 * so a runner test fails when the renderer regresses as well as when the verb stops calling it.
 *
 * @param command the invocation the refusal names
 * @param decision a decision carrying exactly one hold finding
 * @returns the five lines, in order
 */
export function expectedHoldRefusal({ command, decision }: { command: string; decision: DoorDecision }): string[] {
  const [finding] = decision.findings;
  return [
    `the door did not admit this (${decision.status}). Nothing was changed.`,
    `${command} blocked because ${finding!.summary} [${finding!.code}].`,
    "There is no escape hatch for this one: a hold is the irreversible-harm arm of the door and no per-action token waives it.",
    `The way through is to satisfy it: ${finding!.correction}`,
    JUDGEMENT_NOTE,
  ];
}

/** Set one environment variable back to what it was, deleting it when it was unset. */
function restoreEnv({ key, value }: { key: string; value: string | undefined }): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

/**
 * Run `run` with the door holding every external write made under `home`.
 *
 * @param home the explicit test home the verb is handed, where the load ledger row is written
 * @param run the verb invocation
 * @returns what `run` returned, and the decision the door reached for an external write under `home`
 */
export async function withProfileHold<T>({
  home,
  run,
}: {
  home: string;
  run: () => Promise<T>;
}): Promise<{ result: T; decision: DoorDecision }> {
  // The owner's profile loaded into ANOTHER session on this home, so `home` is an installed one whose profile exists and this
  // session did not load. Without it a `none` row is no evidence of a profile at all, and on a runner whose default
  // homes are empty the door reads a first boot and admits.
  unwrap(
    appendProfileLoad({
      home,
      row: {
        atIso: "2026-10-12T00:00:00.000Z",
        cwd: "",
        event: "SessionStart",
        origin: "live",
        reason: "",
        sessionId: "door-refusal-fixture-earlier-session",
        source: "hook",
      },
    }),
  );
  unwrap(
    appendProfileLoad({
      home,
      row: {
        atIso: "2026-10-13T00:00:00.000Z",
        cwd: "",
        event: "SessionStart",
        origin: "none",
        reason: "fixture: no profile reached this session",
        sessionId: HELD_SESSION_ID,
        source: "hook",
      },
    }),
  );
  const saved = { claude: process.env[CLAUDE_CODE_SESSION_ID_ENV], codex: process.env[CODEX_THREAD_ID_ENV] };
  process.env[CLAUDE_CODE_SESSION_ID_ENV] = HELD_SESSION_ID;
  delete process.env[CODEX_THREAD_ID_ENV];
  try {
    const env = { ...process.env };
    const decision = admitDoor({
      env,
      gates: [profileLoadGate({ env, home })],
      request: {
        action: { kind: "verb", noun: "fixture", verb: "hold" },
        artifact: {},
        meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
      },
    });
    return { decision, result: await run() };
  } finally {
    restoreEnv({ key: CLAUDE_CODE_SESSION_ID_ENV, value: saved.claude });
    restoreEnv({ key: CODEX_THREAD_ID_ENV, value: saved.codex });
  }
}
