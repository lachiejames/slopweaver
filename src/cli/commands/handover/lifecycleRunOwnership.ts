/**
 * `handover claim` and `handover release` — the two verbs that transfer a run's ownership between visible
 * sessions. Split out of `lifecycleRun.ts`, which re-exports everything here unchanged; see
 * {@link ./lifecycleRunCore} for the shared resolve/flag machinery this depends on.
 */

import { applyRowEvent } from "../../../handover/rowEvent.js";
import { type RunOwnership, runOwnership, type WriterLiveness } from "../../../handover/runOwner.js";
import { logger } from "../../../lib/logger.js";
import {
  detectSupervisorSession,
  type SupervisorSession,
  supervisorSessionProblem,
} from "../../../supervisor/session.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  lifecycleUsage,
  nowIso,
  ownershipAmbiguityRefusal,
  phaseRefusalFor,
  type Resolved,
  resolve,
  stringFlag,
  writerLivenessNow,
} from "./lifecycleRunCore.js";

/**
 * Whether a foreign claim needs the loud takeover flag.
 *
 * @param ownership the journal's ownership verdict from this session
 * @param liveness what this machine proved about the current writer
 * @param forced whether the owner supplied the loud takeover flag
 * @returns the refusal sentence, or `undefined` when the claim may be appended
 */
export function claimRefusal({
  ownership,
  liveness,
  forced,
}: {
  ownership: RunOwnership;
  liveness: WriterLiveness;
  forced: boolean;
}): string | undefined {
  if (ownership.kind !== "elsewhere" || liveness.kind === "dead" || forced) {
    return undefined;
  }
  return liveness.kind === "live"
    ? `session ${ownership.writer.sessionId} is still live — release it there first, or repeat with --force`
    : `the old writer's liveness is unknown (${liveness.why}) — release it there first, or repeat with --force`;
}

/** The visible session required for an ownership transition, or a printed refusal. */
function activeSession({ verb }: { verb: "claim" | "release" }): SupervisorSession | number {
  const detection = detectSupervisorSession({ env: process.env });
  if (detection.kind === "active") {
    return detection.session;
  }
  logger.error({ msg: `handover ${verb}: ${supervisorSessionProblem({ detection })}` });
  return EXIT_ERROR;
}

/**
 * `handover claim` — take an unowned, released or provably dead run into this visible session.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverClaim(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "claim" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const why = stringFlag({ name: "why", parsed: resolved.parsed })?.trim();
  if (why === undefined || why.length === 0) {
    logger.error({ msg: "handover claim: --why is required" });
    logger.error({ msg: lifecycleUsage({ verb: "claim" }) });
    return EXIT_USAGE;
  }
  const phase = phaseRefusalFor({ resolved, verb: "claim" });
  if (phase !== undefined) {
    logger.error({ msg: `handover claim: ${phase}` });
    return EXIT_ERROR;
  }
  const ambiguous = ownershipAmbiguityRefusal({ context: resolved.context, verb: "handover claim" });
  if (ambiguous !== undefined) {
    return ambiguous;
  }
  const session = activeSession({ verb: "claim" });
  if (typeof session === "number") {
    return session;
  }
  const ownership = runOwnership({ events: resolved.context.events, sessionId: session.id });
  if (ownership.kind === "mine") {
    logger.out({ line: `handover claim: ${resolved.context.doc.slug} is already owned by this session` });
    return EXIT_OK;
  }
  const liveness =
    ownership.kind === "elsewhere" ? writerLivenessNow({ writer: ownership.writer }) : { kind: "dead" as const };
  const forced = resolved.parsed.values["force"] === true;
  const refusal = claimRefusal({ forced, liveness, ownership });
  if (refusal !== undefined) {
    logger.error({ msg: `handover claim: ${refusal}` });
    return EXIT_ERROR;
  }
  return appendClaim({ forced, liveness, ownership, resolved, session, why });
}

/** Append and report a claim after every ownership decision has passed. */
function appendClaim({
  forced,
  liveness,
  ownership,
  resolved,
  session,
  why,
}: {
  forced: boolean;
  liveness: WriterLiveness;
  ownership: RunOwnership;
  resolved: Resolved;
  session: SupervisorSession;
  why: string;
}): number {
  // "Forced" as an AUDIT FACT means the flag actually bypassed the guard — a foreign holder not proven dead.
  // Supplying a redundant --force against a provably dead writer (which claimRefusal admits anyway) is not a
  // takeover, and journalling it as one would be a false fact a later audit has no way to un-believe.
  const bypassedHolder =
    forced && ownership.kind === "elsewhere" && liveness.kind !== "dead" ? ownership.writer : undefined;
  if (bypassedHolder !== undefined) {
    logger.error({
      msg: `handover claim: FORCED takeover from session ${bypassedHolder.sessionId} — ${why}`,
    });
  }
  const appended = applyRowEvent({
    event: {
      atIso: nowIso(),
      host: session.host,
      kind: "claimed",
      pid: process.pid,
      sessionId: session.id,
      why,
      worktree: process.cwd(),
      ...(bypassedHolder !== undefined ? { forced: true as const } : {}),
    },
    runsDir: resolved.runsDir,
    slug: resolved.context.doc.slug,
  });
  if (appended.isErr()) {
    logger.error({ msg: `handover claim: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({
    line: `handover claim: ${session.host} session ${session.id} now owns ${resolved.context.doc.slug} — ${why}`,
  });
  return EXIT_OK;
}

/**
 * `handover release` — the current writer deliberately yields a run for another visible session.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverRelease(argv: readonly string[]): Promise<number> {
  const resolved = resolve({ argv, verb: "release" });
  if (typeof resolved === "number") {
    return resolved;
  }
  const why = stringFlag({ name: "why", parsed: resolved.parsed })?.trim();
  if (why === undefined || why.length === 0) {
    logger.error({ msg: "handover release: --why is required" });
    logger.error({ msg: lifecycleUsage({ verb: "release" }) });
    return EXIT_USAGE;
  }
  const phase = phaseRefusalFor({ resolved, verb: "release" });
  if (phase !== undefined) {
    logger.error({ msg: `handover release: ${phase}` });
    return EXIT_ERROR;
  }
  const ambiguous = ownershipAmbiguityRefusal({ context: resolved.context, verb: "handover release" });
  if (ambiguous !== undefined) {
    return ambiguous;
  }
  const session = activeSession({ verb: "release" });
  if (typeof session === "number") {
    return session;
  }
  const ownership = runOwnership({ events: resolved.context.events, sessionId: session.id });
  if (ownership.kind === "unowned") {
    logger.error({ msg: `handover release: ${resolved.context.doc.slug} has no recorded writer to release` });
    return EXIT_ERROR;
  }
  if (ownership.kind === "elsewhere") {
    logger.error({
      msg: `handover release: only session ${ownership.writer.sessionId} may release ${resolved.context.doc.slug}`,
    });
    return EXIT_ERROR;
  }
  if (ownership.kind === "released") {
    logger.error({
      msg:
        `handover release: ${resolved.context.doc.slug} was already released by session ` +
        `${ownership.writer.sessionId} at ${ownership.releasedAtIso} — nothing to release`,
    });
    return EXIT_ERROR;
  }
  const appended = applyRowEvent({
    event: { atIso: nowIso(), kind: "released", sessionId: session.id, why },
    runsDir: resolved.runsDir,
    slug: resolved.context.doc.slug,
  });
  if (appended.isErr()) {
    logger.error({ msg: `handover release: ${appended.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `handover release: released ${resolved.context.doc.slug} — ${why}` });
  logger.out({ line: `  NEXT: in the destination session, run handover claim ${resolved.context.doc.slug} --why "…"` });
  return EXIT_OK;
}
