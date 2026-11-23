/**
 * The FORM `linear briefing build` validates against — `./briefingTypes.ts`'s vocabulary, made strict.
 *
 * Every embedded write is the provider form its own verb already validates, imported rather than restated, so
 * a briefing item that parses here is a write that verb would accept the shape of. What this file adds is what
 * only the aggregate can see:
 *
 *  - **one id per item**, kebab-case, because the owner's answer names items by it and every file is keyed by it;
 *  - **evidence on every item**, because a proposal nobody can trace is the assertion this exists to replace;
 *  - **every source accounted for exactly once**, so a source nobody read cannot vanish from the page;
 *  - **a move names its state**, and a backlog move is ALL THREE of a state, `cycleId: null` and
 *    `assignee: null` (Backlog always means all of them) — a partial move is worse
 *    than none, so it is unrepresentable rather than reviewed.
 */
import { z } from "zod";

import { strictForm } from "../strictForm.js";

import type {
  LinearBriefingCoverage,
  LinearBriefingEvidence,
  LinearBriefingForm,
  LinearBriefingIssueMove,
  LinearBriefingProposal,
  LinearBriefingTarget,
  LinearBriefingWrite,
} from "./briefingTypes.js";
import { LINEAR_BRIEFING_SOURCES } from "./briefingTypes.js";
import { linearCommentFormSchema, linearRelationFormSchema } from "./commentSchema.js";
import { linearProjectUpdateFormSchema } from "./projectUpdateSchema.js";
import { linearIssueFormSchema } from "./schema.js";
import { hasLineBreak } from "./structuralEscapes.js";

/** An item id: what the owner types back, and a filename component. */
const ITEM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One line of prose the page shows as written. */
const oneLine = z
  .string()
  .min(1)
  .refine((text) => !hasLineBreak({ text }), "one line — the page renders it as a single row");

/** A URL a reader can open: the same refusal every Linear form makes. */
const openableUrl = z.url().refine((url) => !/[<>\s]/.test(url), "a URL may not contain whitespace or angle brackets");

const evidenceSchema = strictForm({ label: oneLine, url: openableUrl }) satisfies z.ZodType<LinearBriefingEvidence>;

const targetSchema = strictForm({
  identifier: oneLine.optional(),
  state: oneLine.optional(),
  title: oneLine,
  url: openableUrl,
}) satisfies z.ZodType<LinearBriefingTarget>;

const coverageSchema = strictForm({
  note: oneLine,
  read: z.boolean(),
  source: z.enum(LINEAR_BRIEFING_SOURCES),
}) satisfies z.ZodType<LinearBriefingCoverage>;

/** A fields-only move: it must SET a state, or it is not a move at all. */
const issueMoveShape = {
  issueId: z.uuidv4(
    "a move names its issue by the UUID v4 `linear read <key> --json` prints — `linear issue update` takes no key",
  ),
  toState: oneLine,
  update: linearIssueFormSchema.refine(
    (form) => form.fields.stateId !== undefined,
    "a move sets fields.stateId — copy one `slopweaver linear states --team <key>` printed",
  ),
};

const issueMoveSchema = strictForm(issueMoveShape) satisfies z.ZodType<LinearBriefingIssueMove>;

const writeSchema = z.discriminatedUnion("kind", [
  strictForm({ comment: linearCommentFormSchema, kind: z.literal("comment") }),
  strictForm({ ...issueMoveShape, kind: z.literal("state-change") }),
  strictForm({ ...issueMoveShape, kind: z.literal("stale-to-backlog") }).refine(
    (write) => write.update.fields.cycleId === null && write.update.fields.assignee === null,
    "a backlog move is the Backlog state AND `cycleId: null` AND `assignee: null` in one form — a partial " +
      "move leaves it in the cycle and on the assignee",
  ),
  strictForm({
    by: targetSchema,
    close: issueMoveSchema.optional(),
    comment: linearCommentFormSchema,
    kind: z.literal("superseded"),
    relation: linearRelationFormSchema.optional(),
  }),
  strictForm({ kind: z.literal("project-update"), update: linearProjectUpdateFormSchema }),
]) satisfies z.ZodType<LinearBriefingWrite>;

const proposalSchema = strictForm({
  confidence: z.enum(["high", "low"]),
  evidence: z.array(evidenceSchema).min(1, "every proposal carries at least one evidence link"),
  id: z.string().regex(ITEM_ID, "an item id is lower-case kebab, e.g. `eng-42-backlog`"),
  target: targetSchema,
  why: oneLine,
  write: writeSchema,
}) satisfies z.ZodType<LinearBriefingProposal>;

/** True when the IANA zone is one this runtime can format in. */
function isKnownZone({ zone }: { zone: string }): boolean {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: zone }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
}

/** A complete `linear briefing build` input. */
export const linearBriefingFormSchema = strictForm({
  asOfIso: z.iso.datetime({ offset: true }),
  coverage: z.array(coverageSchema),
  evidenceSinceIso: z.union([z.iso.datetime({ offset: true }), z.null()]),
  lean: oneLine,
  proposals: z.array(proposalSchema),
  zone: z.string().refine((zone) => isKnownZone({ zone }), "zone is an IANA name, e.g. Australia/Melbourne"),
}).superRefine((form, ctx) => {
  const seen = new Set<string>();
  form.proposals.forEach((proposal, index) => {
    if (seen.has(proposal.id)) {
      ctx.addIssue({ code: "custom", message: `item id "${proposal.id}" is used twice`, path: ["proposals", index] });
    }
    seen.add(proposal.id);
  });
  for (const source of LINEAR_BRIEFING_SOURCES) {
    const count = form.coverage.filter((entry) => entry.source === source).length;
    if (count !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `coverage names "${source}" ${String(count)} times — exactly once, read or a named gap`,
        path: ["coverage"],
      });
    }
  }
}) satisfies z.ZodType<LinearBriefingForm>;
