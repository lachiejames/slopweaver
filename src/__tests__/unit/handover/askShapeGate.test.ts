import { describe, expect, it } from "vitest";

import { type AskOption, TRADEOFF_SEPARATOR } from "../../../handover/askShape.js";
import { askShapeVerdict, UNSHAPED_ASK_HATCH, unshapedAskAllowed } from "../../../handover/askShapeGate.js";

const OPTIONS: readonly AskOption[] = [
  { letter: "A", option: "ship the schema", tradeoff: "a day of work" },
  { letter: "B", option: "ship the card", tradeoff: "they wait another turn" },
];

const STAKES = {
  blastRadius: "every ask on the queue, no teammate",
  risk: "they answer a card that no longer describes the problem",
  stillReal: "handover list --json still shows asks with no lean",
};

const WHOLE = {
  command: "slopweaver handover ask",
  env: {},
  lean: "take B, because the queue card is what they read first",
  options: OPTIONS,
  parseProblems: [],
  problem: "no verb states a lean, so every recorded ask reads as a paragraph",
  required: true,
  ...STAKES,
};

/** No shape and no stakes — the one arm the unshaped-ask hatch governs. */
const BARE = {
  blastRadius: undefined,
  lean: undefined,
  options: [],
  problem: undefined,
  risk: undefined,
  stillReal: undefined,
};

/** The refusal's lines, thrown past when the verdict recorded instead — so no assertion needs a branch. */
const refusedLines = ({ verdict }: { verdict: ReturnType<typeof askShapeVerdict> }): readonly string[] => {
  if (verdict.kind !== "refused") {
    throw new Error("expected a refusal, and the verdict recorded");
  }
  return verdict.lines;
};

/** Every refusal is one blob, so a case asserts on a fragment of it rather than on an index. */
const printed = ({ lines }: { lines: readonly string[] }): string => lines.join("\n");

describe("unshapedAskAllowed", () => {
  it("is closed with the variable unset and no caller reason", () => {
    expect(unshapedAskAllowed({ already: false, env: {} })).toBe(false);
  });

  it("opens on the variable alone", () => {
    expect(unshapedAskAllowed({ already: false, env: { [UNSHAPED_ASK_HATCH]: "1" } })).toBe(true);
  });

  it("stays open when the caller passes its own reason — a caller may only ever ADD to a hatch", () => {
    expect(unshapedAskAllowed({ already: true, env: { [UNSHAPED_ASK_HATCH]: "1" } })).toBe(true);
    expect(unshapedAskAllowed({ already: true, env: {} })).toBe(true);
  });

  it("reads only an exact 1, so an empty or accidental value does not open it", () => {
    expect(unshapedAskAllowed({ already: false, env: { [UNSHAPED_ASK_HATCH]: "" } })).toBe(false);
    expect(unshapedAskAllowed({ already: false, env: { [UNSHAPED_ASK_HATCH]: "true" } })).toBe(false);
  });

  it("names the key as a literal the escape-hatch gate can see in this module", () => {
    expect(UNSHAPED_ASK_HATCH).toBe("SLOPWEAVER_ALLOW_UNSHAPED_ASK");
  });
});

describe("askShapeVerdict", () => {
  it("records a whole, in-caps shape", () => {
    const verdict = askShapeVerdict(WHOLE);
    expect(verdict.kind).toBe("ok");
    expect(verdict).toEqual({
      kind: "ok",
      shape: { lean: WHOLE.lean, options: OPTIONS, problem: WHOLE.problem, stakes: STAKES },
    });
  });

  it("refuses a bare ask as POLICY, with the four-line hatch block naming its own variable", () => {
    const verdict = askShapeVerdict({ ...WHOLE, ...BARE });
    expect(verdict.kind).toBe("refused");
    const text = printed({ lines: verdict.kind === "refused" ? verdict.lines : [] });
    expect(text).toContain("slopweaver handover ask blocked because");
    expect(text).toContain("Legitimate exceptions may include");
    expect(text).toContain("SLOPWEAVER_ALLOW_UNSHAPED_ASK=1");
    expect(text).toContain("Use good judgement to determine whether the owner would approve");
  });

  it("says NOTHING was recorded on every refusal, because the ordering is what makes the advice followable", () => {
    const bare = askShapeVerdict({ ...WHOLE, ...BARE });
    const partial = askShapeVerdict({ ...WHOLE, lean: undefined });
    const overCap = askShapeVerdict({ ...WHOLE, problem: "One. Two." });
    const unparsed = askShapeVerdict({ ...WHOLE, parseProblems: ["that line carries no separator"] });
    const texts = [bare, partial, overCap, unparsed].map((verdict) =>
      printed({ lines: verdict.kind === "refused" ? verdict.lines : ["RECORDED"] }),
    );
    expect(texts.filter((text) => text.includes("NOTHING was recorded and the run is not paused"))).toHaveLength(4);
  });

  it("refuses a PARTIAL shape as a fact, naming the flags it is short of and offering no hatch", () => {
    const verdict = askShapeVerdict({ ...WHOLE, lean: undefined, options: [] });
    const text = printed({ lines: verdict.kind === "refused" ? verdict.lines : [] });
    expect(text).toContain("it was given a shape without --options, --lean — an ask carries all six fields");
    expect(text).not.toContain("SLOPWEAVER_ALLOW_UNSHAPED_ASK=1");
  });

  it("refuses an over-cap shape as a fact, printing exactly which cap broke", () => {
    const verdict = askShapeVerdict({ ...WHOLE, options: [OPTIONS[0]!] });
    const text = printed({ lines: verdict.kind === "refused" ? verdict.lines : [] });
    expect(text).toContain("the shape it was given does not read:");
    expect(text).toContain("  - 1 option(s) — an ask carries 2 to 4");
    expect(text).not.toContain("SLOPWEAVER_ALLOW_UNSHAPED_ASK=1");
  });

  it("reports a malformed option line ahead of any cap, so the caller fixes the spelling first", () => {
    const verdict = askShapeVerdict({
      ...WHOLE,
      options: [],
      parseProblems: [`this option line carries no \`${TRADEOFF_SEPARATOR}\``],
    });
    const lines = verdict.kind === "refused" ? verdict.lines : [];
    expect(lines[0]).toBe(`this option line carries no \`${TRADEOFF_SEPARATOR}\``);
  });

  it("prints how to spell all three flags on a refusal, rather than leaving it to the usage block", () => {
    const verdict = askShapeVerdict({ ...WHOLE, ...BARE });
    const text = printed({ lines: verdict.kind === "refused" ? verdict.lines : [] });
    expect(text).toContain("--problem  one line: what is actually wrong or undecided");
    expect(text).toContain(
      `--options  2 to 4 lines, each \`<what the owner could do> ${TRADEOFF_SEPARATOR} <what that costs>\``,
    );
    expect(text).toContain("--lean     one line: what the owner would most likely pick");
  });

  it("names the door being refused, so `register` does not print `ask`", () => {
    const verdict = askShapeVerdict({
      ...WHOLE,
      command: "slopweaver handover register",
      ...BARE,
    });
    const text = printed({ lines: verdict.kind === "refused" ? verdict.lines : [] });
    expect(text).toContain("slopweaver handover register blocked because");
    expect(text).not.toContain("slopweaver handover ask blocked");
  });

  it("lets a bare ask through with the hatch open", () => {
    const verdict = askShapeVerdict({
      ...WHOLE,
      env: { [UNSHAPED_ASK_HATCH]: "1" },
      ...BARE,
    });
    expect(verdict).toEqual({ kind: "ok", shape: undefined });
  });

  it("lets a bare FINDING row through unhatched, because it asks the owner to pick nothing", () => {
    const verdict = askShapeVerdict({ ...WHOLE, ...BARE, required: false });
    expect(verdict).toEqual({ kind: "ok", shape: undefined });
  });

  it("still refuses a PARTIAL finding row — the flags were used wrongly, hatch or not", () => {
    const verdict = askShapeVerdict({
      ...WHOLE,
      env: { [UNSHAPED_ASK_HATCH]: "1" },
      lean: undefined,
      options: [],
      required: false,
    });
    const text = printed({ lines: verdict.kind === "refused" ? verdict.lines : [] });
    expect(text).toContain("it was given a shape without --options, --lean");
  });

  it("refuses a whole shape with no stakes, naming all three stakes flags — the card cannot state them", () => {
    const verdict = askShapeVerdict({ ...WHOLE, blastRadius: undefined, risk: undefined, stillReal: undefined });
    const text = printed({ lines: refusedLines({ verdict }) });
    expect(text).toContain("it was given a shape without --risk, --blast-radius, --still-real");
    expect(text).not.toContain("SLOPWEAVER_ALLOW_UNSHAPED_ASK=1");
  });

  it("refuses stakes with no shape beside them, even with the hatch open — they describe no decision", () => {
    const verdict = askShapeVerdict({
      ...WHOLE,
      env: { [UNSHAPED_ASK_HATCH]: "1" },
      lean: undefined,
      options: [],
      problem: undefined,
    });
    const text = printed({ lines: refusedLines({ verdict }) });
    expect(text).toContain("it was given a shape without --problem, --options, --lean");
  });

  it("refuses a stake that runs two sentences, because each is read at a glance", () => {
    const verdict = askShapeVerdict({ ...WHOLE, risk: "It breaks. Then it breaks again." });
    const text = printed({ lines: refusedLines({ verdict }) });
    expect(text).toContain("  - risk runs 2 sentences against a cap of 1");
  });

  it("prints how to spell the three stakes flags on a refusal", () => {
    const text = printed({ lines: refusedLines({ verdict: askShapeVerdict({ ...WHOLE, ...BARE }) }) });
    expect(text).toContain("--risk          one line: what goes wrong if the owner picks badly, or says nothing");
    expect(text).toContain("--blast-radius  one line: who and what the decision reaches");
    expect(text).toContain("--still-real    one line: how the problem was confirmed to still stand");
  });

  // The tracing card: its still-real line named `span-profiles-tab.png`, drawn as a path.
  it("refuses a shape naming a picture file, on the unaligned-card hatch, naming the field", () => {
    const verdict = askShapeVerdict({ ...WHOLE, stillReal: "seen empty, ~/proof/span-profiles-tab.png" });
    const text = printed({ lines: refusedLines({ verdict }) });
    expect(text).toContain("SLOPWEAVER_ALLOW_UNALIGNED_CARD=1 slopweaver handover ask");
    expect(text).toContain('the still-real check names the picture "~/proof/span-profiles-tab.png" as text');
  });

  it("names an option's trade-off by its letter", () => {
    const options = [OPTIONS[0]!, { ...OPTIONS[1]!, tradeoff: "see b.png" }];
    const text = printed({ lines: refusedLines({ verdict: askShapeVerdict({ ...WHOLE, options }) }) });
    expect(text).toContain('option B\'s trade-off names the picture "b.png"');
  });

  it("records a picture-naming shape once the unaligned-card hatch is open", () => {
    const verdict = askShapeVerdict({
      ...WHOLE,
      env: { SLOPWEAVER_ALLOW_UNALIGNED_CARD: "1" },
      stillReal: "seen empty, ~/proof/span-profiles-tab.png",
    });
    expect(verdict.kind).toBe("ok");
  });
});
