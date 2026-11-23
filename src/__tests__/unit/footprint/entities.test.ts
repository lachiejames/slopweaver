import { describe, expect, it } from "vitest";

import { entitiesIn, linearIssueKey, pullRequestKey, slackThreadKey } from "../../../footprint/entities.js";

describe("entitiesIn", () => {
  it("qualifies a pull request by owner and repository, so a bare number cannot collide", () => {
    const found = entitiesIn({ text: "see https://github.com/acme/acme-admin/pull/16367 for the gate" });

    expect([...found]).toEqual([pullRequestKey({ number: "16367", owner: "acme", repo: "acme-admin" })]);
  });

  it("keeps two same-numbered pull requests in different repositories apart", () => {
    const found = entitiesIn({
      text: "https://github.com/acme/acme-admin/pull/300 and https://github.com/lachiejames/slopweaver/pull/300",
    });

    expect([...found].toSorted()).toEqual(["pr:acme/acme-admin#300", "pr:lachiejames/slopweaver#300"]);
  });

  it("resolves a REPLY permalink to its thread ROOT, not the reply in the path", () => {
    const found = entitiesIn({
      text: "good candidate https://acme.slack.com/archives/C0SYNTH/p1788480284406219?thread_ts=1788428234.892229&cid=C0SYNTH",
    });

    expect([...found]).toEqual([slackThreadKey({ channel: "C0SYNTH", threadTs: "1788428234.892229" })]);
  });

  it("joins a reply link and a parent link to the same key, which is the edge that was being missed", () => {
    const reply = entitiesIn({
      text: "https://acme.slack.com/archives/C0SYNTH/p1788480284406219?thread_ts=1788428234.892229&cid=C0SYNTH",
    });
    const parent = entitiesIn({
      text: "https://acme.slack.com/archives/C0SYNTH/p1788428234892229",
    });

    expect([...reply]).toEqual([...parent]);
  });

  it("reads a Linear identifier", () => {
    const found = entitiesIn({ text: "JJJJ-1552 needs a decision" });

    expect([...found]).toEqual([linearIssueKey({ identifier: "JJJJ-1552" })]);
  });

  it("contributes nothing for an unparseable Slack link rather than guessing a key", () => {
    const found = entitiesIn({ text: "https://acme.slack.com/archives/not-a-real-link" });

    expect([...found]).toEqual([]);
  });

  it("deduplicates a repeated entity", () => {
    const found = entitiesIn({
      text: "https://github.com/o/r/pull/7 then again https://github.com/o/r/pull/7",
    });

    expect(found.size).toBe(1);
  });

  it("finds nothing in text that names nothing", () => {
    const found = entitiesIn({ text: "yo, we keep conventions in markdown that nothing enforces" });

    expect([...found]).toEqual([]);
  });
});
