import { describe, expect, it } from "vitest";

import { dripArtifactSchema } from "../../../../outbound/artifact/asMeSchema.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";
import {
  rawMarkupIssuesOfRuns,
  scanRawMarkup,
  typeRawMarkupInDetail,
  typeRawMarkupInRuns,
} from "../../../../outbound/artifact/typedRuns.js";

/**
 * Every refusal message a card form produced, empty when it parsed — a helper, so no assertion has to
 * branch on `success` and no test has to know how a Zod issue is shaped.
 */
function cardIssues({ raw }: { raw: unknown }): readonly string[] {
  const parsed = updateArtifactSchema.safeParse(raw);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

/** The parsed detail of a card that is expected to pass — `parse` throws rather than returning a union. */
function cardDetail({ raw }: { raw: unknown }) {
  return updateArtifactSchema.parse(raw).detail;
}

/** The parsed runs of a one-message drip's only message. */
function dripRuns({ text }: { text: string }) {
  return dripArtifactSchema({ maxMessages: 3, messageVisibleMax: 200 }).parse({
    kind: "drip",
    messages: [{ runs: [{ text, type: "text" }] }],
  }).messages[0]!.runs;
}

describe("scanRawMarkup", () => {
  it("finds a bare URL and reports where it starts", () => {
    expect(scanRawMarkup({ text: "see https://example.com/x now" })).toEqual([
      {
        kind: "url",
        label: "https://example.com/x",
        raw: "https://example.com/x",
        start: 4,
        url: "https://example.com/x",
      },
    ]);
  });

  it("gives the sentence's full stop back to the prose rather than swallowing it into the href", () => {
    expect(scanRawMarkup({ text: "landed at https://example.com/x." })).toEqual([
      {
        kind: "url",
        label: "https://example.com/x",
        raw: "https://example.com/x",
        start: 10,
        url: "https://example.com/x",
      },
    ]);
  });

  it("keeps a closing bracket the URL itself opened", () => {
    const spans = scanRawMarkup({ text: "https://en.wikipedia.org/wiki/Foo_(bar)" });

    expect(spans).toEqual([
      {
        kind: "url",
        label: "https://en.wikipedia.org/wiki/Foo_(bar)",
        raw: "https://en.wikipedia.org/wiki/Foo_(bar)",
        start: 0,
        url: "https://en.wikipedia.org/wiki/Foo_(bar)",
      },
    ]);
  });

  it("reads raw mention markup, with and without the display half", () => {
    expect(scanRawMarkup({ text: "ping <@U08KJ> and <@U09QQ|ada>" })).toEqual([
      { kind: "user", raw: "<@U08KJ>", slackId: "U08KJ", start: 5 },
      { kind: "user", raw: "<@U09QQ|ada>", slackId: "U09QQ", start: 18 },
    ]);
  });

  it("reads a broadcast, a channel reference and a user group as their own kinds", () => {
    expect(scanRawMarkup({ text: "<!here> <#C0CHAN01> <!subteam^S01>" }).map((span) => span.kind)).toEqual([
      "broadcast",
      "channel",
      "usergroup",
    ]);
  });

  it("finds nothing in honest prose, including a less-than that is not markup", () => {
    expect(scanRawMarkup({ text: "the queue held < 5 items, ok" })).toEqual([]);
  });

  it("leaves a scheme nobody can follow as prose", () => {
    expect(scanRawMarkup({ text: "run ftp://box/file" })).toEqual([]);
  });
});

describe("typeRawMarkupInRuns", () => {
  it("returns the SAME array object when there is nothing to convert", () => {
    const runs = [{ text: "shipped the thing", type: "text" as const }];

    expect(typeRawMarkupInRuns({ runs })).toBe(runs);
  });

  it("splits a bare URL out of the prose around it, keeping the run's own styling on both halves", () => {
    expect(
      typeRawMarkupInRuns({ runs: [{ bold: true, text: "see https://example.com/x now", type: "text" }] }),
    ).toEqual([
      { bold: true, text: "see ", type: "text" },
      { label: "https://example.com/x", type: "link", url: "https://example.com/x" },
      { bold: true, text: " now", type: "text" },
    ]);
  });

  it("uses the display half of `<url|label>` as the link's label", () => {
    expect(typeRawMarkupInRuns({ runs: [{ text: "<https://example.com/x|the PR>", type: "text" }] })).toEqual([
      { label: "the PR", type: "link", url: "https://example.com/x" },
    ]);
  });

  it("leaves a URL inside a CODE span exactly as typed", () => {
    const runs = [{ code: true, text: "curl https://example.com/x", type: "text" as const }];

    expect(typeRawMarkupInRuns({ runs })).toBe(runs);
  });

  it("leaves a channel reference alone, because this vocabulary has no run for one", () => {
    expect(typeRawMarkupInRuns({ runs: [{ text: "in <#C0CHAN01> today", type: "text" }] })).toEqual([
      { text: "in <#C0CHAN01> today", type: "text" },
    ]);
  });

  it("converts a raw subteam reference into a typed group run carrying its S… id", () => {
    expect(typeRawMarkupInRuns({ runs: [{ text: "ask <!subteam^S01|@engineers> today", type: "text" }] })).toEqual([
      { text: "ask ", type: "text" },
      { handle: "S01", type: "group" },
      { text: " today", type: "text" },
    ]);
  });

  it("converts a whole detail sequence — paragraph, bullets and table cells alike", () => {
    const converted = typeRawMarkupInDetail({
      detail: [
        { runs: [{ text: "opened https://example.com/1", type: "text" }], type: "paragraph" },
        { items: [[{ text: "<@U08KJ> owns it", type: "text" }]], type: "bullets" },
        { columns: ["where"], rows: [[[{ text: "<!channel>", type: "text" }]]], type: "table" },
      ],
    });

    expect(converted).toEqual([
      {
        runs: [
          { text: "opened ", type: "text" },
          { label: "https://example.com/1", type: "link", url: "https://example.com/1" },
        ],
        type: "paragraph",
      },
      {
        items: [
          [
            { person: "U08KJ", type: "mention" },
            { text: " owns it", type: "text" },
          ],
        ],
        type: "bullets",
      },
      { columns: ["where"], rows: [[[{ range: "channel", type: "broadcast" }]]], type: "table" },
    ]);
  });
});

describe("rawMarkupIssuesOfRuns", () => {
  it("names the unconvertible span and says what the vocabulary does have", () => {
    const issues = rawMarkupIssuesOfRuns({ path: ["detail", 0], runs: [{ text: "see <#C0CHAN01>", type: "text" }] });

    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["detail", 0]);
    expect(issues[0]!.message).toContain("a channel reference");
    expect(issues[0]!.message).toContain("renders LITERALLY");
  });

  it("reports nothing once conversion has done its half", () => {
    const runs = typeRawMarkupInRuns({ runs: [{ text: "see https://example.com/x", type: "text" }] });

    expect(rawMarkupIssuesOfRuns({ path: ["detail", 0], runs })).toEqual([]);
  });
});

describe("the CARD form types its own raw markup (sighting 1: a user id shown to a reader)", () => {
  it("turns raw mention markup in a detail text run into a mention run", () => {
    const detail = cardDetail({
      raw: {
        detail: [{ runs: [{ text: "<@U08KJ> shipped it", type: "text" }], type: "paragraph" }],
        kind: "update",
        tldr: "whitelist done",
      },
    });

    expect(detail[0]).toEqual({
      runs: [
        { person: "U08KJ", type: "mention" },
        { text: " shipped it", type: "text" },
      ],
      type: "paragraph",
    });
  });

  it("reports NO residue for a subteam reference, because it converted", () => {
    expect(
      rawMarkupIssuesOfRuns({
        path: ["detail", 0],
        runs: typeRawMarkupInRuns({ runs: [{ text: "ask <!subteam^S01>", type: "text" }] }),
      }),
    ).toEqual([]);
  });

  it("REFUSES a channel reference, which has no run to become", () => {
    const issues = cardIssues({
      raw: {
        detail: [{ runs: [{ text: "posted in <#C0CHAN01>", type: "text" }], type: "paragraph" }],
        kind: "update",
        tldr: "whitelist done",
      },
    });

    expect(issues.length).toBe(1);
    expect(issues[0]!).toContain("a channel reference");
  });

  it("REFUSES a URL in the tldr, which is a plain string with nowhere to put a link", () => {
    const issues = cardIssues({
      raw: {
        detail: [{ runs: [{ text: "all green", type: "text" }], type: "paragraph" }],
        kind: "update",
        tldr: "shipped https://example.com/x",
      },
    });

    expect(issues.length).toBe(1);
    expect(issues[0]!).toContain("`primaryLink`");
  });
});

describe("the AS-ME drip form types its own raw markup (sighting 2: dead unlinked URLs in a draft)", () => {
  it("turns a bare URL in a drip message into a link run", () => {
    expect(dripRuns({ text: "here it is https://example.com/x" })).toEqual([
      { text: "here it is ", type: "text" },
      { label: "https://example.com/x", type: "link", url: "https://example.com/x" },
    ]);
  });

  it("turns raw mention markup in a drip message into a mention run", () => {
    expect(dripRuns({ text: "<@U08KJ> take a look" })).toEqual([
      { person: "U08KJ", type: "mention" },
      { text: " take a look", type: "text" },
    ]);
  });

  it("leaves a message with nothing to convert byte-identical", () => {
    expect(dripRuns({ text: "shipped the thing" })).toEqual([{ text: "shipped the thing", type: "text" }]);
  });
});
