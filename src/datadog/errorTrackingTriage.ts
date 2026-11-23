/**
 * Moving Error Tracking issues between states — the WRITE half of the error-tracking fix batch. The real seam
 * is `errorTrackingTriageSdk.ts` (and why the SDK rather than `rawRequest.ts`); the failures and the receipt
 * each carries are `errorTrackingTriageErrors.ts`.
 *
 * ## Read, move, read back
 *
 * Every issue is read BEFORE anything is sent, so an id Datadog does not know refuses the whole run rather
 * than half of it. An issue already in the target state is never PUT again. An accepted PUT is never taken as
 * success: after the moves, every issue is read AGAIN and success is what that read says — the `hmi --enable`
 * and `monitor update` contract. A failed PUT stops the run where it failed (`settleMove` says how).
 *
 * Pure apart from the {@link TriageApi} seam, which a test supplies as plain functions.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { ErrorTrackingState } from "./errorTracking.js";
import {
  type DatadogTriageError,
  DatadogTriageErrors,
  type IssueStateRow,
  isDatadogRefusal,
  type PutAnswer,
} from "./errorTrackingTriageErrors.js";

/**
 * The states a triage may move an issue INTO. Excluded is left out by policy, though Datadog accepts it on
 * one issue: it stops collecting the issue's errors and changes billing, which is not a triage's call.
 */
export const TRIAGE_TARGET_STATES = ["OPEN", "ACKNOWLEDGED", "IGNORED", "RESOLVED"] as const;

/** One state a triage may move an issue into. */
export type TriageTargetState = (typeof TRIAGE_TARGET_STATES)[number];

/**
 * An Error Tracking issue id: a UUID. MEASURED on this install's site with `slopweaver datadog errors --query
 * 'env:(prod OR production)' --from 1d --state for-review --limit 3` — every link ends in one, in the
 * lowercase 8-4-4-4-12 hex form. Checked before anything is sent, because an id reaches the API as a
 * path segment.
 */
const ISSUE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * What one lookup found: the issue's state, or Datadog's 404 for an id it does not know.
 *
 * @internal exported only because {@link TriageApi}'s `get` returns it.
 */
export type IssueLookup = { readonly found: true; readonly state: ErrorTrackingState } | { readonly found: false };

/**
 * The two calls this module makes, as a seam: the real one wraps the SDK, a test passes plain functions. A
 * lookup that is neither found nor absent (a 403, a 5xx, no network) THROWS, and the callers below turn that
 * into a typed error naming the issue.
 */
export interface TriageApi {
  readonly get: (request: { id: string }) => Promise<IssueLookup>;
  readonly setState: (request: { id: string; state: TriageTargetState }) => Promise<void>;
}

/**
 * Check every requested id before anything is sent, lower-casing each and dropping repeats in the order given.
 *
 * @param ids the ids as the caller wrote them
 * @returns the distinct ids, or every id that is not an issue id
 */
export function validateIssueIds({ ids }: { ids: readonly string[] }): Result<readonly string[], DatadogTriageError> {
  const normalised = ids.map((id) => id.trim().toLowerCase());
  const invalid = normalised.filter((id) => !ISSUE_ID_PATTERN.test(id));
  if (invalid.length > 0) {
    return err(DatadogTriageErrors.issueIdInvalid({ ids: invalid }));
  }
  return ok([...new Set(normalised)]);
}

/** Which issues a triage moves, and which already sit in the target state and are left alone. */
export interface TriagePlan {
  readonly target: TriageTargetState;
  readonly alreadyThere: readonly string[];
  readonly toMove: readonly IssueStateRow[];
}

/**
 * Split current states into what is already in the target state and what a triage must move.
 *
 * @param rows each issue's current state
 * @param target the state every issue should end in
 * @returns the plan; `toMove` carries each issue's state BEFORE the move
 */
export function planTriage({
  rows,
  target,
}: {
  rows: readonly IssueStateRow[];
  target: TriageTargetState;
}): TriagePlan {
  return {
    alreadyThere: rows.filter((row) => row.state === target).map((row) => row.id),
    target,
    toMove: rows.filter((row) => row.state !== target),
  };
}

/**
 * The issues a read-back finds anywhere but the target state.
 *
 * @param rows the read-back's states
 * @param target the state every issue should be in
 * @returns those rows, in order
 */
export function issuesNotAt({
  rows,
  target,
}: {
  rows: readonly IssueStateRow[];
  target: TriageTargetState;
}): readonly IssueStateRow[] {
  return rows.filter((row) => row.state !== target);
}

/**
 * Read each issue's state, in order, stopping at the first id Datadog does not know or cannot answer for.
 *
 * @param api the lookup seam
 * @param ids the validated ids
 * @param movedBefore what this run had already moved before this read — empty for the first read, the receipt
 *   for a later one
 * @returns every issue's state, or the first that could not be read
 */
export async function readIssueStates({
  api,
  ids,
  movedBefore,
}: {
  api: TriageApi;
  ids: readonly string[];
  movedBefore: readonly string[];
}): Promise<Result<readonly IssueStateRow[], DatadogTriageError>> {
  const rows: IssueStateRow[] = [];
  for (const id of ids) {
    const row = await readIssueState({ api, id, movedBefore });
    if (row.isErr()) {
      return err(row.error);
    }
    rows.push(row.value);
  }
  return ok(rows);
}

/** Read one issue's state, naming what this run had already moved on any failure. */
async function readIssueState({
  api,
  id,
  movedBefore,
}: {
  api: TriageApi;
  id: string;
  movedBefore: readonly string[];
}): Promise<Result<IssueStateRow, DatadogTriageError>> {
  let lookup: IssueLookup;
  try {
    lookup = await api.get({ id });
  } catch (cause: unknown) {
    return err(DatadogTriageErrors.readFailed({ cause, id, movedBefore }));
  }
  if (!lookup.found) {
    return err(DatadogTriageErrors.issueUnknown({ id, movedBefore }));
  }
  return ok({ id, state: lookup.state });
}

/**
 * Move each planned issue, in order, stopping at the first failure and naming what had already been moved —
 * a move is a change to Datadog even when a later one fails.
 *
 * Each issue is read again just before its PUT, and one whose state is no longer what the plan read is left
 * alone: it changed outside this run in between — another triager, or Datadog's own automation — and that
 * change is newer than this run's plan. That narrows the race to the gap between this read and the PUT; the
 * endpoint offers no conditional update to close it.
 *
 * An id is counted moved only when Datadog ACCEPTED this run's PUT and a read straight after finds the target
 * state. That is a postcondition, not proof of cause: with no conditional update, another actor making the
 * same move in that gap is indistinguishable, so the receipt says only that this run asked and the issue is
 * there. Every other outcome stops the run, since none of them shows what the PUT did — see `settleMove`.
 *
 * @param api the write seam
 * @param plan what to move and where
 * @returns the ids moved, or the failure carrying them
 */
export async function moveIssues({
  api,
  plan,
}: {
  api: TriageApi;
  plan: TriagePlan;
}): Promise<Result<readonly string[], DatadogTriageError>> {
  const moved: string[] = [];
  for (const row of plan.toMove) {
    const current = await readIssueState({ api, id: row.id, movedBefore: [...moved] });
    if (current.isErr()) {
      return err(current.error);
    }
    if (current.value.state !== row.state) {
      const found = current.value.state;
      return err(DatadogTriageErrors.stateChanged({ found, id: row.id, movedBefore: [...moved], planned: row.state }));
    }
    let answer: PutAnswer = { accepted: true };
    try {
      await api.setState({ id: row.id, state: plan.target });
    } catch (cause: unknown) {
      answer = { accepted: false, cause };
    }
    const settled = await settleMove({ answer, api, id: row.id, movedBefore: [...moved], target: plan.target });
    if (settled.isErr()) {
      return err(settled.error);
    }
    moved.push(row.id);
  }
  return ok(moved);
}

/**
 * How a PUT was answered, then the read straight after, decide what it did. A thrown PUT is a refusal only when
 * Datadog's own 4xx says so; any other throw is a move that MAY have happened, whatever a later read finds,
 * since this run cannot tell its own lost answer from another actor's move. An accepted PUT read back in the
 * target state counts as moved. Read back anywhere else — where the plan left it included, since an applied
 * move undone straight after reads the same as a no-op — or not read at all, it is uncertain rather than
 * guessed either way.
 */
async function settleMove({
  answer,
  api,
  id,
  movedBefore,
  target,
}: {
  answer: PutAnswer;
  api: TriageApi;
  id: string;
  movedBefore: readonly string[];
  target: TriageTargetState;
}): Promise<Result<void, DatadogTriageError>> {
  if (!answer.accepted) {
    if (isDatadogRefusal({ cause: answer.cause })) {
      return err(DatadogTriageErrors.updateRejected({ cause: answer.cause, id, movedBefore }));
    }
    return err(DatadogTriageErrors.updateUnconfirmed({ answer, id, movedBefore }));
  }
  const after = await readIssueState({ api, id, movedBefore });
  if (after.isOk() && after.value.state === target) {
    return ok(undefined);
  }
  return err(DatadogTriageErrors.updateUnconfirmed({ answer, id, movedBefore }));
}
