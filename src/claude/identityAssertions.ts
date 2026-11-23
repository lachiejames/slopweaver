/**
 * Which account is SUPPOSED to be in each credential store, kept apart from which account was last seen in
 * it. Pure: the caller does the probing and the file I/O, this decides what the two readings mean together.
 *
 * ## The failure this closes, and why a second field would not have closed it
 *
 * `checkoutIdentity.ts`'s `recordStoreIdentity` is newest-observation-wins, and `watch`'s sweep feeds every
 * probe straight into it. So one field carries two incompatible roles at once: the ASSERTION (which account
 * belongs in this slot) and the OBSERVATION (which account was last seen in it). An unintended replacement is
 * therefore indistinguishable from an intended one, and after exactly one tick there is nothing left to
 * compare against — **the drift erases its own evidence.**
 *
 * MEASURED: plan-one's live `anthropic-organization-id` no longer matched the entry
 * recorded at enrollment, a later `/login` having replaced the account in place. Nothing
 * noticed, and the next sweep would have overwritten the only evidence that anything had changed.
 *
 * The fix is not a second field on the same record. It is a SEPARATE FILE WITH A SEPARATE WRITER: only an
 * explicit enrollment may write an assertion, and a routine probe may never touch one. A field a sweep can
 * write is a field a sweep will overwrite, whatever it is called.
 *
 * ## The observation is never persisted at all
 *
 * `probePlan` already returns `{ outcome, organizationId? }` with the private identity beside the renderable
 * reading, so the comparison happens in-process and only the VERDICT travels outward. That is what keeps an
 * organisation id — per-install state that no rendered document may carry — unreachable from any rendered
 * document, rather than merely absent from the ones anyone remembered to check.
 *
 * ## Never auto-bless the first account observed
 *
 * On an install that already has stores, today's first observation may already BE the replacement. So an
 * unbound store reports {@link ClaudeIdentityStatus}'s `unbound` and waits for an explicit enrollment; it
 * never quietly adopts whatever it happens to find. The rule: first run establishes, every
 * run after that checks.
 *
 * ## The enrollment is where an ADDRESS becomes a fact, and before this it never did
 *
 * Confusing which email belongs to which account must be impossible by construction; a launch was once held on
 * a drifted email field.
 *
 * MEASURED on one install: all five rows in `identity-assertions.json` carried an alias, an
 * organisation and an instant, and no address — while `accounts.json` carried an address for all five that
 * **nothing had ever checked against anything.** So `match` meant only "the token is the same account it was
 * at enrollment", and the address printed beside it was a hand-typed string that could have been wrong from
 * the first day and would still read green forever.
 *
 * The join therefore cannot be made at render time: there is no query that maps an address to an
 * organisation id. The header the probe reads is the only identity the provider hands back
 * (`gaugeProbe.ts`), and `GET /api/oauth/usage` is unusable here. The one instant at which a human
 * deliberately says "this store, this token, this address" **is the enrollment**, so that is where the
 * address is captured — {@link ClaudeIdentityAssertion.email}, written by the same explicit writer, at the
 * same instant, and never by a sweep.
 *
 * What that buys, stated exactly rather than overstated: the binding is dated, immutable except by a
 * deliberate re-enrollment, and **no longer re-driven by a file anyone can edit.** It does NOT prove the
 * provider agrees the token's account is that address; nothing available proves that. A re-enrollment
 * freezes whatever `accounts.json` said at that instant, so a config already wrong binds wrong — and that is
 * the residue, not a defect to be discovered later.
 *
 * ## An emailless row stays USABLE, and that is load-bearing
 *
 * Every row this install already holds has no address. Dropping those rows as malformed would read back as
 * `unbound` for every plan, which makes `claude watch` refuse to touch any store — the exact standstill
 * `checkoutIdentity.ts` was landed to end. So `email` is OPTIONAL on the record and an absent one is a
 * complete, valid enrollment that simply cannot name an address yet.
 */
import { pushInto } from "#lib/collections.js";
import { err, ok, type Result } from "#lib/result.js";
import { isRecord } from "../lib/parsers.js";
import { type ClaudeError, ClaudeErrors } from "./claudeErrors.js";
import type { ClaudeAccountAlias } from "./contracts.js";

/**
 * One store's asserted account: what the owner said belongs there.
 *
 * @internal — an element of what {@link parseIdentityAssertions} returns; callers thread it through this
 *   file's reducers rather than constructing one.
 */
export interface ClaudeIdentityAssertion {
  readonly alias: ClaudeAccountAlias;
  /** The organisation asserted for this store. A private identifier — never rendered, ever. */
  readonly organizationId: string;
  /**
   * The address bound to that organisation by this enrollment — an internal name, safe to render, and the
   * ONLY address any surface may call this store's account. Absent on a row enrolled before addresses were
   * captured, which is a complete enrollment that cannot name one yet.
   */
  readonly email?: string;
  /** When the assertion was established, ISO-8601. */
  readonly assertedAtIso: string;
}

/**
 * What comparing an assertion against a live observation concluded — the ONLY shape that may be rendered.
 *
 * Deliberately carries no organisation id in any variant. A type that cannot hold a private identifier
 * cannot leak one, which is a stronger guarantee than a reviewer remembering to strip it.
 */
export type ClaudeIdentityStatus =
  /** The live account is the asserted one. */
  | { readonly alias: ClaudeAccountAlias; readonly kind: "match"; readonly assertedAtIso: string }
  /** The live account is NOT the asserted one. A sign-in replaced this slot. */
  | { readonly alias: ClaudeAccountAlias; readonly kind: "changed"; readonly assertedAtIso: string }
  /** Nothing has been asserted for this store yet, so there is nothing to check against. */
  | { readonly alias: ClaudeAccountAlias; readonly kind: "unbound" }
  /** An assertion stands but the store could not be read this pass, so the check is owed rather than failed. */
  | { readonly alias: ClaudeAccountAlias; readonly kind: "unobserved"; readonly assertedAtIso: string };

/**
 * Read the stored assertions, tolerating anything unrecognisable.
 *
 * Tolerant on purpose, like every other reader in this feature: a corrupt file means the fleet has forgotten
 * what it asserted, which reports `unbound` and asks for an enrollment. Refusing to parse would instead stop
 * the loop that keeps every credential alive.
 *
 * @param value the decoded contents of the assertions file, or undefined when there is none
 * @returns every usable assertion, empty when nothing was stored
 */
export function parseIdentityAssertions({ value }: { value: unknown }): readonly ClaudeIdentityAssertion[] {
  if (!isRecord(value) || !Array.isArray(value["assertions"])) {
    return [];
  }
  return value["assertions"].flatMap((entry): readonly ClaudeIdentityAssertion[] => {
    if (
      !isRecord(entry) ||
      typeof entry["alias"] !== "string" ||
      typeof entry["organizationId"] !== "string" ||
      typeof entry["assertedAtIso"] !== "string"
    ) {
      return [];
    }
    // An ABSENT address is a valid enrollment (every row predating the binding has none); a PRESENT one that
    // is not a string is a malformed row, because a surface would go on to render it as this store's account.
    const email = entry["email"];
    if (email !== undefined && typeof email !== "string") {
      return [];
    }
    return [
      {
        alias: entry["alias"],
        assertedAtIso: entry["assertedAtIso"],
        organizationId: entry["organizationId"],
        ...(email === undefined ? {} : { email }),
      },
    ];
  });
}

/**
 * Why a stored assertions document could not be used, when a document was there at all.
 *
 * ## The hole this closes, found by a consumer rather than by review
 *
 * {@link parseIdentityAssertions} answers `[]` for anything it cannot read, and that empty list is
 * byte-identical to "nothing has ever been enrolled". So a writer that produced the wrong shape would have
 * every store read `unbound` forever while every enrollment reported success — the silent forget this whole
 * two-phase check exists to prevent, happening inside its own reader.
 *
 * MEASURED: the sign-in surface's first writer emitted a BARE ARRAY rather than the
 * `{ assertions: [...] }` envelope, which reads back as empty. It was caught before shipping, but nothing in
 * this module could have told anyone.
 *
 * The tolerance itself stays, and this does NOT accept the bare array: refusing to parse would stop the loop
 * that keeps every credential alive, and widening the accepted shapes would make the envelope meaningless.
 * What changes is that a caller can now tell PRESENT-BUT-UNUSABLE from ABSENT and say so.
 *
 * @param value the decoded contents of the assertions file, or undefined when there is no file
 * @returns the problem to report, or undefined when the document is absent or usable
 */
export function identityFileProblem({ value }: { value: unknown }): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    const shape = Array.isArray(value) ? "a bare array" : `a ${typeof value}`;
    return `the identity assertions file is ${shape}, not the expected { "assertions": [...] } object — every store will read as unbound until it is rewritten`;
  }
  if (!Array.isArray(value["assertions"])) {
    return "the identity assertions file has no `assertions` array — every store will read as unbound until it is rewritten";
  }
  const dropped = value["assertions"].length - parseIdentityAssertions({ value }).length;
  if (dropped > 0) {
    return `${String(dropped)} identity assertion(s) were dropped as malformed — those stores will read as unbound`;
  }
  return undefined;
}

/**
 * Compare one store's live observation against its standing assertion.
 *
 * @param alias the store being judged
 * @param assertion what was asserted for it, absent when nothing has been
 * @param observedOrganizationId what the provider named this pass, absent when the store could not be read
 * @returns the renderable verdict, carrying no organisation id in any variant
 */
export function assessIdentity({
  alias,
  assertion,
  observedOrganizationId,
}: {
  alias: ClaudeAccountAlias;
  assertion?: ClaudeIdentityAssertion;
  observedOrganizationId?: string;
}): ClaudeIdentityStatus {
  if (assertion === undefined) {
    return { alias, kind: "unbound" };
  }
  if (observedOrganizationId === undefined) {
    return { alias, assertedAtIso: assertion.assertedAtIso, kind: "unobserved" };
  }
  const kind = observedOrganizationId === assertion.organizationId ? "match" : "changed";
  return { alias, assertedAtIso: assertion.assertedAtIso, kind };
}

/**
 * Establish an assertion for a store that has none — the FIRST-RUN half of the owner's two-phase contract.
 *
 * It REFUSES to overwrite a standing assertion, and that refusal is the whole mechanism rather than a
 * safety net around it: a function that could overwrite is a function a sweep will eventually be wired to,
 * which is exactly how `recordStoreIdentity` came to erase the evidence of its own drift. Changing which
 * account a store is asserted to hold is a re-enrollment, a separate deliberate act:
 * `slopweaver claude signin --reenroll <alias>`, through {@link reenrollAssertion}.
 *
 * @param alias the store being enrolled
 * @param assertions what is already asserted, in file order
 * @param email the address the owner calls this account, bound here because this is the one instant a human
 *   names a store, a live token and an address together
 * @param nowIso when this enrollment happened, ISO-8601 — injected, never read from a hidden clock
 * @param organizationId the organisation observed in the store at enrollment time
 * @returns the assertions with this one added, or the unchanged list when one already stood
 */
export function establishAssertion({
  alias,
  assertions,
  email,
  nowIso,
  organizationId,
}: {
  alias: ClaudeAccountAlias;
  assertions: readonly ClaudeIdentityAssertion[];
  email?: string;
  nowIso: string;
  organizationId: string;
}): { readonly assertions: readonly ClaudeIdentityAssertion[]; readonly established: boolean } {
  if (assertions.some((entry) => entry.alias === alias)) {
    return { assertions, established: false };
  }
  return {
    assertions: [
      ...assertions,
      { alias, assertedAtIso: nowIso, organizationId, ...(email === undefined ? {} : { email }) },
    ],
    established: true,
  };
}

/** One store to re-enroll, the organisation observed in it now, and the address being bound to it. */
export interface ClaudeReenrollment {
  readonly alias: ClaudeAccountAlias;
  /** Per-install state, never rendered — the same boundary as {@link ClaudeIdentityAssertion.organizationId}. */
  readonly organizationId: string;
  /** The address to bind, absent when the configured plan maps none. */
  readonly email?: string;
}

/** One replaced row, as the success line reports it: an alias and an instant, never an organisation. */
export interface ClaudeReenrolled {
  readonly alias: ClaudeAccountAlias;
  readonly replacedAssertedAtIso: string;
}

/** Every named store's standing row: what each replaces, or why it cannot be re-enrolled at all. */
function standingRows({
  assertions,
  changes,
}: {
  assertions: readonly ClaudeIdentityAssertion[];
  changes: readonly ClaudeReenrollment[];
}): { readonly problems: readonly string[]; readonly replaced: readonly ClaudeReenrolled[] } {
  const problems: string[] = [];
  const replaced: ClaudeReenrolled[] = [];
  for (const { alias } of changes) {
    const standing = assertions.filter((entry) => entry.alias === alias);
    const [previous] = standing;
    if (previous === undefined) {
      problems.push(
        `${alias}: NOT RE-ENROLLED — no standing enrollment exists; use \`slopweaver claude signin --enroll ${alias}\` for a first enrollment`,
      );
    } else if (standing.length > 1) {
      problems.push(
        `${alias}: NOT RE-ENROLLED — ${String(standing.length)} standing enrollment rows use this alias; repair the assertions file before trying again`,
      );
    } else {
      replaced.push({ alias, replacedAssertedAtIso: previous.assertedAtIso });
    }
  }
  return { problems, replaced };
}

/** The list as it would stand after every change, which is the only list a collision check may read. */
function applyReenrollments({
  assertions,
  changes,
  nowIso,
}: {
  assertions: readonly ClaudeIdentityAssertion[];
  changes: readonly ClaudeReenrollment[];
  nowIso: string;
}): readonly ClaudeIdentityAssertion[] {
  const incoming = new Map(changes.map((change) => [change.alias, change]));
  return assertions.map((entry): ClaudeIdentityAssertion => {
    const change = incoming.get(entry.alias);
    if (change === undefined) {
      return entry;
    }
    // The whole row is REPLACED rather than merged: a re-enrollment binds an address and an organisation
    // together, so carrying the old address forward beside a new organisation would mint the exact
    // stale-address-on-a-live-token pair this binding exists to make impossible.
    return {
      alias: entry.alias,
      assertedAtIso: nowIso,
      organizationId: change.organizationId,
      ...(change.email === undefined ? {} : { email: change.email }),
    };
  });
}

/** Each named store the final list would hold under a second alias too, named by alias and never by account. */
function collisionProblems({
  candidate,
  changes,
}: {
  candidate: readonly ClaudeIdentityAssertion[];
  changes: readonly ClaudeReenrollment[];
}): readonly string[] {
  const colliding = collidingAliases({ assertions: candidate });
  return changes
    .filter((change) => colliding.includes(change.alias))
    .map((change) => {
      const others = candidate
        .filter((entry) => entry.organizationId === change.organizationId && entry.alias !== change.alias)
        .map((entry) => entry.alias);
      return `${change.alias}: NOT RE-ENROLLED — this account would also be enrolled under ${others.join(", ")}; sign in a distinct account`;
    });
}

/**
 * Replace the standing assertions for one or more stores AT ONCE — the deliberate RE-ENROLLMENT
 * {@link establishAssertion} refuses to perform, reached only through `slopweaver claude signin --reenroll`.
 *
 * It exists because that refusal used to name a re-enrollment no verb performed. MEASURED: the
 * owner signed three stores in on the mapping they were given, all three read WRONG ACCOUNT, and nothing
 * could clear them. Refusing stays the default everywhere else; this is the one named way past it.
 *
 * **Several at once, judged on the FINAL list, because a real mismatch is a permutation.** MEASURED on the
 * same install, from the first single-store version of this function: plan-two held the
 * account enrolled for plan-four, plan-three held plan-two's and plan-four held plan-three's, so re-enrolling
 * any one of them collided with another row that was itself about to be replaced, and all three refused. A
 * cycle has no safe order, so the only correct check is on the list as it would stand after every change.
 *
 * It is all-or-nothing and fails closed on every ambiguity rather than guessing: a store named twice, a store
 * with no standing row (that is a first enrollment, a different act), a store with more than one row
 * ({@link parseIdentityAssertions} does not enforce uniqueness), and an account the final list would hold under
 * two aliases. Every refusal leaves the input unchanged and names aliases only, never an organisation.
 *
 * @param assertions what is already asserted, in file order
 * @param changes each store to re-enroll with the organisation observed in it now and the address to bind
 *   to it, at least one
 * @param nowIso when this re-enrollment happened, ISO-8601 — injected, never read from a hidden clock
 * @returns the assertions with each named row replaced in place and what each replaced, or every reason not
 */
export function reenrollAssertions({
  assertions,
  changes,
  nowIso,
}: {
  assertions: readonly ClaudeIdentityAssertion[];
  changes: readonly ClaudeReenrollment[];
  nowIso: string;
}): Result<
  {
    readonly assertions: readonly ClaudeIdentityAssertion[];
    readonly replaced: readonly ClaudeReenrolled[];
  },
  ClaudeError
> {
  if (changes.length === 0) {
    return err(ClaudeErrors.reenrollNothingNamed());
  }
  const named = changes.map((change) => change.alias);
  const repeated = [...new Set(named.filter((alias, index) => named.indexOf(alias) !== index))];
  if (repeated.length > 0) {
    return err(ClaudeErrors.reenrollRepeated({ aliases: repeated }));
  }
  const standing = standingRows({ assertions, changes });
  if (standing.problems.length > 0) {
    return err(ClaudeErrors.reenrollRefused({ reasons: standing.problems }));
  }
  const candidate = applyReenrollments({ assertions, changes, nowIso });
  const collisions = collisionProblems({ candidate, changes });
  if (collisions.length > 0) {
    return err(ClaudeErrors.reenrollRefused({ reasons: collisions }));
  }
  return ok({ assertions: candidate, replaced: standing.replaced });
}

/**
 * The assertion standing for one store, when one does.
 *
 * @param alias the store to look up
 * @param assertions every standing assertion
 * @returns the assertion, or undefined when this store is unbound
 */
export function assertionFor({
  alias,
  assertions,
}: {
  alias: ClaudeAccountAlias;
  assertions: readonly ClaudeIdentityAssertion[];
}): ClaudeIdentityAssertion | undefined {
  return assertions.find((entry) => entry.alias === alias);
}

/**
 * Whether the same account has been asserted for two different stores.
 *
 * The sign-in surface's completion criterion is that every slot holds a DISTINCT account, and four stores
 * each individually signed in is not that. Reported as aliases rather than as the colliding organisation,
 * so a caller can name the problem without holding the identifier.
 *
 * @param assertions every standing assertion
 * @returns the aliases sharing an account with at least one other, sorted, empty when all are distinct
 */
export function collidingAliases({
  assertions,
}: {
  assertions: readonly ClaudeIdentityAssertion[];
}): readonly ClaudeAccountAlias[] {
  const seen = new Map<string, ClaudeAccountAlias[]>();
  for (const entry of assertions) {
    pushInto({ buckets: seen, key: entry.organizationId, value: entry.alias });
  }
  return [...seen.values()]
    .filter((group) => group.length > 1)
    .flat()
    .toSorted();
}

/**
 * The one line a store's identity status renders as.
 *
 * Renders an alias and an instant only. There is no code path from here to an organisation id, because
 * {@link ClaudeIdentityStatus} does not carry one.
 *
 * @param status the verdict to render
 * @returns the line to print
 */
export function renderIdentityStatus({ status }: { status: ClaudeIdentityStatus }): string {
  if (status.kind === "changed") {
    return `${status.alias} identity: CHANGED since ${status.assertedAtIso} — a sign-in replaced this slot`;
  }
  if (status.kind === "unbound") {
    return `${status.alias} identity: unbound — no account has been enrolled for this store yet`;
  }
  if (status.kind === "unobserved") {
    return `${status.alias} identity: unchecked this pass — the store could not be read`;
  }
  return `${status.alias} identity: matches the account enrolled ${status.assertedAtIso}`;
}
