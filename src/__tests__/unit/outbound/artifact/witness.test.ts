/**
 * The `witness` form: the exact card one material finding derives, every refusal the bar earns, and the quoted
 * claim surviving validation so the voice rules judge the bot's prose and never the thread's words.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { updateArtifactBelowFoldCells } from "../../../../outbound/artifact/aboveFold.js";
import { BOT_FORM_KINDS } from "../../../../outbound/artifact/botFormKinds.js";
import { parseWitnessForm } from "../../../../outbound/artifact/botFormLanes.js";
import type { InlineRun, UpdateArtifact } from "../../../../outbound/artifact/types.js";
import {
  WITNESS_CHECKED_MAX,
  WITNESS_PROOF_LABEL_MAX,
  WITNESS_PROOF_MAX,
  WITNESS_PROOF_SHOWS_MAX,
  WITNESS_QUOTE_MAX,
  type WitnessForm,
  witnessFormSchema,
  witnessToUpdate,
} from "../../../../outbound/artifact/witness.js";

const WIDER: WitnessForm = {
  checked: ["The payments service logs for the same hour."],
  claim: { messageTs: "1759650000.000200", quote: "Retried the sync and the customer can book now." },
  finding: "The retry fixed one customer, but twenty others hit the same sync failure today.",
  kind: "witness",
  materiality: "wider-impact",
  proof: [
    {
      label: "The sync failure traces",
      shows: "21 customers failing the same step since 09:00",
      url: "https://example.invalid/traces?query=sync-failure",
    },
    {
      label: "The customer who was retried",
      shows: "one successful booking after the retry",
      url: "https://example.invalid/customers/synthetic-1",
    },
  ],
};

const { checked: _checked, ...UNCHECKED } = WIDER;

/** Every violation message one raw form earns, in Zod's order. */
function refusalsOf({ raw }: { raw: unknown }): readonly string[] {
  const parsed = witnessFormSchema.safeParse(raw);
  expect(parsed.success).toBe(false);
  return parsed.error!.issues.map((issue) => issue.message);
}

/** The card the `witness` lane sends for one raw form. */
function sentCard({ raw }: { raw: unknown }): UpdateArtifact {
  const artifact = unwrap(parseWitnessForm({ raw })).artifact;
  if (artifact.kind !== "update") {
    throw new Error(`the witness lane derived a ${artifact.kind} artifact, not a card`);
  }
  return artifact;
}

/** The first run of a card's first detail block, which a witness card always makes the claim paragraph. */
function leadRun({ card }: { card: UpdateArtifact }): InlineRun {
  const block = card.detail[0]!;
  if (block.type !== "paragraph") {
    throw new Error(`the witness card opened its detail with a ${block.type}, not the claim paragraph`);
  }
  return block.runs[0]!;
}

describe("witnessToUpdate", () => {
  it("derives the exact card: the finding as TL;DR, one chip-cited line per proof, the quoted claim below", () => {
    expect(witnessToUpdate({ form: WIDER })).toEqual({
      citations: [
        { id: "proof-1", label: "[1]", url: "https://example.invalid/traces?query=sync-failure" },
        { id: "proof-2", label: "[2]", url: "https://example.invalid/customers/synthetic-1" },
      ],
      detail: [
        {
          runs: [
            { bold: true, text: "Wider impact. ", type: "text" },
            { text: "The thread said ", type: "text" },
            { quoted: true, text: '"Retried the sync and the customer can book now."', type: "text" },
          ],
          type: "paragraph",
        },
        { runs: [{ bold: true, text: "Also checked", type: "text" }], type: "paragraph" },
        { items: [[{ text: "The payments service logs for the same hour.", type: "text" }]], type: "bullets" },
      ],
      index: [
        [
          { bold: true, text: "The sync failure traces ", type: "text" },
          { text: "shows 21 customers failing the same step since 09:00 ", type: "text" },
          { citationId: "proof-1", type: "citation" },
        ],
        [
          { bold: true, text: "The customer who was retried ", type: "text" },
          { text: "shows one successful booking after the retry ", type: "text" },
          { citationId: "proof-2", type: "citation" },
        ],
      ],
      kind: "update",
      media: [],
      tldr: "The retry fixed one customer, but twenty others hit the same sync failure today.",
    });
  });

  it("composes no checked list when the form carries none", () => {
    expect(witnessToUpdate({ form: UNCHECKED }).detail.map((block) => block.type)).toEqual(["paragraph"]);
  });

  it.each([
    ["claim-contradicted", "Contradicted. "],
    ["wider-impact", "Wider impact. "],
    ["missing-fact", "Missing fact. "],
  ] as const)("leads the claim paragraph for %s with its own label", (materiality, label) => {
    const paragraph = witnessToUpdate({ form: { ...WIDER, materiality } }).detail[0]!;
    expect(paragraph).toEqual({
      runs: [
        { bold: true, text: label, type: "text" },
        { text: "The thread said ", type: "text" },
        { quoted: true, text: '"Retried the sync and the customer can book now."', type: "text" },
      ],
      type: "paragraph",
    });
  });
});

describe("parseWitnessForm", () => {
  it("sends exactly the derived card, the quoted flag restored after the layout schema accepted it", () => {
    expect(sentCard({ raw: WIDER })).toEqual(witnessToUpdate({ form: WIDER }));
  });

  it("keeps the thread's words out of the prose the voice rules read, and the bot's own in", () => {
    const below = updateArtifactBelowFoldCells({ artifact: sentCard({ raw: WIDER }) }).map((cell) => cell.text);
    expect(JSON.stringify(WIDER)).toContain("Retried the sync and the customer can book now.");
    expect(below.join("\n")).not.toContain("Retried the sync");
    expect(below[0]).toBe("Wider impact. The thread said  ");
  });

  it("names the form violation rather than deriving anything", () => {
    expect(unwrapErr(parseWitnessForm({ raw: { ...WIDER, proof: [] } })).code).toBe("FORM_INVALID");
  });
});

describe("witnessFormSchema — accepts", () => {
  it("a form with and without checked", () => {
    expect(witnessFormSchema.safeParse(WIDER).success).toBe(true);
    expect(witnessFormSchema.safeParse(UNCHECKED).success).toBe(true);
  });

  it("the widest proof lines at the proof cap, which never outgrow the index line cap", () => {
    const widest = {
      label: "L".repeat(WITNESS_PROOF_LABEL_MAX),
      shows: "s".repeat(WITNESS_PROOF_SHOWS_MAX),
    };
    const proof = Array.from({ length: WITNESS_PROOF_MAX }, (_, i) => ({
      ...widest,
      url: `https://example.invalid/proof/${String(i)}`,
    }));
    expect(witnessFormSchema.safeParse({ ...WIDER, proof }).success).toBe(true);
  });
});

describe("witnessFormSchema — refuses", () => {
  it("an empty proof list, saying to settle nothing-material instead", () => {
    expect(refusalsOf({ raw: { ...WIDER, proof: [] } })).toEqual([
      "a witness post carries at least one proof. With nothing to link, settle nothing-material instead.",
    ]);
  });

  it("more proofs than the cap", () => {
    const proof = Array.from({ length: WITNESS_PROOF_MAX + 1 }, (_, i) => ({
      ...WIDER.proof[0]!,
      url: `https://example.invalid/proof/${String(i)}`,
    }));
    expect(refusalsOf({ raw: { ...WIDER, proof } })[0]).toContain("<=4");
  });

  it("a proof URL that is not https", () => {
    const proof = [{ ...WIDER.proof[0]!, url: "http://example.invalid/traces" }];
    expect(refusalsOf({ raw: { ...WIDER, proof } })).toEqual([
      "a proof URL must be https, because a reader opens it from the thread and an http link is refused there",
    ]);
  });

  it("a proof URL that is not a URL at all, with the URL refusal alone", () => {
    const proof = [{ ...WIDER.proof[0]!, url: "not a url" }];
    expect(refusalsOf({ raw: { ...WIDER, proof } })).toEqual(["Invalid URL"]);
  });

  it.each(["label", "shows", "url"])("a proof missing %s", (key) => {
    const proof: Record<string, unknown> = { ...WIDER.proof[0]! };
    delete proof[key];
    expect(witnessFormSchema.safeParse({ ...WIDER, proof: [proof] }).success).toBe(false);
  });

  it("two proofs naming one URL", () => {
    const proof = [WIDER.proof[0]!, { ...WIDER.proof[1]!, url: WIDER.proof[0]!.url }];
    expect(refusalsOf({ raw: { ...WIDER, proof } })).toEqual([
      "proof: two proofs name one URL, and one URL proves one thing. Merge them into one proof.",
    ]);
  });

  it("an unknown materiality", () => {
    expect(refusalsOf({ raw: { ...WIDER, materiality: "interesting" } })[0]).toContain(
      '"claim-contradicted"|"wider-impact"|"missing-fact"',
    );
  });

  it.each(["", "   "])("an empty finding %j", (finding) => {
    expect(witnessFormSchema.safeParse({ ...WIDER, finding }).success).toBe(false);
  });

  it.each([
    "The retry fixed one customer. Twenty others hit the same failure.",
    "The retry fixed one customer; twenty others hit the same failure.",
    "The retry fixed one customer\nand twenty others hit the same failure",
    "Errors continue.The deployment failed.",
    "Errors continue.I found more failures.",
    'Errors continue."Resolved" was wrong.',
    "Did the deploy fail?2 systems remain down.",
    "It is not fixed!Twenty customers still fail.",
    "Errors continue.the deployment failed.",
    "Errors continue.5 systems remain down.",
    "The sync on api.example.com failed for twenty customers.",
    '"Is the deploy fixed?" Errors continue',
    "(It is not fixed!) Twenty customers still fail.",
    "The retry fixed one customer… twenty others hit the same failure",
    "Is it fixed‽ No, twenty customers still fail",
    "It is not fixed‼ Twenty customers still fail",
    "修正されていません。二十人がまだ失敗しています",
    "It is not fixed！Twenty customers still fail",
    "Did the deploy fail？Two systems remain down",
    "The retry fixed one customer\rand twenty others hit the same failure",
    "Did the deploy fail؟ Two systems remain down",
    "The deploy failed। Two systems remain down",
    "The deploy failed﹒Two systems remain down",
    "The retry fixed one customer；twenty others hit the same failure",
    `The retry fixed one customer${String.fromCodePoint(0x37e)} twenty others hit the same failure`,
    "「It is fixed。」Twenty customers still fail",
    `The retry fixed one customer${String.fromCodePoint(0x2028)}and twenty others hit the same failure`,
  ])("a finding that is more than one sentence, or could be: %j", (finding) => {
    expect(refusalsOf({ raw: { ...WIDER, finding } })[0]).toContain("one sentence, the one material thing.");
  });

  it.each([
    "The sync failed for twenty customers within 1.5 hours of v1.2.3 shipping.",
    'Twenty customers still fail after the "fixed!"',
    "Twenty customers still fail (as of v2.1).",
    "Twenty customers still fail…",
    "二十人がまだ失敗しています。",
    "Helpbot said it was 「fixed！」",
  ])("keeps a full stop inside a number, or closing punctuation at the end, as one sentence: %j", (finding) => {
    expect(witnessFormSchema.safeParse({ ...WIDER, finding }).success).toBe(true);
  });

  it("a finding carrying a headline separator, through the headline's own refusal", () => {
    const finding = "The retry fixed one customer — twenty others hit the same failure.";
    expect(refusalsOf({ raw: { ...WIDER, finding } })[0]).toContain('finding: a headline clause cannot contain "—"');
  });

  it("an unknown key, naming it", () => {
    expect(refusalsOf({ raw: { ...WIDER, severity: "high" } })[0]).toContain(
      'unknown field "severity" — REFUSED, not ignored.',
    );
  });

  it("an unknown key inside the claim", () => {
    const claim = { ...WIDER.claim, author: "helpbot" };
    expect(refusalsOf({ raw: { ...WIDER, claim } })[0]).toContain('unknown field "author"');
  });

  it.each(["1759650000", "abc.def", "1759650000.", ".000200", " 1759650000.000200"])(
    "a claim messageTs that is not a Slack ts: %j",
    (messageTs) => {
      const claim = { ...WIDER.claim, messageTs };
      expect(refusalsOf({ raw: { ...WIDER, claim } })).toEqual([
        "a Slack message ts is whole seconds, a dot, then the fraction",
      ]);
    },
  );

  it.each(["Fixed, thanks <@U0SYNTH01>", "Fixed <!here>", "Fixed, see https://example.invalid/x", "Fixed as per [1]"])(
    "a quote that would become a ping, a link or a chip: %j",
    (quote) => {
      const claim = { ...WIDER.claim, quote };
      expect(refusalsOf({ raw: { ...WIDER, claim } })[0]).toContain("must be plain text");
    },
  );

  it("a quote over its cap", () => {
    const claim = { ...WIDER.claim, quote: "q".repeat(WITNESS_QUOTE_MAX + 1) };
    expect(witnessFormSchema.safeParse({ ...WIDER, claim }).success).toBe(false);
  });

  it("an empty checked list, which would compose a heading over nothing", () => {
    expect(witnessFormSchema.safeParse({ ...WIDER, checked: [] }).success).toBe(false);
  });

  it("a card whose quote and checked lines together outgrow the detail budget, naming the fields", () => {
    const checked = Array.from({ length: WITNESS_CHECKED_MAX }, () => `${"c".repeat(199)}.`);
    const claim = { ...WIDER.claim, quote: "q".repeat(WITNESS_QUOTE_MAX) };
    const refusals = refusalsOf({ raw: { ...WIDER, checked, claim } });
    expect(refusals.length).toBe(1);
    expect(refusals[0]).toContain("`claim.quote` and every `checked` line share one detail budget");
    expect(refusals[0]).toContain("DETAIL_PROSE_VISIBLE_MAX");
  });
});

describe("the registry's witness fixtures", () => {
  const entry = BOT_FORM_KINDS.find((candidate) => candidate.kind === "witness")!;
  const cards = entry.fixtures.map((raw) => sentCard({ raw }));

  it("cover all three materiality labels", () => {
    expect(cards.map((card) => leadRun({ card }))).toEqual([
      { bold: true, text: "Contradicted. ", type: "text" },
      { bold: true, text: "Wider impact. ", type: "text" },
      { bold: true, text: "Missing fact. ", type: "text" },
    ]);
  });

  it("cover checked absent and present", () => {
    expect(cards.map((card) => card.detail.length)).toEqual([1, 3, 3]);
  });
});
