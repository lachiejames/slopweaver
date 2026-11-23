/**
 * What ONE PAGE may be driven to do — the register's rows, tightened by any rule on a page inside one.
 *
 * Its own file rather than another function in `./browserSurface.ts` because it answers a different
 * question. That module holds the register and says which platform an address belongs to; this one decides
 * what any lane at all may do to that address, and it is what `src/browser/action.ts` asks before every
 * interaction the Playwright verbs perform.
 *
 * **It mints no second register, and that is a constraint rather than a nicety.** `WRITE_POLICY_REGISTER` is already the per-page write-policy data, so
 * the per-page read-only rail extends THAT rather than standing a rival list beside it. Everything
 * here reads {@link classifyBrowserUrl}'s answer; the rows, and the decision about who is on them, stay
 * exactly where they were.
 */
import { type BrowserWritePolicy, classifyBrowserUrl, UNREGISTERED_WRITE_POLICY } from "./browserSurface.js";

/**
 * One page inside a registered platform that is stricter than the platform's own row.
 *
 * The match vocabulary is deliberately two words rather than a glob grammar. `exact` is one pathname;
 * `subtree` is that pathname and everything under it, on a SEGMENT boundary — so `/settings` covers
 * `/settings` and `/settings/members` and never `/settings-export`. Query and fragment are not read at all,
 * which is the conservative direction: a rule that ignored them could not be escaped by adding one, whereas
 * a rule that read them could be. A platform that routes in its hash needs a new match arm, stated here
 * rather than discovered by someone whose click went through.
 *
 * @internal — a field type of {@link RegisteredPlatform}; callers read the resolved policy, never a rule.
 */
export interface BrowserPageRestriction {
  /** Stable id the refusal and its waiver both name, so a journal row can be counted. */
  readonly id: string;
  /** The origin this rule is about, exactly as `new URL(...).origin` spells it. */
  readonly origin: string;
  /** The pathname this rule is about, leading slash, no trailing one. */
  readonly path: string;
  readonly match: "exact" | "subtree";
  /** Always the refusing arm: a page rule tightens, never loosens. */
  readonly policy: "refuse-every-write";
  /** Whose decision this is, so a later reader does not have to guess. */
  readonly authority: string;
}

/**
 * What a page may be driven to do, resolved: the platform's own row, tightened by any page rule that covers
 * the exact address.
 *
 * The one resolver every lane asks, so there is ONE register. The per-page
 * read-only rail extends
 * {@link WRITE_POLICY_REGISTER} rather than mint a second permission list beside it, and this is the seam
 * that satisfies both — the rows stay where they are, and a page rule is a field on one of them.
 *
 * `provider` is `null` for a host the register does not name, and the policy is then
 * {@link UNREGISTERED_WRITE_POLICY}. That is a decision rather than a silence, and it is the standing
 * ruling's own default.
 */
export interface ResolvedBrowserPolicy {
  /** The platform's name, or `null` when the host belongs to no registered platform. */
  readonly provider: string | null;
  /** What the refusal tells the caller to use instead, or `null` when no verb family replaces this web app. */
  readonly door: string | null;
  /** The effective policy after any page rule has tightened the row. */
  readonly policy: BrowserWritePolicy;
  /** Which page rule decided it, or `null` when the platform's own row did. */
  readonly pageRuleId: string | null;
  /** Whose decision the page rule was, or `null` when no page rule applied. */
  readonly pageRuleAuthority: string | null;
}

/**
 * Whether one page restriction covers one parsed address.
 *
 * Matched on the canonical origin and pathname, so a credentials-in-URL spelling, a default port and a
 * case-different host all reduce to the same thing before anything is compared. A `subtree` match requires a
 * SEGMENT boundary — the rule's own path, or that path followed by `/` — which is what stops `/settings`
 * covering `/settings-export`.
 *
 * @param restriction the rule to test
 * @param url the address, already parsed
 * @returns true when the rule covers that page
 * @internal — exported for the unit test that drives it directly. No register row declares
 * `pageRestrictions` yet (JumpCloud refuses at the HOST level), so the resolver cannot reach this matcher
 * with the register as it stands, and the segment-boundary rule it implements is the half worth proving.
 */
export function restrictionCoversUrl({ restriction, url }: { restriction: BrowserPageRestriction; url: URL }): boolean {
  if (url.origin !== restriction.origin) {
    return false;
  }
  const path = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  if (restriction.match === "exact") {
    return path === restriction.path;
  }
  return path === restriction.path || path.startsWith(`${restriction.path}/`);
}

/**
 * Resolve what one address may be driven to do — the platform row, tightened by any page rule on it.
 *
 * Pure, and the ONE question every browser lane asks before it acts. A URL that will not parse as an
 * absolute `http`/`https` address resolves to the unregistered refusing default rather than to an error:
 * this is a policy resolver, and "I cannot tell what this is" has exactly one safe answer.
 *
 * @param url the address the action is aimed at
 * @returns the effective policy, and which rule decided it
 */
export function resolveBrowserPagePolicy({ url }: { url: string }): ResolvedBrowserPolicy {
  const platform = classifyBrowserUrl({ url });
  if (platform === undefined) {
    return {
      door: null,
      pageRuleAuthority: null,
      pageRuleId: null,
      policy: UNREGISTERED_WRITE_POLICY,
      provider: null,
    };
  }
  const row = {
    door: platform.door,
    pageRuleAuthority: null,
    pageRuleId: null,
    policy: platform.policy,
    provider: platform.provider,
  } as const;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return row;
  }
  const restrictions = platform.pageRestrictions;
  if (restrictions === undefined) {
    return row;
  }
  // The most specific match wins ATTRIBUTION, not the decision: every arm of a restriction is
  // `refuse-every-write`, so any match at all produces the same policy and only the id differs. Longest
  // path first, so a rule on `/settings/billing` names itself rather than its parent.
  const matched = restrictions
    .filter((restriction) => restrictionCoversUrl({ restriction, url: parsed }))
    .toSorted((a, b) => b.path.length - a.path.length)[0];
  if (matched === undefined) {
    return row;
  }
  return {
    door: platform.door,
    pageRuleAuthority: matched.authority,
    pageRuleId: matched.id,
    policy: matched.policy,
    provider: platform.provider,
  };
}
