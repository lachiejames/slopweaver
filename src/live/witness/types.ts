/**
 * The witness journal's vocabulary — the coordinates one witnessed message is addressed by, the six ways a
 * witness can end, the three per-witness journal events (a worker booted, a terminal, and the one in-place
 * revision of a posted reply), and the one event about a whole thread (a stand-down tied to no message).
 *
 * A WITNESS is the check this bot makes on a claim another bot posted in a thread the bot was not asked into
 * (the listener emits it as a `{"kind":"witness",...}` line). It is never an ask: it has no asker, no card and
 * no lifecycle record, and it ends either SILENT or in one proof-bearing thread reply. The owner's ruling
 * is that the bot posts in the thread only when it is worth posting there.
 *
 * Pure: schemas, types and the id derivation only.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { parseSlackThreadPermalink } from "../slack/permalink.js";

/** The three Slack coordinates one witnessed message is addressed by — the journal's whole key. */
export interface WitnessKey {
  readonly channel: string;
  readonly threadTs: string;
  readonly messageTs: string;
}

/** Every way a witness ends, in the order a reader meets them. */
const WITNESS_OUTCOMES = ["nothing-checkable", "nothing-material", "posted", "failed", "helped", "stood-down"] as const;

/**
 * How one witness ended.
 *
 * - `nothing-checkable` — the loop judged the line carries no claim worth checking; no worker, no Slack call.
 * - `nothing-material` — a worker checked and found nothing worth posting; silence is the outcome.
 * - `posted` — a worker posted one witness form into the thread, at the recorded ts.
 * - `failed` — the worker could not finish, or its pickup line could never be sent. No verdict on the claim,
 *   so the loop may dispatch the message again.
 * - `helped` — in a thread a person tagged this bot in, the loop took the message up unprompted as if tagged:
 *   it became an ordinary captured ask (👀, the progress card, then the answer). Written by `witness help`
 *   alone, BEFORE any Slack effect, so a re-run can never card the same message twice.
 * - `stood-down` — somebody in the thread told the bot it was in the way, or to stop: the bot reacted on the
 *   message and said nothing, and from then on the WHOLE THREAD is witnessed no further — no line handed off,
 *   no help. An explicit tag there is still answered. Written by `witness stand-down` alone, AFTER its
 *   reaction, carrying the `why`. The whole-thread form writes a `thread-stood-down` event instead.
 */
export type WitnessOutcome = (typeof WITNESS_OUTCOMES)[number];

/** An outcome `witness settle` may not write: only `witness help` journals a help. */
export const HELP_OUTCOME = "helped" satisfies WitnessOutcome;

/** An outcome `witness settle` may not write: only `witness stand-down` journals one, after its reaction. */
export const STOOD_DOWN_OUTCOME = "stood-down" satisfies WitnessOutcome;

/** The outcomes `witness settle` may write — every one but the two its sibling verbs own. */
export type WitnessSettleOutcome = Exclude<WitnessOutcome, typeof HELP_OUTCOME | typeof STOOD_DOWN_OUTCOME>;

/** {@link WITNESS_OUTCOMES} narrowed to what `witness settle` accepts, in the same order. */
export const WITNESS_SETTLE_OUTCOMES: readonly WitnessSettleOutcome[] = WITNESS_OUTCOMES.filter(
  (outcome): outcome is WitnessSettleOutcome => outcome !== HELP_OUTCOME && outcome !== STOOD_DOWN_OUTCOME,
);

/**
 * Whether a string is an outcome `witness settle` may write.
 *
 * @param value the raw `--as` value
 * @returns whether it names a settleable outcome
 */
export function isWitnessSettleOutcome(value: string): value is WitnessSettleOutcome {
  return (WITNESS_SETTLE_OUTCOMES as readonly string[]).includes(value);
}

/** A real Slack ts: epoch seconds, a dot, six digits of sequence. */
export const SLACK_TS_PATTERN = /^\d+\.\d{6}$/;

const tsSchema = z.string().regex(SLACK_TS_PATTERN);
const nonBlank = z.string().min(1);

const keyFields = {
  channel: nonBlank,
  messageTs: tsSchema,
  threadTs: tsSchema,
  witnessId: nonBlank,
} as const;

/** The `dispatched` event's schema — one visible worker booted for one witness, with every ref it was given. */
const witnessDispatchedEventSchema = z.strictObject({
  ...keyFields,
  cwd: z.string().optional(),
  host: z.enum(["claude-code", "codex"]),
  kind: z.literal("dispatched"),
  model: nonBlank,
  schemaVersion: z.literal(1),
  sessionName: z.string().optional(),
  surfaceId: nonBlank,
  surfaceRef: nonBlank,
  text: z.string(),
  tsIso: z.iso.datetime(),
  workspaceId: nonBlank,
  workspaceRef: nonBlank,
});

/** The `settled` event's schema — one attempt's one terminal; only a `failed` one is followed by a fresh dispatch. */
const witnessSettledEventSchema = z.strictObject({
  ...keyFields,
  kind: z.literal("settled"),
  outcome: z.enum(WITNESS_OUTCOMES),
  postedTs: tsSchema.optional(),
  schemaVersion: z.literal(1),
  tsIso: z.iso.datetime(),
  why: z.string().optional(),
});

/**
 * The `revised` event's schema — the bot's own POSTED witness reply was later found wrong and struck in place, once.
 * Not a terminal: it annotates a `posted` one, and `because` is the permalink of the message that refuted it.
 */
const witnessRevisedEventSchema = z.strictObject({
  ...keyFields,
  because: z.string().refine((value) => parseSlackThreadPermalink({ permalink: value }).isOk(), {
    message: "because must be a Slack message permalink",
  }),
  correction: nonBlank,
  kind: z.literal("revised"),
  postedTs: tsSchema,
  schemaVersion: z.literal(1),
  tsIso: z.iso.datetime(),
  wrong: nonBlank,
});

/**
 * The `thread-stood-down` event's schema — a stand-down of a whole THREAD, tied to no message. Written by
 * `witness stand-down` with no `--message-ts`, reacting on nothing, when the message that said "stop" already
 * ended another way, is gone, or the word came from the owner off Slack. Not a witness: it carries no
 * `messageTs` and no `witnessId`, so the per-witness fold never sees it — the root cannot stand in for it, since
 * a peer-tag root is itself a witness line and may already be settled. `standDownId` is {@link threadStandDownIdOf}.
 */
const witnessThreadStoodDownEventSchema = z.strictObject({
  channel: nonBlank,
  kind: z.literal("thread-stood-down"),
  schemaVersion: z.literal(1),
  standDownId: nonBlank,
  threadTs: tsSchema,
  tsIso: z.iso.datetime(),
  why: z
    .string()
    .refine((value) => value.trim().length > 0, { message: "a thread stand-down carries a non-blank why" }),
});

/**
 * Every journal event, discriminated on `kind`. A `stood-down` row without a non-blank `why` is refused at
 * parse: it silences a whole thread, so a hand-written row that cannot say why must not read as one.
 */
export const witnessJournalEventSchema = z
  .discriminatedUnion("kind", [
    witnessDispatchedEventSchema,
    witnessSettledEventSchema,
    witnessRevisedEventSchema,
    witnessThreadStoodDownEventSchema,
  ])
  .refine(
    (event) =>
      event.kind !== "settled" ||
      event.outcome !== "stood-down" ||
      (event.why !== undefined && event.why.trim().length > 0),
    { message: "a stood-down row carries a non-blank why", path: ["why"] },
  );

/** A whole thread stood down, tied to no message. */
export type WitnessThreadStoodDownEvent = z.infer<typeof witnessThreadStoodDownEventSchema>;

/** One visible worker booted for one witness. */
export type WitnessDispatchedEvent = z.infer<typeof witnessDispatchedEventSchema>;

/** The terminal a witness ends in. */
export type WitnessSettledEvent = z.infer<typeof witnessSettledEventSchema>;

/** The one in-place correction of a posted witness reply. */
export type WitnessRevisedEvent = z.infer<typeof witnessRevisedEventSchema>;

/** One line of `$SLOPWEAVER_HOME/live/slack/witness-outcomes.jsonl`. */
export type WitnessJournalEvent = z.infer<typeof witnessJournalEventSchema>;

/** A journal event about ONE witnessed message — every kind but a whole-thread stand-down. */
export type WitnessMessageEvent = Exclude<WitnessJournalEvent, WitnessThreadStoodDownEvent>;

/** What the journal currently says about one witness — the fold of every event bearing its id. */
export interface WitnessCurrent {
  readonly witnessId: string;
  readonly key: WitnessKey;
  /** The worker booted for it, or `undefined` when none ever was (a `nothing-checkable` settled by the loop). */
  readonly dispatched: WitnessDispatchedEvent | undefined;
  /** Its terminal, or `undefined` while a worker is still live. */
  readonly settled: WitnessSettledEvent | undefined;
  /** Its one in-place correction, or `undefined` — only ever beside a `posted` terminal. */
  readonly revised: WitnessRevisedEvent | undefined;
  /** The newest event's instant — what `witness list` sorts by. */
  readonly latestIso: string;
}

/** How a `settle` names the witness it ends: by the id a worker was handed, or by the loop's coordinates. */
export type WitnessSelector =
  { readonly kind: "id"; readonly witnessId: string } | { readonly kind: "key"; readonly key: WitnessKey };

/**
 * The stable id of one witnessed message — a digest of all three coordinates, so a retry, a resume and a
 * settle all name the same witness without anything having to be looked up.
 *
 * @param key the witnessed message's coordinates
 * @returns `w-` and the first 16 hex characters of the SHA-256 of the three coordinates
 */
export function witnessIdOf({ key }: { key: WitnessKey }): string {
  const digest = createHash("sha256").update(`${key.channel}\n${key.threadTs}\n${key.messageTs}`, "utf8").digest("hex");
  return `w-${digest.slice(0, 16)}`;
}

/**
 * The stable id of one whole-thread stand-down — a digest of the two thread coordinates, prefixed apart from a
 * witness id so neither can be mistaken for the other.
 *
 * @param channel the thread's channel
 * @param threadTs the thread's root `ts`
 * @returns `t-` and the first 16 hex characters of the SHA-256 of the two coordinates
 */
export function threadStandDownIdOf({ channel, threadTs }: { channel: string; threadTs: string }): string {
  const digest = createHash("sha256").update(`thread-stood-down\n${channel}\n${threadTs}`, "utf8").digest("hex");
  return `t-${digest.slice(0, 16)}`;
}
