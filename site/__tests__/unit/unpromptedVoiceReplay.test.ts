/*
 * A line of each shape the console voice said unasked, replayed through the shape
 * that replaced its source: the voice must not say things the owner never asked about, then be unable to say
 * where they came from. The lines are written synthetic cases (`src/__tests__/fixtures/unpromptedVoiceLines18To19Oct.ts`),
 * each source with a property that would fail on the old shape. This is the page's half; the prompts' and the opener's is
 * `src/__tests__/unit/talk/unpromptedVoicePrompts.test.ts`, split so the site build never type-checks the prompts'
 * import tree.
 *
 * What this proves, and what it cannot: no correction handed to the voice, and the thread handed what the voice said
 * and where the console's part of it came from. It cannot prove a generative model obeys a prompt: a realtime voice
 * can still make a line up. The backstop for that is the record the thread answers from.
 */

import { describe, expect, it } from "vitest";

import {
  UNPROMPTED_VOICE_LINES_18_TO_19_OCT,
  type UnpromptedVoiceLine,
  type UnpromptedVoiceSource,
} from "../../../src/__tests__/fixtures/unpromptedVoiceLines18To19Oct";
import { SPOKEN_RECORD_BACKEND_LINES } from "../../../src/talk/spokenRecordLines";
import { countClaimsOf } from "../../lib/talkCountGrounding";
import type { QueueCountSubject } from "../../lib/talkCountGroundingTypes";
import { claimGroundingEntry } from "../../lib/talkSpokenClaims";
import { VOICE_PROVENANCE_AFTER, VOICE_PROVENANCE_BEFORE, VoiceProvenanceLedger } from "../../lib/talkVoiceProvenance";
import {
  type CountGrounding,
  countGroundingEntry,
  countGroundingOf,
  SPOKEN_RECORD_AFTER,
  SPOKEN_RECORD_BEFORE,
  spokenRecordText,
} from "../../lib/talkVoiceRecord";

/** One source's records, in fixture order. */
const recordsOf = ({ source }: { source: UnpromptedVoiceSource }): readonly UnpromptedVoiceLine[] =>
  UNPROMPTED_VOICE_LINES_18_TO_19_OCT.filter((record) => record.source === source);

/** A record's own segment key, the shape a page keys a grounding and a record line by. */
const keyOf = ({ record }: { record: UnpromptedVoiceLine }): string => `${record.call}:${record.at}`;

/** The spoken record block for one voice line, written out by hand so a change to the renderer shows here. */
const spokenBlockOf = ({ record }: { record: UnpromptedVoiceLine }): string =>
  [SPOKEN_RECORD_BEFORE, `[{"text":${JSON.stringify(record.voiceWords)},"who":"voice"}]`, SPOKEN_RECORD_AFTER].join(
    "\n",
  );

describe("the fixture", () => {
  it("holds each source in the count the calls held, and only those", () => {
    const counts = Object.fromEntries(
      [
        "count-correction",
        "board-only-relay",
        "no-record",
        "side-remark",
        "invented-question",
        "count-false-positive",
        "realtime-invention",
      ].map((source) => [
        source,
        UNPROMPTED_VOICE_LINES_18_TO_19_OCT.filter((record) => record.source === source).length,
      ]),
    );
    expect(counts).toEqual({
      "board-only-relay": 10,
      "count-correction": 5,
      "count-false-positive": 3,
      "invented-question": 4,
      "no-record": 3,
      "realtime-invention": 3,
      "side-remark": 2,
    });
    expect(UNPROMPTED_VOICE_LINES_18_TO_19_OCT.length).toBe(30);
  });
});

/**
 * The grounding each synthetic call's page posts for the sentence it misread, written in the shape of a call file's
 * `count-grounding` tool line (`said "one it asks" … the app shows Everything 41, Queue 28; nothing the thinking model
 * wrote said it`), and the provenance entry it is kept as now. The page used to hand the voice a correction instead,
 * and the bare figure each record holds is that correction said aloud.
 */
const GROUNDING_BY_CALL: Readonly<
  Record<
    string,
    {
      readonly posted: {
        readonly claimed: number;
        readonly subject: QueueCountSubject;
        readonly expected: readonly { readonly label: string; readonly count: number }[];
        readonly fromThread: boolean;
      };
      readonly entry: { readonly text: string; readonly why: string };
    }
  >
> = {
  c0000001: {
    entry: {
      text: "the voice said 1 for the owner's asks",
      why: "the app shows Everything 41, Queue 28; nothing the thinking model wrote said it, so it is the realtime voice's own; nobody corrected it aloud",
    },
    posted: {
      claimed: 1,
      expected: [
        { count: 41, label: "Everything" },
        { count: 28, label: "Queue" },
      ],
      fromThread: false,
      subject: "asks",
    },
  },
  c0000002: {
    entry: {
      text: "the voice said 1 for the cards on the owner's Queue",
      why: "the app shows Everything 57; nothing the thinking model wrote said it, so it is the realtime voice's own; nobody corrected it aloud",
    },
    posted: { claimed: 1, expected: [{ count: 57, label: "Everything" }], fromThread: false, subject: "everything" },
  },
  c0000003: {
    entry: {
      text: "the voice said 10 for the cards on the owner's Queue",
      why: "the app shows Everything 62; the thinking model wrote the same number; nobody corrected it aloud",
    },
    posted: { claimed: 10, expected: [{ count: 62, label: "Everything" }], fromThread: true, subject: "everything" },
  },
};

/**
 * A posted grounding the route accepts, or a throw naming its refusal — the unwrap a test asserts through.
 *
 * @returns the grounding
 */
function accepted({ value }: { value: unknown }): CountGrounding {
  const parsed = countGroundingOf({ value });
  if ("refused" in parsed) {
    throw new Error(parsed.refused);
  }
  return parsed;
}

// That a grounding writes nothing to the realtime child is `talkPlanCall/provenance.test.ts`'s `PlanCall.recordGrounding`; this
// is what the thread is handed instead.
describe("count-correction", () => {
  it("keeps the grounding behind each bare figure as provenance beside the voice's exact words, once per post", () => {
    const records = recordsOf({ source: "count-correction" });
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      const { posted, entry } = GROUNDING_BY_CALL[record.call];
      const key = keyOf({ record });
      const grounding = accepted({ value: { ...posted, key } });
      expect(grounding).toEqual({ ...posted, key });
      expect(countGroundingEntry({ grounding })).toEqual(entry);
      const ledger = new VoiceProvenanceLedger();
      const post = { ...entry, atMs: Date.parse(record.at), key, source: "count-grounding" as const };
      // Each call's correction was handed to the voice twice; a retried post is one entry.
      expect([ledger.record(post), ledger.record(post)]).toEqual([true, false]);
      expect(
        spokenRecordText({
          lines: [{ id: key, text: record.voiceWords, who: "voice" }],
          openCard: undefined,
          provenance: ledger.pending(),
        }),
      ).toBe(
        [
          spokenBlockOf({ record }),
          VOICE_PROVENANCE_BEFORE,
          `[{"at":"${record.at}","source":"count-grounding","text":${JSON.stringify(entry.text)},"why":${JSON.stringify(entry.why)}}]`,
          VOICE_PROVENANCE_AFTER,
        ].join("\n"),
      );
    }
  });
});

describe.each(["no-record", "realtime-invention"] as const)("%s", (source) => {
  it("hands the thread the voice's exact words with no provenance, under a block naming where such a line came from", () => {
    const records = recordsOf({ source });
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      const lines = [{ id: keyOf({ record }), text: record.voiceWords, who: "voice" as const }];
      const provenance = new VoiceProvenanceLedger().pending();
      expect(provenance).toEqual({ dropped: 0, droppedIds: [], entries: [] });
      expect(spokenRecordText({ lines, openCard: undefined, provenance })).toBe(spokenBlockOf({ record }));
    }
    expect(VOICE_PROVENANCE_BEFORE).toContain(
      "A count-grounding or claim-grounding entry is something the voice said that nothing on the call supported, " +
        "and never the source: what its why says wrote the line yields to your answers and the entries above, and is " +
        "never said as a second source; what it adds is the fact the line lacked. A voice line that you did not write, " +
        "that no spoken-line entry here holds and that no " +
        "developer message here set off came from the realtime voice itself, unless this block says older entries " +
        "fell off.",
    );
  });
});

describe("count-false-positive", () => {
  it("reads no count of the owner's Queue in a sentence the page once took for one", () => {
    const records = recordsOf({ source: "count-false-positive" });
    expect(records.length).toBeGreaterThan(0);
    expect(records.map((record) => countClaimsOf({ text: record.voiceWords }))).toEqual(records.map(() => []));
  });
});

// A claim-grounding entry shows no app value, so the fact the thread adds after the source has to be
// one its why actually holds. Each why names the realtime voice as the writer, which the source rules outrank.
describe("claim-grounding, answered where-from", () => {
  const backend = SPOKEN_RECORD_BACKEND_LINES.join(" ").replace(/\s+/g, " ");

  it("adds a repeated ask's fact, that the owner had spoken since it first asked", () => {
    const { why } = claimGroundingEntry({ grounding: { kind: "repeated-ask" } });
    expect(why).toContain("the owner had spoken since it first asked");
    expect(backend).toContain("that the owner had spoken since you first asked");
  });

  it("adds a send outcome's fact, that no send confirmed it", () => {
    const { why } = claimGroundingEntry({ grounding: { act: "sent", kind: "outcome" } });
    expect(why).toContain("no send outcome confirmed it");
    expect(backend).toContain("that no send confirmed it");
  });

  it("lets the source rules outrank the writer each why names", () => {
    const whys = [
      claimGroundingEntry({ grounding: { act: "sent", kind: "outcome" } }).why,
      claimGroundingEntry({ grounding: { claimed: 123, kind: "pr-number" } }).why,
      claimGroundingEntry({ grounding: { kind: "repeated-ask" } }).why,
    ];
    expect(whys.filter((why) => why.includes("the realtime voice's own"))).toEqual(whys);
    expect(backend).toContain(
      "where its why names what wrote the line, the source the rules above give outranks it and is said once.",
    );
  });
});
