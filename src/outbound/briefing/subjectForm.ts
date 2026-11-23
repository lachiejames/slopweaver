/**
 * A react-now card's `subject` as a form fragment: its shape, and the one rule its own fields decide.
 *
 * Its own file rather than a block inside `./schema.ts` because that file sits against its own size
 * ratchet, and this is a real seam — the subject is the only cell on a card whose legality depends on the
 * relationship between two of its fields rather than on a cap. The criterion, the refusal words and the
 * self-link walk that reads across cards all live in `../../briefing/cardSubject.ts`; this is only the
 * Zod shape that lets a form carry one.
 */
import { z } from "zod";

import { NO_PAGE_REQUIRED_MESSAGE, subjectDeclaresItsPage } from "../../briefing/cardSubject.js";
import { strictForm } from "../strictForm.js";
import { proseLine } from "./vocabulary.js";

/**
 * What the card is about: its key and the subject's own title, linked when the subject HAS a page.
 *
 * `url` is optional, and the words are what carry the absence. A card whose subject linked the briefing
 * page the owner was reading was the case: a card with no page of its own says `no page` in
 * the subject text instead of inventing a link. That is the only legal url-less shape, so the absence reads
 * as a decision rather than as a field somebody forgot — and see `./schema.ts`'s SOMEWHERE-TO-GO refine for
 * why a `no page` subject does not, on its own, give the owner anywhere to go.
 *
 * @internal — `./schema.ts` embeds it in the card form; no caller outside the form names it.
 */
export const subjectSchema = strictForm({ text: proseLine.max(300), url: z.url().optional() }).refine(
  (subject) => subjectDeclaresItsPage({ subject }),
  { message: NO_PAGE_REQUIRED_MESSAGE, path: ["text"] },
);
