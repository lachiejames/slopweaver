/**
 * The FIRST of the three enforcement layers on a board row: a Zod schema per event kind, checked before
 * anything is appended to a journal.
 *
 * Schema enforcement is another tool for making a bad write impossible at the row level or the table level,
 * alongside type safety and verb-level guards, so nothing can be dumped into the register unchecked. That is
 * three layers where a `RunEvent` object literal alone would be one. This file is the layer that runs at the verb; the
 * type system is the layer that runs at compile time; a per-kind CHECK constraint is the layer that would run
 * at the column if this register ever moves onto a store, and it is the only one of the three that also
 * catches a write which did not come through {@link ./rowEvent.applyRowEvent} at all.
 *
 * ## Why a schema, when `RunEvent` is already a discriminated union
 *
 * Because the union is only checked where a literal is written. {@link ./ledger.parseLedger} decodes what is
 * ALREADY on disk and is deliberately forgiving — `text()` turns a malformed field into `""` rather than
 * losing the whole entry — so the union has never been what stops a bad event being recorded. It stops a bad
 * event being *constructed in TypeScript*, which is not the same act. Every field below that a decoder would
 * quietly coerce is required here instead, at the moment of writing, where refusing is still cheap.
 *
 * ## The drift guard is the compiler, not a convention
 *
 * {@link ROW_EVENT_SCHEMAS} is a mapped type over `RunEvent["kind"]`, so a new event kind added to the union
 * FAILS TO COMPILE until it has a schema here. That is deliberate: a validator that silently passes an
 * unknown kind is worse than none, because every caller believes the write was checked.
 *
 * Pure: no filesystem, no clock. The caller supplies the event.
 */

import { z } from "zod";

import { actionOptions } from "./askActionOptions.js";
import { askActionFrom, askActionSchema } from "./askActionWire.js";
import { askExampleProblems } from "./askExamples.js";
import { askOptionsCommandProblems } from "./askOptionCommand.js";
import {
  type AskOption,
  type AskStakes,
  askOptionsFrom,
  askShapeProblems,
  askStakesFrom,
  shapeCompleteness,
} from "./askShape.js";
import { askShotSchema } from "./askShot.js";
import type { RunEvent } from "./ledger.js";
import { PARKED_WIRE_FIELDS } from "./parkedEventWire.js";
import { plainDataProblems } from "./plainData.js";
import { base, instant, words } from "./rowEventPrimitives.js";
import { rulingEventSchema } from "./rulingEventSchema.js";
import { taggedEventProblems } from "./taggedEvent.js";

/** A non-negative, finite count. */
const tally = z.number().min(0);

/** Where a steered deliverable stands, as a session named it (`./explicitSteerTypes.ts`). */
const steerStanding = z.enum(["at-risk", "cleared"]);

/** A process id, or the honest absence of one — never `0`, which is a claim about a process. */
const pid = z.union([z.number().int().positive(), z.undefined()]);

/** A list of strings, which may legitimately be empty (a clean finish has no residue). */
const lines = z.array(z.string()).readonly();

/** The three visible hosts a run may be owned by, matching `../supervisor/session.ts`'s `SupervisorHost`. */
const host = z.enum(["claude-code", "codex", "explicit"]);

/**
 * The stakes as a journal line carries them — one object, so the three travel whole or not at all.
 *
 * `.strict()` rather than `.loose()`, unlike the events around it: a misspelt key here (`blast_radius`)
 * would otherwise pass as a present-but-partial object the reader then drops, which is a card silently
 * losing its stakes. Every key is required, so a partial object is refused at the write.
 */
const stakesSchema = z.object({ blastRadius: words, risk: words, stillReal: words }).strict();

/**
 * The fields of a recorded ask's SHAPE, as a journal line carries them.
 *
 * All optional, because older journals carry asks with no shape; {@link askShaped} is what
 * refuses a shape that is present and broken. `letter` is not accepted from the wire at all — it is
 * derived by position on the read (`./askShape.ts`'s `askOptionsFrom`), so a line cannot assert one.
 */
const ASK_SHAPE_FIELDS = {
  lean: words.optional(),
  options: z
    .array(z.object({ command: words.optional(), option: words, tradeoff: words }).loose())
    .readonly()
    .optional(),
  problem: words.optional(),
  stakes: stakesSchema.optional(),
} as const;

/**
 * Refuse a shape that is PARTIAL or over its caps, while letting a line carrying none through.
 *
 * The cap rules are `./askShape.ts`'s, reached through {@link askShapeProblems} rather than restated, so
 * the verb's refusal and the store's refusal cannot drift apart — which is the whole reason this register
 * has three enforcement layers over one rule rather than three rules.
 *
 * @param schema the event schema to attach the rules to
 * @returns the same schema, refusing a broken shape
 */
function askShaped({ schema }: { schema: z.ZodType }): z.ZodType {
  return schema
    .refine((value) => shapeReadOf({ value }).completeness !== "partial", {
      message:
        "an ask carries the whole shape or none of it — a problem, two to four options with their " +
        "trade-offs, and a lean",
    })
    .refine((value) => shapeIssuesOf({ value }).length === 0, {
      message: "the recorded shape breaks its own caps — the verb prints exactly which",
    });
}

/** The concrete examples an asking line may carry on itself — optional for the shape's reason. */
const EXAMPLE_FIELDS = {
  exampleGap: words.optional(),
  examples: z.array(z.string()).readonly().optional(),
} as const;

/**
 * Attach `./askExamples.ts`'s scene rules to an asking line that carries examples — the same function the verb
 * and `question-examples` call, so the three cannot disagree. A line carrying neither half is an older one.
 *
 * @param schema the event schema, already extended with {@link EXAMPLE_FIELDS}
 * @returns the same schema, refusing a broken set
 */
function illustratedAsk({ schema }: { schema: z.ZodType }): z.ZodType {
  return schema.superRefine((value, context) => {
    const bag: Readonly<Record<string, unknown>> = typeof value === "object" && value !== null ? { ...value } : {};
    const examples = Array.isArray(bag["examples"]) ? bag["examples"].map(String) : [];
    const gap = typeof bag["exampleGap"] === "string" ? bag["exampleGap"] : undefined;
    // Judged on the KEYS being present, not on what they hold: an explicit `examples: []` declared examples and
    // carried none, which the verb refuses too. Only a line declaring neither is a legacy ask.
    if (bag["examples"] === undefined && bag["exampleGap"] === undefined) {
      return;
    }
    for (const problem of askExampleProblems({ examples, gap })) {
      context.addIssue({ code: "custom", message: problem });
    }
  });
}

/**
 * Refuse scenes on a question-family line that never carries them. A correction, reconfirm, withdrawal, offer or
 * post changes no scene, and its decoder reads none, so a scene written there would be journalled unjudged and
 * then silently dropped. Scenes ride the asking line, or `handover example`.
 *
 * @param schema the event schema, `.loose()` so the stray keys reach this check rather than being stripped
 * @returns the same schema, refusing either example key
 */
function sceneless({ schema }: { schema: z.ZodType }): z.ZodType {
  return schema.superRefine((value, context) => {
    const bag: Readonly<Record<string, unknown>> = typeof value === "object" && value !== null ? { ...value } : {};
    if (bag["examples"] !== undefined || bag["exampleGap"] !== undefined) {
      context.addIssue({
        code: "custom",
        message: "this line carries no scenes — they ride the asking line itself, or `handover example`",
      });
    }
  });
}

/** The three shape halves off an UNVALIDATED event, and which of the three states they are in. */
function shapeReadOf({ value }: { value: unknown }): {
  readonly problem: string | undefined;
  readonly options: readonly AskOption[];
  readonly lean: string | undefined;
  readonly stakes: AskStakes | undefined;
  readonly completeness: "none" | "partial" | "whole";
} {
  const bag: Readonly<Record<string, unknown>> = typeof value === "object" && value !== null ? { ...value } : {};
  const problem = bag["problem"];
  const lean = bag["lean"];
  const read = {
    lean: typeof lean === "string" ? lean : undefined,
    options: askOptionsFrom({ value: bag["options"] }),
    problem: typeof problem === "string" ? problem : undefined,
  };
  // Stakes with no shape beside them are a partial shape: they describe a decision the line does not state.
  const stakes = askStakesFrom({ value: bag["stakes"] });
  const core = shapeCompleteness(read);
  const orphanStakes = core === "none" && bag["stakes"] !== undefined;
  return { ...read, completeness: orphanStakes ? "partial" : core, stakes };
}

/**
 * The cap defects on an event's shape, empty when it carries none at all.
 *
 * A `none` or `partial` read yields nothing here on purpose: the first is legitimate and the second is
 * already refused above, and reporting cap defects on half a shape would print two refusals for one fault.
 */
function shapeIssuesOf({ value }: { value: unknown }): readonly string[] {
  const read = shapeReadOf({ value });
  if (read.completeness !== "whole" || read.problem === undefined || read.lean === undefined) {
    return [];
  }
  // Judge the options the READER will draw: a line carrying a readable action has its options derived from it on
  // the way in (`./questionLineDecode.ts`), the stored list ignored — judging the stored list would let a derived
  // option the verb refuses (its caps, or an owner step with no command) reach the Queue through a hand-written line.
  const bag: Readonly<Record<string, unknown>> = typeof value === "object" && value !== null ? { ...value } : {};
  const action = askActionFrom({ value: bag["action"] });
  const options = action.kind === "action" ? actionOptions({ action: action.action }) : read.options;
  // A write schema, so the command rule binds here as it does at the verb (`./askOptionCommand.ts`).
  return [
    ...askShapeProblems({ shape: { lean: read.lean, options, problem: read.problem, stakes: read.stakes } }),
    ...askOptionsCommandProblems({ options }),
  ];
}

/**
 * One schema per event kind.
 *
 * `.loose()` throughout rather than `.strict()`, and the choice is not laziness: journals on disk predate
 * several of the optional fields below, a newer build may write a field this one has never heard of, and this
 * register's whole contract is that an older reader keeps working. What is enforced is that every field this
 * build DOES depend on is present and usable — refusing an extra key would make a forward-compatible write
 * fail for the one reason that costs nothing.
 */
export const ROW_EVENT_SCHEMAS: { readonly [K in RunEvent["kind"]]: z.ZodType } = {
  abandoned: base({ kind: "abandoned" }).extend({ why: words }).loose(),
  amended: base({ kind: "amended" }).extend({ docHash: words, why: words }).loose(),
  answered: base({ kind: "answered" }).extend({ answer: words }).loose(),
  artifact: base({ kind: "artifact" }).extend({ url: words }).loose(),
  claimed: base({ kind: "claimed" })
    .extend({ host, pid, sessionId: words, why: z.string(), worktree: z.union([words, z.undefined()]) })
    .loose(),
  closed: base({ kind: "closed" }).extend({ residue: lines, summary: words }).loose(),
  delivered: base({ kind: "delivered" }).extend({ count: tally }).loose(),
  dispatched: base({ kind: "dispatched" })
    .extend({ by: words, target: z.union([words, z.undefined()]) })
    .loose(),
  "drive-ended": base({ kind: "drive-ended" }).extend({ attempts: tally, why: words }).loose(),
  finished: base({ kind: "finished" }).extend({ residue: lines }).loose(),
  gated: base({ kind: "gated" })
    .extend({
      failed: tally,
      head: z.union([words, z.undefined()]),
      notEvaluated: tally,
      passed: tally,
      sessionId: z.union([words, z.undefined()]),
    })
    .loose(),
  launched: base({ kind: "launched" })
    .extend({ pid, sessionId: words, worktree: z.union([words, z.undefined()]) })
    .loose(),
  lessons: base({ kind: "lessons" }).extend({ forced: z.boolean(), lessons: words }).loose(),
  orphaned: base({ kind: "orphaned" })
    .extend({ cycleEvents: tally.optional(), deadSessionId: words, lastEventIso: instant })
    .loose(),
  // Its fields and their caps live beside its type: `./parkedEventWire.ts`.
  parked: base({ kind: "parked" }).extend(PARKED_WIRE_FIELDS).loose(),
  "park-cleared": base({ kind: "park-cleared" })
    .extend({ parkIndex: z.number().int().min(0), why: words })
    .loose(),
  "park-wake-suspended": base({ kind: "park-wake-suspended" })
    .extend({
      judgedLength: z.number().int().min(1),
      parkIndex: z.number().int().min(0),
      question: words,
      questionAskedIso: instant,
      why: words,
    })
    .loose(),
  probed: base({ kind: "probed" }).extend({ failed: tally, passed: tally }).loose(),
  "steer-risk": base({ kind: "steer-risk" }).extend({ standing: steerStanding, why: words }).loose(),
  // The shape is OPTIONAL here and REQUIRED at the verb, and the asymmetry is this file's own stated
  // contract rather than a gap: questions journalled as free text before the shape existed must keep
  // reading. What IS enforced is that a shape which is present
  // is WHOLE and within its caps — `./askShape.ts`'s own rules, reached through one schema so the verb and
  // the store cannot disagree about what a well-formed ask is.
  question: illustratedAsk({
    schema: askShaped({
      schema: base({ kind: "question" })
        .extend({ action: askActionSchema.optional(), question: words })
        .extend(ASK_SHAPE_FIELDS)
        .extend(EXAMPLE_FIELDS),
    }),
  }),
  "question-corrected": sceneless({
    schema: base({ kind: "question-corrected" }).extend({ question: words, why: words }).loose(),
  }),
  "question-reconfirmed": sceneless({
    schema: base({ kind: "question-reconfirmed" }).extend({ question: words, stillReal: words }).loose(),
  }),
  // The scene rules are `./askExamples.ts`'s, reached through one function so the verb and the store cannot
  // disagree about what a concrete example is — exactly as the shape's caps are reached above.
  "question-examples": base({ kind: "question-examples" })
    .extend({ exampleGap: words.optional(), examples: z.array(z.string()).readonly(), question: words })
    .loose()
    .superRefine((value, context) => {
      for (const problem of askExampleProblems({ examples: value.examples, gap: value.exampleGap })) {
        context.addIssue({ code: "custom", message: problem });
      }
    }),
  // The picture rules are `./askShot.ts`'s (the hand register's own `checkedShot`) — one with no box is refused here.
  "question-shot": sceneless({
    schema: base({ kind: "question-shot" }).extend({ question: words, shot: askShotSchema }).loose(),
  }),
  "question-withdrawn": sceneless({
    schema: base({ kind: "question-withdrawn" }).extend({ question: words, why: words }).loose(),
  }),
  // Every field REQUIRED, unlike on `question`: the kind is younger than the action, so there is no older
  // line to keep reading, and an offer is a WHOLE replacement of what the card draws — half of one would
  // put this ask's problem over that ask's draft. `askActionSchema` carries the caps.
  "question-offered": sceneless({
    schema: askShaped({
      schema: base({ kind: "question-offered" })
        .extend({
          action: askActionSchema,
          lean: words,
          options: z
            .array(z.object({ command: words.optional(), option: words, tradeoff: words }).loose())
            .min(1)
            .readonly(),
          problem: words,
          question: words,
          stakes: stakesSchema.optional(),
        })
        .loose(),
    }),
  }),
  // Every field REQUIRED, stakes included, for the reason `question-offered`'s are: the kind is younger than the
  // shape, and a reshape is a WHOLE replacement of what the card draws. No action — `handover offer` records one.
  "question-shaped": illustratedAsk({
    schema: askShaped({
      schema: base({ kind: "question-shaped" })
        .extend({
          lean: words,
          options: z
            .array(z.object({ command: words.optional(), option: words, tradeoff: words }).loose())
            .min(1)
            .readonly(),
          problem: words,
          question: words,
          replaces: words,
          stakes: stakesSchema,
        })
        .extend(EXAMPLE_FIELDS)
        .loose(),
    }),
  }),
  // `permalink` is optional (the workspace URL may not resolve), and when present it is a real link, never "".
  "question-posted": sceneless({
    schema: base({ kind: "question-posted" })
      .extend({ channel: words, permalink: words.optional(), question: words, ts: words })
      .loose(),
  }),
  released: base({ kind: "released" }).extend({ sessionId: words, why: z.string() }).loose(),
  resumed: base({ kind: "resumed" })
    .extend({ attempt: z.union([z.number().int().positive(), z.undefined()]), pid, sessionId: words })
    .loose(),
  // Both halves of the ruling are required, matching the decoder that refuses a line missing either.
  //
  // `decidedIso` is REQUIRED here while the decoder treats it as optional, and the asymmetry is the point: a
  // journal written before the field existed must keep decoding, and no NEW write may omit the instant
  // `./ruling.ts` orders rulings by. `backfilledFrom` is optional because only a reconstruction has one, and
  // the refinement is what stops the two disagreeing — a backfilled ruling is decided when its source was
  // answered, so a reconstruction can never outrank a decision the owner has given since.
  //
  ruling: rulingEventSchema,
  said: base({ kind: "said" }).extend({ message: words }).loose(),
  "signed-off": base({ kind: "signed-off" }).extend({ by: words, note: z.string() }).loose(),
  started: base({ kind: "started" }).extend({ branch: words, docHash: words }).loose(),
  // The registry in `./rowTags.ts` is the ONE judge of a well-formed tag, so this schema asks it rather than
  // restating its keys: the verb, the store and the fold then cannot disagree about what may be written.
  //
  // STRICT at both levels, unlike every other shape here, and the file header's forward-compatibility argument
  // does not reach it: this schema judges WRITES only, the decoder rebuilds the event as exactly these fields, so
  // an extra one would validate, append, and then fail the read-back.
  tagged: base({ kind: "tagged" })
    .extend({
      // RAW strings, not `words`: `words` trims before the refinement sees the value, while the event written is
      // the untrimmed original, so `" platform "` passed as `platform` and landed `unrecognised`. The registry judges the exact bytes the journal will hold.
      drop: z.array(z.string()).readonly(),
      set: z.array(z.strictObject({ key: z.string(), value: z.string() })).readonly(),
      why: words,
    })
    .strict()
    .superRefine((value, context) => {
      for (const problem of taggedEventProblems({ drop: value.drop, set: value.set })) {
        context.addIssue({ code: "custom", message: problem });
      }
    }),
};

/**
 * Validate one event against its own kind's schema.
 *
 * @param event the event about to be written, as an unvalidated value — a caller holding a typed `RunEvent`
 *   still passes it here, because the type says nothing about `""` or an unparseable `atIso`
 * @returns one message per rule the event broke, empty when it is well-formed
 */
export function rowEventIssues({ event }: { event: unknown }): readonly string[] {
  // A value whose own reflection throws — a Proxy trap, a revoked Proxy — is refused as one more issue rather than
  // thrown past `applyRowEvent`'s `Result`. Such a value is not plain data by definition,
  // so the refusal is the honest answer rather than a swallowed error.
  try {
    return issuesOf({ event });
  } catch (error) {
    return [uninspectable({ error })];
  }
}

/**
 * The issue for an event whose inspection threw. Describing the thrown value can throw too — a null-prototype
 * object has no `toString`, a hostile `Error` subclass can trap `message` — so that is
 * caught as well, and the issue then says the throw could not be described rather than escaping.
 */
function uninspectable({ error }: { error: unknown }): string {
  const lead = "the event could not be inspected as plain data";
  try {
    // `unknown`, not `string`: a hostile `message` getter can answer anything, so it is described like any throw.
    const reason: unknown = error instanceof Error ? error.message : error;
    return `${lead}: ${String(reason)}`;
  } catch {
    return `${lead}, and what it threw could not be described either`;
  }
}

/** {@link rowEventIssues} over a value that reads without throwing. */
function issuesOf({ event }: { event: unknown }): readonly string[] {
  if (typeof event !== "object" || event === null || !("kind" in event) || typeof event.kind !== "string") {
    return ["the event declares no `kind`, so there is no schema to check it against"];
  }
  const known: Readonly<Record<string, z.ZodType | undefined>> = ROW_EVENT_SCHEMAS;
  const schema = known[event.kind];
  if (schema === undefined) {
    return [`"${event.kind}" is not an event kind this register knows how to write`];
  }
  // Plain data first: the schema reads only the fields it names, so a value serialisation would drop is
  // invisible to it and to the read-back alike (`./plainData.ts`).
  const unplain = plainDataProblems({ path: event.kind, value: event });
  if (unplain.length > 0) {
    return unplain;
  }
  const parsed = schema.safeParse(event);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => `${issue.path.join(".") || event.kind}: ${issue.message}`);
}
