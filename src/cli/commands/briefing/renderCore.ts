/**
 * The PURE core of `briefing render`: validate the form, render the page, and re-read it with the gate.
 *
 * Zero I/O, so a test drives the whole verb without touching disk. The edge in `./renderRun.ts` supplies
 * the form text, the operator's private voice rules and somewhere to write.
 *
 * ## Why the verb checks its own output
 *
 * `./schema.ts`'s caps and `../../../briefing/check.ts`'s caps are the same numbers from the same file, so
 * the check ought to be redundant — and running it is what makes that a fact rather than a hope. Two things
 * only the check can see also survive: an option naming a Title-Case label the card never defines, which is
 * a relation between fields rather than a cap on one, and the operator's private voice rules, which no
 * schema shipped in this repository can read. A render that emits a page `briefing check` would refuse is a
 * defect in this pair, and it is reported as one rather than published.
 */
import { PAGE_TEXT_MAX_BYTES } from "../../../briefing/caps.js";
import { briefingRefused, checkBriefing, renderBriefingCheck } from "../../../briefing/check.js";
import { type FoldedPage, foldCardedPages } from "../../../briefing/openPageFold.js";
import { pageTextBytes } from "../../../briefing/pageBudget.js";
import { isRecord } from "../../../lib/parsers.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { PrPremise } from "../../../live/github/prPremise.js";
import { applyResolvedImages, collectImagePaths } from "../../../outbound/briefing/images.js";
import { renderBriefing } from "../../../outbound/briefing/render.js";
import { briefingFormSchema } from "../../../outbound/briefing/schema.js";
import type {
  BriefingAutonomy,
  BriefingCard,
  BriefingForm,
  BriefingHandSteps,
  BriefingOpenArtifact,
  BriefingOwnerBeliefs,
  BriefingQuiz,
  BriefingReactNow,
  BriefingSection,
  BriefingStaleSnapshot,
  BriefingYourList,
} from "../../../outbound/briefing/types.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import { type BriefingCommandError, BriefingCommandErrors } from "./errors.js";
import { type BriefingNarrativeSections, injectNarrative } from "./injectNarrative.js";
import {
  injectAutonomy,
  injectFreshness,
  injectHandSteps,
  injectNothingStale,
  injectOpenArtifacts,
  injectOwnerBeliefs,
  injectQuiz,
  injectYourList,
} from "./injectSections.js";
import { draftPage, formIssueLine } from "./refusedPage.js";

/**
 * Resolve every `path` an image block carries into the `data:` URI `../../../outbound/briefing/images.ts`
 * expects the schema to see, then hand the result on to `briefingFormSchema`.
 *
 * @param json the parsed form, before validation
 * @param readImageDataUri reads one image path and returns the `data:` URI to embed, or a refusal naming why
 * @returns the form with every `path` replaced, or the first read failure encountered
 */
function resolveFormImages({
  json,
  readImageDataUri,
}: {
  json: unknown;
  readImageDataUri: (args: { path: string }) => Result<string>;
}): Result<unknown, BriefingCommandError> {
  const refs = collectImagePaths({ json });
  if (refs.length === 0) {
    return ok(json);
  }
  const resolved = new Map<string, string>();
  for (const ref of refs) {
    if (resolved.has(ref.path)) {
      continue;
    }
    const data = readImageDataUri({ path: ref.path });
    if (data.isErr()) {
      return err(
        BriefingCommandErrors.formRejected({ reasons: data.error.map((line) => `${ref.jsonPath.join(".")}: ${line}`) }),
      );
    }
    resolved.set(ref.path, data.value);
  }
  return ok(applyResolvedImages({ json, resolved }));
}

/**
 * What a validated form carries out: the form itself, and what the one-card-per-page fold removed.
 *
 * Two values rather than one because the fold is a decision the run MADE about the owner's page, and a decision
 * nothing prints is indistinguishable from one nothing took — the shape `../../../briefing/openPageCards.ts`
 * was in for eleven days while it silently dropped a `detail`. `briefing sweep-block` reads only the
 * refusal lines and discards this whole value, which is why the second field costs it nothing.
 */
export interface ParsedBriefingForm {
  readonly form: BriefingForm;
  /** Every page whose projected card folded into a card the block already carried; empty is the common case. */
  readonly foldedPages: readonly FoldedPage[];
}

/**
 * Validate a filled form: resolve every image `path` into `data`, then check it against the schema.
 *
 * @param raw the JSON text of the form
 * @param readImageDataUri reads one image path and returns the `data:` URI to embed, or a refusal naming why
 * @param yourList the projected section, absent when the run was given no `--your-list`
 * @param autonomy the projected autonomy ledger, absent when the run asked for no register
 * @param ownerBeliefs the projected correction block, absent when the run was given no `--owner-beliefs`
 * @param handSteps the projected hand-steps section, absent when the run asked for no register
 * @param quiz the projected question, absent when the run was given no `--knowledge-quiz`
 * @param openPrs every open pull request as a card, absent when the run was given no `--open-prs`
 * @param openPageCards one card per open page, absent when the run was given no `--open-artifacts`
 * @param freshness the atlas-and-corpus freshness section, absent when the run was given no `--freshness`
 * @param nothingStale the Nothing stale section, absent when the run was given no `--nothing-stale`
 * @param narrative the three projected narrative sections, absent when the run was given no `--ticks`
 * @param stamps the two instants the eyebrow states, which a form may not write
 * @returns the typed form beside the pages whose second card folded, or one line per rejection naming its
 *   path
 */
export function parseBriefingForm({
  raw,
  readImageDataUri,
  ...projections
}: {
  raw: string;
  readImageDataUri: (args: { path: string }) => Result<string>;
  yourList: BriefingYourList | undefined;
  autonomy: BriefingAutonomy | undefined;
  ownerBeliefs: BriefingOwnerBeliefs | undefined;
  handSteps: BriefingHandSteps | undefined;
  quiz: BriefingQuiz | undefined;
  openArtifacts: readonly BriefingOpenArtifact[] | undefined;
  openPageCards: readonly BriefingCard[] | undefined;
  openPrs: Pick<BriefingReactNow, "meFacing" | "teamFacing"> | undefined;
  freshness: BriefingSection | undefined;
  nothingStale: BriefingSection | undefined;
  narrative: BriefingNarrativeSections | undefined;
  stamps: BriefingStamps;
}): Result<ParsedBriefingForm, BriefingCommandError> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error: unknown) {
    return err(BriefingCommandErrors.documentNotJson({ cause: error, document: "form" }));
  }
  return injectProjections({ ...projections, json }).andThen((injected) =>
    resolveFormImages({ json: injected.json, readImageDataUri }).andThen((resolved) => {
      const parsed = briefingFormSchema.safeParse(resolved);
      if (parsed.success) {
        return ok({ foldedPages: injected.folded, form: parsed.data });
      }
      const reasons = parsed.error.issues.map((issue) => formIssueLine({ issue }));
      return err(BriefingCommandErrors.formRejected({ reasons, refusedPage: draftPage({ json: resolved }) }));
    }),
  );
}

/**
 * Splice every PROJECTED section into the composed form, in the order they are read back out.
 *
 * One function rather than a chain inline in {@link parseBriefingForm}, because it is one question — is
 * this form allowed to carry what it carries — and because the chain is what put that function over the
 * length cap. Each step refuses a form that authored its own section, and the refusal names the flag that
 * fills it instead.
 *
 * @param json the parsed form, before validation
 * @param yourList the projected list, absent when the run named no document
 * @param ownerBeliefs the projected correction block, absent when the run asked for none
 * @param handSteps the projected hand-steps section, absent when the run asked for none
 * @param autonomy the projected autonomy ledger, absent when the run asked for none
 * @param quiz the projected question, absent when the run asked for none
 * @param openArtifacts the derived index, absent when the run named no document
 * @param openPrs every open pull request as a card, absent when the run asked for none
 * @param openPageCards one card per open page, absent when the run asked for none
 * @param freshness the freshness section, absent when the run asked for none
 * @param nothingStale the Nothing stale section, absent when the run asked for none
 * @param narrative the three projected narrative sections, absent when the run asked for none
 * @param stamps the two instants the eyebrow states, which a form may not write
 * @returns the form with every projection attached and the pages whose second card folded, or the first
 *   refusal
 */
function injectProjections({
  json,
  yourList,
  ownerBeliefs,
  handSteps,
  autonomy,
  quiz,
  openArtifacts,
  openPrs,
  openPageCards,
  freshness,
  nothingStale,
  narrative,
  stamps,
}: {
  json: unknown;
  yourList: BriefingYourList | undefined;
  autonomy: BriefingAutonomy | undefined;
  ownerBeliefs: BriefingOwnerBeliefs | undefined;
  handSteps: BriefingHandSteps | undefined;
  quiz: BriefingQuiz | undefined;
  openArtifacts: readonly BriefingOpenArtifact[] | undefined;
  openPrs: Pick<BriefingReactNow, "meFacing" | "teamFacing"> | undefined;
  openPageCards: readonly BriefingCard[] | undefined;
  freshness: BriefingSection | undefined;
  nothingStale: BriefingSection | undefined;
  narrative: BriefingNarrativeSections | undefined;
  stamps: BriefingStamps;
}): Result<{ readonly json: unknown; readonly folded: readonly FoldedPage[] }, BriefingCommandError> {
  // One `andThen` chain rather than nine unwrap-and-return blocks: the ORDER is the whole content of this
  // function, and spelled as a chain it is the only thing a reader has to follow. The narrative runs BEFORE
  // the stamps, and before anything is appended, because its refusal names three fields a composer has to
  // delete — reported after a stamp refusal, the owner would fix them one render at a time.
  return injectYourList({ json, yourList })
    .andThen((next) => injectOwnerBeliefs({ json: next, ownerBeliefs }))
    .andThen((next) => injectQuiz({ json: next, quiz }))
    .andThen((next) => injectOpenArtifacts({ json: next, openArtifacts }))
    .andThen((next) => injectAutonomy({ autonomy, json: next }))
    .andThen((next) => injectHandSteps({ handSteps, json: next }))
    .andThen((next) => injectNarrative({ json: next, narrative }))
    .andThen((next) => injectStamps({ json: next, stamps }))
    .andThen((next) => appendCards({ freshness, json: next, nothingStale, openPageCards, openPrs }));
}

/**
 * The tail of {@link injectProjections}: the two card projections, then the freshness and Nothing stale sections.
 *
 * Split out so its parent stays under the length cap, and it is THIS tail that split off rather than an
 * earlier one because the three steps share an order that matters. The pull-request cards land before the
 * open-page cards, so the fold reads a block already carrying everything a projection can add to it, and
 * the two sections run last because they touch no card at all.
 *
 * @param json the form after every earlier projection has been attached
 * @param openPrs every open pull request as a card, absent when the run asked for none
 * @param openPageCards one card per open page, absent when the run asked for none
 * @param freshness the freshness section, absent when the run asked for none
 * @param nothingStale the Nothing stale section, absent when the run asked for none
 * @returns the form with the cards and both sections attached, beside the pages whose second card folded, or
 *   the first section's refusal
 */
function appendCards({
  json,
  openPrs,
  openPageCards,
  freshness,
  nothingStale,
}: {
  json: unknown;
  openPrs: Pick<BriefingReactNow, "meFacing" | "teamFacing"> | undefined;
  openPageCards: readonly BriefingCard[] | undefined;
  freshness: BriefingSection | undefined;
  nothingStale: BriefingSection | undefined;
}): Result<{ readonly json: unknown; readonly folded: readonly FoldedPage[] }, BriefingCommandError> {
  const withCards = appendOpenPrCards({ json, openPrs });
  const withPages = appendOpenPageCards({ cards: openPageCards, json: withCards });
  return injectFreshness({ freshness, json: withPages.json })
    .andThen((next) => injectNothingStale({ json: next, nothingStale }))
    .map((next) => ({ folded: withPages.folded, json: next }));
}

/**
 * What the eyebrow states and a composer may not: the recorded pass behind the page, this render's, and
 * every half of the page whose snapshot was too old to publish.
 *
 * @internal — the shape {@link parseBriefingForm} takes and `./renderRun.ts` builds inline.
 */
export interface BriefingStamps {
  readonly refreshedIso: string;
  readonly readyIso: string;
  /**
   * Absent on an ordinary page. Present only when the stale-snapshot hatch was taken, because the run
   * refuses otherwise — see `../../staleSnapshotDoor.ts`.
   */
  readonly staleSnapshots?: readonly BriefingStaleSnapshot[] | undefined;
}

/**
 * Put the two instants into the form's header, refusing a form that writes either.
 *
 * The refusal is the whole mechanism, and it makes structural the owner's need never to question whether the page they are reading is up to date,
 * since that trust is what they react to. A composer free to write a freshness claim is one who can write a current-looking
 * instant onto a stale page, which is exactly the page the owner stopped trusting. Both come off a clock instead —
 * `refreshedIso` from the newest recorded pass when `--ticks` supplied one, and this render's otherwise.
 *
 * `staleSnapshots` is refused from a composer for the sharper version of the same reason: it is the page
 * saying which of its own halves is out of date, and a composer able to write it is a composer able to
 * leave it off.
 *
 * @param json the parsed form, before validation
 * @param stamps the instants, and any stale half this run is publishing anyway
 * @returns the form with the stamps attached, or the refusal
 */
function injectStamps({
  json,
  stamps,
}: {
  json: unknown;
  stamps: BriefingStamps;
}): Result<unknown, BriefingCommandError> {
  if (!isRecord(json)) {
    return ok(json);
  }
  const header = json["header"];
  if (!isRecord(header)) {
    // Left exactly as it arrived, so the schema reports "header: expected object" rather than this function
    // inventing a header whose every other required field is then reported missing.
    return ok(json);
  }
  const written = ["refreshedIso", "readyIso", "staleSnapshots"].filter((field) => header[field] !== undefined);
  if (written.length > 0) {
    return err(BriefingCommandErrors.stampsComposed({ fields: written }));
  }
  return ok({ ...json, header: { ...header, ...stamps } });
}

/**
 * Append every open pull request's card to the grouping it belongs in, behind whatever the form composed.
 *
 * Composed cards come FIRST inside each grouping, and that ordering is a judgement rather than a
 * convenience: a card a supervisor wrote is a decision nobody else is tracking, while a pull-request card is
 * one of up to thirty-six rows of a sweep that runs again next tick. A projection that pushed the owner's own
 * decisions below thirty of them would bury the thing this page exists for.
 *
 * Unlike `yourList`, an authored `reactNow` is NOT refused: it is the supervisor's own section and always
 * has been. What the projection may not do is silently replace it, which is why this appends.
 *
 * @param json the parsed form, before validation
 * @param openPrs the projected groupings, absent when the run asked for none
 * @returns the form with the projected cards appended
 */
function appendOpenPrCards({
  json,
  openPrs,
}: {
  json: unknown;
  openPrs: Pick<BriefingReactNow, "meFacing" | "teamFacing"> | undefined;
}): unknown {
  if (openPrs === undefined || !isRecord(json)) {
    return json;
  }
  const composed = json["reactNow"];
  const team = isRecord(composed) && Array.isArray(composed["teamFacing"]) ? composed["teamFacing"] : [];
  const mine = isRecord(composed) && Array.isArray(composed["meFacing"]) ? composed["meFacing"] : [];
  // The composed block is SPREAD rather than rebuilt from its two card arrays: rebuilding silently drops every other
  // field the block carries, such as the ranked open-artifact index, so a run with `--open-prs` would delete the
  // very thing the owner asked for. A projection that appends to one field may not erase the rest.
  const rest = isRecord(composed) ? composed : {};
  return {
    ...json,
    reactNow: {
      ...rest,
      meFacing: [...mine, ...openPrs.meFacing],
      teamFacing: [...team, ...openPrs.teamFacing],
    },
  };
}

/**
 * Append one card per open page, behind the composed cards and behind the pull-request ones.
 *
 * Every open page gets its own card carrying the six fields, instead of eighteen of them
 * living as numbered lines in one card's fold. They go LAST inside `meFacing` for the same reason a
 * pull-request card does — a card a supervisor wrote is a decision nobody else is tracking, and a projection
 * that ran again next tick must never push one of those below itself.
 *
 * Me-facing rather than team-facing, because the grouping is AUDIENCE: each of these is a page nobody but
 * the owner is reading. It declares no autonomy (`AGENTS.md` rule 10).
 * The one card these replace was me-facing too.
 *
 * The block is SPREAD, never rebuilt — see {@link appendOpenPrCards} for the defect that rule closed.
 *
 * ONE CARD PER PAGE: a page the block already cards gets no second one, since asking twice is noise, and `../../../briefing/openPageFold.ts` carries the criterion, the measurement, and why the
 * composed card is the one that survives.
 *
 * @param json the parsed form, before validation
 * @param cards the projected cards, absent when the run named no document
 * @returns the form with the surviving cards appended, and every page whose second card folded away
 */
function appendOpenPageCards({ json, cards }: { json: unknown; cards: readonly BriefingCard[] | undefined }): {
  readonly json: unknown;
  readonly folded: readonly FoldedPage[];
} {
  if (cards === undefined || cards.length === 0 || !isRecord(json)) {
    return { folded: [], json };
  }
  const composed = json["reactNow"];
  // ONE CARD PER PAGE. A page the block already cards gets no second one, since asking twice is noise. The fold runs here because this is the only point holding both the composed block and
  // the projection; `../../../briefing/openPageFold.ts` owns the criterion and why it is exact.
  const fold = foldCardedPages({ block: composed, cards });
  const mine = isRecord(composed) && Array.isArray(composed["meFacing"]) ? composed["meFacing"] : [];
  const rest = isRecord(composed) ? composed : {};
  return { folded: fold.folded, json: { ...json, reactNow: { ...rest, meFacing: [...mine, ...fold.cards] } } };
}

/**
 * Render a validated form into the bytes that would be published.
 *
 * Rendering is separated from checking because one half of the gate needs a live read, and the addresses to
 * read are only knowable from the rendered page itself: the edge renders, reads what the page names, and
 * then checks. Splitting it here keeps both halves pure and keeps the network at the edge.
 *
 * @param form the validated form
 * @returns the page
 */
export function renderBriefingPage({ form }: { form: BriefingForm }): string {
  return renderBriefing({ form });
}

/**
 * Run the shipped gate over exactly the bytes that would be published.
 *
 * @param html the rendered page
 * @param rules the operator's private exact voice rules, empty when none are configured
 * @param applyVoice whether the packing and voice pass runs; the caps never move
 * @param applyBareRefs whether the bare-reference scan runs; lifted by the same break-glass every other
 *   outbound door honours
 * @param applyFraming whether the four card-framing rules run, lifted by the same per-invocation shape
 * @param nowIso the instant a card's premise age is judged against — this render's, the one the page ages every
 *   card from, so the gate and the ages on the cards agree
 * @param prStates what the live pull-request read answered, keyed by `owner/repo#number`; absent means the
 *   freshness half does not run, which is what the stale-card break-glass passes
 * @param projected whether the narrative sections were projected from the tick ledger, which decides what an
 *   oversized page is told to do about it — see `./errors.ts`'s `renderTooLarge`
 * @returns the page, or the gate's own refusal lines
 */
export function checkRenderedBriefing({
  html,
  rules,
  applyVoice,
  applyBareRefs,
  applyFraming,
  nowIso,
  prStates,
  projected,
}: {
  html: string;
  rules: readonly ExactVoiceRule[];
  applyVoice: boolean;
  applyBareRefs: boolean;
  applyFraming: boolean;
  nowIso: string;
  prStates?: ReadonlyMap<string, PrPremise> | undefined;
  projected: boolean;
}): Result<string, BriefingCommandError> {
  const result = checkBriefing({
    applyBareRefs,
    applyFraming,
    applyVoice,
    html,
    nowIso,
    rules,
    ...(prStates === undefined ? {} : { prStates }),
  });
  if (briefingRefused({ result })) {
    return err(BriefingCommandErrors.renderCheckFailed({ lines: renderBriefingCheck({ result }), refusedPage: html }));
  }
  const bytes = pageTextBytes({ html });
  if (bytes > PAGE_TEXT_MAX_BYTES) {
    return err(BriefingCommandErrors.renderTooLarge({ bytes, cap: PAGE_TEXT_MAX_BYTES, projected, refusedPage: html }));
  }
  return ok(html);
}
