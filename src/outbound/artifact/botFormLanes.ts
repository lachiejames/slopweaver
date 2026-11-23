/**
 * The PARSING lane of every bot form kind: one `parse*Form` per kind, and the derived-card safety net the
 * domain lanes share.
 *
 * Split from `./botFormKinds.ts`, which keeps the registry — each kind's discriminant, its fixtures and which
 * of these it dispatches to. The seam is that a lane knows its schema and nothing about the set it belongs to.
 */
import { z } from "zod";

import { err, ok } from "#lib/result.js";
import { type SlackDelivery, SlackDeliveryErrors } from "../slack/deliveryErrors.js";
import { alertSummaryFormSchema, alertSummaryToUpdate, withoutQuotedFlags, withQuotedLabels } from "./alertSummary.js";
import { parseAutomationPrompt } from "./automationPrompt.js";
import { digestFormSchema, digestToUpdate } from "./digest.js";
import { findingFormSchema, findingToUpdate } from "./finding.js";
import { noFoldArtifactSchema } from "./noFoldSchema.js";
import { updateArtifactSchema } from "./schema.js";
import type { SlackBotArtifact, UpdateArtifact } from "./types.js";
import { withoutWitnessQuote, withWitnessQuote, witnessFormSchema, witnessToUpdate } from "./witness.js";

export type ParsedForm = { readonly artifact: SlackBotArtifact; readonly unresolvedOwners: readonly string[] };

/**
 * Every schema violation as its own line, so one parse reports everything wrong rather than the first thing.
 *
 * @returns one line per violation, in the order Zod reported them, with the blank lines dropped
 */
function violations({ error }: { error: z.ZodError }): readonly string[] {
  return z
    .prettifyError(error)
    .split("\n")
    .filter((line) => line.length > 0);
}

/**
 * Which of a DIGEST's fields feed the paragraph a cap refused, so the refusal names something a caller owns.
 *
 * Kept beside the alert-summary one below rather than inside the lane, because the two are the whole reason
 * {@link validateDerivedCard} takes a remedy instead of composing one from `kind`: the fields that interact are
 * different per form, and a generic "shorten something" would be true of both and useful for neither.
 */
const DIGEST_DERIVED_REMEDY =
  "The caps interact: the detail is built from every item's `substance`, its `ticket.id` (which costs its " +
  "full length as a link label) and its `owner` clause, while `title` and `state` cost nothing because they " +
  "go in the table. Shorten one of those, or drop an item.";

/**
 * The same, for an ALERT SUMMARY — and the contributing fields are almost disjoint from the digest's.
 *
 * This used to say a tally's below-fold detail was a TABLE, which `DETAIL_PROSE_VISIBLE_MAX` does not count,
 * so only the above-fold region could breach a cap. Both halves are now false and a review pass measured
 * each: the rows the index has no room for render as a `list` (counted in full), and two more lanes joined
 * them below the fold — the recommendations and the Datadog `behind` reading. So BOTH regions are
 * live pressure, and this text names what is in each.
 *
 * `outbound/artifact/alertSummary.ts`'s own header carries the measurement.
 *
 * This string is UNREACHABLE today and is kept correct anyway: the form schema's own `superRefine` runs the
 * same derived-card check first, so `alertSummaryCardRefusal` is what a caller actually reads. A review pass
 * caught a fix for this exact sentence landing here and not there — which is the whole hazard of a second
 * copy, and why this comment now says which one prints.
 */
const ALERT_SUMMARY_DERIVED_REMEDY =
  "The caps interact in BOTH regions. Above the fold: `label`, `window`, `lead` and the noisiest rows' " +
  "`label`s share one region cap, and `omitted`'s two counts reach the TL;DR through the derived total. " +
  "Below it: the rows the index had no room for, every `recommendations` entry, and the `behind` reading " +
  "share the detail-prose budget. Shorten `lead`, a row label or a recommendation, or drop an item.";

/**
 * The derived-card safety net, shared by every DOMAIN form lane.
 *
 * A domain form is validated TWICE, and the second pass is not redundant: the form schema bounds the domain
 * INPUT, `updateArtifactSchema` bounds the derived CARD. Running both is what makes "a valid form always sends"
 * a checked property at the seam rather than a promise made in a doc comment.
 *
 * The message used to read "that is a slopweaver defect, not a problem with your input. Please report it", and
 * that was wrong twice over: it was reachable from ordinary input (per-field caps do not compose), and saying so
 * sent people to file bugs instead of shortening a field. Both form schemas now run the same check at FORM
 * level, so what reaches HERE is genuinely unexpected — but the message still leads with what a caller can do,
 * because that is true either way.
 */
function validateDerivedCard({
  kind,
  remedy,
  artifact,
  unresolvedOwners,
}: {
  kind: string;
  remedy: string;
  artifact: UpdateArtifact;
  unresolvedOwners: readonly string[];
}): SlackDelivery<ParsedForm> {
  const derived = updateArtifactSchema.safeParse(artifact);
  if (!derived.success) {
    return err(
      SlackDeliveryErrors.derivedCardInvalid({ kind, remedy, violations: violations({ error: derived.error }) }),
    );
  }
  return ok({ artifact: derived.data, unresolvedOwners });
}

/**
 * The `digest` lane: severities, tickets and owners in, a triage card out — or, with the `alerts` block, the
 * priority-ranked card `datadog alert-digest` emits.
 *
 * The derivation's `warnings` (a basis sentence shed to fit) are not threaded here: they are the alert-digest
 * verb's to report, and it does, on its diagnostic channel before the form reaches this door.
 *
 * @returns the artifact this payload sends and any owner that degraded to plain text, or every violation
 */
export function parseDigestForm({
  raw,
  isKnownPerson,
}: {
  raw: unknown;
  isKnownPerson: (person: string) => boolean;
}): SlackDelivery<ParsedForm> {
  const form = digestFormSchema.safeParse(raw);
  if (!form.success) {
    return err(SlackDeliveryErrors.formInvalid({ reasons: violations({ error: form.error }) }));
  }
  return validateDerivedCard({
    kind: "digest",
    remedy: DIGEST_DERIVED_REMEDY,
    ...digestToUpdate({ form: form.data, isKnownPerson }),
  });
}

/**
 * The `alert-summary` lane: a tally in, a noise-ordered card out.
 *
 * No `isKnownPerson`, because the form carries no owner to ping — see {@link alertSummaryToUpdate}. So
 * `unresolvedOwners` is empty by construction here rather than by nothing having failed to resolve.
 *
 * @returns the artifact this payload sends and any owner that degraded to plain text, or every violation
 */
export function parseAlertSummaryForm({ raw }: { raw: unknown }): SlackDelivery<ParsedForm> {
  const form = alertSummaryFormSchema.safeParse(raw);
  if (!form.success) {
    return err(SlackDeliveryErrors.formInvalid({ reasons: violations({ error: form.error }) }));
  }
  // The layout schema refuses `quoted`, so it validates the card without the flags, and the flags go back on the
  // card it accepted — that card is what the voice rules read (`withQuotedLabels`).
  const validated = validateDerivedCard({
    artifact: withoutQuotedFlags({ artifact: alertSummaryToUpdate({ form: form.data }) }),
    kind: "alert summary",
    remedy: ALERT_SUMMARY_DERIVED_REMEDY,
    unresolvedOwners: [],
  });
  return validated.map((parsed) =>
    parsed.artifact.kind === "update"
      ? { ...parsed, artifact: withQuotedLabels({ artifact: parsed.artifact, form: form.data }) }
      : parsed,
  );
}

/**
 * The `finding` lane: one issue in, one forwardable card out, its priority derived from impact and unique users.
 *
 * The form schema already derives the card and validates it, so the second pass here is the same safety net
 * every domain lane runs rather than a second copy of a check. No `isKnownPerson`: the only people a finding tags
 * are its `escalate` mentions, and an unresolvable mention is a hard error at render rather than plain text.
 *
 * @returns the artifact this payload sends, or every violation
 */
export function parseFindingForm({ raw }: { raw: unknown }): SlackDelivery<ParsedForm> {
  const form = findingFormSchema.safeParse(raw);
  if (!form.success) {
    return err(SlackDeliveryErrors.formInvalid({ reasons: violations({ error: form.error }) }));
  }
  return validateDerivedCard({
    artifact: findingToUpdate({ form: form.data }).artifact,
    kind: "finding",
    remedy: "Shorten `title`, `impact.what`, `introduced`, `tracking.none` or an option.",
    unresolvedOwners: [],
  });
}

/**
 * The `witness` lane: one material finding about a witnessed thread in, one proof-backed card out.
 *
 * The derived card marks the thread's quoted claim `quoted`, which the layout schema refuses on a composed card,
 * so the card is validated without the flag and the flag goes back on the card it accepted — that card is what
 * the voice rules read, and they must judge the bot's own prose, never the thread's words.
 *
 * @returns the artifact this payload sends, or every violation
 */
export function parseWitnessForm({ raw }: { raw: unknown }): SlackDelivery<ParsedForm> {
  const form = witnessFormSchema.safeParse(raw);
  if (!form.success) {
    return err(SlackDeliveryErrors.formInvalid({ reasons: violations({ error: form.error }) }));
  }
  const validated = validateDerivedCard({
    artifact: withoutWitnessQuote({ artifact: witnessToUpdate({ form: form.data }) }),
    kind: "witness",
    remedy: "Shorten `claim.quote` or a `checked` line, or drop one.",
    unresolvedOwners: [],
  });
  return validated.map((parsed) =>
    parsed.artifact.kind === "update"
      ? { ...parsed, artifact: withWitnessQuote({ artifact: parsed.artifact, form: form.data }) }
      : parsed,
  );
}

/**
 * The `no-fold` lane, which derives NOTHING and is never normalised into an update.
 *
 * A no-fold message routed through `updateArtifactSchema` would be rebuilt as a card — which is to say,
 * wrapped in the attachment that makes a Slack message fold, which is the one thing this form exists to
 * prevent.
 *
 * @returns the artifact this payload sends and any owner that degraded to plain text, or every violation
 */
export function parseNoFoldForm({ raw }: { raw: unknown }): SlackDelivery<ParsedForm> {
  const noFold = noFoldArtifactSchema.safeParse(raw);
  if (!noFold.success) {
    return err(SlackDeliveryErrors.formInvalid({ reasons: violations({ error: noFold.error }) }));
  }
  return ok({ artifact: noFold.data, unresolvedOwners: [] });
}

/**
 * The `automation-prompt` lane: the bot's OWN instructions, declared as a shape so a door can see them.
 *
 * It derives a `no-fold` message and is therefore not routed through `updateArtifactSchema`, for the same
 * reason {@link parseNoFoldForm} is not — that path would wrap it in the attachment that makes a message
 * fold. What the separate kind buys is not a different render; it is that `parseSlackForm` can tell the
 * door which payload this was, so `runAdmit.ts` can refuse it anywhere but the one configured private
 * conversation. Schema, not review.
 *
 * No `isKnownPerson`: the message is addressed to the bot in the owner's own DM and names no third party to
 * ping. `unresolvedOwners` is empty by construction rather than by nothing having failed to resolve.
 *
 * @returns the artifact this payload sends and any owner that degraded to plain text, or every violation
 */
export function parseAutomationPromptForm({ raw }: { raw: unknown }): SlackDelivery<ParsedForm> {
  return parseAutomationPrompt({ raw })
    .map((artifact) => ({ artifact, unresolvedOwners: [] }))
    .mapErr((reasons) => SlackDeliveryErrors.formInvalid({ reasons }));
}

/**
 * The `update` lane: the caller already decided the layout, so there is nothing to derive.
 *
 * @returns the artifact this payload sends and any owner that degraded to plain text, or every violation
 */
export function parseUpdateForm({ raw }: { raw: unknown }): SlackDelivery<ParsedForm> {
  const parsed = updateArtifactSchema.safeParse(raw);
  if (!parsed.success) {
    return err(SlackDeliveryErrors.formInvalid({ reasons: violations({ error: parsed.error }) }));
  }
  return ok({ artifact: parsed.data, unresolvedOwners: [] });
}
