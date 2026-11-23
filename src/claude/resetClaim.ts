/**
 * The CLAIM half of `slopweaver claude reset`, pure: which grant a claim would spend, whether the provider would
 * honour it now, the request that spends it, and what the provider answered.
 *
 * ## The provider's own call
 *
 * Claude Code 2.1.284 claims with `POST /api/organizations/<org>/reset_rate_limits` carrying
 * `{ program: "cedar_ember", grant_id, request_id }`, where `grant_id` matches `/^[a-z0-9_-]{1,40}$/` and the
 * `request_id` it mints is a `randomUUID()` it keeps as an "unsettled claim" to resend. The answer's `result` is one
 * of `reset | already_used | not_limited | cooldown | ineligible | unavailable`, with `resets_left`, `cleared`,
 * `weekly_resets_at` and `cooldown_until` beside it; a `429` is throttling and a `401`/`403` refuses the call.
 * Reproduce with `strings ~/.local/share/claude/versions/2.1.284 | grep -F reset_rate_limits`.
 *
 * ## Only what the provider would honour
 *
 * A grant that `use_requires_limit` is honoured only while a window is at its limit, so a claim with none at a
 * limit is refused here as the FACT it is ({@link freshClaimRefusal}) rather than sent to be told `not_limited`. A
 * grant that does not require a limit could be spent with room left; that is a POLICY call the verb makes through
 * the `early-claude-reset` hatch, mirroring `early-codex-reset`.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import { epochSecondsToIso } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { type ClaudeResetError, ClaudeResetErrors } from "./resetErrors.js";
import type { ClaudeResetBlock, ClaudeResetGrant } from "./resetStatus.js";

/** The program Claude Code names in every claim. */
const RESET_PROGRAM = "cedar_ember";

/** An organisation id as the provider issues it; the tolerant assertions reader accepts any string. */
const ORGANIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request id shape Claude Code's own claim refuses to send outside of. */
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Every result the claim answer may carry. */
export const CLAIM_RESULTS = ["reset", "already_used", "not_limited", "cooldown", "ineligible", "unavailable"] as const;

/** What the provider answered a claim with. */
export type ClaudeClaimResult = (typeof CLAIM_RESULTS)[number];

/** A claim answer the provider stands behind. */
export interface ClaudeClaimAnswer {
  readonly result: ClaudeClaimResult;
  readonly reason?: string;
  readonly resetsLeft?: number;
  readonly cleared: readonly string[];
  readonly weeklyResetsAtIso?: string;
  readonly cooldownUntilIso?: string;
}

/**
 * The claim answer, strict (`#lib/boundary.js`). A field the provider adds or renames refuses the answer as an
 * UNKNOWN outcome, never a refused one: the retry reuses the journalled request id, so the provider settles it as
 * the same claim and nothing is spent twice.
 */
const CLAIM_ANSWER = defineBoundary({
  endpoint: "POST /api/organizations/<org>/reset_rate_limits",
  schema: z.strictObject({
    // An answer naming no cleared window cleared none — the absence is the provider's own statement, read here once.
    cleared: z.array(z.string()).default([]),
    cooldown_until: z.union([z.string(), z.number()]).nullable().optional(),
    reason: z.string().nullable().optional(),
    resets_left: z.number().int().min(0).nullable().optional(),
    result: z.enum(CLAIM_RESULTS),
    weekly_resets_at: z.union([z.string(), z.number()]).nullable().optional(),
  }),
});

/**
 * The claim endpoint for one organisation.
 *
 * @param organizationId the organisation the plan is ENROLLED under — never printed
 * @returns the URL, or why the id cannot go into one
 */
export function resetClaimUrl({ organizationId }: { organizationId: string }): Result<string, ClaudeResetError> {
  if (!ORGANIZATION_ID.test(organizationId)) {
    return err(ClaudeResetErrors.statusUnreadable({ detail: "the enrolled organisation id is not a UUID" }));
  }
  return ok(`https://api.anthropic.com/api/organizations/${encodeURIComponent(organizationId)}/reset_rate_limits`);
}

/**
 * The claim body, refusing an id Claude Code itself would refuse to send.
 *
 * @param grantId the grant to spend
 * @param requestId the attempt's request id, journalled before this is sent
 * @returns the JSON body, or why it cannot be built
 */
export function resetClaimBody({
  grantId,
  requestId,
}: {
  grantId: string;
  requestId: string;
}): Result<string, ClaudeResetError> {
  if (!REQUEST_ID.test(requestId)) {
    return err(ClaudeResetErrors.statusUnreadable({ detail: "the request id is not one the provider accepts" }));
  }
  return ok(JSON.stringify({ grant_id: grantId, program: RESET_PROGRAM, request_id: requestId }));
}

/** A time field as an ISO instant, or undefined. */
function isoOf({ value }: { value: string | number | null | undefined }): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return typeof value === "number" ? epochSecondsToIso({ seconds: value }) : value;
}

/**
 * What the provider answered a claim, or why no answer it stands behind came back.
 *
 * A `401`/`403` refuses the CALL before it acts, so it is {@link ClaudeResetErrors.claimRefused}; every other
 * non-answer — a throttle, a 5xx, a body this code cannot read — may or may not have spent, so it is
 * {@link ClaudeResetErrors.outcomeUnknown} carrying the request id a retry must reuse.
 *
 * @param bodyText the answer's body, as text
 * @param requestId the attempt's request id
 * @param status the HTTP status
 * @returns the answer, or the typed reason there is none
 */
export function readClaimAnswer({
  bodyText,
  requestId,
  status,
}: {
  bodyText: string;
  requestId: string;
  status: number;
}): Result<ClaudeClaimAnswer, ClaudeResetError> {
  if (status === 401 || status === 403) {
    return err(ClaudeResetErrors.claimRefused({ status }));
  }
  if (status < 200 || status >= 300) {
    return err(ClaudeResetErrors.outcomeUnknown({ reason: `HTTP ${String(status)}`, requestId }));
  }
  const parsed = CLAIM_ANSWER.parseJson({ text: bodyText });
  if (parsed.isErr()) {
    return err(ClaudeResetErrors.outcomeUnknown({ reason: parsed.error.message, requestId }));
  }
  const wire = parsed.value;
  const weeklyResetsAtIso = isoOf({ value: wire.weekly_resets_at });
  const cooldownUntilIso = isoOf({ value: wire.cooldown_until });
  return ok({
    cleared: wire.cleared,
    result: wire.result,
    ...(typeof wire.reason === "string" ? { reason: wire.reason } : {}),
    ...(typeof wire.resets_left === "number" ? { resetsLeft: wire.resets_left } : {}),
    ...(weeklyResetsAtIso === undefined ? {} : { weeklyResetsAtIso }),
    ...(cooldownUntilIso === undefined ? {} : { cooldownUntilIso }),
  });
}

/**
 * The grant a fresh claim would spend: the one `--grant` named, else the provider's own next grant, else the first
 * grant usable now with a reset left.
 *
 * @param block the plan's reset state
 * @param requestedGrant the grant `--grant` named, if any
 * @returns the grant, or why none can be chosen
 */
export function chooseResetGrant({
  block,
  requestedGrant,
}: {
  block: ClaudeResetBlock;
  requestedGrant: string | undefined;
}): Result<ClaudeResetGrant, ClaudeResetError> {
  if (!block.eligible) {
    const reason = block.ineligibleReason;
    if (reason === undefined) {
      return err(ClaudeResetErrors.notEligible({ reason: "no reason given" }));
    }
    return err(ClaudeResetErrors.notEligible({ reason }));
  }
  if (requestedGrant !== undefined) {
    const named = block.grants.find((grant) => grant.id === requestedGrant);
    return named === undefined ? err(ClaudeResetErrors.grantNotHeld({ grantId: requestedGrant })) : ok(named);
  }
  const nextId = block.nextGrantId;
  const next = nextId === undefined ? undefined : block.grants.find((grant) => grant.id === nextId);
  if (next !== undefined) {
    return ok(next);
  }
  const usable = block.grants.find((grant) => grant.usableNow && grant.resetsLeft > 0);
  if (usable === undefined) {
    return err(ClaudeResetErrors.noUsableGrant({ why: "the plan holds no grant usable now" }));
  }
  return ok(usable);
}

/**
 * Why the provider would not honour a fresh claim of this grant now, or undefined when it would.
 *
 * @param block the plan's reset state
 * @param grant the grant a claim would spend
 * @param nowIso the instant the status was read
 * @returns the refusal, or undefined
 */
export function freshClaimRefusal({
  block,
  grant,
  nowIso,
}: {
  block: ClaudeResetBlock;
  grant: ClaudeResetGrant;
  nowIso: string;
}): ClaudeResetError | undefined {
  const cooldown = block.cooldownUntilIso;
  if (cooldown !== undefined && Date.parse(cooldown) > Date.parse(nowIso)) {
    return ClaudeResetErrors.cooldown({ untilIso: cooldown });
  }
  if (grant.paused) {
    return ClaudeResetErrors.noUsableGrant({ why: `grant ${grant.id} is paused` });
  }
  if (grant.resetsLeft === 0) {
    return ClaudeResetErrors.noUsableGrant({ why: `grant ${grant.id} has no reset left` });
  }
  if (!grant.usableNow) {
    return ClaudeResetErrors.noUsableGrant({ why: `grant ${grant.id} is not usable now` });
  }
  if (grant.useRequiresLimit && !block.atLimit) {
    return ClaudeResetErrors.noUsableGrant({
      why: `grant ${grant.id} is honoured only at a limit, and no window is at one`,
    });
  }
  return undefined;
}
