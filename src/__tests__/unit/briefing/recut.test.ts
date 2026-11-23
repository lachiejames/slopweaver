/**
 * `recut`'s walk: which strings of a form are authored prose, and which are bytes that must survive
 * untouched. Every "skipped" case here is a real corruption the Python script it replaces produced on the
 * same input — a URL, a shell command, a paste block and a colleague's pull-request title.
 */
import { describe, expect, it } from "vitest";

import { recutForm } from "../../../briefing/recut.js";

/** The form all of these cases walk: one string of each kind, each carrying a fleet word. */
const FORM: Readonly<Record<string, unknown>> = {
  alignment: {
    headline: [{ kind: "text", text: "Every board row is ranked." }],
    intake: [{ kind: "text", text: "6 owner turns have no finding row." }],
  },
  awaiting: [{ waitingOn: [{ kind: "text", text: "the reaper" }] }],
  earlierToday: {
    notes: [
      {
        detail: {
          blocks: [
            { content: [{ kind: "code", text: "grep reaper the-sweep.log" }], kind: "para" },
            { kind: "paste", text: "slopweaver handover reaper --row 12" },
            {
              content: [{ kind: "link", text: "the reaper log", url: "https://example.test/reaper/sweep" }],
              kind: "para",
            },
          ],
          summary: "this tick's own notes",
        },
        headline: [{ kind: "text", text: "Each tick ran the reapers." }],
      },
    ],
    summary: "earlier today",
  },
  header: { lede: [{ kind: "text", text: "This tick landed gold." }], workspace: "workspace:55" },
  reactNow: {
    meFacing: [
      {
        options: [{ letter: "A", text: "Close the planned row." }],
        question: "The reaper closed it: is that right?",
        subject: { text: "acme-admin#604 the reaper row", url: "https://example.test/pull/604" },
        what: [{ kind: "text", text: "The fill spawned it." }],
      },
    ],
    openArtifacts: [{ ask: [{ kind: "text", text: "the settled ask" }] }],
    teamFacing: [],
  },
  yourList: { rows: [{ headline: [{ kind: "text", text: "one finding row" }] }] },
};

const RECUT = recutForm({ form: FORM });

/** The recut form, as a record. */
const FORM_OUT = RECUT.form as Readonly<Record<string, unknown>>;

/** One JSON path's string value out of the recut form. */
function at({ path }: { path: string }): unknown {
  return path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], FORM_OUT);
}

describe("recutForm", () => {
  it("rewrites a lede's prose", () => {
    expect(at({ path: "header.lede.0.text" })).toBe("This pass landed the strongest proof available.");
  });

  it("rewrites a note headline and a fold summary", () => {
    expect(at({ path: "earlierToday.notes.0.headline.0.text" })).toBe("Each pass ran the run closers.");
    expect(at({ path: "earlierToday.notes.0.detail.summary" })).toBe("this pass's own notes");
  });

  it("rewrites a card's question, its `what` and an option's text", () => {
    expect(at({ path: "reactNow.meFacing.0.question" })).toBe("The run closer closed it: is that right?");
    expect(at({ path: "reactNow.meFacing.0.what.0.text" })).toBe("The idle-work scan spawned it.");
    expect(at({ path: "reactNow.meFacing.0.options.0.text" })).toBe("Close the planned entry.");
  });

  it("rewrites a link's label and leaves its URL exactly as it was", () => {
    expect(at({ path: "earlierToday.notes.0.detail.blocks.2.content.0.text" })).toBe("the run closer log");
    expect(at({ path: "earlierToday.notes.0.detail.blocks.2.content.0.url" })).toBe(
      "https://example.test/reaper/sweep",
    );
  });

  it("leaves a code run alone, because it is a command they run", () => {
    expect(at({ path: "earlierToday.notes.0.detail.blocks.0.content.0.text" })).toBe("grep reaper the-sweep.log");
  });

  it("leaves a paste block alone, because it is bytes they copy", () => {
    expect(at({ path: "earlierToday.notes.0.detail.blocks.1.text" })).toBe("slopweaver handover reaper --row 12");
  });

  it("leaves the alignment line alone, because it is the reconciliation's own sentence", () => {
    expect(at({ path: "alignment.headline.0.text" })).toBe("Every board row is ranked.");
    expect(at({ path: "alignment.intake.0.text" })).toBe("6 owner turns have no finding row.");
  });

  it("leaves a card's subject alone, because the title is somebody else's words", () => {
    expect(at({ path: "reactNow.meFacing.0.subject.text" })).toBe("acme-admin#604 the reaper row");
  });

  it("leaves the two projected sections alone", () => {
    expect(at({ path: "yourList.rows.0.headline.0.text" })).toBe("one finding row");
    expect(at({ path: "reactNow.openArtifacts.0.ask.0.text" })).toBe("the settled ask");
  });

  it("counts every substitution by term, and none inside a skipped string", () => {
    // reaper: the question, the headline's `reapers`, the link label — never the URL, code, paste or subject.
    // tick: the lede, the headline, the fold summary.
    expect(RECUT.counts).toEqual({ fill: 1, gold: 1, reaper: 3, row: 1, tick: 3 });
  });

  it("reports a fleet word it has no substitution for, with the path it sits at", () => {
    const result = recutForm({
      form: { header: { lede: [{ kind: "text", text: "The touch-seam session is open." }] } },
    });

    expect(result.leftovers).toEqual([{ path: "header.lede.0.text", term: "seam", used: "touch-seam" }]);
  });

  it("does not see a fleet phrase split across two runs — the stated blind spot the render gate covers", () => {
    const split = {
      header: {
        lede: [
          { kind: "text", text: "this " },
          { kind: "strong", text: "tick" },
        ],
      },
    };
    const result = recutForm({ form: split });

    expect(result.form).toEqual(split);
    expect(result.counts).toEqual({});
    expect(result.leftovers).toEqual([]);
  });

  it("is idempotent: recutting a recut form changes nothing further", () => {
    const twice = recutForm({ form: RECUT.form });

    expect(twice.counts).toEqual({});
    expect(twice.form).toEqual(RECUT.form);
  });
});
