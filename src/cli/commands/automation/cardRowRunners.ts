/**
 * The two kinds whose tick is a READ whose stdout becomes a CARD — `alert-summary` and
 * `datadog-alert-digest`.
 *
 * Split out of `./rowRunners.ts` when owner turn 291-8x added a post-target admission to every card leg and
 * that file crossed its size ratchet. The seam is the one the old file's own header already named: these
 * two kinds are a read leg whose single stdout document is a door-routed post leg's input, and every other
 * kind is not. What lives here therefore changes when the CARD path changes — where a card may land, what
 * pictures ride with it, what a malformed read costs — while `rowRunners.ts` changes when the set of kinds
 * or the tick's dispatch does.
 *
 * They are still two functions rather than one generic runner, for the reason that file gave: they share a
 * SHAPE and nothing else — different planners, different flags, different refusals, and a failure line that
 * has to name the verb a reader would run by hand. Folding them would make every one of those points a
 * branch on kind, which is what these two functions already are, with the argv construction hidden a layer
 * further away.
 */
import { alertSummaryPostArgv, alertSummaryReadRest, planAlertSummary } from "../../../live/automation/alertSummary.js";
import {
  type DatadogAlertDigestPlan,
  datadogAlertDigestPostArgv,
  datadogAlertDigestReadRest,
  planDatadogAlertDigest,
} from "../../../live/automation/datadogAlertDigest.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import type { RecipeDefinitionRun } from "../../../live/automation/definitionRunStore.js";
import { slotDeliveryKey } from "../../../live/automation/slotLedger.js";
import { appendVerbFailureWhy } from "../../../live/automation/verbFailureWhy.js";
import { EXIT_OK } from "../../exitCodes.js";
import { cardOutcome } from "./cardOutcome.js";
import { noteCardPosting } from "./cardPostingNote.js";
import type { CollectedLeg } from "./collectLeg.js";
import { shotDetailLines, unboundMediaLines } from "./digestShotLines.js";
import { admitScheduledPostTarget } from "./postTargetLeg.js";
import type { RecipeRunDueDeps, RowOutcome } from "./rowRunners.js";

/**
 * What one card row's tick is handed — the same bag for both kinds, because the read-then-post shape is
 * exactly what they share.
 *
 * Extracted rather than written inline twice: these fields are a real contract between `rowRunners.ts`'s
 * dispatcher and both runners, so a field added to one and forgotten on the other is a compile error here
 * instead of a missing argument nobody notices. `media` is carried on both even though only the digest
 * kind reads it — a summary row that was handed captures has nowhere to put them, and the digest's own
 * `mediaRefusal` is where that gets said out loud.
 */
interface CardRowInput {
  readonly definition: RecipeDefinition;
  readonly deps: RecipeRunDueDeps;
  readonly dryRun: boolean;
  readonly home: string;
  /** The shared not-yet-run outcome fields every arm spreads over. */
  readonly base: Omit<RowOutcome, "line">;
  /** The graded captures to attach, empty on every row that did not ask for shots. */
  readonly media: readonly string[];
  /** The cadence firing this run covers — what every write leg delivers under. */
  readonly slotIso: string;
  /** The row's run record, absent when no firing of it has ever settled — the day-one intro's trigger. */
  readonly priorRun: RecipeDefinitionRun | undefined;
}

/**
 * The ONE form document a two-leg row's read produced, or the failure line to report instead.
 *
 * Both two-leg kinds have the same shape here — a read whose stdout is the write leg's input — and the same
 * two refusals: the read failed, or it emitted anything other than exactly one document. `--form` emits the
 * whole document in one write, which is what makes the form the read produced and the form the post sends
 * the same bytes; anything else on that channel means the two would differ, so the row refuses rather than
 * posting a reassembled card nobody rendered.
 *
 * @param read what the read leg answered
 * @param readLeg the read leg alone, which is the command a reader would run by hand
 * @param recipeId the row being run
 * @returns the form, or the line saying why nothing was posted
 */
function formFromReadLeg({
  read,
  readLeg,
  recipeId,
}: {
  read: CollectedLeg;
  readLeg: string;
  recipeId: string;
}): { readonly form: string } | { readonly failure: string } {
  if (read.exitCode !== EXIT_OK) {
    return {
      failure: appendVerbFailureWhy({
        diagnostics: read.diagnostics,
        line: `recipe ${recipeId} · READ FAILED · ${readLeg} · exit ${String(read.exitCode)} · nothing was posted`,
      }),
    };
  }
  if (read.lines.length !== 1) {
    // A zero exit with the wrong output is still this leg's failure, so its stderr is still the cause.
    return {
      failure: appendVerbFailureWhy({
        diagnostics: read.diagnostics,
        line:
          `recipe ${recipeId} · READ FAILED · ${readLeg} · emitted ${String(read.lines.length)} document(s) ` +
          "on stdout, expected exactly 1 · nothing was posted",
      }),
    };
  }
  return { form: read.lines[0]! };
}

/**
 * Run one `alert-summary` row: read the monitored window, then post the card the read composed.
 *
 * ## `--dry-run` here RUNS the read and renders the card
 *
 * Unlike `verb-run`'s, and the difference is what each kind can promise. An alert-summary run's read leg is
 * read-only by construction and its write leg is `slack post`, which has its own `--dry-run` that renders
 * the card and withholds the network call. So a dry run goes down the REAL send path and stops at the wire,
 * and what it prints is the card the channel would have seen — not a description of one. A dry run that
 * only echoed a plan would prove nothing about the document, which is the whole thing a reader wants
 * checked before a card starts going out unattended.
 *
 * A dry run is never STAMPED: it leaves `ran` false, so the row is still due and a real tick will send it.
 *
 * @param definition the due row
 * @param deps the injected edges
 * @param dryRun whether to withhold the send at the wire
 * @param home the state home this tick is running over
 * @param base the shared not-yet-run outcome fields
 * @returns what happened, ready to print
 */
export async function runAlertSummaryRow({
  definition,
  deps,
  dryRun,
  home,
  base,
  slotIso,
  priorRun,
}: CardRowInput): Promise<RowOutcome> {
  const plan = planAlertSummary({ definition });
  if (plan.isErr()) {
    return { ...base, failed: true, line: `recipe ${definition.recipeId} · REFUSED · ${plan.error.message}` };
  }
  // Where the card lands, decided before a single Datadog or Slack read is spent on it. The row's own
  // `postTo` is a REQUEST: absent resolves to the owner's DM, and a channel the owner has not approved for this row is
  // refused outright.
  const postTo = admitScheduledPostTarget({
    definition,
    dmChannel: deps.promptChannel({ home }),
    requested: plan.value.postTo,
    where: "params.postTo",
  });
  if ("refusal" in postTo) {
    return { ...base, failed: true, line: postTo.refusal };
  }
  const read = await deps.runAlertSummaryRead({ rest: alertSummaryReadRest({ home, plan: plan.value, priorRun }) });
  const legs = `slack alert-summary --channel ${plan.value.channel} → slack post --as bot --channel ${postTo.channel}`;
  const document = formFromReadLeg({
    read,
    readLeg: `slack alert-summary --channel ${plan.value.channel}`,
    recipeId: definition.recipeId,
  });
  if ("failure" in document) {
    return { ...base, failed: true, line: document.failure };
  }
  const form = document.form;
  const idempotencyKey = slotDeliveryKey({ recipeId: definition.recipeId, slotIso });
  const { diagnostics, exitCode: posted } = await deps.runVerbKeepingDiagnostics(
    alertSummaryPostArgv({ dryRun, form, home, idempotencyKey, postTo: postTo.channel }),
  );
  noteCardPosting({
    channel: postTo.channel,
    deps,
    dryRun,
    home,
    idempotencyKey,
    posted,
    recipeId: definition.recipeId,
    slotIso,
  });
  return cardOutcome({
    base,
    diagnostics,
    dryRun,
    legs,
    posted,
    problem: plan.value.recommendationsProblem,
    recipeId: definition.recipeId,
  });
}

/**
 * Whether the captures handed back may ride with this card, and the refusal to print if they may not.
 *
 * Two independent ways a `--media` argument is wrong, kept out of the runner because neither is about the
 * digest: the row never asked for a picture at all, or a picture pictures no view the card cites. Both
 * refuse BEFORE the post rather than dropping an attachment quietly, since an operator who took a capture
 * and saw the card go out without it has no way to tell which happened.
 *
 * @param base the shared not-yet-run outcome fields
 * @param form the card document the read leg built
 * @param home the state home this tick is running over
 * @param media the graded captures handed back, empty on a row that asked for none
 * @param recipeId the row being run
 * @param shots whether the row's params asked for pictures
 * @returns the refusal outcome, or undefined when the attachments are fit to send
 */
function mediaRefusal({
  base,
  form,
  home,
  media,
  recipeId,
  shots,
}: {
  base: Omit<RowOutcome, "line">;
  form: string;
  home: string;
  media: readonly string[];
  recipeId: string;
  shots: boolean;
}): RowOutcome | undefined {
  if (media.length === 0) {
    return undefined;
  }
  if (!shots) {
    return {
      ...base,
      failed: true,
      line:
        `recipe ${recipeId} · REFUSED · --media was given for a row whose params carry no ` +
        "'shots', so nothing here asked for a picture · nothing was posted",
    };
  }
  const unbound = unboundMediaLines({ form, home, media });
  if (unbound.length === 0) {
    return undefined;
  }
  return {
    ...base,
    detail: unbound.map((line) => `recipe ${recipeId} · unbound image · ${line}`),
    failed: true,
    line:
      `recipe ${recipeId} · REFUSED · ${String(unbound.length)} attachment(s) do not picture a ` +
      "view this card cites · nothing was posted",
  };
}

/**
 * Run one `datadog-alert-digest` row: count every declared probe, then post the card through the door.
 *
 * Structurally identical to {@link runAlertSummaryRow} and deliberately not folded into it. The two share a
 * SHAPE — a read leg whose stdout is the write leg's input — and nothing else: different planners,
 * different flags, different refusals, and a failure line that has to name the verb a reader should run by
 * hand. A single generic runner over both would have to branch on kind at every one of those points, which
 * is the same branch this function is, with the argv construction hidden a layer further away.
 *
 * ## A `shots` row prints what to photograph, and posts whatever came back
 *
 * The three daily digests carry cropped, annotated Datadog captures. A
 * capture is taken in the owner's own Chrome by the session this row was seated in (`live/automation/definitionShape.ts`),
 * so this function cannot take one. It does the two things it can: it derives the shot list from the card
 * it just counted (`live/automation/digestShots.ts`) and prints one command per picture, and it attaches
 * whatever the seated session hands back on `--media`.
 *
 * The card is NEVER held for a picture. A capture that could not be taken costs the card an image and a
 * printed line saying so, because the promise the steer made is a digest within 24 hours.
 *
 * @param definition the due row
 * @param deps the injected edges
 * @param dryRun whether to withhold the send at the wire
 * @param home the state home this tick is running over
 * @param base the shared not-yet-run outcome fields
 * @param media the graded captures to attach, empty on every row that did not ask for shots
 * @returns what happened, ready to print
 */
export async function runAlertDigestRow({
  definition,
  deps,
  dryRun,
  home,
  base,
  media,
  slotIso,
  priorRun,
}: CardRowInput): Promise<RowOutcome> {
  const plan = planDatadogAlertDigest({ definition });
  if (plan.isErr()) {
    return { ...base, failed: true, line: `recipe ${definition.recipeId} · REFUSED · ${plan.error.message}` };
  }
  // Where the card lands, decided before a probe's aggregate is spent on it. A digest row's `channel` is a
  // REQUEST since owner turn 291-8x, exactly as an alert summary's `postTo` is.
  const postTo = admitScheduledPostTarget({
    definition,
    dmChannel: deps.promptChannel({ home }),
    requested: plan.value.channel,
    where: "params.channel",
  });
  if ("refusal" in postTo) {
    return { ...base, failed: true, line: postTo.refusal };
  }
  const read = await deps.runAlertDigestRead({ rest: datadogAlertDigestReadRest({ plan: plan.value, priorRun }) });
  const legs = `datadog alert-digest --label ${plan.value.label} → slack post --as bot --channel ${postTo.channel}`;
  const document = formFromReadLeg({
    read,
    readLeg: `datadog alert-digest --label ${plan.value.label}`,
    recipeId: definition.recipeId,
  });
  if ("failure" in document) {
    return { ...base, failed: true, line: document.failure };
  }
  const { form } = document;
  const unfit = mediaRefusal({ base, form, home, media, recipeId: definition.recipeId, shots: plan.value.shots });
  if (unfit !== undefined) {
    return unfit;
  }
  return postDigestCard({
    base,
    deps,
    dryRun,
    form,
    home,
    idempotencyKey: slotDeliveryKey({ recipeId: definition.recipeId, slotIso }),
    legs,
    media,
    plan: plan.value,
    postTo: postTo.channel,
    slotIso,
  });
}

/**
 * Post the card the read leg built, with whatever captures came back, and say what happened.
 *
 * @param base the shared not-yet-run outcome fields
 * @param deps the injected edges
 * @param dryRun whether to withhold the send at the wire
 * @param form the card document
 * @param home the state home this tick is running over
 * @param idempotencyKey the firing's own delivery id, so the door refuses a second delivery of one firing
 * @param legs the two verbs, printed so a reader can run them by hand
 * @param media the graded captures to attach
 * @param plan the resolved plan
 * @param postTo the conversation admitted for this card
 * @param slotIso the firing the card delivers, which its posting is recorded under
 * @returns what happened, ready to print
 */
async function postDigestCard({
  base,
  deps,
  dryRun,
  form,
  home,
  idempotencyKey,
  legs,
  media,
  plan,
  postTo,
  slotIso,
}: {
  base: Omit<RowOutcome, "line">;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  form: string;
  home: string;
  idempotencyKey: string;
  legs: string;
  media: readonly string[];
  plan: DatadogAlertDigestPlan;
  /** The conversation the card lands in, already admitted by `live/automation/postTarget.ts`. */
  postTo: string;
  slotIso: string;
}): Promise<RowOutcome> {
  const detail = plan.shots ? shotDetailLines({ form, home, media, recipeId: plan.recipeId }) : [];
  const { diagnostics, exitCode: posted } = await deps.runVerbKeepingDiagnostics(
    datadogAlertDigestPostArgv({ dryRun, form, home, idempotencyKey, media, postTo }),
  );
  noteCardPosting({ channel: postTo, deps, dryRun, home, idempotencyKey, posted, recipeId: plan.recipeId, slotIso });
  return {
    ...cardOutcome({
      base,
      diagnostics,
      dryRun,
      legs,
      posted,
      problem: plan.recommendationsProblem,
      recipeId: plan.recipeId,
    }),
    detail,
  };
}
