/**
 * The argv-parsing shape shared by every Linear verb whose only invocation is `<noun> create --form
 * <json|-> […]` with nothing but `--dry-run`/`--json`/`--home` alongside it (and `--mention-id` where a verb
 * declares it) — `linear comment`, `linear relation`, `linear project-update` and `linear initiative-update`
 * today (`commentCore.ts`, `relationCore.ts`, `projectUpdateCore.ts`, `initiativeUpdateCore.ts`). Each verb
 * keeps its own `<Noun>Args`/`<Noun>ArgParse` names and its own {@link FlagSpec} (structurally identical to this module's, but declared per verb so `helpTruth.test.ts`
 * ratchets each one independently); only the parsing logic itself is shared.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { parseVerifiedMentionIds } from "../../../outbound/linear/mentionIndex.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type LinearVerbError, LinearVerbErrors } from "./errors.js";

/** A parsed `<noun> create --form …` invocation. */
export interface LinearFormCreateArgs {
  readonly formSource: string;
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string | undefined;
  /**
   * The `--mention-id key=<linear-user-id>` pairs the caller verified live, keyed by mention key.
   *
   * Empty for a verb that does not declare the flag — `parseFlags` refuses an undeclared one outright, so a
   * relation given `--mention-id` fails as an unknown flag rather than silently carrying a map nothing reads.
   */
  readonly mentionIds: ReadonlyMap<string, string>;
}

/**
 * Parse `linear <noun> create --form <json|-> […]`.
 *
 * @param argv the verb's arguments, excluding the noun
 * @param noun the verb's own noun, named in the usage string (e.g. `"comment"`, `"relation"`)
 * @param flags the verb's own flag spec
 * @returns the parsed arguments, or the operator-facing errors
 */
export function parseLinearFormCreateArgs({
  argv,
  noun,
  flags,
}: {
  argv: readonly string[];
  noun: string;
  flags: FlagSpec;
}): Result<LinearFormCreateArgs, LinearVerbError> {
  if (argv[0] !== "create") {
    return err(LinearVerbErrors.usage({ noun, shape: "create" }));
  }
  const parsed = parseFlags({ args: argv.slice(1), spec: flags });
  if (parsed.isErr()) {
    return err(LinearVerbErrors.flagsRefused({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const formSource = typeof values["form"] === "string" ? values["form"] : undefined;
  const mentions = parseVerifiedMentionIds({
    raw: typeof values["mention-id"] === "string" ? values["mention-id"] : undefined,
  });
  const missingForm =
    formSource === undefined ? ["--form <json|-> is required (use `-` to read the form from stdin)"] : [];
  const problems = [...missingForm, ...mentions.errors];
  if (formSource === undefined || problems.length > 0) {
    return err(LinearVerbErrors.argumentsRefused({ reasons: problems }));
  }
  return ok({
    dryRun: values["dry-run"] === true,
    formSource,
    home: typeof values["home"] === "string" ? values["home"] : undefined,
    json: values["json"] === true,
    mentionIds: mentions.verified,
  });
}
