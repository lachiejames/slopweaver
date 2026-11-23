/**
 * The derived-card-voice gate: that it reads the prose a DERIVATION composes rather than the fields a caller
 * filled, that it refuses above the fold and only warns below it, that a fixture which stopped parsing or
 * stopped deriving anything is reported as unjudgeable rather than clean, and that a machine with no
 * operator profile is told the voice half did not run instead of being told it passed.
 *
 * The last property is the one worth a test rather than a comment. A gate whose subject lives off-repo has
 * exactly one way to become a lie — reporting `clean` on a machine that could not see its own rules — and
 * that reading is indistinguishable from a real pass unless something asserts the difference.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkDerivedCardVoice,
  type DerivedCardJudgement,
  judgeDerivedCard,
  runDerivedCardVoice,
} from "../../../devLint/derivedCardVoice.js";
import { err, ok } from "../../../lib/result.js";
import type { BotFormKind } from "../../../outbound/artifact/botFormKinds.js";
import { BOT_FORM_KINDS } from "../../../outbound/artifact/botFormKinds.js";
import { SlackDeliveryErrors } from "../../../outbound/slack/deliveryErrors.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";

/** The one rule this whole gate exists for, as the operator's own list spells it. */
const EM_DASH: readonly ExactVoiceRule[] = [{ kind: "literal", value: "—" }];

/** A minimal card artifact, so a synthetic kind can put chosen prose on a chosen side of the fold. */
function cardKind({ kind, tldr, detail }: { kind: string; tldr: string; detail: string }): BotFormKind {
  return {
    fallback: false,
    fixtures: [{ kind }],
    kind,
    parse: () =>
      ok({
        artifact: {
          citations: [],
          detail: [{ runs: [{ text: detail, type: "text" as const }], type: "paragraph" as const }],
          index: [],
          kind: "update" as const,
          media: [],
          tldr,
        },
        unresolvedOwners: [],
      }),
    what: "a synthetic kind used only by this test",
  };
}

/** The ONE judgement a single-fixture kind produces. Throws rather than branching, per testing.md. */
function judgedOnce({ entry, rules }: { entry: BotFormKind; rules: readonly ExactVoiceRule[] }): DerivedCardJudgement {
  const judgements = judgeDerivedCard({ entry, rules });
  if (judgements.length !== 1) {
    throw new Error(`expected one judgement for a single-fixture kind, got ${String(judgements.length)}`);
  }
  return judgements[0]!;
}

/** What one run wrote, split by stream. */
function run({
  kinds,
  rules,
  rulesAvailable,
}: {
  kinds: readonly BotFormKind[];
  rules: readonly ExactVoiceRule[];
  rulesAvailable: boolean;
}): { readonly code: number; readonly out: string; readonly error: string } {
  let out = "";
  let error = "";
  const code = checkDerivedCardVoice({
    kinds,
    rules,
    rulesAvailable,
    writeError: (text) => {
      error += text;
    },
    writeOut: (text) => {
      out += text;
    },
  });
  return { code, error, out };
}

describe("judgeDerivedCard — what it reads", () => {
  it("finds a rule the DERIVATION minted into the TL;DR, which no field carried", () => {
    const judgement = judgedOnce({
      entry: cardKind({ detail: "Nothing here.", kind: "synthetic", tldr: "Gateway 7d — 12 fired." }),
      rules: EM_DASH,
    });
    expect(judgement.refusals.length).toBe(1);
    expect(judgement.refusals[0]).toContain("tldr:");
    expect(judgement.warnings).toEqual([]);
  });

  it("only WARNS on the same rule below the fold — owner ruling, no hard blocks for voice", () => {
    const judgement = judgedOnce({
      entry: cardKind({ detail: "Owner — confirm the rollback.", kind: "synthetic", tldr: "Gateway 7d." }),
      rules: EM_DASH,
    });
    expect(judgement.refusals).toEqual([]);
    expect(judgement.warnings.length).toBe(1);
    expect(judgement.warnings[0]).toContain("detail[0]");
  });

  it("says nothing at all when the operator configured no rules", () => {
    const judgement = judgedOnce({
      entry: cardKind({ detail: "Owner — confirm.", kind: "synthetic", tldr: "Gateway 7d — 12 fired." }),
      rules: [],
    });
    expect(judgement.refusals).toEqual([]);
    expect(judgement.warnings).toEqual([]);
    expect(judgement.unjudgeable).toEqual([]);
  });

  it("reports a fixture that no longer parses as UNJUDGEABLE, carrying the parser's own violations", () => {
    const entry: BotFormKind = {
      fallback: false,
      fixtures: [{ kind: "synthetic" }],
      kind: "synthetic",
      parse: () =>
        err(SlackDeliveryErrors.formInvalid({ reasons: ["tldr: Invalid input: expected string, received undefined"] })),
      what: "a kind whose fixture has drifted out of its own schema",
    };
    const judgement = judgedOnce({ entry, rules: EM_DASH });
    expect(judgement.regions).toBe(0);
    expect(judgement.unjudgeable[0]).toContain("canonical fixture 0 no longer parses");
    expect(judgement.unjudgeable[1]).toBe("tldr: Invalid input: expected string, received undefined");
  });

  it("reports a fixture that derives NO prose as unjudgeable, so a gutted one cannot read as clean", () => {
    const entry: BotFormKind = {
      fallback: false,
      fixtures: [{ kind: "synthetic" }],
      kind: "synthetic",
      parse: () =>
        ok({
          artifact: { citations: [], detail: [], index: [], kind: "update" as const, media: [], tldr: "  " },
          unresolvedOwners: [],
        }),
      what: "a kind whose fixture provokes nothing",
    };
    const judgement = judgedOnce({ entry, rules: EM_DASH });
    expect(judgement.regions).toBe(0);
    expect(judgement.unjudgeable[0]).toContain("derives NO prose at all");
  });
});

describe("checkDerivedCardVoice — the three endings", () => {
  it("REFUSES an above-the-fold match, with the four-line block and the gate's own name", () => {
    const kinds = [cardKind({ detail: "Nothing here.", kind: "synthetic", tldr: "Gateway 7d — 12 fired." })];
    const { code, error } = run({ kinds, rules: EM_DASH, rulesAvailable: true });
    expect(code).toBe(1);
    expect(error).toContain("Passing dev lint is blocked because the `derived-card-voice` gate");
    expect(error).toContain("1 above-the-fold violation(s) across 1 fixture(s) of 1 kind(s)");
    expect(error).toContain("There is no override for this lint gate at run time.");
  });

  it("passes a below-the-fold match, printing the warning on stdout and refusing nothing", () => {
    const kinds = [cardKind({ detail: "Owner — confirm.", kind: "synthetic", tldr: "Gateway 7d." })];
    const { code, out, error } = run({ kinds, rules: EM_DASH, rulesAvailable: true });
    expect(code).toBe(0);
    expect(out).toContain("derived-card-voice: warning: synthetic[0] below the fold, detail[0]");
    expect(error).toBe("");
  });

  it("refuses an unjudgeable fixture under its OWN declaration, not the voice one", () => {
    const entry: BotFormKind = {
      fallback: false,
      fixtures: [{ kind: "synthetic" }],
      kind: "synthetic",
      parse: () => err(SlackDeliveryErrors.formInvalid({ reasons: ["tldr: Invalid input"] })),
      what: "a kind whose fixture has drifted",
    };
    const { code, error } = run({ kinds: [entry], rules: EM_DASH, rulesAvailable: true });
    expect(code).toBe(1);
    expect(error).toContain("canonical fixture 0 no longer parses");
    expect(error).toContain("1 of 1 declared fixture(s)");
    expect(error).toContain("botFormKinds.ts");
  });

  it("says the voice half DID NOT RUN when no profile was found, rather than reporting clean", () => {
    const kinds = [cardKind({ detail: "Nothing here.", kind: "synthetic", tldr: "Gateway 7d — 12 fired." })];
    const { code, out } = run({ kinds, rules: [], rulesAvailable: false });
    expect(code).toBe(0);
    expect(out).toContain("voice half DID NOT RUN");
    expect(out).toContain("structural half CLEAN (1 kind(s), 1 fixture(s), 2 derived region(s))");
    expect(out).not.toContain("clean (");
  });

  it("still refuses an unparseable fixture with no profile, because that half needs no private rules", () => {
    const entry: BotFormKind = {
      fallback: false,
      fixtures: [{ kind: "synthetic" }],
      kind: "synthetic",
      parse: () => err(SlackDeliveryErrors.formInvalid({ reasons: ["tldr: Invalid input"] })),
      what: "a kind whose fixture has drifted",
    };
    const { code, error } = run({ kinds: [entry], rules: [], rulesAvailable: false });
    expect(code).toBe(1);
    expect(error).toContain("canonical fixture 0 no longer parses");
  });

  it("reports clean with the rule count, so a pass cannot hide an empty rule list", () => {
    const kinds = [cardKind({ detail: "Nothing here.", kind: "synthetic", tldr: "Gateway 7d." })];
    const { code, out } = run({ kinds, rules: EM_DASH, rulesAvailable: true });
    expect(code).toBe(0);
    expect(out).toBe(
      "derived-card-voice: clean (1 kind(s), 1 fixture(s), 2 derived region(s), 1 operator rule(s) applied)\n",
    );
  });
});

describe("runDerivedCardVoice — reading the operator profile", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** Runs the gate over a throwaway home, capturing both streams. */
  function runOver({ home }: { home: string }): { code: number; error: string[]; out: string[] } {
    const error: string[] = [];
    const out: string[] = [];
    const code = runDerivedCardVoice({
      home,
      writeError: (text) => {
        error.push(text);
      },
      writeOut: (text) => {
        out.push(text);
      },
    });
    return { code, error, out };
  }

  it("exits 1 and judges nothing over a corrupt profile.json, rather than reporting the voice half unrun", () => {
    const home = mkdtempSync(join(tmpdir(), "dcv-corrupt-"));
    homes.push(home);
    writeFileSync(join(home, "profile.json"), "{");
    const { code, error, out } = runOver({ home });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(error).toHaveLength(1);
    expect(error[0]).toContain(join(home, "profile.json"));
    expect(error[0]).toContain("No fixture was judged.");
  });

  it("runs the structural half and says the voice half did not run when there is no profile at all", () => {
    const home = mkdtempSync(join(tmpdir(), "dcv-absent-"));
    homes.push(home);
    const { code, error, out } = runOver({ home });
    expect(code).toBe(0);
    expect(error).toEqual([]);
    expect(out.join("")).toContain("voice half DID NOT RUN");
  });
});

describe("the real registry", () => {
  it("has every declared kind judgeable, which is what makes the gate's coverage claim structural", () => {
    expect(BOT_FORM_KINDS.length).toBeGreaterThan(0);
    const unjudgeable = BOT_FORM_KINDS.flatMap((entry) => judgeDerivedCard({ entry, rules: [] }))
      .filter((judgement) => judgement.unjudgeable.length > 0)
      .map((judgement) => judgement.kind);
    expect(unjudgeable).toEqual([]);
  });

  it("reaches the separator the alert summary's derivation hard-codes, which is the original defect's home", () => {
    // The em dash `deriveTldr` once minted is now a `·`, so the witness is that rule rather than the em
    // dash: point the gate at the separator actually in the code and it must fire on the TL;DR the
    // derivation composed. Every path here is a region no caller filled.
    const entry = BOT_FORM_KINDS.find((candidate) => candidate.kind === "alert-summary")!;
    const separated = judgeDerivedCard({ entry, rules: [{ kind: "literal", value: "·" }] });
    expect(separated[0]!.kind).toBe("alert-summary[0]");
    expect(separated[0]!.refusals.map((refusal) => refusal.split(":")[0])).toEqual(["tldr", "index[0]", "index[1]"]);
  });
});
