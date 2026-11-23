/**
 * The effectful half of the graph-finding image floor: the pure judgement in `./graphFindings.ts`, plus the
 * one read of its journalled `unshown-graphs` hatch.
 *
 * Its own module rather than a function in `./answerForm.ts` for two reasons. Every door an answer form
 * leaves through must enforce the floor over the images IT really sends — a fresh turn's form paths
 * (`parseAnswerArm`), a released hold's locked bytes (`../../cli/commands/queue/queueReleaseAnswer.ts`), an
 * in-place edit's preserved files (`../../cli/commands/slack/lifecycleRunEdit.ts`) — so there has to be one
 * shared place the hatch is read. And `./answerForm.ts` is held at its size by `file-size-ratchet`.
 *
 * The same hatch waives the wider, lower Datadog SCREENSHOT floor (`../artifact/datadogCitation.ts`): any Datadog
 * console page cited owes one picture. A fresh answer meets it here, after the three-picture floor; the Slack
 * card, as-me and draft-record doors meet it through {@link datadogScreenshotFloorRefusals}.
 */
import { hatchOpen } from "../../hatch/open.js";
import { datadogScreenshotAssessment, datadogScreenshotRefusal } from "../artifact/datadogCitation.js";
import type { DetailBlock, InlineRun } from "../artifact/types.js";
import type { BareRefContext } from "../linkify/bareRefs.js";
import { pictureJudgement } from "./citedAndShown.js";
import { GRAPH_FINDING_MIN_IMAGES, graphFindingAssessment, graphFindingRefusal } from "./graphFindings.js";
import type { FigureMeasurement } from "./measuredFigures.js";

/** The part of an answer form the floor names; every other field is walked for graph links, unnamed. */
interface FloorAnswer {
  readonly measurements: readonly FigureMeasurement[];
}

/**
 * The graph-finding floor for one send: a measured answer linking a Datadog graph view carries at least three
 * distinct screenshots, unless this session holds a live `unshown-graphs` grant.
 *
 * @param answer the answer form whose links and measurements decide whether the floor applies
 * @param images what the send attaches — form paths, held upload names or preserved file ids; duplicates count once
 * @param env where the ambient hatch variable is read
 * @param home the state home a journalled grant is read from, when not the default
 * @returns whether the floor is owed (so rule two's question stays quiet), and the refusal when it is not waived
 */
export function graphFindingFloorRefusals({
  answer,
  images,
  env,
  home,
}: {
  answer: FloorAnswer;
  images: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  home?: string | undefined;
}): { readonly owed: boolean; readonly refusals: readonly string[] } {
  const assessment = graphFindingAssessment({ form: answer, images, measurements: answer.measurements });
  if (assessment.kind !== "missing-images") {
    return { owed: false, refusals: [] };
  }
  const waived = hatchOpen({ env, home, id: "unshown-graphs", nowIso: new Date().toISOString() });
  return { owed: true, refusals: waived ? [] : [graphFindingRefusal({ assessment })] };
}

/**
 * The same floor for a bot `finding` card (`../artifact/finding.ts`), which ALWAYS owes it: the form requires a
 * system-of-record view as its citation (`../artifact/findingEvidence.ts`), so there is no criterion left to read off the content. It counts DISTINCT
 * IMAGE DIGESTS rather than paths, so one screenshot under three names, or three PDFs, is not three pictures.
 * The same journalled `unshown-graphs` hatch waives it, read here so the register names one reader.
 *
 * @param citationUrl the evidence view the finding cites, named in the refusal
 * @param imageDigests the digest of every attachment that decoded as an image; duplicates count once
 * @param env where the ambient hatch variable is read
 * @param home the state home a journalled grant is read from, when not the default
 * @returns the refusal, or nothing when three distinct pictures ride along or the hatch is open
 */
export function findingImageFloorRefusals({
  citationUrl,
  imageDigests,
  env,
  home,
}: {
  citationUrl: string;
  imageDigests: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  home?: string | undefined;
}): readonly string[] {
  const distinct = new Set(imageDigests).size;
  if (distinct >= GRAPH_FINDING_MIN_IMAGES) {
    return [];
  }
  const waived = hatchOpen({ env, home, id: "unshown-graphs", nowIso: new Date().toISOString() });
  if (waived) {
    return [];
  }
  return [
    `media: this finding cites its evidence (${citationUrl}) and attaches ${String(distinct)} distinct ` +
      `picture(s); a finding carries at least ${String(GRAPH_FINDING_MIN_IMAGES)} ` +
      "because the panels are the evidence. The same image under two names counts once, and a PDF is not a " +
      "picture. Take them with `slopweaver datadog shot explorer --url <link>` for a Datadog view, or " +
      "`slopweaver browser read` on any other console, record each with `slopweaver browser image-record`, and pass them as `--media a,b,c`. Nothing was sent.",
    'For one deliberate exception open the journalled hatch: `slopweaver hatch open unshown-graphs --reason "<why>"`.',
  ];
}

/**
 * The one-picture floor for any message citing a Datadog console page (`../artifact/datadogCitation.ts`), on the
 * as-me forms and a plain `--body`, a composed bot card and both lanes of `slack draft record`. The same journalled `unshown-graphs`
 * hatch waives it, read here so the register still names one reader for that hatch.
 *
 * @param value the validated form or artifact, walked for Datadog console URLs
 * @param pictureCount how many attachments the send or row carries that decode as a picture
 * @param remedy how this surface attaches a picture, spelled for its caller
 * @param env where the ambient hatch variable is read
 * @param home the state home a journalled grant is read from, when not the default
 * @returns the refusal lines, or nothing when no Datadog page is cited, a picture rides along, or the hatch is open
 */
export function datadogScreenshotFloorRefusals({
  value,
  pictureCount,
  remedy,
  env,
  home,
}: {
  value: unknown;
  pictureCount: number;
  remedy: string;
  env: Readonly<Record<string, string | undefined>>;
  home?: string | undefined;
}): readonly string[] {
  const assessment = datadogScreenshotAssessment({ pictureCount, value });
  if (assessment.kind !== "missing-screenshot") {
    return [];
  }
  const waived = hatchOpen({ env, home, id: "unshown-graphs", nowIso: new Date().toISOString() });
  if (waived) {
    return [];
  }
  return [
    `media: ${datadogScreenshotRefusal({ remedy, urls: assessment.urls })}`,
    'For one deliberate exception open the journalled hatch: `slopweaver hatch open unshown-graphs --reason "<why>"`.',
  ];
}

/** The answer fields its Slack message renders (`./answerMessage.ts`); `followThrough`, `samples` and the rest are not. */
const ANSWER_SHOWN_KEYS: ReadonlySet<string> = new Set([
  "answering",
  "body",
  "citations",
  "grounding",
  "index",
  "lead",
  "measurements",
]);

/** The grounding fields the evidence trail renders (`./evidence.ts`); a verb's `result` and a conversation's `reason` are not. */
const GROUNDING_SHOWN_KEYS: ReadonlySet<string> = new Set(["evidence", "provenance"]);

/** A grounding object cut to the fields the trail renders; anything that is not an object passes through unchanged. */
function groundingShown({ grounding }: { grounding: unknown }): unknown {
  if (typeof grounding !== "object" || grounding === null) {
    return grounding;
  }
  return Object.fromEntries(Object.entries(grounding).filter(([key]) => GROUNDING_SHOWN_KEYS.has(key)));
}

/**
 * The part of an answer form a reader sees, for the Datadog floor to walk: a URL in lifecycle metadata such as
 * `followThrough.what`, or in a grounding field the evidence trail never prints, is not a citation of evidence and
 * owes no picture.
 *
 * @param answer the answer form, or the answer a held release or an edit carries
 * @returns only the rendered fields, with `grounding` cut to its rendered `evidence` and `provenance`
 */
export function answerShownToReader({ answer }: { answer: object }): Record<string, unknown> {
  const shown: Record<string, unknown> = Object.fromEntries(
    Object.entries(answer).filter(([key]) => ANSWER_SHOWN_KEYS.has(key)),
  );
  if ("grounding" in shown) {
    shown["grounding"] = groundingShown({ grounding: shown["grounding"] });
  }
  return shown;
}

/**
 * Every picture refusal a fresh answer earns: the graph-finding floor, then `./citedAndShown.ts`'s rule two
 * UNLESS the floor is owed. Owed, the floor replaces the question — a measured Datadog finding short of three
 * screenshots would otherwise also be told "attach one, or say why none helps", a remedy the floor refuses —
 * and a floor waived by its hatch stays the graph-specific decision, so the generic question stays quiet too.
 *
 * @param answer the linkified answer arm: its links, measurements, images and `noPictureBecause`
 * @param context the same context the bare-reference pass used, which rule two counts references against
 * @param env where the floor's ambient hatch variable is read
 * @param home the state home the verb resolved, whose journal holds both floors' grants; absent, `env` names it
 * @returns one refusal line per violation, floor first
 */
export function answerPictureRefusals({
  answer,
  context,
  env,
  home,
}: {
  answer: FloorAnswer & {
    readonly body: readonly DetailBlock[];
    readonly images: readonly string[];
    readonly index: readonly (readonly InlineRun[])[];
    readonly noPictureBecause?: string | undefined;
  };
  context: BareRefContext;
  env: Readonly<Record<string, string | undefined>>;
  home?: string | undefined;
}): readonly string[] {
  const floor = graphFindingFloorRefusals({ answer, env, home, images: answer.images });
  if (floor.owed) {
    return floor.refusals;
  }
  const datadog = datadogScreenshotFloorRefusals({
    env,
    home,
    pictureCount: new Set(answer.images).size,
    remedy: "list it in `images`",
    value: answerShownToReader({ answer }),
  });
  if (datadog.length > 0) {
    return datadog;
  }
  const pictures = pictureJudgement({
    body: answer.body,
    context,
    index: answer.index,
    pictureCount: answer.images.length,
    reason: answer.noPictureBecause,
    remedy: "`noPictureBecause` on the answer form",
  });
  if (pictures.kind === "held") {
    return [`images: ${pictures.message}`];
  }
  if (pictures.kind === "unasked") {
    return [`noPictureBecause: ${pictures.message}`];
  }
  return [];
}
