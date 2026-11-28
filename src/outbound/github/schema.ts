/**
 * The C3 FORM a pull request is filled into — schema-enforced STRUCTURE.
 *
 * This form is a contract for a machine caller as much as a human one, so every custom message says what is wrong
 * AND what to do instead, and every object is a `strictForm`: an undeclared key — a retired `origin`, `review`,
 * `goldAnchor` or `reviewers` among them — is a hard rejection rather than a silent drop.
 *
 * Two schemas READ (a body `./parse.ts` recovered, a form the ledger stored) and one writes (`./writeSchema.ts`),
 * which adds every rule in `./formRules.ts`. The edit schema here is structural too; the form an edit merges to is
 * re-validated by the write schema before anything renders.
 *
 * Every content cell renders inside an HTML block, where GitHub parses no Markdown and a blank line would end the
 * block early, so no run carries a newline and a backtick outside a `code` run is refused. Every field a badge hover
 * carries is plain text (a `title` attribute shows no markup) and must read back out of its hover exactly, which is
 * where its own refusals come from (`./tooltips.ts`).
 */
import { z } from "zod";
import { strictForm } from "../strictForm.js";
import { utcMidnightOf } from "./days.js";
import { HTTPS, imageSchema } from "./schemaImage.js";
import { LINE_BREAK, lineText, nonBlank } from "./schemaText.js";
import type {
  CheckGroup,
  Content,
  Inline,
  PrBody,
  PrForm,
  PrFormEdit,
  ProblemSeen,
  ProofSlot,
  PrTarget,
  RerunItem,
  RiskItem,
  RiskSection,
  UncheckedItem,
  WorstKind,
} from "./types.js";

const inlineSchema = z.discriminatedUnion("kind", [
  strictForm({ kind: z.literal("text"), text: nonBlank() }),
  strictForm({ kind: z.literal("strong"), text: nonBlank() }),
  strictForm({ kind: z.literal("em"), text: nonBlank() }),
  strictForm({ kind: z.literal("code"), text: nonBlank() }),
  strictForm({ kind: z.literal("link"), text: nonBlank(), url: HTTPS }),
]) satisfies z.ZodType<Inline>;

/** The issues one run of a cell raises: a newline anywhere, a backtick outside a code run. */
function runIssues({ run }: { run: Inline }): readonly string[] {
  const issues: string[] = [];
  if (LINE_BREAK.test(run.text)) {
    issues.push("a run carries a newline. Every cell is a one-line HTML block, and a blank line ends it early");
  }
  if (run.kind !== "code" && run.text.includes("`")) {
    issues.push(
      `a run carries a backtick outside a { "kind": "code" } run: "${run.text}". GitHub parses no Markdown inside ` +
        'an HTML block, so it would reach the reader literally. Put it in { "kind": "code", "text": "…" }',
    );
  }
  return issues;
}

/** One content cell: at least one run, none with a newline or a stray backtick. */
export const contentSchema = z
  .array(inlineSchema)
  .min(1)
  .superRefine((content, ctx) => {
    for (const message of content.flatMap((run) => runIssues({ run }))) {
      ctx.addIssue({ code: "custom", message });
    }
  }) satisfies z.ZodType<Content>;

/**
 * A git ref or repo segment. Excludes whitespace and control characters ONLY: hyphens, slashes and dots are all
 * legal and common in real refs.
 */
const REF = z
  .string()
  .min(1)
  .regex(/^[!-~¡-￿]+$/, "must not contain whitespace or control characters");

export const prTargetSchema = strictForm({
  base: REF,
  head: REF,
  owner: REF,
  repo: REF,
}) satisfies z.ZodType<PrTarget>;

/** A real `YYYY-MM-DD` UTC calendar day. */
export const daySchema = z
  .string()
  .refine((day) => utcMidnightOf({ day }) !== undefined, "must be a real YYYY-MM-DD calendar day (UTC)");

/** The three kinds of worst case, in the order of the level each implies, high first. */
export const WORST_KINDS = [
  "loses-leaks-or-changes-off-machine",
  "something-working-breaks",
  "only-tests-docs-or-dev-tooling",
] as const satisfies readonly WorstKind[];

const worstKindSchema = z.enum(WORST_KINDS, {
  error:
    `worstKind is which kind of worst case this is, and the level follows from it: "${WORST_KINDS[0]}" (high: it ` +
    `loses or leaks data, or changes something off this machine), "${WORST_KINDS[1]}" (medium: something that ` +
    `worked refuses, slows or reports wrong) or "${WORST_KINDS[2]}" (low: only tests, docs or dev tooling can break)`,
}) satisfies z.ZodType<WorstKind>;

/**
 * A plain sentence a badge hover carries: one line, and no closing full stop, which the hover adds.
 *
 * @param what the field, named in the refusal
 * @returns the string schema
 */
function hoverSentence({ what }: { what: string }): z.ZodType<string> {
  return lineText({ what }).refine(
    (value) => !value.endsWith(".") && value.trim() === value,
    `${what} has no closing full stop and no surrounding spaces: the badge hover adds the stop, so a typed one ` +
      "would read back doubled. Remove it",
  );
}

const riskItemSchema = strictForm({
  check: z.discriminatedUnion("kind", [
    strictForm({
      check: hoverSentence({ what: "a risk item's check" }).refine(
        (value) => !value.startsWith("Not checked: "),
        'a checked risk item\'s check may not open with "Not checked: ", which is how the hover marks an unchecked one',
      ),
      kind: z.literal("checked"),
    }),
    strictForm({ kind: z.literal("unchecked"), why: hoverSentence({ what: "why a risk item was not checked" }) }),
  ]),
  worst: hoverSentence({ what: "a risk item's worst case" }).refine(
    (value) => !value.includes(". "),
    'a risk item\'s worst case is one sentence, so it may not carry ". ": the hover is read back by splitting there',
  ),
  worstKind: worstKindSchema,
}) satisfies z.ZodType<RiskItem>;

const riskSectionSchema = strictForm({
  items: z.array(riskItemSchema).min(1).max(5),
}) satisfies z.ZodType<RiskSection>;

const problemSeenSchema = z.discriminatedUnion("kind", [
  strictForm({
    by: z.enum(["owner", "agent", "unrecorded"]),
    kind: z.literal("seen"),
    on: daySchema,
    what: hoverSentence({ what: "what was seen" }),
  }),
  strictForm({ kind: z.literal("not-seen"), why: hoverSentence({ what: "why the problem was not seen yet" }) }),
]) satisfies z.ZodType<ProblemSeen>;

/** A fence's info string: one bare word or empty, since it shares its LINE with the opening fence. */
const fenceLang = z
  .string()
  .regex(/^[A-Za-z0-9_+-]*$/, "a code language is one bare word (letters, digits, _ + -) or empty");

/**
 * The refusal of a blank line in a quote: the body is read back as blocks split at blank lines, and the authoring
 * file drops them, so one would not come back. A quote is the lines that prove the point, not the whole log.
 */
const QUOTE_BLANK_LINE_MESSAGE =
  "a quote carries a blank line, which would not read back: the description splits at blank lines. Quote only the " +
  "lines that prove it, with no blank line between them";

/** A quote's verbatim output: what the reader can bring back byte for byte, and nothing else. */
const quoteTextSchema = nonBlank()
  .refine((text) => !text.includes("\r"), "a carriage return in a quote may not read back. Use a newline alone")
  .refine((text) => !text.includes("\0"), "a quote carries a NUL byte, which a description cannot hold")
  .refine((text) => text.split("\n").every((line) => line.trim().length > 0), QUOTE_BLANK_LINE_MESSAGE);

/** Where a quote can be read again: one link run, or one code run naming the command that prints it. */
const quoteSourceSchema = z.discriminatedUnion("kind", [
  strictForm({ kind: z.literal("link"), text: nonBlank(), url: HTTPS }),
  // The authoring file writes a code source between single backticks, so one inside it would not read back.
  strictForm({
    kind: z.literal("code"),
    text: nonBlank().refine((text) => !text.includes("`"), {
      message: "a code source carries no backtick; quote that command's job log as a link source instead",
    }),
  }),
]);

const proofSlotSchema = z.discriminatedUnion("kind", [
  strictForm({
    image: imageSchema,
    kind: z.literal("screenshot"),
    proves: contentSchema,
    runBy: z.enum(["owner", "agent"]),
  }),
  strictForm({
    kind: z.literal("quote"),
    lang: fenceLang,
    proves: contentSchema,
    runBy: z.enum(["owner", "agent"]),
    source: quoteSourceSchema.superRefine((run, context) => {
      for (const issue of runIssues({ run })) {
        context.addIssue({ code: "custom", message: `the quote's source: ${issue}` });
      }
    }),
    text: quoteTextSchema,
  }),
  strictForm({ kind: z.literal("reason"), reason: contentSchema }),
]) satisfies z.ZodType<ProofSlot>;

const uncheckedSchema = strictForm({ check: contentSchema, why: contentSchema }) satisfies z.ZodType<UncheckedItem>;

/** A labelled group of checks: a label and one to eight checks nested under it. */
const checkGroupSchema = strictForm({
  items: z.array(contentSchema).min(1).max(8),
  label: contentSchema,
}) satisfies z.ZodType<CheckGroup>;

/**
 * The refusal of a carriage return in a command: GitHub's web editor saves a body with CRLF, so the reader takes
 * every CRLF as LF, and one the form carried would come back changed.
 */
const CARRIAGE_RETURN_MESSAGE =
  "a carriage return in a command may not read back, since a description is read with CRLF as LF. Use a newline alone";

const rerunItemSchema = z.discriminatedUnion("kind", [
  strictForm({
    kind: z.literal("command"),
    lang: fenceLang,
    text: nonBlank().refine((text) => !text.includes("\r"), CARRIAGE_RETURN_MESSAGE),
  }),
  strictForm({ items: z.array(contentSchema).min(1), kind: z.literal("tests") }),
  strictForm({ content: contentSchema, kind: z.literal("note") }),
]) satisfies z.ZodType<RerunItem>;

/** Every body field, shared by the read schemas here and the write schema in `./writeSchema.ts`. */
export const bodyShape = {
  // At least one when present: an empty list renders as none, so it could not come back from the body it wrote.
  checkGroups: z
    .array(checkGroupSchema)
    .min(1, "checkGroups holds at least one group when present; leave it out for none")
    .max(4)
    .optional(),
  checks: z.array(contentSchema).max(8),
  explainer: contentSchema,
  notChecked: z.array(uncheckedSchema).max(8),
  problemProof: proofSlotSchema,
  problemSeen: problemSeenSchema,
  rerun: z.array(rerunItemSchema).max(8),
  risk: riskSectionSchema,
  solutionProof: proofSlotSchema,
  visualProof: z.enum(["screen-change", "nothing-on-screen"]),
};

/** The routing fields a whole form carries beside its body. */
export const routingShape = {
  target: prTargetSchema,
  title: lineText({ what: "the pull-request title" }),
};

/** A body as `./parse.ts` recovers it: structure, without the write schema's form rules. */
export const prBodySchema = strictForm(bodyShape) satisfies z.ZodType<PrBody>;

/**
 * A whole form as the ledger stores it: structure only. A record written in any other shape fails to decode and is
 * dropped as a cache miss (`./prLedger.ts`).
 */
export const storedPrFormSchema = strictForm({
  ...bodyShape,
  ...routingShape,
  draft: z.boolean(),
}) satisfies z.ZodType<PrForm>;

/** The two append operations and the section each one adds to. */
const APPENDS = [
  { append: "appendChecks", field: "checks" },
  { append: "appendNotChecked", field: "notChecked" },
] as const;

/**
 * A field-level edit, decoded STRICTLY: a misspelled field is refused rather than silently ignored, and `draft` and
 * `target` are refused because neither is a description edit. An optional section is dropped by setting it to `[]`.
 *
 * A field both set and appended to is refused: the two would disagree about what it ends as.
 */
export const prFormEditSchema = strictForm({
  appendChecks: z.array(contentSchema).min(1).optional(),
  appendNotChecked: z.array(uncheckedSchema).min(1).optional(),
  // `[]` drops the groups, as for every optional section, so the edit takes the empty list the body refuses.
  checkGroups: z.array(checkGroupSchema).max(4).optional(),
  checks: bodyShape.checks.optional(),
  explainer: contentSchema.optional(),
  notChecked: bodyShape.notChecked.optional(),
  problemProof: proofSlotSchema.optional(),
  problemSeen: problemSeenSchema.optional(),
  rerun: bodyShape.rerun.optional(),
  risk: riskSectionSchema.optional(),
  solutionProof: proofSlotSchema.optional(),
  title: routingShape.title.optional(),
  visualProof: bodyShape.visualProof.optional(),
}).superRefine((edit, ctx) => {
  for (const { append, field } of APPENDS) {
    if (edit[append] !== undefined && edit[field] !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          `${append} adds to ${field}, and this edit also sets ${field}. Put every item in ${field} to replace it, ` +
          `or use ${append} alone to add after what is there`,
        path: [append],
      });
    }
  }
}) satisfies z.ZodType<PrFormEdit>;
