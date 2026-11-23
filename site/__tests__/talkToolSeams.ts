/*
 * The plain fake seams a `runTalkTool` test hands the page's tools: the relay answers as given and every other tool
 * throws when reached, so a test reaching a tool it never meant to fails. A seam, never a mock.
 */
import type { ToolSeams } from "../components/voice/talkToolRunTypes";
import { FRESH_WALK } from "../lib/cardWalk";
import { ACME_PLACER } from "./organisationFixture";

/** The plan call's token for a tool call, which every run is handed as its stable request id. */
export const TOKEN = "f3a9c2.0";

/**
 * Seams whose relay answers as given, and whose other tools are never reached.
 *
 * @param relayed the relay's outcome
 * @returns the seams
 */
export function seams({ relayed }: { relayed: { answer: unknown; detail: string; refused: boolean } }): ToolSeams {
  const unreached = (): never => {
    throw new Error("not this tool");
  };
  return {
    actionItems: unreached,
    // No card open, so no move: `record` is never reached, and a test that reaches it fails.
    cardWalk: {
      openKeyNow: () => undefined,
      read: () => FRESH_WALK,
      record: unreached,
      stamp: () => "0:call-a",
      write: () => undefined,
    },
    cards: unreached,
    draftEdit: {
      call: unreached,
      open: unreached,
      post: unreached,
      refresh: unreached,
      rows: unreached,
      segments: unreached,
    },
    fileImage: unreached,
    gateLog: unreached,
    focus: { apply: unreached, canWatch: unreached, heard: unreached, nowMs: unreached, read: unreached },
    meetingSkip: { heard: unreached, nowMs: unreached, read: unreached, write: unreached },
    offerCopy: unreached,
    openCardsOn: unreached,
    actLookup: unreached,
    placer: ACME_PLACER,
    presentConsole: unreached,
    readBriefing: unreached,
    // A call with no deadline in reach: every wait answers as it comes back, and no move is checked.
    readQueueRecord: async () => ({ undrawnWhy: unreached, within: ({ ask }) => ask() }),
    relay: () => relayed,
    screenFocus: unreached,
    screenShot: unreached,
    servedCards: { read: unreached, write: unreached },
    stageSetting: unreached,
    triage: {
      frontOf: () => ({ seen: false }),
      keepLength: unreached,
      lengthOf: unreached,
      mintId: unreached,
      nowMs: unreached,
      read: () => undefined,
      startClock: unreached,
      stopClock: unreached,
      turnStarted: unreached,
      write: unreached,
    },
    undrawnWhy: unreached,
    verb: unreached,
    view: unreached,
  };
}
