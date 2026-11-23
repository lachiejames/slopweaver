/**
 * The escape-hatch rows for what an outbound MESSAGE says and how it is shaped — the voice rules, a draft
 * that must earn its place, a redundant quote, a digest ahead of its top-up, a public drip, an unproven
 * render, a truncated send and a bare reference.
 *
 * One category of `./registry.ts`'s register; `ESCAPE_HATCHES` spreads it in at its position. Add a row for a
 * new message-shape refusal HERE.
 */

import type { EscapeHatch } from "./types.js";

/** Every hatch on an outbound message's content and shape, in register order. */
export const OUTBOUND_MESSAGE_HATCHES = [
  {
    caught:
      "the composed text breaks a rule in the owner's private voice profile — their own words about how they write",
    command: "slopweaver slack post",
    exceptions: [
      "you are quoting someone else's words verbatim inside the message",
      "the text is a code block or a command the rule is matching as prose",
    ],
    id: "voice-rules",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/voice/exactRules.ts",
    standing: "ruled",
  },
  {
    caught:
      "this visible session holds no receipt for the owner's CURRENT voice brief, so the words it is about to park or " +
      "send in their name were drafted without it — a draft written without the voice rules is a top-severity defect",
    command: "slopweaver slack draft record|revise, post|reply|edit|correct --as me",
    exceptions: [
      "the owner supplied the exact final words and this session is only carrying them, not drafting",
      "the brief was printed into this same session but the receipt could not be written, and the send cannot wait",
    ],
    id: "voice-briefing",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/voice/briefingAdmission.ts",
    standing: "ruled",
  },
  {
    caught:
      "the draft as the owner carries more than the shape they trim every draft to (past 3 paragraphs, 100 words, one figure or one question, or a freeform close or an attachment announced in words) — the owner removes the excess by hand otherwise",
    command: "slopweaver slack draft record",
    exceptions: [
      "the words are the owner's own, dictated for this draft, and they kept what the gate counts",
      "the person asked for exactly these numbers and the reply is the answer, so each figure is the substance rather than a receipt",
      "two people each own a different open question in a thread the owner wants chased in one message",
    ],
    id: "earns-its-place",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/slack/draftEarnsItsPlace.ts",
    standing: "proposed",
  },
  {
    caught:
      "the reply opens by quoting back everything the message it answers said, so the quote picks out nothing — the owner's rule is to quote a line only when they said more than one thing, and otherwise to open on the answer",
    command: "slopweaver gmail draft --reply-to",
    exceptions: [
      "the quote is load-bearing context for somebody on the cc who never saw the original message",
      "the original is a figure, a quoted clause or an error string the answer argues with word for word",
    ],
    id: "redundant-quote",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/cli/commands/gmail/composeDeps.ts",
    standing: "proposed",
  },
  {
    caught:
      "a top-up generation is still opening this batch, so the roster the post would describe is about to " +
      "change — measured: the digest posted three of ten at once and the seven that " +
      "followed landed over the next two hours",
    command: "slopweaver vulnerability-fix digest --post",
    exceptions: [
      "the owner asked for the post NOW and is content that it describes the set as it stands",
      "the in-flight row is stale — its session died without settling it, so nothing is actually being opened",
    ],
    id: "digest-before-topup",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/cli/commands/vulnerabilityFix/deps.ts",
    standing: "proposed",
  },
  {
    caught:
      "a top-level post into a public channel is a drip, and a discussion piece is one message with the rest folded",
    command: "slopweaver slack post --channel <public channel> --form <drip>",
    exceptions: [
      "the second message is a genuinely separate topic rather than a continuation",
      "the owner asked for the parts to land as separate top-level messages",
    ],
    id: "public-drip",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/slack/publicCardGate.ts",
    standing: "ruled",
  },
  {
    caught:
      "the card's rendered shape has not been proven against a real render, so what the reader sees may not be what you composed",
    command: "slopweaver slack post",
    exceptions: [
      "the message is plain text with no blocks, where there is nothing for a render to get wrong",
      "the render check itself is unavailable and the send cannot wait",
    ],
    id: "unproven-render",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/slack/renderProof.ts",
    standing: "ruled",
  },
  {
    caught: "the outbound form had to drop blocks from its tail to fit, so the reader would see a truncated message",
    command: "sending an outbound form",
    exceptions: [
      "the dropped tail is a repeated footer rather than content",
      "the message links the full version and the truncation is deliberate progressive disclosure",
    ],
    id: "truncated-send",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/artifact/truncatedSendHatch.ts",
    standing: "ruled",
  },
  {
    caught:
      "the message names a number, PR or ticket without linking it, and a bare reference is one the reader cannot click",
    command: "sending an outbound message carrying a reference",
    exceptions: [
      "the number is a measurement rather than an identifier",
      "the reference is inside a quoted block the linkifier must not rewrite",
    ],
    id: "bare-refs",
    key: { kind: "grant" },
    lane: "journalled",
    reader: "src/outbound/linkify/bareRefsHatch.ts",
    standing: "ruled",
  },
] as const satisfies readonly EscapeHatch[];
