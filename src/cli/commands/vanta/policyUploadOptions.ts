/**
 * The pure flag parse of `slopweaver write vanta upload-policy-version`: what the invocation asked for, or
 * every reason it was refused. Split from `./policyUploadRun.ts`, the effectful shell, so the grammar is
 * settled by unit tests and the shell stays one parse -> door -> report sequence.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagTailSpec, flagValue, flagValueOr, parseFlagTail } from "../../optionParsers.js";
import { type VantaVerbError, VantaVerbErrors } from "./errors.js";

/** What this invocation was asked for. */
export interface UploadOptions {
  readonly policyId: string;
  readonly file: string;
  readonly sourceCommit: string;
  readonly tenant: string | null;
  readonly approve: string | null;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
}

/**
 * Every flag this verb knows; an unknown one, or a value flag with no value after it, is refused by name.
 *
 * @internal
 */
export const UPLOAD_FLAGS = {
  boolean: ["dry-run", "json"],
  value: ["policy", "file", "source-commit", "tenant", "approve", "home"],
} as const satisfies FlagTailSpec;

/**
 * Parse this verb's flags.
 *
 * @param rest the verb tail
 * @param defaultHome the resolved state home to use when `--home` is absent
 * @returns the options, or the typed reason they were refused
 */
export function parseUploadPolicyVersionOptions({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<UploadOptions, VantaVerbError> {
  const parsed = parseFlagTail({ rest, spec: UPLOAD_FLAGS });
  if (parsed.isErr()) {
    return err(VantaVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  // One typed refusal, so a missing flag and an empty one keep their own codes rather than being joined into one
  // list of strings a caller could only display. An empty value is named before any absence, so a malformed
  // flag never hides behind a missing one; policy before file within each.
  const policyId = flagValue({ name: "policy", parsed: parsed.value });
  const file = flagValue({ name: "file", parsed: parsed.value });
  if (policyId === "") {
    return err(VantaVerbErrors.policyEmpty());
  }
  if (file === "") {
    return err(VantaVerbErrors.uploadFileEmpty());
  }
  if (policyId === null) {
    return err(VantaVerbErrors.uploadPolicyMissing());
  }
  if (file === null) {
    return err(VantaVerbErrors.uploadFileMissing());
  }
  return ok({
    approve: flagValue({ name: "approve", parsed: parsed.value }),
    dryRun: parsed.value.flags.has("dry-run"),
    file,
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: parsed.value.flags.has("json"),
    policyId,
    sourceCommit: flagValueOr({ fallback: "unrecorded", name: "source-commit", parsed: parsed.value }),
    tenant: flagValue({ name: "tenant", parsed: parsed.value }),
  });
}
