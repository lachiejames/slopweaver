/**
 * One sweep's edit to the form: the header taken over whole, the cards a ruling closed dropped, the alignment
 * line set, the block added and the window rolled — and every refusal that leaves the form untouched.
 */
import { describe, expect, it } from "vitest";

import { SECTION_MAX_NOTES } from "../../../briefing/caps.js";
import { briefingErrorLines } from "../../../briefing/errors.js";
import { applySweepBlock, type SweepBlockInput } from "../../../briefing/sweepBlock.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** A complete invocation; each case overrides the one part it is about. */
function input({ over = {} }: { over?: Partial<SweepBlockInput> } = {}): SweepBlockInput {
  return {
    alignment: { details: [], headline: "4 of 40 sessions are on the top 5.", intake: undefined, summary: undefined },
    dropCardPrefixes: [],
    earlierSummary: undefined,
    header: {
      handoff: "handoff-9250",
      lede: undefined,
      model: "fable",
      pinnedAt: "2026-09-13T00:11:07Z",
      sleeping: false,
      workspace: "workspace:60",
    },
    keepRecent: 4,
    recent: { foldSummary: "the gauges", folds: ["It ran. It passed."], sentences: ["The strong.", "The rest."] },
    ...over,
  };
}

/** A note whose headline names it, so order is checkable. */
function note({ name }: { name: string }): Record<string, unknown> {
  return { headline: [{ kind: "text", text: name }] };
}

/** A form carrying `recent` blocks and `notes` earlier-today notes, all named. */
function form({ recent, notes }: { recent: readonly string[]; notes: readonly string[] }): Record<string, unknown> {
  return {
    alignment: { detail: { blocks: [], summary: "the reconcile line" }, headline: [], intake: [] },
    earlierToday: { notes: notes.map((name) => note({ name })), summary: "earlier today" },
    header: {
      handoff: "handoff-9249",
      lede: [{ kind: "text", text: "the old lede" }],
      model: "fable",
      pinnedAt: "2026-09-12T19:43:07Z",
      sleeping: true,
      workspace: "workspace:55",
    },
    reactNow: { meFacing: [], teamFacing: [] },
    recent: recent.map((name) => note({ name })),
  };
}

/** The headline text of each note in one array. */
function names({ notes }: { notes: readonly unknown[] }): readonly string[] {
  return notes.map((entry) => {
    const runs = (entry as { headline: readonly { text: string }[] }).headline;
    return runs.map((run) => run.text).join("");
  });
}

describe("applySweepBlock", () => {
  it("takes the header over whole and keeps the lede when none is given", () => {
    const outcome = unwrap(applySweepBlock({ form: form({ notes: [], recent: [] }), input: input() }));
    const header = outcome.form["header"] as Record<string, unknown>;

    expect(header["workspace"]).toBe("workspace:60");
    expect(header["handoff"]).toBe("handoff-9250");
    expect(header["model"]).toBe("fable");
    expect(header["pinnedAt"]).toBe("2026-09-13T00:11:07Z");
    expect(header["sleeping"]).toBe(false);
    expect(header["lede"]).toEqual([{ kind: "text", text: "the old lede" }]);
  });

  it("replaces the lede when one is given", () => {
    const outcome = unwrap(
      applySweepBlock({
        form: form({ notes: [], recent: [] }),
        input: input({ over: { header: { ...input().header, lede: "a new lede." } } }),
      }),
    );
    const header = outcome.form["header"] as Record<string, unknown>;

    expect(header["lede"]).toEqual([{ kind: "text", text: "a new lede." }]);
  });

  it("refuses a header carrying a key a sweep does not set", () => {
    const stamped = form({ notes: [], recent: [] });
    stamped["header"] = { ...(stamped["header"] as Record<string, unknown>), readyIso: "2026-09-13T00:00:00Z" };

    expect(briefingErrorLines({ error: unwrapErr(applySweepBlock({ form: stamped, input: input() })) })[0]).toContain(
      "`readyIso`",
    );
  });

  it("builds the block's headline as the bold first sentence then each other one, a space before each", () => {
    const outcome = unwrap(applySweepBlock({ form: form({ notes: [], recent: [] }), input: input() }));
    const recent = outcome.form["recent"] as readonly Record<string, unknown>[];

    expect(recent[0]!["headline"]).toEqual([
      { kind: "strong", text: "The strong." },
      { kind: "text", text: " The rest." },
    ]);
  });

  it("turns each fold argument into one list of its own sentences", () => {
    const outcome = unwrap(applySweepBlock({ form: form({ notes: [], recent: [] }), input: input() }));
    const recent = outcome.form["recent"] as readonly { detail: { blocks: readonly unknown[]; summary: string } }[];

    expect(recent[0]!.detail.summary).toBe("the gauges");
    expect(recent[0]!.detail.blocks).toEqual([
      {
        items: [[{ kind: "text", text: "It ran." }], [{ kind: "text", text: "It passed." }]],
        kind: "list",
        ordered: false,
      },
    ]);
  });

  it("puts the new block first and rolls what leaves the window to the front of earlierToday", () => {
    const outcome = unwrap(
      applySweepBlock({ form: form({ notes: ["n1"], recent: ["r4", "r3", "r2", "r1"] }), input: input() }),
    );
    const earlier = outcome.form["earlierToday"] as { notes: readonly unknown[] };

    expect(names({ notes: outcome.form["recent"] as readonly unknown[] })).toEqual([
      "The strong. The rest.",
      "r4",
      "r3",
      "r2",
    ]);
    expect(names({ notes: earlier.notes })).toEqual(["r1", "n1"]);
    expect(outcome.rolled).toBe(1);
  });

  it("rolls EVERY block past the window, in order, when the form starts over it", () => {
    const outcome = unwrap(
      applySweepBlock({ form: form({ notes: ["n1"], recent: ["r5", "r4", "r3", "r2", "r1"] }), input: input() }),
    );
    const earlier = outcome.form["earlierToday"] as { notes: readonly unknown[] };

    expect(outcome.rolled).toBe(2);
    expect(names({ notes: earlier.notes })).toEqual(["r2", "r1", "n1"]);
  });

  it("refuses rather than deleting a note when the roll would put earlierToday over its cap", () => {
    const notes = Array.from({ length: SECTION_MAX_NOTES }, (_entry, index) => `n${String(index)}`);
    const refusal = briefingErrorLines({
      error: unwrapErr(applySweepBlock({ form: form({ notes, recent: ["r4", "r3", "r2", "r1"] }), input: input() })),
    });

    expect(refusal[0]).toContain(`over the cap of ${String(SECTION_MAX_NOTES)}`);
    expect(refusal[0]).toContain(`archive --form <path> --keep-notes ${String(SECTION_MAX_NOTES - 1)}`);
  });

  it("reserves a slot per rolled block in the remedy it names", () => {
    const notes = Array.from({ length: SECTION_MAX_NOTES }, (_entry, index) => `n${String(index)}`);
    const refusal = briefingErrorLines({
      error: unwrapErr(
        applySweepBlock({ form: form({ notes, recent: ["r5", "r4", "r3", "r2", "r1"] }), input: input() }),
      ),
    });

    expect(refusal[0]).toContain(`--keep-notes ${String(SECTION_MAX_NOTES - 2)}`);
  });

  it("refuses to create earlierToday without a summary, and creates it with one", () => {
    const without = form({ notes: [], recent: ["r4", "r3", "r2", "r1"] });
    delete without["earlierToday"];

    expect(briefingErrorLines({ error: unwrapErr(applySweepBlock({ form: without, input: input() })) })[0]).toContain(
      "--earlier-summary",
    );

    const outcome = unwrap(
      applySweepBlock({ form: without, input: input({ over: { earlierSummary: "earlier today" } }) }),
    );

    expect(outcome.form["earlierToday"]).toEqual({ notes: [note({ name: "r1" })], summary: "earlier today" });
  });

  it("refuses a second run of the same block, so a retry cannot double it", () => {
    const first = unwrap(applySweepBlock({ form: form({ notes: [], recent: [] }), input: input() }));

    expect(
      briefingErrorLines({ error: unwrapErr(applySweepBlock({ form: first.form, input: input() })) })[0],
    ).toContain("already applied");
  });

  it("drops exactly the me-facing card each prefix names, keeping the others and the team-facing ones", () => {
    const base = form({ notes: [], recent: [] });
    base["reactNow"] = {
      meFacing: [{ question: "The Fable week reads 99%: hold?" }, { question: "Ship the verbs: yes?" }],
      teamFacing: [{ question: "A team card" }],
    };
    const outcome = unwrap(
      applySweepBlock({ form: base, input: input({ over: { dropCardPrefixes: ["The Fable week"] } }) }),
    );
    const reactNow = outcome.form["reactNow"] as {
      meFacing: readonly { question: string }[];
      teamFacing: readonly unknown[];
    };

    expect(outcome.droppedQuestions).toEqual(["The Fable week reads 99%: hold?"]);
    expect(reactNow.meFacing.map((card) => card.question)).toEqual(["Ship the verbs: yes?"]);
    expect(reactNow.teamFacing).toEqual([{ question: "A team card" }]);
  });

  it("refuses a prefix that matches no card, and one that matches two", () => {
    const base = form({ notes: [], recent: [] });
    base["reactNow"] = { meFacing: [{ question: "Ship it: A?" }, { question: "Ship it: B?" }], teamFacing: [] };

    expect(
      briefingErrorLines({
        error: unwrapErr(applySweepBlock({ form: base, input: input({ over: { dropCardPrefixes: ["Nothing"] } }) })),
      })[0],
    ).toContain("matches 0 me-facing cards");
    expect(
      briefingErrorLines({
        error: unwrapErr(applySweepBlock({ form: base, input: input({ over: { dropCardPrefixes: ["Ship it"] } }) })),
      })[0],
    ).toContain("matches 2 me-facing cards");
  });

  it("refuses two prefixes that name the same card", () => {
    const base = form({ notes: [], recent: [] });
    base["reactNow"] = { meFacing: [{ question: "Ship the verbs: yes?" }], teamFacing: [] };
    const refusal = briefingErrorLines({
      error: unwrapErr(
        applySweepBlock({ form: base, input: input({ over: { dropCardPrefixes: ["Ship the", "Ship"] } }) }),
      ),
    });

    expect(refusal[0]).toContain("both match the same card");
  });

  it("sets the alignment headline and folds the detail under the summary it keeps", () => {
    const outcome = unwrap(
      applySweepBlock({
        form: form({ notes: [], recent: [] }),
        input: input({
          over: {
            alignment: {
              details: ["Two sessions sit elsewhere."],
              headline: "4 of 40 sessions are on the top 5.",
              intake: "6 owner turns have no entry.",
              summary: undefined,
            },
          },
        }),
      }),
    );
    const alignment = outcome.form["alignment"] as {
      detail: { blocks: readonly unknown[]; summary: string };
      headline: readonly unknown[];
      intake: readonly unknown[];
    };

    expect(alignment.headline).toEqual([{ kind: "text", text: "4 of 40 sessions are on the top 5." }]);
    expect(alignment.intake).toEqual([{ kind: "text", text: "6 owner turns have no entry." }]);
    expect(alignment.detail.summary).toBe("the reconcile line");
    expect(alignment.detail.blocks).toEqual([
      {
        items: [
          [{ kind: "text", text: "4 of 40 sessions are on the top 5." }],
          [{ kind: "text", text: "Two sessions sit elsewhere." }],
        ],
        kind: "list",
        ordered: false,
      },
    ]);
  });

  it("folds the detail under the summary this sweep names, over the one the form already carries", () => {
    const alignment = { details: [], headline: "4 of 40.", intake: undefined, summary: "the named line" };
    const outcome = unwrap(
      applySweepBlock({ form: form({ notes: [], recent: [] }), input: input({ over: { alignment } }) }),
    );

    expect((outcome.form["alignment"] as { detail: { summary: string } }).detail.summary).toBe("the named line");
  });

  it("refuses to invent an alignment fold summary when the form has none", () => {
    const base = form({ notes: [], recent: [] });
    base["alignment"] = { headline: [], intake: [] };

    expect(briefingErrorLines({ error: unwrapErr(applySweepBlock({ form: base, input: input() })) })[0]).toContain(
      "--alignment-summary",
    );
  });

  it("reports every refusal of one invocation at once", () => {
    const base = form({ notes: [], recent: [] });
    base["alignment"] = { headline: [], intake: [] };
    base["header"] = { ...(base["header"] as Record<string, unknown>), stray: 1 };

    expect(briefingErrorLines({ error: unwrapErr(applySweepBlock({ form: base, input: input() })) }).length).toBe(2);
  });

  it("refuses a form that is not an object", () => {
    expect(briefingErrorLines({ error: unwrapErr(applySweepBlock({ form: "a string", input: input() })) })).toEqual([
      "the form is not a JSON object",
    ]);
  });

  it("admits a headline of exactly the cap", () => {
    const base = form({ notes: [], recent: [] });
    const recent = { foldSummary: "the gauges", folds: ["It ran."], sentences: ["One.", "Two.", "Three.", "Four."] };

    expect(unwrap(applySweepBlock({ form: base, input: input({ over: { recent } }) })).recentCount).toBe(1);
  });

  it("refuses a fifth sentence itself, for a caller that skipped the parse-time check", () => {
    const base = form({ notes: [], recent: [] });
    const recent = { foldSummary: "the gauges", folds: ["It ran."], sentences: ["A.", "B.", "C.", "D.", "E."] };

    expect(
      briefingErrorLines({ error: unwrapErr(applySweepBlock({ form: base, input: input({ over: { recent } }) })) }),
    ).toEqual([
      "recent.sentences: has 5 sentences; at most 4 are allowed — keep the ones the owner has to read to decide, and move " +
        "the rest into a fold",
    ]);
  });

  it("reports a headline defect BESIDE a core failure rather than instead of it", () => {
    const base = form({ notes: [], recent: [] });
    const recent = { foldSummary: "the gauges", folds: ["It ran."], sentences: ["One. Two."] };
    const errors = briefingErrorLines({
      error: unwrapErr(
        applySweepBlock({ form: base, input: input({ over: { dropCardPrefixes: ["Nothing"], recent } }) }),
      ),
    });

    expect(errors.length).toBe(2);
    expect(errors[0]).toContain("recent.sentences: sentence 1 must be exactly one sentence");
    expect(errors[1]).toContain("Nothing");
  });
});
