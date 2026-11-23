/**
 * THE DIFF RECORD — the one input a session authors for `slopweaver policy diff`, and the only place a change's
 * reason is written.
 *
 * Everything the owner reads and everything the team is sent are rendered from this one record, so the two can
 * never tell different stories (a policy change ships after the owner's own review of the diff, and
 * the team post — which says the changes went to Vanta after review, lists the key changes as dot points and
 * invites disagreement — comes from the same place).
 *
 * The record says WHY; the code decides WHAT changed. A change entry names lines by `match` substrings (or a whole
 * `line`), and the
 * renderer refuses a material line no entry explains (`./annotate.ts`), so the record cannot quietly fall behind
 * the documents it describes.
 */
import { z } from "zod";

import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import { type DocDiffIssue, DocDiffIssues } from "./issues.js";
import { plainText } from "./units.js";

/** Where one side's markdown comes from: a file, or a path at a commit in a git repository. */
const SourceSchema = z.union([
  z.strictObject({ path: z.string().min(1) }),
  z.strictObject({ git: z.strictObject({ path: z.string().min(1), repo: z.string().min(1), rev: z.string().min(1) }) }),
]);

/** One side of the diff: what to call it, and where its markdown is. */
const SideSchema = z.strictObject({ label: z.string().min(1), source: SourceSchema });

/**
 * One material change: the lines it covers, why it was made, and what was wrong before. `match` strings are found
 * inside a line; a `line` is a line's whole text, for one no substring can single out because it is the start of
 * others (`packages/infra/cloud` beside `packages/infra/cloud/gcp/vpc.ts`).
 */
const ChangeSchema = z
  .strictObject({
    id: z.string().min(1),
    line: z.array(z.string().min(1)).min(1).optional(),
    match: z.array(z.string().min(1)),
    was: z.string().min(1),
    why: z.string().min(1),
  })
  .refine((change) => change.match.length > 0 || change.line !== undefined, {
    message: "a change names its lines by at least one match string or line",
  });

/** The colours a mark may be drawn in. */
const MARK_TONES = ["blue", "violet", "amber", "red"] as const;

/** A coloured mark on the lines it matches, explained on hover — never a text badge. */
const MarkSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  match: z.array(z.string().min(1)).min(1),
  note: z.string().min(1),
  tone: z.enum(MARK_TONES),
});

/** One document's before and after, and everything said about it. */
const DocumentSchema = z.strictObject({
  after: SideSchema,
  before: SideSchema,
  changes: z.array(ChangeSchema),
  controls: z.array(z.string().min(1)),
  id: z.string().regex(/^[a-z0-9-]+$/),
  marks: z.array(MarkSchema),
  name: z.string().min(1),
  /** Where the document lives in Vanta: an evidence slot's id, or `vanta-policy:<id>` when the document is a policy. */
  vantaEvidence: z.string().min(1),
});

/** A phrase to link wherever it appears, to a URL or a Vanta object the atlas holds. */
const LinkSchema = z.strictObject({
  target: z.string().regex(/^(https:\/\/|vanta-evidence:|vanta-policy:)/),
  text: z.string().min(1),
});

/** The formatting kinds a record may give its own reason for. */
const FORMATTING_KINDS = ["case", "emphasis", "code", "links", "structure", "punctuation"] as const;

/** One kind of formatting-only change. */
export type FormattingKind = (typeof FORMATTING_KINDS)[number];

/** The whole record. */
const RecordSchema = z.strictObject({
  documents: z.array(DocumentSchema).min(1),
  formatting: z.partialRecord(z.enum(FORMATTING_KINDS), z.string().min(1)),
  keyChanges: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
  lede: z.string().min(1),
  links: z.array(LinkSchema),
  /**
   * The `owner/repo` a bare `#7` in the documents means. Optional because a document citing no pull request
   * needs none; absent, a bare number is refused rather than guessed, as it is on every other outbound surface.
   */
  repository: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .optional(),
  schemaVersion: z.literal(1),
  team: z.strictObject({ ask: z.string().min(1), opener: z.string().min(1), title: z.string().min(1) }),
  title: z.string().min(1),
  uploaded: z.boolean(),
});

/** The validated record. */
export type DocDiffRecord = z.infer<typeof RecordSchema>;

/** One document's part of the record. */
export type DocDiffDocument = DocDiffRecord["documents"][number];

/** One change entry. */
export type DocDiffChange = DocDiffDocument["changes"][number];

/** One mark entry. */
export type DocDiffMark = DocDiffDocument["marks"][number];

/** Where one side's markdown comes from. */
export type DocDiffSource = z.infer<typeof SourceSchema>;

/** Every id that appears twice in a list, so a match can never be attributed to the wrong entry. */
function duplicateIds({ ids }: { ids: readonly string[] }): readonly string[] {
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

/**
 * Parse and validate a record file's text.
 *
 * @param text the record file's contents
 * @returns the record, or every reason it was refused
 */
export function parseDocDiffRecord({ text }: { text: string }): Result<DocDiffRecord, readonly DocDiffIssue[]> {
  const json = parseJson({ text });
  if (json.isErr()) {
    return err([DocDiffIssues.invalidRecord({ detail: json.error.message })]);
  }
  const parsed = RecordSchema.safeParse(json.value);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((issue) =>
        DocDiffIssues.invalidRecord({ detail: `${issue.path.join(".")}: ${issue.message}` }),
      ),
    );
  }
  const issues: DocDiffIssue[] = duplicateIds({ ids: parsed.data.documents.map((document) => document.id) }).map((id) =>
    DocDiffIssues.invalidRecord({ detail: `document id ${id} appears twice` }),
  );
  for (const document of parsed.data.documents) {
    for (const issue of entryIssues({ document })) {
      issues.push(issue);
    }
  }
  if (issues.length > 0) {
    return err(issues);
  }
  return ok(parsed.data);
}

/** What is wrong with one document's entries: an id used twice, or a match string that is empty as plain text. */
function entryIssues({ document }: { document: DocDiffDocument }): readonly DocDiffIssue[] {
  const entries = [...document.changes, ...document.marks];
  const issues: DocDiffIssue[] = duplicateIds({ ids: entries.map((entry) => entry.id) }).map((id) =>
    DocDiffIssues.invalidRecord({ detail: `${document.id}: entry id ${id} appears twice` }),
  );
  for (const entry of entries) {
    const needles = "line" in entry && entry.line !== undefined ? [...entry.match, ...entry.line] : entry.match;
    for (const needle of needles.filter((match) => plainText({ markdown: match }) === "")) {
      issues.push(
        DocDiffIssues.invalidRecord({
          detail: `${document.id}: entry ${entry.id} matches "${needle}", which is empty as plain text and so matches every line`,
        }),
      );
    }
  }
  return issues;
}
