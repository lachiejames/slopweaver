/**
 * The ATTACH-UPLOAD half of `handover rule`: reading `--attach-upload permitted|refused` into the shape a ruling
 * carries, and the line the verb prints once one is recorded. What reads it is
 * `../../../handover/attachUploadRuling.ts`; its own module so `./ruleRun.ts` stays one ruling's verb, the shape
 * `./ruleStandingSession.ts` set.
 */
import { err, ok, type Result } from "#lib/result.js";

import { ATTACH_UPLOAD_VERDICTS, type AttachUploadRuling } from "../../../handover/attachUploadRulingTypes.js";

/** `--attach-upload` named a value that is not one of the verdicts. */
export interface AttachUploadVerdictUnknownError {
  readonly code: "ATTACH_UPLOAD_VERDICT_UNKNOWN";
  readonly message: string;
  readonly declared: string;
}

/** Why `handover rule` refuses its `--attach-upload` flag. One variant today; a caller branches on `code`. */
export type RuleAttachUploadError = AttachUploadVerdictUnknownError;

/** The factories for {@link RuleAttachUploadError}. */
export const RuleAttachUploadErrors = {
  verdictUnknown: ({ declared }: { declared: string }): AttachUploadVerdictUnknownError => ({
    code: "ATTACH_UPLOAD_VERDICT_UNKNOWN",
    declared,
    message: `--attach-upload "${declared}" is not a verdict — pass ${ATTACH_UPLOAD_VERDICTS.join(" or ")}`,
  }),
} as const;

/**
 * The attach-upload verdict one invocation declares.
 *
 * @param values the parsed flags, read for `attach-upload`
 * @returns the verdict, `undefined` for a ruling that decides nothing about attach upload, or why the flag is refused
 */
export function attachUploadPlan({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): Result<AttachUploadRuling | undefined, RuleAttachUploadError> {
  const declared = values["attach-upload"];
  if (typeof declared !== "string") {
    return ok(undefined);
  }
  const verdict = ATTACH_UPLOAD_VERDICTS.find((one) => one === declared.trim());
  if (verdict === undefined) {
    return err(RuleAttachUploadErrors.verdictUnknown({ declared }));
  }
  return ok({ verdict });
}

/**
 * Say what a recorded attach-upload ruling now does.
 *
 * @param attachUpload the verdict just recorded
 * @returns the line
 */
export function attachUploadAnnouncement({ attachUpload }: { attachUpload: AttachUploadRuling }): string {
  if (attachUpload.verdict === "permitted") {
    return (
      "  it PERMITS `github attach upload` on this install, every picture check still applying, until a later " +
      "--attach-upload refused ruling closes it"
    );
  }
  return (
    "  it REFUSES `github attach upload` on this install: no picture or recording leaves this machine through it " +
    "until a later --attach-upload permitted ruling"
  );
}
