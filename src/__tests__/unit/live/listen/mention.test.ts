/**
 * The transport→turn contract: what a channel tag and a direct message become, and what is refused before
 * either becomes anything. Pure input, exact assertions, no socket.
 *
 * The DM address rule is testable HERE precisely because the parse is pure — calling it with an event settles
 * the rule, and no test in this file opens a connection to find out. The owner's ruling makes
 * that rule the SAME on both surfaces (an explicit tag); `dmRequiresMention` below is where it is locked
 * in both directions.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  parseAppMention,
  parseDirectMessage,
  parseMentionEvent,
  stripMentionTags,
} from "../../../../live/listen/mention.js";

/** A well-formed top-level `app_mention`, with per-test overrides. */
function eventOf(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    channel: "C0LISTEN",
    text: "<@U0BOT> what shipped this week?",
    ts: "1785114398.557099",
    type: "app_mention",
    user: "U0HUMAN",
    ...over,
  };
}

/** This install's own Slack USER id — the tag a direct message must carry to be address at all. */
const SELF_USER = "U0BOT";

/**
 * A well-formed human `message.im` that TAGS the bot — the only DM shape that is address under the owner's
 * ruling.
 *
 * Shaped after a real delivery measured: a `message` event carrying `channel_type: "im"`, no
 * `subtype`, and a `D…` channel — and note there is no `app_mention` here even though the text tags, which
 * is exactly why the tag has to be found in the text rather than in the event type. Overriding `text` with a
 * body carrying no tag is what the untagged half of `dmRequiresMention` does.
 */
function dmOf(over: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    channel: "D0OWNER",
    channel_type: "im",
    text: `<@${SELF_USER}> what shipped this week?`,
    ts: "1785998605.523229",
    type: "message",
    user: "U0HUMAN",
    ...over,
  };
}

describe("stripMentionTags", () => {
  it("normalises the bot tag to a stable id form and leaves the question", () => {
    expect(stripMentionTags({ text: "<@U0BOT> what shipped this week?" })).toBe("@(U0BOT) what shipped this week?");
  });

  it("normalises a tag in the middle without disturbing the surrounding words", () => {
    expect(stripMentionTags({ text: "hey <@U0BOT> can you check this" })).toBe("hey @(U0BOT) can you check this");
  });

  it("mentionIdsPreserved: a mention buried in the body survives byte-for-byte as its id", () => {
    // The regression this test guards: a message whose ENTIRE meaning is who to add — "pls add <@U0TARGET>
    // to your responder whitelist" — must not lose that id on the way to the stream. Measured: it
    // arrived as "Lol, pls add to your responder whitelist", every id gone.
    expect(stripMentionTags({ text: "Lol, pls add <@U0TARGET> to your responder whitelist" })).toBe(
      "Lol, pls add @(U0TARGET) to your responder whitelist",
    );
  });

  it("mentionIdsPreserved: drops the display hint rather than resolving it, because a name is ambiguous", () => {
    expect(stripMentionTags({ text: "loop in <@U0TARGET|ada>" })).toBe("loop in @(U0TARGET)");
  });

  it("mentionIdsPreserved: normalises a user-group tag to its id too, hint dropped", () => {
    expect(stripMentionTags({ text: "ping <!subteam^S1|@eng>" })).toBe("ping @(S1)");
  });

  it("drops a broadcast special, which names no identity to preserve", () => {
    expect(stripMentionTags({ text: "<@U0BOT|bot> <!subteam^S1|@eng> <!here> ping" })).toBe("@(U0BOT) @(S1) ping");
  });

  it("leaves a bare name untouched, because identity resolves by explicit tag only", () => {
    expect(stripMentionTags({ text: "ask ada about it" })).toBe("ask ada about it");
  });

  it("normalises a bare tag with no other words to its id alone", () => {
    expect(stripMentionTags({ text: "<@U0BOT>" })).toBe("@(U0BOT)");
  });

  it("leaves a channel reference untouched, because it is content the question needs, not addressing", () => {
    expect(stripMentionTags({ text: "<@U0BOT> post the access request into <#C0TARGET> and link the thread" })).toBe(
      "@(U0BOT) post the access request into <#C0TARGET> and link the thread",
    );
  });

  it("leaves a labelled channel reference untouched too", () => {
    expect(stripMentionTags({ text: "<@U0BOT> post it in <#C0TARGET|it-support>" })).toBe(
      "@(U0BOT) post it in <#C0TARGET|it-support>",
    );
  });

  // The incident, at the character level: the owner quoted their own earlier line back at the bot,
  // and the progress card in a public channel rendered `answering: &gt; I think we had a PR for it…`.
  it("decodes the blockquote a quoting reply opens with, rather than echoing Slack's escape", () => {
    expect(
      stripMentionTags({ text: "&gt; I think we had a PR for it <@U0BOT> sorry by that I meant something else" }),
    ).toBe("> I think we had a PR for it @(U0BOT) sorry by that I meant something else");
  });

  it("decodes all three of the entities Slack escapes, and only those three", () => {
    expect(stripMentionTags({ text: "a &lt; b &amp;&amp; c &gt; d &quot;e&quot;" })).toBe(
      "a < b && c > d &quot;e&quot;",
    );
  });

  it("undoes &amp; LAST, so an escaped entity a person typed survives as itself", () => {
    // The ordering bug this guards: `&amp;` first turns `&amp;gt;` into `&gt;` and then the `&gt;` pass turns
    // it into `>`, so someone writing about the entity gets the character instead.
    expect(stripMentionTags({ text: "slack escapes a blockquote as &amp;gt;" })).toBe(
      "slack escapes a blockquote as &gt;",
    );
  });

  it("decodes an &amp; inside a Slack link, which is the form a permalink query string arrives in", () => {
    expect(
      stripMentionTags({ text: "<@U0BOT> see <https://example.slack.com/archives/C0A/p1?thread_ts=1&amp;cid=C0A|it>" }),
    ).toBe("@(U0BOT) see <https://example.slack.com/archives/C0A/p1?thread_ts=1&cid=C0A|it>");
  });
});

describe("parseAppMention", () => {
  it("reads a top-level mention and threads the reply on the mention's own ts", () => {
    const mention = unwrap(parseAppMention({ event: eventOf(), selfBotId: "B0SELF" }));

    expect(mention).toEqual({
      channel: "C0LISTEN",
      messageTs: "1785114398.557099",
      surface: "channel",
      text: "@(U0BOT) what shipped this week?",
      threadTs: "1785114398.557099",
      userId: "U0HUMAN",
    });
  });

  it("threads the reply on thread_ts when the tag was already inside a thread", () => {
    const mention = unwrap(
      parseAppMention({ event: eventOf({ thread_ts: "1785000000.000100" }), selfBotId: "B0SELF" }),
    );

    expect(mention.threadTs).toBe("1785000000.000100");
    expect(mention.messageTs).toBe("1785114398.557099");
  });

  it("normalises a bare tag with no other words rather than emptying the body", () => {
    const mention = unwrap(parseAppMention({ event: eventOf({ text: "<@U0BOT>" }), selfBotId: "B0SELF" }));

    expect(mention.text).toBe("@(U0BOT)");
  });

  it("refuses an event that is not an app_mention, so a widened subscription cannot produce a turn", () => {
    const error = unwrapErr(parseAppMention({ event: eventOf({ type: "message" }), selfBotId: "B0SELF" }));

    expect(error.code).toBe("NOT_APP_MENTION");
    expect(error.message).toBe("not an app_mention (event type: message) — a channel answers tags only");
  });

  it("refuses an event with no type at all", () => {
    const error = unwrapErr(parseAppMention({ event: { channel: "C0LISTEN" }, selfBotId: "B0SELF" }));

    expect(error.message).toContain("event type: absent");
  });

  it("refuses OUR OWN mention, because answering it would loop on our own reply", () => {
    const error = unwrapErr(parseAppMention({ event: eventOf({ bot_id: "B0SELF" }), selfBotId: "B0SELF" }));

    expect(error.code).toBe("SELF_AUTHORED");
    if (error.code !== "SELF_AUTHORED") {
      throw new Error("unreachable — the assertion above already confirmed the code");
    }
    expect(error.reason).toBe("confirmed-match");
    expect(error.message).toBe(
      "the mention was posted by this install's own app — refused, because answering it would loop on our own reply",
    );
  });

  it("refuses an app-authored mention carrying app_id but no bot_id, defensively, because it cannot be told apart from ours", () => {
    const error = unwrapErr(parseAppMention({ event: eventOf({ app_id: "A0SELF" }), selfBotId: "B0SELF" }));

    expect(error.code).toBe("SELF_AUTHORED");
    if (error.code !== "SELF_AUTHORED") {
      throw new Error("unreachable — the assertion above already confirmed the code");
    }
    expect(error.reason).toBe("ambiguous-app-id-only");
    expect(error.message).toBe(
      "the mention carried an app_id but no bot_id, so it cannot be told apart from this install's own app — " +
        "refused defensively",
    );
  });

  it("ADMITS a DIFFERENT bot's mention — a peer bot is not an echo, and reaches the responder whitelist like anyone", () => {
    const mention = unwrap(parseAppMention({ event: eventOf({ bot_id: "B0PEER" }), selfBotId: "B0SELF" }));

    expect(mention.userId).toBe("U0HUMAN");
  });

  it("falls back to bot_id as the identity when a peer bot's event carries no user field at all", () => {
    // Measured against a real message from the official Claude-in-Slack app: it carries
    // `bot_id` and a display `username`, but no `user` field whatsoever.
    const mention = unwrap(
      parseAppMention({ event: eventOf({ bot_id: "B0SYN000011", user: undefined }), selfBotId: "B0SELF" }),
    );

    expect(mention.userId).toBe("B0SYN000011");
  });

  it("REFUSES a bot_id fallback that is not B-shaped, so a crafted event cannot smuggle a real user id through it", () => {
    // An adversarial pass found that trusting bot_id by VALUE ALONE let a crafted
    // `bot_id: "U0VICTIM"` become Mention.userId, which acknowledgementText would then render as a real
    // `<@U0VICTIM>` mention — pinging whoever actually holds that id. Slack's own bot_id is always
    // B-prefixed, so refusing anything else here costs no real capability.
    const error = unwrapErr(
      parseAppMention({ event: eventOf({ bot_id: "U0VICTIM", user: undefined }), selfBotId: "B0SELF" }),
    );

    expect(error.code).toBe("MISSING_FIELDS");
    if (error.code !== "MISSING_FIELDS") {
      throw new Error("unreachable — the assertion above already confirmed the code");
    }
    expect(error.missing).toEqual(["user or bot_id"]);
  });

  it("REFUSES a B-PREFIXED bot_id that still carries injected markup, not just anything starting with B", () => {
    // A second adversarial round found that a bare `.startsWith(\"B\")` check still let through
    // `B\` <@U0VICTIM> \`X` — genuinely B-prefixed, but the embedded backticks would break out of
    // acknowledgementText's own inline-code wrapping and inject a live mention anyway. The full shape
    // (uppercase letters and digits only) is what Slack's real bot_id always looks like, so this costs
    // nothing real either.
    const error = unwrapErr(
      parseAppMention({
        event: eventOf({ bot_id: "B` <@U0VICTIM> `X", user: undefined }),
        selfBotId: "B0SELF",
      }),
    );

    expect(error.code).toBe("MISSING_FIELDS");
  });

  it("refuses ANY bot-authored mention when our own identity is not yet known, failing closed exactly as before", () => {
    const error = unwrapErr(parseAppMention({ event: eventOf({ bot_id: "B0PEER" }), selfBotId: undefined }));

    expect(error.code).toBe("SELF_AUTHORED");
    if (error.code !== "SELF_AUTHORED") {
      throw new Error("unreachable — the assertion above already confirmed the code");
    }
    expect(error.reason).toBe("unknown-self-identity");
    expect(error.message).toBe(
      "the mention was posted by a bot, but this install's own identity is not yet known, so it cannot be " +
        "confirmed as someone else's — refused defensively",
    );
  });

  it("still admits a human when our own identity is not yet known", () => {
    const mention = unwrap(parseAppMention({ event: eventOf(), selfBotId: undefined }));

    expect(mention.userId).toBe("U0HUMAN");
  });

  it("refuses a subtyped app_mention, because Slack can dispatch one for an edit that newly introduces a tag", () => {
    const error = unwrapErr(parseAppMention({ event: eventOf({ subtype: "message_changed" }), selfBotId: "B0SELF" }));

    expect(error.code).toBe("HAS_SUBTYPE");
    expect(error.message).toBe(
      "the app_mention carried subtype `message_changed` — only a plain human message is an address",
    );
  });

  it("refuses a thread-broadcast app_mention, naming the subtype so a wrong refusal is discoverable", () => {
    const error = unwrapErr(parseAppMention({ event: eventOf({ subtype: "thread_broadcast" }), selfBotId: "B0SELF" }));

    expect(error.message).toBe(
      "the app_mention carried subtype `thread_broadcast` — only a plain human message is an address",
    );
  });

  it("names every missing field at once rather than the first", () => {
    const error = unwrapErr(parseAppMention({ event: { text: "hi", type: "app_mention" }, selfBotId: "B0SELF" }));

    expect(error.code).toBe("MISSING_FIELDS");
    expect(error.message).toBe("the app_mention was missing channel, ts, user or bot_id");
  });

  it("treats an empty-string channel as missing", () => {
    const error = unwrapErr(parseAppMention({ event: eventOf({ channel: "" }), selfBotId: "B0SELF" }));

    expect(error.message).toBe("the app_mention was missing channel");
  });

  it("treats a non-string text as empty rather than failing the whole mention", () => {
    const mention = unwrap(parseAppMention({ event: eventOf({ text: 42 }), selfBotId: "B0SELF" }));

    expect(mention.text).toBe("");
  });
});

describe("parseDirectMessage", () => {
  it("reads a direct message that tags the bot, keeping the tag's id in normalised form", () => {
    const mention = unwrap(parseDirectMessage({ event: dmOf(), selfBotId: "B0SELF", selfUserId: SELF_USER }));

    expect(mention).toEqual({
      channel: "D0OWNER",
      messageTs: "1785998605.523229",
      surface: "dm",
      text: `@(${SELF_USER}) what shipped this week?`,
      threadTs: "1785998605.523229",
      userId: "U0HUMAN",
    });
  });

  it("mentionIdsPreserved: normalises rather than drops the tag that made this a DM address", () => {
    const mention = unwrap(
      parseDirectMessage({ event: dmOf({ text: `<@${SELF_USER}> yo` }), selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(mention.text).toBe(`@(${SELF_USER}) yo`);
  });

  it("accepts a display-hint tag, because that is the same tag Slack renders differently", () => {
    const mention = unwrap(
      parseDirectMessage({
        event: dmOf({ text: `<@${SELF_USER}|bot> yo` }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(mention.text).toBe(`@(${SELF_USER}) yo`);
  });

  it("threads the reply on thread_ts when the direct message was already inside a thread", () => {
    const mention = unwrap(
      parseDirectMessage({
        event: dmOf({ thread_ts: "1785900000.000100" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(mention.threadTs).toBe("1785900000.000100");
    expect(mention.messageTs).toBe("1785998605.523229");
  });

  it("refuses OUR OWN direct message, because our own reply lands in the channel we listen to", () => {
    const error = unwrapErr(
      parseDirectMessage({ event: dmOf({ bot_id: "B0SELF" }), selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(error.code).toBe("SELF_AUTHORED");
    if (error.code !== "SELF_AUTHORED") {
      throw new Error("unreachable — the assertion above already confirmed the code");
    }
    expect(error.reason).toBe("confirmed-match");
    expect(error.message).toBe(
      "the direct message was posted by this install's own app — refused, because answering it would loop on " +
        "our own reply",
    );
  });

  it("refuses a direct message carrying app_id but no bot_id, defensively, the same as the channel path", () => {
    const error = unwrapErr(
      parseDirectMessage({ event: dmOf({ app_id: "A0SELF" }), selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(error.code).toBe("SELF_AUTHORED");
    if (error.code !== "SELF_AUTHORED") {
      throw new Error("unreachable — the assertion above already confirmed the code");
    }
    expect(error.reason).toBe("ambiguous-app-id-only");
  });

  it("ADMITS a direct message from a DIFFERENT bot — a peer's DM is not an echo", () => {
    const mention = unwrap(
      parseDirectMessage({ event: dmOf({ bot_id: "B0PEER" }), selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(mention.userId).toBe("U0HUMAN");
  });

  it("falls back to bot_id as the identity when a peer bot's DM carries no user field at all", () => {
    const mention = unwrap(
      parseDirectMessage({
        event: dmOf({ bot_id: "B0SYN000011", user: undefined }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(mention.userId).toBe("B0SYN000011");
  });

  it("REFUSES a bot_id fallback that is not B-shaped, the same as the channel path", () => {
    const error = unwrapErr(
      parseDirectMessage({
        event: dmOf({ bot_id: "U0VICTIM", user: undefined }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("MISSING_FIELDS");
  });

  it("refuses ANY bot-authored direct message when our own identity is not yet known", () => {
    const error = unwrapErr(
      parseDirectMessage({ event: dmOf({ bot_id: "B0PEER" }), selfBotId: undefined, selfUserId: SELF_USER }),
    );

    expect(error.code).toBe("SELF_AUTHORED");
  });

  it("refuses a GROUP dm, because several humans plus the bot is not a private conversation", () => {
    const error = unwrapErr(
      parseDirectMessage({
        event: dmOf({ channel: "G0GROUP", channel_type: "mpim" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("NOT_DIRECT_MESSAGE");
    expect(error.message).toBe(
      "a message in a mpim conversation is not a direct message — only a 1:1 DM counts as addressing the " +
        "bot, because a channel or group DM has other people in it",
    );
  });

  /**
   * The class that filled the old burst queue: 25 of its 63 queued rows were the bot's own `DRAFT n/3`
   * messages, composed under the owner's id in the owner's DM. They carry no tag, so the ruling
   * that an untagged DM is not address at all is what keeps them out, and there is no second filter.
   */
  it("refuses an untagged DRAFT the bot composed in the owner's own DM", () => {
    const error = unwrapErr(
      parseDirectMessage({
        event: dmOf({ text: "DRAFT 2/3: One bit I'm not sure gets picked up here is the retention window." }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("DM_NOT_ADDRESSED");
  });

  it("refuses an untagged CHANNEL message, so a subscribed message.channels cannot wake the bot", () => {
    const error = unwrapErr(
      parseDirectMessage({
        event: dmOf({ channel: "C0OPEN", channel_type: "channel" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.message).toContain("is not a direct message");
  });

  it("refuses a message with no channel_type at all rather than assuming it was a DM", () => {
    const error = unwrapErr(
      parseDirectMessage({ event: { ...dmOf(), channel_type: undefined }, selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(error.message).toContain("a message in a unstated conversation");
  });

  it("refuses an EDIT, because message_changed is not a person speaking", () => {
    const error = unwrapErr(
      parseDirectMessage({ event: dmOf({ subtype: "message_changed" }), selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(error.code).toBe("HAS_SUBTYPE");
    expect(error.message).toBe(
      "the direct message carried subtype `message_changed` — only a plain human message is an address",
    );
  });

  it("refuses a thread broadcast, and names the subtype so a wrong refusal is discoverable", () => {
    const error = unwrapErr(
      parseDirectMessage({ event: dmOf({ subtype: "thread_broadcast" }), selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(error.message).toContain("`thread_broadcast`");
  });

  it("names every missing field at once rather than the first", () => {
    const error = unwrapErr(
      parseDirectMessage({
        event: { channel_type: "im", text: `<@${SELF_USER}> hi`, type: "message" },
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("MISSING_FIELDS");
    expect(error.message).toBe("the direct message was missing channel, ts, user or bot_id");
  });

  it("refuses an app_mention, because that is the channel path's event", () => {
    const error = unwrapErr(parseDirectMessage({ event: eventOf(), selfBotId: "B0SELF", selfUserId: SELF_USER }));

    expect(error.code).toBe("NOT_MESSAGE");
    expect(error.message).toBe("not a message (event type: app_mention) — this parse reads direct messages only");
  });
});

/**
 * dmRequiresMention — the owner's ruling, in both directions.
 *
 * The regression these lock: the DM used to treat EVERY message as address, which was right while it was a
 * command channel and wrong the moment it became where DRAFT messages are composed as the owner. The bot started a
 * turn on each draft — a react, a working card, a queue entry, on the owner's own words. Refusing at the parse is
 * what makes "zero capture artifacts" true rather than merely tidied-up afterwards: an untagged DM never
 * becomes a `Mention` at all, so no downstream layer has anything to react to, card, queue, or undo.
 */
describe("dmRequiresMention", () => {
  it("REFUSES an untagged direct message, so nothing downstream ever sees it as an address", () => {
    const error = unwrapErr(
      parseDirectMessage({
        event: dmOf({ text: "DRAFT 1/6: Had a dig through the commented block." }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("DM_NOT_ADDRESSED");
    expect(error.message).toBe(
      "the direct message did not tag the bot — a DM answers an explicit tag only, exactly like a channel",
    );
  });

  it("CAPTURES a direct message that tags the bot, exactly as before the ruling", () => {
    const mention = unwrap(
      parseDirectMessage({
        event: dmOf({ text: `<@${SELF_USER}> what shipped this week?` }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(mention.surface).toBe("dm");
    expect(mention.text).toBe(`@(${SELF_USER}) what shipped this week?`);
    expect(mention.messageTs).toBe("1785998605.523229");
  });

  it("refuses a DM tagging SOMEBODY ELSE, because the tag has to name us", () => {
    const error = unwrapErr(
      parseDirectMessage({
        event: dmOf({ text: "<@U0OTHER> can you look at this" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("DM_NOT_ADDRESSED");
  });

  it("refuses a DM whose text merely NAMES the bot, because identity is exact-match tags only", () => {
    const error = unwrapErr(
      parseDirectMessage({ event: dmOf({ text: "U0BOT what shipped" }), selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(error.code).toBe("DM_NOT_ADDRESSED");
  });

  it("refuses EVERY direct message when our own user id is unknown, rather than admitting an unchecked one", () => {
    const error = unwrapErr(parseDirectMessage({ event: dmOf(), selfBotId: "B0SELF", selfUserId: undefined }));

    expect(error.code).toBe("DM_NOT_ADDRESSED");
    if (error.code !== "DM_NOT_ADDRESSED") {
      throw new Error("unreachable — the assertion above already confirmed the code");
    }
    expect(error.reason).toBe("self-identity-unknown");
  });

  it("refuses an untagged DM through the ONE door too, so the dispatch cannot admit what the arm refuses", () => {
    const error = unwrapErr(
      parseMentionEvent({
        event: dmOf({ text: "DRAFT 2/3: one bit I'm not sure about" }),
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("DM_NOT_ADDRESSED");
  });

  it("leaves the CHANNEL rule untouched — an app_mention still needs no text-level check", () => {
    const mention = unwrap(parseAppMention({ event: eventOf(), selfBotId: "B0SELF" }));

    expect(mention.surface).toBe("channel");
  });
});

describe("parseMentionEvent", () => {
  it("routes an app_mention to the channel rule", () => {
    expect(unwrap(parseMentionEvent({ event: eventOf(), selfBotId: "B0SELF", selfUserId: SELF_USER })).surface).toBe(
      "channel",
    );
  });

  it("routes a direct message to the DM rule", () => {
    expect(unwrap(parseMentionEvent({ event: dmOf(), selfBotId: "B0SELF", selfUserId: SELF_USER })).surface).toBe("dm");
  });

  it("admits a peer bot's tag through the one door too, exactly as either arm would on its own", () => {
    const mention = unwrap(
      parseMentionEvent({ event: eventOf({ bot_id: "B0PEER" }), selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(mention.userId).toBe("U0HUMAN");
  });

  it("refuses an mpim through the one door too, so widening the subscription cannot leak a group DM", () => {
    const error = unwrapErr(
      parseMentionEvent({ event: dmOf({ channel_type: "mpim" }), selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(error.message).toContain("is not a direct message");
  });

  it("refuses any other event type by name", () => {
    const error = unwrapErr(
      parseMentionEvent({
        event: { channel: "D0OWNER", type: "app_home_opened" },
        selfBotId: "B0SELF",
        selfUserId: SELF_USER,
      }),
    );

    expect(error.code).toBe("UNKNOWN_EVENT_TYPE");
    expect(error.message).toBe(
      "neither an app_mention nor a message (event type: app_home_opened) — this listener answers a channel " +
        "tag or a direct message, and nothing else",
    );
  });

  it("refuses an event with no type at all rather than guessing which rule applies", () => {
    const error = unwrapErr(
      parseMentionEvent({ event: { channel: "D0OWNER" }, selfBotId: "B0SELF", selfUserId: SELF_USER }),
    );

    expect(error.message).toContain("event type: absent");
  });
});
