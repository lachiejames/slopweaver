/**
 * The WIRE shape of a recorded Slack action: the Zod schema a verb and the store both check it against,
 * and the forgiving read a decoder uses on a line already on disk.
 *
 * ## Two directions, deliberately asymmetric
 *
 * {@link askActionSchema} runs at the WRITE, where refusing is cheap and a malformed action must never
 * reach a journal. {@link askActionFrom} runs at the READ, where the line already exists and throwing
 * would take a whole run's journal down with one hand-edit — so it answers one of three states, and a
 * card draws the third as a visible mark. Same asymmetry `./questionLineDecode.ts` documents for the ask
 * SHAPE, for the same reason.
 *
 * **A malformed action is never silently dropped.** `./askShape.ts`'s `askOptionsFrom` may drop a broken
 * option because the options that remain are still a decision; dropping a DESTINATION changes who would
 * be written to, so the read reports `invalid` and the card emits no runnable command for it.
 *
 * **The decode is written out by hand rather than taken off `z.infer`**, exactly as
 * `./questionLineDecode.ts` builds its event: under `exactOptionalPropertyTypes` an OMITTED `url` and one
 * holding `undefined` are different values, `JSON.stringify` drops the second, and `./rowEvent.ts`
 * compares its own append to what the file parses back — so a manufactured `undefined` fails a write that
 * was correct.
 *
 * Pure: no filesystem, no clock.
 */

import { z } from "zod";

import type { AskAction, AskDestination, AskMention, MailAskAction, SlackAskAction } from "./askAction.js";
import { askActionProblems, MAIL_ACTION_VERSION } from "./askAction.js";

/** A non-empty string field, matching `./rowEventSchema.ts`'s own `words`. */
const words = z.string().trim().min(1);

/** One person, by the id the body spells and the name a reader recognises. */
const mention = z.object({ label: words, userId: words }).strict();

/** One place the drafted message could go — the three arms of `./askAction.ts`'s `AskDestination`. */
const destination = z.discriminatedUnion("kind", [
  z
    .object({ channel: words, kind: z.literal("channel"), label: words, tradeoff: words, url: words.optional() })
    .strict(),
  z
    .object({
      channel: words,
      kind: z.literal("thread"),
      label: words,
      permalink: words.optional(),
      threadTs: words,
      tradeoff: words,
    })
    .strict(),
  z
    .object({
      conversation: words,
      kind: z.literal("dm"),
      label: words,
      recipients: z.array(mention).readonly(),
      tradeoff: words,
    })
    .strict(),
]);

/**
 * The recorded action, structurally — `.strict()` throughout, because a field this build does not know is
 * a claim about the message nothing here would render, and silence about it is how a preview stops
 * matching the post.
 */
const actionObject = z
  .object({
    actor: z.literal("me"),
    body: z.string().min(1),
    destinations: z.array(destination).readonly(),
    followUps: z.array(z.string().min(1)).readonly().optional(),
    mentions: z.array(mention).readonly(),
    version: z.literal(1),
  })
  .strict();

/** A recipient list — every entry a non-empty string; `gmail draft`'s own validation judges the address. */
const mailRecipients = z.array(words).readonly();

/** The recorded MAIL action, structurally — `./askAction.ts`'s `MailAskAction`. */
const mailObject = z
  .object({
    actor: z.literal("me"),
    form: z
      .object({
        bcc: mailRecipients,
        body: z.string().min(1),
        cc: mailRecipients,
        subject: z.string(),
        to: mailRecipients,
      })
      .strict(),
    from: words,
    kind: z.literal("mail"),
    replyTo: z.object({ messageId: words }).strict().optional(),
    version: z.literal(MAIL_ACTION_VERSION),
  })
  .strict();

/** Either recorded action, told apart by `version`. */
const anyActionObject = z.discriminatedUnion("version", [actionObject, mailObject]);

/** What {@link actionObject} yields — structurally sound, not yet judged against the caps. */
type WireAction = z.infer<typeof actionObject>;

/** What {@link mailObject} yields. */
type WireMail = z.infer<typeof mailObject>;

/** One destination as the typed union spells it, with an absent optional OMITTED rather than `undefined`. */
function decodeDestination({ wire }: { wire: WireAction["destinations"][number] }): AskDestination {
  if (wire.kind === "dm") {
    const recipients: readonly AskMention[] = wire.recipients.map((one) => ({ label: one.label, userId: one.userId }));
    return {
      conversation: wire.conversation,
      kind: "dm",
      label: wire.label,
      recipients,
      tradeoff: wire.tradeoff,
    };
  }
  if (wire.kind === "thread") {
    return {
      channel: wire.channel,
      kind: "thread",
      label: wire.label,
      ...(wire.permalink === undefined ? {} : { permalink: wire.permalink }),
      threadTs: wire.threadTs,
      tradeoff: wire.tradeoff,
    };
  }
  return {
    channel: wire.channel,
    kind: "channel",
    label: wire.label,
    tradeoff: wire.tradeoff,
    ...(wire.url === undefined ? {} : { url: wire.url }),
  };
}

/** The mail wire object as the typed action, copied field by field so no key the schema lacks survives. */
function decodeMail({ wire }: { wire: WireMail }): MailAskAction {
  return {
    actor: "me",
    form: {
      bcc: [...wire.form.bcc],
      body: wire.form.body,
      cc: [...wire.form.cc],
      subject: wire.form.subject,
      to: [...wire.form.to],
    },
    from: wire.from,
    kind: "mail",
    ...(wire.replyTo === undefined ? {} : { replyTo: { messageId: wire.replyTo.messageId } }),
    version: MAIL_ACTION_VERSION,
  };
}

/** Either wire object as the typed action the rest of the tree passes around. */
function decodeAny({ wire }: { wire: WireAction | WireMail }): AskAction {
  if (wire.version === MAIL_ACTION_VERSION) {
    return decodeMail({ wire });
  }
  return decodeAction({ wire });
}

/** The Slack wire object as the typed action. */
function decodeAction({ wire }: { wire: WireAction }): SlackAskAction {
  return {
    actor: "me",
    body: wire.body,
    destinations: wire.destinations.map((one) => decodeDestination({ wire: one })),
    ...(wire.followUps === undefined ? {} : { followUps: [...wire.followUps] }),
    mentions: wire.mentions.map((one) => ({ label: one.label, userId: one.userId })),
    version: 1,
  };
}

/**
 * The recorded action, structure AND rules.
 *
 * The cap and coherence rules are `./askAction.ts`'s, reached through {@link askActionProblems} rather
 * than restated, so the verb's refusal and the store's refusal cannot drift apart — the same three-layer
 * arrangement `./rowEventSchema.ts` uses for the ask shape.
 */
export const askActionSchema: z.ZodType = anyActionObject.refine(
  (wire) => askActionProblems({ action: decodeAny({ wire }) }).length === 0,
  { message: "the recorded action breaks its own rules — the verb prints exactly which" },
);

/** What a journal line's `action` field turned out to be. */
export type AskActionRead =
  | { readonly kind: "none" }
  | { readonly kind: "action"; readonly action: AskAction }
  /** On disk and unreadable — a hand-edit, or a newer build's shape. Drawn as a mark, never as absence. */
  | { readonly kind: "invalid"; readonly why: string };

/**
 * Read an `action` field off a decoded journal line, without ever throwing.
 *
 * @param value the field exactly as the line carried it, absent when the line has none
 * @returns which of the three states it is in
 */
export function askActionFrom({ value }: { value: unknown }): AskActionRead {
  if (value === undefined || value === null) {
    return { kind: "none" };
  }
  const parsed = anyActionObject.safeParse(value);
  if (!parsed.success) {
    const [first] = parsed.error.issues;
    if (first === undefined) {
      return { kind: "invalid", why: "the recorded action did not parse" };
    }
    return { kind: "invalid", why: `${first.path.join(".")}: ${first.message}`.replace(/^: /u, "") };
  }
  const action = decodeAny({ wire: parsed.data });
  const problems = askActionProblems({ action });
  const [broke] = problems;
  if (broke !== undefined) {
    return { kind: "invalid", why: broke };
  }
  return { action, kind: "action" };
}
