/**
 * Which OAuth login `slopweaver claude reset` may present for a plan, proven to be that plan's before anything is read
 * or claimed on it.
 *
 * ## Two candidates, and why the default slot is only the second
 *
 * The free-reset endpoints need a `user:profile` login, and a plan's setup token has none. Two places can hold one:
 *
 * 1. **The plan's own store** — the lasting home. Seats boot on setup tokens against unbound stores
 *    (`./seatToken.ts`), and the gauge probes a plan's setup token FIRST whenever it has one (`./probeStore.ts`), so
 *    a login signed into the plan's own store with `slopweaver claude signin --plan <alias>` is read by nothing but
 *    this verb and the keep-alive that refreshes it. Five of them coexist.
 * 2. **The default keychain slot** — a bridge. The owner's normal `claude` login lands here (measured: a
 *    sign-in as claude-five left plan-five's own store signed out and the default slot holding claude-five). One
 *    slot holds one login, and nothing in the fleet refreshes it — the owner's own sessions do.
 *
 * Neither is trusted by where it sits or by the address it caches (`claude-email-not-identity`): a candidate counts
 * only when one gauge probe over it names the organisation ENROLLED for the plan (`assessIdentity` → `match`). A
 * probe that names no organisation fails closed rather than guessing. Nothing here refreshes a login or writes the
 * keychain; an expired one is refused with the fix named.
 *
 * ## The token never leaves a closure
 *
 * The chosen login comes back as a function that hands its access token to one caller-supplied request, so no
 * returned or rendered value carries it.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import {
  credentialExpiryIso,
  credentialHasAccessToken,
  credentialHasScope,
  readClaudeCredential,
} from "./credentialDocument.js";
import { assessIdentity, type ClaudeIdentityAssertion } from "./identityAssertions.js";
import { type ClaudeResetError, ClaudeResetErrors } from "./resetErrors.js";

/** The scope both reset endpoints require. */
const PROFILE_SCOPE = "user:profile";

/** Where a candidate login sits. */
export type ResetLoginSource = "store" | "default-slot";

/** What the static checks see of one candidate, before any request is spent on it. */
export interface ResetCandidateFacts {
  readonly source: ResetLoginSource;
  readonly hasAccessToken: boolean;
  readonly hasProfileScope: boolean;
  readonly expiresAtIso?: string;
}

/** What one probe of a candidate learned. */
export type ResetProbeOutcome =
  { readonly status: number; readonly organizationId?: string } | { readonly failed: "network" };

/** The login a reset call presents, holding its token in a closure. */
export interface ResetLogin {
  readonly source: ResetLoginSource;
  /** Hand the access token to one request, and return what it returns. */
  readonly withBearer: <T>(use: (options: { accessToken: string }) => Promise<T>) => Promise<T>;
}

/** The two effects {@link resolveResetLogin} performs, injectable so its decisions are unit-testable. */
export interface ResetLoginDeps {
  /** Read one keychain document — `{ storeDir }` for the plan's store, `{}` for the default slot. */
  readonly read: (options: { storeDir?: string }) => unknown;
  /** Send the one gauge probe over an access token. */
  readonly probe: (options: { accessToken: string }) => Promise<ResetProbeOutcome>;
}

/** How a candidate is named in a reason line. */
function sourceName({ source }: { source: ResetLoginSource }): string {
  return source === "store" ? "its own store" : "the default slot";
}

/**
 * Why a candidate cannot be presented, judged without a request, or undefined when it may be probed. Pure.
 *
 * @param facts what the candidate's credential shows
 * @param nowIso the instant to judge expiry against
 * @returns the reason line, or undefined
 */
export function candidateStaticReason({
  facts,
  nowIso,
}: {
  facts: ResetCandidateFacts;
  nowIso: string;
}): string | undefined {
  const where = sourceName({ source: facts.source });
  if (!facts.hasAccessToken) {
    return `${where} holds no login`;
  }
  if (!facts.hasProfileScope) {
    return `${where}'s login lacks the ${PROFILE_SCOPE} scope`;
  }
  const expires = facts.expiresAtIso;
  if (expires !== undefined && Date.parse(expires) <= Date.parse(nowIso)) {
    return `${where}'s login expired at ${expires}; a Claude Code session on it refreshes it`;
  }
  return undefined;
}

/**
 * What one probe proves about a candidate. Pure.
 *
 * @param alias the plan being claimed on
 * @param assertion the plan's standing enrollment
 * @param outcome what the probe learned
 * @param source where the candidate sits
 * @returns `bound` when it is the plan's account, `unestablished` when the probe named none, else the reason
 */
export function bindingVerdict({
  alias,
  assertion,
  outcome,
  source,
}: {
  alias: string;
  assertion: ClaudeIdentityAssertion;
  outcome: ResetProbeOutcome;
  source: ResetLoginSource;
}):
  | { readonly kind: "bound" }
  | { readonly kind: "unestablished" }
  | { readonly kind: "rejected"; readonly reason: string } {
  const where = sourceName({ source });
  if ("failed" in outcome) {
    return { kind: "rejected", reason: `the probe over ${where} failed on the network` };
  }
  if (outcome.status === 401) {
    return { kind: "rejected", reason: `${where}'s login was refused (401)` };
  }
  const identity = assessIdentity({
    alias,
    assertion,
    ...(outcome.organizationId === undefined ? {} : { observedOrganizationId: outcome.organizationId }),
  });
  if (identity.kind === "match") {
    return { kind: "bound" };
  }
  if (identity.kind === "unobserved") {
    return { kind: "unestablished" };
  }
  return { kind: "rejected", reason: `${where}'s login belongs to a different account from ${alias}'s` };
}

/** One candidate's credential, read once: its facts, and the token kept for the closure. */
function readCandidate({
  deps,
  source,
  storeDir,
}: {
  deps: ResetLoginDeps;
  source: ResetLoginSource;
  storeDir: string;
}): { readonly facts: ResetCandidateFacts; readonly accessToken: string } {
  const document = source === "store" ? deps.read({ storeDir }) : deps.read({});
  const slice = readClaudeCredential({ document });
  const credential = slice?.credential;
  const expiresAtIso = credentialExpiryIso({ slice });
  return {
    accessToken: isRecord(credential) && typeof credential["accessToken"] === "string" ? credential["accessToken"] : "",
    facts: {
      hasAccessToken: credentialHasAccessToken({ slice }),
      hasProfileScope: credentialHasScope({ scope: PROFILE_SCOPE, slice }),
      source,
      ...(expiresAtIso === undefined ? {} : { expiresAtIso }),
    },
  };
}

/**
 * The login to present for a plan: its own store first, then the default slot, each probed only once its static
 * checks pass, and chosen only when the probe binds it to the plan's enrolled organisation.
 *
 * @param alias the plan being claimed on
 * @param assertion the plan's standing enrollment
 * @param deps the keychain read and the probe
 * @param nowIso the instant to judge expiry against
 * @param storeDir the plan's own store directory
 * @returns the bound login, or why none qualifies
 */
export async function resolveResetLogin({
  alias,
  assertion,
  deps,
  nowIso,
  storeDir,
}: {
  alias: string;
  assertion: ClaudeIdentityAssertion;
  deps: ResetLoginDeps;
  nowIso: string;
  storeDir: string;
}): Promise<Result<ResetLogin, ClaudeResetError>> {
  const reasons: string[] = [];
  let unestablished = false;
  for (const source of ["store", "default-slot"] as const) {
    const { accessToken, facts } = readCandidate({ deps, source, storeDir });
    const staticReason = candidateStaticReason({ facts, nowIso });
    if (staticReason !== undefined) {
      reasons.push(staticReason);
      continue;
    }
    const verdict = bindingVerdict({ alias, assertion, outcome: await deps.probe({ accessToken }), source });
    if (verdict.kind === "bound") {
      return ok({ source, withBearer: (use) => use({ accessToken }) });
    }
    if (verdict.kind === "unestablished") {
      unestablished = true;
      reasons.push(`the probe over ${sourceName({ source })} named no organisation`);
      continue;
    }
    reasons.push(verdict.reason);
  }
  if (unestablished) {
    return err(ClaudeResetErrors.bindingUnestablished({ alias }));
  }
  return err(ClaudeResetErrors.noQualifyingLogin({ alias, reasons }));
}
