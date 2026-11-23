/*
 * What the `linear comment create` document test files share: the document and content ids, a slice of the RFC the
 * anchor check was built for, and a document comment form quoting it.
 */
import type { LinearCommentForm } from "../../../../../../outbound/linear/commentTypes.js";

export const DOCUMENT_ID = "f0a8e983-ffe3-4334-8a0c-cae7404502e3";
export const CONTENT_ID = "50dd356c-f486-40c3-9759-0736ad45ab4e";

/** A slice of the RFC this was built for, markdown and all. */
export const CONTENT =
  "3. **Do we also switch the container entrypoint to** `node` **directly now?** **Lean: no, as a follow-up.**";

export const FORM: LinearCommentForm = {
  artifact: { evidence: [], summary: "i'd push to do this first, or at least alongside." },
  fields: { documentId: DOCUMENT_ID, quotedText: "Lean: no, as a follow-up." },
};
