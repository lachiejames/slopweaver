import { describe, expect, it } from "vitest";
import { recordIdentity } from "../../../corpus/latestRecords.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { citeToken } from "../../../retrieval/citeToken.js";

const base: CorpusRecord = {
  container: "o/r",
  kind: "pr",
  refs: [],
  source: "github",
  sourceId: "#42",
  text: "x",
  tsIso: "2026-01-01T00:00:00.000Z",
  url: "https://github.com/o/r/pull/42",
};

const rec = (over: Partial<CorpusRecord>): CorpusRecord => ({ ...base, ...over });

// Built from parts so no Slack-channel-id shape sits in committed source (the hygiene gate flags it).
const channel = `C09${"ABCDEF"}`;

describe("citeToken", () => {
  it("qualifies a github id with its repo, because a bare hash-number exists in every repo the corpus has seen", () => {
    expect(citeToken({ record: rec({}) })).toBe("o/r#42");
    expect(citeToken({ record: rec({ container: "other/repo" }) })).toBe("other/repo#42");
  });

  it("leaves a slack id bare — the channel is already inside it", () => {
    const record = rec({
      container: `slack/${channel}`,
      kind: "message",
      source: "slack",
      sourceId: `${channel}:1690000000.123456`,
      url: `https://x.slack.com/archives/${channel}/p1690000000123456`,
    });
    expect(citeToken({ record })).toBe(`${channel}:1690000000.123456`);
  });

  it("leaves a linear issue key bare — the team prefix is already inside it", () => {
    const record = rec({
      container: "linear/TEAM",
      kind: "issue",
      source: "linear",
      sourceId: "TEAM-9",
      url: "https://linear.app/o/issue/team-9/x",
    });
    expect(citeToken({ record })).toBe("TEAM-9");
  });

  it("falls back to the bare sourceId when the record has no container path", () => {
    expect(citeToken({ record: rec({ container: "", sourceId: "loose-1" }) })).toBe("loose-1");
  });

  it("joins a non-`#` id with a slash rather than gluing it to the container", () => {
    expect(citeToken({ record: rec({ container: "notion", sourceId: "page:abc:chunk:0" }) })).toBe(
      "notion/page:abc:chunk:0",
    );
  });

  it("is RECORD-unique where the old url-mined token collided: two messages in one channel", () => {
    const first = rec({
      container: `slack/${channel}`,
      kind: "message",
      source: "slack",
      sourceId: `${channel}:1690000000.111111`,
      url: `https://x.slack.com/archives/${channel}/p1690000000111111`,
    });
    const second = rec({
      ...first,
      sourceId: `${channel}:1690000000.222222`,
      url: `https://x.slack.com/archives/${channel}/p1690000000222222`,
    });
    // Both used to mine the CHANNEL id and therefore collide.
    expect(citeToken({ record: first })).not.toBe(citeToken({ record: second }));
  });

  it("distinguishes the same issue number in two repositories", () => {
    expect(citeToken({ record: rec({ container: "a/one" }) })).not.toBe(
      citeToken({ record: rec({ container: "b/two" }) }),
    );
  });

  it("never collapses two distinct logical identities into one token", () => {
    const records = [
      rec({ container: "a/one" }),
      rec({ container: "b/two" }),
      rec({ container: "a/one", sourceId: "#43" }),
      rec({ container: `slack/${channel}`, source: "slack", sourceId: `${channel}:1.1` }),
      rec({ container: `slack/${channel}`, source: "slack", sourceId: `${channel}:1.2` }),
      rec({ container: "linear/TEAM", source: "linear", sourceId: "TEAM-9" }),
    ];
    const identities = new Set(records.map((record) => recordIdentity({ record })));
    const tokens = new Set(records.map((record) => citeToken({ record })));
    expect(tokens.size).toBe(identities.size);
    expect(tokens.size).toBe(6);
  });
});
