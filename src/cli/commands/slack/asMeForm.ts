/**
 * Which as-me FORM a `--form` is, and which authored prose the voice rules read out of it.
 *
 * Split out of `./dripCore.ts` under the file-size ratchet, along the seam the two halves already had: this
 * module decides what a source IS, `./dripSourceAssessment.ts` validates one against the bounds declared here,
 * and `dripCore` decides what to DO with it. Everything here is pure, takes the operator's bounds as a
 * parameter, and knows nothing about sending.
 */
import type { z } from "zod";

import { isRecord } from "../../../lib/parsers.js";
import {
  dripArtifactSchema,
  oneCardArtifactSchema,
  oneListArtifactSchema,
} from "../../../outbound/artifact/asMeSchema.js";
import { asMeSequences } from "../../../outbound/artifact/runs.js";
import type { AsMeArtifact } from "../../../outbound/artifact/types.js";
import { runSequenceProse } from "../../../outbound/voice/artifactProse.js";
import { authoredProseOf } from "../../../outbound/voice/exactRules.js";

/**
 * The bounds a `--form` is judged against, whichever of the two form shapes it turns out to be.
 *
 * One bag rather than a bag per shape because the caller does not know which shape it holds until the JSON
 * is parsed — `formSchemaFor` reads that off the value's own `kind` — so splitting these would mean choosing
 * a config before knowing what it configures.
 *
 * @internal Exported only so `./dripSourceAssessment.ts` and this file's own callers name one shape.
 */
export interface AsMeFormBounds {
  /** The visible-character ceiling for one message of a MULTI-message drip. */
  readonly messageVisibleMax: number;
  /** How many messages one drip may carry. */
  readonly maxMessages: number;
  /**
   * The cap for a drip's SOLE message — a link-plus-paragraph announce, never the conversational cadence
   * `messageVisibleMax` bounds. Optional and defaults to `messageVisibleMax`, so every caller that predates
   * this field keeps its old one-cap behaviour unchanged. See `../../../outbound/artifact/asMeSchema.ts`'s
   * `dripArtifactSchema`.
   */
  readonly soleMessageVisibleMax?: number;
  /** The visible-character ceiling for a whole one-card post, every line added together. */
  readonly cardVisibleMax: number;
  /** How many lines one card may carry. */
  readonly maxLines: number;
  /** How many dot points one `{"kind":"one-list"}` roster may carry. */
  readonly maxBullets: number;
}

/**
 * Which `--form` schema this JSON is asking to be judged by, read off its own `kind`.
 *
 * Dispatching on the value rather than on a flag is what keeps the two forms honest about each other: a
 * `{"kind":"one-card"}` handed to the drip schema would fail as an unknown key with no hint that the form
 * exists, and a `--one-card` flag would let a caller claim one shape while sending the other. An unrecognised
 * or absent `kind` falls through to the drip schema, whose `z.literal("drip")` names the field that is wrong.
 *
 * @param config the operator's as-me bounds, from `profile.json`
 * @param raw the parsed JSON, before any validation
 * @returns the schema to validate this form against
 */
export function formSchemaFor({ config, raw }: { config: AsMeFormBounds; raw: unknown }): z.ZodType<AsMeArtifact> {
  if (isRecord(raw) && raw["kind"] === "one-card") {
    return oneCardArtifactSchema({ cardVisibleMax: config.cardVisibleMax, maxLines: config.maxLines });
  }
  if (isRecord(raw) && raw["kind"] === "one-list") {
    return oneListArtifactSchema({
      cardVisibleMax: config.cardVisibleMax,
      maxBullets: config.maxBullets,
      maxTrailing: config.maxLines,
    });
  }
  // Stated rather than `??`d: the field is optional so that every caller predating it keeps its ONE cap,
  // and an `if` is what says that out loud. `AsMeFormBounds` carries the same sentence.
  const { soleMessageVisibleMax } = config;
  if (soleMessageVisibleMax === undefined) {
    return dripArtifactSchema({
      maxMessages: config.maxMessages,
      messageVisibleMax: config.messageVisibleMax,
      soleMessageVisibleMax: config.messageVisibleMax,
    });
  }
  return dripArtifactSchema({
    maxMessages: config.maxMessages,
    messageVisibleMax: config.messageVisibleMax,
    soleMessageVisibleMax,
  });
}

/**
 * Authored prose in a validated as-me artifact; code, mentions, groups and broadcasts are skipped.
 *
 * **A typed link's LABEL is prose, and that is a correction rather than an extension.** This walker used to
 * read `run.type === "text"` alone, so a `{ type: "link", label, url }` contributed nothing — while the label
 * is exactly as authored as a paragraph is, and the URL beside it is the only part that is not. `the bot —
 * live board`, one of the three strings a harvest measured leaking under the owner's own name,
 * is a link label. The fan-out now lives in `../../../outbound/voice/artifactProse.ts` so the as-me and bot
 * lanes cannot disagree about what counts.
 *
 * @param artifact the validated as-me send
 * @returns one entry per authored region, each carrying the form path it was written at
 */
export function voiceProseOf({ artifact }: { artifact: AsMeArtifact }): readonly { path: string; text: string }[] {
  if (artifact.kind === "plain") {
    return authoredProseOf({ path: "body", text: artifact.text });
  }
  return asMeSequences({ artifact }).flatMap((sequence) =>
    runSequenceProse({ path: `${sequence.field}[${String(sequence.index)}]`, runs: sequence.runs }),
  );
}
