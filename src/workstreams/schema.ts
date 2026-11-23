/**
 * The nested field shapes a workstream is written in, one rule per field whichever reader holds it: the store's
 * decoders (`./store/decode.ts`, `./store/validation.ts`) read every aggregate's detail and the register document
 * through these, and the candidates file reads its `workspace` through {@link workspaceSchema}.
 *
 * The register itself lives in the store (`docs/store/workstreams.md`); every progress figure is derived from a
 * workstream's own milestones and its cited entries (`./store/derive.ts`), so no percentage is a field here.
 *
 * Pure: Zod schemas only.
 */
import { z } from "zod";

import { declaredWorkspace } from "../handover/workspace.js";

import { boardMembershipSchema } from "./boardMembership.js";

/** A calendar date the way a timeline dot is drawn: `YYYY-MM-DD`, and a day the calendar has. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date is YYYY-MM-DD")
  .refine((date) => {
    const instant = Date.parse(`${date}T00:00:00Z`);
    return !Number.isNaN(instant) && new Date(instant).toISOString().startsWith(date);
  }, "a date is a day the calendar has");

/** A link: an absolute URL, or a console path such as `/queue?row=<slug>` or `/api/page/<slug>/index.html`. */
const hrefSchema = z.string().regex(/^(https:\/\/|\/)/, "a link is https:// or a console path starting with /");

const textSchema = z.string().trim().min(1);

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "an id is kebab-case");

const feedbackSchema = z.strictObject({
  date: dateSchema,
  href: hrefSchema.nullable(),
  /** What the owner did about it — the half a negative entry is worth showing for. */
  response: textSchema.nullable(),
  sign: z.enum(["positive", "negative"]),
  text: textSchema,
  who: textSchema,
});

/**
 * Which workspace a workstream belongs to, stated on the row: the console's context switcher shows one at a time
 * (team workstreams appearing under Slopweaver is a bug). Stated rather than read
 * off the links, because a `self` workstream cites team threads and a `team` one cites console pages. The words are
 * roles, the same two `src/handover/workspace.ts` holds: `team` is the organisation's, `self` this installation's.
 */
const WORKSPACES = ["team", "self"] as const;

/**
 * A stored workspace, read as its role. The home is shared by every checkout, so a seat still on a build from before
 * the rename can write `acme|slopweaver` into a workstream row or `candidates.json` after this one is merged; the old
 * word reads as the role `declaredWorkspace` maps it to, and whatever this build writes back carries the role.
 *
 * @returns the role a string names, else the value untouched, for the enum to refuse
 */
function storedWorkspace({ value }: { value: unknown }): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const role = declaredWorkspace({ declared: value });
  if (role === undefined) {
    return value;
  }
  return role;
}

/** A row's `workspace`: one of {@link WORKSPACES}, an old spelling read as the role it became. */
export const workspaceSchema = z.preprocess((value) => storedWorkspace({ value }), z.enum(WORKSPACES));

/** The owner's priority words, most pressing first; the page ranks by this order within at-risk and the rest. */
export const PRIORITY_LEVELS = ["urgent", "high", "normal", "parked"] as const;

/**
 * Where the owner put a workstream, and the steer that put it there. `null` means no steer of theirs is on record, which the
 * page says as "not stated" rather than guessing a level.
 *
 * `rank` orders the owner's `urgent` priorities against each other, 1 first: the order their Queue, the voice and the alignment
 * ranking lead with (`src/waiting/queueOrder.ts`). An unranked priority follows every ranked one.
 */
const prioritySchema = z
  .strictObject({
    anchor: textSchema,
    because: textSchema,
    level: z.enum(PRIORITY_LEVELS),
    rank: z.number().int().positive().optional(),
  })
  .nullable();

/**
 * The board's `workstream=` tag VALUE this workstream's Queue cards carry — `iso-certification` for the
 * `iso-27001-controls` outcome. The join between the register and the cards, stated rather than read off the id or the
 * free-form `tags`, because the two were named apart. An `urgent` workstream that states one is a priority: its cards
 * lead the owner's Queue, the voice and reconcile in its `rank` (`src/waiting/queueOrder.ts`, `site/lib/queueFocus.ts`, and
 * `./queuePriorities.ts`); absent, its cards rank as any other.
 * The ISO workstream ranks first if it can, and at least in the top three.
 * Held to the board tag's own pattern (`src/handover/rowTags.ts`), stricter than an id's: a value no card can carry,
 * `iso--certification` or `iso-`, would lift nothing silently.
 */
const queueWorkstreamSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "a queueWorkstream is a board workstream tag value: lower kebab-case")
  .optional();

/**
 * Whose move it is when the workstream is held: a decision only the owner can make (`you`), or somebody named it moves
 * once we chase (`someone`). `null` when nothing holds it. The page says what is blocked on what or who, and each
 * card says whether it is blocked on the owner, needs their decision, or needs us to chase to progress it.
 */
const waitingOnSchema = z
  .discriminatedUnion("on", [
    z.strictObject({ on: z.literal("you"), what: textSchema }),
    z.strictObject({ on: z.literal("someone"), what: textSchema, who: textSchema }),
  ])
  .nullable();

/**
 * How a workstream ended without its outcome, or `null` while it has not; `abandoned` is the first kind, and a later
 * one is one more member of the union. A workstream that never
 * happened (Coder workspaces for one-click PR previews) is not done, and done is the wrong word for it. So the ending
 * is its own typed kind, with why in the owner's words and where they said it, and the page
 * DERIVES an `abandoned` lane from it (`./lanes.ts`) rather than anyone typing a status. A field beside the story
 * rather than a register kind of its own, because the timeline that shows what was tried is the point of keeping it.
 * Absent on a register written before endings existed, so it reads as `null` there.
 */
const endingSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ anchor: textSchema, kind: z.literal("abandoned"), on: dateSchema, reason: textSchema }),
  ])
  .nullable()
  .default(null);

/**
 * One person involved, by Slack member id so the console draws them as an identity chip off the member roster, and
 * the part they play in words. The slide-over shows the different people who were involved, all
 * their identity chips.
 */
const personSchema = z.strictObject({
  part: textSchema,
  slack: z.string().regex(/^[UW][A-Z0-9]{6,}$/u, "a person is their Slack member id"),
});

/**
 * Which board rows sit under a workstream's outcome, for the supervisor's coverage (`./boardMembership.ts`): copied off
 * the candidate a keep promoted, or written with the entry. `null` means the outcome names no rows, so coverage lists it
 * with none under it rather than guessing keywords from its name; absent on a register written before it existed, so it
 * reads as `null` there.
 */
const membershipField = boardMembershipSchema.nullable().default(null);

/** A linked workstream's gauge: a count against its whole and the gate it must pass, from a named source. */
const gaugeSchema = z
  .strictObject({
    asOf: dateSchema,
    gate: z.number().int().positive(),
    gateLabel: textSchema,
    of: z.number().int().positive(),
    source: textSchema,
    value: z.number().int().nonnegative(),
  })
  .refine((gauge) => gauge.value <= gauge.of && gauge.gate <= gauge.of, {
    message: "a gauge's value and gate are each at most its whole (`of`), never drawn clipped",
  });

/**
 * Every Slack conversation a link on the register points into, by id, with the words the owner knows it by —
 * `#proj-monitoring`, `your DM with Tobias`. A citation says "a message in <channel
 * name>", never an id, because the owner knows channels only by name. So the register document names each conversation once
 * and `workstreams put` refuses a Slack link into one it does not name (`./store/wholePut.ts`). Words rather than a
 * bare channel name, because a DM
 * has no name to put a `#` in front of.
 */
const channelsSchema = z.record(z.string().regex(/^[CGD][A-Z0-9]{6,}$/u), textSchema);

/**
 * The nested shapes the store's decoders (`./store/decode.ts`, `./store/validation.ts`) read every field through, so
 * a field reads by one rule wherever it is held.
 */
export {
  channelsSchema,
  dateSchema,
  endingSchema,
  feedbackSchema,
  gaugeSchema,
  hrefSchema,
  idSchema,
  membershipField,
  personSchema,
  prioritySchema,
  queueWorkstreamSchema,
  textSchema,
  waitingOnSchema,
};
