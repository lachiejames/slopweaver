/**
 * The FORM a pull request is filled into — schema-enforced STRUCTURE.
 *
 * This form is a contract for another codebase, not CLI sugar for a human: slopweaver owns the schema and a
 * separate system fills it and calls the verb. So a refusal has to be actionable by a machine caller — every
 * custom message says what is wrong AND what to do instead — and every object is a `strictForm`, so an
 * undeclared key is a hard rejection rather than a silent drop.
 *
 * Two schemas READ and one writes (`./writeSchema.ts`): a reader must decode what is already published or
 * stored, while a writer is held to every rule in `./formRules.ts`. The edit schema here is structural too; the
 * merged form an edit produces is re-validated by the write schema before anything renders.
 *
 * Every content cell renders inside an HTML block (`<p>`, `<li>`, `<td>`), where GitHub parses no Markdown and a
 * blank line would end the block early. So no run may carry a newline, and a backtick outside a `code` run is
 * refused: it would reach the reader literally.
 */
import { z } from "zod";
import { strictForm } from "../../strictForm.js";
import { utcMidnightOf } from "../days.js";
import { HTTPS, imageSchema } from "../schemaImage.js";
import { LINE_BREAK, lineText, nonBlank } from "../schemaText.js";
import { renderContent } from "./render.js";
import { reviewersSchema } from "./reviewersSchema.js";
import { reviewLeftoversSchema } from "./reviewLeftoversSchema.js";
import type {
  BeforeAfter,
  Claim,
  ClickThrough,
  Content,
  EvidenceContent,
  FailsOnMain,
  GoldAnchor,
  Inline,
  Level,
  PrForm,
  PrFormEdit,
  Priority,
  ProblemSeen,
  ProofBlock,
  ProofBlockLeaf,
  ProofItem,
  PrTarget,
  RemovableField,
  Review,
  RiskItem,
  RiskSection,
  StampedPrBody,
} from "./types.js";

const inlineSchema = z.discriminatedUnion("kind", [
  strictForm({ kind: z.literal("text"), text: nonBlank() }),
  strictForm({ kind: z.literal("strong"), text: nonBlank() }),
  strictForm({ kind: z.literal("em"), text: nonBlank() }),
  strictForm({ kind: z.literal("code"), text: nonBlank() }),
  strictForm({ kind: z.literal("link"), text: nonBlank(), url: HTTPS }),
]) satisfies z.ZodType<Inline>;

/** Content: at least one run. */
const contentSchema = z.array(inlineSchema).min(1) satisfies z.ZodType<Content>;

/**
 * The refusal of a carriage return in the notes, where a newline is otherwise allowed: GitHub's web editor saves
 * a body with CRLF, so the reader takes every CRLF as LF, and one the form carried would come back changed.
 */
const CARRIAGE_RETURN_MESSAGE =
  "a carriage return in the notes may not read back, since a description is read with CRLF as LF. Use a newline alone";

const proofParaBlockSchema = strictForm({
  content: contentSchema.refine((content) => content.every((run) => !run.text.includes("\r")), CARRIAGE_RETURN_MESSAGE),
  kind: z.literal("para"),
});

const proofCodeBlockSchema = strictForm({
  kind: z.literal("code"),
  // One bare word or empty. The info string shares its LINE with the opening fence, so it is the one field
  // the collision-proof fence cannot protect: a newline in it injects a whole extra line into the document.
  lang: z.string().regex(/^[A-Za-z0-9_+-]*$/, "a code language is one bare word (letters, digits, _ + -) or empty"),
  text: nonBlank().refine((text) => !text.includes("\r"), CARRIAGE_RETURN_MESSAGE),
});

const proofImageBlockSchema = imageSchema;

/**
 * The three block kinds that may appear anywhere, including nested inside a `details` block.
 *
 * `satisfies z.ZodType<ProofBlockLeaf>` does NOT catch a schema missing a union member — `ZodType`'s type
 * parameter is covariant — so the type and the schema are kept in sync by hand.
 */
export const proofLeafBlockSchema = z.discriminatedUnion("kind", [
  proofParaBlockSchema,
  proofCodeBlockSchema,
  proofImageBlockSchema,
]) satisfies z.ZodType<ProofBlockLeaf>;

const proofBlockSchema = z.discriminatedUnion("kind", [
  proofParaBlockSchema,
  proofCodeBlockSchema,
  proofImageBlockSchema,
  strictForm({
    blocks: z.array(proofLeafBlockSchema).min(1),
    kind: z.literal("details"),
    summary: lineText({ what: "details summary" }),
  }),
]) satisfies z.ZodType<ProofBlock>;

/**
 * A git ref or repo segment.
 *
 * Excludes whitespace and control characters ONLY. Hyphens, slashes and dots are all legal and extremely
 * common in real refs (`pr7-github-pr-write`, `feature/x`, `release-1.2`).
 */
const REF = z
  .string()
  .min(1)
  .regex(/^[!-~¡-￿]+$/, "must not contain whitespace or control characters");

const prTargetSchema = strictForm({
  base: REF,
  head: REF,
  owner: REF,
  repo: REF,
}) satisfies z.ZodType<PrTarget>;

/** The issues one run of a reading-order cell raises: a newline anywhere, a backtick outside a code run. */
function runIssues({ run }: { run: Inline }): readonly string[] {
  const issues: string[] = [];
  if (LINE_BREAK.test(run.text)) {
    issues.push(
      "a run carries a newline. Every reading-order cell is a one-line HTML block, and a blank line ends it early",
    );
  }
  if (run.kind !== "code" && run.text.includes("`")) {
    issues.push(
      `a run carries a backtick outside a { "kind": "code" } run: "${run.text}". GitHub parses no Markdown inside ` +
        'an HTML block, so it would reach the reader literally. Put it in { "kind": "code", "text": "…" }',
    );
  }
  return issues;
}

/** One reading-order content cell: at least one run, none with a newline or a stray backtick. */
const cellSchema = contentSchema.superRefine((content, ctx) => {
  for (const message of content.flatMap((run) => runIssues({ run }))) {
    ctx.addIssue({ code: "custom", message });
  }
}) satisfies z.ZodType<Content>;

/** An evidence cell: the cell runs, plus images. */
const evidenceSchema = z
  .array(z.discriminatedUnion("kind", [...inlineSchema.options, imageSchema]))
  .min(1)
  .superRefine((content, ctx) => {
    for (const message of content.flatMap((run) => (run.kind === "image" ? [] : runIssues({ run })))) {
      ctx.addIssue({ code: "custom", message });
    }
  }) satisfies z.ZodType<EvidenceContent>;

/** A real `YYYY-MM-DD` UTC calendar day. */
const daySchema = z
  .string()
  .refine((day) => utcMidnightOf({ day }) !== undefined, "must be a real YYYY-MM-DD calendar day (UTC)");

const levelSchema = z.enum(["low", "medium", "high"]) satisfies z.ZodType<Level>;

const prioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]) satisfies z.ZodType<Priority>;

/**
 * A cell the risk item line splits on ` · `, so the separator inside one would make the line unreadable.
 *
 * @param field the field name, for the message
 * @returns the cell schema with the separator refused in its rendered text
 */
function separatorFreeCell({ field }: { field: string }): z.ZodType<Content> {
  return cellSchema.refine(
    (content) => !renderContent({ content }).includes(" · "),
    `${field} may not contain " · " — the risk item line is split on it`,
  );
}

const riskItemSchema = strictForm({
  check: z.discriminatedUnion("kind", [
    strictForm({ check: cellSchema, kind: z.literal("checked") }),
    strictForm({ kind: z.literal("unchecked"), why: cellSchema }),
  ]),
  impact: levelSchema,
  likelihood: levelSchema,
  priority: prioritySchema,
  reach: separatorFreeCell({ field: "reach" }),
  worst: separatorFreeCell({ field: "worst" }),
}) satisfies z.ZodType<RiskItem>;

const riskSectionSchema = strictForm({
  blastRadius: cellSchema,
  items: z.array(riskItemSchema).min(1).max(5),
  line: cellSchema,
}) satisfies z.ZodType<RiskSection>;

const problemSeenSchema = z.discriminatedUnion("kind", [
  strictForm({ kind: z.literal("seen"), on: daySchema }),
  strictForm({ kind: z.literal("unevidenced") }),
]) satisfies z.ZodType<ProblemSeen>;

const beforeAfterSideSchema = strictForm({ evidence: evidenceSchema, where: cellSchema });

const beforeAfterSchema = strictForm({
  fix: beforeAfterSideSchema,
  problem: beforeAfterSideSchema,
}) satisfies z.ZodType<BeforeAfter>;

/** A 7-to-40 character lowercase hex commit prefix — every commit a body names. */
const COMMIT_SHA = z.string().regex(/^[0-9a-f]{7,40}$/, "must be a 7-40 character lowercase commit SHA");

const failsOnMainSchema = strictForm({
  command: lineText({ what: "the failing command" }),
  mainSha: COMMIT_SHA,
}) satisfies z.ZodType<FailsOnMain>;

const clickThroughSchema = strictForm({
  commit: COMMIT_SHA,
  control: cellSchema,
  destination: evidenceSchema.refine(
    (runs) => runs.some((run) => run.kind === "image"),
    'a click-through\'s destination is the screenshot of the page the control opened. Add a { "kind": "image" } run',
  ),
}) satisfies z.ZodType<ClickThrough>;

const claimSchema = strictForm({
  claim: cellSchema,
  proof: z.discriminatedUnion("kind", [
    strictForm({ evidence: evidenceSchema, kind: z.literal("proven") }),
    strictForm({ kind: z.literal("gap"), why: cellSchema }),
    strictForm({ kind: z.literal("failed"), why: cellSchema }),
  ]),
}) satisfies z.ZodType<Claim>;

const proofItemSchema = strictForm({ caption: cellSchema, image: imageSchema }) satisfies z.ZodType<ProofItem>;

/** The visible Proof section: one to eight captioned screenshots. */
const proofSchema = z.array(proofItemSchema).min(1).max(8);

const reviewSchema = strictForm({
  grade: z.enum(["gold", "silver", "bronze", "unproven"]),
  reviewer: lineText({ what: "the reviewer" }).refine(
    (value) => !value.includes(" · ") && !value.includes(": "),
    'the reviewer may contain neither " · " nor ": " — the solved tooltip that carries it is split on both',
  ),
  why: lineText({ what: "the review's reason" }).refine(
    (value) => !value.includes(" · "),
    'the review\'s reason may not contain " · " — the solved tooltip that carries it is split on it',
  ),
}) satisfies z.ZodType<Review>;

const goldAnchorSchema = strictForm({
  commit: COMMIT_SHA,
  patchId: z
    .string()
    .regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/, "must be a full lowercase patch id, as `slopweaver github push` prints it")
    .optional(),
}) satisfies z.ZodType<GoldAnchor>;

const notesSchema = z.array(proofBlockSchema).min(1);
const whereToLookSchema = z.array(cellSchema).min(1).max(8);
const whyApproachSchema = z.array(cellSchema).min(1).max(5);

/** Every body field, shared by the read schemas here and the write schema in `./writeSchema.ts`. */
const bodyShape = {
  beforeAfter: beforeAfterSchema.optional(),
  change: cellSchema,
  claims: z.array(claimSchema),
  clickThrough: clickThroughSchema.optional(),
  failsOnMain: failsOnMainSchema.optional(),
  goldAnchor: goldAnchorSchema.optional(),
  notes: notesSchema.optional(),
  origin: cellSchema,
  problem: cellSchema,
  problemSeen: problemSeenSchema,
  proof: proofSchema.optional(),
  review: reviewSchema.optional(),
  reviewers: reviewersSchema.optional(),
  reviewLeftovers: reviewLeftoversSchema.optional(),
  risk: riskSectionSchema,
  whereToLook: whereToLookSchema,
  whyApproach: whyApproachSchema.optional(),
};

/** The routing fields a whole form carries beside its body. */
const routingShape = {
  target: prTargetSchema,
  title: lineText({ what: "the pull-request title" }),
};

/**
 * A stamped body as `./parse.ts` recovers it: structure, without the write schema's form rules. It shares the
 * field schemas, so a refusal of what cannot read back (a line break in a url or a cell, a carriage return in
 * the notes) applies here too, and a body carrying one does not decode.
 */
export const stampedBodySchema = strictForm({
  ...bodyShape,
  writtenOn: daySchema,
}) satisfies z.ZodType<StampedPrBody>;

/**
 * A whole stamped form as the ledger stores it: structure only. A record written in any other shape fails to
 * decode and is dropped as a cache miss (`./prLedger.ts`).
 *
 * @internal — exported for its unit test
 */
export const storedPrFormSchema = strictForm({
  ...bodyShape,
  ...routingShape,
  draft: z.boolean(),
  writtenOn: daySchema,
}) satisfies z.ZodType<PrForm>;

/** The optional sections an edit may drop. */
const REMOVABLE = [
  "beforeAfter",
  "failsOnMain",
  "clickThrough",
  "proof",
  "whyApproach",
  "notes",
  "goldAnchor",
  "review",
  "reviewers",
  "reviewLeftovers",
] as const satisfies readonly RemovableField[];

/** The two append operations and the section each one adds to. */
const APPENDS = [
  { append: "appendClaims", field: "claims" },
  { append: "appendProof", field: "proof" },
  { append: "appendNotes", field: "notes" },
] as const;

/**
 * A field-level edit, decoded STRICTLY: a misspelled field is refused rather than silently ignored, and
 * `draft`, `target` and `writtenOn` are refused by name because none of them is a description edit.
 *
 * A field named in two of set, append and remove is refused: the two operations would disagree about what the
 * field ends as, and there is no order between them a caller could predict.
 *
 * @internal — exported for its unit test
 */
export const prFormEditSchema = strictForm({
  appendClaims: z.array(claimSchema).min(1).optional(),
  appendNotes: notesSchema.optional(),
  appendProof: proofSchema.optional(),
  beforeAfter: beforeAfterSchema.optional(),
  change: cellSchema.optional(),
  claims: z.array(claimSchema).optional(),
  clickThrough: clickThroughSchema.optional(),
  failsOnMain: failsOnMainSchema.optional(),
  goldAnchor: goldAnchorSchema.optional(),
  notes: notesSchema.optional(),
  origin: cellSchema.optional(),
  problem: cellSchema.optional(),
  problemSeen: problemSeenSchema.optional(),
  proof: proofSchema.optional(),
  remove: z
    .array(z.enum(REMOVABLE))
    .min(1)
    .refine((fields) => new Set(fields).size === fields.length, "remove names a field twice")
    .optional(),
  review: reviewSchema.optional(),
  reviewers: reviewersSchema.optional(),
  reviewLeftovers: reviewLeftoversSchema.optional(),
  risk: riskSectionSchema.optional(),
  title: routingShape.title.optional(),
  whereToLook: whereToLookSchema.optional(),
  whyApproach: whyApproachSchema.optional(),
}).superRefine((edit, ctx) => {
  const { remove = [] } = edit;
  const removed = new Set<string>(remove);
  for (const field of remove) {
    if (edit[field] !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `${field} is both set and removed. Set it to change it, or remove it to drop it — not both`,
        path: ["remove"],
      });
    }
  }
  for (const { append, field } of APPENDS) {
    if (edit[append] === undefined) {
      continue;
    }
    if (edit[field] !== undefined || removed.has(field)) {
      ctx.addIssue({
        code: "custom",
        message:
          `${append} adds to ${field}, and this edit also sets or removes ${field}. Put every row in ${field} to ` +
          `replace it, or use ${append} alone to add after what is there`,
        path: [append],
      });
    }
  }
}) satisfies z.ZodType<PrFormEdit>;
