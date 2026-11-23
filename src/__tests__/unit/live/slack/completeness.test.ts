import { describe, expect, it } from "vitest";

import {
  deriveFileCompleteness,
  deriveThreadCompleteness,
  describeThreadCompleteness,
  describeUnretrievable,
  type ThreadCompleteness,
  type UnretrievableFile,
} from "../../../../live/slack/completeness.js";

const ROOT = "1785114398.557099";

/** A raw root row carrying whatever `reply_count` a case needs. */
function root({ replyCount }: { replyCount?: unknown }): Record<string, unknown> {
  return replyCount === undefined
    ? { text: "parent", ts: ROOT }
    : { reply_count: replyCount, text: "parent", ts: ROOT };
}

/** N raw reply rows with distinct timestamps. */
function replies({ count }: { count: number }): Record<string, unknown>[] {
  return Array.from({ length: count }, (_unused, index) => ({
    text: `reply ${String(index)}`,
    thread_ts: ROOT,
    ts: `1785114500.0001${String(index).padStart(2, "0")}`,
  }));
}

describe("deriveThreadCompleteness — the provider's own count as the oracle", () => {
  it("CORROBORATES when reply_count + 1 equals what the read holds", () => {
    const rawMessages = [root({ replyCount: 3 }), ...replies({ count: 3 })];

    const evidence = deriveThreadCompleteness({ held: 4, rawMessages, threadTs: ROOT });

    expect(evidence.providerTotalObserved).toBe(4);
    expect(evidence.held).toBe(4);
    expect(evidence.excludedAtLeast).toBe(0);
    expect(evidence.surplusObserved).toBe(0);
    expect(evidence.droppedInShaping).toBe(0);
    expect(evidence.verdict).toBe("corroborated");
  });

  it("reports SHORT-OF-ADVERTISED with a floor, when Slack advertises more than arrived", () => {
    const rawMessages = [root({ replyCount: 10 }), ...replies({ count: 2 })];

    const evidence = deriveThreadCompleteness({ held: 3, rawMessages, threadTs: ROOT });

    expect(evidence.providerTotalObserved).toBe(11);
    expect(evidence.excludedAtLeast).toBe(8);
    expect(evidence.surplusObserved).toBe(0);
    expect(evidence.verdict).toBe("short-of-advertised");
  });

  it("reports OVER-ADVERTISED rather than clamping the other direction to zero", () => {
    // The direction a "showing N of M" render silently loses. reply_count is not documented as counting the
    // same population `conversations.replies` returns, so this happens and must not read as complete.
    const rawMessages = [root({ replyCount: 1 }), ...replies({ count: 3 })];

    const evidence = deriveThreadCompleteness({ held: 4, rawMessages, threadTs: ROOT });

    expect(evidence.providerTotalObserved).toBe(2);
    expect(evidence.excludedAtLeast).toBe(0);
    expect(evidence.surplusObserved).toBe(2);
    expect(evidence.verdict).toBe("over-advertised");
  });

  it("says UNVERIFIED — not complete — when the root carries no reply_count at all", () => {
    const rawMessages = [root({}), ...replies({ count: 2 })];

    const evidence = deriveThreadCompleteness({ held: 3, rawMessages, threadTs: ROOT });

    // null, not 0: "Slack said nothing" and "Slack said zero" are different claims.
    expect(evidence.providerTotalObserved).toBe(null);
    expect(evidence.excludedAtLeast).toBe(0);
    expect(evidence.verdict).toBe("unverified");
  });

  it("treats a non-integer or negative reply_count as no count rather than trusting it", () => {
    const fractional = deriveThreadCompleteness({ held: 1, rawMessages: [root({ replyCount: 2.5 })], threadTs: ROOT });
    const negative = deriveThreadCompleteness({ held: 1, rawMessages: [root({ replyCount: -1 })], threadTs: ROOT });
    const stringly = deriveThreadCompleteness({ held: 1, rawMessages: [root({ replyCount: "4" })], threadTs: ROOT });

    expect(fractional.providerTotalObserved).toBe(null);
    expect(negative.providerTotalObserved).toBe(null);
    expect(stringly.providerTotalObserved).toBe(null);
  });

  it("counts a reply_count of zero as a real total of one", () => {
    const evidence = deriveThreadCompleteness({ held: 1, rawMessages: [root({ replyCount: 0 })], threadTs: ROOT });

    expect(evidence.providerTotalObserved).toBe(1);
    expect(evidence.verdict).toBe("corroborated");
  });

  it("separates rows Slack REPEATED from rows that are missing", () => {
    // Slack returns the root as messages[0] of EVERY page. A clean two-page read therefore repeats exactly
    // one row, and that must not read as a discrepancy.
    const page1 = [root({ replyCount: 4 }), ...replies({ count: 2 })];
    const page2 = [root({ replyCount: 4 }), ...replies({ count: 2 }).map((r, i) => ({ ...r, ts: `1785114600.0${i}` }))];
    const rawMessages = [...page1, ...page2];

    const evidence = deriveThreadCompleteness({ held: 5, rawMessages, threadTs: ROOT });

    expect(evidence.fetchedRaw).toBe(6);
    expect(evidence.fetchedUnique).toBe(5);
    expect(evidence.repeatedRows).toBe(1);
    expect(evidence.verdict).toBe("corroborated");
  });

  it("reports SHAPING-LOSS ahead of any count comparison when a fetched row is not represented", () => {
    const rawMessages = [root({ replyCount: 2 }), ...replies({ count: 2 })];

    // Two rows arrived and only one is held: real loss, whatever the advertised count says.
    const evidence = deriveThreadCompleteness({ held: 2, rawMessages, threadTs: ROOT });

    expect(evidence.fetchedUnique).toBe(3);
    expect(evidence.droppedInShaping).toBe(1);
    expect(evidence.verdict).toBe("shaping-loss");
  });

  it("takes the FIRST root occurrence, so which page came last cannot change the reading", () => {
    const rawMessages = [root({ replyCount: 3 }), ...replies({ count: 3 }), { reply_count: 99, ts: ROOT }];

    const evidence = deriveThreadCompleteness({ held: 4, rawMessages, threadTs: ROOT });

    expect(evidence.providerTotalObserved).toBe(4);
  });

  it("finds no count when the root row never came back", () => {
    const evidence = deriveThreadCompleteness({ held: 2, rawMessages: replies({ count: 2 }), threadTs: ROOT });

    expect(evidence.providerTotalObserved).toBe(null);
    expect(evidence.fetchedUnique).toBe(2);
    expect(evidence.verdict).toBe("unverified");
  });

  it("ignores a non-object row for both the count and the unique tally", () => {
    const evidence = deriveThreadCompleteness({
      held: 1,
      rawMessages: [root({ replyCount: 0 }), null, "nonsense", 7],
      threadTs: ROOT,
    });

    expect(evidence.fetchedRaw).toBe(4);
    expect(evidence.fetchedUnique).toBe(1);
    expect(evidence.providerTotalObserved).toBe(1);
  });
});

describe("describeThreadCompleteness", () => {
  /** The evidence shape, with only the fields a caveat reads set to anything interesting. */
  function evidence({ over }: { over: Partial<ThreadCompleteness> }): ThreadCompleteness {
    return {
      droppedInShaping: 0,
      excludedAtLeast: 0,
      fetchedRaw: 4,
      fetchedUnique: 4,
      held: 4,
      providerTotalObserved: 4,
      repeatedRows: 0,
      surplusObserved: 0,
      verdict: "corroborated",
      ...over,
    };
  }

  it("says nothing when every lane of evidence agrees", () => {
    expect(describeThreadCompleteness({ completeness: evidence({ over: {} }) })).toBe(undefined);
  });

  it("says nothing when there was no count to compare against — silence, not a false all-clear", () => {
    const unverified = evidence({ over: { providerTotalObserved: null, verdict: "unverified" } });

    expect(describeThreadCompleteness({ completeness: unverified })).toBe(undefined);
  });

  it("names BOTH figures and refuses to call a shortfall proof of an early stop", () => {
    const short = evidence({
      over: { excludedAtLeast: 7, held: 4, providerTotalObserved: 11, verdict: "short-of-advertised" },
    });

    const sentence = describeThreadCompleteness({ completeness: short })!;

    expect(sentence).toContain("advertises 11 messages and this read holds 4");
    expect(sentence).toContain("at least 7 not represented");
    expect(sentence).toContain("rather than proof the read stopped early");
  });

  it("states outright that nothing is missing in the over-advertised direction", () => {
    const over = evidence({
      over: { held: 4, providerTotalObserved: 2, surplusObserved: 2, verdict: "over-advertised" },
    });

    const sentence = describeThreadCompleteness({ completeness: over })!;

    expect(sentence).toContain("holds 4 messages and Slack's own reply_count advertises only 2");
    expect(sentence).toContain("Nothing is missing in this direction");
  });

  it("says how many rows arrived and how many survived, when rows were lost in shaping", () => {
    const lost = evidence({ over: { droppedInShaping: 2, fetchedUnique: 6, held: 4, verdict: "shaping-loss" } });

    const sentence = describeThreadCompleteness({ completeness: lost })!;

    expect(sentence).toContain("2 fetched message(s) are not in this output");
    expect(sentence).toContain("6 distinct rows arrived and 4 are represented");
  });
});

describe("deriveFileCompleteness", () => {
  it("is complete when every attachment was fetched", () => {
    const evidence = deriveFileCompleteness({ retrieved: 4, skipped: 0, unretrievable: 0 });

    expect(evidence.verdict).toBe("complete");
    expect(evidence.observed).toBe(4);
  });

  it("is complete for a thread with no attachments at all", () => {
    const evidence = deriveFileCompleteness({ retrieved: 0, skipped: 0, unretrievable: 0 });

    expect(evidence.verdict).toBe("complete");
    expect(evidence.observed).toBe(0);
  });

  it("is stated-exclusions when files were skipped by rule but nothing failed", () => {
    const evidence = deriveFileCompleteness({ retrieved: 2, skipped: 3, unretrievable: 0 });

    expect(evidence.verdict).toBe("stated-exclusions");
    expect(evidence.observed).toBe(5);
    expect(evidence.skipped).toBe(3);
  });

  it("is unretrievable-loss the moment one attachment has no bytes, even beside successes", () => {
    const evidence = deriveFileCompleteness({ retrieved: 6, skipped: 2, unretrievable: 1 });

    // Loss OUTRANKS a stated exclusion: a reader who is told "stated-exclusions" would reasonably
    // conclude everything absent was absent on purpose.
    expect(evidence.verdict).toBe("unretrievable-loss");
    expect(evidence.observed).toBe(9);
    expect(evidence.unretrievable).toBe(1);
  });
});

describe("describeUnretrievable", () => {
  const failed: UnretrievableFile = {
    detail: "Slack returned HTTP 403 for the file",
    fileId: "F0BKXLKV0QJ",
    messageTs: "1785114398.557099",
    method: "slack.files.download",
    name: "quarterly.pdf",
    reason: "download-failed",
  };

  it("names the file, the message, the failing method and the provider's own words", () => {
    const [sentence] = describeUnretrievable({ files: [failed] });

    expect(sentence).toBe(
      "quarterly.pdf (F0BKXLKV0QJ) on message 1785114398.557099 could not be retrieved — " +
        "slack.files.download: Slack returned HTTP 403 for the file",
    );
  });

  it("falls back to the file id when Slack gave no name", () => {
    const { name: _unnamed, ...nameless } = failed;
    const [sentence] = describeUnretrievable({ files: [nameless] });

    expect(sentence).toContain("F0BKXLKV0QJ on message");
  });

  it("distinguishes a scope gap from a failed fetch — one was never attempted", () => {
    const [sentence] = describeUnretrievable({
      files: [{ ...failed, detail: "token lacks files:read; the download was not attempted", reason: "scope-missing" }],
    });

    expect(sentence).toContain("not attempted: this token lacks the scope the file lane needs");
  });

  it("reports one sentence PER FILE, not one per class", () => {
    const sentences = describeUnretrievable({
      files: [failed, { ...failed, detail: "Slack returned an empty body", fileId: "F222", name: "chart.png" }],
    });

    // Two failures of the same class with different details are two different things to look at.
    expect(sentences.length).toBe(2);
    expect(sentences[1]).toContain("chart.png (F222)");
    expect(sentences[1]).toContain("Slack returned an empty body");
  });

  it("returns nothing when nothing was lost", () => {
    expect(describeUnretrievable({ files: [] })).toEqual([]);
  });
});
