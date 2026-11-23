/**
 * The earns-its-place gate, held down by fixtures SHAPED after the drafts it was written for (their paragraph, word,
 * figure and filler counts, never their facts): the spend draft the owner trimmed by voice (`sd-757af49a`), the cut the owner kept
 * (`sd-45b14086`), and the two drafts that call asked to be recut (`sd-3e96cd00`, `sd-68805902`); and the two drafts the
 * console voice ran past where the owner would end them (`../voice/draftsOwnerCut7Oct.ts`).
 */
import { describe, expect, it } from "vitest";

import type { AsMeArtifact, DripInlineRun } from "../../../../outbound/artifact/types.js";
import {
  earnsItsPlaceAdvisory,
  earnsItsPlaceFindings,
  earnsItsPlaceFindingsOf,
  earnsItsPlaceRefusal,
} from "../../../../outbound/slack/draftEarnsItsPlace.js";
import { sentencesAfterAsk } from "../../../../outbound/slack/draftEndsOnAsk.js";
import { reviewAskFormOf } from "../../../../review/reviewAskDraft.js";
import { ARI_CUT, ARI_OFFERED, MONITORS_CUT, MONITORS_OFFERED } from "../voice/draftsOwnerCut7Oct.js";

const CHT_389 = { label: "BBB-389", type: "link", url: "https://linear.app/acme/issue/BBB-389" } as const;

/** Shaped after `sd-45b14086`, the cut the owner kept, over a fixture storage bucket. */
const KEPT: AsMeArtifact = {
  kind: "one-card",
  lines: [
    {
      runs: [
        {
          text: "hey all, slopweaver (the agent setup i've been building) turned up something i reckon is worth a look",
          type: "text",
        },
      ],
    },
    {
      runs: [
        { text: "the fixture storage bucket has grown about $10k since january. ", type: "text" },
        { person: "Seth Tanner", type: "mention" },
        { text: " did we expect to spend that on the backups?", type: "text" },
      ],
    },
    {
      runs: [
        {
          text: "the bucket is fixture-backups-prod, made in the storage console and wired into the backup job, so the bill lands on storage. i checked where it came from and it looks like ",
          type: "text",
        },
        CHT_389,
      ],
    },
  ],
};

/** Shaped after `sd-757af49a`, the draft the owner stripped by voice: six paragraphs, seven figures, two fillers. */
const STRIPPED: AsMeArtifact = {
  kind: "one-card",
  lines: [
    {
      runs: [
        {
          text: "hey all, slopweaver (the agent setup i've been building) turned up something i reckon is worth a look",
          type: "text",
        },
      ],
    },
    {
      runs: [
        {
          text: "the fixture storage bucket, fixture-backups-prod, has grown about $9.7k since january: $5.2k in jan, $3.1k in feb and $1.4k on 1 mar alone. feb was about 27% of that month's whole storage bill, and it's the biggest single bucket on it",
          type: "text",
        },
      ],
    },
    {
      runs: [
        {
          text: "the chart attached is just the last 30 days (1 feb to 2 mar), so it reads $3.6k rather than the total. same bucket, same billing row",
          type: "text",
        },
      ],
    },
    {
      runs: [
        { text: "from the name and ", type: "text" },
        CHT_389,
        {
          text: " it looks like it holds the nightly snapshots in the prod project. there's no lifecycle rule on it, and the growth alert the console raised on 2 mar was still marked new a day later",
          type: "text",
        },
      ],
    },
    {
      runs: [
        {
          text: "not saying it's wasted, the snapshots might be worth every cent. i think the open questions are the retention period, and whether the copies BBB-389 was going to remove are still running alongside them",
          type: "text",
        },
      ],
    },
    {
      runs: [
        { person: "Seth Tanner", type: "mention" },
        { text: " you know this setup best, keen to hear what you reckon. chart and ticket attached", type: "text" },
      ],
    },
  ],
};

/** Shaped after `sd-3e96cd00` (its paragraph, word and close shape, never its facts): a reply to Rosa's "what are you trying to achieve there?". */
const MONITORS_REPLY: AsMeArtifact = {
  kind: "one-card",
  lines: [
    {
      runs: [
        {
          text: "mostly that anyone can respond the right way to any alert, without needing someone else around to help",
          type: "text",
        },
      ],
    },
    {
      runs: [
        {
          text: "a queue backing up in prod and the same queue in staging need pretty different responses, so i reckon they're separate monitors, each with its own runbook. human steps first (who to escalate to, which dashboard to look at), then a collapsed bit for agents",
          type: "text",
        },
      ],
    },
    {
      runs: [
        {
          text: "bigger picture i want us trusting what's in datadog. a monitor made by hand in the UI might have no recipient, point at a channel that's gone, use a count where a rate reads better, or watch one region but not the other. i'd like all of it in IaC, set up one way",
          type: "text",
        },
      ],
    },
    {
      runs: [
        {
          text: "keen to hear where you'd do it differently though, e.g. the checkout error one is a count on purpose because traffic is thin overnight, and that's exactly the kind of thing i want to get right",
          type: "text",
        },
      ],
    },
  ],
};

/** A four-paragraph reply whose only excess is its paragraph count, the shape of `sd-68805902`. */
const FOUR_SHORT_LINES: AsMeArtifact = {
  kind: "one-card",
  lines: [
    "probably not one to resolve yet",
    "the guard was reverted",
    "the redo hasn't started",
    "nothing logs it",
  ].map((text) => ({ runs: [{ text, type: "text" as const }] })),
};

const rulesOf = ({ artifact }: { artifact: AsMeArtifact }): readonly string[] =>
  earnsItsPlaceFindings({ artifact }).map((finding) => finding.rule);

describe("earnsItsPlaceFindings", () => {
  it("passes the cut the owner kept", () => {
    expect(earnsItsPlaceFindings({ artifact: KEPT })).toEqual([]);
  });

  it("refuses the draft the owner stripped on every rule it was stripped on", () => {
    expect(rulesOf({ artifact: STRIPPED })).toEqual(["paragraphs", "words", "figures", "filler"]);
  });

  it("names each figure the stripped draft states, so the composer knows what moves to the image", () => {
    const figures = earnsItsPlaceFindings({ artifact: STRIPPED }).find((finding) => finding.rule === "figures")!;
    expect(figures.fix).toContain("$9.7k, $5.2k, $3.1k, $1.4k, 27%, 30, $3.6k");
  });

  it("names both filler phrases the stripped draft closes on", () => {
    const filler = earnsItsPlaceFindings({ artifact: STRIPPED }).find((finding) => finding.rule === "filler")!;
    expect(filler.fix).toContain('"keen to hear"');
    expect(filler.fix).toContain('"chart and ticket attached"');
  });

  it("reads a reference that goes on to say something as content, never as an announced attachment", () => {
    const artifact: AsMeArtifact = {
      kind: "one-card",
      lines: [
        { runs: [{ text: "the graph above shows it started overnight, as noted, see above", type: "text" }] },
        { runs: [{ text: "the chart attached is the last 30 days", type: "text" }] },
      ],
    };
    expect(earnsItsPlaceFindings({ artifact })).toEqual([]);
  });

  it("refuses the monitors reply on its paragraphs, its words and its freeform close", () => {
    expect(rulesOf({ artifact: MONITORS_REPLY })).toEqual(["paragraphs", "words", "filler"]);
  });

  it("refuses a fourth paragraph however short", () => {
    expect(rulesOf({ artifact: FOUR_SHORT_LINES })).toEqual(["paragraphs"]);
  });

  it("refuses a second question", () => {
    const artifact: AsMeArtifact = {
      kind: "one-card",
      lines: [{ runs: [{ text: "did we expect that? and is it still running?", type: "text" }] }],
    };
    expect(rulesOf({ artifact })).toEqual(["questions"]);
  });

  it("counts a link's label as words, since a whole pull-request title is on the screen", () => {
    const label = Array.from({ length: 101 }, () => "word").join(" ");
    const artifact: AsMeArtifact = {
      kind: "one-card",
      lines: [{ runs: [{ label, type: "link", url: "https://github.com/acme/acme-admin/pull/1" }] }],
    };
    expect(rulesOf({ artifact })).toEqual(["words"]);
  });

  it("skips a code run for figures, the route for an identifier the count misreads", () => {
    const artifact: AsMeArtifact = {
      kind: "one-card",
      lines: [
        {
          runs: [
            { text: "about $10k on the ", type: "text" },
            { code: true, text: "API 502", type: "text" },
          ],
        },
      ],
    };
    expect(earnsItsPlaceFindings({ artifact })).toEqual([]);
  });

  it("exempts a roster's bullets, which are its substance", () => {
    const artifact: AsMeArtifact = {
      bullets: Array.from({ length: 12 }, (_, index) => [
        { text: `item ${String(index + 10)} costs $${String(index + 10)}k? yes`, type: "text" as const },
      ]),
      kind: "one-list",
      lead: [{ text: "a few PRs for your review, all green", type: "text" }],
      trailing: [[{ text: "no rush", type: "text" }]],
    };
    expect(earnsItsPlaceFindings({ artifact })).toEqual([]);
  });

  it("passes the review ask the reviewer pick parks, by construction", () => {
    const form = reviewAskFormOf({
      number: 17945,
      title: "test(QQQQ-178): say why the upcoming report task is still seeded",
      url: "https://github.com/acme/acme-admin/pull/17945",
    });
    expect(earnsItsPlaceFindings({ artifact: JSON.parse(form) as AsMeArtifact })).toEqual([]);
  });
});

/** One paragraph of plain text as a one-card form. */
const oneLine = ({ text }: { text: string }): AsMeArtifact => ({
  kind: "one-card",
  lines: [{ runs: [{ text, type: "text" }] }],
});

/** The move every trailing finding names after its paragraph list. */
const TRAILING_MOVE =
  ": end that paragraph on the ask and cut what follows it there, since the reader stops reading at the ask; context a " +
  "reader needs goes in its own paragraph";

describe("earnsItsPlaceFindings: a paragraph that asks ends on its ask", () => {
  // The message ends where the owner says stop, here on the ask.
  it("refuses the reminder draft as the voice wrote it, on the one sentence after its ask, and nothing else", () => {
    expect(earnsItsPlaceFindings({ artifact: oneLine({ text: ARI_OFFERED }) })).toEqual([
      {
        blindFix:
          "paragraph 1 runs 1 sentence past its ask: end that paragraph on the ask and cut what follows it there, since the reader stops reading at the ask; context a reader needs goes in its own paragraph",
        fix: `paragraph 1 runs 1 sentence past its ask${TRAILING_MOVE}`,
        rule: "trailing",
      },
    ]);
  });

  it("passes the reminder draft ended where the owner said stop", () => {
    expect(earnsItsPlaceFindings({ artifact: oneLine({ text: ARI_CUT }) })).toEqual([]);
  });

  // The owner asked to cut the last 20%. Its question is the check to run, not an ask.
  it("refuses the monitors reply as the voice wrote it on its words alone, and passes the cut the owner took", () => {
    const words =
      "104 words, past 100 (a link's label counts, since it is on the screen): peel details back until each word " +
      "earns its place, and give a pull request a short label";
    expect(earnsItsPlaceFindings({ artifact: oneLine({ text: MONITORS_OFFERED }) })).toEqual([
      { blindFix: words, fix: words, rule: "words" },
    ]);
    expect(earnsItsPlaceFindings({ artifact: oneLine({ text: MONITORS_CUT }) })).toEqual([]);
  });

  it("binds only the asking paragraph, so the cut the owner kept, with context after its ask, passes", () => {
    expect(rulesOf({ artifact: KEPT })).toEqual([]);
  });

  it("reads a mention in the sentence as an ask, and counts every sentence after it", () => {
    const artifact: AsMeArtifact = {
      kind: "one-card",
      lines: [
        {
          runs: [
            { person: "Seth Tanner", type: "mention" },
            { text: " did we expect that spend? it was on the evals. the key is old.", type: "text" },
          ],
        },
      ],
    };
    const trailing = `paragraph 1 runs 2 sentences past its ask${TRAILING_MOVE}`;
    expect(earnsItsPlaceFindings({ artifact })).toEqual([{ blindFix: trailing, fix: trailing, rule: "trailing" }]);
  });

  // A question closed by a quote mark is still the end of its sentence.
  it("ends a sentence at a question closed by a quote mark, so what follows it runs on", () => {
    const trailing = `paragraph 1 runs 1 sentence past its ask${TRAILING_MOVE}`;
    expect(earnsItsPlaceFindings({ artifact: oneLine({ text: '"Can you review this?" I added context.' }) })).toEqual([
      { blindFix: trailing, fix: trailing, rule: "trailing" },
    ]);
    expect(rulesOf({ artifact: oneLine({ text: "Could you take this one (the ticket?) I added context." }) })).toEqual([
      "trailing",
    ]);
  });

  // Mrkdwn emphasis straight after the question, no space between.
  it("ends a sentence at a question run straight into a capital, emphasis or not, and never inside a URL's query", () => {
    expect(rulesOf({ artifact: oneLine({ text: "Can you review this?*I added context.*" }) })).toEqual(["trailing"]);
    expect(rulesOf({ artifact: oneLine({ text: "Can you review this?I added context." }) })).toEqual(["trailing"]);
    expect(
      sentencesAfterAsk({ runs: [{ text: "can you check https://example.com/a?b=1 for me?", type: "text" }] }),
    ).toBe(0);
    expect(rulesOf({ artifact: oneLine({ text: "can you look at app.config.ts?" }) })).toEqual([]);
  });

  // Every glued case is one class: a `?` ends its sentence whatever follows it, bar what continues its word.
  it.each([
    { after: 1, case: "a digit", text: "Can you review this?2 issues remain." },
    { after: 1, case: "a lower-case letter", text: "Can you review this?i added context." },
    { after: 1, case: "an emoji", text: "Can you review this?🙏 I added context." },
    { after: 0, case: "an emoji alone", text: "Can you review this?🙏" },
    { after: 1, case: "a shortcode", text: "Can you review this?:pray: I added context." },
    { after: 0, case: "a shortcode alone", text: "Can you review this?:pray:" },
    { after: 1, case: "bold", text: "Can you review this?*i added context.*" },
    { after: 1, case: "bold closing the ask", text: "*Can you review this?*2 issues remain." },
    { after: 1, case: "italic", text: "Can you review this?_i added context._" },
    { after: 1, case: "a closing bracket", text: "(Can you review this?)i added context." },
    { after: 1, case: "an opening bracket", text: "Can you review this?(i added context.)" },
    { after: 1, case: "a closing quote", text: "“Can you review this?”I added context." },
    { after: 0, case: "a bare URL's query", text: "can you open https://example.com/a?2 for me?" },
    {
      after: 1,
      case: "a www URL's query, then a tail",
      text: "can you check www.example.com/a?b=1 for me? i added it.",
    },
  ])("a `?` glued to $case ends its sentence there unless it continues its word", ({ text, after }) => {
    expect(sentencesAfterAsk({ runs: [{ text, type: "text" }] })).toBe(after);
  });

  it("never splits at a `?` inside a code run or a link target, which are one opaque word each", () => {
    const code: readonly DripInlineRun[] = [
      { text: "can you run ", type: "text" },
      { code: true, text: "a?b=1", type: "text" },
      { text: " for me?", type: "text" },
    ];
    const link: readonly DripInlineRun[] = [
      { text: "can you open ", type: "text" },
      { label: "the board", type: "link", url: "https://example.com/?q=I" },
      { text: " for me?", type: "text" },
    ];
    expect(sentencesAfterAsk({ runs: code })).toBe(0);
    expect(sentencesAfterAsk({ runs: link })).toBe(0);
  });

  it("names every paragraph that runs on, in one finding", () => {
    const artifact: AsMeArtifact = {
      kind: "one-card",
      lines: [
        { runs: [{ text: "can you look? thanks heaps.", type: "text" }] },
        { runs: [{ text: "context here", type: "text" }] },
        { runs: [{ text: "are your numbers right? i think so.", type: "text" }] },
      ],
    };
    const findings = earnsItsPlaceFindings({ artifact });
    expect(findings.map((finding) => finding.rule)).toEqual(["questions", "trailing"]);
    expect(findings[1]!.fix).toBe(
      `paragraph 1 runs 1 sentence past its ask, paragraph 3 runs 1 sentence past its ask${TRAILING_MOVE}`,
    );
  });

  it.each([
    "could you review this when you get a sec? no rush",
    "could you review this? :pray:",
    "could you review this? No rush :thumbsup:",
    "could you review this? 🙏",
  ])("lets an ask close on no rush, or on emoji: %s", (text) => {
    expect(earnsItsPlaceFindings({ artifact: oneLine({ text }) })).toEqual([]);
  });

  it("counts a link or a code run after an ask as a sentence that runs on", () => {
    const artifact: AsMeArtifact = {
      kind: "one-card",
      lines: [
        {
          runs: [
            { text: "could you take this one? ", type: "text" },
            { label: "the ticket", type: "link", url: "https://linear.app/acme/issue/BBB-389" },
          ],
        },
      ],
    };
    expect(rulesOf({ artifact })).toEqual(["trailing"]);
    expect(rulesOf({ artifact: oneLine({ text: "can you run it? `yarn lint`" }) })).toEqual(["trailing"]);
  });

  it("never reads a question in code, or one that does not address the reader, as an ask", () => {
    const artifact: AsMeArtifact = {
      kind: "one-card",
      lines: [
        {
          runs: [
            { code: true, text: "are you there?", type: "text" },
            { text: " is what the probe prints. it never answers.", type: "text" },
          ],
        },
      ],
    };
    expect(rulesOf({ artifact })).toEqual([]);
    expect(rulesOf({ artifact: oneLine({ text: "did it fire overnight? it should have." }) })).toEqual([]);
  });

  it("gives every rule a fix naming no fragment of the draft", () => {
    const findings = earnsItsPlaceFindings({ artifact: STRIPPED });
    expect(findings.find((finding) => finding.rule === "figures")!.blindFix).toBe(
      "7 figures, past 1: keep the ONE that sells the finding in the prose and draw the rest as annotations on the attached image",
    );
    expect(findings.find((finding) => finding.rule === "filler")!.blindFix).toBe(
      "a freeform close or an attachment announced in words does not earn its space: end on the one question, or say plainly that it is an FYI, and let an attachment speak for itself",
    );
    expect(findings.map((finding) => finding.blindFix).join("\n")).not.toContain("$9.7k");
    expect(findings.map((finding) => finding.fix).join("\n")).toContain("$9.7k");
  });
});

describe("earnsItsPlaceFindingsOf", () => {
  it("judges counted paragraphs directly, as the running list hands them", () => {
    const trailing = `paragraph 1 runs 1 sentence past its ask${TRAILING_MOVE}`;
    expect(earnsItsPlaceFindingsOf({ sequences: [[{ text: ARI_OFFERED, type: "text" }]] })).toEqual([
      { blindFix: trailing, fix: trailing, rule: "trailing" },
    ]);
    expect(earnsItsPlaceFindingsOf({ sequences: [] })).toEqual([]);
  });
});

describe("earnsItsPlaceRefusal", () => {
  it("is empty for a draft that earns every word", () => {
    expect(earnsItsPlaceRefusal({ artifact: KEPT, enabled: true })).toEqual([]);
  });

  it("is empty under the open hatch", () => {
    expect(earnsItsPlaceRefusal({ artifact: STRIPPED, enabled: false })).toEqual([]);
  });

  it("names each broken rule, then the four-line refusal with its hatch", () => {
    const lines = earnsItsPlaceRefusal({ artifact: FOUR_SHORT_LINES, enabled: true });
    expect(lines[0]).toBe(
      "paragraphs: 4 paragraphs, past 3: open on the one-sentence finding and its number, ask the one question, and cut every paragraph that is detail a colleague can pull for",
    );
    expect(lines[1]).toContain("slopweaver slack draft record blocked because");
    expect(lines[1]).toContain("(broke paragraphs).");
    expect(lines[3]).toBe(
      'To override use the designated escape hatch slopweaver hatch open earns-its-place --reason "<why this one is a legitimate exception>", then re-run slopweaver slack draft record.',
    );
    expect(lines).toHaveLength(5);
  });
});

describe("earnsItsPlaceAdvisory", () => {
  it("names what a draft parked past the gate broke", () => {
    expect(earnsItsPlaceAdvisory({ artifact: FOUR_SHORT_LINES })).toEqual([
      "parked past the earns-its-place gate under its hatch: broke paragraphs",
    ]);
  });

  it("is empty for a draft that broke nothing", () => {
    expect(earnsItsPlaceAdvisory({ artifact: KEPT })).toEqual([]);
  });
});
