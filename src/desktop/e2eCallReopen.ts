/**
 * The `call-reopen` call scenario's witness: the owner's ruling on reopened calls, read off
 * the call store of three real calls the test instance placed one after another. Pure; the read is
 * `src/cli/commands/desktop/e2eCallEvidenceRead.ts`, the drive `src/cli/commands/desktop/e2eCallReopenScenario.ts`.
 *
 * - **A** — an ordinary call: something said, then hung up. It is no reopen itself, so it carries no reopen line.
 * - **B** — reopened within the minute, and the owner says nothing: the window arms, and hands the reminder once its
 *   three seconds pass with the owner silent, naming A; the voice then speaks. The handed line's
 *   `elapsedSinceArmedMs` is the three seconds MEASURED on the real call, and it must sit in
 *   `[windowMs, windowMs + HAND_SLACK_MS]`.
 * - **C** — reopened within the minute of B, and the owner speaks at once: the window arms, then gives way inside its
 *   three seconds, naming B, and never hands.
 *
 * Every number is read off the reopen step's own persisted measurement (`src/talk/callToolLine.ts`'s
 * `reopenReminder`), never parsed out of the line's human `detail`.
 *
 * **What it does not judge**: the WORDS the voice speaks after B's handing. The transport hands the reminder and
 * nothing it says before; whether the voice model then phrases it as a reminder is the model's, nondeterministic, and
 * no pattern decides "this sentence is a where-you-left-off reminder". The witness
 * proves the transport's half: no voice before the handing, the handing at the measured window, a final voice line after.
 *
 * **Nor the deadline's last poll.** C's microphone speaks from its first sample, far from the deadline, so speech begun
 * within one microphone poll (80 ms, `site/components/voice/reopenReminderClient.ts`) of the 3000 ms deadline is never
 * exercised: the server's timer can hand first and the late `speech` post reads `already`. That race is the client's poll cadence, not this witness; a deadline that consults the
 * page's own speech-start instant before handing would close it.
 */
import type { CallRecord } from "../talk/callRecord.js";
import type { ReopenReminderMeasurement } from "../talk/callToolLine.js";

/**
 * How far past the window the handing may be measured and still be the window's own: the server's timer fires at the
 * window, then the page hears of it and writes the line. A judgement value; the measurement itself is reported whole.
 */
export const HAND_SLACK_MS = 2000;

/**
 * The window the owner's ruling named: 3 seconds. Every step of B and C must
 * carry it, so a console arming any other window — or a terminal step reporting a window its arming never had — fails
 * rather than being judged against a number of its own.
 */
const RULED_WINDOW_MS = 3000;

/**
 * What `report.json` keeps of the witness. Only a witness that HELD carries the three calls and both measurements as
 * values, so a held one with no A, B or C, or no measurement, cannot be written:
 * the judge passes `held` alone, never the absence of a problem.
 */
export type E2eReopenWitness =
  | {
      readonly held: true;
      /** The three calls, A, B and C, as the scenario wrote them. */
      readonly callIds: readonly [string, string, string];
      /** B's handing, measured from the window arming. */
      readonly handedElapsedMs: number;
      /** C's giving way, measured from the window arming. */
      readonly gaveWayElapsedMs: number;
      /** The window both were armed with: the ruled one. */
      readonly windowMs: number;
      readonly problem: undefined;
    }
  | {
      readonly held: false;
      /** The calls the scenario wrote; fewer than three when it never reached them all. */
      readonly callIds: readonly string[];
      /** B's handing, measured from the window arming; `undefined` when B handed nothing. */
      readonly handedElapsedMs: number | undefined;
      /** C's giving way, measured from the window arming; `undefined` when C gave nothing way. */
      readonly gaveWayElapsedMs: number | undefined;
      /** The window B's handing carried; `undefined` when B handed nothing. */
      readonly windowMs: number | undefined;
      /** The first way the calls fall short of the ruling. */
      readonly problem: string;
    };

/** One reopen step of a call, with the instant its line was written. */
interface ReopenStep extends ReopenReminderMeasurement {
  readonly atIso: string;
}

/**
 * A call's reopen steps, in file order.
 *
 * @param call the call as folded
 * @returns its steps
 */
function stepsOf({ call }: { call: CallRecord }): readonly ReopenStep[] {
  return call.notes.flatMap((note) =>
    note.kind === "tool" && note.reopenReminder !== undefined ? [{ ...note.reopenReminder, atIso: note.atIso }] : [],
  );
}

/**
 * The phases of a call's steps, joined, for a problem line.
 *
 * @returns e.g. `armed, handed`, or `none`
 */
function phasesOf({ steps }: { steps: readonly ReopenStep[] }): string {
  return steps.length === 0 ? "none" : steps.map((step) => step.phase).join(", ");
}

/**
 * Why a reopen's steps do not name the call before it, or do not all carry the ruled window; `undefined` when they do.
 *
 * @param label how the problem names the reopen
 * @param steps its steps
 * @param previous the call before it, which every step must name
 * @returns the problem
 */
function stepsProblem({
  label,
  previous,
  steps,
}: {
  label: string;
  previous: string;
  steps: readonly ReopenStep[];
}): string | undefined {
  const named = steps.find((step) => step.previousCallId !== previous);
  if (named !== undefined) {
    return `the ${label}'s ${named.phase} step names ${named.previousCallId}, not the call before it, ${previous}`;
  }
  const windowed = steps.find((step) => step.windowMs !== RULED_WINDOW_MS);
  if (windowed !== undefined) {
    return `the ${label}'s ${windowed.phase} step carries a ${String(windowed.windowMs)} ms window, not the ruled ${String(RULED_WINDOW_MS)} ms`;
  }
  return undefined;
}

/**
 * Why B does not hold the silent half of the ruling, `undefined` when it does.
 *
 * @param b the silent reopen
 * @param previous A's id, which its steps must name
 * @returns the problem
 */
function silentProblem({ b, previous }: { b: CallRecord; previous: string }): string | undefined {
  const steps = stepsOf({ call: b });
  const phases = steps.map((step) => step.phase);
  if (phases.length !== 2 || phases[0] !== "armed" || phases[1] !== "handed") {
    return `the silent reopen ${b.callId} logged reopen steps [${phasesOf({ steps })}], not [armed, handed]`;
  }
  const stepped = stepsProblem({ label: "silent reopen", previous, steps });
  if (stepped !== undefined) {
    return stepped;
  }
  const handed = steps[1]!;
  const inWindow =
    handed.elapsedSinceArmedMs >= handed.windowMs && handed.elapsedSinceArmedMs <= handed.windowMs + HAND_SLACK_MS;
  if (!inWindow) {
    return `the silent reopen handed the reminder ${String(handed.elapsedSinceArmedMs)} ms after arming, outside [${String(handed.windowMs)}, ${String(handed.windowMs + HAND_SLACK_MS)}] ms`;
  }
  // The call file alone proves no greeting, so voice speech begun before the handing fails.
  const greeted = b.segments.some(
    (segment) => segment.who === "voice" && Date.parse(segment.beganIso) < Date.parse(handed.atIso),
  );
  if (greeted) {
    return `the silent reopen ${b.callId} heard the voice before it handed the reminder, a greeting`;
  }
  const spoke = b.segments.some(
    (segment) => segment.who === "voice" && segment.final && Date.parse(segment.atIso) > Date.parse(handed.atIso),
  );
  if (!spoke) {
    return `the silent reopen ${b.callId} handed the reminder, and the voice said nothing final after it`;
  }
  return undefined;
}

/**
 * Why C does not hold the speaking half of the ruling, `undefined` when it does.
 *
 * @param c the reopen the owner spoke into at once
 * @param previous B's id, which its steps must name
 * @returns the problem
 */
function speakingProblem({ c, previous }: { c: CallRecord; previous: string }): string | undefined {
  const steps = stepsOf({ call: c });
  const phases = steps.map((step) => step.phase);
  if (phases.length !== 2 || phases[0] !== "armed" || phases[1] !== "gave-way") {
    return `the reopen the owner spoke into ${c.callId} logged reopen steps [${phasesOf({ steps })}], not [armed, gave-way]`;
  }
  const stepped = stepsProblem({ label: "spoken reopen", previous, steps });
  if (stepped !== undefined) {
    return stepped;
  }
  const gave = steps[1]!;
  if (gave.elapsedSinceArmedMs >= gave.windowMs) {
    return `the spoken reopen gave way ${String(gave.elapsedSinceArmedMs)} ms after arming, not inside its ${String(gave.windowMs)} ms`;
  }
  // A `gave-way` step alone is not the owner's speech, so the owner's own words must begin inside
  // the window, and no voice speech may begin before them — a reminder spoken over the owner's opening.
  const armedMs = Date.parse(steps[0]!.atIso);
  const ownerTurn = c.segments.find((segment) => segment.who === "owner");
  const ownerMs = ownerTurn === undefined ? undefined : Date.parse(ownerTurn.beganIso);
  if (ownerMs === undefined || ownerMs < armedMs || ownerMs >= armedMs + gave.windowMs) {
    const began = ownerMs === undefined ? "never" : `${String(ownerMs - armedMs)} ms after arming`;
    return `the spoken reopen ${c.callId} heard the owner begin ${began}, not inside its ${String(gave.windowMs)} ms`;
  }
  const spokenOver = c.segments.some((segment) => segment.who === "voice" && Date.parse(segment.beganIso) < ownerMs);
  if (spokenOver) {
    return `the spoken reopen ${c.callId} heard the voice before the owner's own opening, a reminder spoken over them`;
  }
  return undefined;
}

/**
 * Judge the three calls against the ruling.
 *
 * @param calls the scenario's own calls, folded, in the order it placed them
 * @returns the witness, its first problem named
 */
export function reopenWitnessOf({ calls }: { calls: readonly CallRecord[] }): E2eReopenWitness {
  const callIds = calls.map((call) => call.callId);
  const [a, b, c] = calls;
  const handed = b === undefined ? undefined : stepsOf({ call: b }).find((step) => step.phase === "handed");
  const gave = c === undefined ? undefined : stepsOf({ call: c }).find((step) => step.phase === "gave-way");
  const measured = {
    callIds,
    gaveWayElapsedMs: gave?.elapsedSinceArmedMs,
    handedElapsedMs: handed?.elapsedSinceArmedMs,
    windowMs: handed?.windowMs,
  };
  const fell = ({ problem }: { problem: string }): E2eReopenWitness => ({ ...measured, held: false, problem });
  if (calls.length !== 3 || a === undefined || b === undefined || c === undefined) {
    return fell({ problem: `the scenario wrote ${String(calls.length)} call(s), not the three A, B and C` });
  }
  const aSteps = stepsOf({ call: a });
  if (aSteps.length > 0) {
    return fell({ problem: `the first call ${a.callId} was itself a reopen: [${phasesOf({ steps: aSteps })}]` });
  }
  if (a.segments.length === 0) {
    return fell({ problem: `the first call ${a.callId} wrote no line, so nothing could be reopened onto` });
  }
  const silent = silentProblem({ b, previous: a.callId });
  if (silent !== undefined) {
    return fell({ problem: silent });
  }
  const speaking = speakingProblem({ c, previous: b.callId });
  if (speaking !== undefined) {
    return fell({ problem: speaking });
  }
  // Both halves held, so each terminal step is there; the check is the type's, never a second judgement.
  if (handed === undefined || gave === undefined) {
    return fell({ problem: "the reopens' terminal steps could not be read back" });
  }
  return {
    callIds: [a.callId, b.callId, c.callId],
    gaveWayElapsedMs: gave.elapsedSinceArmedMs,
    handedElapsedMs: handed.elapsedSinceArmedMs,
    held: true,
    problem: undefined,
    windowMs: handed.windowMs,
  };
}
