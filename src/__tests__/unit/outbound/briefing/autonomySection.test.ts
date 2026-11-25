import { describe, expect, it } from "vitest";

import { briefingRefused, checkBriefing } from "../../../../briefing/check.js";
import { pageAboveFoldWords } from "../../../../outbound/briefing/pageAboveFold.js";
import { renderBriefing } from "../../../../outbound/briefing/render.js";
import { briefingFormSchema } from "../../../../outbound/briefing/schema.js";
import type { BriefingAutonomyRow, BriefingForm } from "../../../../outbound/briefing/types.js";

/** The instant the gate judges this page's freshness against — the same one the form stamps. */
const NOW = "2026-09-12T02:55:00.000Z";

/** One projected act, in the shape `../../../briefing/autonomy.ts` produces. */
function row({
  actionId = "16644-enqueue",
  kindLabel = "press merge when ready",
  subject = "https://github.com/acme/acme-admin/pull/16644",
  subjectLabel = "acme/acme-admin#16644",
  doneIso = "2026-09-12T02:06:09Z",
  sessionLabel = "workspace:123",
  bySession = "workspace:123 act-on-open-acme-admin-prs (fd64a339)",
  why = "CI green, mergeable, and no code-owner request outstanding",
  said = "I merged your pull request on the admin app — every check had passed and nobody was waiting to review it.",
  witness = "slopweaver github enqueue --pr 16644 -> queued at position 1",
  steer,
  run,
}: Partial<BriefingAutonomyRow> = {}): BriefingAutonomyRow {
  const base: BriefingAutonomyRow = {
    actionId,
    bySession,
    doneIso,
    kindLabel,
    said,
    sessionLabel,
    subject,
    subjectLabel,
    why,
    witness,
  };
  const withRun = run === undefined ? base : { ...base, run };
  return steer === undefined ? withRun : { ...withRun, steer };
}

/** A complete, valid form carrying the given acts. */
function formWith({ rows, notShown = 0 }: { rows: readonly BriefingAutonomyRow[]; notShown?: number }): unknown {
  return {
    alignment: {
      headline: [{ kind: "text", text: "The fleet is building the autonomy ledger." }],
      intake: [{ kind: "text", text: "Every turn the owner typed is held by an entry on the handover board." }],
    },
    autonomy: { notShown, rows },
    awaiting: [],
    header: {
      handoff: "handoff-9240",
      lede: [{ kind: "text", text: "Nothing needs your word right now." }],
      model: "Opus 5",
      pinnedAt: "12 Sep 11:40",
      readyIso: "2026-09-12T02:55:00.000Z",
      refreshedIso: "2026-09-12T02:55:00.000Z",
      sleeping: false,
      workspace: "workspace:126",
    },
    history: [],
    reactNow: { meFacing: [], teamFacing: [] },
    recent: [],
  };
}

/** Parse a form the schema should accept, or throw with the issues it refused it for. */
function parse({ form }: { form: unknown }): BriefingForm {
  const parsed = briefingFormSchema.safeParse(form);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
  }
  return parsed.data;
}

/** Every refusal message the schema gave for a form, joined. */
function refusals({ form }: { form: unknown }): string {
  const parsed = briefingFormSchema.safeParse(form);
  return parsed.success ? "" : parsed.error.issues.map((issue) => issue.message).join("\n");
}

describe("the section on the page", () => {
  const html = renderBriefing({
    form: parse({
      form: formWith({
        notShown: 3,
        rows: [
          row({ actionId: "a-new", doneIso: "2026-09-12T02:18:27Z", kindLabel: "bump stale review ask" }),
          row({ actionId: "a-old", steer: "yep, exactly right" }),
        ],
      }),
    }),
  });

  it("renders its own heading, below react-now and above what landed", () => {
    expect(html.indexOf('id="react-now"')).toBeLessThan(html.indexOf('id="autonomy-ledger"'));
    expect(html.indexOf('id="autonomy-ledger"')).toBeLessThan(html.indexOf('id="recent"'));
  });

  it("states the contract the renderer owns, not a composer's wording", () => {
    expect(html).toContain("tell me if you would have wanted it differently");
  });

  it("puts each act's headline OUTSIDE its fold, so the budget can see it", () => {
    const head = html.slice(html.indexOf('<div class="act">'), html.indexOf("<details><summary>why"));
    expect(head).toContain("bump stale review ask");
    expect(head).toContain("acme/acme-admin#16644");
  });

  it("links the subject rather than printing a bare reference", () => {
    expect(html).toContain('<a href="https://github.com/acme/acme-admin/pull/16644">acme/acme-admin#16644</a>');
  });

  it("renders a subject that is not a URL as code, never as a link that scrolls nowhere", () => {
    const board = renderBriefing({
      form: parse({
        form: formWith({ rows: [row({ subject: "a-board-row-slug", subjectLabel: "a-board-row-slug" })] }),
      }),
    });
    expect(board).toContain("<code>a-board-row-slug</code>");
    expect(board).not.toContain('href="a-board-row-slug"');
  });

  it("carries the full non-URL reference inside the fold", () => {
    const state = renderBriefing({
      form: parse({
        form: formWith({ rows: [row({ subject: "state:ledgers/notes.txt", subjectLabel: "notes.txt" })] }),
      }),
    });
    expect(state).toContain("<strong>On:</strong> <code>state:ledgers/notes.txt</code>");
  });

  it("stamps the instant in the owner's own zone", () => {
    expect(html).toContain("2026-09-12 12:18:27 AEST");
  });

  it("folds the why, the witness and the full session name", () => {
    const fold = html.slice(html.indexOf("<details><summary>what happened"), html.indexOf("</details></div>"));
    expect(fold).toContain("CI green, mergeable, and no code-owner request outstanding");
    expect(fold).toContain("<code>slopweaver github enqueue --pr 16644 -&gt; queued at position 1</code>");
    expect(fold).toContain("workspace:123 act-on-open-acme-admin-prs (fd64a339) · act a-new");
  });

  it("opens the fold on the plain-words line, ahead of the fleet's own note", () => {
    const fold = html.slice(html.indexOf("<details><summary>what happened"), html.indexOf("</details></div>"));
    expect(fold.indexOf("I merged your pull request on the admin app")).toBeLessThan(
      fold.indexOf("<strong>Why:</strong>"),
    );
    expect(fold).toContain(
      '<p class="said">I merged your pull request on the admin app — every check had passed and nobody was waiting to review it.</p>',
    );
  });

  it("draws no plain-words paragraph at all on a row recorded before that field existed", () => {
    const olderHtml = renderBriefing({
      form: parse({ form: formWith({ rows: [{ ...row(), said: undefined }] }) }),
    });
    expect(olderHtml).not.toContain('<p class="said">');
    expect(olderHtml).toContain("<strong>Why:</strong> CI green, mergeable, and no code-owner request outstanding");
  });

  it("marks an act the owner has already steered, and carries the owner's words in the fold", () => {
    expect(html).toContain("you have steered this");
    expect(html).toContain("<strong>Your steer:</strong> yep, exactly right");
  });

  it("says how many earlier acts it is not showing", () => {
    expect(html).toContain("3 earlier act(s) not shown");
  });

  it("uses its own row class, never one the page budget counts", () => {
    const section = html.slice(html.indexOf('id="autonomy-ledger"'));
    expect(section).toContain('<div class="act">');
    expect(section).not.toContain('<div class="need"');
    expect(section).not.toContain('<p class="ranked"');
  });

  it("passes the shipped gate end to end", () => {
    const result = checkBriefing({
      applyBareRefs: true,
      applyFraming: true,
      applyVoice: true,
      html,
      nowIso: NOW,
      rules: [],
    });
    expect(briefingRefused({ result })).toBe(false);
    expect(result.autonomy.rowsChecked).toBe(2);
  });
});

describe("a why or steer quoting a raw pull-request URL", () => {
  // An act's why quoted the owner's steer, URL included; escaped as inert text, that URL
  // refused the whole page with `bare reference (page)`.
  const url = "https://github.com/acme/acme-admin/pull/16355";
  const html = renderBriefing({
    form: parse({
      form: formWith({
        rows: [
          row({
            actionId: "16355-close",
            steer: `fine, ${url} was stale`,
            subject: url,
            subjectLabel: "acme/acme-admin#16355",
            why: `The owner's call: 'the Acme rewrite replaces ${url} anyway, happy to close it for now'`,
          }),
        ],
      }),
    }),
  });
  const result = checkBriefing({
    applyBareRefs: true,
    applyFraming: true,
    applyVoice: true,
    html,
    nowIso: NOW,
    rules: [],
  });

  it("renders the URL in the why as a link, its visible text unchanged", () => {
    expect(html).toContain(
      `<strong>Why:</strong> The owner's call: 'the Acme rewrite replaces <a class="raw" href="${url}">${url}</a> anyway`,
    );
  });

  it("renders the URL in the owner's steer as a link", () => {
    expect(html).toContain(`<strong>Your steer:</strong> fine, <a class="raw" href="${url}">${url}</a> was stale`);
  });

  it("passes the shipped gate with no bare-reference defect", () => {
    expect(result.bareRefs.defects).toEqual([]);
    expect(briefingRefused({ result })).toBe(false);
  });
});

describe("an empty section", () => {
  const html = renderBriefing({ form: parse({ form: formWith({ rows: [] }) }) });

  it("renders no heading at all, rather than one with nothing under it", () => {
    expect(html).not.toContain('id="autonomy-ledger"');
  });

  it("still passes the gate, and the summary says it cannot tell empty from unasked-for", () => {
    const result = checkBriefing({
      applyBareRefs: true,
      applyFraming: true,
      applyVoice: true,
      html,
      nowIso: NOW,
      rules: [],
    });
    expect(briefingRefused({ result })).toBe(false);
    expect(result.autonomy.rowsChecked).toBe(0);
  });

  it("is what a form written before the field existed gets", () => {
    const legacy = formWith({ rows: [] }) as Record<string, unknown>;
    delete legacy["autonomy"];
    expect(parse({ form: legacy }).autonomy.rows.length).toBe(0);
  });
});

describe("what the schema refuses", () => {
  it("acts that are not newest first", () => {
    const form = formWith({
      rows: [
        row({ actionId: "a-old", doneIso: "2026-09-12T02:06:09Z" }),
        row({ actionId: "a-new", doneIso: "2026-09-12T02:18:27Z" }),
      ],
    });
    expect(refusals({ form })).toContain("not newest first");
  });

  it("two rows claiming one act id", () => {
    const form = formWith({ rows: [row({ actionId: "a-one" }), row({ actionId: "a-one" })] });
    expect(refusals({ form })).toContain("same act id");
  });

  it("more rows than the page shows", () => {
    const rows = Array.from({ length: 11 }, (_unused, index) => row({ actionId: `a-${String(index)}` }));
    expect(refusals({ form: formWith({ rows }) })).toContain("at most");
  });

  it("a subject that is not a checkable id", () => {
    expect(refusals({ form: formWith({ rows: [row({ subject: "acme-admin#16644" })] }) })).not.toBe("");
    expect(refusals({ form: formWith({ rows: [row({ subject: "23 workspaces parked 10h" })] }) })).not.toBe("");
    expect(refusals({ form: formWith({ rows: [row({ subject: "javascript:alert(1)" })] }) })).not.toBe("");
  });

  it("NOTHING about a board row slug or a state reference, which are checkable ids", () => {
    expect(refusals({ form: formWith({ rows: [row({ subject: "a-board-row-slug" })] }) })).toBe("");
    expect(refusals({ form: formWith({ rows: [row({ subject: "state:ledgers/notes.txt" })] }) })).toBe("");
  });

  it("a notShown count below zero", () => {
    expect(refusals({ form: formWith({ notShown: -1, rows: [row()] }) })).not.toBe("");
  });

  it("NOTHING about the length of a folded why", () => {
    const form = formWith({ rows: [row({ why: "x".repeat(3000) })] });
    expect(refusals({ form })).toBe("");
  });
});

describe("the page word budget", () => {
  // Six: four words of the kind label, one for the subject label and one for the session label — exactly
  // what a reader meets on the line, and what `../../../../briefing/pageBudget.ts` counts off the bytes.
  it("charges the section's visible lines, because they sit outside react-now", () => {
    const empty = pageAboveFoldWords({ form: parse({ form: formWith({ rows: [] }) }) });
    const filled = pageAboveFoldWords({ form: parse({ form: formWith({ rows: [row()] }) }) });
    expect(filled - empty).toBe(6);
  });

  it("does not charge the folded why, witness or steer", () => {
    const short = pageAboveFoldWords({ form: parse({ form: formWith({ rows: [row()] }) }) });
    const long = pageAboveFoldWords({
      form: parse({
        form: formWith({ rows: [row({ steer: "a b c d e", why: "x ".repeat(400), witness: "y ".repeat(400) })] }),
      }),
    });
    expect(long).toBe(short);
  });
});
