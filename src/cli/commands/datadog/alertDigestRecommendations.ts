/**
 * The recommendation lane of `datadog alert-digest`: which authored recommendations reach the card, and why each
 * other one did not. PURE.
 *
 * Split from `./alertDigestCore.ts`, which builds the counts, the intro and the checked lead. This lane only
 * ever ADDS to a form that already sends, which is the seam: it never decides whether a digest posts.
 */
import {
  type AlertProbeReading,
  orderReadings,
  readingIsAlarming,
  readingSeverity,
} from "../../../datadog/alertProbe.js";
import {
  type RecommendationSelection,
  recommendationWarnings,
  selectRecommendations,
  shedToFit,
} from "../../../live/automation/recommendationSet.js";
import { digestFormSchema, digestToUpdate } from "../../../outbound/artifact/digest.js";
import type { DigestForm } from "../../../outbound/artifact/digestFields.js";
import type { RecommendationAuthored } from "../../../outbound/artifact/recommendations.js";
import { updateArtifactFitsUntruncated } from "../../../outbound/artifact/schema.js";

/** A built form, plus anything the operator should know about what did not make it onto the card. */
export interface AlertDigestFormOutcome {
  readonly form: DigestForm;
  /** Never empty when a supplied `lead` was dropped, so a missing sentence always has a stated reason. */
  readonly warnings: readonly string[];
  /** Which authored recommendations reached the card, and why each other one did not. */
  readonly recommendations: RecommendationSelection;
}

/** No recommendation lane at all. */
const NO_RECOMMENDATIONS: RecommendationSelection = { dropped: [], kept: [] };

/**
 * The recommendation lane over an already-built form: match each authored recommendation to a firing probe,
 * then shed from the tail until the card sends with nothing truncated.
 *
 * Recommendations are matched to firing probes by probe `id` and then shed from the tail until the card sends
 * with nothing truncated (`live/automation/recommendationSet.ts`). A card that would be refused without them is
 * left exactly as refusable as before: this lane never decides whether a digest posts. A `clears` naming no
 * declared probe is DROPPED as `clears-unknown` rather than refused here, for the same reason — an
 * adversarial review pass found that refusing it cost the whole card at the unattended hour, over a typo.
 *
 * @param built the form and its warnings so far
 * @param readings every reading the run took
 * @param recommendations the row's authored set
 * @returns the form carrying what was kept, the warnings so far plus the lane's own, and the selection
 */
export function selectDigestRecommendations({
  built,
  readings,
  recommendations,
}: {
  built: { readonly form: DigestForm; readonly warnings: readonly string[] };
  readings: readonly AlertProbeReading[];
  recommendations: readonly RecommendationAuthored[];
}): AlertDigestFormOutcome {
  if (recommendations.length === 0) {
    return { ...built, recommendations: NO_RECOMMENDATIONS };
  }
  const fired = orderReadings({ readings })
    .filter((reading) => readingIsAlarming({ reading }))
    .map((reading) => ({ key: reading.probe.id, severity: readingSeverity({ reading }) }));
  const selection = shedToFit({
    fits: (kept) => digestSends({ form: { ...built.form, recommendations: [...kept] } }),
    selection: selectRecommendations({
      authored: recommendations,
      fired,
      known: orderReadings({ readings }).map((reading) => reading.probe.id),
    }),
  });
  const shed = selection.dropped.filter((dropped) => dropped.reason === "shed-to-fit");
  let form: DigestForm = built.form;
  if (selection.kept.length > 0) {
    form = { ...built.form, recommendations: [...selection.kept] };
  }
  // Shedding every recommendation can still leave a card over its caps, when the items alone overrun them; the
  // line then says so rather than claiming a fit the door will refuse.
  const outcome = digestSends({ form })
    ? "recommendation shed so the card fits with nothing truncated"
    : "recommendation shed, and the card is still over its caps without it, so the door refuses it unless this session holds a truncated-send grant";
  const warnings = [
    ...built.warnings,
    ...shed.map((dropped) => `${outcome}: ${dropped.change}`),
    ...recommendationWarnings({ selection }),
  ];
  return { form, recommendations: selection, warnings };
}

/** Whether a digest form is accepted AND its card sends with nothing truncated, break-glass or not. */
function digestSends({ form }: { form: DigestForm }): boolean {
  if (!digestFormSchema.safeParse(form).success) {
    return false;
  }
  return updateArtifactFitsUntruncated({ artifact: digestToUpdate({ form, isKnownPerson: () => false }).artifact });
}
