/**
 * The seam every Slack send takes its image admission through, and the one error it aborts with.
 *
 * ## Why a seam rather than a direct call
 *
 * `../corpus/slack/writeSend.ts`'s four composite senders are the choke point all six upload lanes pass
 * through — the operator card, the bot's own answer, a recipe response and the drip lane, plus `--media`
 * and a held release, which reach Slack through those same four. But none of them carries a state home or
 * an environment, and giving them one would make a transport module resolve policy. So they take an
 * {@link ImageAdmit} instead: a function their caller built, which already knows the home it is running
 * under.
 *
 * ## It is REQUIRED, never defaulted
 *
 * A defaulted seam would mean "no check" for any caller that forgot one, which is the weaken-the-gate move
 * arrived at by accident — and the same shape `hatch-release` refuses for a hatch read written as a
 * parameter default. Every sender declares it, so a new lane cannot be added without answering the
 * question.
 *
 * ## Refusal ABORTS, by throwing
 *
 * `SlackSendResult` is a provider wire envelope with an `ok: true` and no failure arm
 * (`.claude/rules/error-handling.md` names it as one of the two shapes the hand-rolled-result gate
 * deliberately allows), so a refusal cannot be expressed in what a composite send returns. Throwing is
 * also what this exact class already does: `../corpus/slack/uploadFiles.ts` throws when an image path
 * cannot be read, and the turn path already treats that as an aborted send. So a refused batch raises
 * {@link ImageAdmissionRefused} before the first byte is offered to Slack, rather than half-uploading and
 * reporting afterwards.
 */

import type { Result } from "#lib/result.js";
import type { SlackUpload } from "../corpus/slack/writeTransport.js";
import type { ImageAdmissionError } from "./errors.js";
import { evidenceUnreadableLines, knownBadImageLines, unreadImageRefusalLines } from "./refusals.js";

/**
 * What a sender calls before uploading anything.
 *
 * Takes the whole batch, because a message with a good first image and a bad second must upload neither.
 */
export type ImageAdmit = (args: {
  readonly uploads: readonly SlackUpload[];
}) => Promise<Result<null, ImageAdmissionError>>;

/** The abort a refused batch raises, carrying the lines a reader should see. */
export class ImageAdmissionRefused extends Error {
  /** The rendered refusal, already in the right shape for its arm. */
  public readonly lines: readonly string[];
  /** Which arm refused, so a caller can report it without re-deriving the reason. */
  public readonly code: ImageAdmissionError["code"];

  public constructor({ error, command }: { error: ImageAdmissionError; command: string }) {
    super(error.message);
    this.name = "ImageAdmissionRefused";
    this.code = error.code;
    this.lines = refusalLinesFor({ command, error });
  }
}

/**
 * Render one admission error in the shape its arm requires.
 *
 * The three arms render differently by contract and this is the only place that mapping lives: a `hold`
 * must never be printed with an override line, and an unreadable record must never be printed as though a
 * rule caught something.
 *
 * @param error the typed refusal
 * @param command what the caller was doing, as the owner would type it
 * @returns the lines to print
 * @internal — {@link ImageAdmissionRefused} renders through it; a caller reads `.lines` instead.
 */
export function refusalLinesFor({
  error,
  command,
}: {
  error: ImageAdmissionError;
  command: string;
}): readonly string[] {
  if (error.code === "IMAGE_KNOWN_BAD") {
    return knownBadImageLines({ command, verdict: { findings: error.findings, kind: "known-bad" } });
  }
  if (error.code === "IMAGE_RECORD_MISSING") {
    return unreadImageRefusalLines({ command, digests: error.digests });
  }
  if (error.code === "IMAGE_EVIDENCE_INVALID") {
    return evidenceUnreadableLines({ issues: error.issues });
  }
  return [`the image evidence store could not be read, so nothing was sent: ${error.message}`];
}
