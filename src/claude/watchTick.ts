/**
 * One tick of the watch loop, decided before anything is touched or written. Pure: no clock, no keychain,
 * no network — the caller reads every gauge, hands them here, and performs what comes back.
 *
 * ## What a tick is FOR, and what it deliberately is not
 *
 * The loop is the PROACTIVE half of the trigger. It sees plan-wide utilisation on every gauge and can move
 * before a wall, which is the half `trigger.ts` describes as pre-emptable. It carries no transcript, so the
 * REACTIVE half — a claim that has already refused a session — reaches the trigger from the session that
 * hit it, never from here. Stating that is the point: a loop that claimed to catch a per-model wall would be
 * claiming a number the headers do not carry.
 *
 * ## Never touch a store whose credential the active slot is also holding
 *
 * This is the seam that had to be found rather than reasoned about, and it is the same shape as the defect
 * that cost the owner an account. A swap COPIES a store's credential into the active slot, so both hold the
 * same token; a refresh mints a new one and REVOKES the old. Running the keep-alive touch under such a store
 * would therefore refresh that store's copy and revoke the copy every running session is authenticating
 * with — an outage manufactured by the very loop that exists to prevent one.
 *
 * **The recorded alias is the WEAK half of that guard and must never be the only half.** Measured on one
 * machine: three stores were configured and `rotation-state.json` did not exist at all, so
 * `selected` was undefined and a guard resting on it alone excluded nothing. A guard that is vacuous
 * exactly on a fresh install is not a guard. The strong half is a direct comparison — the caller reads the
 * active slot and every store and reports which stores hold the same credential — which needs no record, no
 * provider call, and is true whether or not this repository has ever rotated.
 *
 * Both halves are applied, and NEITHER IS SUFFICIENT, which is why a rule sits above them: when the loop
 * cannot identify the active plan at all, it touches NOTHING.
 *
 * That rule exists because both guards were measured inert at the same time, on the merged tree. The byte comparison is exact, so it holds only while the store and the active slot
 * carry the identical token — the instant after a swap. Ordinary use then refreshes the active slot, the two
 * copies diverge, and the comparison stops matching: measured, the active slot read 6.34 hours of life while
 * plan-one's and plan-two's stores had already EXPIRED. The recorded alias would have covered exactly that
 * case, and `rotation-state.json` did not exist, so it covered nothing. Both inert, every store listed as
 * due, including the one whose ACCOUNT the active slot holds.
 *
 * Touching that store refreshes it from its own refresh token, and a refresh revokes the sibling copy — the
 * credential every running session is authenticating with. So the honest answer when the active plan is
 * unknown is to refuse: any store could be the one, and a needless delay costs one interval while a wrong
 * touch costs the outage this whole feature exists to prevent.
 *
 * The active plan needs no keep-alive anyway: it is the one store something is continuously running under,
 * so it refreshes itself.
 *
 * ## The account-level answer, which is the one that actually holds
 *
 * That refusal was correct and it was also a standstill: with no plan identifiable, EVERY store was held
 * back, and three of them then expired of the neglect this loop exists to prevent. The comparison that
 * settles it is the ACCOUNT — and `checkoutIdentity.ts` gets that from a header the gauge probe was already
 * collecting, so it costs nothing and, unlike the bytes, it survives a refresh.
 *
 * ## The answer that outranks all of them: the store THIS PROCESS is pinned to
 *
 * Everything below reasons about "the active slot" — the DEFAULT keychain item, the one
 * `readCredentialDocument({})` reads. On the owner's machine nothing runs on it. Every session, this loop
 * included, is booted with `CLAUDE_SECURESTORAGE_CONFIG_DIR` naming one store (`seatPinning.ts`'s
 * `bootEnvPrefix`), so the default item is whatever a hand `/login` last left there.
 *
 * MEASURED, and it is what put this answer in: the default item's keychain `mdat` read
 * two days stale, so its token had expired. `probeActiveSlot`
 * presented it, got a 401, and returned no organisation — which takes `identified` AND `deduced` out at
 * once, because both are gated on that value. `storesSharingActiveCredential` compares against the same
 * dead item, so `observed` matched nothing. Resolution fell all the way to `recorded`, and
 * `rotation-state.json`'s `selected` had said `plan-three` for days. The tick therefore
 * skipped plan-three as "the active plan, so it refreshes itself" while every live session ran on
 * plan-one — the loop protecting the one store that needed no protection, and leaving the three that did.
 * plan-two, plan-three and plan-four expired within minutes of each other, exactly 8h after their
 * sign-ins. Reproduce with `slopweaver claude watch --once --json` and compare `active` to
 * `env | grep CLAUDE_SECURESTORAGE_CONFIG_DIR` in any live workspace.
 *
 * So the strongest answer is not a probe at all. The store this process was booted against is a fact
 * about this process, needs no provider call, no record and no deduction, and cannot go stale — and it is
 * exactly the store whose credential a refresh here would collide with, because this process is the one
 * running under it. `config.ts`'s `aliasForStoreDir` does the mapping, comparing paths the way the
 * keychain does.
 *
 * It answers for THIS process only, and that is the honest bound. Another session pinned to some other
 * store is not visible from here, and touching that store is the same in-place refresh the session's own
 * CLI performs for itself every eight hours — the hazard below is a COPY of one credential in two slots,
 * which pinning does not create.
 *
 * Below it, the older answers stand unchanged for a machine where nothing is pinned:
 *
 * - `identified` — the provider says the active credential belongs to the account this store is recorded as
 *   holding. Exact, and true for as long as the owner does not sign that store into a different account.
 * - `observed` — the active slot holds a store's credential byte for byte. True only in the window between a
 *   swap and the next refresh, which is why it can no longer be the primary answer.
 * - `deduced` — every store but one has been identified and none of them matches, so the active credential
 *   belongs to the one left. This is the answer the owner's own machine needs, because the active plan's
 *   store is exactly the one that cannot answer a probe; `checkoutIdentity.ts` carries why it is sound.
 * - `recorded` — this repository's memory of its own last swap. The weakest, because a hand `/login`
 *   invalidates it silently, and it is kept only as the answer of last resort.
 *
 * `unknown` still touches nothing, and that is deliberate rather than vestigial: it is reached when the
 * active credential is one the fleet has never seen, which is exactly when guessing is most expensive.
 *
 * ## `none` — the case `unknown` was swallowing, and the reason keep-alive stopped working
 *
 * "The fleet has never seen this credential" was only ever HALF of what fell through to `unknown`. The other
 * half is that there is no credential to see. MEASURED, days after the pin above landed: the
 * default item's token had expired — the very same dead item named in the paragraph
 * above, never signed back in — and all four configured stores held live ones. The standing watch loop runs
 * UNPINNED (it is started from the main checkout with no `CLAUDE_SECURESTORAGE_CONFIG_DIR`), so `pinned` did
 * not answer for it, and every weaker source is evidence about that dead item: no organisation comes back
 * for a 401, no store byte-matches it, and the record had been stale for days. Every tick concluded
 * `unknown`, `unknown` holds EVERY store back, and the loop whose one job is keeping four stores alive
 * refreshed none of them for seven days — guarding a credential no session could present.
 *
 * So the ladder now asks whether the slot holds anything BEFORE asking which plan holds it. `none` is that
 * answer and it is a POSITIVE finding rather than a fall-through ({@link ActiveSlotHolding}). It is checked
 * directly under `pinned`, above every inference, since a dead slot can still byte-match a store that went
 * dead beside it — and `observed` would then name that store the active plan and hold it back as
 * self-refreshing under a session that does not exist.
 *
 * It releases the BLANKET hold and nothing else. That hold rests on "any store could be the one whose
 * account the active slot holds", which a dead slot has already answered: it holds nobody's. The byte
 * comparison is a different claim and survives — review pass r1
 * (`dead-slot-release-cannot-revoke-a-live-token`) falsified releasing it, because an `expired` reading is
 * of the ACCESS token while the REFRESH grant beside it runs 27 to 29 days, so a store byte-matching a dead
 * slot can still hold a grant that slot could have used. On the machine that was measured
 * `sharesActiveCredential` is empty, so all four stores are released either way.
 *
 * Reproduce the standing loop's own view with
 * `env -u CLAUDE_SECURESTORAGE_CONFIG_DIR ./bin/slopweaver claude watch --once --dry-run`.
 *
 * ## A standing hold is applied here, not re-derived
 *
 * `rotationState.ts` records a plan as unavailable until the reset its own refusal named, which is what
 * stops two plans near the wall handing the fleet back and forth on every cycle. A tick honours those holds
 * by keeping the held plans' gauges out of the selection entirely, so the trigger chooses among what is
 * genuinely eligible instead of picking a plan the state already knows is spent.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import { aliasForOrganization, type ClaudeStoreIdentity, soleUnidentifiedAlias } from "./checkoutIdentity.js";
import type { SessionSeat } from "./claimResponse.js";
import type { ClaudeAccount, ClaudeAccountGauge, ClaudeLimitSignal, ClaudePlanSpend } from "./contracts.js";
import { ACCESS_TOKEN_LIFETIME_HOURS, type StoreTouch, storesDueForTouch } from "./keepAlive.js";
import type { ClaudeRotationState } from "./rotationState.js";
import type { TriggerOutcome } from "./trigger.js";
import {
  type ActiveFrom,
  type ActiveSlot,
  type ActiveSlotHolding,
  reportableExpiryIso,
} from "./watchTickActiveSlot.js";
import { rotateTarget, tickSentence } from "./watchTickSentence.js";
import { decideTrigger, heldPlans } from "./watchTickTrigger.js";
import { splitTouches } from "./watchTouchGuard.js";

/** Milliseconds in one hour, for the age bound on the recorded answer. */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Which credential surface a tick's rotation claim is ABOUT, which is what decides whether it may be
 * performed.
 *
 * ## Two surfaces, and conflating them is how a good store gets destroyed
 *
 * The retired swap mutated the DEFAULT slot — it copied one store's credential into the machine-wide
 * keychain item, and checks the previous occupant back in on the way. Every answer except `pinned` is
 * evidence about that slot, so a rotation chosen from one of them describes the thing it would change.
 *
 * `pinned` is not. It says which store THIS PROCESS reads, which on a pinned machine is a different
 * keychain item holding a different account. A rotation chosen from a pinned reading would be a decision
 * about one account's budget, performed against another account's slot — and its check-in would hand the
 * default slot's credential to a store chosen by that mismatch. That is the same class as an earlier
 * incident: the wrong credential written into the right-looking place.
 *
 * So a pinned tick still REPORTS what the budgets say, because that is useful, and never performs it.
 *
 * @internal — the type of {@link WatchTickPlan.rotationScope}; the shell reads that field rather than
 *   naming this type, and nothing constructs one.
 */
export type WatchRotationScope =
  /** The claim is about the default slot, and the shell may perform it. */
  | "default-slot"
  /** The reading came from this process's own pinned store, so it is a recommendation and nothing more. */
  | "process-pinned";

/**
 * What one tick concluded: which stores to refresh, what the trigger decided, and the sentence a reader gets.
 *
 * @internal — the value {@link planWatchTick} returns; the loop performs it rather than constructing one.
 */
export interface WatchTickPlan {
  /** The stores due a keep-alive refresh now, in configured order. Never one the active slot shares. */
  readonly touch: readonly string[];
  /** Why a due store was nonetheless skipped, one sentence per skip — empty when nothing was held back. */
  readonly touchSkipped: readonly string[];
  /** Plans under an unexpired hold, kept out of selection so the fleet cannot flap back onto one. */
  readonly held: readonly string[];
  /** The plan the fleet is on, when any of the three sources answered. */
  readonly active?: string;
  /** Which source named {@link active}, so a reader can see how much the answer is worth. */
  readonly activeFrom: ActiveFrom;
  readonly outcome: TriggerOutcome;
  /** The plan the fleet would move to, present only when the trigger chose one. */
  readonly rotateTo?: string;
  /**
   * Which credential surface {@link rotateTo} is a claim about — and therefore whether this process may
   * perform it. See {@link WatchRotationScope}.
   */
  readonly rotationScope: WatchRotationScope;
  /** One sentence for the tick line. Names aliases and instants only — never a credential. */
  readonly why: string;
}

/**
 * Which plan the fleet is on, and which of the three sources answered.
 *
 * The account identity wins because it is the only one that stays true: the provider names the organisation
 * the active credential belongs to, and that does not change when the token does. The byte comparison comes
 * next — a fact about the machine, but one that expires at the active slot's first refresh. The record comes
 * last, being only this repository's memory of its own last swap.
 *
 * Ambiguity is never resolved by picking, at any level. Two stores holding the active credential byte for
 * byte, two recorded against the same organisation, or two stores still unidentified, is a state nothing here
 * can interpret, so the answer falls through rather than guessing between them.
 *
 * Elimination is gated on the provider having answered for the ACTIVE slot. Without that answer there is no
 * evidence that none of the identified stores matches — only that the question was never asked — and
 * deducing from a question nobody asked is exactly the guess this function refuses everywhere else.
 *
 * @param activeOrganizationId the organisation the ACTIVE credential belongs to, when the provider named it
 * @param activeSlotHolding whether the slot holds a live credential at all, which outranks every inference
 *   about WHICH plan it holds
 * @param aliases every configured plan, which is what the elimination case counts against
 * @param identities every store's recorded account
 * @param nowIso this tick's instant, ISO-8601 — what the recorded answer's age is measured against
 * @param pinnedActive the plan whose store THIS process is booted against, when it is a configured one
 * @param sharesActiveCredential every store observed holding the active slot's own credential
 * @param state what this repository last recorded
 * @returns the active alias when a source answered, and which one did
 */
function resolveActive({
  activeOrganizationId,
  activeSlotHolding,
  aliases,
  identities,
  nowIso,
  pinnedActive,
  sharesActiveCredential,
  state,
}: {
  activeOrganizationId?: string;
  activeSlotHolding: ActiveSlotHolding;
  aliases: readonly string[];
  identities: readonly ClaudeStoreIdentity[];
  nowIso: string;
  pinnedActive?: string;
  sharesActiveCredential: readonly string[];
  state: ClaudeRotationState;
}): { active?: string; activeFrom: ActiveFrom } {
  if (pinnedActive !== undefined) {
    return { active: pinnedActive, activeFrom: "pinned" };
  }
  // Checked second, above every inference about the slot, because each of those infers WHICH plan the slot
  // holds and this answers whether it holds one. A dead slot can still byte-match a store that went dead
  // beside it, and `observed` would then name that store the active plan and hold it back as
  // "self-refreshing under ordinary use" — of a session that does not exist.
  if (activeSlotHolding !== "live") {
    return { activeFrom: "none" };
  }
  const identified =
    activeOrganizationId === undefined
      ? undefined
      : aliasForOrganization({ identities, organizationId: activeOrganizationId });
  if (identified !== undefined) {
    return { active: identified, activeFrom: "identified" };
  }
  const observed = sharesActiveCredential.length === 1 ? sharesActiveCredential[0] : undefined;
  if (observed !== undefined) {
    return { active: observed, activeFrom: "observed" };
  }
  const deduced = activeOrganizationId === undefined ? undefined : soleUnidentifiedAlias({ aliases, identities });
  if (deduced !== undefined) {
    return { active: deduced, activeFrom: "deduced" };
  }
  const recordIsCurrent = recordStillDescribesNow({
    nowIso,
    ...(state.selectedAtIso === undefined ? {} : { selectedAtIso: state.selectedAtIso }),
  });
  if (state.selected !== undefined && recordIsCurrent) {
    return { active: state.selected, activeFrom: "recorded" };
  }
  return { activeFrom: "unknown" };
}

/**
 * Whether the recorded selection is recent enough to be evidence about the CURRENT active slot.
 *
 * The record was always the weakest answer, and this bounds how long it is an answer at all. It describes
 * one swap this repository performed; the active slot's credential does not survive
 * {@link ACCESS_TOKEN_LIFETIME_HOURS} without being refreshed or replaced, so a record older than one
 * lifetime is describing a credential that no longer exists.
 *
 * MEASURED — the reason this is a bound rather than a comment. `rotation-state.json` carried
 * `selected: "plan-three"` five days stale, and the tick acted on it
 * with full confidence: it skipped plan-three as self-refreshing while every session ran on plan-one.
 * Falling through to `unknown` is strictly safer than that, because `unknown` touches NOTHING, whereas a
 * wrong `recorded` both protects the wrong store and clears every other store — including whichever one
 * is genuinely live — for a touch.
 *
 * An absent `selectedAtIso` is treated as too old rather than as fresh: a record that cannot say when it
 * was written cannot say it is current, and guessing in the other direction is what this bound removes.
 *
 * @param nowIso this tick's instant, ISO-8601
 * @param selectedAtIso when the record was written, ISO-8601, absent on a record that never carried one
 * @returns whether the record may still name the active plan
 */
function recordStillDescribesNow({ nowIso, selectedAtIso }: { nowIso: string; selectedAtIso?: string }): boolean {
  if (selectedAtIso === undefined) {
    return false;
  }
  const ageMs = Date.parse(nowIso) - Date.parse(selectedAtIso);
  return Number.isFinite(ageMs) && ageMs <= ACCESS_TOKEN_LIFETIME_HOURS * MS_PER_HOUR;
}

/**
 * Which surface this tick's rotation claim is about.
 *
 * @param activeFrom which source named the active plan
 * @returns `process-pinned` when the reading came from this process's own store, else `default-slot`
 */
function rotationScopeFor({ activeFrom }: { activeFrom: ActiveFrom }): WatchRotationScope {
  return activeFrom === "pinned" ? "process-pinned" : "default-slot";
}

/**
 * Build the tick's report from the pieces already decided.
 *
 * Split out of {@link planWatchTick} so the deciding and the reporting are separable, and because the
 * optional-field spreading that `exactOptionalPropertyTypes` requires reads as noise beside the decisions.
 *
 * @param active the plan the fleet is on, when a source answered
 * @param activeFrom which source answered
 * @param activeSlotExpiryIso when the active slot's credential expired, for the dead-slot sentence
 * @param held every plan under an unexpired hold
 * @param outcome what the trigger concluded
 * @param touch the stores this tick may refresh
 * @param touchSkipped one sentence per store held back
 * @returns the plan the loop performs
 */
function assemblePlan({
  active,
  activeFrom,
  activeSlotExpiryIso,
  held,
  outcome,
  touch,
  touchSkipped,
}: {
  active?: string;
  activeFrom: ActiveFrom;
  activeSlotExpiryIso?: string;
  held: readonly string[];
  outcome: TriggerOutcome;
  touch: readonly string[];
  touchSkipped: readonly string[];
}): WatchTickPlan {
  const target = rotateTarget({ outcome });
  return {
    activeFrom,
    held,
    outcome,
    rotationScope: rotationScopeFor({ activeFrom }),
    touch,
    touchSkipped,
    why: tickSentence({
      activeFrom,
      outcome,
      ...(active === undefined ? {} : { active }),
      ...(activeSlotExpiryIso === undefined ? {} : { activeSlotExpiryIso }),
      ...(target === undefined ? {} : { target }),
    }),
    ...(active === undefined ? {} : { active }),
    ...(target === undefined ? {} : { rotateTo: target }),
  };
}

/**
 * Decide one tick.
 *
 * @param accounts the configured plans, in the order that breaks selection ties
 * @param activeOrganizationId the organisation the ACTIVE credential belongs to, when the provider named it
 * @param activeSlot whether the ACTIVE slot holds a credential a session could present at all, and when it
 *   expired if it does not; see {@link ActiveSlotHolding} for why the default is `live` and what saying
 *   otherwise releases
 * @param activeSlotGauge what the ACTIVE slot itself read, under a placeholder alias this re-stamps
 * @param gauges every plan's reading this tick took, in the same order
 * @param identities every store's recorded account, which is what turns that organisation into an alias
 * @param nowIso this tick's instant, ISO-8601 — injected, never read from a hidden clock
 * @param pinnedActive the plan whose store THIS process was booted against, resolved by the shell from
 *   `CLAUDE_SECURESTORAGE_CONFIG_DIR`; the strongest answer to which plan is active, and absent only when
 *   the process carries no pin or carries one no configured plan holds
 * @param reserved the plan held back for the browser, which is also the pinned one
 * @param seat which seat this loop speaks for, since a per-model wall answers differently for the chair
 * @param sharesActiveCredential every store the caller observed holding the same credential as the active
 *   slot — the half of the refresh guard that does not depend on a record existing
 * @param signal a claim that already refused a session, when one reached this loop
 * @param spends every unpaused monthly-spend plan's spend verdict at this tick — judged by the trigger, never probed
 * @param state what this repository last recorded about the fleet
 * @param thresholds the install's Claude thresholds, off the same register read as `accounts`
 * @param touches when each store was last refreshed
 * @returns what to do this tick
 */
export function planWatchTick({
  accounts,
  activeOrganizationId,
  activeSlot = { holding: "live" },
  identities,
  nowIso,
  pinnedActive,
  sharesActiveCredential,
  state,
  // What only the rest of the tick reads, passed through as given — every gauge, the seat, a refusal, the spends.
  ...rest
}: {
  accounts: readonly ClaudeAccount[];
  activeOrganizationId?: string;
  activeSlot?: ActiveSlot;
  activeSlotGauge?: ClaudeAccountGauge;
  gauges: readonly ClaudeAccountGauge[];
  identities: readonly ClaudeStoreIdentity[];
  nowIso: string;
  pinnedActive?: string;
  reserved?: string;
  seat: SessionSeat;
  sharesActiveCredential: readonly string[];
  signal?: ClaudeLimitSignal;
  spends: readonly ClaudePlanSpend[];
  state: ClaudeRotationState;
  thresholds: ClaudeThresholds;
  touches: readonly StoreTouch[];
}): WatchTickPlan {
  const { active, activeFrom } = resolveActive({
    activeSlotHolding: activeSlot.holding,
    // Every plan the slot could hold, a monthly-spend one included: it is never probed nor touched, but leaving it
    // out lets deduction name a weekly plan the slot does not hold, and hides a closed monthly one.
    aliases: [...accounts.map((account) => account.alias), ...rest.spends.map((spend) => spend.alias)],
    identities,
    nowIso,
    sharesActiveCredential,
    state,
    ...(activeOrganizationId === undefined ? {} : { activeOrganizationId }),
    ...(pinnedActive === undefined ? {} : { pinnedActive }),
  });
  return planFromActive({
    ...rest,
    accounts,
    activeFrom,
    activeSlot,
    nowIso,
    sharesActiveCredential,
    state,
    ...(active === undefined ? {} : { active }),
  });
}

/**
 * The rest of the tick, once the one question everything else hangs off — which plan is active, and whether
 * any is — has been answered.
 *
 * Split here rather than anywhere else because that is where the module's own two-part story divides:
 * {@link resolveActive} walks a ladder of evidence, and everything below consumes its verdict without
 * re-deriving it. Nothing here may ask again which plan is active.
 *
 * @param active the plan the fleet is on, when a source named it
 * @param activeFrom which source did
 * @param activeSlot what the slot holds, which decides whether the dead-slot sentence names an instant
 * @param activeSlotGauge what the slot itself read, under a placeholder alias this re-stamps
 * @param gauges every store's reading this tick took
 * @param reserved the plan held back for the browser
 * @param seat which seat this loop speaks for
 * @param sharesActiveCredential every store holding the slot's own credential
 * @param signal a claim that already refused a session, when one reached this loop
 * @param spends every unpaused monthly-spend plan's spend verdict at this tick
 * @param state what this repository last recorded about the fleet
 * @param thresholds the install's Claude thresholds
 * @param touches when each store was last refreshed
 * @returns what to do this tick
 */
function planFromActive({
  accounts,
  active,
  activeFrom,
  activeSlot,
  nowIso,
  sharesActiveCredential,
  state,
  touches,
  // What only the trigger reads — the slot's own reading, every gauge, the reserve, the seat, a refusal, the bars.
  ...triggerInputs
}: {
  accounts: readonly ClaudeAccount[];
  active?: string;
  activeFrom: ActiveFrom;
  activeSlot: ActiveSlot;
  activeSlotGauge?: ClaudeAccountGauge;
  gauges: readonly ClaudeAccountGauge[];
  nowIso: string;
  reserved?: string;
  seat: SessionSeat;
  sharesActiveCredential: readonly string[];
  signal?: ClaudeLimitSignal;
  spends: readonly ClaudePlanSpend[];
  state: ClaudeRotationState;
  thresholds: ClaudeThresholds;
  touches: readonly StoreTouch[];
}): WatchTickPlan {
  const { touch, touchSkipped } = splitTouches({
    activeFrom,
    due: storesDueForTouch({ accounts, nowIso, touches }),
    sharesActiveCredential,
    ...(active === undefined ? {} : { active }),
  });
  // A monthly-spend plan is selectable on an open verdict, so a hold keeps the fleet off one exactly as off a weekly one.
  const aliases = [...accounts, ...triggerInputs.spends].map((plan) => plan.alias);
  const held = heldPlans({ aliases, nowIso, state });
  const expiryIso = reportableExpiryIso({ activeFrom, activeSlot });
  const outcome = decideTrigger({
    accounts,
    activeFrom,
    held,
    ...triggerInputs,
    ...(active === undefined ? {} : { active }),
  });
  return assemblePlan({
    activeFrom,
    held,
    outcome,
    touch,
    touchSkipped,
    ...(active === undefined ? {} : { active }),
    ...(expiryIso === undefined ? {} : { activeSlotExpiryIso: expiryIso }),
  });
}
