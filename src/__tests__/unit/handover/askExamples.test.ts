/**
 * The concrete-example shape every open ask carries : what refuses a scene, what a
 * read makes of a record, and the front-matter edit that writes one — read back through the real doc parser.
 */
import { describe, expect, it } from "vitest";

import {
  askExampleFrontMatter,
  askExampleProblems,
  askExampleSetOf,
  sameAskExampleSet,
} from "../../../handover/askExamples.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { editFrontMatterFields } from "../../../handover/frontmatter.js";
import { unwrap } from "../../../lib/result.js";

const SCENE =
  "You are in a meeting when the fleet, mid-way through a Datadog investigation, hits an error that blocks two of " +
  "its tools, so it opens a fix PR and self-merges it. Was that the right call?";

/** A scene told FROM OUTSIDE and closing on no question — two sentences, so only those two rules fire. */
const OUTSIDE = "The fleet hit a Datadog error and merged its own fix. It was fine.";

describe("askExampleProblems", () => {
  it("accepts one second-person scene ending on its question", () => {
    expect(askExampleProblems({ examples: [SCENE], gap: undefined })).toEqual([]);
  });

  it("accepts a one-line gap in place of a scene", () => {
    expect(askExampleProblems({ examples: [], gap: "The row names no event a scene could be built from." })).toEqual(
      [],
    );
  });

  it("refuses an ask carrying neither, naming both flags", () => {
    const problems = askExampleProblems({ examples: [], gap: undefined });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("--example-gap");
  });

  it("refuses both at once", () => {
    const problems = askExampleProblems({ examples: [SCENE], gap: "no scene" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("both passed");
  });

  it("refuses a scene told from outside, and one that does not end on a question", () => {
    const problems = askExampleProblems({ examples: [OUTSIDE], gap: undefined });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("never addresses the owner");
    expect(problems[1]).toContain("does not end on the question");
  });

  // `You?` carried every mark of a scene and pictured nothing.
  it("refuses a bare question with no scene ahead of it", () => {
    expect(askExampleProblems({ examples: ["You?"], gap: undefined })).toEqual([
      "example 1 is only a question — open it with the scene the owner is placed in, then ask",
    ]);
  });

  // A trailing "?" on its own is not a question.
  it("refuses a scene that closes on a bare question mark", () => {
    expect(askExampleProblems({ examples: ["You open the card and see the fleet merged. ?"], gap: undefined })).toEqual(
      ['example 1 closes on a bare "?" — the question at its end has to ask something'],
    );
  });

  it("refuses a scene too thin to picture, naming its count", () => {
    const problems = askExampleProblems({ examples: ["You open it. Was that right?"], gap: undefined });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("sets its scene in 3 words, under 6");
  });

  it("refuses a fourth scene — related asks fold onto at most three", () => {
    const problems = askExampleProblems({ examples: [SCENE, SCENE, SCENE, SCENE], gap: undefined });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("at most 3");
  });

  it("refuses a scene past the cap, naming its count", () => {
    const long = `You ${"see ".repeat(100)}this. Right?`;
    const problems = askExampleProblems({ examples: [long], gap: undefined });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("runs 103 words");
  });

  it("refuses a gap that runs two sentences", () => {
    const problems = askExampleProblems({ examples: [], gap: "No event. Nothing observed." });
    expect(problems).toEqual(["--example-gap runs 2 sentences — it is one line"]);
  });

  it("refuses a gap broken over two lines even with no sentence-ending punctuation", () => {
    const problems = askExampleProblems({ examples: [], gap: "No observed event exists\nfrom which to build a scene" });
    expect(problems).toEqual(["--example-gap runs over more than one line — it is one line"]);
  });

  // A Unicode line separator is a line break too.
  it("refuses a gap broken by a Unicode line separator", () => {
    const separator = String.fromCodePoint(0x2028);
    const problems = askExampleProblems({ examples: [], gap: `No observed event${separator}can support a scene` });
    expect(problems).toEqual(["--example-gap runs over more than one line — it is one line"]);
  });
});

describe("askExampleSetOf", () => {
  it("reads scenes over a gap, trimmed", () => {
    expect(askExampleSetOf({ examples: [`  ${SCENE} `], gap: "ignored" })).toEqual({
      examples: [SCENE],
      kind: "examples",
    });
  });

  it("reads the gap when there are no scenes, and nothing from neither", () => {
    expect(askExampleSetOf({ examples: [], gap: " why " })).toEqual({ gap: "why", kind: "gap" });
    expect(askExampleSetOf({ examples: [], gap: undefined })).toBe(undefined);
  });
});

describe("sameAskExampleSet", () => {
  it("is order-sensitive over scenes, and tells a gap from scenes", () => {
    const one = { examples: ["a?", "b?"], kind: "examples" } as const;
    expect(sameAskExampleSet({ left: one, right: { examples: ["a?", "b?"], kind: "examples" } })).toBe(true);
    expect(sameAskExampleSet({ left: one, right: { examples: ["b?", "a?"], kind: "examples" } })).toBe(false);
    expect(sameAskExampleSet({ left: one, right: { gap: "a?", kind: "gap" } })).toBe(false);
    expect(sameAskExampleSet({ left: undefined, right: undefined })).toBe(true);
  });
});

describe("askExampleFrontMatter", () => {
  const PATH = "/handovers/a-registered-ask.md";
  const DOC =
    '---\nslug: a-registered-ask\nkind: ask\nstatus: "ready"\naskedIso: "2026-10-04T01:00:00.000Z"\n' +
    'exampleGap: "nothing yet"\n---\n\nBody.\n';

  it("writes scenes the doc parser reads back exactly, colons and quotes included, and drops the gap", () => {
    const tricky = 'You see "#1788: merged". Was it right?';
    const edit = askExampleFrontMatter({ set: { examples: [SCENE, tricky], kind: "examples" } });
    const text = unwrap(editFrontMatterFields({ path: PATH, remove: edit.remove, set: edit.set, text: DOC }));
    const doc = parseHandoverDoc({ path: PATH, text });
    expect(doc.examples).toEqual([SCENE, tricky]);
    expect(doc.exampleGap).toBe(undefined);
  });

  it("writes a gap and drops any scenes", () => {
    const withScenes = unwrap(
      editFrontMatterFields({
        path: PATH,
        remove: [],
        set: askExampleFrontMatter({ set: { examples: [SCENE], kind: "examples" } }).set,
        text: DOC,
      }),
    );
    const edit = askExampleFrontMatter({ set: { gap: "The row names no event.", kind: "gap" } });
    const text = unwrap(editFrontMatterFields({ path: PATH, remove: edit.remove, set: edit.set, text: withScenes }));
    const doc = parseHandoverDoc({ path: PATH, text });
    expect(doc.examples).toEqual([]);
    expect(doc.exampleGap).toBe("The row names no event.");
  });
});
