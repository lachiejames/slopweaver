/**
 * The SLACK half of the blocked-on-a-person join.
 *
 * The property that matters most here is the one about ABSENCE: "the owner never raised this" and "the corpus has
 * not caught up" are different facts, and a board that prints the first when only the second is known is
 * lying about the exact thing it exists to say. Every branch of that decision is pinned.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CorpusRecord } from "../../../../corpus/types.js";
import { measured, unmeasurable } from "../../../../measurement/status.js";
import {
  type AskWindow,
  absenceReportable,
  askFromRecord,
  asksForPr,
  gatherAsks,
  linksPr,
  namedIn,
  type SlackAsk,
  windowsSince,
} from "../../../../pane/sections/slackAsk.js";

/** One Slack corpus record, spread over so only the field under test varies. */
function record(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    container: "slack/CHANNEL",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "CHANNEL:1.0",
    text: "",
    tsIso: "2026-08-01T00:00:00.000Z",
    url: "https://slack.example/p1",
    ...over,
  };
}

/** One ask, spread over so only the field under test varies. */
function ask(over: Partial<SlackAsk> = {}): SlackAsk {
  return {
    atIso: "2026-08-01T00:00:00.000Z",
    author: "an-owner",
    named: [],
    permalink: "https://slack.example/p1",
    prUrl: "https://github.com/an-owner/a-repo/pull/1",
    ...over,
  };
}

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A window read to an instant newer than every fixture here. */
const FRESH: AskWindow = {
  newestIso: measured({ value: "2099-01-01T00:00:00.000Z" }),
  startIso: "2000-01-01T00:00:00.000Z",
};

describe("namedIn", () => {
  it("reads a real mention run", () => {
    expect(namedIn({ text: "please look <@U012ABC>" })).toEqual(["U012ABC"]);
  });

  it("reads a bare @handle, which Slack renders as text and which pings nobody", () => {
    expect(namedIn({ text: "please look @a-reviewer" })).toEqual(["a-reviewer"]);
  });

  it("does not read an email address as a mention", () => {
    expect(namedIn({ text: "mail someone@example.com about it" })).toEqual([]);
  });

  it("names each person once, in first-seen order", () => {
    expect(namedIn({ text: "<@U1> and @b and <@U1>" })).toEqual(["U1", "b"]);
  });

  it("names nobody in a message that names nobody", () => {
    expect(namedIn({ text: "landed this one" })).toEqual([]);
  });
});

describe("askFromRecord", () => {
  const url = "https://github.com/an-owner/a-repo/pull/1";

  it("matches on the pull request's own URL, so no identity resolution is needed", () => {
    const found = askFromRecord({
      prUrls: [url],
      record: record({ author: "an-owner", text: `review ${url} please @a-reviewer` }),
    });

    expect(found?.prUrl).toBe(url);
    expect(found?.author).toBe("an-owner");
    expect(found?.named).toEqual(["a-reviewer"]);
  });

  it("returns nothing for a message linking a different pull request", () => {
    const other = "https://github.com/an-owner/a-repo/pull/2";

    expect(askFromRecord({ prUrls: [url], record: record({ text: `review ${other}` }) })).toBe(undefined);
  });

  it("returns nothing for a record from another source, even if the text matches", () => {
    expect(askFromRecord({ prUrls: [url], record: record({ source: "github", text: url }) })).toBe(undefined);
  });

  it("keeps a message that links the pull request but names nobody, rather than inventing a person", () => {
    const found = askFromRecord({ prUrls: [url], record: record({ text: `merged ${url}` }) });

    expect(found?.named).toEqual([]);
  });
});

describe("linksPr", () => {
  it("does NOT match a pull request whose number merely PREFIXES another", () => {
    expect(linksPr({ text: "see https://github.com/o/r/pull/123", url: "https://github.com/o/r/pull/12" })).toBe(false);
  });

  it("matches the pull request at the end of the text", () => {
    expect(linksPr({ text: "see https://github.com/o/r/pull/12", url: "https://github.com/o/r/pull/12" })).toBe(true);
  });

  it("matches when the link is followed by punctuation", () => {
    expect(linksPr({ text: "https://github.com/o/r/pull/12, please", url: "https://github.com/o/r/pull/12" })).toBe(
      true,
    );
  });

  it("still matches when a longer sibling appears FIRST in the same message", () => {
    const text = "https://github.com/o/r/pull/123 and https://github.com/o/r/pull/12";

    expect(linksPr({ text, url: "https://github.com/o/r/pull/12" })).toBe(true);
  });
});

describe("linksPr — the scheme mismatch that made the join silently find nothing", () => {
  it("matches the SCHEMELESS spelling Slack actually stores", () => {
    expect(linksPr({ text: "the PR: github.com/o/r/pull/12", url: "https://github.com/o/r/pull/12" })).toBe(true);
  });

  it("still matches the full spelling with its scheme", () => {
    expect(linksPr({ text: "the PR: https://github.com/o/r/pull/12", url: "https://github.com/o/r/pull/12" })).toBe(
      true,
    );
  });

  it("does not let the schemeless form match a longer sibling number", () => {
    expect(linksPr({ text: "github.com/o/r/pull/123", url: "https://github.com/o/r/pull/12" })).toBe(false);
  });
});

describe("asksForPr", () => {
  it("returns only that pull request's asks, newest first", () => {
    const url = "https://github.com/an-owner/a-repo/pull/1";
    const found = asksForPr({
      asks: [
        ask({ atIso: "2026-08-01T00:00:00.000Z" }),
        ask({ atIso: "2026-08-05T00:00:00.000Z" }),
        ask({ prUrl: "https://github.com/an-owner/a-repo/pull/2" }),
      ],
      url,
    });

    expect(found.length).toBe(2);
    expect(found[0]?.atIso).toBe("2026-08-05T00:00:00.000Z");
  });

  it("returns nothing when no ask names that pull request", () => {
    expect(asksForPr({ asks: [ask()], url: "https://github.com/an-owner/a-repo/pull/9" })).toEqual([]);
  });
});

describe("absenceReportable", () => {
  it("permits an absence claim when the corpus is newer than the pull request", () => {
    expect(absenceReportable({ prUpdatedIso: "2026-08-01T00:00:00.000Z", window: FRESH }).known).toBe(true);
  });

  it("REFUSES an absence claim when the corpus ends before the pull request was last active", () => {
    const verdict = absenceReportable({
      prUpdatedIso: "2026-08-08T00:00:00.000Z",
      window: { newestIso: measured({ value: "2026-07-01T00:00:00.000Z" }), startIso: "2026-06-01T00:00:00.000Z" },
    });

    expect(verdict.known).toBe(false);
    expect(verdict.known ? "" : verdict.why).toContain("refresh before trusting an absence");
  });

  it("REFUSES an absence claim when the corpus could not be read at all", () => {
    const verdict = absenceReportable({
      prUpdatedIso: "2026-08-01T00:00:00.000Z",
      window: { newestIso: unmeasurable({ why: "no Slack corpus" }), startIso: "2026-06-01T00:00:00.000Z" },
    });

    expect(verdict.known).toBe(false);
    expect(verdict.known ? "" : verdict.why).toBe("the Slack corpus was not read at all");
  });

  it("REFUSES an absence claim when gh gave the pull request no last-activity instant", () => {
    const verdict = absenceReportable({ prUpdatedIso: "", window: FRESH });

    expect(verdict.known).toBe(false);
    expect(verdict.known ? "" : verdict.why).toContain("nothing bounds the window");
  });
});

describe("gatherAsks — a malformed corpus row is rejected, not surfaced with a wrong-typed field", () => {
  it("skips a row that fails corpus-row validation while keeping a well-formed sibling in the same window", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-slack-ask-"));
    fixtureDirs.push(home);
    const slackDir = join(home, "corpus", "bronze", "slack");
    mkdirSync(slackDir, { recursive: true });
    const prUrl = "https://github.com/an-owner/a-repo/pull/1";
    const valid = record({
      author: "an-owner",
      text: `review ${prUrl} please @a-reviewer`,
      url: "https://slack.example/valid",
    });
    // Same shape, but `url` is a number — valid JSON, invalid corpus row. The old `JSON.parse(...) as
    // CorpusRecord` cast would have let this through with a non-string `permalink`; `parseRow` rejects it.
    const malformed: Record<string, unknown> = { ...valid, url: 4321 };
    writeFileSync(
      join(slackDir, "2026-08-01_2026-08-20.jsonl"),
      `${JSON.stringify(valid)}\n${JSON.stringify(malformed)}\n`,
    );

    const gathered = gatherAsks({ home, nowMs: Date.parse("2026-08-15T00:00:00.000Z"), prUrls: [prUrl] });

    expect(gathered.asks.length).toBe(1);
    expect(gathered.asks[0]?.permalink).toBe("https://slack.example/valid");
  });
});

describe("windowsSince", () => {
  it("keeps a window whose END is at or after the cutoff", () => {
    expect(windowsSince({ names: ["2026-07-25_2026-08-06.jsonl"], sinceIso: "2026-08-01T00:00:00.000Z" })).toEqual([
      "2026-07-25_2026-08-06.jsonl",
    ]);
  });

  it("drops a window that ended before the cutoff, which is what keeps the 290 MB file shut", () => {
    expect(windowsSince({ names: ["2026-04-30_2026-07-30.jsonl"], sinceIso: "2026-08-01T00:00:00.000Z" })).toEqual([]);
  });

  it("ignores a filename that is not a window", () => {
    expect(windowsSince({ names: ["notes.md"], sinceIso: "2000-01-01T00:00:00.000Z" })).toEqual([]);
  });

  it("returns the windows oldest first", () => {
    const kept = windowsSince({
      names: ["2026-08-06_2026-08-09.jsonl", "2026-07-25_2026-08-06.jsonl"],
      sinceIso: "2026-07-01T00:00:00.000Z",
    });

    expect(kept).toEqual(["2026-07-25_2026-08-06.jsonl", "2026-08-06_2026-08-09.jsonl"]);
  });
});
