/**
 * Which ACCOUNT each credential store belongs to, and therefore which plan the active slot is checked out
 * from. Pure: the caller does the probing, this decides what the readings mean.
 *
 * ## Why this file exists at all
 *
 * `watchTick.ts` could not name the fleet's active plan, so it refused to touch any store — and with every
 * store held back, three of them expired on their own and the keep-alive loop that exists to prevent exactly
 * that became inert. Both of its existing answers are structurally weak:
 *
 * - **The byte comparison is true for an instant.** A swap copies a store's credential into the active slot,
 *   so the two match — until the active slot refreshes, which mints a new token pair and leaves the store
 *   holding the old one. MEASURED: the active slot read 4.3 hours of life while all three stores
 *   had expired, and no store shared its bytes.
 * - **The recorded alias is absent on a fresh install** and nothing wrote it, which is the defect this file
 *   is landed to close.
 *
 * ## The identity the provider hands back for free
 *
 * MEASURED: every ordinary `POST /v1/messages` response carries an `anthropic-organization-id`
 * header naming the organisation the presented credential belongs to. The gauge probe already makes that
 * request once per plan per tick, so an exact, provider-authoritative account identity costs no extra call,
 * no second endpoint, and cannot be throttled out of existence the way `/api/oauth/usage` was. Reproduce:
 *
 * ```sh
 * slopweaver claude watch --once --dry-run --json   # the same probe, one per configured store
 * ```
 *
 * Unlike the two weak answers, this one SURVIVES A REFRESH: the organisation does not change when the token
 * does. That is what turns "which plan is active" from a memory into a fact.
 *
 * The earlier design note reached for `GET /api/oauth/profile` instead. That is a second request against an
 * endpoint whose budget is shared with every Claude Code session on the machine; this needs neither.
 *
 * ## An organisation id NEVER leaves this machine's home directory
 *
 * It is a private identifier, so nothing here may be rendered. Every other `src/claude/*` type is safe to
 * print into an event, a sidebar row or a log line; the values in this one are not, which is why they live
 * in their own module rather than as fields on {@link import("./rotationState.js").ClaudeRotationState}.
 * A reader of that file gets a shape it can print; a reader of this one is being told, by the import it had
 * to write, that it is holding something it may not. The one thing callers pass outward is the ALIAS this
 * file resolves — the neutral local label the rest of the feature already speaks in.
 */
import { isRecord } from "../lib/parsers.js";
import type { ClaudeAccountAlias } from "./contracts.js";

/**
 * One store's account, as the provider named it.
 *
 * @internal — an element of the record {@link parseStoreIdentities} returns; callers thread it through this
 *   file's reducers rather than constructing one.
 */
export interface ClaudeStoreIdentity {
  readonly alias: ClaudeAccountAlias;
  /** The organisation the store's credential belongs to. A private identifier — never rendered, ever. */
  readonly organizationId: string;
  /** When the provider last confirmed it, ISO-8601. */
  readonly observedAtIso: string;
}

/**
 * Read the stored identities, tolerating anything unrecognisable.
 *
 * Deliberately tolerant, like every other reader in this feature: a corrupt file means the loop forgets which
 * account each store holds, and the very next tick's probes re-learn it. Refusing to parse would instead stop
 * the loop that keeps the credentials alive, which is the outage this module exists to prevent.
 *
 * @param value the decoded contents of the record file, or undefined when there is none
 * @returns every usable identity, empty when nothing was stored
 */
export function parseStoreIdentities({ value }: { value: unknown }): readonly ClaudeStoreIdentity[] {
  if (!isRecord(value) || !Array.isArray(value["identities"])) {
    return [];
  }
  return value["identities"].flatMap((entry): readonly ClaudeStoreIdentity[] => {
    if (
      !isRecord(entry) ||
      typeof entry["alias"] !== "string" ||
      typeof entry["organizationId"] !== "string" ||
      typeof entry["observedAtIso"] !== "string"
    ) {
      return [];
    }
    return [{ alias: entry["alias"], observedAtIso: entry["observedAtIso"], organizationId: entry["organizationId"] }];
  });
}

/**
 * Record the account one store was just observed to hold, replacing any entry already standing for it.
 *
 * The newest observation always wins. A store the owner signs into as a different account is a legitimate
 * thing to do, and a record that preferred its own older belief would then name the wrong account forever.
 *
 * @param alias the store that was probed
 * @param identities what was known before
 * @param observedAtIso when the provider confirmed it, ISO-8601 — injected, never read from a hidden clock
 * @param organizationId the organisation the provider named
 * @returns the records with this store's entry replaced
 */
export function recordStoreIdentity({
  alias,
  identities,
  observedAtIso,
  organizationId,
}: {
  alias: ClaudeAccountAlias;
  identities: readonly ClaudeStoreIdentity[];
  observedAtIso: string;
  organizationId: string;
}): readonly ClaudeStoreIdentity[] {
  return [...identities.filter((entry) => entry.alias !== alias), { alias, observedAtIso, organizationId }];
}

/**
 * Which configured plan an organisation belongs to.
 *
 * Ambiguity is never resolved by picking. Two stores recorded against one organisation means the owner signed
 * the same account into two of them, and guessing between them would put the fleet's whole keep-alive guard
 * on a coin toss — so this answers nothing and the caller falls back, exactly as it does when no store
 * matches at all.
 *
 * @param identities every store's recorded account — an observed identity or a standing enrollment assertion
 * @param organizationId the organisation to resolve
 * @returns the single alias holding that account, or undefined when none or several do
 */
export function aliasForOrganization({
  identities,
  organizationId,
}: {
  identities: readonly Pick<ClaudeStoreIdentity, "alias" | "organizationId">[];
  organizationId: string;
}): ClaudeAccountAlias | undefined {
  const matches = identities.filter((entry) => entry.organizationId === organizationId);
  return matches.length === 1 ? matches[0]!.alias : undefined;
}

/**
 * The organisation one store is recorded as holding.
 *
 * This was the value the retired check-in compared against the ACTIVE credential's own organisation before it wrote
 * anything back, so that a hand `/login` — which replaces the active slot without any rotation — is caught
 * rather than followed into destroying a good store.
 *
 * @param alias the store to look up
 * @param identities every store's recorded account
 * @returns the organisation, or undefined when this store has never been identified
 */
export function organizationForAlias({
  alias,
  identities,
}: {
  alias: ClaudeAccountAlias;
  identities: readonly ClaudeStoreIdentity[];
}): string | undefined {
  return identities.find((entry) => entry.alias === alias)?.organizationId;
}

/**
 * The one configured store that could not be identified, when exactly one could not be.
 *
 * ## Why elimination is needed at all, and why it is sound
 *
 * The account identity answers everything EXCEPT the case the owner is actually in. The active plan's own
 * store is precisely the one that cannot answer a probe: a swap left it holding the credential the active
 * slot has since refreshed past, so it reads `401` while the fleet runs happily on the descendant of that
 * very token. MEASURED on one machine — the active slot answered `200` with 4.3 hours of life,
 * plan-two and plan-three answered `200` under two different organisations, and plan-one answered `401`.
 * Identity alone therefore names nothing, and the loop goes on touching nothing, which is the standstill.
 *
 * So: if every store but one has been identified, and none of them holds the active credential's account,
 * the active credential belongs to the remaining one.
 *
 * The deduction rests on the active slot holding a checkout of a CONFIGURED plan. That can be false — a hand
 * `/login` to an account outside the fleet breaks it — and the cost when it is false is the point: the loop
 * skips one store that did not need skipping. That is the same cost as today's blanket refusal, narrowed
 * from every store to one, so a wrong deduction can never be worse than making none. It fails safe by
 * direction, which is what makes it a deduction worth acting on rather than a guess.
 *
 * @param aliases every configured plan's alias, in configured order
 * @param identities every store's recorded account
 * @returns the sole unidentified alias, or undefined when none or several are unidentified
 */
export function soleUnidentifiedAlias({
  aliases,
  identities,
}: {
  aliases: readonly ClaudeAccountAlias[];
  identities: readonly ClaudeStoreIdentity[];
}): ClaudeAccountAlias | undefined {
  const unidentified = aliases.filter((alias) => organizationForAlias({ alias, identities }) === undefined);
  return unidentified.length === 1 ? unidentified[0]! : undefined;
}
