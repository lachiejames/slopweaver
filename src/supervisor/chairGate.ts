/**
 * THE CHAIR GATE — a supervisor seat that is not running on the model its plans require cannot record a tick or
 * re-arm its sweep.
 *
 * `./chairModel.ts` says which model one transcript's seat is on, and `./chairPolicy.ts` which model it must be on:
 * Fable while more than one Claude plan stands, Opus once exactly one does. This folds every Claude session live in
 * the pinned supervisor workspace into one verdict against that requirement, and renders the refusal a chair reads
 * when it is off it. The sections below were written about Fable, today's requirement; each holds for either.
 *
 * ## Why every session in the workspace, not only the caller
 *
 * MEASURED: after a fallback to Opus, the owner opened a Fable tab in the SAME
 * pinned workspace while the Opus tab was still live. A cmux workspace is not a session, so the pinned
 * correlation names both, and a gate reading only one would pass whichever tab happened to ask. Refusing while
 * ANY session in the pinned workspace is off Fable is the pressure the owner asked for — close the fake chair — and the
 * remedy line names both cases.
 *
 * ## A gate that cannot see refuses
 *
 * The sweep gate's precedent (`./outcomes/sweepGate.ts`): no pinned workspace, no Claude session found inside
 * it, or a transcript with no readable assistant turn is reported as what it is, and refused, because a check
 * that reports clean on an input it never saw is the silent-failure class this repository names everywhere.
 * The hatch is the way through when the reader itself is what is broken.
 *
 * ## When cmux does not answer, the session asking is still readable
 *
 * MEASURED: cmux hung for about four hours, every call timing out at 15s,
 * and the Fable chair could neither record a tick nor re-arm its sweep for the whole outage, because the walk to
 * the pinned workspace is two cmux calls. That refused a chair that was on Fable the whole time, in exactly the
 * window it most needed to keep working. So when the read is unresolved BECAUSE cmux did not answer, the gate
 * judges the session running the verb instead — its own `CLAUDE_CODE_SESSION_ID`, its own transcript, no cmux
 * call. On Fable passes as `caller-only`, saying the other tabs went unseen; off Fable or unread still refuses.
 * That is the "confirmed on Fable another way" the hatch's own exception names, done by the gate rather than by
 * a hand. Being on Fable is not being the chair, though: any Fable worker could run the verb while the real chair
 * sits on Opus. So the caller passes only when the supervisor-pin record
 * (`../sessions/supervisorPin.ts`, written by `cmux pin` and `cmux takeover`, read with no cmux call) names its
 * session id; another holder, or no record, refuses. Every Slopweaver verb that moves the pin off a recorded
 * workspace removes the record. The residue, stated: a pin moved BY HAND in cmux leaves the record naming the
 * former holder, which then passes here while cmux is silent and it is still on Fable. "Did not answer" is a timeout or a socket that will not open, nothing else: cmux replying with an
 * error frame or a malformed reply has answered, and refuses as before. With cmux up the caller is never asked:
 * the pinned workspace is the subject. Cmux answering with no pinned chair still refuses, because that is a fact
 * about the chair, not a silent reader.
 *
 * Pure: a read in, a verdict and lines out.
 */
import type { ChairVerdict } from "./chairModel.js";
import {
  type ChairModelFamily,
  type ChairRequirement,
  chairModelAlias,
  chairModelLabel,
  verdictAgainst,
} from "./chairPolicy.js";

/** One Claude session live in the pinned supervisor workspace, and what its transcript says. */
export interface ChairSessionReading {
  readonly sessionId: string;
  readonly pid: number;
  readonly verdict: ChairVerdict;
}

/**
 * Why a chair read is unresolved: cmux did not answer one of the two calls the walk needs (a timeout, or no
 * socket), cmux answered one with an error, cmux answered and no single pinned supervisor workspace was there
 * to read, the process table that binds a registry record to its running process could not be read, or the Claude
 * session registry could not say which sessions sit on the chair's pids, or the supervisor pin names a Codex thread,
 * so no Claude session in the pinned workspace is the chair, or no pin record or chain link names the chair's host at
 * all. Only the first lets the gate judge the caller instead.
 */
export type ChairUnresolvedCause =
  | "cmux-unanswered"
  | "cmux-error"
  | "no-chair"
  | "process-table-unread"
  | "registry-unread"
  | "codex-chair"
  | "chair-record-unread"
  | "chair-host-unmeasured";

/** What the chair read found: the pinned workspace's sessions, or why there was no workspace to read. */
export type ChairRead =
  | {
      readonly kind: "resolved";
      /** The pinned workspace's own cmux id — what `./chairRestore.ts` compares this process's own against. */
      readonly workspaceId: string;
      readonly workspaceCwd: string;
      readonly sessions: readonly ChairSessionReading[];
    }
  | { readonly kind: "unresolved"; readonly cause: ChairUnresolvedCause; readonly why: string };

/**
 * Whether the supervisor-pin record (`../sessions/supervisorPin.ts`) names the caller — the one fact outside cmux
 * that binds a session to the chair. It names this session, another one, or nothing (absent or unreadable).
 */
export type CallerPinBinding =
  | { readonly kind: "holder" }
  | { readonly kind: "other"; readonly holderSessionId: string; readonly workspaceRef: string }
  | { readonly kind: "unrecorded" };

/** The session RUNNING the gated verb, read by its own id with no cmux call — what the gate judges when cmux is silent. */
export interface CallerChairReading {
  readonly sessionId: string;
  readonly verdict: ChairVerdict;
  readonly pin: CallerPinBinding;
}

/**
 * Whether the chair may tick, or the one-clause detail and the per-session lines of why not.
 *
 * `caller-only` is a pass on a narrower read than `clean`: cmux did not answer, so only the session asking was
 * judged, and `note` says so for the gate to print.
 */
export type ChairGateVerdict =
  | { readonly kind: "clean" }
  | { readonly kind: "caller-only"; readonly note: string }
  | { readonly kind: "refused"; readonly detail: string; readonly lines: readonly string[] };

/**
 * What one verdict says, after the name of the session it is about.
 *
 * @param verdict the session's model verdict
 * @param required the family the chair must be on
 * @returns the model, since when, and the safeguard fallback when one switched it
 */
function verdictClause({ verdict, required }: { verdict: ChairVerdict; required: ChairModelFamily }): string {
  if (verdict.kind === "unreadable") {
    return `model UNREAD — ${verdict.why}`;
  }
  if (verdictAgainst({ model: required, verdict }) === "meets") {
    return `on ${verdict.model} as of ${verdict.atIso}`;
  }
  let fallback = "";
  if (verdict.kind === "off-fable" && verdict.fallback !== undefined) {
    const category = verdict.fallback.category === "" ? "unnamed" : verdict.fallback.category;
    fallback = `; a safeguard fallback switched it from ${verdict.fallback.originalModel} to ${verdict.fallback.fallbackModel} at ${verdict.fallback.atIso} (category ${category})`;
  }
  const label = chairModelLabel({ model: required }).toUpperCase();
  return `OFF ${label} — on ${verdict.model} as of ${verdict.atIso}${fallback}`;
}

/**
 * One session's line, as a refusal and `session standing` both print it.
 *
 * @param reading the session and its verdict
 * @param required the family the chair must be on
 * @returns the line, naming the model, since when, and the safeguard fallback when one switched it
 */
export function chairSessionLine({
  reading,
  required,
}: {
  reading: ChairSessionReading;
  required: ChairModelFamily;
}): string {
  return `session ${reading.sessionId} (pid ${String(reading.pid)}): ${verdictClause({ required, verdict: reading.verdict })}`;
}

/**
 * Whether any session in a resolved chair read is off the model the chair must be on — the one fact `session
 * standing` refuses to call clear. A requirement that admits no Claude chair at all counts every resolved read.
 *
 * @param read the chair read
 * @param requirement what the chair must be on
 * @returns true when at least one pinned session's newest turn is not on the required model
 */
export function chairViolatesRequirement({
  read,
  requirement,
}: {
  read: ChairRead;
  requirement: ChairRequirement;
}): boolean {
  if (read.kind !== "resolved") {
    return false;
  }
  if (requirement.kind === "claude-unavailable") {
    return read.sessions.length > 0;
  }
  return read.sessions.some(
    (reading) => verdictAgainst({ model: requirement.model, verdict: reading.verdict }) === "violates",
  );
}

/**
 * Judge the session asking, when cmux did not answer and the pinned workspace could not be walked.
 *
 * @param read the unresolved chair read, for its reason
 * @param caller the session running the gated verb, read by its own id
 * @param required the family the chair must be on
 * @returns caller-only when the pin record names it and it is on the required model, else the refusal naming why
 */
function judgeCallerOnly({
  read,
  caller,
  required,
}: {
  read: Extract<ChairRead, { kind: "unresolved" }>;
  caller: CallerChairReading;
  required: ChairModelFamily;
}): ChairGateVerdict {
  const clause = verdictClause({ required, verdict: caller.verdict });
  if (caller.pin.kind !== "holder") {
    const record =
      caller.pin.kind === "other"
        ? `the supervisor-pin record names session ${caller.pin.holderSessionId} (${caller.pin.workspaceRef})`
        : "no supervisor pin is recorded";
    return {
      detail: `cmux did not answer (${read.why}), and nothing outside cmux binds this session to the chair: ${record}`,
      kind: "refused",
      lines: [`  this session ${caller.sessionId}: ${clause}`],
    };
  }
  if (verdictAgainst({ model: required, verdict: caller.verdict }) === "meets") {
    return {
      kind: "caller-only",
      note:
        `chair gate: cmux did not answer (${read.why}), so only this session was judged — session ` +
        `${caller.sessionId}: ${clause}. Any other tab in the pinned workspace went unseen this tick.`,
    };
  }
  return {
    detail: `cmux did not answer (${read.why}), and this session, the one read without it, is not on ${chairModelLabel({ model: required })}`,
    kind: "refused",
    lines: [`  this session ${caller.sessionId}: ${clause}`],
  };
}

/**
 * Judge the chair against the model the plan lanes require of it (`./chairPolicy.ts`).
 *
 * @param read what the chair read found
 * @param caller the session running the gated verb, judged only when cmux did not answer; absent outside Claude Code
 * @param requirement what the chair must be on — Fable while more than one Claude plan stands, Opus on one
 * @returns clean, caller-only, or the refusal's detail and one line per session that is off the model or unread
 */
export function judgeChair({
  read,
  caller,
  requirement,
}: {
  read: ChairRead;
  caller?: CallerChairReading | undefined;
  requirement: ChairRequirement;
}): ChairGateVerdict {
  if (requirement.kind === "claude-unavailable") {
    return {
      detail: `${requirement.why} — write the handoff and leave the chair to a host whose plan stands`,
      kind: "refused",
      lines: [],
    };
  }
  const required = requirement.model;
  if (read.kind === "unresolved") {
    if (read.cause === "cmux-unanswered" && caller !== undefined) {
      return judgeCallerOnly({ caller, read, required });
    }
    return {
      detail: `the chair could not be read: ${read.why}`,
      kind: "refused",
      lines: [],
    };
  }
  if (read.sessions.length === 0) {
    return {
      detail: `no Claude session was found live in the pinned supervisor workspace (${read.workspaceCwd}), so which model is in the chair is unknown`,
      kind: "refused",
      lines: [],
    };
  }
  const flagged = read.sessions.filter(
    (reading) => verdictAgainst({ model: required, verdict: reading.verdict }) !== "meets",
  );
  if (flagged.length === 0) {
    return { kind: "clean" };
  }
  const off = flagged.filter(
    (reading) => verdictAgainst({ model: required, verdict: reading.verdict }) === "violates",
  ).length;
  return {
    detail: `${String(off)} of ${String(read.sessions.length)} session(s) in the pinned workspace are off ${chairModelLabel({ model: required })}, ${String(flagged.length - off)} unread`,
    kind: "refused",
    lines: flagged.map((reading) => `  ${chairSessionLine({ reading, required })}`),
  };
}

/**
 * The HANDOFF remedy — the expensive recovery, and no longer the first thing a refused chair reads.
 *
 * `./chairRestore.ts` runs ahead of this and types the seat back onto the required model itself (an owner ruling);
 * these two lines are what is left when that could not be done or did not take. They remain the WHOLE remedy when
 * the off-model seat is a different TAB, because cmux addresses a workspace rather than a session and nothing here
 * can pick that tab out.
 *
 * @param required the family the chair must be on, which the fresh chair is spawned with
 * @returns the handoff remedy lines
 */
export function chairHandoffRemedyLines({ required }: { required: ChairModelFamily }): readonly string[] {
  const label = chairModelLabel({ model: required });
  return [
    "If THIS session is one of those and the restore above did not take, it takes no further rulings: write the " +
      `handoff now and \`slopweaver cmux spawn <handoff slug> --model ${chairModelAlias({ model: required })}\` a fresh chair this same tick, ` +
      "relaying every owner turn it took verbatim.",
    `If it is ANOTHER tab in the pinned workspace, close that tab and re-run — a workspace holding an off-${label} ` +
      `session is not a ${label} chair, whichever tab asks.`,
  ];
}
