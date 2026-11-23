/**
 * `slack draft approve | hold | pick`'s flags: the owner's yes at an anchor, why a row is held, and which draft they chose on a
 * comparison card. Split out of `./draftCore.ts`, which routes the sub-commands, along that seam. Pure.
 */
import { err, ok } from "../../../lib/result.js";
import { carriesWords } from "../../../outbound/slack/carriesWords.js";
import { DRAFT_VARIANTS, type DraftVariant } from "../../../outbound/slack/draftComparison.js";
import { DRAFT_HOLD_REASONS } from "../../../outbound/slack/draftRegister.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";
import type { DraftShared, SlackDraftOptions } from "./draftCore.js";
import { machineIdProblems, RECORD_CARD_PROSE } from "./draftRecordProblems.js";

/**
 * Build an `approve` or `hold`, or why it was refused. `approve` needs the anchor the owner's yes is at; `hold` a reason
 * from the closed set and the words saying what the session saw, because the Queue card prints both to the owner.
 *
 * @param id the row the sub-command names
 * @param shared the flags every sub-command carries
 * @param sub which judgement
 * @param values the parsed string flags
 * @returns the parsed judgement, or its refusals
 */
export function parseDraftJudgement({
  id,
  shared,
  sub,
  values,
}: {
  id: string;
  shared: DraftShared;
  sub: "approve" | "hold";
  values: Readonly<Record<string, string>>;
}): SlackParsed<SlackDraftOptions> {
  if (sub === "approve") {
    const anchor = values["anchor"];
    // The register reads a judgement's text by `carriesWords`, so what this accepts is what it will read back.
    if (anchor === undefined || !carriesWords({ text: anchor })) {
      return err(SlackArgumentErrors.flagRequired({ flag: "--anchor <the owner's yes>" }));
    }
    const variant = variantOf({ values });
    if (variant.isErr()) {
      return err(variant.error);
    }
    return ok({
      anchor,
      id,
      mode: "approve",
      ...shared,
      ...(variant.value === undefined ? {} : { variant: variant.value }),
    });
  }
  const given = values["reason"];
  const reason = DRAFT_HOLD_REASONS.find((known) => known === given);
  const problems: string[] = [];
  if (reason === undefined) {
    problems.push(
      `--reason must be one of ${DRAFT_HOLD_REASONS.join(", ")}${given === undefined ? "" : `, not ${given}`}`,
    );
  }
  const why = values["why"];
  if (why === undefined || !carriesWords({ text: why })) {
    problems.push("--why <what you saw> is required: the Queue card prints it as the reason it was not sent");
  }
  problems.push(...machineIdProblems({ flags: RECORD_CARD_PROSE.flags, values }));
  if (reason === undefined || why === undefined || problems.length > 0) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: problems }));
  }
  return ok({ id, mode: "hold", reason, why, ...shared });
}

/** `--variant`, when given: one of the two drafts a comparison card offers, or the refusal naming both. */
function variantOf({ values }: { values: Readonly<Record<string, string>> }): SlackParsed<DraftVariant | undefined> {
  const given = values["variant"];
  if (given === undefined) {
    return ok(undefined);
  }
  const variant = DRAFT_VARIANTS.find((known) => known === given);
  if (variant === undefined) {
    return err(SlackArgumentErrors.flagsInvalid({ reasons: [`--variant must be original or codex, not ${given}`] }));
  }
  return ok(variant);
}

/**
 * Build a `pick`, or why it was refused: `--variant` is required, `--anchor` optional and must carry words.
 *
 * @param id the row the pick names
 * @param shared the flags every sub-command carries
 * @param values the parsed string flags
 * @returns the parsed pick, or its refusal
 */
export function parseDraftPick({
  id,
  shared,
  values,
}: {
  id: string;
  shared: DraftShared;
  values: Readonly<Record<string, string>>;
}): SlackParsed<SlackDraftOptions> {
  const variant = variantOf({ values });
  if (variant.isErr()) {
    return err(variant.error);
  }
  if (variant.value === undefined) {
    return err(SlackArgumentErrors.flagRequired({ flag: "--variant original|codex" }));
  }
  const anchor = values["anchor"];
  if (anchor !== undefined && !carriesWords({ text: anchor })) {
    return err(SlackArgumentErrors.flagRequired({ flag: "--anchor <where the owner chose>" }));
  }
  return ok({ id, mode: "pick", variant: variant.value, ...shared, ...(anchor === undefined ? {} : { anchor }) });
}
