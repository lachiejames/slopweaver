/**
 * How a registered plan reads to the owner — **provider and account, never a plan number**.
 *
 * The register makes it very clear which plan is bound to which account, and the Claude plans were bought under
 * different emails, so they will not match a neat list. So `plan-six` is not a thing the owner should ever have to
 * hold: an alias is a machine
 * SELECTOR that appears in the command a surface hands the owner, and the sentence the owner reads names the provider
 * and the account instead.
 *
 * ## One account vocabulary, and the Codex ceiling
 *
 * The trust words are `src/claude/accountBinding.ts`'s, unchanged — `bound`, `bound-cache-stale`, `cached`,
 * `unmapped` and the three that have no address at all. Reusing them rather than minting a second set is
 * the point: two vocabularies for "how much is this address worth" is exactly the confusion to avoid.
 *
 * **Codex can never reach `bound`, and the TYPE is what enforces that** rather than a reviewer. An
 * enrollment binds an address to a live Claude token via the organisation header the gauge probe already
 * reads; Codex has no such join here, and manufacturing one would mean comparing emails, hashing tokens or
 * decoding a JWT — none of which this repository does. So {@link CodexAccountCell} has no `bound` member
 * and a Codex row's address is a labelled cache or nothing.
 *
 * Pure: a row and a decided cell in, a line out.
 */
import { type ClaudeAccountCell, cachedAccountCell, renderAccountCell } from "../claude/accountBinding.js";

import type { PlanDiagnostic, PlanProvider, RegisteredPlan } from "./types.js";

/** What each provider is called in a sentence the owner reads. */
const PROVIDER_LABELS: Readonly<Record<PlanProvider, string>> = { claude: "Claude", codex: "Codex" };

/**
 * The most a Codex destination's address can ever be worth — see this module's header.
 *
 * Both members are `ClaudeAccountCell`'s own, so one renderer serves both providers.
 */
export type CodexAccountCell = Extract<ClaudeAccountCell, { trust: "cached" } | { trust: "unmapped" }>;

/** A decided account cell together with the provider whose rules decided it. */
export type PlanAccountCell =
  | { readonly provider: "claude"; readonly cell: ClaudeAccountCell }
  | { readonly provider: "codex"; readonly cell: CodexAccountCell };

/**
 * The cell a Codex surface may show, from the register's display cache alone.
 *
 * @param cachedEmail what the register maps for this destination — a cache, never identity
 * @returns the `cached` cell, or `unmapped` when the row maps nothing
 */
export function codexAccountCell({ cachedEmail }: { cachedEmail?: string }): CodexAccountCell {
  if (cachedEmail === undefined) {
    return { trust: "unmapped" };
  }
  return { address: cachedEmail, trust: "cached" };
}

/**
 * The cell a surface holding only the register may show for any row, whichever provider serves it.
 *
 * @param plan the registered row
 * @returns the provider-discriminated cell, which for Codex can only be cached or unmapped
 */
export function registeredAccountCell({ plan }: { plan: RegisteredPlan }): PlanAccountCell {
  const cached = plan.email === undefined ? {} : { cachedEmail: plan.email };
  if (plan.provider === "codex") {
    return { cell: codexAccountCell(cached), provider: "codex" };
  }
  return { cell: cachedAccountCell(cached), provider: "claude" };
}

/**
 * How the owner reads one destination: the provider, then what its account may be called.
 *
 * No alias appears here by design. A surface that needs the owner to RUN something prints the alias inside that
 * command, where it is a selector rather than a number to remember.
 *
 * @param account the provider-discriminated decided cell
 * @returns a line such as `Claude · CACHED security@example.com`
 */
export function renderPlanAccount({ account }: { account: PlanAccountCell }): string {
  return `${PROVIDER_LABELS[account.provider]} · ${renderAccountCell({ cell: account.cell })}`;
}

/**
 * How a SENTENCE names one destination — its account where there is one, its store directory where there is
 * not.
 *
 * MEASURED, running the real verb over a throwaway home: a Claude row the register maps no email
 * for produced `Claude · UNMAPPED is PAUSED since …`, a sentence that identifies nothing at all — with five
 * Claude rows registered, a reader could not tell which one was out. So the store directory is the fallback,
 * because it is the row's actual identity, and it is SAID rather than substituted silently. The alias is
 * still not the answer: it is the selector inside the command, one clause later.
 *
 * @param plan the registered row
 * @returns the phrase a sentence opens with
 */
function destinationPhrase({ plan }: { plan: RegisteredPlan }): string {
  const account = registeredAccountCell({ plan });
  if ("address" in account.cell) {
    return renderPlanAccount({ account });
  }
  return `the ${PROVIDER_LABELS[plan.provider]} destination at ${plan.storeDir} (no account mapped)`;
}

/**
 * The line every fleet surface prints for one paused destination, instead of the provider refusal it would
 * otherwise print on every read.
 *
 * It names no instant but the one the row carries: a pause is a state, not a countdown, so this renders no
 * deadline and no elapsed target.
 *
 * What a pause stops differs by provider, and the line says which ({@link pausedEffect}).
 *
 * @param plan the registered row
 * @returns the line, or undefined when the plan is not paused
 */
export function pausedPlanNotice({ plan }: { plan: RegisteredPlan }): string | undefined {
  if (plan.paused === undefined) {
    return undefined;
  }
  return (
    `${destinationPhrase({ plan })} is PAUSED since ` +
    `${plan.paused.sinceIso} — ${plan.paused.reason}. ${pausedEffect({ plan })}; ` +
    `\`slopweaver plans resume --provider ${plan.provider} --plan ${plan.alias}\` puts it back.`
  );
}

/**
 * What a pause stops for this row, as the notice's middle clause.
 *
 * A paused Claude plan is never probed: its probe is a one-token spend, and the pause exists so it spends nothing
 * (`../cli/commands/claude/watchPlans.ts`). A paused weekly Codex row IS still read — `../codex/fleetRead.ts` asks its
 * store for sign-in and limits, never a model turn — because a pause is often "until this is signed in", and the
 * live read is what keeps that login line and the `codex-plan-signed-out` card current (`../codex/fleetCap.ts`).
 * A monthly-spend Codex row is read by nothing at all, paused or not.
 *
 * @param plan the paused row
 * @returns the clause, every fleet count's listing included, without its closing punctuation
 */
function pausedEffect({ plan }: { plan: RegisteredPlan }): string {
  if (plan.provider === "claude") {
    return "It is not probed and not routed, but every fleet count still lists it as paused";
  }
  if (plan.allowance.kind === "monthly-spend") {
    return "It is not routed and not live-read, because nothing here measures monthly spend; every fleet count still lists it as paused";
  }
  return "It is not routed, though its sign-in and limits are still read so a needed login stays visible; every fleet count still lists it as paused";
}

/**
 * One diagnostic as a surface prints it, tagged with its code so a reader can search for the rule.
 *
 * @param diagnostic what the read wants the reader told
 * @returns the tagged line
 */
export function renderPlanDiagnostic({ diagnostic }: { diagnostic: PlanDiagnostic }): string {
  return `note [${diagnostic.code}]: ${diagnostic.message}`;
}
