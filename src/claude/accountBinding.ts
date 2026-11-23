/**
 * WHICH ACCOUNT a store holds, as a thing a surface may print — decided once, rendered twice. Pure: the
 * caller probes and reads files, this decides what an address is worth.
 *
 * ## The confusion this closes
 *
 * A launch was held on a drifted email field, so the rule is that an email can never be confused with the
 * account it belongs to.
 *
 * Two independent strings named a plan's account, and only one of them was ever printed:
 *
 * - `accounts.json`'s `email` — hand-typed config, which a `/login` does not touch.
 * - the OAuth token actually in the store, identified by the `anthropic-organization-id` header the gauge
 *   probe already reads on every pass (`gaugeProbe.ts`).
 *
 * MEASURED: `gaugeRender.ts` built its whole account column from the first
 * (`accounts.find(...)?.email`) while `run.ts` called `probePlan`, received the second, and dropped it; and
 * `signinPlan.ts` computed an identity verdict from the second yet set the row's rendered name from the
 * first, so a `wrong-account` row printed the stale address AS ITS NAME and contradicted itself two columns
 * later. A reader scans the name.
 *
 * ## An address is only ever worth what BOUND it
 *
 * The join does not exist at render time and cannot be made there — no query maps an address to an
 * organisation id. It exists at the enrollment, the one instant a human names a store, a live token and an
 * address together ({@link ClaudeIdentityAssertion.email}). So this module's whole job is to say which of
 * the two strings, if either, a surface has earned the right to call "the account", and to make the
 * unearned cases say so rather than read blank.
 *
 * `accounts.json`'s address is therefore a **display cache**: it may be shown, labelled as unverified, and
 * it may never drive what a surface calls the account. `claude-email-not-identity` in `yarn lint` keeps it
 * that way for code not yet written.
 *
 * ## One decider, two renderers
 *
 * The gauge and the sign-in walk must never disagree about what an address means, and the only way two
 * surfaces never disagree is for neither to decide — the same split `signinPlan.ts`/`signinRender.ts`
 * already runs on. {@link accountCell} decides; {@link renderAccountCell} and `config.ts`'s `planLabel`
 * render.
 *
 * Nothing here can hold an organisation id: {@link ClaudeAccountCell} has no field for one, and the verdict
 * it is built from ({@link ClaudeIdentityStatus}) carries none in any variant.
 */
import type { ClaudeAccount } from "./contracts.js";
import {
  assertionFor,
  assessIdentity,
  type ClaudeIdentityAssertion,
  type ClaudeIdentityStatus,
} from "./identityAssertions.js";

/**
 * What a surface may say about one store's account.
 *
 * A UNION rather than a record with an optional address, and that is the mechanism rather than a style: the
 * four trusts that have earned no address **have no field one could be put in**, so a renderer cannot print
 * one by forgetting a flag. A type that cannot hold the value is stronger than a reviewer remembering to
 * check for it — the same argument `ClaudeIdentityStatus` makes about organisation ids.
 *
 * The split that matters is between the two trusts that may PRINT an address as the account and the five
 * that may not. A reader who cannot tell those apart at a glance is the reader whose launch was held.
 */
export type ClaudeAccountCell =
  /** The token matches the enrollment, and that enrollment bound this address. The healthy case. */
  | { readonly trust: "bound"; readonly address: string }
  /** As `bound`, but `accounts.json` now disagrees — the cache has drifted and the binding has not. */
  | { readonly trust: "bound-cache-stale"; readonly address: string; readonly staleCache: string }
  /** An account is bound but no address was recorded with it; `accounts.json`'s string is unverified. */
  | { readonly trust: "cached"; readonly address: string }
  /** No address anywhere: nothing bound one and `accounts.json` maps none. */
  | { readonly trust: "unmapped" }
  /** The token is NOT the enrolled account, so no address for this store can be trusted at all. */
  | { readonly trust: "wrong-account" }
  /** Nothing has been enrolled for this store, so nothing bound an address to it. */
  | { readonly trust: "unenrolled" }
  /** The store could not be read this pass, so no address is token-derived right now. */
  | { readonly trust: "unread" };

/** How much an address on one store is worth — the discriminant of {@link ClaudeAccountCell}. */
export type ClaudeAccountTrust = ClaudeAccountCell["trust"];

/**
 * Decide what one store's account may be called, from the token's verdict and the two candidate addresses.
 *
 * @param cachedEmail what `accounts.json` maps for this plan — the display cache, never identity
 * @param enrolledEmail the address the standing enrollment bound to this store's account
 * @param status what comparing the live token against that enrollment concluded
 * @returns the cell, carrying an address only on a trust that earned one
 */
export function accountCell({
  cachedEmail,
  enrolledEmail,
  status,
}: {
  cachedEmail?: string;
  enrolledEmail?: string;
  status: ClaudeIdentityStatus;
}): ClaudeAccountCell {
  if (status.kind === "changed") {
    return { trust: "wrong-account" };
  }
  if (status.kind === "unbound") {
    return { trust: "unenrolled" };
  }
  if (status.kind === "unobserved") {
    return { trust: "unread" };
  }
  if (enrolledEmail === undefined) {
    if (cachedEmail === undefined) {
      return { trust: "unmapped" };
    }
    return { address: cachedEmail, trust: "cached" };
  }
  if (cachedEmail === undefined || cachedEmail === enrolledEmail) {
    return { address: enrolledEmail, trust: "bound" };
  }
  return { address: enrolledEmail, staleCache: cachedEmail, trust: "bound-cache-stale" };
}

/**
 * The cell for one plan a probe has just presented a token for — the join `claude gauge` and the capacity
 * reading both make, written once so the two surfaces cannot decide one store's account differently.
 *
 * The organisation id goes in and never comes out: it is compared against the standing enrollment and dropped.
 * A probe that named none reads `unread` (through `assessIdentity`'s `unobserved`), never the config's address.
 *
 * @param account the configured plan, whose `email` is consulted only as the display cache
 * @param assertions every standing enrollment
 * @param observedOrganizationId what the provider named this pass, absent when the probe saw no header
 * @returns the decided cell
 */
export function probedAccountCell({
  account,
  assertions,
  observedOrganizationId,
}: {
  account: ClaudeAccount;
  assertions: readonly ClaudeIdentityAssertion[];
  observedOrganizationId?: string;
}): ClaudeAccountCell {
  const assertion = assertionFor({ alias: account.alias, assertions });
  const status = assessIdentity({
    alias: account.alias,
    ...(assertion === undefined ? {} : { assertion }),
    ...(observedOrganizationId === undefined ? {} : { observedOrganizationId }),
  });
  return accountCell({
    status,
    ...(account.email === undefined ? {} : { cachedEmail: account.email }),
    ...(assertion?.email === undefined ? {} : { enrolledEmail: assertion.email }),
  });
}

/**
 * The cell a surface that has read no token may show — `accounts.json` alone, never dressed as the account.
 *
 * Every surface naming a plan goes through one label, and most of them (a rotation line, a watch report, a
 * usage refusal) hold config and nothing else. Before this they printed the cache bare, which is exactly the
 * sentence that reads as authoritative. They cannot print a token-derived answer they never read, so they
 * print the cache SAID TO BE a cache.
 *
 * @param cachedEmail what `accounts.json` maps for this plan
 * @returns the `cached` cell, or `unmapped` when nothing is configured
 */
export function cachedAccountCell({ cachedEmail }: { cachedEmail?: string }): ClaudeAccountCell {
  if (cachedEmail === undefined) {
    return { trust: "unmapped" };
  }
  return { address: cachedEmail, trust: "cached" };
}

/**
 * What a cell prints in a fixed-width account column, where no state tag sits beside it to carry the word.
 *
 * `bound` prints the bare address and nothing else, deliberately: the healthy fleet must read exactly as it
 * did before the binding existed, or a mechanism about honesty has cost the owner the affordance they asked
 * for, to buy a warning nobody wanted. Every other trust is loud by comparison because every other trust
 * is a thing the owner would want to know.
 *
 * `bound-cache-stale` prints the BOUND address first and names the cache second. Preferring the binding is
 * the whole point — `accounts.json` no longer drives what a surface calls the account — and printing the
 * disagreement rather than silently dropping it is what makes the drift findable.
 *
 * @param cell the decided cell
 * @returns the column text, never blank
 */
export function renderAccountCell({ cell }: { cell: ClaudeAccountCell }): string {
  switch (cell.trust) {
    case "bound":
      return cell.address;
    case "bound-cache-stale":
      return `${cell.address} (accounts.json says ${cell.staleCache})`;
    case "cached":
      return `CACHED ${cell.address}`;
    case "wrong-account":
      return "WRONG ACCOUNT";
    case "unenrolled":
      return "NOT ENROLLED";
    case "unread":
      return "UNREAD";
    case "unmapped":
      return "UNMAPPED";
    default: {
      const unreachable: never = cell;
      return String(unreachable);
    }
  }
}

/** An address a login pre-fills, and whether an enrollment bound it or only the display cache offers it. */
export interface LoginHint {
  readonly address: string;
  readonly source: "enrolled" | "cache";
}

/**
 * The address a login may PRE-FILL for one plan, and where it came from.
 *
 * Pre-filling is not reasoning about which account a store holds — the sign-in's own org-id check does that
 * after the login lands — so the configured cache may be offered when nothing better exists. But it is
 * offered SAID TO BE the cache: the enrolled address wins whenever one was bound, and a caller prints the
 * source so an unverified pre-fill never reads as a verified one.
 *
 * @param cachedEmail what `accounts.json` maps for this plan — the display cache
 * @param enrolledEmail the address the standing enrollment bound, when one did
 * @returns the address and its source, or undefined when neither string exists
 */
export function loginHintAddress({
  cachedEmail,
  enrolledEmail,
}: {
  cachedEmail?: string;
  enrolledEmail?: string;
}): LoginHint | undefined {
  if (enrolledEmail !== undefined) {
    return { address: enrolledEmail, source: "enrolled" };
  }
  if (cachedEmail !== undefined) {
    return { address: cachedEmail, source: "cache" };
  }
  return undefined;
}

/**
 * {@link loginHintAddress} for one configured plan, reading its enrolled address out of the enrollments.
 *
 * @param account the plan, whose `email` is the display cache
 * @param assertions every standing enrollment
 * @returns the address to pre-fill and its source, or undefined when the plan has neither
 */
export function loginHintFor({
  account,
  assertions,
}: {
  account: ClaudeAccount;
  assertions: readonly ClaudeIdentityAssertion[];
}): LoginHint | undefined {
  const enrolledEmail = assertionFor({ alias: account.alias, assertions })?.email;
  return loginHintAddress({
    ...(account.email === undefined ? {} : { cachedEmail: account.email }),
    ...(enrolledEmail === undefined ? {} : { enrolledEmail }),
  });
}

/**
 * Whether a surface may present this cell's address as the store's account, rather than as a cache or as
 * nothing at all.
 *
 * @param cell the decided cell
 * @returns true only for the two trusts an enrollment bound
 */
export function namesAnAccount({ cell }: { cell: ClaudeAccountCell }): boolean {
  return cell.trust === "bound" || cell.trust === "bound-cache-stale";
}
