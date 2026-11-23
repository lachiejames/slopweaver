/*
 * The prompt and opener half of the replay of a written synthetic line of each shape the console voice said unasked
 * on the fixture's calls — the owner's top-priority complaint. The page's half (a grounding kept as provenance, the
 * record the thread is handed) is `site/__tests__/unit/unpromptedVoiceReplay.test.ts`; the two share one committed
 * fixture and are split so the site build never type-checks this half's import tree.
 *
 * What this proves, and what it cannot: no delivery in the voice's opener, no side-remark or voice-composed
 * alignment-question instruction, and each prompt forbidding the model behaviour in words. It cannot prove a
 * generative model obeys a prompt.
 */

import { describe, expect, it } from "vitest";

import { ASKED_ONLY_BACKEND_LINES, ASKED_ONLY_VOICE_LINES } from "../../../talk/askedOnlyLines.js";
import {
  type ContinuitySteer,
  NOTE_CHARS,
  type SteerRowEvidence,
  steersOf,
  type TalkContinuity,
} from "../../../talk/continuity.js";
import { continuityOpener, renderContinuity } from "../../../talk/continuityRender.js";
import { clip } from "../../../talk/packText.js";
import type { TurnRecord } from "../../../talk/relayStore.js";
import { TALK_BACKEND_INSTRUCTIONS, TALK_VOICE_INSTRUCTIONS } from "../../../talk/sessionConfig.js";
import { typedConversationOf } from "../../../talk/typedConversation.js";
import {
  UNPROMPTED_VOICE_LINES_18_TO_19_OCT,
  type UnpromptedVoiceLine,
  type UnpromptedVoiceSource,
} from "../../fixtures/unpromptedVoiceLines18To19Oct.js";
import { ownerNeutral } from "./ownerNeutral.js";

/** One source's records, in fixture order. */
const recordsOf = ({ source }: { source: UnpromptedVoiceSource }): readonly UnpromptedVoiceLine[] =>
  UNPROMPTED_VOICE_LINES_18_TO_19_OCT.filter((record) => record.source === source);

const OLDER_TURN = "a0000075-0000-4000-8000-000000000082";
const OLDER_AT = "2026-09-24T17:02:33.307Z";
const SINCE = "2026-09-21T17:30:00.000Z";

/** What the thread's own block says of a steer that never reached the supervisor's chat. */
const BOARD_ONLY_STATE =
  "on the board only, NOT in the supervisor's chat (cmux refused the connection); nothing acted on yet";

/** A call that spoke, opening at the window's floor, its one line the voice's — as `continuity.test.ts` builds it. */
const CALL_AT_FLOOR = {
  callId: "c0",
  end: "the owner hung up",
  lastIso: "2026-09-21T17:35:00.000Z",
  lines: [{ atIso: "2026-09-21T17:34:00.000Z", final: true, text: "bye", who: "voice" as const }],
  linesCut: 0,
  openedIso: SINCE,
  reading: undefined,
  skipped: 0,
};

/** A relay record the owner's words were registered under, whose line cmux refused: on the board, never in the chat. */
const boardOnlyRecord = ({ heard }: { heard: string }): TurnRecord => ({
  about: "",
  anchor: `talk:${OLDER_TURN}`,
  delivery: {
    atIso: OLDER_AT,
    detail: "cmux refused the connection",
    kind: "failed",
    refusal: "cmux-access-denied",
    via: "direct",
  },
  digest: "d",
  heard,
  picture: { kind: "none", reason: "screen-not-shared" },
  readsAfter: [],
  registeredAtIso: OLDER_AT,
  slug: "talk-a00000750000",
  stagedAtIso: OLDER_AT,
  state: "registered",
  turnId: OLDER_TURN,
  typed: false,
  words: "",
  wordsAlone: false,
});

/** The relay's own row, unsettled with an empty journal. */
const ROW: SteerRowEvidence = {
  anchor: `talk:${OLDER_TURN}`,
  events: [],
  settlement: undefined,
  settlementWitness: undefined,
  slug: "talk-a00000750000",
};

/** A read whose one steer is the given one. */
const continuityOf = ({ steer }: { steer: ContinuitySteer }): TalkContinuity => ({
  builtIso: "2026-09-24T17:30:00.000Z",
  calls: [CALL_AT_FLOOR],
  knowledge: [],
  rulings: [],
  sinceIso: SINCE,
  steers: [steer],
  typed: [],
  unread: [],
});

/** The relay bullet the thread's prompt carries. */
const RELAY_BULLET = [
  "- Whether a relay reached the board or the supervisor's chat is never said unless the owner asks whether a steer",
  "  landed: not in a recap, not in a 'Where you left off' read-back, and not in an answer the console started.",
].join("\n");

describe("board-only-relay", () => {
  it("gives the voice the owner's last steer's words and no delivery, while the thread's block still holds it", () => {
    const records = recordsOf({ source: "board-only-relay" });
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      const steer = steersOf({ marks: [], records: [boardOnlyRecord({ heard: record.hisWords })], rows: [ROW] })[0]!;
      const read = continuityOf({ steer });
      expect(renderContinuity({ continuity: read })).toContain(BOARD_ONLY_STATE);
      const opener = continuityOpener({
        continuity: read,
        conversation: typedConversationOf({ continuity: read, window: undefined }),
      })!;
      expect(opener).toBe(
        [
          `Where you left off: the owner's last steer to you, at ${OLDER_AT}, was "${clip({ max: NOTE_CHARS, text: record.hisWords })}".`,
          "Whether it landed is the thinking model's to say, and only when asked.",
          "When the owner asks where you were or what they last said, say this in a sentence and never ask them to re-explain it;",
          "never open a call with it unasked. For anything earlier, delegate: the thinking model holds the owner's other recent",
          "steers and turns.",
        ].join("\n"),
      );
      expect(opener).not.toContain("NOT in the supervisor's chat");
    }
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(RELAY_BULLET);
  });
});

/** The thread's rule for a voice line it neither wrote nor finds in the provenance. */
const REALTIME_OWN_WORDS_RULE = [
  "  or, when neither does, 'that was me speaking without anything behind it' — unless the provenance says",
  "  entries fell off, when it may be one of them: then 'I can't tell where that came from'. Only when asked.",
  "  A count-grounding or claim-grounding entry is never the source: where its why names what wrote the line,",
  "  the source the rules above give outranks it and is said once. Add only the fact its why holds that the line",
  "  lacked, after the source: what the app shows ('…, and the app shows Queue 26'), that no send confirmed it, or",
  "  that the owner had spoken since you first asked; never the rest of its why and never as a pre-programmed line.",
  "  Never answer 'I have no record of that' about a line on this call, and never invent a source.",
].join("\n");

describe.each(["no-record", "realtime-invention"] as const)("%s", (source) => {
  it("is named by both prompts: the thread says where such a line came from, and the voice never disowns it", () => {
    expect(recordsOf({ source }).length).toBeGreaterThan(0);
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(REALTIME_OWN_WORDS_RULE);
    expect(TALK_VOICE_INSTRUCTIONS).toContain("Never say you have no record of something you said on this call.");
  });
});

/** What each record of the two sources is: an aside on a cue, or a turn ending on a question of the voice's own. */
const SHAPE_OF: Readonly<Record<"side-remark" | "invented-question", RegExp>> = {
  "invented-question": /\?$/u,
  "side-remark": /^Side note/u,
};

describe.each(["side-remark", "invented-question"] as const)("%s", (source) => {
  it("is no longer asked of either prompt, and both carry the asked-only lines", () => {
    const records = recordsOf({ source });
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.voiceWords).toMatch(SHAPE_OF[source]);
    }
    // Both phrases once stood in the prompts and are retired.
    expect(TALK_VOICE_INSTRUCTIONS.toLowerCase()).not.toContain("side remark");
    expect(TALK_BACKEND_INSTRUCTIONS.toLowerCase()).not.toContain("side remark");
    expect(TALK_VOICE_INSTRUCTIONS).not.toMatch(ownerNeutral({ phrase: "ask them two or three alignment questions" }));
    expect(TALK_VOICE_INSTRUCTIONS).toContain(ASKED_ONLY_VOICE_LINES.join("\n"));
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(ASKED_ONLY_BACKEND_LINES.join("\n"));
  });

  // An edge case "the owner may have missed" and "a question back" were asides and questions the owner never asked for.
  it("keeps the edge case to an explanation the owner asked for, and adds no question back", () => {
    expect(TALK_VOICE_INSTRUCTIONS).not.toMatch(
      ownerNeutral({ phrase: "point out the\nedge case they may have missed" }),
    );
    expect(TALK_VOICE_INSTRUCTIONS).toContain(
      "make things simple: asked about a card, explain what it is really asking",
    );
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("Prefer a question back");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain("a yes-or-no question gets its answer and nothing more.");
  });
});

// The thinking model's alignment rule once told it to open with "Two quick ones on that first.", a figure the owner
// never asked for, which the voice then says because an answer carries it.
describe("the alignment questions' announced count", () => {
  it("opens three of the written questions, and the thinking model's rule now keeps the count unsaid", () => {
    const counted = recordsOf({ source: "invented-question" }).filter(({ voiceWords }) =>
      voiceWords.includes("Two quick ones on that first"),
    );
    expect(counted.map(({ at }) => at)).toEqual([
      "2026-10-19T09:45:30.512Z",
      "2026-10-19T09:49:02.247Z",
      "2026-10-19T09:50:13.389Z",
    ]);
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("Two quick ones on that first");
    expect(TALK_BACKEND_INSTRUCTIONS).not.toContain("saying how many are coming");
    expect(TALK_BACKEND_INSTRUCTIONS).toContain(
      "Settle how many before the first and keep to that count, but never say it, nor how\n  many are left",
    );
  });
});
