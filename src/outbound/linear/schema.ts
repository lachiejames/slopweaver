/**
 * The FORM a Linear issue is filled into — schema-enforced STRUCTURE, never content.
 *
 * What this file refuses is markdown that would escape the shape it was put in: a heading marker, and the
 * `+++` collapsible delimiter. What it deliberately does NOT refuse is anything about the WORDS — no prose
 * scanning, no banned terms, **no em-dash rule**, no AU-English check IN THIS FILE. Slopweaver supplies the
 * shape; the system filling this form supplies the content, and a body quoting an error message that contains
 * an em dash is correct input BELOW the fold. `../artifact/schema.ts` records the scar behind that.
 *
 * The claim is narrower than it once was, by the owner's ruling. `## Problem` and `## Solution` are
 * above the fold, and they now go through the voice and packing gate in `../../cli/aboveFoldDoor.ts` — which
 * sits at the door rather than here, because the operator's banned words are private configuration this file
 * cannot see and the gate carries a per-invocation override an always-on schema cannot honour. `aiPrompt`
 * renders collapsed and is never scanned, which is what keeps the quoted-error-message case working.
 *
 * ## The one exception: `## Problem` and `## Solution` carry a WORD count
 *
 * {@link SECTION_MAX_WORDS} caps how many words the structured kind's `problem` (plus `proofOfProblem`, which
 * renders under the same heading) and `solution` sections may each hold — not their content, only their
 * LENGTH, the same distinction `../github/schema.ts` draws for Problem/Solution there. This is not a new
 * decision: it matches a companion enforced Linear guard elsewhere in the org, measured against 12,508 real
 * issue bodies, which this repo's own typed form never picked up — the schema shipped before rule 7 ("no
 * walls of text, ever, on any outbound surface") did. Every ticket's human-visible section stays short by
 * construction; supporting detail belongs in a `details` fold and the agent brief in `aiPrompt`, both of
 * which render collapsed. The counter itself lives in `./sectionWords.ts`.
 *
 * ## Why the two refusals exist, measured rather than assumed
 *
 * **The `+++` delimiter.** Linear opens a collapsible with `+++ <title>` and closes it with a bare `+++`.
 * A `+++` line appearing inside the content is, by that grammar, indistinguishable from the closing
 * delimiter: it closes the block early and reattaches everything after it to the previous section. The old
 * validator returned ZERO findings on a body mangled that way — accepted, and silently wrong. That is the
 * defect class this repo cares most about, so the delimiter is unrepresentable rather than warned about.
 *
 * **The heading marker.** In {@link structuredIssueSchema} the sections ARE the fields, so a `##` line inside
 * a field can only escape the section holding it. The freeform kind has a real `heading` block instead, which
 * is why it is the only place a heading can be expressed.
 *
 * Every form is a `strictObject`, so an undeclared key is a hard rejection rather than a silent drop. A
 * `mentions:` typo where the field was `ping:` once validated clean, rendered clean and posted a card with no
 * ping and no error anywhere; these forms are authored deliberately, so an unrecognised key is a typo and a
 * typo has to fail at the door.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";

import { SECTION_MAX_WORDS, sectionOverCapMessage, wordsOfSection } from "./sectionWords.js";
import {
  anyLineMatches,
  checkSingleLine,
  checkStructuralEscapes,
  FENCE_IN_PARA_CORRECTION,
  FENCE_LINE,
  hasLineBreak,
} from "./structuralEscapes.js";

import type { FreeformIssue, LinearIssueFields, LinearIssueForm, StructuredIssue } from "./types.js";

/**
 * How many acceptance items a ticket may carry.
 *
 * Ten, not five. Measured over 1,678 real acceptance sections: the median is 5 but the largest single bucket
 * is 6-10 (644 sections), and the owner's own reference ticket carries exactly 10 because it fixes six
 * defects. A cap of 5 would reject 42% of real sections including that one. Ten admits a genuinely complex
 * ticket while still refusing the 25-item dumping ground, which is what "human readable by default" rules out.
 */
export const ACCEPTANCE_MAX_ITEMS = 10;

/** A paragraph consisting only of an image, which would defeat the "Problem opens with prose" rule. */
const IMAGE_ONLY = /^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*$/;

/** The section names the structured kind owns. A freeform body may not re-create them. */
const RESERVED_HEADINGS: ReadonlySet<string> = new Set(["problem", "solution", "acceptance criteria"]);

const paraSchema = strictForm({ kind: z.literal("para"), text: z.string().min(1) });

const checklistSchema = strictForm({
  items: z.array(strictForm({ done: z.boolean(), text: z.string().min(1) })).min(1),
  kind: z.literal("checklist"),
});

const mediaSchema = strictForm({
  alt: z.string().min(1),
  kind: z.literal("media"),
  // Required, and it decides the rendering: an image emits `![alt](url)`, anything else `[alt](url)`, because
  // an image embed around a PDF renders broken. Linear asset URLs carry no extension, so nothing can infer it.
  mime: z.string().min(1),
  // The renderer angle-brackets the URL so a `)` cannot terminate the construct, but `<`, `>` and
  // whitespace would break the angle brackets themselves — the one case escaping cannot rescue, so it is
  // refused here instead. `z.url()` alone does not exclude them.
  url: z.url().refine((u) => !/[<>\s]/.test(u), "a media URL may not contain whitespace or angle brackets"),
});

const codeSchema = strictForm({
  kind: z.literal("code"),
  // The info string shares its LINE with the opening fence, so it is the one field the collision-proof
  // fence cannot protect. Measured, not theorised: `lang: "js\`\`\`"` emits ```` ```js``` ```` which closes
  // the block on its own opening line, and `lang: "js\nsomething"` injects a whole extra line into the
  // document — a `## heading` smuggled past the section guard, which never inspects `lang`.
  // A markdown info string is one bare word, so that is exactly what is allowed.
  lang: z.string().regex(/^[A-Za-z0-9_+-]*$/, "a code language is one bare word (letters, digits, _ + -) or empty"),
  text: z.string().min(1),
});

/**
 * A list item: its own line, plus optional nested blocks.
 *
 * `nested` excludes a heading (which would escape the list, the same escape the named sections refuse) and
 * excludes a nested bulleted list (sub-lists are a separate feature with their own indentation rules, and no
 * measured ticket needed one). Excluding bullets also keeps the schema acyclic.
 */
const nestedBlockSchema = z.discriminatedUnion("kind", [paraSchema, checklistSchema, mediaSchema, codeSchema]);

const listItemSchema = strictForm({
  nested: z.array(nestedBlockSchema).min(1).optional(),
  text: z.string().min(1),
});

const bulletsSchema = strictForm({
  items: z.array(listItemSchema).min(1),
  kind: z.literal("bullets"),
});

const headingSchema = strictForm({ kind: z.literal("heading"), text: z.string().min(1) });

/** The blocks a NAMED section may hold. */
export const sectionBlockSchema = z.discriminatedUnion("kind", [
  paraSchema,
  bulletsSchema,
  checklistSchema,
  mediaSchema,
  codeSchema,
]);

/** The blocks a FREEFORM body may hold — the section blocks plus a caller-controlled heading. */
export const freeformBlockSchema = z.discriminatedUnion("kind", [
  paraSchema,
  bulletsSchema,
  checklistSchema,
  mediaSchema,
  codeSchema,
  headingSchema,
]);

/** What one block contributes to the structural checks. Split out so the refinements stay under the cap. */
function checkBlock({
  block,
  path,
  ctx,
}: {
  block: z.infer<typeof freeformBlockSchema>;
  path: readonly (string | number)[];
  ctx: z.RefinementCtx;
}): void {
  if (block.kind === "para") {
    checkStructuralEscapes({ ctx, path: [...path, "text"], text: block.text });
    if (anyLineMatches({ pattern: FENCE_LINE, text: block.text })) {
      ctx.addIssue({ code: "custom", message: FENCE_IN_PARA_CORRECTION, path: [...path, "text"] });
    }
    return;
  }
  if (block.kind === "code") {
    // A code block is NOT checked for the delimiter or a heading, and that is a deliberate reversal. The
    // renderer fences it with a backtick run longer than any inside the content, so nothing in here can
    // close its own fence and nothing in here is parsed as structure. That makes the common legitimate case
    // work: a unified diff whose header lines begin with `+++`. Refusing it would have been a false alarm
    // bought with no safety, once the fence itself stopped being forgeable.
    return;
  }
  if (block.kind === "heading") {
    checkStructuralEscapes({ ctx, path: [...path, "text"], text: block.text });
    checkSingleLine({ ctx, path: [...path, "text"], text: block.text, what: "heading" });
    return;
  }
  if (block.kind === "media") {
    // No raw-HTML check: the renderer escapes an alt's angle brackets, so `Array<string>` renders as written.
    checkSingleLine({ ctx, path: [...path, "alt"], text: block.alt, what: "media alt text" });
    return;
  }
  if (block.kind === "bullets") {
    block.items.forEach((item, index) => {
      checkStructuralEscapes({ ctx, path: [...path, "items", index, "text"], text: item.text });
      checkSingleLine({ ctx, path: [...path, "items", index, "text"], text: item.text, what: "list item" });
      // Blocks nested UNDER an item get the same structural checks as top-level ones. Skipping them would
      // leave a `+++` or a fence reachable simply by indenting it one level. An item with no nested blocks has
      // none to check.
      if (item.nested !== undefined) {
        item.nested.forEach((inner, innerIndex) => {
          checkBlock({ block: inner, ctx, path: [...path, "items", index, "nested", innerIndex] });
        });
      }
    });
    return;
  }
  block.items.forEach((item, index) => {
    checkStructuralEscapes({ ctx, path: [...path, "items", index], text: item.text });
    checkSingleLine({ ctx, path: [...path, "items", index], text: item.text, what: "list item" });
  });
}

/**
 * Walk a block array.
 *
 * Exported for `./commentSchema.ts`: a comment's `detail` reuses `sectionBlockSchema` but was never handed
 * to any structural check, so a `+++` line in one was ACCEPTED and would close the comment's own collapsible
 * early — measured on this tree with `linearCommentFormSchema.safeParse` over a detail
 * paragraph opening with `+++`. The block schema carries the SHAPE; the structural rules have always lived
 * in a refinement above it, and the comment form simply never grew one. The project-update and initiative-update
 * forms (`./projectUpdateSchema.ts`, `./initiativeSchema.ts`) carried the same gap over their own folded `detail`
 * once, and call it for the same reason.
 *
 * @param blocks the blocks to walk
 * @param field the field name they live under, for issue paths
 * @param ctx the refinement context to report into
 */
export function checkBlocks({
  blocks,
  field,
  ctx,
}: {
  blocks: readonly z.infer<typeof freeformBlockSchema>[];
  field: string;
  ctx: z.RefinementCtx;
}): void {
  blocks.forEach((block, index) => {
    checkBlock({ block, ctx, path: [field, index] });
  });
}

/**
 * One `details` fold. `blocks` is the section vocabulary, so a fold can never hold a heading (which escapes
 * the block on Linear's grammar) or another fold (Linear's collapsibles do not nest).
 */
const detailsBlockSchema = strictForm({
  blocks: z.array(sectionBlockSchema).min(1),
  title: z.string().refine((t) => t.trim().length > 0, "a details title names its fold, so it may not be blank"),
});

/** A title that ENDS in the delimiter, which turns the opener into the one-line form Linear renders as text. */
const TRAILING_DELIMITER = /\+\+\+[ \t]*$/;

/**
 * The AI prompt's own title, compared case-insensitively. The owner's tooling greps for it to find a ticket's
 * agent brief, so a details fold carrying it would read as a second brief.
 */
const RESERVED_FOLD_TITLE = "prompt for ai agents";

/** Refuse a details fold whose title or blocks would break the document. */
function checkDetails({
  details,
  ctx,
}: {
  details: readonly z.infer<typeof detailsBlockSchema>[];
  ctx: z.RefinementCtx;
}): void {
  details.forEach((fold, index) => {
    const path = ["details", index, "title"];
    checkStructuralEscapes({ ctx, path, text: fold.title });
    checkSingleLine({ ctx, path, text: fold.title, what: "details title" });
    if (TRAILING_DELIMITER.test(fold.title)) {
      ctx.addIssue({
        code: "custom",
        message:
          'a details title ending in "+++" puts the opener and closer on one line, which Linear renders as ' +
          "text rather than a fold. The renderer emits the closer; drop it from the title.",
        path,
      });
    }
    if (fold.title.trim().toLowerCase() === RESERVED_FOLD_TITLE) {
      ctx.addIssue({
        code: "custom",
        message:
          `"${fold.title}" is the AI prompt's own title, which tooling reads as the ticket's agent brief. Put ` +
          "the brief in aiPrompt, or give this fold a title that names its detail.",
        path,
      });
    }
    fold.blocks.forEach((block, blockIndex) => {
      checkBlock({ block, ctx, path: ["details", index, "blocks", blockIndex] });
    });
  });
}

/**
 * Why the Problem section must OPEN with a paragraph.
 *
 * The owner's rule, and it is about reading order rather than tidiness: a reader deciding whether this ticket
 * is worth their attention needs the problem stated before they are shown a screenshot of it. Media inside
 * the section is fully supported and positional; it just cannot come first.
 */
const PROBLEM_LEAD_MESSAGE =
  "the Problem section must OPEN with a paragraph — state the problem before showing an image of it. Media " +
  "is positional and may appear anywhere after the opening paragraph.";

/** The structured form: named sections, no caller-controlled headings. */
export const structuredIssueSchema = z
  .strictObject({
    acceptance: z.array(z.string().min(1)).min(1).max(ACCEPTANCE_MAX_ITEMS).optional(),
    aiPrompt: z.array(sectionBlockSchema).min(1),
    details: z.array(detailsBlockSchema).min(1).optional(),
    kind: z.literal("structured"),
    problem: z.array(sectionBlockSchema).min(1),
    proofOfProblem: z.array(sectionBlockSchema).min(1).optional(),
    solution: z.array(sectionBlockSchema).min(1),
  })
  .superRefine((issue, ctx) => {
    checkBlocks({ blocks: issue.problem, ctx, field: "problem" });
    checkBlocks({ blocks: issue.solution, ctx, field: "solution" });
    checkBlocks({ blocks: issue.aiPrompt, ctx, field: "aiPrompt" });
    // `details` is optional: an issue with nothing to fold has no title or block to check. Its words never
    // count toward the Problem or Solution cap, because a fold is below the fold by construction.
    if (issue.details !== undefined) {
      checkDetails({ ctx, details: issue.details });
    }
    if (issue.proofOfProblem !== undefined) {
      checkBlocks({ blocks: issue.proofOfProblem, ctx, field: "proofOfProblem" });
    }
    const lead = issue.problem[0];
    // A paragraph whose entire text is an image satisfies `kind === "para"` while visibly opening the ticket
    // with a screenshot, which is the exact thing the rule exists to prevent. Checking the discriminator
    // alone was a rule about the type rather than about what a reader sees.
    if (lead?.kind !== "para" || IMAGE_ONLY.test(lead.text)) {
      ctx.addIssue({ code: "custom", message: PROBLEM_LEAD_MESSAGE, path: ["problem", 0] });
    }
    // Acceptance criteria are optional: an issue that declares none has no item to check.
    if (issue.acceptance !== undefined) {
      issue.acceptance.forEach((text, index) => {
        checkStructuralEscapes({ ctx, path: ["acceptance", index], text });
        checkSingleLine({ ctx, path: ["acceptance", index], text, what: "acceptance item" });
      });
    }
    // `proofOfProblem` renders as an ADDITIONAL paragraph under the SAME `## Problem` heading, with no
    // heading of its own — its words count against the same 50-word budget, not a separate one.
    const problemWords =
      wordsOfSection({ blocks: issue.problem }) +
      (issue.proofOfProblem === undefined ? 0 : wordsOfSection({ blocks: issue.proofOfProblem }));
    if (problemWords > SECTION_MAX_WORDS) {
      ctx.addIssue({
        code: "custom",
        message: sectionOverCapMessage({ section: "problem", words: problemWords }),
        path: ["problem"],
      });
    }
    const solutionWords = wordsOfSection({ blocks: issue.solution });
    if (solutionWords > SECTION_MAX_WORDS) {
      ctx.addIssue({
        code: "custom",
        message: sectionOverCapMessage({ section: "solution", words: solutionWords }),
        path: ["solution"],
      });
    }
  }) satisfies z.ZodType<StructuredIssue>;

/** The freeform form: one ordered body, headings allowed, the collapsible still required. */
export const freeformIssueSchema = z
  .strictObject({
    aiPrompt: z.array(sectionBlockSchema).min(1),
    body: z.array(freeformBlockSchema).min(1),
    details: z.array(detailsBlockSchema).min(1).optional(),
    kind: z.literal("freeform"),
  })
  .superRefine((issue, ctx) => {
    checkBlocks({ blocks: issue.body, ctx, field: "body" });
    checkBlocks({ blocks: issue.aiPrompt, ctx, field: "aiPrompt" });
    // `details` is optional: a freeform issue with nothing to fold has no title or block to check.
    if (issue.details !== undefined) {
      checkDetails({ ctx, details: issue.details });
    }
    // The opt-out may not impersonate the shape it opts out of. Without this, a freeform body can emit
    // `## Problem` / `## Solution` / `## Acceptance criteria` and produce something that LOOKS like the
    // structured kind while bypassing every guarantee it carries — the opening paragraph, the checkbox
    // rule, the item cap. A reader cannot tell the two apart, which makes the guarantee worthless where it
    // is most likely to be relied on.
    issue.body.forEach((block, index) => {
      if (block.kind !== "heading" || !RESERVED_HEADINGS.has(block.text.trim().toLowerCase())) {
        return;
      }
      ctx.addIssue({
        code: "custom",
        message:
          `"${block.text}" is a heading the structured kind owns, so a freeform body may not re-create it. ` +
          "Use the structured kind if you want these sections; they come with guarantees this one cannot make.",
        path: ["body", index, "text"],
      });
    });
  }) satisfies z.ZodType<FreeformIssue>;

/**
 * Either issue body, chosen by `kind`.
 *
 * Discriminated rather than a plain union so the chosen arm's own refusal is what a composer reads: since zod
 * 4.6.6 an over-long `acceptance` aborts before its items parse, and a plain union then has no arm left to
 * report and says only `Invalid input`.
 */
export const linearIssueArtifactSchema = z.discriminatedUnion("kind", [structuredIssueSchema, freeformIssueSchema]);

/** A Linear team key's shape: capitals and digits, opening on a letter — `ENG`, `SUP2`. */
const TEAM_KEY_SHAPE = /^[A-Z][A-Z0-9]*$/;

/**
 * An RFC 9562 UUID of any version 1–8, in any case: what a Linear team id is. Narrower than `z.guid()`, which
 * takes any 8-4-4-4-12 hex (a version-0 value included), and than `z.uuid()`, which admits the nil and max
 * UUIDs — neither names a team.
 */
const TEAM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The refusal for a `teamId` that is not a UUID. A value shaped like a team key gets the literal command, put
 * CONDITIONALLY because the schema cannot know such a team exists; anything else (an empty string, a slug)
 * gets the command with a placeholder, because `linear states --team team-1` would answer nothing true.
 */
function teamIdRefusal({ input }: { input: string }): string {
  if (TEAM_KEY_SHAPE.test(input)) {
    return (
      `teamId "${input}" is not a team UUID, and a team key is not accepted; ` +
      `if ${input} is a team's key, \`slopweaver linear states --team ${input}\` prints its UUID`
    );
  }
  return `teamId ${JSON.stringify(input)} is not a team UUID; \`slopweaver linear states --team <team-key>\` prints it`;
}

/**
 * The non-body fields.
 *
 * `priority` is a fixed enum because Linear's scale is global; `estimate` and `stateId` are unconstrained
 * here because their valid values come from the destination team, not from this file.
 */
export const linearIssueFieldsSchema = strictForm({
  // A roster KEY, not a Linear user id — see `./types.ts`. Its VALUE is not constrained here beyond being a
  // non-empty single-line string, because what counts as resolvable comes from the roster, not from a regex.
  // `null` is CLEAR THE ASSIGNEE, which is a different instruction from omitting the field (leave it
  // alone). Both have to be expressible or a ticket can be assigned but never handed back.
  assignee: z
    .union([
      z
        .string()
        .min(1)
        .refine(
          (text) => !hasLineBreak({ text }),
          "an assignee is one key, on one line — mentions are exact-match only",
        ),
      z.null(),
    ])
    .optional(),
  // `null` REMOVES the issue from its cycle; omitting the field leaves the cycle alone.
  cycleId: z.union([z.string().min(1), z.null()]).optional(),
  // `null` CLEARS the estimate; omitting the field leaves it alone.
  estimate: z.union([z.number().int().nonnegative(), z.null()]).optional(),
  labelIds: z.array(z.string().min(1)).optional(),
  // `null` DETACHES the issue from its parent; omitting the field leaves the parent alone.
  parentId: z.union([z.string().min(1), z.null()]).optional(),
  priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  // `null` DETACHES the issue from its project; omitting the field leaves the project alone.
  projectId: z.union([z.string().min(1), z.null()]).optional(),
  stateId: z.string().min(1).optional(),
  // The team's UUID, never its key. `issueCreate` refuses a key with an Argument Validation Error, and a
  // dry run that accepted one certified a write the provider then refused; refused HERE, both paths refuse
  // alike. A missing or non-string team keeps Zod's own type message; only a string has a key to name.
  teamId: z.string().regex(TEAM_UUID, {
    error: (issue) => (typeof issue.input === "string" ? teamIdRefusal({ input: issue.input }) : undefined),
  }),
  // Never constrained in its WORDS: a title is the same on every Linear ticket and carries no shape rules.
  // One line only, because Linear stores it as a single-line field, so a newline is dropped on the wire and
  // the title you asked for is not the title you get — a silent difference, which is the one kind we refuse.
  title: z
    .string()
    .min(1)
    .refine(
      (text) => !hasLineBreak({ text }),
      "a Linear title is a single line; the newline would be dropped silently",
    ),
}) satisfies z.ZodType<LinearIssueFields>;

/** A complete write. */
export const linearIssueFormSchema = strictForm({
  artifact: linearIssueArtifactSchema,
  fields: linearIssueFieldsSchema,
}) satisfies z.ZodType<LinearIssueForm>;
