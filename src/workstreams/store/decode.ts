/**
 * The two documents the store keeps as `jsonb` — a workstream's `detail` and the register-level meta — decoded,
 * because `jsonb` is storage and not validation. Every read and every write passes through here.
 *
 * A `detail` holds only the authored fields nothing queries by, per kind; its timeline, milestones, links and
 * related workstreams have relational homes, and the fields that belonged to the retired five-step bar (`reaches`,
 * `lastStretch`, an authored `next`) are refused rather than carried. The nested shapes come from
 * `../schema.ts`, so a field reads by one rule wherever it is held.
 *
 * Pure.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import {
  channelsSchema,
  dateSchema,
  endingSchema,
  feedbackSchema,
  gaugeSchema,
  idSchema,
  membershipField,
  personSchema,
  prioritySchema,
  queueWorkstreamSchema,
  textSchema,
  waitingOnSchema,
} from "../schema.js";

import {
  WORKSTREAM_ENTRY_KINDS,
  WORKSTREAM_KINDS,
  WORKSTREAM_LINK_KINDS,
  WORKSTREAM_STATUSES,
  WORKSTREAM_WORKSPACES,
  type WorkstreamAggregate,
  type WorkstreamKind,
  type WorkstreamRegisterMeta,
} from "./types.js";

/** The fields a workstream that someone drives toward an outcome shares, whoever leads it. */
const driven = {
  boardMembership: membershipField,
  ending: endingSchema,
  feedback: z.array(feedbackSchema),
  initiative: z.string().nullable(),
  numbers: textSchema,
  people: z.array(personSchema),
  priority: prioritySchema,
  queueWorkstream: queueWorkstreamSchema,
  skeptic: textSchema.nullable(),
  tags: z.array(textSchema),
  waitingOn: waitingOnSchema,
};

/** An `outcome` or `standing` workstream: the owner's own. */
const ownDetailSchema = z.strictObject({ ...driven, agreedBy: textSchema, statusNote: textSchema, team: textSchema });

/** A `linked` workstream: somebody else leads it, the owner's work feeds it, its gauge is theirs. */
const linkedDetailSchema = z.strictObject({ ...driven, gauge: gaugeSchema, leads: textSchema, yourPart: textSchema });

/** A `local` workstream: the means, kept on the page only. */
const localDetailSchema = z.strictObject({ note: textSchema });

/** A `closing` workstream: finished, handed over or wound down, kept so "is it still holding?" can be asked. */
const closingDetailSchema = z.strictObject({
  closedOn: dateSchema.nullable(),
  ending: endingSchema,
  holding: textSchema,
  people: z.array(personSchema),
  state: textSchema,
});

const DETAIL_BY_KIND: Readonly<Record<WorkstreamKind, z.ZodType<Readonly<Record<string, unknown>>>>> = {
  closing: closingDetailSchema,
  linked: linkedDetailSchema,
  local: localDetailSchema,
  outcome: ownDetailSchema,
  standing: ownDetailSchema,
};

/** An `outcome` or `standing` workstream's detail, decoded. */
export type OwnWorkstreamDetail = z.infer<typeof ownDetailSchema>;
/** A `linked` workstream's detail, decoded. */
type LinkedWorkstreamDetail = z.infer<typeof linkedDetailSchema>;
/** A `local` workstream's detail, decoded. */
type LocalWorkstreamDetail = z.infer<typeof localDetailSchema>;
/** A `closing` workstream's detail, decoded. */
export type ClosingWorkstreamDetail = z.infer<typeof closingDetailSchema>;

/** A workstream's detail as its kind types it, so a reader branches on `kind` and reads typed fields. */
export type TypedWorkstreamDetail =
  | { readonly kind: "outcome" | "standing"; readonly detail: OwnWorkstreamDetail }
  | { readonly kind: "linked"; readonly detail: LinkedWorkstreamDetail }
  | { readonly kind: "local"; readonly detail: LocalWorkstreamDetail }
  | { readonly kind: "closing"; readonly detail: ClosingWorkstreamDetail };

/**
 * A workstream's detail typed by its kind. Every aggregate a reader holds came through the store, which decoded this
 * same detail on the way in and on the way out, so a failure here is a broken invariant, not a refusal to report.
 *
 * @param aggregate a workstream the store returned, or one `judgeProposedAggregate` accepted
 * @returns its kind and detail, typed
 */
export function typedWorkstreamDetail({
  aggregate,
}: {
  aggregate: { readonly id: string; readonly kind: WorkstreamKind; readonly detail: unknown };
}): TypedWorkstreamDetail {
  const { id, kind, detail } = aggregate;
  switch (kind) {
    case "outcome":
    case "standing":
      return { detail: ownDetailSchema.parse(detail), kind };
    case "linked":
      return { detail: linkedDetailSchema.parse(detail), kind };
    case "local":
      return { detail: localDetailSchema.parse(detail), kind };
    case "closing":
      return { detail: closingDetailSchema.parse(detail), kind };
    default: {
      const unhandled: never = kind;
      throw new Error(`workstream ${id} has kind ${String(unhandled)}, which no detail schema decodes`);
    }
  }
}

const metaSchema = z.strictObject({
  channels: channelsSchema,
  grouping: z.strictObject({ anchor: textSchema, builtFrom: textSchema, label: textSchema, why: textSchema }),
  initiatives: z.array(z.strictObject({ id: idSchema, name: textSchema })),
});

/**
 * A proposed aggregate's runtime shape, primitive by primitive, exactly as `WorkstreamAggregate` declares it. Each
 * field a cast could mistype becomes its own divergence — an enum value Postgres refuses, a `done: "off"` its boolean
 * column coerces to `false` while the in-memory store keeps the string — so the whole shape is checked once rather
 * than field by field. The enum sets, `detail`, and every rule of the register are judged
 * after it (`./judge.ts`), against values this has proven are the declared types.
 */
const aggregateShapeSchema = z.object({
  detail: z.unknown(),
  entries: z.array(
    z.object({
      date: z.string(),
      done: z.boolean(),
      href: z.string().nullable(),
      id: z.string(),
      kind: z.string(),
      milestoneId: z.string().nullable(),
      position: z.number(),
      text: z.string(),
    }),
  ),
  id: z.string(),
  kind: z.string(),
  links: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      label: z.string().nullable(),
      milestoneId: z.string().nullable(),
      target: z.string(),
    }),
  ),
  milestones: z.array(
    z.object({
      after: z.array(z.string()),
      anchor: z.string(),
      id: z.string(),
      name: z.string(),
      position: z.number(),
    }),
  ),
  name: z.string(),
  outcome: z.string().nullable(),
  status: z.string().nullable(),
  workspace: z.string(),
});

/**
 * Each issue of a failed decode as one line naming where it is.
 *
 * @param where what was being decoded, to open each line
 * @returns one line per issue
 */
function issueLines({ error, where }: { error: z.ZodError; where: string }): readonly string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "" : `.${issue.path.join(".")}`;
    return `${where}${path}: ${issue.message}`;
  });
}

/**
 * Every place a proposed aggregate's runtime value is not the type it declares. Its id is unproven here, so each line
 * names "the workstream" and the path.
 *
 * @returns one problem per issue, empty when every field is its declared type
 */
export function aggregateShapeProblems({ value }: { value: unknown }): readonly string[] {
  const parsed = aggregateShapeSchema.safeParse(value);
  return parsed.success ? [] : issueLines({ error: parsed.error, where: "the workstream" });
}

/** The same shape with every closed set a `WorkstreamAggregate` declares, so a decode yields the type itself. */
const typedAggregateSchema = aggregateShapeSchema.extend({
  detail: z.record(z.string(), z.unknown()),
  entries: z.array(aggregateShapeSchema.shape.entries.element.extend({ kind: z.enum(WORKSTREAM_ENTRY_KINDS) })),
  kind: z.enum(WORKSTREAM_KINDS),
  links: z.array(aggregateShapeSchema.shape.links.element.extend({ kind: z.enum(WORKSTREAM_LINK_KINDS) })),
  status: z.enum(WORKSTREAM_STATUSES).nullable(),
  workspace: z.enum(WORKSTREAM_WORKSPACES),
});

/**
 * A person-authored aggregate decoded to its declared type, every closed set included; the register's rules beyond
 * the type (`./judge.ts`) are still the store's to judge on write.
 *
 * @param value the authored fields, the derived block already set aside
 * @returns the aggregate, or one problem per issue naming "the workstream" and the path
 */
export function decodeAggregate({ value }: { value: unknown }): Result<WorkstreamAggregate> {
  const parsed = typedAggregateSchema.safeParse(value);
  if (!parsed.success) {
    return err(issueLines({ error: parsed.error, where: "the workstream" }));
  }
  return ok(parsed.data);
}

/**
 * Decode one workstream's `detail` against its kind.
 *
 * @param owner the workstream's id, to name in each problem
 * @param kind the row's kind, which picks the schema
 * @param value the raw document
 * @returns the decoded detail, defaults filled, or one problem per issue
 */
export function decodeWorkstreamDetail({
  kind,
  owner,
  value,
}: {
  kind: WorkstreamKind;
  owner: string;
  value: unknown;
}): Result<Readonly<Record<string, unknown>>> {
  const parsed = DETAIL_BY_KIND[kind].safeParse(value);
  if (!parsed.success) {
    return err(issueLines({ error: parsed.error, where: `${owner} detail` }));
  }
  return ok(parsed.data);
}

/**
 * Decode the register-level document.
 *
 * @param value the raw document
 * @returns the decoded meta, or one problem per issue
 */
export function decodeWorkstreamMeta({ value }: { value: unknown }): Result<WorkstreamRegisterMeta> {
  const parsed = metaSchema.safeParse(value);
  if (!parsed.success) {
    return err(issueLines({ error: parsed.error, where: "register meta" }));
  }
  return ok(parsed.data);
}
