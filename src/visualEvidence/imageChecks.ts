/**
 * The image checks every outbound picture is held to, in ONE place — Slack's five, now asked on GitHub too, plus
 * the crop rule the owner added for GitHub: cropped to what it proves, never a whole screen.
 *
 * ## The five, and where each one's answer already lives
 *
 * The Slack lane never named its checks in one list; it asked them through the image record a session writes after
 * looking (`./types.ts`), each as a field or a closed failure reason:
 *
 * 1. **viewed** — the FINAL bytes were opened and what was seen written down: a `passed` record exists for their
 *    digest (`readBack.observedContent`, never "looks fine").
 * 2. **rendered** — the thing the claim rests on had rendered: `targetState` is `data` or `zero-results`, never
 *    `unloaded` or `empty-panel` (`./recordForm.ts` refuses a pass that says otherwise).
 * 3. **legible** — readable at the size a reader sees it: no record says `illegible`, and where the capture verb
 *    measured prominence (`browser shot`), that measurement found nothing.
 * 4. **context** — the crop kept what a reader needs to check the claim: `contextRetained`.
 * 5. **unobstructed** — no pop-up, banner or modal covers it: `obstruction: "none"` on the deciding record.
 *
 * Writing them as one exported list is the consolidation: `github attach` asks {@link imageCheckFailures} rather than
 * re-deriving the five from the record, so a sixth check is one entry here and both lanes can read it.
 *
 * ## Any failed record decides first, and is terminal
 *
 * The same ordering `./admission.ts` holds to: a `failed` record for these bytes fails its check whatever was
 * written after it, because a later pass cannot un-see a defect in unchanged bytes.
 *
 * Pure: no fs, no clock.
 */
import type { ImageFailureReason, ImageRecord, PixelRect } from "./types.js";

/** The five checks, in the order a refusal names them, each with the rule a reader can check by eye. */
export const IMAGE_CHECKS = [
  { id: "viewed", rule: "the final bytes were opened and what was seen in them is written down" },
  { id: "rendered", rule: "the thing the claim rests on had rendered — data, or a genuine zero result" },
  { id: "legible", rule: "what the claim rests on is readable at the size a reader sees it" },
  { id: "context", rule: "the crop kept the context a reader needs to check the claim" },
  { id: "unobstructed", rule: "no pop-up, banner or modal covers what it shows" },
] as const;

/** One of {@link IMAGE_CHECKS}' ids. */
type ImageCheckId = (typeof IMAGE_CHECKS)[number]["id"];

/** One check that did not hold, and why, in words a refusal prints. */
export interface ImageCheckFailure {
  readonly check: ImageCheckId;
  readonly why: string;
}

/** Which check a closed failure reason is the failure of. */
const CHECK_FOR_REASON: Readonly<Record<ImageFailureReason, ImageCheckId>> = {
  "context-lost": "context",
  "empty-panel": "rendered",
  illegible: "legible",
  obscured: "unobstructed",
  unloaded: "rendered",
};

/**
 * Every check one picture's records fail, in {@link IMAGE_CHECKS} order.
 *
 * @param records every image record the store holds for the picture's digest, oldest first
 * @param measuredLegibilityIssues what the capture verb's own prominence measurement found, when it measured one
 * @returns each failing check once, empty when all five hold
 */
export function imageCheckFailures({
  records,
  measuredLegibilityIssues,
}: {
  records: readonly ImageRecord[];
  measuredLegibilityIssues: readonly string[];
}): readonly ImageCheckFailure[] {
  const failures = new Map<ImageCheckId, string>();
  for (const record of records) {
    if (record.outcome === "failed" && !failures.has(CHECK_FOR_REASON[record.reason])) {
      failures.set(CHECK_FOR_REASON[record.reason], `recorded ${record.reason}: ${record.correction}`);
    }
  }
  if (measuredLegibilityIssues.length > 0 && !failures.has("legible")) {
    failures.set("legible", `the capture measured it unreadable: ${measuredLegibilityIssues.join("; ")}`);
  }
  const deciding = records.at(-1);
  if (deciding === undefined) {
    failures.set("viewed", "no record says anybody opened these bytes — look, then `slopweaver browser image-record`");
  } else if (deciding.outcome === "passed") {
    passedRecordFailures({ failures, record: deciding });
  }
  return IMAGE_CHECKS.flatMap(({ id }) => {
    const why = failures.get(id);
    return why === undefined ? [] : [{ check: id, why }];
  });
}

/**
 * The checks a PASSED deciding record still fails by what it leaves out.
 *
 * @param record the newest record, which passed
 * @param failures the failures found so far, added to in place
 */
function passedRecordFailures({
  record,
  failures,
}: {
  record: Extract<ImageRecord, { outcome: "passed" }>;
  failures: Map<ImageCheckId, string>;
}): void {
  const rendered = record.readBack.targetState === "data" || record.readBack.targetState === "zero-results";
  if (!rendered && !failures.has("rendered")) {
    failures.set("rendered", `the record says the target was ${record.readBack.targetState}`);
  }
  if (!record.readBack.contextRetained && !failures.has("context")) {
    failures.set("context", "the record says the crop did not keep the context a reader needs");
  }
  if (record.obstruction !== "none" && !failures.has("unobstructed")) {
    failures.set(
      "unobstructed",
      'the record does not say nothing covers it — re-record with `"obstruction": "none"` once you have checked',
    );
  }
}

/**
 * Why a capture is not cropped to what it proves, or `null` when it is: the rectangle kept must be strictly smaller
 * than the frame it was cut from, so a whole screen, a whole viewport or a whole terminal dump never passes.
 *
 * @param source the whole frame's dimensions
 * @param cropRect the rectangle kept, in the source's pixels
 * @returns the reason, or `null`
 */
export function wholeFrameProblem({
  source,
  cropRect,
}: {
  source: { readonly widthPx: number; readonly heightPx: number };
  cropRect: PixelRect;
}): string | null {
  const narrower = cropRect.width < source.widthPx;
  const shorter = cropRect.height < source.heightPx;
  if (narrower || shorter) {
    return null;
  }
  return (
    `the capture kept the whole ${String(source.widthPx)}x${String(source.heightPx)} frame — crop it to what it ` +
    "proves, never a whole screen"
  );
}
