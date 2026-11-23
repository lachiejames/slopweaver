import { describe, expect, it } from "vitest";

import { readAlignmentAnswers, readVoiceProfile, readVoiceRules } from "../../components/live/readAlignment";
import { readAutonomy } from "../../components/live/readAutonomy";
import { alignmentStage, consoleCardPath, partitionAlignmentRows } from "../../lib/alignment";
import { REPEAT_FLOOR, rulingCandidates, type SteeredAct } from "../../lib/alignmentRules";
import { voiceBansOf, voiceMeasuredOf, voiceProfileOf, voiceSlackStepOf } from "../../lib/alignmentVoice";

describe("partitionAlignmentRows", () => {
  it("moves every act to the Alignment page and keeps every other kind, check-ins included, on the Queue", () => {
    const rows = [
      { key: "hand:open-the-app", kind: "hand", tier: "check-in" },
      { key: "act:1", kind: "act", tier: "check-in" },
      { key: "ask:looks-answered", kind: "ask", tier: "check-in" },
      { key: "act:2", kind: "act", tier: "check-in" },
      { key: "pr:9", kind: "pr", tier: "team-blocked" },
    ];
    const { queueSide, alignmentSide } = partitionAlignmentRows({ rows });
    expect(queueSide.map((row) => row.key)).toEqual(["hand:open-the-app", "ask:looks-answered", "pr:9"]);
    expect(alignmentSide.map((row) => row.key)).toEqual(["act:1", "act:2"]);
  });

  it("splits an empty list into two empty sides", () => {
    expect(partitionAlignmentRows({ rows: [] })).toEqual({ alignmentSide: [], queueSide: [] });
  });
});

describe("alignmentStage", () => {
  it("reads rough until the owner's voice is measured from their sent Slack messages, then claims voice alone", () => {
    expect(alignmentStage({ voiceMeasured: false })).toEqual({
      label: "Rough knowledge · your voice is not yet measured from your sent Slack messages",
      tone: "rough",
    });
    expect(alignmentStage({ voiceMeasured: true })).toEqual({
      label: "Voice measured from your sent Slack messages · everything else is still rough knowledge",
      tone: "measured",
    });
  });
});

describe("consoleCardPath", () => {
  it("opens an act and an alignment question on the Alignment page, a recipe on Automations, a candidate on Workstreams, the rest on the Queue", () => {
    expect(consoleCardPath({ key: "act:1732-enqueue" })).toBe("/alignment");
    expect(consoleCardPath({ key: "align:rule-close-pr" })).toBe("/alignment");
    expect(consoleCardPath({ key: "recipe:daily-digest" })).toBe("/automations");
    expect(consoleCardPath({ key: "candidate:c-001" })).toBe("/workstreams");
    expect(consoleCardPath({ key: "hand:open-the-app" })).toBe("/queue");
    expect(consoleCardPath({ key: "actor:x" })).toBe("/queue");
  });
});

/** One ledger act, steered or not, done when it was steered. */
function act({
  actionId,
  kind = "press-merge-when-ready",
  words,
  atIso = "2026-10-02T12:00:00.000Z",
  ruled = false,
  given = "after",
  subject = "https://github.com/acme/widgets/pull/7",
}: {
  actionId: string;
  kind?: string;
  words?: string;
  atIso?: string;
  ruled?: boolean;
  given?: "after" | "with-act";
  subject?: string;
}): SteeredAct {
  return {
    actionId,
    directSteer: words === undefined ? undefined : { atIso, dateBasis: "steered", given, words },
    doneIso: atIso,
    kind,
    rule: ruled ? { classId: "merge" } : undefined,
    subject,
  };
}

describe("rulingCandidates", () => {
  it("asks about a kind the owner has steered on two acts, each wording counted, most used first", () => {
    const candidates = rulingCandidates({
      acts: [
        act({ actionId: "a", atIso: "2026-10-03T00:00:00.000Z", words: "right call" }),
        act({ actionId: "b", atIso: "2026-10-01T00:00:00.000Z", words: "wrong call" }),
        act({ actionId: "c", atIso: "2026-10-02T00:00:00.000Z", words: "right call" }),
      ],
    });
    expect(candidates).toEqual([
      {
        key: "align:rule-press-merge-when-ready",
        kind: "press-merge-when-ready",
        quotes: [
          { acts: 2, dateBasis: "steered", latestIso: "2026-10-03T00:00:00.000Z", words: "right call" },
          { acts: 1, dateBasis: "steered", latestIso: "2026-10-01T00:00:00.000Z", words: "wrong call" },
        ],
        stakes: {
          blastRadius:
            "It would reach everything this kind of act touches. The recorded acts span 1 GitHub repository and 1 distinct subject; none reached Slack or another non-GitHub surface.",
          risk: "Making this standing would let the fleet treat “press merge when ready” as authorised unasked. The ledger records 3 acts of this kind from 1 Oct 2026 to 3 Oct 2026; it does not measure reversibility.",
        },
        steered: 2 + 1,
      },
    ]);
  });

  it("states the stakes over every act of the kind, unsteered ones included, while asking only over the steered", () => {
    const candidates = rulingCandidates({
      acts: [
        act({ actionId: "a", atIso: "2026-10-03T00:00:00.000Z", words: "right call" }),
        act({ actionId: "b", atIso: "2026-10-01T00:00:00.000Z", words: "right call" }),
        act({ actionId: "c", atIso: "2026-11-09T00:00:00.000Z", subject: "https://github.com/acme/gadgets/pull/12" }),
        act({ actionId: "d", atIso: "2026-11-01T00:00:00.000Z", kind: "close-pr" }),
      ],
    });
    expect(candidates.map((candidate) => candidate.steered)).toEqual([2]);
    expect(candidates.map((candidate) => candidate.stakes)).toEqual([
      {
        blastRadius:
          "It would reach everything this kind of act touches. The recorded acts span 2 GitHub repositories and 2 distinct subjects; none reached Slack or another non-GitHub surface.",
        risk: "Making this standing would let the fleet treat “press merge when ready” as authorised unasked. The ledger records 3 acts of this kind from 1 Oct 2026 to 9 Nov 2026; it does not measure reversibility.",
      },
    ]);
  });

  it("asks nothing below the floor, on an unsteered act, nor where a standing rule already covers the act", () => {
    expect(REPEAT_FLOOR).toBe(2);
    expect(
      rulingCandidates({
        acts: [
          act({ actionId: "a", kind: "close-pr", words: "right call" }),
          act({ actionId: "b", kind: "close-pr" }),
          act({ actionId: "c", ruled: true, words: "right call" }),
          act({ actionId: "d", ruled: true, words: "right call" }),
        ],
      }),
    ).toEqual([]);
  });

  it("counts only a word given once the act was done, never the steer it was recorded with", () => {
    const candidates = rulingCandidates({
      acts: [
        act({ actionId: "a", given: "with-act", words: "transcript:abc#def" }),
        act({ actionId: "b", given: "with-act", words: "transcript:abc#def" }),
        act({ actionId: "c", words: "right call" }),
      ],
    });
    expect(candidates).toEqual([]);
  });

  it("counts one act once, however often the ledger lists it", () => {
    expect(
      rulingCandidates({
        acts: [act({ actionId: "a", words: "right call" }), act({ actionId: "a", words: "right call" })],
      }),
    ).toEqual([]);
  });

  it("ranks the most steered kind first, a kind's name breaking a tie", () => {
    const candidates = rulingCandidates({
      acts: [
        act({ actionId: "1", kind: "rerun", words: "ok" }),
        act({ actionId: "2", kind: "rerun", words: "ok" }),
        act({ actionId: "3", kind: "close-pr", words: "ok" }),
        act({ actionId: "4", kind: "close-pr", words: "ok" }),
        act({ actionId: "5", kind: "land", words: "ok" }),
        act({ actionId: "6", kind: "land", words: "ok" }),
        act({ actionId: "7", kind: "land", words: "ok" }),
      ],
    });
    expect(candidates.map((candidate) => candidate.kind)).toEqual(["land", "close-pr", "rerun"]);
  });
});

describe("readAutonomy directSteer", () => {
  it("reads the owner's word on the act itself with when they said it, and never a pattern's projected word", () => {
    const rows = readAutonomy([
      {
        action: { actionId: "new", doneIso: "2026-10-02T11:00:00.000Z", kind: "k", subject: "s", why: "w" },
        latestSteer: { actionId: "new", steer: "right call", steeredIso: "2026-10-02T12:00:36.605Z" },
      },
      {
        action: { actionId: "old", doneIso: "2026-10-01T11:00:00.000Z", kind: "k", subject: "s", why: "w" },
        patternSteer: { actionId: "new", steer: "right call" },
      },
      {
        action: {
          actionId: "older",
          doneIso: "2026-09-30T11:00:00.000Z",
          kind: "k",
          steer: "fine",
          subject: "s",
          why: "w",
        },
      },
    ])!;
    expect(rows.map((row) => row.directSteer)).toEqual([
      { atIso: "2026-10-02T12:00:36.605Z", dateBasis: "steered", given: "after", words: "right call" },
      undefined,
      { atIso: "2026-09-30T11:00:00.000Z", dateBasis: "acted", given: "with-act", words: "fine" },
    ]);
    expect(rows[1].steer).toBe("right call");
  });
});

describe("readVoiceProfile", () => {
  it("carries a statistic the register never measured as undefined rather than refusing the whole read", () => {
    expect(
      readVoiceProfile({
        cohorts: [
          {
            cohort: "all-sent",
            measuredAt: "2026-10-30T00:00:00.000Z",
            medianWords: null,
            p75Words: null,
            p90Words: null,
            sampleCount: null,
            surface: "slack",
          },
        ],
      }),
    ).toEqual([
      {
        cohort: "all-sent",
        measuredAt: "2026-10-30T00:00:00.000Z",
        medianWords: undefined,
        p75Words: undefined,
        p90Words: undefined,
        sampleCount: undefined,
        surface: "slack",
      },
    ]);
  });

  it("refuses a cohort whose median is not a number or is missing", () => {
    const base = { cohort: "all-sent", measuredAt: "2026-10-30T00:00:00.000Z", surface: "slack" };
    const nulls = { p75Words: null, p90Words: null, sampleCount: null };
    expect([
      readVoiceProfile({ cohorts: [{ ...base, ...nulls, medianWords: "14" }] }),
      readVoiceProfile({ cohorts: [{ ...base, ...nulls }] }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("voice measured from the owner's sent Slack messages", () => {
  const cohorts = readVoiceProfile({
    cohorts: [
      {
        cohort: "all-sent",
        measuredAt: "2026-08-23T00:00:00.000Z",
        medianWords: 14,
        p75Words: 29,
        p90Words: 54,
        sampleCount: 4718,
        surface: "slack",
      },
      {
        cohort: "aggregate",
        measuredAt: "2026-08-23T00:00:00.000Z",
        medianWords: 10,
        p75Words: null,
        p90Words: 36,
        sampleCount: null,
        surface: "slack-dm",
      },
      {
        cohort: "acme-thread",
        measuredAt: "2026-08-23T00:00:00.000Z",
        medianWords: null,
        p75Words: null,
        p90Words: null,
        sampleCount: 9000,
        surface: "slack",
      },
    ],
  })!;
  const unmeasured = readVoiceProfile({
    cohorts: [
      {
        cohort: "all-sent",
        measuredAt: "2026-10-30T00:00:00.000Z",
        medianWords: null,
        p75Words: null,
        p90Words: null,
        sampleCount: null,
        surface: "slack",
      },
    ],
  })!;

  it("draws each Slack surface's measured spread and what it was measured over, skipping a cohort with no median", () => {
    expect(voiceProfileOf({ cohorts, slackConnected: true })).toEqual({
      kind: "measured",
      lengths: [
        {
          basis: 'Measured over 4718 of your sent messages in the "all-sent" cohort on 23 Aug 2026.',
          label: "Slack",
          spread: "Half are under 14 words, 3 in 4 under 29, 9 in 10 under 54.",
        },
        {
          basis: 'Measured over your sent messages in the "aggregate" cohort on 23 Aug 2026.',
          label: "Slack DMs",
          spread: "Half are under 10 words, 9 in 10 under 36.",
        },
      ],
    });
  });

  it("names a narrow cohort as itself, never as everything the owner sends", () => {
    const narrow = readVoiceProfile({
      cohorts: [
        {
          cohort: "dm-calibration",
          measuredAt: "2026-10-30T00:00:00.000Z",
          medianWords: 7,
          p75Words: 12,
          p90Words: 18,
          sampleCount: 312,
          surface: "slack",
        },
      ],
    })!;

    expect(voiceProfileOf({ cohorts: narrow, slackConnected: true })).toEqual({
      kind: "measured",
      lengths: [
        {
          basis: 'Measured over 312 of your sent messages in the "dm-calibration" cohort on 30 Oct 2026.',
          label: "Slack",
          spread: "Half are under 7 words, 3 in 4 under 12, 9 in 10 under 18.",
        },
      ],
    });
  });

  it("keeps a measured register with Slack since disconnected, dated by its basis, and draws the connect step only over none", () => {
    expect([
      voiceProfileOf({ cohorts, slackConnected: false }),
      voiceProfileOf({ cohorts, slackConnected: true }),
    ]).toEqual([
      voiceProfileOf({ cohorts, slackConnected: undefined }),
      voiceProfileOf({ cohorts, slackConnected: undefined }),
    ]);
    expect(voiceProfileOf({ cohorts, slackConnected: false }).kind).toBe("measured");
    expect(voiceProfileOf({ cohorts: [], slackConnected: false })).toEqual({ kind: "not-connected" });
  });

  it("says not measured over an empty register or one whose only median is the register's own dash", () => {
    expect([
      voiceProfileOf({ cohorts: [], slackConnected: true }),
      voiceProfileOf({ cohorts: unmeasured, slackConnected: true }),
      voiceProfileOf({ cohorts: unmeasured, slackConnected: undefined }),
    ]).toEqual([{ kind: "not-measured" }, { kind: "not-measured" }, { kind: "not-measured" }]);
  });

  it("draws the connect step whenever the preflight answered no token, above a measured profile, and none on an unread one", () => {
    const measured = voiceProfileOf({ cohorts, slackConnected: false });
    expect([
      voiceSlackStepOf({ tokenPresent: false, view: measured }),
      voiceSlackStepOf({ tokenPresent: true, view: measured }),
      voiceSlackStepOf({ tokenPresent: undefined, view: measured }),
      voiceSlackStepOf({ tokenPresent: undefined, view: { kind: "not-connected" } }),
      voiceSlackStepOf({ tokenPresent: false, view: { kind: "not-measured" } }),
      voiceSlackStepOf({ tokenPresent: true, view: { kind: "not-measured" } }),
      voiceSlackStepOf({ tokenPresent: false, view: undefined }),
      voiceSlackStepOf({ tokenPresent: undefined, view: undefined }),
      voiceSlackStepOf({ tokenPresent: true, view: undefined }),
    ]).toEqual(["reconnect", "none", "none", "connect", "connect", "none", "connect", "none", "none"]);
  });

  it("falls through to the register when the Slack connection could not be told", () => {
    expect(voiceProfileOf({ cohorts, slackConnected: undefined }).kind).toBe("measured");
  });

  it("calls the voice measured only when a Slack surface carries a measured median", () => {
    expect([
      voiceMeasuredOf({ cohorts }),
      voiceMeasuredOf({ cohorts: unmeasured }),
      voiceMeasuredOf({ cohorts: [] }),
    ]).toEqual([true, false, false]);
  });

  it("names each ban the owner set, a dash by name, in the rules' order", () => {
    const rules = readVoiceRules({
      rules: [
        { kind: "literal", value: "—" },
        { kind: "literal", value: " -- " },
        { kind: "word", value: "delve" },
      ],
      shape: "",
    })!;
    expect(voiceBansOf({ rules })).toEqual(["em-dashes", "“--”", "“delve”"]);
  });
});

describe("readAlignmentAnswers", () => {
  /** One talk log row. */
  const row = ({
    about,
    heard,
    state = "registered",
    registeredAtIso,
  }: {
    about: string;
    heard: string;
    state?: string;
    registeredAtIso: string | null;
  }) => ({ about, heard, registeredAtIso, state, typed: true });

  it("reads each registered answer newest first and leaves an intended one out", () => {
    const answers = readAlignmentAnswers({
      home: "/h",
      rows: [
        row({ about: "align:voice-length", heard: "shorter", registeredAtIso: "2026-10-04T01:00:00.000Z" }),
        row({ about: "align:voice-tagging", heard: "yes", registeredAtIso: "2026-10-04T02:00:00.000Z" }),
        row({ about: "align:voice-length", heard: "pending", registeredAtIso: null, state: "intended" }),
      ],
    });
    expect(answers).toEqual([
      { about: "align:voice-tagging", atIso: "2026-10-04T02:00:00.000Z", words: "yes" },
      { about: "align:voice-length", atIso: "2026-10-04T01:00:00.000Z", words: "shorter" },
    ]);
  });

  it("refuses a registered answer with no instant rather than dropping it", () => {
    expect(
      readAlignmentAnswers({ rows: [row({ about: "align:voice-length", heard: "x", registeredAtIso: null })] }),
    ).toBeUndefined();
  });
});
