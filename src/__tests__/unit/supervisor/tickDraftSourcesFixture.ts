/**
 * The tick-draft mapping's shared test inputs: the tick's two instants, the redirected-file shape a producer's
 * document arrives in, and the readers that unwrap one observation. Shared by the sibling test files that each hold
 * one source's mapping, so every family drafts against the very same tick.
 */
import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  type CapturedDocument,
  type DraftedSourceKind,
  draftTickSources,
} from "../../../supervisor/tickDraftSources.js";
import type { SourceObservation, SupervisorTickSources } from "../../../supervisor/tickTypes.js";

/** The instant the tick started, which a document captured before it is judged against. */
export const STARTED = "2026-09-12T21:18:42.000Z";

/** The instant the tick's documents were captured. */
export const CAPTURED = "2026-09-12T21:25:00.000Z";

/**
 * An observation's facts, throwing when it has none — the observation form of `unwrap`.
 *
 * @returns the facts a read or partial observation carries
 */
export function factsOf<TFacts>({ observation }: { observation: SourceObservation<TFacts> }): TFacts {
  if (observation.status === "unavailable") {
    throw new Error(`expected facts, got unavailable: ${observation.diagnostic}`);
  }
  return observation.facts;
}

/**
 * An observation's diagnostic, throwing when a clean read has none.
 *
 * @returns the diagnostic a partial or unavailable observation carries
 */
export function diagnosticOf({ observation }: { observation: SourceObservation<unknown> }): string {
  if (observation.status === "read") {
    throw new Error("expected a diagnostic, got a clean read");
  }
  return observation.diagnostic;
}

/**
 * An observation's verbatim line, throwing when an unavailable one cannot carry any.
 *
 * @returns the producer's own line, when the observation kept one
 */
export function verbatimOf({ observation }: { observation: SourceObservation<unknown> }): string | undefined {
  if (observation.status === "unavailable") {
    throw new Error(`expected a reading, got unavailable: ${observation.diagnostic}`);
  }
  return observation.verbatimLine;
}

/**
 * Serialise a producer's document the way a redirected file carries it.
 *
 * @returns the captured document, every omitted key absent rather than undefined
 */
export function redirected({ path, value }: { path: string; value: unknown }): CapturedDocument {
  return { document: JSON.parse(JSON.stringify(value)) as unknown, path };
}

/**
 * One due row, as `automation due --json` carries it.
 *
 * @param claimedBy the claim's holder, or no claim on the row when undefined
 * @returns the due row
 */
export function dueRow({
  recipeId,
  shape = "run-here",
  actionable = true,
  lateByMs = 369309,
  band = "overdue",
  claimedBy = undefined,
}: {
  recipeId: string;
  shape?: string;
  actionable?: boolean;
  lateByMs?: number | null;
  band?: string;
  claimedBy?: string | undefined;
}): Record<string, unknown> {
  const base = { actionable, due: true, kind: "verb-run", recipeId, shape, tolerance: { band, lateByMs } };
  if (claimedBy === undefined) {
    return base;
  }
  return { ...base, claim: { claimedBy, expiresAtIso: "2026-09-13T01:00:00.000Z" } };
}

/**
 * A due report over the given rows, rejected definitions and declaration lists.
 *
 * @returns the redirected `automation due --json` document
 */
export function dueDocument({
  rows,
  missing = [],
  rejected = [],
  superseded = [],
}: {
  rows: readonly unknown[];
  missing?: readonly unknown[];
  rejected?: readonly string[];
  superseded?: readonly unknown[];
}): CapturedDocument {
  return redirected({
    path: "recipe-due.json",
    value: { missing, nowIso: "2026-09-12T21:24:00.000Z", rejected, rows, superseded },
  });
}

/**
 * Draft the twelve sources from one captured document.
 *
 * @returns every drafted source, the one supplied mapped and the rest unavailable
 */
export function sourcesWith({
  kind,
  capture,
}: {
  kind: DraftedSourceKind;
  capture: CapturedDocument;
}): SupervisorTickSources {
  return unwrap(draftTickSources({ capturedIso: CAPTURED, captures: { [kind]: capture }, startedIso: STARTED }));
}

/**
 * The refusal lines drafting one captured document produced.
 *
 * @returns the lines the draft refused with
 */
export function refusalFor({
  kind,
  capture,
}: {
  kind: DraftedSourceKind;
  capture: CapturedDocument;
}): readonly string[] {
  return unwrapErr(draftTickSources({ capturedIso: CAPTURED, captures: { [kind]: capture }, startedIso: STARTED }));
}
