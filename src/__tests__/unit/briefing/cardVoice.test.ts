import { describe, expect, it } from "vitest";

import { DL_FIELD_LABELS, pushVoiceDefects, type VoiceDefect } from "../../../briefing/cardVoice.js";
import { checkReactNowCards, type ReactNowCheck } from "../../../briefing/reactNowCard.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";

/** The renderer's own age line, which every card carries. */
const AGE_LINE =
  '<div class="age" data-premise-kind="composed" data-premise-iso="2026-09-11T21:18:59Z">premise 2 hours old</div>';

/** One well-shaped react-now card, with every field overridable so a test names only what it breaks. */
function card({
  question = "1. Ship the thing, are you happy with the draft?",
  what = "The draft adds a template and a doc. It also adds an advisory check that only reports.",
  options = "A: send it as written. B: send it with edits.",
}: {
  question?: string;
  what?: string;
  options?: string;
} = {}): string {
  return (
    `<h2>react now</h2><div class="need"><div class="q">${question}</div>${AGE_LINE}` +
    `<dl class="f"><dt>what</dt><dd>${what}</dd>` +
    `<dt>why you</dt><dd>It is a post under your name.</dd>` +
    `<dt>options</dt><dd>${options}</dd>` +
    `<dt>lean</dt><dd>A, on Monday.</dd>` +
    `<dt>if silent</dt><dd>the draft stays unsent.</dd></dl></div><h2>done</h2>`
  );
}

function run({ html, applyVoice }: { html: string; applyVoice: boolean }): ReactNowCheck {
  return checkReactNowCards({ applyFraming: true, applyVoice, html, nowIso: "2026-09-12T00:00:00Z", rules: [] });
}

describe("react-now card voice rules", () => {
  it("refuses a `what` that packs several facts behind one colon", () => {
    const what =
      "The gate refuses three things: a long field, an unfolded page, and a packed sentence. It reports each.";
    const result = run({ applyVoice: true, html: card({ what }) });

    expect(result.defects.map((defect) => defect.field)).toEqual(["what"]);
    expect(result.defects[0]!.reason).toBe(
      "what: a colon introducing a list packs several facts into one sentence. Split it into one sentence per " +
        "fact, and move the taxonomy below the fold where it is already named in full.",
    );
  });

  it("refuses a `what` whose two facts are welded with a semicolon", () => {
    const what = "The gate refuses a long field; it also refuses an unfolded page. Both were measured.";
    const result = run({ applyVoice: true, html: card({ what }) });

    expect(result.defects.map((defect) => defect.reason)).toEqual([
      "what: a semicolon joins two clauses that are two facts. Make them two sentences; nothing above the fold " +
        "needs a reader to hold both halves at once.",
    ]);
  });

  it("reads each option's body as its own cell, so the option letter is never a colon list", () => {
    const options = "A: send it now, and tell the team. B: hold it, and say nothing.";

    expect(run({ applyVoice: true, html: card({ options }) }).defects).toEqual([]);
  });

  it("names the field a voice finding belongs to, so a composer knows what to rewrite", () => {
    const options = "A: send it now (today) (before noon). B: hold it for now.";
    const result = run({ applyVoice: true, html: card({ options }) });

    expect(result.defects.map((defect) => defect.field)).toEqual(["options"]);
    expect(result.defects[0]!.reason).toBe(
      "options.A: 2 parenthetical asides (max 1). An aside above the fold is a fact the sentence did not want. " +
        "Promote it to its own sentence or move it below.",
    );
  });

  it("lifts every voice finding when the break-glass is set, and keeps every cap", () => {
    const what =
      "The gate refuses three things: a long field, an unfolded page, and a packed sentence. It reports each.";

    expect(run({ applyVoice: false, html: card({ what }) }).defects).toEqual([]);
  });

  it("keeps the word cap when the break-glass is set", () => {
    const what = `${Array.from({ length: 61 }, () => "alpha").join(" ")}. And one more.`;

    expect(run({ applyVoice: false, html: card({ what }) }).defects.map((defect) => defect.field)).toEqual(["what"]);
  });
});

/** Every defect `pushVoiceDefects` pushes, captured by a plain appending sink rather than a mock. */
function collect({
  fields,
  questionRaw,
  rules,
}: {
  fields: ReadonlyMap<string, string>;
  questionRaw: string | undefined;
  rules: readonly ExactVoiceRule[];
}): readonly VoiceDefect[] {
  const pushed: VoiceDefect[] = [];
  pushVoiceDefects({
    fields,
    push: (defect) => {
      pushed.push(defect);
    },
    questionRaw,
    rules,
  });
  return pushed;
}

/** The voice-rule refusal line for one rule in one cell, spelled the way `voiceRuleLabel` names it. */
function ruleReason({ path, kind, value }: { path: string; kind: string; value: string }): string {
  return `${path}: matches the configured ${kind} voice rule "${value}". Rewrite the authored prose.`;
}

/** Keys that look like a card label but are not one, each carrying a word only the decoy rule matches. */
const DECOY_FIELDS: readonly (readonly [string, string])[] = [
  ["What", "Capital zebradecoy here."],
  ["why", "Short zebradecoy here."],
  ["whyYou", "Camel zebradecoy here."],
  ["ifSilent", "Camel silent zebradecoy here."],
  ["lean ", "Padded zebradecoy here."],
  ["option", "A: Singular zebradecoy here. B: Singular zebradecoy again."],
  ["Options", "A: Capital zebradecoy here. B: Capital zebradecoy again."],
  ["question", "Keyed zebradecoy question here."],
];

describe("pushVoiceDefects", () => {
  it("labels each dl.f field by the text the rendered card carries", () => {
    expect(DL_FIELD_LABELS).toStrictEqual({
      ifSilent: "if silent",
      lean: "lean",
      options: "options",
      what: "what",
      whyYou: "why you",
    });
  });

  it("reads every region by its exact label, in card order, and never a decoy key, a fold or an option letter", () => {
    const fields = new Map<string, string>([
      ...DECOY_FIELDS,
      ["options", "A: Take zebraopta now. B: Hold zebraoptb instead."],
      ["if silent", "The zebra silent draft stays put."],
      ["lean", "Lean ZebraLean on Monday."],
      ["why you", "It names zebrawhy directly."],
      ["what", "Ship zebrawhat today.<details><summary>more</summary>Folded zebrafolded detail.</details>"],
    ]);
    const rules: readonly ExactVoiceRule[] = [
      { kind: "word", value: "zebraoptb" },
      { kind: "word", value: "zebraopta" },
      { kind: "phrase", value: "zebra silent" },
      { kind: "literal", value: "ZebraLean" },
      { kind: "word", value: "zebrawhy" },
      { kind: "word", value: "zebrawhat" },
      { kind: "word", value: "zebraquestion" },
      { kind: "word", value: "zebrafolded" },
      { kind: "word", value: "zebradecoy" },
      { kind: "literal", value: "A:" },
    ];

    expect(collect({ fields, questionRaw: "<b>Ship zebraquestion now?</b>", rules })).toStrictEqual([
      { field: "question", reason: ruleReason({ kind: "word", path: "question", value: "zebraquestion" }) },
      { field: "what", reason: ruleReason({ kind: "word", path: "what", value: "zebrawhat" }) },
      { field: "whyYou", reason: ruleReason({ kind: "word", path: "whyYou", value: "zebrawhy" }) },
      { field: "lean", reason: ruleReason({ kind: "literal", path: "lean", value: "ZebraLean" }) },
      { field: "ifSilent", reason: ruleReason({ kind: "phrase", path: "ifSilent", value: "zebra silent" }) },
      { field: "options", reason: ruleReason({ kind: "word", path: "options.A", value: "zebraopta" }) },
      { field: "options", reason: ruleReason({ kind: "word", path: "options.B", value: "zebraoptb" }) },
    ]);
  });

  it("pushes nothing for an absent question and fields whose above-fold text is empty", () => {
    const fields = new Map<string, string>([
      ["what", ""],
      ["lean", "   "],
      ["options", "<details><summary>  </summary>A: Fold zebrafolded away.</details>"],
    ]);
    const rules: readonly ExactVoiceRule[] = [
      { kind: "word", value: "zebrafolded" },
      { anyOf: ["perhaps"], kind: "at-least-one" },
    ];

    expect(collect({ fields, questionRaw: undefined, rules })).toStrictEqual([]);
  });

  it("reports two different word rules in one cell as two defects, each naming its own rule", () => {
    const fields = new Map<string, string>([["what", "Ship zebraone beside zebratwo today."]]);
    const rules: readonly ExactVoiceRule[] = [
      { kind: "word", value: "zebraone" },
      { kind: "word", value: "zebratwo" },
    ];

    expect(collect({ fields, questionRaw: undefined, rules })).toStrictEqual([
      { field: "what", reason: ruleReason({ kind: "word", path: "what", value: "zebraone" }) },
      { field: "what", reason: ruleReason({ kind: "word", path: "what", value: "zebratwo" }) },
    ]);
  });

  // Each field also carries a word only it holds, so reading either field's text from the other's key moves a
  // defect between them.
  it("reports one rule firing in two fields as one defect per field", () => {
    const fields = new Map<string, string>([
      ["what", "Ship zebrashared zebrawhatonly today."],
      ["if silent", "Nothing zebrashared zebrasilentonly happens."],
    ]);
    const rules: readonly ExactVoiceRule[] = [
      { kind: "word", value: "zebrashared" },
      { kind: "word", value: "zebrawhatonly" },
      { kind: "word", value: "zebrasilentonly" },
    ];

    expect(collect({ fields, questionRaw: undefined, rules })).toStrictEqual([
      { field: "what", reason: ruleReason({ kind: "word", path: "what", value: "zebrashared" }) },
      { field: "what", reason: ruleReason({ kind: "word", path: "what", value: "zebrawhatonly" }) },
      { field: "ifSilent", reason: ruleReason({ kind: "word", path: "ifSilent", value: "zebrashared" }) },
      { field: "ifSilent", reason: ruleReason({ kind: "word", path: "ifSilent", value: "zebrasilentonly" }) },
    ]);
  });

  it("collapses two colon-list sentences in one field into one defect counting 2 times", () => {
    const fields = new Map<string, string>([
      ["why you", "It packs three things: north, south, and east. It packs two more: west and up."],
    ]);

    expect(collect({ fields, questionRaw: undefined, rules: [] })).toStrictEqual([
      {
        field: "whyYou",
        reason:
          "whyYou: 2 times — a colon introducing a list packs several facts into one sentence. Split it into one " +
          "sentence per fact, and move the taxonomy below the fold where it is already named in full.",
      },
    ]);
  });

  it("collapses two over-long sentences of different lengths into one defect quoting the first", () => {
    const first = `${Array.from({ length: 31 }, () => "alpha").join(" ")}.`;
    const second = `${Array.from({ length: 33 }, () => "beta").join(" ")}.`;
    const fields = new Map<string, string>([["lean", `${first} ${second}`]]);

    expect(collect({ fields, questionRaw: undefined, rules: [] })).toStrictEqual([
      {
        field: "lean",
        reason:
          "lean: 2 times — one sentence is 31 authored-prose words (max 30). Split it. Technical identifiers " +
          "are not counted, so this is longer than it looks.",
      },
    ]);
  });
});
