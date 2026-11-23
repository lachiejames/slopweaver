/**
 * The READ half of `slopweaver claude reset`: where a plan's free usage-limit reset state lives, the headers the
 * request carries, and the reading of the `cedar_ember` block into this repository's vocabulary. Pure.
 *
 * ## The provider's own endpoint, measured from Claude Code's binary
 *
 * Claude Code 2.1.284 reads the reset offer with `GET /api/oauth/usage?cedar_ember=1&skip_spend=1` and claims one
 * with `POST /api/organizations/<org>/reset_rate_limits` (`./resetClaim.ts`), both on its first-party API client,
 * which sends `Authorization: Bearer <OAuth access token>` and the OAuth `anthropic-beta` header. Both need the
 * `user:profile` scope: an inference-only setup token is answered `403 oauth_scope_insufficient`.
 * Reproduce with
 * `strings ~/.local/share/claude/versions/2.1.284 | grep -F -e cedar_ember -e reset_rate_limits`.
 *
 * The gauge deliberately does NOT read this endpoint (`./gaugeProbe.ts`): its budget is shared with every `/usage`
 * on the machine and answered `429` with `retry-after: 3568` on a first call. That is why a throttled status read
 * here DEFERS the verb (exit 4) instead of failing it, and why nothing retries it in a loop.
 *
 * ## Strict, where the binary is tolerant
 *
 * The binary drops a malformed grant and keeps the rest. This reader refuses the whole answer instead, naming
 * the field, through `#lib/boundary.js`: a provider that renames
 * `resets_left` would otherwise read as a plan with no resets, and a reset spent on that misreading is not
 * recoverable. Every key the body carries is declared, the ones this module does not read as `z.unknown()`, so
 * a key the provider adds is loud at any depth, and one it drops is loud wherever this module reads it. An absent `cedar_ember` key is its own error, never read
 * as "not eligible". Whether the time fields are ISO strings or epoch seconds is unmeasured, so both are accepted
 * and a number goes through `epochSecondsToIso`.
 */
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";
import { epochSecondsToIso } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { type ClaudeResetError, ClaudeResetErrors } from "./resetErrors.js";
import { USAGE_SIBLINGS, unread } from "./usageWire.js";

/** Where the reset status is read — the same query Claude Code's own reset offer sends. */
export const RESET_STATUS_URL = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1";

/** The beta Claude Code's first-party client attaches to every OAuth-authenticated account call. */
const OAUTH_BETA = "oauth-2025-04-20";

/**
 * The headers both reset calls carry, as Claude Code's own API client sends them.
 *
 * @param accessToken the login's OAuth access token — passed straight through, never stored or logged
 * @returns the request headers
 */
export function resetHeaders({ accessToken }: { accessToken: string }): Readonly<Record<string, string>> {
  return {
    "anthropic-beta": OAUTH_BETA,
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "user-agent": "claude-cli/2.1.284 (external, cli)",
  };
}

/** A time field as the provider may send it — unmeasured whether ISO text or epoch seconds, so both. */
const timeWire = z.union([z.string(), z.number()]).nullable().optional();

// `arm` and `percent_used` ride on every grant and `event_props` on the block, each declared `unread` — the
// previous plain `z.object` read had dropped all three without a word, which is what the first strict live read named.
const grantWire = z.strictObject({
  arm: unread,
  blocking: z.array(z.string()).optional(),
  clears: z.array(z.string()).default([]),
  ends_at: timeWire,
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  label: z.string().optional(),
  paused: z.boolean().optional(),
  percent_used: unread,
  resets_left: z.number().int().min(0),
  resets_total: z.number().int().min(0).optional(),
  starts_at: timeWire,
  usable_now: z.boolean().optional(),
  use_requires_limit: z.boolean().optional(),
});

const blockWire = z.strictObject({
  at_limit: z.boolean().optional(),
  cooldown_until: timeWire,
  eligible: z.boolean(),
  event_props: unread,
  // A list the provider omits is an empty one — no window exhausted, no grant held — stated at the read, once.
  exhausted: z.array(z.string()).default([]),
  grants: z.array(grantWire).default([]),
  ineligible_reason: z.string().nullable().optional(),
  next_grant_id: z.string().nullable().optional(),
  // MEASURED: live answers carry it (`slopweaver claude reset --plan <alias>` named it as new), while
  // Claude Code 2.1.317 holds no such string (`strings ~/.local/share/claude/versions/2.1.317 | grep -F paused_held`
  // prints nothing). Its meaning is unmeasured, so nothing here reads it.
  paused_held: unread,
  weekly_resets_at: timeWire,
});

/**
 * The whole `/api/oauth/usage` answer. Only `cedar_ember` is read here; every sibling is declared, not read — the
 * budgets are the gauge's, read from headers (`./gaugeProbe.ts`), and `extra_usage` is `claude spend`'s
 * (`./spendStatus.ts`). MEASURED by the first strict read, which named each sibling as a new field;
 * the list is shared with that reader in `./usageWire.ts`.
 */
const usageWire = z.strictObject({
  ...USAGE_SIBLINGS,
  cedar_ember: blockWire.nullable().optional(),
  extra_usage: unread,
});

const USAGE_STATUS = defineBoundary({ endpoint: "GET /api/oauth/usage?cedar_ember=1", schema: usageWire });

/** One free reset grant the plan holds. */
export interface ClaudeResetGrant {
  readonly id: string;
  /** The provider's own label for the grant, when it sent one. */
  readonly label?: string;
  readonly resetsLeft: number;
  readonly resetsTotal?: number;
  readonly startsAtIso?: string;
  readonly endsAtIso?: string;
  /** The windows a claim of this grant clears. */
  readonly clears: readonly string[];
  readonly paused: boolean;
  readonly usableNow: boolean;
  /** Whether the provider only honours a claim while a window is at its limit — absent reads as true. */
  readonly useRequiresLimit: boolean;
}

/** The plan's reset state, as the `cedar_ember` block reports it. */
export interface ClaudeResetBlock {
  readonly eligible: boolean;
  readonly ineligibleReason?: string;
  readonly atLimit: boolean;
  /** The windows the provider reports exhausted. */
  readonly exhausted: readonly string[];
  readonly grants: readonly ClaudeResetGrant[];
  /** The grant the provider would spend next — kept only when it is one of {@link grants}. */
  readonly nextGrantId?: string;
  readonly weeklyResetsAtIso?: string;
  readonly cooldownUntilIso?: string;
}

/** A read status. */
export interface ClaudeResetStatus {
  readonly block: ClaudeResetBlock;
}

/** A time field as an ISO instant, or undefined when absent or unrepresentable. */
function isoOf({ value }: { value: string | number | null | undefined }): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return epochSecondsToIso({ seconds: value });
  }
  return value;
}

/** One wire grant read into the repository's shape. */
function grantOf({ wire }: { wire: z.infer<typeof grantWire> }): ClaudeResetGrant {
  const startsAtIso = isoOf({ value: wire.starts_at });
  const endsAtIso = isoOf({ value: wire.ends_at });
  return {
    clears: wire.clears,
    id: wire.id,
    paused: wire.paused === true,
    resetsLeft: wire.resets_left,
    usableNow: wire.usable_now === true,
    useRequiresLimit: wire.use_requires_limit !== false,
    ...(wire.label === undefined ? {} : { label: wire.label }),
    ...(wire.resets_total === undefined ? {} : { resetsTotal: wire.resets_total }),
    ...(startsAtIso === undefined ? {} : { startsAtIso }),
    ...(endsAtIso === undefined ? {} : { endsAtIso }),
  };
}

/**
 * Read the reset status out of a usage answer's body.
 *
 * @param bodyText the answer's body, as text
 * @returns the block, or why there is no block this version can read — a drifted field named
 */
export function parseResetStatus({ bodyText }: { bodyText: string }): Result<ClaudeResetStatus, ClaudeResetError> {
  const parsed = USAGE_STATUS.parseJson({ text: bodyText });
  if (parsed.isErr()) {
    return err(ClaudeResetErrors.statusUnreadable({ detail: parsed.error.message }));
  }
  const wire = parsed.value.cedar_ember;
  if (wire === undefined || wire === null) {
    return err(ClaudeResetErrors.resetBlockAbsent());
  }
  const grants = wire.grants.map((entry) => grantOf({ wire: entry }));
  const nextId = wire.next_grant_id;
  const nextGrantId = typeof nextId === "string" && grants.some((grant) => grant.id === nextId) ? nextId : undefined;
  const ineligibleReason = wire.ineligible_reason;
  const weeklyResetsAtIso = isoOf({ value: wire.weekly_resets_at });
  const cooldownUntilIso = isoOf({ value: wire.cooldown_until });
  const block: ClaudeResetBlock = {
    atLimit: wire.at_limit === true,
    eligible: wire.eligible,
    exhausted: wire.exhausted,
    grants,
    ...(ineligibleReason == null ? {} : { ineligibleReason }),
    ...(nextGrantId === undefined ? {} : { nextGrantId }),
    ...(weeklyResetsAtIso === undefined ? {} : { weeklyResetsAtIso }),
    ...(cooldownUntilIso === undefined ? {} : { cooldownUntilIso }),
  };
  return ok({ block });
}
