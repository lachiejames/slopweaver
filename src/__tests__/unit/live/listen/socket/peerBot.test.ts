/** A peer bot's tag is admitted through the ordinary whitelist, while this install's own tag never is. */
import { describe, expect, it } from "vitest";

import { createDedupeState } from "../../../../../live/listen/dedupe.js";
import { consumeMentions } from "../../../../../live/listen/socket.js";
import type { ResponderWhitelist } from "../../../../../live/listen/whitelist.js";
import { mentionFrame, SELF_USER } from "./fixtures.js";
import { fakeConnection, noRefusal, recordingHandler, recordingLog, recordingRefusal } from "./harness.js";

describe("consumeMentions — a peer bot's tag, the correction", () => {
  const ADMITS_U0PEER: ResponderWhitelist = { identities: ["U0PEER"], kind: "list" };
  const ADMITS_U0HUMAN_ONLY: ResponderWhitelist = { identities: ["U0HUMAN"], kind: "list" };
  /** Measured against a real message from the official Claude-in-Slack app: bot_id + username, no user field. */
  const ADMITS_CLAUDE_BY_BOT_ID: ResponderWhitelist = { identities: ["B0SYN000011"], kind: "list" };

  it("admits a peer bot's tag keyed on bot_id when the event carries no user field at all", async () => {
    const fake = fakeConnection({
      texts: [
        mentionFrame({
          envelopeId: "e-claude",
          event: { bot_id: "B0SYN000011", user: undefined },
          eventId: "EvClaude",
        }),
      ],
    });
    const recorder = recordingHandler();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_CLAUDE_BY_BOT_ID,
      selfUserId: SELF_USER,
      selfBotId: "B0SELF",
      seen: createDedupeState(),
    });

    expect(result.outcome.handled).toBe(1);
    expect(recorder.seen[0]?.userId).toBe("B0SYN000011");
  });

  it("ignores a bot_id fallback shaped like a real user id, end to end, rather than admitting it", async () => {
    // The exact crafted shape an adversarial pass found: bot_id "U0VICTIM" is not B-shaped, so
    // it must never become an admitted identity even with an open whitelist for that exact string.
    const fake = fakeConnection({
      texts: [
        mentionFrame({ envelopeId: "e-craft", event: { bot_id: "U0VICTIM", user: undefined }, eventId: "EvCraft" }),
      ],
    });
    const recorder = recordingHandler();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => true,
      responderWhitelist: () => ({ identities: ["U0VICTIM"], kind: "list" }),
      selfUserId: SELF_USER,
      selfBotId: "B0SELF",
      seen: createDedupeState(),
    });

    expect(result.outcome.handled).toBe(0);
    expect(result.outcome.ignored).toBe(1);
    expect(recorder.seen).toEqual([]);
  });

  it("admits a DIFFERENT bot's tag exactly like a human's, once that bot's user id is whitelisted", async () => {
    const fake = fakeConnection({
      texts: [mentionFrame({ envelopeId: "e-peer", event: { bot_id: "B0PEER", user: "U0PEER" }, eventId: "EvPeer" })],
    });
    const recorder = recordingHandler();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0PEER,
      selfUserId: SELF_USER,
      selfBotId: "B0SELF",
      seen: createDedupeState(),
    });

    expect(result.outcome.handled).toBe(1);
    expect(recorder.seen[0]?.userId).toBe("U0PEER");
  });

  it("still refuses an UNLISTED peer bot through the ordinary whitelist, not the old blanket bot refusal", async () => {
    const fake = fakeConnection({
      texts: [mentionFrame({ envelopeId: "e-peer", event: { bot_id: "B0PEER", user: "U0PEER" }, eventId: "EvPeer" })],
    });
    const refusal = recordingRefusal();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recordingHandler().handler,
      log: recordingLog().log,
      refuseResponder: refusal.refuseResponder,
      responderHatchOpen: () => false,
      responderWhitelist: () => ADMITS_U0HUMAN_ONLY,
      selfBotId: "B0SELF",
      seen: createDedupeState(),
    });

    expect(result.outcome.refused).toBe(1);
    expect(refusal.calls[0]?.mention.userId).toBe("U0PEER");
    expect(refusal.calls[0]?.why).toContain("not on the responder whitelist");
  });

  it("still refuses OUR OWN tag even with an open whitelist, so the self-loop guard survives the widening", async () => {
    const fake = fakeConnection({
      texts: [mentionFrame({ envelopeId: "e-self", event: { bot_id: "B0SELF", user: "U0SELFB" }, eventId: "EvSelf" })],
    });
    const recorder = recordingHandler();
    const logger = recordingLog();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: logger.log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => true,
      responderWhitelist: () => ADMITS_U0PEER,
      selfUserId: SELF_USER,
      selfBotId: "B0SELF",
      seen: createDedupeState(),
    });

    expect(result.outcome.handled).toBe(0);
    expect(recorder.seen).toEqual([]);
    expect(logger.lines[0]).toContain("posted by this install's own app");
  });

  it("admits an UNLISTED peer bot via the break-glass override, same as it already admits an unlisted human", async () => {
    // An adversarial pass found this exact matrix cell untested — not a new bypass the
    // widening introduced, but the SAME pre-existing override (proven above for a human against a closed
    // list) now also reachable for a non-self bot, which is the intended symmetry, not a regression.
    const fake = fakeConnection({
      texts: [mentionFrame({ envelopeId: "e-peer", event: { bot_id: "B0PEER", user: "U0PEER" }, eventId: "EvPeer" })],
    });
    const recorder = recordingHandler();

    const result = await consumeMentions({
      connection: fake.connection,
      handler: recorder.handler,
      log: recordingLog().log,
      refuseResponder: noRefusal,
      responderHatchOpen: () => true,
      responderWhitelist: () => ADMITS_U0HUMAN_ONLY,
      selfBotId: "B0SELF",
      seen: createDedupeState(),
    });

    expect(result.outcome.handled).toBe(1);
    expect(recorder.seen[0]?.userId).toBe("U0PEER");
  });
});
