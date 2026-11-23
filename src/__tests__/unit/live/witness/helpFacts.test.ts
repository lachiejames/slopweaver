/**
 * A help's facts come from the SAME gates a tag crosses: the own watch in the snapshot, the responder
 * whitelist and its open override, both ignore registries, and the ask lifecycle — for this message and for
 * any other live ask in its thread.
 */
import { describe, expect, it } from "vitest";

import { foldIgnoredAsks } from "../../../../live/ask/ignore.js";
import { foldIgnoredConversations } from "../../../../live/ask/ignoredConversation.js";
import type { AskLifecycleEvent, CapturedEvent } from "../../../../live/ask/lifecycle.js";
import type { ResponderWhitelist } from "../../../../live/listen/whitelist.js";
import { emptyWitnessState, observeWitnessMessage, type WitnessState } from "../../../../live/listen/witnessState.js";
import type { WitnessHelpRequest } from "../../../../live/witness/help.js";
import { helpFactsFrom } from "../../../../live/witness/helpFacts.js";

const ROOT = "1790662224.935389";
const NOW_ISO = "2026-09-30T00:39:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const REQUEST: WitnessHelpRequest = {
  key: { channel: "C0OPS", messageTs: "1790728680.000100", threadTs: ROOT },
  text: "anything I can do to assist?",
  userId: "U0SYNTEAMMATE",
};
const LISTED: ResponderWhitelist = { identities: ["U0SYNTEAMMATE"], kind: "list" };

/** The snapshot after a person tagged this bot in the root. */
function ownThread(): WitnessState {
  return observeWitnessMessage({
    handOff: false,
    nowMs: NOW_MS,
    observation: { activatesFor: undefined, channel: "C0OPS", messageTs: ROOT, tagsSelf: true, threadTs: ROOT },
    state: emptyWitnessState(),
  }).state;
}

/** A captured ask in the thread. */
function captured({ messageTs }: { messageTs: string }): CapturedEvent {
  return {
    channel: "C0OPS",
    kind: "captured",
    messageTs,
    surface: "channel",
    threadTs: ROOT,
    tsIso: "2026-09-30T00:38:00.000Z",
    userId: "U0SYNTEAMMATE",
  };
}

/** Facts over an otherwise-clean home. */
function facts({
  lifecycleEvents = [],
  openOverride = false,
  whitelist = LISTED,
  witnessState = ownThread(),
}: {
  lifecycleEvents?: readonly AskLifecycleEvent[];
  openOverride?: boolean;
  whitelist?: ResponderWhitelist;
  witnessState?: WitnessState;
}): ReturnType<typeof helpFactsFrom> {
  return helpFactsFrom({
    ignoredAsks: new Map(),
    ignoredConversations: new Map(),
    lifecycleEvents,
    nowIso: NOW_ISO,
    openOverride,
    request: REQUEST,
    whitelist,
    witnessState,
  });
}

describe("helpFactsFrom", () => {
  it("reads a clean own thread with a listed asker as all clear", () => {
    expect(facts({})).toEqual({
      alreadyAnAsk: false,
      ignored: undefined,
      ownThread: true,
      responder: { admitted: true },
      threadActiveAsk: undefined,
    });
  });

  it("is not the bot's own thread when the snapshot holds no own watch there", () => {
    expect(facts({ witnessState: emptyWitnessState() }).ownThread).toBe(false);
  });

  it("refuses an asker off the whitelist, unless the open override is set", () => {
    const unlisted: ResponderWhitelist = { identities: ["U0SYNSOMEONE"], kind: "list" };

    expect(facts({ whitelist: unlisted }).responder.admitted).toBe(false);
    expect(facts({ openOverride: true, whitelist: unlisted }).responder).toEqual({ admitted: true });
  });

  it("names the registry that ignores the message", () => {
    const conversation = helpFactsFrom({
      ignoredAsks: new Map(),
      ignoredConversations: foldIgnoredConversations({
        entries: [{ channel: "C0OPS", ignoredAtIso: NOW_ISO, kind: "ignore", reason: "noisy", schemaVersion: 1 }],
      }),
      lifecycleEvents: [],
      nowIso: NOW_ISO,
      openOverride: false,
      request: REQUEST,
      whitelist: LISTED,
      witnessState: ownThread(),
    });
    const ask = helpFactsFrom({
      ignoredAsks: foldIgnoredAsks({
        entries: [
          {
            channel: "C0OPS",
            ignoredAtIso: NOW_ISO,
            messageTs: REQUEST.key.messageTs,
            reason: "answered elsewhere",
            schemaVersion: 1,
          },
        ],
      }),
      ignoredConversations: new Map(),
      lifecycleEvents: [],
      nowIso: NOW_ISO,
      openOverride: false,
      request: REQUEST,
      whitelist: LISTED,
      witnessState: ownThread(),
    });

    expect(conversation.ignored).toBe("conversation");
    expect(ask.ignored).toBe("ask");
  });

  it("knows the message is already an ask once the lifecycle holds it", () => {
    expect(facts({ lifecycleEvents: [captured({ messageTs: REQUEST.key.messageTs })] }).alreadyAnAsk).toBe(true);
  });

  it("names another live ask in the same thread", () => {
    const other = facts({ lifecycleEvents: [captured({ messageTs: "1790728600.000100" })] });

    expect(other.threadActiveAsk).toBe("1790728600.000100");
    expect(other.alreadyAnAsk).toBe(false);
  });
});
