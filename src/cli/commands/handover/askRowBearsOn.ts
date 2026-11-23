/**
 * `handover register --bears-on`: the one line a card draws after the owner's quoted words, as why the card is in front of them,
 * and the plain flags `handover register` carries onto the row beside it. Its own file so `./askRowRun.ts` stays under the file-size ratchet.
 */
import { slopweaverHome } from "../../../config.js";
import { bearsOnProblems } from "../../../handover/askShape.js";
import { ownerWordsSchemeOf } from "../../../handover/hisWords.js";
import { optionalString } from "./askRowArgs.js";

/**
 * The `--bears-on` line to write, or the refusal: it says how the owner's quoted words bear on the question, so a row whose
 * anchor quotes none has nothing for it to follow, and a line past the one-sentence cap is a paragraph.
 *
 * @param values the parsed flag values
 * @returns the line (undefined when the flag is absent), or the refusal
 */
export function bearsOnFor({
  values,
}: {
  values: Readonly<Record<string, unknown>>;
}): { readonly bearsOn: string | undefined } | { readonly refusal: string } {
  const bearsOn = optionalString({ name: "bears-on", values });
  if (bearsOn === undefined) {
    return { bearsOn };
  }
  if (ownerWordsSchemeOf({ anchor: optionalString({ name: "anchor", values }) }) === undefined) {
    return {
      refusal:
        "--bears-on says how the owner's quoted words bear on the question, and this row quotes none — pass an --anchor " +
        "naming the owner's words (talk:, call:, talk-call:, transcript:), or drop --bears-on",
    };
  }
  const problems = bearsOnProblems({ text: bearsOn });
  if (problems.length > 0) {
    return { refusal: problems.join("; ") };
  }
  return { bearsOn: bearsOn.trim() };
}

/**
 * The flags `handover register` writes onto the row as given — each absent when not passed — plus the checked
 * `--bears-on` line, or that line's refusal, or the refusal of a blank `--anchor`.
 *
 * @param values the parsed flag values
 * @returns the row's plain fields, or the refusal
 */
export function registerFlags({ values }: { values: Readonly<Record<string, unknown>> }):
  | {
      readonly anchor: string | undefined;
      readonly bearsOn: string | undefined;
      readonly branch: string | undefined;
      readonly dir: string | undefined;
      readonly home: string;
      readonly priority: string | undefined;
      readonly repo: string | undefined;
    }
  | { readonly refusal: string } {
  const bears = bearsOnFor({ values });
  if ("refusal" in bears) {
    return bears;
  }
  // A blank anchor writes an `anchor:` line that anchors nothing, silences the register hint and makes the row one
  // `handover quote --anchor` refuses — so it is refused here, before any row exists.
  const anchor = optionalString({ name: "anchor", values });
  if (anchor?.trim() === "") {
    return {
      refusal:
        "--anchor is empty — leave it off, then tie the row with `slopweaver handover quote <slug> --anchor <a> --apply`",
    };
  }
  return {
    anchor,
    bearsOn: bears.bearsOn,
    branch: optionalString({ name: "branch", values }),
    dir: optionalString({ name: "dir", values }),
    home: typeof values["home"] === "string" ? values["home"] : slopweaverHome(),
    priority: optionalString({ name: "priority", values }),
    repo: optionalString({ name: "repo", values }),
  };
}
