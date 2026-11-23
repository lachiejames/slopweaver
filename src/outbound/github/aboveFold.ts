/**
 * What a reviewer reads on a pull request BEFORE expanding anything, extracted from the typed form.
 *
 * The fold on a C3 description is the re-run `Details`: every other cell — the badge hovers, the explainer, both
 * proof slots, the checks and what was not checked — is read without expanding anything. `../voice/aboveFold.ts` owns the rules; this module owns which text they see, because only
 * the form knows which of its runs are authored prose. The cells themselves come from `./formContent.ts`, the
 * one walk over the form.
 *
 * ## A code run and a link are skipped, and that is the same call the as-me lane already made
 *
 * `{ kind: "code" }` is an identifier and `{ kind: "link" }` carries a label that is usually somebody else's
 * title. Neither is the author's voice, and scanning them is how a prose rule blocks legitimate work. Emphasis IS
 * scanned: `strong` and `em` are the author writing, with a typeface on it.
 *
 * Each skipped run contributes ONE space rather than nothing, so removing it can never weld the sentence
 * before it onto the sentence after it.
 */
import type { AboveFoldCell } from "../voice/aboveFold.js";
import type { GithubCommentArtifact } from "./commentTypes.js";
import { type ContentPath, contentFieldsOf } from "./formContent.js";
import type { Content, PrBody } from "./types.js";

/**
 * One cell's authored prose: emphasis kept, typed code and links replaced by a space.
 *
 * @param content the cell's ordered inline runs
 * @returns the text an above-the-fold rule is allowed to read
 */
function proseOfContent({ content }: { content: Content }): string {
  return content.map((run) => (run.kind === "code" || run.kind === "link" ? " " : run.text)).join("");
}

/** A form path as a caller reads it: `risk.items[0].worst`. */
function dotted({ path }: { path: ContentPath }): string {
  return path.reduce<string>((out, part) => {
    if (typeof part === "number") {
      return `${out}[${String(part)}]`;
    }
    return out.length === 0 ? part : `${out}.${part}`;
  }, "");
}

/**
 * Every above-the-fold cell of a pull-request form, each named by the field a caller can go and fix.
 *
 * @param form the validated pull-request form or draft
 * @returns every cell outside the Longer notes, in the order a reader meets them
 */
export function prAboveFoldCells({ form }: { form: PrBody }): readonly AboveFoldCell[] {
  return contentFieldsOf({ body: form })
    .filter((field) => field.fold === "above")
    .map((field) => ({ path: dotted({ path: field.path }), text: proseOfContent({ content: field.content }) }));
}

/**
 * Every BELOW-the-fold region of a pull-request form: each note and test-list line of the re-run fold. A command is
 * skipped: a terminal invocation is not authored prose.
 *
 * @param form the validated pull-request form or draft
 * @returns each folded region, in the order a reviewer meets them after expanding
 */
export function prBelowFoldCells({ form }: { form: PrBody }): readonly AboveFoldCell[] {
  return contentFieldsOf({ body: form })
    .filter((field) => field.fold === "below")
    .map((field) => ({ path: dotted({ path: field.path }), text: proseOfContent({ content: field.content }) }));
}

/**
 * The above-the-fold region of a top-level comment form, which is its summary and nothing else — the same
 * cell Linear's own comment form checks, for the same reason: a comment's summary IS the whole message a
 * reader sees without expanding anything.
 *
 * @param artifact the validated comment
 * @returns the one region
 */
export function githubCommentAboveFoldCells({
  artifact,
}: {
  artifact: GithubCommentArtifact;
}): readonly AboveFoldCell[] {
  return [{ path: "artifact.summary", text: proseOfContent({ content: artifact.summary }) }];
}
