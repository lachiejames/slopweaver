/**
 * The Codex host's full driver parity, pinned so ordinary careful work cannot quietly take it back.
 *
 * This claim has already been lost once. The owner ruled that the Codex host may use subagents, the ruling
 * lived only in a stored memory, and `AGENTS.md` rule 5 plus two skills went on saying the opposite for
 * seventeen days — so every session read the rule and none read the memory. The owner settled it a second time
 * and generalised it: maximum capability is the guiding principle. A prose rule
 * that nothing checks is a rule the next rewrite rounds off, so both halves are asserted here — the parity
 * statements that must stay, and the exact degrading sentences that must never come back.
 *
 * Same two-describe shape as `atlasIntentCriteria.test.ts`: the first exercises the pure matchers on inline
 * fixtures and never touches disk, the second reads the real canon files.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** The repository root, four levels above this file. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/**
 * One page or phrase flattened for matching: lowercased, with every run of whitespace collapsed to a single
 * space, so a quoted sentence still matches after the formatter has wrapped it across two lines.
 *
 * @param text the page or phrase
 * @returns the flattened form
 */
function flatten({ text }: { text: string }): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Which required phrases a page is missing, matched against the flattened page so line wrapping is invisible.
 *
 * @param text the whole page
 * @param required the phrases that must appear
 * @returns the missing phrases, in the order they were required
 */
function missingPhrases({ text, required }: { text: string; required: readonly string[] }): readonly string[] {
  const haystack = flatten({ text });
  return required.filter((phrase) => !haystack.includes(flatten({ text: phrase })));
}

/**
 * Which forbidden phrases a page still carries — the retired sentences that put Codex below Claude.
 *
 * @param text the whole page
 * @param forbidden the phrases that must not appear
 * @returns the surviving phrases, in the order they were forbidden
 */
function survivingPhrases({ text, forbidden }: { text: string; forbidden: readonly string[] }): readonly string[] {
  const haystack = flatten({ text });
  return forbidden.filter((phrase) => haystack.includes(flatten({ text: phrase })));
}

/**
 * Reads one repo-relative canon file.
 *
 * @param path the repo-relative path
 * @returns the whole file as text
 */
function canonFile({ path }: { path: string }): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

describe("missingPhrases", () => {
  it("names every absent phrase, in the order required", () => {
    expect(missingPhrases({ required: ["alpha", "beta", "gamma"], text: "only beta is here" })).toEqual([
      "alpha",
      "gamma",
    ]);
  });

  it("is empty when every phrase is present, so the guard can pass", () => {
    expect(missingPhrases({ required: ["alpha", "beta"], text: "alpha and beta" })).toEqual([]);
  });

  it("matches regardless of case, because a phrase may open a sentence", () => {
    expect(missingPhrases({ required: ["substitute host"], text: "Substitute host, not a degraded one" })).toEqual([]);
  });

  it("matches a phrase the formatter has wrapped across two lines", () => {
    expect(missingPhrases({ required: ["a degraded one"], text: "not a\ndegraded one" })).toEqual([]);
  });
});

describe("survivingPhrases", () => {
  it("names every forbidden phrase still present, in the order forbidden", () => {
    expect(survivingPhrases({ forbidden: ["ban a", "ban b"], text: "ban b is still here" })).toEqual(["ban b"]);
  });

  it("is empty on a clean page, so the guard can pass", () => {
    expect(survivingPhrases({ forbidden: ["ban a"], text: "nothing of the sort" })).toEqual([]);
  });
});

describe("AGENTS.md rule 5", () => {
  const page = canonFile({ path: "AGENTS.md" });

  it("states Codex as a substitute host driving every tier the Claude host drives", () => {
    expect(
      missingPhrases({
        required: ["Codex is a SUBSTITUTE host", "every tier the Claude host drives", "subagents included"],
        text: page,
      }),
    ).toEqual([]);
  });

  it("keeps the one real prohibition, scoped to every model rather than to Claude", () => {
    expect(missingPhrases({ required: ["no hidden executor of any model"], text: page })).toEqual([]);
  });

  it("no longer carries the retired sentence that made Codex the lesser host", () => {
    expect(survivingPhrases({ forbidden: ["never invokes Claude as a hidden executor"], text: page })).toEqual([]);
  });
});

describe("the loop skill's Codex page", () => {
  const page = canonFile({ path: "skills/loop/reference/codex.md" });

  it("opens on parity and carries the reason for it", () => {
    expect(
      missingPhrases({
        required: [
          "Codex is a SUBSTITUTE host, not a degraded one",
          "it is allowed to use subagents",
          "giving agents maximum capability",
        ],
        text: page,
      }),
    ).toEqual([]);
  });

  it("attributes a refused tier to the MODE rather than to the host", () => {
    expect(
      missingPhrases({
        required: ["refused **by mode**", "never because this host is Codex"],
        text: page,
      }),
    ).toEqual([]);
  });

  it("names the tiers rule 5 is too small to carry, so nothing was lost moving them out", () => {
    expect(
      missingPhrases({
        required: [
          "Every tier the Claude host can drive, this host drives",
          "`fresh-visible-session` dispatch included",
          "Codex is a SUBSTITUTE host, not a degraded one",
        ],
        text: page,
      }),
    ).toEqual([]);
  });
});

describe("the pickup skill's Codex-native adapter", () => {
  const page = canonFile({ path: "skills/pickup/SKILL.md" });

  it("grants the subagent the Claude host has", () => {
    expect(
      missingPhrases({
        required: ["full driver parity", "a subagent is available here exactly as it is on the Claude host"],
        text: page,
      }),
    ).toEqual([]);
  });

  it("no longer carries the flat subagent ban", () => {
    expect(survivingPhrases({ forbidden: ["spawn a subagent, or silently mutate a foreign run"], text: page })).toEqual(
      [],
    );
  });
});

describe("docs/doctrine-rationale/rule-5.md", () => {
  const page = canonFile({ path: "docs/doctrine-rationale/rule-5.md" });

  it("carries a rule 5 entry with the ruling and the principle it generalised to", () => {
    expect(
      missingPhrases({
        required: [
          "# Rule 5 · Right model for the host",
          "Codex may use subagents",
          "the guiding principle is to give agents maximum capability",
          "Codex was never required to ban subagents",
        ],
        text: page,
      }),
    ).toEqual([]);
  });

  it("records that rule 2 was untouched, so parity is never read as a visibility relaxation", () => {
    expect(
      missingPhrases({
        required: ["[Rule 2](rule-2.md) is untouched", "nothing headless, nothing detached"],
        text: page,
      }),
    ).toEqual([]);
  });
});
