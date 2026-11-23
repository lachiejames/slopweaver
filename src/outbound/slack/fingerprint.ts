/**
 * Content identity for an outbound card — two different hashes, deliberately not one.
 *
 * `artifactFingerprint` hashes the ARTIFACT (what we meant to say). It goes into `metadata`, so PR5.2
 * can recognise a card it wrote and re-render it for an edit. It must therefore NOT include the
 * rendered payload, because the payload contains the metadata that contains the hash — that circle
 * is unresolvable, and getting it wrong is the kind of thing that only shows up as a mysterious
 * mismatch months later.
 *
 * `duplicateKey` hashes the identity + target + ARTIFACT. That is what the duplicate gate compares,
 * because posting the same words to a different channel is not a duplicate.
 *
 * It says ARTIFACT deliberately, and this comment used to claim "rendered payload", which the code never
 * did. The consequence is worth knowing rather than papering over: a change confined to the RENDERER or
 * to the profile chrome produces the same key, so re-posting an unchanged artifact through a changed
 * renderer reads as a duplicate. For the card that is arguably right (the same thing is being said) and
 * it is at worst an over-warning the operator can override. The drip's per-message keys took the other
 * choice — see {@link dripMessageIdentities} — because there the key decides whether to SKIP a message,
 * and skipping is silent.
 *
 * Both are stable across runs: keys are sorted, nothing reads a clock, and `undefined` fields are
 * dropped rather than serialised inconsistently.
 */
import { createHash } from "node:crypto";

import { isRecord } from "../../lib/parsers.js";
import type { OutboundArtifact, SlackBotArtifact } from "../artifact/types.js";
import type { AnswerFormAnswer } from "../assistant/answerForm.js";
import type { PollArtifact } from "./pollForm.js";
import type { SlackDripMessagePayload } from "./types.js";

/** Canonical JSON: object keys sorted at every depth, so key order can never change a hash. */
function canonicalise({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalise({ value: entry }));
  }
  if (!isRecord(value)) {
    return value;
  }
  const source = value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).toSorted()) {
    if (source[key] !== undefined) {
      out[key] = canonicalise({ value: source[key] });
    }
  }
  return out;
}

/** A sha256 over canonical JSON, truncated to 32 hex chars — collision-proof enough for a dedupe key. */
function digest({ value }: { value: unknown }): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalise({ value })))
    .digest("hex")
    .slice(0, 32);
}

/**
 * The stable identity of an ARTIFACT's content, recorded in `metadata` for PR5.2.
 *
 * @param artifact the validated artifact, of any kind
 * @returns a 32-char hex digest, identical for identical content
 */
export function artifactFingerprint({ artifact }: { artifact: OutboundArtifact }): string {
  return digest({ value: artifact });
}

/**
 * The stable identity of a parsed `answer` FORM's content — the answer reply's own equivalent of
 * {@link artifactFingerprint}, over the form rather than an `UpdateArtifact`. Computed from content alone,
 * independent of rendered chrome, so a colour or wrapper change never moves this identity.
 *
 * @param answer the parsed answer form
 * @returns a 32-char hex digest, identical for identical content
 */
export function answerFormFingerprint({ answer }: { answer: AnswerFormAnswer }): string {
  return digest({ value: answer });
}

/**
 * The duplicate-detection key: the same words to a different channel are not a duplicate, and the
 * same words under a different identity are not either.
 *
 * ## An `idempotencyKey` REPLACES the content, and that is the whole point of it
 *
 * A content hash answers "have these exact words gone out". That is the right question for a card an
 * operator is retyping, and the wrong one for a scheduled firing: a recipe re-reads its channel before it
 * composes, so a re-run of ONE firing produces a card whose words have moved on and whose content hash is
 * therefore different. Keyed on content, a second delivery of one firing is not a duplicate at all.
 *
 * So a caller that knows the DELIVERY's own identity — `live/automation/slotLedger.ts#slotDeliveryKey` for a
 * recipe firing — hands it here, and the artifact drops out of the digest entirely. This is what a Stripe
 * webhook handler does with an event id: the consumer stores the id, and a redelivery carrying it is
 * refused whatever the body says. Identity and target stay in the digest, because one firing delivered to
 * two channels is two deliveries.
 *
 * @param actor whose name the message goes out under
 * @param channel the destination channel id
 * @param threadTs the parent timestamp when replying in a thread
 * @param artifact the validated bot artifact, of either form
 * @param idempotencyKey the delivery's own identity, when the caller has one; it replaces the artifact
 * @returns a 32-char hex digest
 */
export function duplicateKey({
  actor,
  channel,
  threadTs,
  artifact,
  idempotencyKey,
}: {
  actor: string;
  channel: string;
  threadTs?: string | undefined;
  artifact: SlackBotArtifact;
  idempotencyKey?: string | undefined;
}): string {
  if (idempotencyKey === undefined) {
    return digest({ value: { actor, artifact, channel, threadTs } });
  }
  return keyedDuplicateKey({ actor, channel, idempotencyKey, threadTs });
}

/**
 * The duplicate key of a send that carried its delivery's own identity — the one branch of {@link duplicateKey}
 * that needs no artifact, so a caller holding only the delivery key can find the send's ledger row afterwards.
 *
 * @param actor whose name the message went out under
 * @param channel the destination channel id
 * @param idempotencyKey the delivery's own identity
 * @param threadTs the parent timestamp when it was a thread reply
 * @returns the same 32-char hex digest the send reserved under
 */
export function keyedDuplicateKey({
  actor,
  channel,
  idempotencyKey,
  threadTs,
}: {
  actor: string;
  channel: string;
  idempotencyKey: string;
  threadTs?: string | undefined;
}): string {
  return digest({ value: { actor, channel, idempotencyKey, threadTs } });
}

/**
 * A POLL's identity: the target plus the whole form.
 *
 * One digest serves as BOTH the duplicate key and the store's `pollId`, because for a poll those are the same
 * question — "this exact poll, to this exact place". Deriving them separately would let a re-run reserve
 * against one identity and look up its record under another.
 *
 * `kind: "poll"` is folded in so a poll can never collide with a card whose fields happened to hash alike, and
 * so the digest is stable if a future artifact grows the same field names.
 *
 * @param actor whose name the poll goes out under (always the bot today)
 * @param channel the destination channel id
 * @param artifact the validated poll
 * @returns a 32-char hex digest, identical for an identical poll to an identical target
 */
export function pollIdentity({
  actor,
  channel,
  artifact,
}: {
  actor: string;
  channel: string;
  artifact: PollArtifact;
}): string {
  return digest({ value: { actor, artifact, channel, kind: "poll" } });
}

/**
 * WHERE a drip lands, as far as identity is concerned: the target plus the conversation shape.
 *
 * The shape belongs in the key because the same sentences posted as three top-level messages and as a
 * parent plus two replies are two different things a reader sees, so re-running with the other shape must
 * not be mistaken for a re-send of the first.
 */
export interface DripTarget {
  readonly actor: string;
  readonly channel: string;
  readonly shape: string;
  /** The parent the caller ASKED for, never one discovered mid-send — see {@link dripMessageKeys}. */
  readonly threadTs?: string | undefined;
}

/**
 * ONE drip message as far as identity is concerned: the words on the wire, and the files under them.
 *
 * The two travel together rather than as parallel arrays for the reason {@link dripMessageIdentities}
 * returns pairs: a caller that could zip them apart would attach message 2's attachments to message 3's
 * key, which is the exact class of bug the per-message keys exist to prevent.
 */
export interface DripMessageContent {
  readonly payload: SlackDripMessagePayload;
  /** The media paths riding on this message, in the caller's order. Empty for a message carrying none. */
  readonly media: readonly string[];
}

/**
 * The whole sequence's identity — the ONE key the door gate compares.
 *
 * The door approves "send this thread", not each line, so it needs a single key. The per-message keys
 * below are the layer underneath it: the door decides whether the send may happen at all, and the
 * reservations decide which individual lines still need to go out.
 *
 * @param target where the drip lands, and under whose name
 * @param messages the rendered messages and their media, in order
 * @returns a 32-char hex digest over the target and the whole ordered sequence
 */
export function dripSequenceKey({
  target,
  messages,
}: {
  target: DripTarget;
  messages: readonly DripMessageContent[];
}): string {
  return digest({ value: { messages, target } });
}

/**
 * The per-message duplicate keys, in order — what makes a resumed drip safe.
 *
 * Four properties, each of which was a decision:
 *
 *  - **Keyed on the RENDERED payload**, matching {@link duplicateKey}. Hashing the artifact instead would
 *    make two messages identical when they mention different people who happen to share an identity key.
 *  - **The MEDIA paths are part of the key**, which is where this diverges from {@link duplicateKey}. On
 *    the card lane media is outside the key and the cost is an over-warning the operator can override.
 *    Here the key decides whether to SKIP, so leaving media out means that re-running the same words with
 *    screenshots added — the single likeliest correction after posting evidence-free — recognises the
 *    message as already sent and silently drops the very files that were the point of the re-run.
 *  - **NOT keyed on the sequence, and NOT on the message's index.** Both were tempting and both are wrong:
 *    hashing the whole sequence into each key means editing the last message re-sends the first four, and
 *    hashing the index means PREPENDING a message shifts every index and re-sends everything. Keying each
 *    message on its own content is what makes "a line was added and the run repeated" send exactly the new line.
 *  - **`occurrence` disambiguates genuine repeats.** Two byte-identical messages in one drip are a real
 *    thing a person does ("yep", "yep"), and without a discriminator they would collapse to one key and
 *    the second would be skipped as its own duplicate.
 *
 * The target's `threadTs` is the one the CALLER passed, never the parent ts discovered by sending the
 * first message. A runtime-discovered parent differs on every run, so folding it in would change every
 * reply's key each time and defeat the resume entirely.
 *
 * Returns the payload PAIRED with its key rather than a bare key list, so a caller physically cannot zip
 * the two apart — a mis-zip would attach message 2's key to message 3 and produce exactly the
 * skip-the-wrong-line bug this whole mechanism exists to prevent.
 *
 * @param target where the drip lands, and under whose name
 * @param messages the rendered messages and their media, in order
 * @returns each message with its media and its 32-char hex duplicate key, in order
 */
export function dripMessageIdentities({
  target,
  messages,
}: {
  target: DripTarget;
  messages: readonly DripMessageContent[];
}): readonly (DripMessageContent & { readonly duplicateKey: string })[] {
  const seen = new Map<string, number>();
  return messages.map(({ payload, media }) => {
    const content = digest({ value: { media, payload } });
    const occurrence = seen.get(content) ?? 0;
    seen.set(content, occurrence + 1);
    return { duplicateKey: digest({ value: { content, occurrence, target } }), media, payload };
  });
}
