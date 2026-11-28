/**
 * The chair gate's second question — is any session in the pinned workspace spending a metered (per-token)
 * Console organisation — judged from what `./chairMeteredRead.ts` read out of the telemetry.
 *
 * Built off the live telemetry signal. A chair was ON FABLE while
 * it spent $7.38 on a Console organisation, so the Fable question could never see it; this one runs after it.
 *
 * ## Unmeasured prints, it does not refuse
 *
 * The Fable read is local and fails only when something is broken, so there a gate that cannot see refuses.
 * This oracle is remote, separately credentialed and ingested with a lag: refusing on a Datadog 5xx would stop
 * every chair on a machine without `DD_*`, and the operator would export the hatch for good — blinding the
 * gate. So an unmeasured read prints one line on every gated tick, and only a positive reading refuses.
 */
import { type MeteredVerdict, renderDollars } from "../claude/meteredSpend.js";
import { chairSessionName } from "./chairGate.js";

/** One chair session's verdict, or why its telemetry could not be judged. */
export interface ChairMeteredSession {
  readonly sessionId: string;
  /** Its process, or `undefined` for an app-hosted chair (`./chairGate.ts` § `ChairSessionReading`). */
  readonly pid: number | undefined;
  readonly verdict: MeteredVerdict | { readonly kind: "unmeasured"; readonly why: string };
}

/** What the metered read found for the pinned workspace. */
export type ChairMeteredReading =
  | {
      readonly kind: "measured";
      readonly sessions: readonly ChairMeteredSession[];
      /** True when the page cap stopped the read, so any dollars are a floor. */
      readonly truncated: boolean;
      /** Events Datadog returned that did not project, named rather than silently dropped. */
      readonly unprojected: number;
    }
  | { readonly kind: "unmeasured"; readonly why: string };

/** Whether the chair may tick on this question, with the lines it prints either way. */
export type ChairMeteredVerdict =
  | { readonly kind: "clean"; readonly notes: readonly string[] }
  | { readonly kind: "refused"; readonly detail: string; readonly lines: readonly string[] };

/** Why a Console organisation cannot be named from its own telemetry, said once in every metered line. */
const UNRESOLVED_IDENTITY =
  "org UNRESOLVED, email UNRESOLVED (a Console credential resolves no claude.ai identity — that absence is the signal)";

/**
 * The line that names one session's metered spend.
 *
 * @param session the session
 * @param verdict its metered verdict
 * @param floor whether the read was truncated, so the dollars are a lower bound
 * @returns one line, unindented
 */
function meteredLine({
  session,
  verdict,
  floor,
}: {
  session: ChairMeteredSession;
  verdict: Extract<MeteredVerdict, { kind: "metered-now" | "metered-earlier" }>;
  floor: boolean;
}): string {
  let amount = renderDollars({ dollars: verdict.dollars });
  if (floor) {
    amount = `at least ${amount}`;
  }
  const spent = `${amount} across ${String(verdict.requests)} request(s), ${verdict.firstIso}..${verdict.lastIso}`;
  if (verdict.kind === "metered-now") {
    return `${chairSessionName(session)}: METERED — ${spent}; ${UNRESOLVED_IDENTITY}`;
  }
  return (
    `${chairSessionName(session)}: metered EARLIER — ${spent}; back on a plan ` +
    `organisation as of ${verdict.newestIso}`
  );
}

/**
 * The note an undescribed session prints, or undefined when it has nothing to say.
 *
 * @param session the session
 * @returns one note line, or undefined for a session on a plan
 */
function sessionNote({ session }: { session: ChairMeteredSession }): string | undefined {
  const head = `metered check: ${chairSessionName(session)}`;
  if (session.verdict.kind === "unmeasured") {
    return `${head} UNMEASURED — ${session.verdict.why}`;
  }
  if (session.verdict.kind === "no-telemetry") {
    return `${head} UNMEASURED — no api_request telemetry was found for its recent prompts`;
  }
  return undefined;
}

/**
 * Judge the metered read.
 *
 * @param reading what the telemetry said for each session in the pinned workspace
 * @returns clean with the notes to print, or refused with the detail and the per-session lines
 */
export function judgeChairMetered({ reading }: { reading: ChairMeteredReading }): ChairMeteredVerdict {
  if (reading.kind === "unmeasured") {
    return { kind: "clean", notes: [`metered check: UNMEASURED — ${reading.why}`] };
  }
  const notes: string[] = [];
  const refusedLines: string[] = [];
  for (const session of reading.sessions) {
    const { verdict } = session;
    if (verdict.kind === "metered-now") {
      refusedLines.push(`  ${meteredLine({ floor: reading.truncated, session, verdict })}`);
      continue;
    }
    if (verdict.kind === "metered-earlier") {
      notes.push(`metered check: ${meteredLine({ floor: reading.truncated, session, verdict })}`);
      continue;
    }
    const note = sessionNote({ session });
    if (note !== undefined) {
      notes.push(note);
    }
  }
  if (reading.unprojected > 0) {
    notes.push(`metered check: ${String(reading.unprojected)} telemetry event(s) did not project and were not judged`);
  }
  if (refusedLines.length === 0) {
    return { kind: "clean", notes };
  }
  return {
    detail:
      `${String(refusedLines.length)} of ${String(reading.sessions.length)} session(s) in the pinned workspace ` +
      "spend on a metered Console organisation — their newest api_request telemetry resolves no claude.ai organisation",
    kind: "refused",
    lines: [...refusedLines, ...notes.map((note) => `  ${note}`)],
  };
}

/**
 * What to do about a metered chair.
 *
 * @returns the remedy lines, printed after the per-session lines
 */
export function meteredChairRemedyLines(): readonly string[] {
  return [
    "  remedy: write the handoff and seat a successor with `slopweaver cmux spawn <handoff slug> --model fable` —",
    "  a routed or pinned seat boots on its plan's setup token when it holds one, else its plan store,",
    "  never on this chair's login, unless an Anthropic API key in its environment outranks both:",
    "  `slopweaver claude route --model fable` names anything in the environment that shadows the plan stores.",
  ];
}
