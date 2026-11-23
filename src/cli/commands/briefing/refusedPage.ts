/**
 * What a refused `briefing render` leaves behind: the page it would have written, and where that page goes.
 *
 * Pass 670 lost forty minutes to a refusal that printed a cap and wrote nothing, so the chair could not see what
 * was being counted. A refusal that has a page to show now writes it beside `--out` and names the path.
 */
import { renderBriefing } from "../../../outbound/briefing/render.js";
import { briefingFormShape } from "../../../outbound/briefing/schema.js";
import type { BriefingRenderDeps } from "./briefingRenderTypes.js";
import { type BriefingCommandError, briefingCommandErrorLines } from "./errors.js";

/**
 * The page a refused form would have rendered, for the operator to read beside the refusal.
 *
 * Only a form whose every field passes its own caps has one: the renderer is typed over a valid shape, so a
 * refusal of a FIELD has nothing to show and names its path instead. A refusal of the whole PAGE — its word
 * budget, an anchor, an image total — is exactly the case where the words on the page are the question, and
 * pass 670 spent forty minutes on one that wrote nothing.
 *
 * @param json the form after every projection and image was resolved, as the gate saw it
 * @returns the page's bytes, or `undefined` when a field of the form is itself malformed
 */
export function draftPage({ json }: { json: unknown }): string | undefined {
  const draft = briefingFormShape.safeParse(json);
  if (!draft.success) {
    return undefined;
  }
  return renderBriefing({ form: draft.data });
}

/**
 * One schema rejection as the line the refusal prints, led by the path of the field it names.
 *
 * An issue with an empty path is about the form as a whole — a missing top-level section, a refinement over
 * several fields — so it is led by the word `form` rather than by nothing.
 *
 * @param issue one issue off the schema's failed parse
 * @returns `<dotted path>: <message>`, or `form: <message>` for an issue about the whole form
 */
export function formIssueLine({
  issue,
}: {
  issue: { readonly path: readonly PropertyKey[]; readonly message: string };
}): string {
  const path = issue.path.join(".");
  if (path === "") {
    return `form: ${issue.message}`;
  }
  return `${path}: ${issue.message}`;
}

/**
 * Where a refused page is written: beside `--out`, never over it.
 *
 * Beside, because the supervisor already reads that directory, and never over, because a caller publishes
 * `--out` on a zero exit and a byte count — a refused page at the same path is one stale guard from reaching
 * the owner.
 *
 * @param out the path the page would have been written to
 * @returns the sibling path the refused page is written to
 */
export function refusedPagePath({ out }: { out: string }): string {
  return out.endsWith(".html") ? `${out.slice(0, -".html".length)}.refused.html` : `${out}.refused.html`;
}

/**
 * The refusal's lines, and the refused page written where the operator can read it.
 *
 * Pass 670 lost forty minutes to a refusal that printed a cap and wrote nothing: the chair could not see what
 * was being counted. So a refusal that has a page writes it beside `--out` and names the path; with no
 * `--out` it says how to get one, since stdout is where a caller expects a PUBLISHABLE page.
 *
 * @param deps the verb's seams; only `writePage` is used, to write the refused page
 * @param error the refusal, which carries the refused page when there is one to show
 * @param out the `--out` path, absent when the page would have gone to stdout
 * @returns the refusal's lines, with one more naming where the refused page went or how to get it
 */
export function refusalLines({
  deps,
  error,
  out,
}: {
  deps: BriefingRenderDeps;
  error: BriefingCommandError;
  out: string | undefined;
}): readonly string[] {
  const lines = briefingCommandErrorLines({ error });
  const hasPage =
    error.code === "FORM_REJECTED" || error.code === "RENDER_CHECK_FAILED" || error.code === "RENDER_TOO_LARGE";
  if (!hasPage || error.refusedPage === undefined) {
    return lines;
  }
  if (out === undefined) {
    return [...lines, "re-run with --out <path> to have the refused page written beside it, to read what was counted"];
  }
  const path = refusedPagePath({ out });
  deps.writePage({ html: error.refusedPage, path });
  return [
    ...lines,
    `the refused page is written to ${path} — read it to see what was counted; nothing was written to ${out}`,
  ];
}
