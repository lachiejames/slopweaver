import { afterEach, describe, expect, it } from "vitest";

import { noInstallDomains } from "../../../knowledge/domainVocabulary.js";
import { lessonRecording, lessonRowOf } from "../../../knowledge/lessonRecording.js";
import { filterLessons, repeatedLessons } from "../../../knowledge/query.js";
import { buildLessonRow } from "../../../knowledge/row.js";
import type { LessonLearner, LessonRow } from "../../../knowledge/types.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { MemoryRecordingRow } from "../../../store/schema/memories.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** One valid row, varying only what a test cares about. */
function row({
  claim = "a grouped count truncates",
  domain = "datadog",
  run = "run-one",
  at = "2026-09-07T01:00:00.000Z",
  tier = 2,
  learner = "fleet",
}: {
  claim?: string;
  domain?: string;
  run?: string;
  at?: string;
  tier?: 1 | 2 | 3 | 4;
  learner?: LessonLearner;
} = {}): LessonRow {
  return unwrap(
    buildLessonRow({
      caveat: undefined,
      claim,
      domain,
      evidence: "measured over a closed window",
      installDomains: noInstallDomains({ home: "/tmp/sw-home" }),
      learner,
      recordedAtIso: at,
      repro: undefined,
      run,
      surface: "api",
      tier,
      verdict: "confirmed",
    }),
  );
}

/** One stored recording, as the database would return it, varying only what a test cares about. */
function recording({
  over = {},
}: {
  over?: Partial<MemoryRecordingRow>;
} = {}): MemoryRecordingRow {
  const source = row();
  return {
    ...lessonRecording({ importKey: null, learner: source.learner, lesson: source, recordingId: "r-1" }),
    createdAt: new Date("2026-09-07T01:00:00.000Z"),
    searchable: null,
    seq: 1,
    ...over,
  };
}

describe("lessonRecording", () => {
  it("leaves the two placement fields NULL rather than inventing judgements the caller never made", () => {
    const written = lessonRecording({ importKey: null, learner: "fleet", lesson: row(), recordingId: "r-1" });

    expect(written.behaviourChange).toBeNull();
    expect(written.retrievalCue).toBeNull();
  });

  it("carries a placement field through when the caller DID supply one", () => {
    const written = lessonRecording({
      behaviourChange: "check the watermark first",
      importKey: null,
      learner: "fleet",
      lesson: row(),
      recordingId: "r-1",
      retrievalCue: "grouped count, truncation",
    });

    expect(written.behaviourChange).toBe("check the watermark first");
    expect(written.retrievalCue).toBe("grouped count, truncation");
  });

  it("files every row as a lesson and keeps the claim id, so a repeat is still countable", () => {
    const source = row();
    const written = lessonRecording({ importKey: null, learner: "fleet", lesson: source, recordingId: "r-1" });

    expect(written.kind).toBe("lesson");
    expect(written.id).toBe(source.id);
  });

  it("writes a blank optional as NULL rather than an empty string in a column", () => {
    const written = lessonRecording({
      behaviourChange: "   ",
      importKey: null,
      learner: "fleet",
      lesson: { ...row(), caveat: "  ", repro: "" },
      recordingId: "r-1",
    });

    expect(written.caveat).toBeNull();
    expect(written.repro).toBeNull();
    expect(written.behaviourChange).toBeNull();
  });
});

describe("lessonRowOf", () => {
  it("round-trips a recorded row back to exactly what was recorded", () => {
    const source = row();

    expect(unwrap(lessonRowOf({ recording: recording() }))).toEqual(source);
  });

  it("reads a NULL learner as the fleet, which is what an absent field in the old file always meant", () => {
    expect(unwrap(lessonRowOf({ recording: recording({ over: { learner: null } }) })).learner).toBe("fleet");
  });

  it("keeps the owner's attribution, because that value was only ever explicit", () => {
    expect(unwrap(lessonRowOf({ recording: recording({ over: { learner: "owner" } }) })).learner).toBe("owner");
  });

  it("REFUSES a preference rather than counting one as a measured lesson", () => {
    const error = unwrapErr(
      lessonRowOf({ recording: recording({ over: { kind: "preference", surface: null, tier: null } }) }),
    );

    expect(error.code).toBe("CORRUPT_RECORDING");
    expect(error.message).toContain("preference");
  });

  it("REFUSES a lesson whose facet is null, naming the recording rather than defaulting a tier", () => {
    const error = unwrapErr(lessonRowOf({ recording: recording({ over: { tier: null } }) }));

    expect(error.code).toBe("CORRUPT_RECORDING");
    expect(error.message).toContain("r-1");
  });

  it("drops an absent caveat and repro rather than carrying nulls onto the row", () => {
    const back = unwrap(lessonRowOf({ recording: recording({ over: { caveat: null, repro: null } }) }));

    expect(back.caveat).toBeUndefined();
    expect(back.repro).toBeUndefined();
  });
});

describe("filterLessons", () => {
  const rows = [
    row({ claim: "a", domain: "datadog", tier: 1 }),
    row({ claim: "b", domain: "linear", tier: 2 }),
    row({ claim: "c", domain: "datadog", run: "run-two", tier: 2 }),
  ];

  it("returns everything when no facet is supplied", () => {
    expect(filterLessons({ rows }).length).toBe(3);
  });

  it("filters by domain", () => {
    expect(filterLessons({ domain: "datadog", rows }).map((entry) => entry.claim)).toEqual(["a", "c"]);
  });

  it("filters by tier", () => {
    expect(filterLessons({ rows, tier: 1 }).map((entry) => entry.claim)).toEqual(["a"]);
  });

  it("filters by run", () => {
    expect(filterLessons({ rows, run: "run-two" }).map((entry) => entry.claim)).toEqual(["c"]);
  });

  it("ANDs two facets rather than ORing them", () => {
    expect(filterLessons({ domain: "datadog", rows, tier: 2 }).map((entry) => entry.claim)).toEqual(["c"]);
  });
});

describe("repeatedLessons", () => {
  it("is empty when nothing was learned twice", () => {
    expect(repeatedLessons({ rows: [row({ claim: "a" }), row({ claim: "b" })] })).toEqual([]);
  });

  it("counts a repeat and the DISTINCT runs behind it", () => {
    const shared = row({ claim: "the same lesson" });
    const repeats = repeatedLessons({
      rows: [shared, { ...shared, run: "run-two" }, { ...shared, run: "run-two" }],
    });
    expect(repeats.length).toBe(1);
    expect(repeats[0]?.count).toBe(3);
    expect(repeats[0]?.runs).toBe(2);
  });

  it("ranks by distinct runs first, because two runs is the signal and two writes is not", () => {
    const oneRunFourTimes = row({ claim: "recorded four times by one run" });
    const twoRunsTwice = row({ claim: "recorded once each by two runs" });
    const repeats = repeatedLessons({
      rows: [
        oneRunFourTimes,
        oneRunFourTimes,
        oneRunFourTimes,
        oneRunFourTimes,
        twoRunsTwice,
        { ...twoRunsTwice, run: "run-two" },
      ],
    });
    expect(repeats[0]?.first.claim).toBe("recorded once each by two runs");
    expect(repeats[1]?.first.claim).toBe("recorded four times by one run");
  });

  it("names the cluster by its FIRST recording's wording", () => {
    const shared = row({ claim: "the original wording" });
    const repeats = repeatedLessons({ rows: [shared, { ...shared, run: "run-two" }] });
    expect(repeats[0]?.first.claim).toBe("the original wording");
  });
});

describe("the learner facet", () => {
  it("filters the owner's rows apart from the fleet's in the one file", () => {
    const rows = [
      row({ claim: "the fleet learned this" }),
      row({ claim: "the owner believes this", learner: "owner" }),
    ];
    expect(filterLessons({ learner: "owner", rows }).map((entry) => entry.claim)).toEqual(["the owner believes this"]);
    expect(filterLessons({ learner: "fleet", rows }).map((entry) => entry.claim)).toEqual(["the fleet learned this"]);
  });

  it("shows both sides when no learner is asked for", () => {
    const rows = [row({ claim: "one" }), row({ claim: "two", learner: "owner" })];
    expect(filterLessons({ rows }).length).toBe(2);
  });

  it("reports a repeat nobody made when the owner's row and the fleet's are grouped together", () => {
    const claim = "gold is being built up as the corpus grows";
    const rows = [row({ claim, run: "run-one" }), row({ claim, learner: "owner", run: "run-two" })];
    const naive = repeatedLessons({ rows });
    expect(naive.length).toBe(1);
    expect(naive[0]?.runs).toBe(2);
    expect(repeatedLessons({ rows: filterLessons({ learner: "fleet", rows }) }).length).toBe(0);
  });
});
