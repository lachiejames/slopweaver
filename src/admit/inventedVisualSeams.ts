/**
 * The two REFERENCE-ONLY seams' collectors — pure functions turning an outbound artifact into the candidate
 * visuals `./inventedVisual.ts` judges.
 *
 * Both are here rather than beside the artifacts they read, because the interesting content is the same
 * decision twice: what counts as "a visual this artifact carries". A composed answer says so in a typed
 * field; a PR description says so in markdown, and the extraction is the only difference between them.
 *
 * The ATTACHMENT seam has no collector here on purpose: it holds one real file, so it reads bytes and a
 * directory listing, and that is an effectful edge belonging to the verb that already opened the file.
 */

import { allRunsOf } from "../outbound/artifact/runs.js";
import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";
import type { CandidateVisual } from "./inventedVisual.js";

/**
 * Every visual a composed answer carries: its attached image paths, and the URL of every `link` run it
 * renders.
 *
 * The links are in scope because the surveyed instances reached the reader as a URL as often as as a file —
 * an answer pointing at `http://127.0.0.1:8792/before.html` hands over exactly the same nothing whether or
 * not a shot of it is attached. Nothing here touches the filesystem: `../live/turn/answerPreflight.ts`'s
 * standing contract is that its gates are decidable from the answer's own bytes, and a gate that read a
 * file would stop being runnable at the moment the pre-flight exists to run.
 *
 * @param answer the composed answer about to be sent
 * @returns one candidate per image path and per rendered link URL, images first
 */
export function answerVisuals({ answer }: { answer: AnswerFormAnswer }): readonly CandidateVisual[] {
  const images = answer.images.map((ref): CandidateVisual => ({ ref, seam: "answer-image" }));
  const rendered = [...answer.index.flat(), ...allRunsOf({ detail: answer.body })];
  const links = rendered
    .filter((run) => run.type === "link")
    .map((run): CandidateVisual => ({ ref: run.url, seam: "answer-image" }));
  return [...images, ...links];
}

/** `<img src="…">`, in either quote style. */
const HTML_IMAGE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;

/** `![alt](url)` — the markdown image, whose leading `!` is what separates it from a plain link. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*([^)\s]+)/g;

/**
 * Every visual a pull-request description embeds.
 *
 * Scoped to IMAGE embeds — an `<img src>` and a markdown `![](…)` — and deliberately not to every link in
 * the body: a PR that links a local dev server in its prose is describing where something runs, while one
 * that EMBEDS a picture from there is offering it as proof. The distinction is the `!`, and widening past
 * it would refuse descriptions that are doing nothing wrong.
 *
 * @param body the pull-request description markdown
 * @returns one candidate per embedded image, in the order the body embeds them
 */
export function prBodyVisuals({ body }: { body: string }): readonly CandidateVisual[] {
  const refs = [
    ...[...body.matchAll(HTML_IMAGE)].map((match) => match[1]),
    ...[...body.matchAll(MARKDOWN_IMAGE)].map((match) => match[1]),
  ];
  return refs
    .filter((ref): ref is string => ref !== undefined)
    .map((ref): CandidateVisual => ({ ref, seam: "pr-embed" }));
}
