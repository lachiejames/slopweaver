/**
 * Why a voice edit of a parked as-me draft was refused (`./draftRevisionText.ts`, `slack draft revise`). Three kinds a
 * caller can tell apart: the parked words cannot be edited at all, the rewrite will not make a form, or it drops the
 * receipt the row brought. Each message is what the console voice reads back to the owner, so it says what to do.
 */

/** The parked words are a shape the editable text cannot carry, so the row is not one a voice edit rewrites. */
interface DraftNotEditableError {
  readonly code: "FORM_NOT_JSON" | "KIND_NOT_EDITABLE" | "STYLE_NOT_KEPT" | "LINE_READS_AS_POINT";
  readonly message: string;
}

/** The rewritten text will not make a form of the row's kind. */
interface DraftRewriteRefusedError {
  readonly code:
    | "NO_WORDS"
    | "EMPTY_POINT"
    | "BOLD_MARKUP"
    | "LABEL_DROPPED"
    | "STRAY_MARK"
    | "DRIP_LINE_BREAK"
    | "DRIP_TWO_MESSAGES"
    | "POINTS_SPLIT"
    | "LIST_NO_LEAD"
    | "LIST_LEAD_LINES";
  readonly message: string;
}

/** The rewrite drops the only link the row brought as its receipt. */
interface DraftReceiptDroppedError {
  readonly code: "RECEIPT_DROPPED";
  readonly message: string;
}

/** Every way a voice edit is refused before anything is written. */
export type DraftRevisionError = DraftNotEditableError | DraftRewriteRefusedError | DraftReceiptDroppedError;

export const DraftRevisionErrors = {
  boldMarkup: ({ line }: { line: string }): DraftRewriteRefusedError => ({
    code: "BOLD_MARKUP",
    message: `a tag, an @here or a link cannot be bold: write it plain, the words around it bold. The line: ${line}`,
  }),
  dripLineBreak: (): DraftRewriteRefusedError => ({
    code: "DRIP_LINE_BREAK",
    message: "a drip message is one line: join the lines, never a single line break",
  }),
  dripTwoMessages: (): DraftRewriteRefusedError => ({
    code: "DRIP_TWO_MESSAGES",
    message: "a parked draft is one message: put it on one line, or drop the blank line that splits it",
  }),
  emptyPoint: (): DraftRewriteRefusedError => ({
    code: "EMPTY_POINT",
    message: "a dot point needs words after its `- `: drop the empty one or write what it says",
  }),
  formNotJson: (): DraftNotEditableError => ({
    code: "FORM_NOT_JSON",
    message: "the row's stored form is not JSON, so its words cannot be rewritten",
  }),
  kindNotEditable: ({ kind }: { kind: string }): DraftNotEditableError => ({
    code: "KIND_NOT_EDITABLE",
    message: `a ${kind} form is not one a voice edit rewrites; only one-card, one-list and drip are`,
  }),
  labelDropped: ({ line }: { line: string }): DraftRewriteRefusedError => ({
    code: "LABEL_DROPPED",
    message:
      "a tag takes no |label and a link needs one, so those words would be dropped: write <@key> alone. " +
      `The line: ${line}`,
  }),
  lineReadsAsPoint: ({ line }: { line: string }): DraftNotEditableError => ({
    code: "LINE_READS_AS_POINT",
    message: `a line of the draft reads as a dot point, so a voice edit would make it a list unseen. The line: ${line}`,
  }),
  listLeadLines: (): DraftRewriteRefusedError => ({
    code: "LIST_LEAD_LINES",
    message: "a list's lead is one line: put every line above the dot points into one",
  }),
  listNoLead: (): DraftRewriteRefusedError => ({
    code: "LIST_NO_LEAD",
    message: "a list needs a lead line above its dot points",
  }),
  noWords: (): DraftRewriteRefusedError => ({ code: "NO_WORDS", message: "the rewrite has no words in it" }),
  pointsSplit: (): DraftRewriteRefusedError => ({
    code: "POINTS_SPLIT",
    message: "keep the dot points together: a list is one run of `- ` lines, with words only before and after it",
  }),
  receiptDropped: (): DraftReceiptDroppedError => ({
    code: "RECEIPT_DROPPED",
    message:
      "the rewrite drops the link the draft brought as its receipt, so its claim would reach its reader with nothing to " +
      "open: keep the link in the words",
  }),
  strayMark: ({ line }: { line: string }): DraftRewriteRefusedError => ({
    code: "STRAY_MARK",
    message: `a * or \` that is not one whole mark would be sent literally: close the mark or drop it. The line: ${line}`,
  }),
  styleNotKept: (): DraftNotEditableError => ({
    code: "STYLE_NOT_KEPT",
    message:
      "the draft carries italic, bold code, a literal * or ` in its words, or a bold link or one holding < > or |, " +
      "which the editable text cannot keep apart from its markup, so a voice edit could change it unseen: " +
      "re-record it to change the words",
  }),
} as const;
