/**
 * The pure half of profile curation: hashing, attribution, merging and rendering.
 *
 * The property under test that is not obvious from any one case is IDEMPOTENCE. `mergeStatements` keys on
 * the hash of a statement's own TEXT, which is what lets the harvest be re-run without doubling every
 * bucket — and what makes an edited attribution survive a re-import rather than being reverted to the
 * file's version. Both directions are asserted below, because only asserting the first would leave the
 * "existing wins" choice undefended.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  emptyPersonJudgement,
  judgementLines,
  mergeStatements,
  parsePersonJudgement,
  parseVoiceCohort,
  statement,
  statementHash,
  voiceCohortLine,
} from "../../../../store/profile/core.js";
import type { PersonJudgement, VoiceCohort } from "../../../../store/profile/types.js";

/** One cohort with every statistic present, so a case can knock exactly one out. */
const FULL_COHORT: VoiceCohort = {
  ceilingWords: 50,
  cohort: "all-sent",
  measuredAt: "2026-08-23T00:00:00.000Z",
  medianWords: 14,
  p75Words: 29,
  p90Words: 54,
  qualification: "residual agent-authored messages in the sample",
  sampleCount: 4718,
  source: "file:profile/rules/communication-style.md",
  surface: "slack",
};

describe("statementHash", () => {
  it("hashes the text and nothing else", () => {
    expect(statementHash({ text: "prefers a DM" })).toBe(
      "sha256:35d1104220d8fd9d270e4a8a105b9dc77960443119dac7967b85bb827ca5f64f",
    );
  });

  it("gives two different texts two different hashes", () => {
    expect(statementHash({ text: "a" })).not.toBe(statementHash({ text: "b" }));
  });
});

describe("statement", () => {
  it("computes the hash rather than taking one, so it always matches the stored text", () => {
    const made = statement({ observedAt: "2026-08-23T00:00:00.000Z", source: "slack:x", text: "prefers a DM" });
    expect(made.sourceHash).toBe(statementHash({ text: made.text }));
  });
});

describe("mergeStatements", () => {
  it("adds a statement whose text is new", () => {
    const existing = [statement({ observedAt: "2026-08-23T00:00:00.000Z", source: "a", text: "one" })];
    const incoming = [statement({ observedAt: "2026-09-01T00:00:00.000Z", source: "b", text: "two" })];
    expect(mergeStatements({ existing, incoming }).map((entry) => entry.text)).toStrictEqual(["one", "two"]);
  });

  it("writes nothing on a second import of the same text, which is what makes a harvest re-runnable", () => {
    const existing = [statement({ observedAt: "2026-08-23T00:00:00.000Z", source: "a", text: "one" })];
    expect(mergeStatements({ existing, incoming: existing })).toStrictEqual(existing);
  });

  it("keeps the EXISTING attribution on a collision rather than the incoming one", () => {
    const existing = [statement({ observedAt: "2026-08-23T00:00:00.000Z", source: "corrected", text: "one" })];
    const incoming = [statement({ observedAt: "2026-09-01T00:00:00.000Z", source: "file", text: "one" })];
    expect(mergeStatements({ existing, incoming })[0]?.source).toBe("corrected");
  });
});

describe("parsePersonJudgement", () => {
  it("accepts an empty judgement at revision 1", () => {
    const empty = emptyPersonJudgement({ nowIso: "2026-09-12T00:00:00.000Z" });
    expect(unwrap(parsePersonJudgement({ value: empty })).revision).toBe(1);
  });

  it("names every issue at once rather than the first", () => {
    const failure = unwrapErr(parsePersonJudgement({ value: { revision: 0, schemaVersion: 9 } }));
    expect(failure.code).toBe("PAYLOAD_INVALID");
    expect(failure.message).toContain("schemaVersion");
    expect(failure.message).toContain("revision");
  });

  it("refuses a statement whose hash is not a sha256", () => {
    const empty = emptyPersonJudgement({ nowIso: "2026-09-12T00:00:00.000Z" });
    const bad = {
      ...empty,
      facts: [{ observedAt: "2026-09-12T00:00:00.000Z", source: "x", sourceHash: "md5:abc", text: "t" }],
    };
    expect(unwrapErr(parsePersonJudgement({ value: bad })).message).toContain("sha256");
  });
});

describe("parseVoiceCohort", () => {
  it("accepts a cohort whose percentiles ascend", () => {
    expect(unwrap(parseVoiceCohort({ value: FULL_COHORT })).surface).toBe("slack");
  });

  it("accepts a cohort with holes, because an unmeasured percentile is absent rather than zero", () => {
    const holed = { ...FULL_COHORT, p75Words: null };
    expect(unwrap(parseVoiceCohort({ value: holed })).p75Words).toBeNull();
  });

  it("refuses percentiles that descend, and names the cohort", () => {
    const impossible = { ...FULL_COHORT, p90Words: 3 };
    expect(unwrapErr(parseVoiceCohort({ value: impossible })).message).toContain("slack/all-sent");
  });

  it("accepts a ceiling BELOW p90, because a ceiling is an intent and a percentile is an observation", () => {
    expect(unwrap(parseVoiceCohort({ value: { ...FULL_COHORT, ceilingWords: 50 } })).ceilingWords).toBe(50);
  });
});

describe("voiceCohortLine", () => {
  it("prints an unmeasured statistic as a dash rather than dropping it", () => {
    expect(voiceCohortLine({ cohort: { ...FULL_COHORT, p75Words: null } })).toBe(
      "slack/all-sent: median 14, p75 —, p90 54, ceiling 50, n=4718 (measured 2026-08-23)",
    );
  });
});

describe("judgementLines", () => {
  it("dates every statement rather than dating the curation once", () => {
    const judgement: PersonJudgement = {
      ...emptyPersonJudgement({ nowIso: "2026-09-12T00:00:00.000Z" }),
      channelPreferences: [statement({ observedAt: "2026-05-02T00:00:00.000Z", source: "s", text: "DM only" })],
      facts: [statement({ observedAt: "2026-09-11T00:00:00.000Z", source: "s", text: "runs the MX team" })],
    };
    expect(judgementLines({ judgement })).toStrictEqual([
      "facts: runs the MX team (observed 2026-09-11)",
      "reach them on: DM only (observed 2026-05-02)",
    ]);
  });

  it("omits an empty bucket rather than printing a heading with nothing under it", () => {
    expect(judgementLines({ judgement: emptyPersonJudgement({ nowIso: "2026-09-12T00:00:00.000Z" }) })).toStrictEqual(
      [],
    );
  });
});
