/**
 * The authoring file round-trips a C3 draft exactly, renders a description the CI gate accepts, and DECLINES every
 * shape it cannot represent rather than guessing at it.
 *
 * `EXAMPLE_PR_FORM` is reused rather than a fresh fixture: it already carries every part of the shape — two ranked
 * risks, a reason slot, a sized screenshot, a check, a Not-checked item and a re-run command — so a round trip of it
 * exercises the whole grammar. The cut-4 fixtures add a not-seen problem, two screenshots and a fold with a note and a
 * test list.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseAuthoringFile, renderAuthoringFile } from "../../../../outbound/github/authoringFile.js";
import { EXAMPLE_PR_FORM } from "../../../../outbound/github/formExample.js";
import { renderPrBody } from "../../../../outbound/github/render.js";
import { stampForWrite } from "../../../../outbound/github/stamp.js";
import type { PrForm, PrFormDraft } from "../../../../outbound/github/types.js";
import { gatePrBody } from "../../../../prformat/prBodyGate.js";
import { FEATURE_BODY, FIX_BODY, formOf, TESTS_BODY, TESTS_ONLY_BODY } from "./fixtures.js";

/**
 * The draft a rendered file reads back as.
 *
 * @param form the draft to render and parse
 * @returns the parsed draft
 */
function roundTrip({ form }: { form: PrFormDraft }): PrFormDraft {
  return unwrap(parseAuthoringFile({ source: renderAuthoringFile({ form }) })).form;
}

/**
 * The refusal a file's text earns.
 *
 * @param source the whole file
 * @returns every reason parsing declined, joined
 */
function refusal({ source }: { source: string }): string {
  return unwrapErr(parseAuthoringFile({ source })).join("\n");
}

const EXAMPLE_FILE = renderAuthoringFile({ form: EXAMPLE_PR_FORM });

describe("renderAuthoringFile / parseAuthoringFile — round trip", () => {
  it("parses the example back to the exact draft it was rendered from", () => {
    expect(roundTrip({ form: EXAMPLE_PR_FORM })).toStrictEqual(EXAMPLE_PR_FORM);
  });

  it("round-trips every cut-4 fixture: two screenshots, a not-seen problem, a fold, and two reasons", () => {
    const forms: readonly PrForm[] = [TESTS_BODY, FIX_BODY, FEATURE_BODY, TESTS_ONLY_BODY].map((body) =>
      formOf({ body }),
    );
    expect(forms.map((form) => roundTrip({ form }))).toStrictEqual(forms);
  });

  it("renders a description the real PR gate accepts as C3 once the door stamps it", () => {
    const form = unwrap(stampForWrite({ draft: roundTrip({ form: EXAMPLE_PR_FORM }), today: "2026-10-01" }));
    expect(gatePrBody({ body: unwrap(renderPrBody({ form })), owned: true })).toStrictEqual({
      errors: [],
      shape: "c3",
    });
  });

  it("carries a pulled-body-hash through the round trip when one is given, and omits it otherwise", () => {
    const file = renderAuthoringFile({ form: EXAMPLE_PR_FORM, pulledBodyHash: "deadbeef" });
    expect(unwrap(parseAuthoringFile({ source: file })).pulledBodyHash).toBe("deadbeef");
    expect(EXAMPLE_FILE).not.toContain("pulled-body-hash");
    expect(unwrap(parseAuthoringFile({ source: EXAMPLE_FILE })).pulledBodyHash).toBe(undefined);
  });

  it("writes a problem not seen yet as problem-seen: not-seen, with its reason", () => {
    const form = formOf({ body: FEATURE_BODY });
    expect(renderAuthoringFile({ form })).toContain("problem-seen:\n  not-seen: Not seen on a real sign-in yet\n");
    expect(roundTrip({ form }).problemSeen).toStrictEqual({ kind: "not-seen", why: "Not seen on a real sign-in yet" });
  });

  it("writes the sections in the order the description shows them, each slot on its documented lines", () => {
    expect([...EXAMPLE_FILE.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toStrictEqual([
      "Explainer",
      "Proof of the problem",
      "Proof of the solution",
      "Checks",
      "Not checked, and why",
      "Re-run",
    ]);
    expect(EXAMPLE_FILE).toContain(
      "## Proof of the problem\nreason: The short export was reported in a file, and nothing on screen changes.\n",
    );
    expect(EXAMPLE_FILE).toContain(
      "## Proof of the solution\nOn this branch, `widgets export` keeps the last row.\n" +
        "![the exported report with its last row present]" +
        "(https://github.com/user-attachments/assets/0b6a1c2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d){width=800}\nrun by: agent\n",
    );
    expect(EXAMPLE_FILE).toContain(
      "## Not checked, and why\n- A sheet over 10,000 rows — No fixture that large exists",
    );
  });

  it("writes each risk item as frontmatter: its kind of worst case, then a check or the reason nothing checked it", () => {
    expect(EXAMPLE_FILE).toContain(
      "risk:\n" +
        "  - kind: something-working-breaks\n" +
        "    worst: an export refuses a sheet it used to read\n" +
        "    check: The round-trip test covers a sheet ending on a blank line\n" +
        "  - kind: something-working-breaks\n" +
        "    worst: a very large export is slower\n" +
        "    unchecked: no sheet that large was exported\n",
    );
  });

  it("refuses a risk kind outside the three, naming them and the level each implies", () => {
    const source = EXAMPLE_FILE.replace("  - kind: something-working-breaks\n", "  - kind: bad\n");
    expect(refusal({ source })).toContain("loses-leaks-or-changes-off-machine");
  });

  it("writes check groups after the base checks, each label a bullet with its checks indented under it", () => {
    const form: PrFormDraft = {
      ...EXAMPLE_PR_FORM,
      checkGroups: [
        {
          items: [[{ kind: "text", text: "It keeps the entry." }], [{ kind: "text", text: "It reads the sheet." }]],
          label: [{ kind: "text", text: "On a real export" }],
        },
      ],
    };
    expect(renderAuthoringFile({ form })).toContain(
      "## Checks\n- A description written before this change still reads back to its form.\n" +
        "- On a real export\n  - It keeps the entry.\n  - It reads the sheet.\n",
    );
    expect(roundTrip({ form })).toStrictEqual(form);
  });

  it("round-trips groups with no base check", () => {
    const form: PrFormDraft = {
      ...EXAMPLE_PR_FORM,
      checkGroups: [
        { items: [[{ kind: "text", text: "It keeps the entry." }]], label: [{ kind: "text", text: "On main" }] },
      ],
      checks: [],
    };
    expect(roundTrip({ form })).toStrictEqual(form);
  });

  it("refuses a base check written after a group", () => {
    const source = EXAMPLE_FILE.replace(
      "## Checks\n- A description written before this change still reads back to its form.\n",
      "## Checks\n- On main\n  - It keeps the entry.\n- A description written before this change still reads back.\n",
    );
    expect(refusal({ source })).toContain("the checks with no group come first");
  });

  it("round-trips a Not-checked item whose text and code carry the separator", () => {
    const form: PrFormDraft = {
      ...EXAMPLE_PR_FORM,
      notChecked: [
        {
          check: [
            { kind: "text", text: "One — then another " },
            { kind: "code", text: "a — b" },
          ],
          why: [{ kind: "text", text: "it reads — wrongly" }],
        },
      ],
    };
    expect(roundTrip({ form })).toStrictEqual(form);
  });

  it("round-trips a cell ending in `!` before a link, and a link label carrying `]`", () => {
    const form: PrFormDraft = {
      ...EXAMPLE_PR_FORM,
      explainer: [
        { kind: "text", text: "Broken!" },
        { kind: "link", text: "the [old] run", url: "https://github.com/acme/widgets/pull/1" },
      ],
    };
    expect(roundTrip({ form })).toStrictEqual(form);
  });

  it("keeps a cell's own edge spaces, stripping only the section's edge newlines", () => {
    const form: PrFormDraft = { ...EXAMPLE_PR_FORM, explainer: [{ kind: "text", text: "trailing space " }] };
    expect(roundTrip({ form }).explainer).toStrictEqual([{ kind: "text", text: "trailing space " }]);
  });

  it("leaves the screenshot untouched when only the explainer is edited", () => {
    const edited = EXAMPLE_FILE.replace(/## Explainer\n[^\n]*\n/, "## Explainer\nThe export now keeps the entry.\n");
    const form = unwrap(parseAuthoringFile({ source: edited })).form;
    expect(form.explainer).toStrictEqual([{ kind: "text", text: "The export now keeps the entry." }]);
    expect(form.solutionProof).toStrictEqual(EXAMPLE_PR_FORM.solutionProof);
  });

  it("round-trips a fenced command carrying a fence of its own, a note and a test list in the re-run fold", () => {
    const form: PrFormDraft = {
      ...EXAMPLE_PR_FORM,
      rerun: [
        { kind: "command", lang: "ts", text: "const fence = '```';" },
        { content: [{ kind: "text", text: "Where the row shows up." }], kind: "note" },
        { items: [[{ kind: "text", text: "export.test.ts" }]], kind: "tests" },
      ],
    };
    expect(roundTrip({ form })).toStrictEqual(form);
  });

  it("omits an empty optional section, and reads its absence back as the empty list", () => {
    const form: PrFormDraft = { ...EXAMPLE_PR_FORM, notChecked: [], rerun: [] };
    const file = renderAuthoringFile({ form });
    expect(file).not.toContain("## Not checked, and why");
    expect(file).not.toContain("## Re-run");
    expect(roundTrip({ form })).toStrictEqual(form);
  });

  it("omits an empty Checks section, and reads its absence back as no checks", () => {
    const form: PrFormDraft = { ...EXAMPLE_PR_FORM, checks: [] };
    expect(renderAuthoringFile({ form })).not.toContain("## Checks");
    expect(roundTrip({ form }).checks).toStrictEqual([]);
  });

  it("round-trips a screenshot in Proof of the problem, run by the owner, its picture sized", () => {
    const form: PrFormDraft = {
      ...EXAMPLE_PR_FORM,
      problemProof: {
        image: {
          alt: "the export one row short — on main",
          kind: "image",
          url: "https://github.com/user-attachments/assets/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
          width: 1024,
        },
        kind: "screenshot",
        proves: [
          { kind: "text", text: "On main — before the fix — " },
          { kind: "code", text: "a — b" },
        ],
        runBy: "owner",
      },
    };
    expect(roundTrip({ form })).toStrictEqual(form);
  });

  it("round-trips a re-run command carrying a backtick", () => {
    const form: PrFormDraft = { ...EXAMPLE_PR_FORM, rerun: [{ kind: "command", lang: "sh", text: "echo `date`" }] };
    expect(roundTrip({ form })).toStrictEqual(form);
  });
});

describe("parseAuthoringFile — declines", () => {
  it("declines a reviewer table, and a gold anchor beside Codex review leftovers, each saying where its job went", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("title:", "reviewers: []\ntitle:") })).toBe(
      "retired frontmatter field(s), not part of a C3 description: reviewers (there is no reviewer table). Remove them",
    );
    expect(
      refusal({ source: EXAMPLE_FILE.replace("title:", "gold-anchor: 9f3c1de\nreview-leftovers: []\ntitle:") }),
    ).toBe(
      "retired frontmatter field(s), not part of a C3 description: gold-anchor (a description publishes no gold " +
        "anchor); review-leftovers (Codex review leftovers are a landing-gate finding, acknowledged with --reason). " +
        "Remove them",
    );
  });

  it("declines a risk that is not a list of ranked items", () => {
    const source = EXAMPLE_FILE.replace(/risk:\n(?: {2}[^\n]*\n)+/, "risk: low\n");
    expect(refusal({ source })).toBe("risk is required: a YAML list of ranked risk items, the most urgent first");
  });

  it("refuses a screenshot width outside the bounds at the same gate a --form crosses", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("{width=800}", "{width=4000}") })).toBe(
      "solutionProof.image.width: an image width is at most 2048 pixels",
    );
  });

  it("declines a file with no frontmatter fence", () => {
    expect(refusal({ source: "## Explainer\nx\n" })).toBe("the file must start with a `---` YAML frontmatter block");
  });

  it("declines invalid YAML in the frontmatter", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("title:", "title: [unclosed\nx:") })).toContain(
      "the frontmatter is not valid YAML",
    );
  });

  it("declines an unrecognised frontmatter field", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("title:", "titel: wrong\ntitle:") })).toContain(
      "unknown frontmatter field(s): titel — REFUSED, not ignored.",
    );
  });

  it("withholds a decline that would quote a credential shape, so the token never reaches the log", () => {
    // A synthetic token built at runtime, so no credential shape sits in this file's source.
    const token = `ghp_${"a".repeat(30)}`;
    const source = EXAMPLE_FILE.replace("title:", `${token}: x\ntitle:`);
    expect(source).toContain(token);
    const lines = unwrapErr(parseAuthoringFile({ source }));
    expect(lines.filter((line) => line.includes(token))).toEqual([]);
    expect(lines).toEqual([
      "a refusal here quotes text carrying a credential shape, so it is withheld from this log. Remove the credential " +
        "the secret scan names, and the refusal prints in full",
    ]);
  });

  it("declines each retired field by name, saying where its job went", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("title:", "origin: the thread\ntitle:") })).toBe(
      "retired frontmatter field(s), not part of a C3 description: origin (a description publishes no origin). Remove them",
    );
    expect(refusal({ source: EXAMPLE_FILE.replace("title:", "review:\n  grade: gold\ntitle:") })).toContain(
      "review (a description publishes no grade)",
    );
    expect(refusal({ source: EXAMPLE_FILE.replace("title:", "written-on: 2026-10-01\ntitle:") })).toContain(
      "written-on (no byte of a C3 description depends on the day it is written)",
    );
  });

  it("declines a missing problem-seen, and one carrying both a day and a reason", () => {
    const withoutSeen = EXAMPLE_FILE.replace(/problem-seen:\n(?: {2}[^\n]*\n)+/, "");
    expect(refusal({ source: withoutSeen })).toContain("problem-seen is required");
    const both = EXAMPLE_FILE.replace("problem-seen:\n", "problem-seen:\n  not-seen: not yet\n");
    expect(refusal({ source: both })).toContain("problem-seen is required");
  });

  it("declines a misspelt section header", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("## Checks", "## Chceks") })).toContain(
      'unknown section "## Chceks"',
    );
  });

  it("declines a section out of order", () => {
    const swapped = EXAMPLE_FILE.replace("## Checks\n", "## Checksx\n")
      .replace("## Proof of the problem\n", "## Checks\n")
      .replace("## Checksx\n", "## Proof of the problem\n");
    expect(refusal({ source: swapped })).toContain('"## Proof of the solution" is out of order');
  });

  it("declines a missing required section", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace(/## Explainer\n[^\n]*\n\n/, "") })).toBe(
      "missing required section(s): ## Explainer",
    );
  });

  it("declines a duplicated section", () => {
    expect(refusal({ source: `${EXAMPLE_FILE}\n## Re-run\nagain\n` })).toContain('"## Re-run" appears more than once');
  });

  it("declines text before the first section header", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("## Explainer", "stray text\n\n## Explainer") })).toContain(
      "there is text before the first `## ` section header",
    );
  });

  it("declines an unclosed bold run", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("so **1 report in 40**", "so **1 report in 40") })).toContain(
      "## Explainer: an unclosed `**`",
    );
  });

  it("declines a risk item with neither a check nor the reason nothing checked it", () => {
    const source = EXAMPLE_FILE.replace("    check: The round-trip test covers a sheet ending on a blank line\n", "");
    expect(refusal({ source })).toContain("risk item 1 is a mapping");
  });

  it("declines a proof slot that is neither a reason nor a screenshot's three lines", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("run by: agent\n", "") })).toContain(
      "## Proof of the solution: the section is one line",
    );
    expect(refusal({ source: EXAMPLE_FILE.replace("run by: agent", "run by: a colleague") })).toContain(
      "## Proof of the solution: the section is one line",
    );
  });

  it("declines a picture line carrying words after its picture, which would render nowhere", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("{width=800}\n", "{width=800} and more\n") })).toContain(
      "## Proof of the solution: the section is one line",
    );
  });

  it("declines a Not-checked line with no separator", () => {
    expect(
      refusal({ source: EXAMPLE_FILE.replace("- A sheet over 10,000 rows — ", "- A sheet over 10,000 rows ") }),
    ).toContain('## Not checked, and why: "- A sheet over 10,000 rows No fixture');
  });

  it("declines a Checks line that is not a bullet", () => {
    expect(refusal({ source: EXAMPLE_FILE.replace("## Checks\n- ", "## Checks\n") })).toContain(
      "## Checks: every line is a `- ` bullet",
    );
  });

  it("declines an unclosed fenced code block in the re-run fold", () => {
    expect(refusal({ source: `${EXAMPLE_FILE.trimEnd()}\n\n\`\`\`ts\nopen\n` })).toContain(
      "## Re-run: an unclosed fenced code block",
    );
  });

  it("refuses an explainer over the real word cap, with the real rule's code", () => {
    const long = Array.from({ length: 80 }, () => "word").join(" ");
    expect(refusal({ source: EXAMPLE_FILE.replace(/## Explainer\n[^\n]*\n/, `## Explainer\n${long}\n`) })).toContain(
      "explainer: WORD_CAP: The explainer is 80 words (max 70).",
    );
  });

  it("refuses a screenshot off user-attachments through the real hosting rule", () => {
    const source = EXAMPLE_FILE.replace(
      "https://github.com/user-attachments/assets/0b6a1c2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      "https://example.com/after.png",
    );
    expect(refusal({ source })).toContain("solutionProof.image.url: IMAGE_NOT_USER_ATTACHMENT");
  });
});
