/**
 * The form writer qualifies every bare GitHub reference a passing page resolved, so the accumulated narrative
 * can never be refused later when the page around it starts linking a second repository.
 */
import { describe, expect, it } from "vitest";

import { checkBareRefs } from "../../../briefing/bareRef.js";
import { qualifyBareRefsInNarrative } from "../../../briefing/qualifyBareRefs.js";
import { renderNote } from "../../../outbound/briefing/render.js";
import type { BriefingNote } from "../../../outbound/briefing/types.js";
import { foldedNoteSchema } from "../../../outbound/briefing/vocabulary.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";

const WIDGET_CONTEXT: BareRefContext = {
  attested: [{ number: 2686, owner: "acme", repo: "widget" }],
  repos: [{ owner: "acme", repo: "widget" }],
};
const GADGET = "https://github.com/acme/gadget/pull/19343";

/** A one-line composed note. */
function note({ text }: { text: string }): BriefingNote {
  return { headline: [{ kind: "text", text }] };
}

/**
 * The page the renderer emits for these notes beside one row linking the notes' own repository and one
 * unrelated row linking a second — tick 21's shape, where the page names two repositories at once.
 */
function pageWithSecondRepo({ notes }: { notes: readonly unknown[] }): string {
  const rows = [
    { headline: [{ kind: "link", text: "#2686 the fix", url: "https://github.com/acme/widget/pull/2686" }] },
    { headline: [{ kind: "link", text: "#19343 the reminder", url: GADGET }] },
  ];
  const body = [...notes, ...rows].map((one) => renderNote({ note: one as BriefingNote })).join("\n");
  return `<h2>react now</h2><h2 id="recent">done since you last looked</h2><details><summary>landings</summary><div>${body}</div></details>`;
}

describe("qualifyBareRefsInNarrative — the accumulated form across a second repository", () => {
  const tickTwenty = { history: [], recent: [note({ text: "Step 9b rebased #2687 onto main." })] };

  it("reproduces the refusal: the unqualified form fails once the page links a second repository", () => {
    const html = pageWithSecondRepo({ notes: tickTwenty.recent });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.reason)).toEqual([
      '"#2687" is a bare reference (renders as #2687) with no single repo to resolve it against — write it as ' +
        '"owner/repo#<number>", or put one full github.com/<owner>/<repo> link in the same text, which names the repo ' +
        "every bare reference beside it means.",
    ]);
  });

  it("passes the same later page once the earlier tick's form was qualified", () => {
    const qualified = qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: tickTwenty });
    const html = pageWithSecondRepo({ notes: qualified["recent"] as readonly unknown[] });

    expect(qualified["recent"]).toEqual([note({ text: "Step 9b rebased acme/widget#2687 onto main." })]);
    expect(checkBareRefs({ html }).defects).toEqual([]);
  });
});

describe("qualifyBareRefsInNarrative — a fold's summary across a second repository (handoff-9365 tick 15)", () => {
  const folded = {
    detail: {
      blocks: [
        { content: [{ kind: "text", text: "Seated the rework." }], kind: "para" },
        {
          fold: { blocks: [{ content: [{ kind: "text", text: "the plan" }], kind: "para" }], summary: "#2683 parked" },
          kind: "fold",
        },
      ],
      summary: "#2687 booted; rest held",
    },
    headline: [{ kind: "text", text: "Tick fourteen." }],
  };

  it("reproduces the refusal: a bare summary passes on one repository and fails once the page links a second", () => {
    const html = pageWithSecondRepo({ notes: [folded] });

    expect(checkBareRefs({ html }).defects.map((defect) => defect.reason.slice(0, 7))).toEqual(['"#2687"', '"#2683"']);
  });

  it("qualifies the detail fold's summary and a nested fold's, so the later page passes", () => {
    const qualified = qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: { recent: [folded] } });

    expect(qualified["recent"]).toEqual([
      {
        ...folded,
        detail: {
          blocks: [
            folded.detail.blocks[0],
            {
              fold: {
                blocks: [{ content: [{ kind: "text", text: "the plan" }], kind: "para" }],
                summary: "acme/widget#2683 parked",
              },
              kind: "fold",
            },
          ],
          summary: "acme/widget#2687 booted; rest held",
        },
      },
    ]);
    expect(
      checkBareRefs({ html: pageWithSecondRepo({ notes: qualified["recent"] as readonly unknown[] }) }).defects,
    ).toEqual([]);
  });
});

describe("qualifyBareRefsInNarrative — a fold summary against its 120-character cap (Codex plan)", () => {
  const SHORT_CONTEXT: BareRefContext = {
    attested: [{ number: 3170, owner: "a", repo: "b" }],
    repos: [{ owner: "a", repo: "b" }],
  };

  /** A folded note whose summary is `summary`, beside a bare headline and paragraph reference. */
  function foldedWith({ summary }: { summary: string }): unknown {
    return {
      detail: { blocks: [{ content: [{ kind: "text", text: "See #3169." }], kind: "para" }], summary },
      headline: [{ kind: "text", text: "Rebased #3168." }],
    };
  }

  it("qualifies a 117-character summary to exactly 120, though its fences run past the cap", () => {
    const summary = `#3167 booted ${"a".repeat(104)}`;
    const [qualified] = qualifyBareRefsInNarrative({
      context: SHORT_CONTEXT,
      form: { recent: [foldedWith({ summary })] },
    })["recent"] as readonly unknown[];

    expect(summary.length).toBe(117);
    expect(qualified).toEqual({
      detail: {
        blocks: [{ content: [{ kind: "text", text: "See a/b#3169." }], kind: "para" }],
        summary: `a/b#3167 booted ${"a".repeat(104)}`,
      },
      headline: [{ kind: "text", text: "Rebased a/b#3168." }],
    });
    expect(foldedNoteSchema.safeParse(qualified).success).toBe(true);
  });

  it("leaves a summary its qualified form would push past the cap bare whole, and qualifies the rest", () => {
    const summary = `#3167 and #3166 booted ${"a".repeat(94)}`;
    const [qualified] = qualifyBareRefsInNarrative({
      context: SHORT_CONTEXT,
      form: { recent: [foldedWith({ summary })] },
    })["recent"] as readonly unknown[];

    expect(summary.length).toBe(117);
    expect(qualified).toEqual({
      detail: { blocks: [{ content: [{ kind: "text", text: "See a/b#3169." }], kind: "para" }], summary },
      headline: [{ kind: "text", text: "Rebased a/b#3168." }],
    });
    expect(foldedNoteSchema.safeParse(qualified).success).toBe(true);
    expect(
      checkBareRefs({ html: pageWithSecondRepo({ notes: [qualified] }) }).defects.map((defect) =>
        defect.reason.slice(0, 7),
      ),
    ).toEqual(['"#3167"', '"#3166"']);
  });
});

describe("qualifyBareRefsInNarrative — what it rewrites", () => {
  it("rewrites recent, earlierToday and every history section, headline and fold alike", () => {
    const form = {
      earlierToday: { notes: [note({ text: "merged: 2685, 2686" })], summary: "earlier" },
      history: [{ notes: [note({ text: "Landed #2684." })], summary: "yesterday" }],
      recent: [
        {
          detail: {
            blocks: [
              { content: [{ kind: "text", text: "See #2681." }], kind: "para" },
              {
                items: [
                  [
                    { kind: "strong", text: "#2682" },
                    { kind: "text", text: " landed" },
                  ],
                ],
                kind: "list",
                ordered: false,
              },
              {
                fold: { blocks: [{ content: [{ kind: "text", text: "and #2683" }], kind: "para" }], summary: "more" },
                kind: "fold",
              },
            ],
            summary: "readings",
          },
          headline: [{ kind: "strong", text: "Rebased #2687." }],
        },
      ],
    };

    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form })).toEqual({
      earlierToday: { notes: [note({ text: "merged: acme/widget#2685, acme/widget#2686" })], summary: "earlier" },
      history: [{ notes: [note({ text: "Landed acme/widget#2684." })], summary: "yesterday" }],
      recent: [
        {
          detail: {
            blocks: [
              { content: [{ kind: "text", text: "See acme/widget#2681." }], kind: "para" },
              {
                items: [
                  [
                    { kind: "strong", text: "acme/widget#2682" },
                    { kind: "text", text: " landed" },
                  ],
                ],
                kind: "list",
                ordered: false,
              },
              {
                fold: {
                  blocks: [{ content: [{ kind: "text", text: "and acme/widget#2683" }], kind: "para" }],
                  summary: "more",
                },
                kind: "fold",
              },
            ],
            summary: "readings",
          },
          headline: [{ kind: "strong", text: "Rebased acme/widget#2687." }],
        },
      ],
    });
  });

  it("qualifies against the nearest link in the note's own entry, not the page", () => {
    const form = {
      recent: [
        {
          headline: [
            { kind: "link", text: "#19343 the reminder", url: GADGET },
            { kind: "text", text: " was reviewed, then #19344 followed." },
          ],
        },
      ],
    };

    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form })["recent"]).toEqual([
      {
        headline: [
          { kind: "link", text: "#19343 the reminder", url: GADGET },
          { kind: "text", text: " was reviewed, then acme/gadget#19344 followed." },
        ],
      },
    ]);
  });
});

describe("qualifyBareRefsInNarrative — the check decides, never the writer", () => {
  it("writes the repository the rendered page resolves, however many spaces the form's run carries", () => {
    const alpha = "https://github.com/acme/alpha/pull/120";
    const beta = "https://github.com/acme/beta/pull/122";
    const headline = [
      { kind: "link", text: "alpha", url: alpha },
      { kind: "text", text: "          #121" },
      { kind: "link", text: "beta", url: beta },
    ];
    const qualified = qualifyBareRefsInNarrative({ context: { repos: [] }, form: { recent: [{ headline }] } });

    // On the page the ten spaces collapse to one and the bare reference touches beta's link, so beta is the nearer.
    expect(qualified["recent"]).toEqual([
      {
        headline: [
          { kind: "link", text: "alpha", url: alpha },
          { kind: "text", text: "          acme/beta#121" },
          { kind: "link", text: "beta", url: beta },
        ],
      },
    ]);
  });

  it("leaves a reference the check skipped as alert context across two runs bare", () => {
    const recent = [
      {
        headline: [
          { kind: "text", text: "fixed the Dependabot alert " },
          { kind: "strong", text: "#583" },
          { kind: "text", text: " beside #2687." },
        ],
      },
    ];

    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: { recent } })["recent"]).toEqual([
      {
        headline: [
          { kind: "text", text: "fixed the Dependabot alert " },
          { kind: "strong", text: "#583" },
          { kind: "text", text: " beside acme/widget#2687." },
        ],
      },
    ]);
  });
});

describe("qualifyBareRefsInNarrative — identity is the fenced reference, never the text", () => {
  it("never qualifies a bare reference inside an auto-linked URL in place of the one the check resolved", () => {
    // The writer finds only the URL's reference (the other follows "alert"), and the check never reads inside a link,
    // so no fence is credited and the URL is left byte for byte.
    const recent = [note({ text: "https://example.com/?q=#123 https://example.com/alert #123" })];

    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: { recent } })["recent"]).toEqual(recent);
  });

  it("still qualifies the reference beside an auto-linked URL carrying a reference of its own", () => {
    // A counterexample: a fence on the URL's reference was claimed to change the link and leave the next reference bare.
    const recent = [note({ text: "https://example.com/?q=#123 then #124" })];
    const qualified = qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: { recent } });

    expect(qualified["recent"]).toEqual([note({ text: "https://example.com/?q=#123 then acme/widget#124" })]);
    expect(
      checkBareRefs({ html: pageWithSecondRepo({ notes: qualified["recent"] as readonly unknown[] }) }).defects,
    ).toEqual([]);
  });

  it("never qualifies a skipped alert number in place of a same-text reference the check resolved across two runs", () => {
    const recent = [
      {
        headline: [
          { kind: "text", text: "Dependabot alert " },
          { kind: "strong", text: "#583" },
          { kind: "text", text: " #" },
          { kind: "text", text: "583" },
        ],
      },
    ];

    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: { recent } })["recent"]).toEqual(recent);
  });

  it("reads each note alone, so an alert word ending the note before never hides the next note's reference", () => {
    const recent = [note({ text: "Dependabot alert" }), note({ text: "#583 fixed." })];

    // Once the first note is archived the check reads the reference ahead of "fixed." as bare, so the writer qualifies it now.
    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: { recent } })["recent"]).toEqual([
      note({ text: "Dependabot alert" }),
      note({ text: "acme/widget#583 fixed." }),
    ]);
  });

  it("leaves a note carrying a private-use scan character of its own untouched", () => {
    const recent = [note({ text: "Rebased #2687 " })];

    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: { recent } })["recent"]).toEqual(recent);
  });
});

describe("qualifyBareRefsInNarrative — what it never touches", () => {
  it("leaves a qualified reference, an alert number, code, a link label and a draft byte for byte", () => {
    const recent = [
      {
        detail: {
          blocks: [
            { kind: "draft", surface: "slack-as-me", text: "see #2681" },
            { kind: "paste", label: "the ref", text: "#2682" },
          ],
          summary: "readings",
        },
        headline: [
          { kind: "text", text: "Landed acme/widget#2687, fixed Dependabot alert #583, ran " },
          { kind: "code", text: "#2688" },
          { kind: "link", text: "#2686 the fix", url: "https://github.com/acme/widget/pull/2686" },
        ],
      },
    ];

    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: { recent } })["recent"]).toEqual(recent);
  });

  it("leaves a quoted note's fold verbatim while qualifying its headline", () => {
    const quoted = {
      blocks: [{ content: [{ kind: "text", text: "they said #2681" }], kind: "para" }],
      summary: "their words #2682",
    };
    const form = { recent: [{ detail: quoted, headline: [{ kind: "text", text: "On #2687:" }], lane: "quoted" }] };

    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form })["recent"]).toEqual([
      { detail: quoted, headline: [{ kind: "text", text: "On acme/widget#2687:" }], lane: "quoted" },
    ]);
  });

  it("leaves a reference no single repository resolves, and one too large to be the repository's own", () => {
    const recent = [note({ text: "Rebased #2687 and reviewed #19343." })];

    expect(qualifyBareRefsInNarrative({ context: { repos: [] }, form: { recent } })["recent"]).toEqual(recent);
    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: { recent } })["recent"]).toEqual([
      note({ text: "Rebased acme/widget#2687 and reviewed #19343." }),
    ]);
  });

  it("never mutates the form it was given, and a second pass changes nothing", () => {
    const form = { recent: [note({ text: "Rebased #2687." })] };
    const once = qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form });

    expect(form).toEqual({ recent: [note({ text: "Rebased #2687." })] });
    expect(qualifyBareRefsInNarrative({ context: WIDGET_CONTEXT, form: once })).toEqual(once);
  });
});
