/**
 * One recurring job's DEFINITION — the row that lives outside the repository — plus the parse that decides
 * whether it may run at all.
 *
 * A definition holds params only plus one briefing-only open kind, so everything here SELECTS and CONFIGURES a
 * kind from `./kinds.js` and never describes behaviour. A missed slot resumes by an explicit field defaulted
 * from the destination, which is {@link resolveOnMissed}.
 *
 * ## Why the file is not in the repository, mechanically rather than by preference
 *
 * A definition names its real destination. A real Slack destination carries a workspace id, and a real raw
 * workspace id is an identifier `hygiene/scan.ts` refuses in any TRACKED file wherever `IDENTIFIER_VERDICT`
 * reads `refuse` — so a committed definition is one the gate then refuses before anything leaves the machine,
 * and state belongs outside the repository whatever the switch reads. The store is
 * `$SLOPWEAVER_HOME/live/recipe/definitions` (`stateHome.ts`), beside the run state that has always lived
 * there. A row carrying a `destination.channel` trips `raw-workspace-id`; the same row without one is clean.
 *
 * This comment deliberately does not SPELL such a row, and the reason is the best evidence the rule is real:
 * the first draft of this file pasted a synthetic channel id into the example above, and `yarn lint` caught
 * it on THIS line. Reproduce it in one command rather than trusting the paragraph — put any `[CUAW]`
 * followed by eight or more capitals and digits, with at least one digit among them, into a tracked file and
 * run `slopweaver dev lint --only hygiene`: it names that line, and fails on it wherever the switch reads
 * `refuse`.
 *
 * ## The effect declaration is a check, not a label
 *
 * A recipe says up front whether it reads or writes, because certain recipes do both and some should only
 * read. {@link parseRecipeDefinition} enforces that against the kind registry: a row
 * may declare the same as, or less than, its kind is capable of, and a row claiming MORE is refused with
 * `EFFECT_EXCEEDS_KIND` rather than quietly narrowed. Refusing rather than narrowing matters — a definition
 * that thinks it may write and silently cannot would fail at the moment it mattered, unattended, on a clock.
 */
import { z } from "zod";

import { isSafeSlug } from "../../handover/runStore.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { FailureFindingState } from "./failureHold.js";
import { findRecipeKind, type RecipeEffect, recipeEffectExceedsKind } from "./kinds.js";

/**
 * Where a row's result lands, which is what {@link resolveOnMissed} reads to decide what a missed firing
 * means: a channel gets ONE card rather than three, and data that is simply absent is backfilled. `local-page` is a
 * page published under `$SLOPWEAVER_HOME/pages/` for the owner to read, with a Queue card when it is worth their judgement.
 */
export type RecipeDestination =
  | { readonly kind: "slack" }
  | { readonly kind: "datadog-push" }
  | { readonly kind: "local-atlas" }
  | { readonly kind: "local-page" };

/** The schema version new code writes. A reader accepts only this one — nothing older has ever existed. */
export const RECIPE_DEFINITION_SCHEMA_VERSION = 1;

/** What a recipe does when it comes back to find one or more of its slots went by unrun. */
export type RecipeOnMissed = "skip" | "backfill";

/**
 * Where the owner's own word on a row can be READ again — an ANCHOR, never an authentication. One of two places.
 *
 * - **The owner's answer to a Queue row** (`runSlug`): the question was recorded with `handover register` or
 *   `handover ask`, the owner answered it on the console's Queue page, and that run's journal carries the
 *   `answered` event. This is where a session ASKS for the owner's approval: a question belongs in the Queue,
 *   never in a DM, so a hold is never lifted by asking in the DM.
 * - **A message the owner sent in their bot DM** (`dmChannel` + `ts`): their word, volunteered there. A session
 *   never asks for it there; `../../outbound/slack/ownerDmAsk.ts` refuses the question.
 *
 * `cross-session-messages.md` § "Anchoring an authority" is exact about what either is worth: attributable,
 * never proof, because this system can write a Slack post under the owner's identity and `handover answer`
 * authenticates no human. What an anchor buys is narrower and is the whole point — the word is READABLE
 * (`slopweaver slack read-thread <permalink>`, or the run's journal via `handover resume <slug>`), so a wrong
 * one is visible and a missing one refuses. That is the same bar `journalled-grants.md` sets for a grant
 * row: ORIGIN, not authority.
 */
type OwnerApprovalAnchor =
  | {
      /** The DM conversation the approval was read in — the owner's private bot DM. */
      readonly dmChannel: string;
      /** The Slack `ts` of the approving message, which with `dmChannel` resolves to one readable message. */
      readonly ts: string;
    }
  | {
      /** The board row whose journal carries the owner's `answered` event. */
      readonly runSlug: string;
    };

/** The anchored word that lifted a hold, and when it was recorded. */
type RecipeHoldRelease = OwnerApprovalAnchor & {
  /** When the hold was lifted. */
  readonly atIso: string;
};

/**
 * The owner's own approval, recorded against ONE conversation this row's card may be posted into.
 *
 * A scheduled row posts to the owner's bot DM, and the owner shares into a public-facing channel when they
 * choose. So a scheduled row's card lands in the owner's DM, and a channel destination exists only where the
 * owner named that channel and somebody wrote down where their word can be read again.
 *
 * It is {@link RecipeHoldRelease}'s shape plus the channel it names, deliberately rather than by
 * coincidence: the property both buy is ORIGIN, not authority. Either {@link OwnerApprovalAnchor} arm resolves
 * to one readable word, so a wrong approval is visible and a missing one refuses. `cross-session-messages.md`
 * § "Anchoring an authority" is why that is the most either can claim. A session that wants a channel asks on
 * the Queue, never in the owner's DM.
 *
 * ## It is a STANDING permission, which is why it is not a journalled grant
 *
 * `.claude/rules/journalled-grants.md` is exact that one row is one change and that a standing grant has a
 * much larger blast radius that nobody asked for. A channel approval is standing by its nature — a
 * daily row posts every day — so recording it there would either burn on the first post or quietly invent
 * the shape that file says does not exist. It lives on the definition, beside {@link RecipeHold}, where the
 * row it governs is.
 */
export type RecipeChannelApproval = OwnerApprovalAnchor & {
  /** The conversation this approval admits — the one channel the owner was happy to have this row post in. */
  readonly channel: string;
  /** When the approval was recorded. */
  readonly atIso: string;
};

/**
 * A standing refusal to schedule this row that OUTRANKS {@link RecipeDefinition.enabled}.
 *
 * A digest held until the owner approves new versions in their private bot DM is the case: `enabled: false`
 * does not express that — it is one boolean any session can write back, and the row resumes that night with
 * nothing recorded. A hold is what makes a re-enable insufficient on its own: while
 * {@link RecipeHold.clearedBy} is `null` the row is not due whatever `enabled` says, and the only thing that
 * clears it is the owner's own word a reader can go and read — their answer to a Queue row, or a message they
 * sent in their DM ({@link OwnerApprovalAnchor}). A session asks for it on the Queue, never in the DM.
 *
 * A hold has NO escape hatch and the refusal says so (`.claude/rules/error-handling.md` § "A `hold` has no
 * hatch, and says so") — silence there reads as a forgotten hatch rather than an absent
 * one.
 */
export interface RecipeHold {
  /** Why this row is held, in the words a reader needs to decide whether it still applies. */
  readonly reason: string;
  /** When the hold was placed. */
  readonly askedIso: string;
  /** The approval that lifted it, or `null` while it stands. */
  readonly clearedBy: RecipeHoldRelease | null;
  /**
   * The board finding whose FIX lifts this hold, present only on a hold the store placed because a firing
   * failed (`./failureHoldStore.ts`: a row that fails once is paused until its fix lands).
   * Absent on an owner hold, which only `clearedBy` lifts.
   */
  readonly finding?: string | undefined;
  /**
   * What the finding's row says NOW, read off the board by `loadRecipeDefinitions` when asked for the lifted
   * view. Derived, never stored: the schema does not declare it, so a file carrying one parses without it and
   * cannot lift itself. Absent in the stored view, where a finding hold stands.
   */
  readonly findingState?: FailureFindingState | undefined;
  /**
   * The owner's words naming THIS automation, and the anchor they are read at — on an owner hold only. Optional so every
   * stored definition still parses; an owner hold without it reads UNOWNED in the audited view
   * (`./ownerHoldPlacedBy.ts`), and still stands.
   */
  readonly placedBy?: RecipeHoldPlacedBy | undefined;
}

/**
 * Who placed an owner hold: an owner-words anchor (`talk:`, `call:`, `talk-call:`, `transcript:`) and the owner's
 * exact words there that name this automation. A chair keypress or a seat's inference has no such anchor, which is the point.
 */
export interface RecipeHoldPlacedBy {
  readonly anchor: string;
  readonly words: string;
}

/** One recurring job, as its file on disk describes it. */
export interface RecipeDefinition {
  readonly schemaVersion: typeof RECIPE_DEFINITION_SCHEMA_VERSION;
  readonly recipeId: string;
  /** The kind in `./kinds.js` this row selects. Never a procedure — only a name. */
  readonly kind: string;
  /** What this row declares itself to do. Checked against the kind's capability at parse time. */
  readonly effect: RecipeEffect;
  /** A five-field cron expression naming when this job is due, in the installation's local time. */
  readonly cadence: string;
  readonly destination: RecipeDestination;
  /** Resolved at parse time from the row's own field, or from the destination when it declared none. */
  readonly onMissed: RecipeOnMissed;
  /** The kind's own configuration. Opaque here; the kind validates its own shape. */
  readonly params: Readonly<Record<string, unknown>>;
  /** A row may be parked without being deleted, which is how a recipe is paused rather than lost. */
  readonly enabled: boolean;
  /**
   * A standing refusal that outranks {@link RecipeDefinition.enabled}, or `undefined` when nothing holds
   * this row. Absent on every row that has never been held, so no existing definition's verdict moves.
   */
  readonly hold?: RecipeHold | undefined;
  /**
   * Every conversation OTHER than the owner's DM this row's card may be posted into, each carrying the message
   * in the owner's DM that admitted it. Absent on every row the owner has approved no channel for, which is all
   * of them until the owner names one — so the absent case is the DM-only case, by construction rather than by default.
   */
  readonly channelApprovals?: readonly RecipeChannelApproval[] | undefined;
  /**
   * The names the owner uses for this automation beyond its recipeId, which always counts — literal, unambiguous names
   * ("vulnerability-fix"), never a topic ("security"). An owner hold's words must contain one (`./ownerHoldPlacedBy.ts`).
   */
  readonly names?: readonly string[] | undefined;
}

/** The row names a kind nothing in this build registers. */
export interface UnknownKindError {
  readonly code: "UNKNOWN_KIND";
  readonly message: string;
  readonly recipeId: string;
  readonly kind: string;
}

/** The row claims a broader effect than its kind can perform. */
export interface EffectExceedsKindError {
  readonly code: "EFFECT_EXCEEDS_KIND";
  readonly message: string;
  readonly recipeId: string;
  readonly declared: RecipeEffect;
  readonly capability: RecipeEffect;
}

/** The file is not a recipe definition at all — bad JSON, a missing field, a value of the wrong type. */
export interface MalformedDefinitionError {
  readonly code: "MALFORMED_DEFINITION";
  readonly message: string;
  readonly issues: readonly string[];
}

/** Every way one definition file can fail to become a runnable recipe. */
export type RecipeDefinitionError = UnknownKindError | EffectExceedsKindError | MalformedDefinitionError;

export const RecipeDefinitionErrors = {
  effectExceedsKind: ({
    recipeId,
    declared,
    capability,
    kind,
  }: {
    readonly recipeId: string;
    readonly declared: RecipeEffect;
    readonly capability: RecipeEffect;
    readonly kind: string;
  }): EffectExceedsKindError => ({
    capability,
    code: "EFFECT_EXCEEDS_KIND",
    declared,
    message:
      `recipe '${recipeId}' declares effect '${declared}' but kind '${kind}' is only capable of ` +
      `'${capability}' — declare the same or less, never more`,
    recipeId,
  }),
  malformed: ({ issues }: { readonly issues: readonly string[] }): MalformedDefinitionError => ({
    code: "MALFORMED_DEFINITION",
    issues,
    message: `not a recipe definition: ${issues.join("; ")}`,
  }),
  unknownKind: ({ recipeId, kind }: { readonly recipeId: string; readonly kind: string }): UnknownKindError => ({
    code: "UNKNOWN_KIND",
    kind,
    message:
      `recipe '${recipeId}' names kind '${kind}', which this build does not register — a newer build may, so ` +
      "run `slopweaver automation due` from a checkout current with origin/main before treating the row as broken",
    recipeId,
  }),
} as const;

const destinationSchema = z.union([
  z.looseObject({ kind: z.literal("slack") }),
  z.looseObject({ kind: z.literal("datadog-push") }),
  z.looseObject({ kind: z.literal("local-atlas") }),
  z.looseObject({ kind: z.literal("local-page") }),
]);

/**
 * One identifying field of an {@link OwnerApprovalAnchor} — a run slug, a DM channel, a message `ts`. It must
 * carry a character outside Unicode `White_Space`: a blank one names nothing a reader could go and check. The
 * property is spelled out rather than left to `.trim()`, which follows JavaScript's narrower set and so admits a
 * field of U+0085 alone.
 */
const anchorFieldSchema = z.string().regex(/[^\p{White_Space}]/u, { error: "must carry a non-whitespace character" });

/**
 * The hold, parsed strictly.
 *
 * `clearedBy` is REQUIRED and nullable rather than optional, so "nobody has cleared this" is a value a row
 * states rather than a field it omits — an omitted release and a forgotten one are indistinguishable, and
 * the indistinguishable one is exactly what a rail like this must never guess at. Every field of a release
 * is required for the same reason: a release missing its `ts` names no message, so it anchors nothing, and
 * refusing the whole definition parks the row rather than letting a half-written release lift the hold.
 * Each {@link OwnerApprovalAnchor} arm is a STRICT object, so a release naming both a message and a run —
 * two anchors, which one is the owner's word? — is refused rather than read as whichever arm parsed first.
 */
const holdSchema = z.object({
  askedIso: z.string().min(1),
  clearedBy: z
    .union([
      z.strictObject({ atIso: z.iso.datetime(), dmChannel: anchorFieldSchema, ts: anchorFieldSchema }),
      z.strictObject({ atIso: z.iso.datetime(), runSlug: anchorFieldSchema }),
    ])
    .nullable(),
  finding: anchorFieldSchema.refine((slug) => isSafeSlug({ slug }), { error: "must be a board row slug" }).optional(),
  // The anchor's scheme is NOT checked here: a malformed one leaves the row held and reads `unresolved`, rather than
  // refusing the file and parking the row.
  placedBy: z.strictObject({ anchor: anchorFieldSchema, words: anchorFieldSchema }).optional(),
  reason: z.string().min(1),
});

/**
 * One schema issue as the lines a reader fixes, each prefixed with the field it is about.
 *
 * An {@link OwnerApprovalAnchor} is a union, and a union's own issue is only "Invalid input" at the anchor —
 * which would tell a reader a release is wrong without saying it lacks its `ts`. So an `invalid_union` reports
 * the arm that came CLOSEST (fewest issues of its own), whose lines name the missing field.
 *
 * @param issue one issue off the failed parse
 * @returns the issue's lines, `(root)` standing in for an empty path
 */
function issueLines({ issue }: { issue: z.core.$ZodIssue }): readonly string[] {
  if (issue.code === "invalid_union" && issue.errors.length > 0) {
    const closest = issue.errors.reduce((best, arm) => (arm.length < best.length ? arm : best));
    return closest.flatMap((inner) => issueLines({ issue: { ...inner, path: [...issue.path, ...inner.path] } }));
  }
  const at = issue.path.join(".");
  return [`${at.length > 0 ? at : "(root)"}: ${issue.message}`];
}

/**
 * One channel approval, parsed strictly.
 *
 * Every field is REQUIRED for the reason {@link holdSchema}'s release fields are: an approval missing its
 * `ts` names no message, so it anchors nothing, and refusing the whole definition parks the row rather than
 * letting a half-written approval open a channel.
 */
const channelApprovalSchema = z.union([
  z.strictObject({
    atIso: z.iso.datetime(),
    channel: z.string().min(1),
    dmChannel: anchorFieldSchema,
    ts: anchorFieldSchema,
  }),
  z.strictObject({ atIso: z.iso.datetime(), channel: z.string().min(1), runSlug: anchorFieldSchema }),
]);

/** A character no shell-quoted command can carry to a verb unchanged: Unicode general category Cc, Cf, Zl, Zp or Cs. */
const UNNAMEABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;

const definitionSchema = z.object({
  cadence: z.string().min(1),
  channelApprovals: z.array(channelApprovalSchema).optional(),
  destination: destinationSchema,
  effect: z.enum(["read", "write", "read-write"]),
  enabled: z.boolean().default(true),
  hold: holdSchema.optional(),
  kind: z.string().min(1),
  names: z.array(anchorFieldSchema).optional(),
  onMissed: z.enum(["skip", "backfill"]).optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  // A recipe's failure is taken and explained by commands that name its id, so the id is one a shell-quoted command
  // names exactly. A leading `-` reads as a flag (`--help` turns `automation repair` into its usage); a NUL
  // cannot be a process argument; a control, format or separator character prints as something it is not; and a lone
  // surrogate has no UTF-8 encoding, so it reaches the verb as U+FFFD. Spaces and prose are fine, since
  // quoting carries them. Every recipe on the owner's home is a plain slug, measured:
  // `grep -rhoE '"recipeId": *"[^"]*"' $SLOPWEAVER_HOME/live/recipe/definitions`.
  recipeId: z
    .string()
    .min(1)
    .refine((id) => !id.startsWith("-"), {
      message: "a recipeId must not start with '-', which every verb reads as a flag",
    })
    .refine((id) => !UNNAMEABLE.test(id), {
      message:
        "a recipeId must not carry a control, format, separator or lone surrogate character, which no command can name",
    }),
  schemaVersion: z.literal(RECIPE_DEFINITION_SCHEMA_VERSION),
});

/**
 * What a recipe does about missed slots when its row did not say.
 *
 * The default is the owner's own reasoning turned into a rule: three alert summaries posted in a row is
 * noise a reader did not want, while a three-day hole in a chart is data that is simply gone. So a Slack
 * destination skips and anything that pushes backfills. It is a DEFAULT rather than a derivation on purpose
 * — the first recipe that pushes a summary into Slack would get the wrong answer from the destination alone,
 * and its row can say so.
 *
 * @param destination where this recipe's run lands
 * @returns the policy to use when the row declared none
 */
export function resolveOnMissed({ destination }: { readonly destination: RecipeDestination }): RecipeOnMissed {
  return destination.kind === "slack" ? "skip" : "backfill";
}

/**
 * The missed-slot policy one parsed row runs under. `onMissed` is optional in the file on purpose — most rows
 * never say — and a row that left it out takes {@link resolveOnMissed}'s destination default.
 */
function rowOnMissed({
  row,
}: {
  row: { readonly onMissed?: RecipeOnMissed | undefined; readonly destination: RecipeDestination };
}): RecipeOnMissed {
  const { onMissed } = row;
  if (onMissed == null) {
    return resolveOnMissed({ destination: row.destination });
  }
  return onMissed;
}

/**
 * Parse one definition file's already-decoded JSON into a runnable recipe, refusing anything that names an
 * unregistered kind or claims more than that kind can do.
 *
 * @param value the parsed JSON of one definition file
 * @returns the definition, or the one reason it may not run
 */
export function parseRecipeDefinition({
  value,
}: {
  readonly value: unknown;
}): Result<RecipeDefinition, RecipeDefinitionError> {
  const parsed = definitionSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.flatMap((issue) => issueLines({ issue }));
    return err(RecipeDefinitionErrors.malformed({ issues }));
  }

  const row = parsed.data;
  const kind = findRecipeKind({ kind: row.kind });
  if (kind === undefined) {
    return err(RecipeDefinitionErrors.unknownKind({ kind: row.kind, recipeId: row.recipeId }));
  }
  if (recipeEffectExceedsKind({ capability: kind.capability, declared: row.effect })) {
    return err(
      RecipeDefinitionErrors.effectExceedsKind({
        capability: kind.capability,
        declared: row.effect,
        kind: kind.kind,
        recipeId: row.recipeId,
      }),
    );
  }

  return ok({
    cadence: row.cadence,
    channelApprovals: row.channelApprovals,
    destination: row.destination,
    effect: row.effect,
    enabled: row.enabled,
    hold: row.hold,
    kind: row.kind,
    names: row.names,
    onMissed: rowOnMissed({ row }),
    params: row.params,
    recipeId: row.recipeId,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  });
}
