/**
 * The pure half of `slopweaver turn reach`, and of the answer refusal that reads its receipts.
 *
 * The aim is that anything useful is reachable before the bot answers. So before a turn leans on a page in the owner's work Chrome,
 * `turn reach` visits its origin and says one of four things: every origin is signed in (a receipt is written), one
 * is signed out (the turn blocks on the owner, with the note and the top-of-queue card), one has no sign-in the fleet can
 * read (named, never called reachable), or a visit could not be read at all (never called signed out).
 *
 * A receipt proves REACHABILITY only — not that the page holds the fact, nor that the worker read it. That is why
 * the answer refusal reads only the evidence lines that DECLARE a read with a URL: a body link is a reader's
 * destination, not a claim about what this turn saw.
 */
import type { RecheckObservation } from "../../../hand/recheck.js";
import { sessionProbePlatform } from "../../../hand/sessionProbes.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { signInOriginOf } from "../../../live/ask/signInOrigin.js";
import type { ProgressReachEvent } from "../../../live/turn/progressReach.js";
import type { AnswerFormAnswer } from "../../../outbound/assistant/answerForm.js";

/** What one origin's visit found — or, with no platform, that no probe reads its sign-in and none was made. */
export interface ReachObservation {
  readonly origin: string;
  /** The platform whose probe read the origin, or absent when no probe reads it. */
  readonly platform: string | undefined;
  /** What the visit saw; absent exactly when {@link ReachObservation.platform} is. */
  readonly outcome: RecheckObservation | undefined;
}

/** What `turn reach` does next, decided from every observation at once. */
export type ReachPlan =
  | { readonly kind: "reachable"; readonly origins: readonly string[] }
  | { readonly kind: "block"; readonly origin: string; readonly observed: string }
  | { readonly kind: "unsupported"; readonly origins: readonly string[] }
  | { readonly kind: "unread"; readonly origin: string; readonly why: string };

/**
 * The unique bare origins a list of `--url` values names, in the order given — or every value that is not an
 * `https://` page, and a refusal of an empty list.
 *
 * @param urls every `--url` value, in order
 * @returns the origins, or every problem with the list
 */
export function reachOrigins({ urls }: { urls: readonly string[] }): Result<readonly string[]> {
  if (urls.length === 0) {
    return err(["--url is required — the page the answer will lean on, once per origin"]);
  }
  const origins: string[] = [];
  const problems: string[] = [];
  for (const url of urls) {
    const origin = signInOriginOf({ url });
    if (origin === undefined) {
      problems.push(`--url must be an https:// page, got ${JSON.stringify(url)}`);
    } else if (!origins.includes(origin)) {
      origins.push(origin);
    }
  }
  return problems.length === 0 ? ok(origins) : err(problems);
}

/**
 * Decide what one reach does. Precedence is unread, then unsupported, then the FIRST signed-out origin, then
 * reachable: an origin nobody could read is never reachable because another one passed, and a turn blocks on ONE
 * step at a time (rule 6) — once the owner clears it, running `turn reach` again exposes the next.
 *
 * @param observations one per origin, in the caller's order
 * @returns the plan
 */
export function planReach({ observations }: { observations: readonly ReachObservation[] }): ReachPlan {
  for (const observation of observations) {
    if (observation.outcome?.kind === "unread") {
      return { kind: "unread", origin: observation.origin, why: observation.outcome.why };
    }
  }
  const unsupported = observations.filter((observation) => observation.outcome === undefined);
  if (unsupported.length > 0) {
    return { kind: "unsupported", origins: unsupported.map((observation) => observation.origin) };
  }
  for (const observation of observations) {
    if (observation.outcome?.kind === "unmet") {
      return { kind: "block", observed: observation.outcome.observed, origin: observation.origin };
    }
  }
  return { kind: "reachable", origins: observations.map((observation) => observation.origin) };
}

/**
 * Every origin the answer DECLARES it read — a URL on a `read`, `consultedEmpty` or premise-check line — whose sign-in
 * a probe can read and no reach receipt on this ask found signed in. Empty means the answer may go.
 *
 * @param answer the parsed answer form
 * @param reaches every reach receipt the ask's progress log carries
 * @returns the unchecked origins, each once, in the order the evidence names them
 */
export function uncheckedEvidenceOrigins({
  answer,
  reaches,
}: {
  answer: AnswerFormAnswer;
  reaches: readonly ProgressReachEvent[];
}): readonly string[] {
  const evidence = answer.grounding.evidence;
  const reached = new Set(reaches.flatMap((reach) => reach.origins));
  const urls = [...evidence.read, ...evidence.consultedEmpty, ...evidence.premiseChecks].flatMap((line) =>
    line.url === undefined ? [] : [line.url],
  );
  const unchecked: string[] = [];
  for (const url of urls) {
    const origin = signInOriginOf({ url });
    if (origin === undefined || reached.has(origin) || unchecked.includes(origin)) {
      continue;
    }
    if (sessionProbePlatform({ origin }) !== undefined) {
      unchecked.push(origin);
    }
  }
  return unchecked;
}
