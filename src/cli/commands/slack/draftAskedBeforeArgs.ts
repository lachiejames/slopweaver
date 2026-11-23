/**
 * `slack draft record --asked-before` and its three companions, parsed — pure, beside `./draftCore.ts`, which
 * calls it once per record.
 *
 * The four flags make ONE declaration (`../../../outbound/slack/priorAsk.ts`), so every combination that cannot
 * mean anything is refused here, before a read: a change or a not-answered on a question declared never asked, a
 * change with no picture or a picture with no change, and a change beside a not-answered.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { parseSlackThreadPermalink } from "../../../live/slack/permalink.js";
import { AskedBeforeErrors } from "../../../outbound/slack/askedBeforeErrors.js";
import type { AskedBeforeDeclaration } from "../../../outbound/slack/priorAsk.js";
import { parseMedia } from "./coreArgs.js";

/**
 * A non-empty value, `undefined` for an absent flag, or `""` for one given empty — which is refused rather than
 * read as absent, so `--changed "$WHAT"` with `$WHAT` unset never passes as no change.
 */
function textOf({ value }: { value: string | undefined }): string | undefined {
  return value === undefined ? undefined : value.trim();
}

/**
 * The declaration the four flags make, or every reason they cannot be read as one.
 *
 * @param values the parsed string flags
 * @returns `undeclared` when `--asked-before` is absent and nothing else was given, the declaration, or the reasons
 */
export function askedBeforeOf({
  values,
}: {
  values: Readonly<Record<string, string>>;
}): Result<AskedBeforeDeclaration> {
  const askedBefore = textOf({ value: values["asked-before"] });
  const changed = textOf({ value: values["changed"] });
  const notAnswered = textOf({ value: values["not-answered"] });
  const changedMedia = parseMedia({ value: values["changed-media"] });
  const companions = changed !== undefined || notAnswered !== undefined || values["changed-media"] !== undefined;
  if (askedBefore === undefined) {
    return companions ? err([AskedBeforeErrors.companionsWithoutPrior().message]) : ok("undeclared");
  }
  if (askedBefore === "none") {
    return companions ? err([AskedBeforeErrors.companionsOnNone().message]) : ok({ kind: "none" });
  }
  const problems = priorProblems({ askedBefore, changed, changedMedia, notAnswered, values });
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    changedMedia,
    kind: "prior",
    permalink: askedBefore,
    ...(changed === undefined ? {} : { changed }),
    ...(notAnswered === undefined ? {} : { notAnswered }),
  });
}

/**
 * Every way a declared earlier ask is wrong before anything is read.
 *
 * @param askedBefore the `--asked-before` value, neither absent nor `none`
 * @param changed the `--changed` text, trimmed
 * @param changedMedia the `--changed-media` paths
 * @param notAnswered the `--not-answered` text, trimmed
 * @param values the raw flags, to tell an empty `--changed-media` from an absent one
 * @returns the reasons, empty when it reads
 */
function priorProblems({
  askedBefore,
  changed,
  changedMedia,
  notAnswered,
  values,
}: {
  askedBefore: string;
  changed: string | undefined;
  changedMedia: readonly string[];
  notAnswered: string | undefined;
  values: Readonly<Record<string, string>>;
}): string[] {
  const problems: string[] = [];
  const link = parseSlackThreadPermalink({ permalink: askedBefore });
  if (link.isErr()) {
    problems.push(
      `--asked-before must be none or our earlier message's Slack link, and ${askedBefore} is neither: ` +
        link.error.message,
    );
  }
  if (changed === "" || notAnswered === "") {
    problems.push("--changed and --not-answered each need words: an empty one says nothing they can judge");
  }
  const mediaGiven = values["changed-media"] !== undefined;
  if (changed !== undefined && changedMedia.length === 0) {
    problems.push(
      '--changed needs --changed-media <png,…>: at least one picture of what changed ("you ' +
        "can't just tell me something's changed, I need some charts\")",
    );
  }
  if (mediaGiven && changed === undefined) {
    problems.push('--changed-media shows a change, so it needs --changed "<what materially changed>" beside it');
  }
  if (changed !== undefined && notAnswered !== undefined) {
    problems.push(
      "--changed says the answer stands and something moved; --not-answered says there was no answer — pass one",
    );
  }
  return problems;
}
