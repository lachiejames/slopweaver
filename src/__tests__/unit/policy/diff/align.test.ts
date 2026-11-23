import { describe, expect, it } from "vitest";

import { alignDocuments, isMaterial } from "../../../../policy/diff/align.js";
import { formattingKinds } from "../../../../policy/diff/formatting.js";
import { documentUnits } from "../../../../policy/diff/units.js";

/** Align two markdown documents. */
function align({ before, after }: { before: string; after: string }): ReturnType<typeof alignDocuments> {
  return alignDocuments({
    after: documentUnits({ markdown: after }).units,
    before: documentUnits({ markdown: before }).units,
  });
}

describe("alignDocuments", () => {
  it("calls byte-identical lines unchanged", () => {
    const rows = align({ after: "# Title\n\nSame text.", before: "# Title\n\nSame text." });
    expect(rows.map((row) => row.kind)).toEqual(["same", "same"]);
    expect(rows[1]!.section).toBe("Title");
  });

  it("calls the same words in bold formatting, never material", () => {
    const rows = align({ after: "**Owner:** platform team", before: "Owner: platform team" });
    expect(rows.map((row) => row.kind)).toEqual(["formatting"]);
    expect(rows[0]!.formatting).toEqual(["emphasis"]);
  });

  it("calls a sentence split into a list one structure row, not a removal and additions", () => {
    const rows = align({
      after: "- staging is separate from production\n- the dump is masked",
      before: "Staging is separate from production, the dump is masked.",
    });
    expect(rows.map((row) => row.kind)).toEqual(["formatting"]);
    expect(rows[0]!.formatting).toEqual(["structure", "case", "punctuation"]);
    expect(rows[0]!.after.length).toBe(2);
  });

  it("pairs a short opening line with the long paragraph it was split out of", () => {
    const rows = align({
      after: "Controls in place:\n\n- engineers must first obtain an entitlement in Privileged Access Manager",
      before:
        "Controls in place: engineers in the group must first obtain the approval-gated entitlement in GCP Privileged Access Manager.",
    });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
    expect(rows[0]!.before.length).toBe(1);
    expect(rows[0]!.after.length).toBe(2);
  });

  it("calls a link re-pointed under the same words material", () => {
    const rows = align({ after: "See [runbook](https://evil.test/r).", before: "See [runbook](https://good.test/r)." });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("calls a diagram swapped under the same caption material", () => {
    const rows = align({ after: "![Topology](diff-image:bbbb)", before: "![Topology](diff-image:aaaa)" });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("calls a link added to a phrase formatting", () => {
    const rows = align({ after: "See the [runbook](https://good.test/r).", before: "See the runbook." });
    expect(rows.map((row) => [row.kind, row.formatting])).toEqual([["formatting", ["links"]]]);
  });

  it("calls a flipped comparison material", () => {
    const rows = align({
      after: "Accounts inactive > 30 days are removed.",
      before: "Accounts inactive < 30 days are removed.",
    });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("calls a changed front matter value material", () => {
    const rows = align({ after: "---\nowner: nobody\n---\nBody.", before: "---\nowner: alice\n---\nBody." });
    expect(rows.map((row) => [row.kind, row.after[0]!.kind])).toEqual([
      ["changed", "front"],
      ["same", "paragraph"],
    ]);
  });

  it("calls a link re-pointed while its words were also restyled material", () => {
    const rows = align({
      after: "See [the runbook](https://evil.test/r).",
      before: "See the [runbook](https://good.test/r).",
    });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("calls two same-text links swapping their addresses material", () => {
    const rows = align({
      after: "Policy [here](https://a.test/procedure), procedure [here](https://a.test/policy).",
      before: "Policy [here](https://a.test/policy), procedure [here](https://a.test/procedure).",
    });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("calls an operator changed inside a code span material", () => {
    const rows = align({ after: "Require `mfa || vpn` always.", before: "Require `mfa && vpn` always." });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("calls a signed number losing its minus material, in prose and in front matter", () => {
    const prose = align({ after: "The offset is 30 days.", before: "The offset is -30 days." });
    const front = align({ after: "---\nretention: 1\n---\nBody.", before: "---\nretention: -1\n---\nBody." });
    expect([prose.map((row) => row.kind), front.map((row) => row.kind)]).toEqual([["changed"], ["changed", "same"]]);
  });

  it("calls a link re-pointed while another is unlinked material", () => {
    const rows = align({
      after: "[Access Policy](https://v.test/B) and Backup Policy.",
      before: "[Access Policy](https://v.test/A) and [Backup Policy](https://v.test/B).",
    });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("calls a diagram added or removed material, whatever its caption says", () => {
    const removed = align({ after: "Topology", before: "![Topology](diff-image:aaaa)" });
    const added = align({ after: "Diagram: ![Topology](diff-image:bbbb)", before: "Diagram: Topology" });
    expect([removed.map((row) => row.kind), added.map((row) => row.kind)]).toEqual([["changed"], ["changed"]]);
  });

  it("calls code edited while another span is unmarked material, and unmarking alone formatting", () => {
    const edited = align({ after: "Use `a || b` or a b.", before: "Use `a && b` or `a || b`." });
    const unmarked = align({ after: "Open utils.ts first.", before: "Open `utils.ts` first." });
    expect([edited.map((row) => row.kind), unmarked.map((row) => row.kind)]).toEqual([["changed"], ["formatting"]]);
  });

  it("calls a changed separator between digits material", () => {
    const rows = align({ after: "Budget 1.000 a year.", before: "Budget 1,000 a year." });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("keeps an unrelated new line as an addition", () => {
    const rows = align({ after: "Kept line here.\n\nA brand new sentence about backups.", before: "Kept line here." });
    expect(rows.map((row) => row.kind)).toEqual(["same", "added"]);
  });

  it("keeps a moved line as a removal and an addition, since where it stands is part of what it says", () => {
    const reordered = align({
      after: "# Restore\n\nDelete the old cluster.\n\nBack up the database.",
      before: "# Restore\n\nBack up the database.\n\nDelete the old cluster.",
    });
    const nested = align({
      after: "- Allowed:\n  - USB storage devices\n- Prohibited:\n  - Cameras",
      before: "- Allowed:\n  - Cameras\n- Prohibited:\n  - USB storage devices",
    });
    expect([reordered, nested].map((rows) => rows.map((row) => row.kind))).toEqual([
      ["same", "removed", "same", "added"],
      ["same", "removed", "removed", "same", "added", "added"],
    ]);
  });

  it("calls a link holding no word, re-pointed, material", () => {
    const rows = align({
      after: "Policy text [#](https://evil.test/p).",
      before: "Policy text [#](https://good.test/p).",
    });
    const dash = align({ after: "See [—](https://evil.test/p).", before: "See [—](https://good.test/p)." });
    expect([rows.map((row) => row.kind), dash.map((row) => row.kind)]).toEqual([["changed"], ["changed"]]);
  });

  it("calls code holding no word moved to another phrase material", () => {
    const rows = align({
      after: "Scope applies to prod, not `--` to dev.",
      before: "Scope `--` applies to prod, not to dev.",
    });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("reads every character of code, at either end and in fences and front matter", () => {
    const cases = [
      { after: "Run `rm -rf .` nightly.", before: "Run `rm -rf *` nightly." },
      { after: "Run rm -rf nightly.", before: "Run `rm -rf *` nightly." },
      { after: "```\nchmod -R 755 *\n```", before: "```\nchmod -R 755 .\n```" },
      { after: '---\naccess: ""\n---\nBody.', before: '---\naccess: "*"\n---\nBody.' },
      { after: "Cost is a*b.", before: "Cost is `a**b`." },
      { after: "Delete .log files.", before: "Delete `*.log` files." },
    ];
    expect(cases.map((sides) => align(sides)[0]!.kind)).toEqual([
      "changed",
      "changed",
      "changed",
      "changed",
      "changed",
      "changed",
    ]);
  });

  it("reads whitespace that changes code, and a character moved across the code's edge", () => {
    const cases = [
      { after: "Run `rm -rf / tmp/build` nightly.", before: "Run `rm -rf /tmp/build` nightly." },
      {
        after: "```\nif admin:\n    allow()\n    deny()\n```",
        before: "```\nif admin:\n    allow()\ndeny()\n```",
      },
      {
        after: "---\nsecurity:\n  mfa: true\n  legacy: false\n---\nBody.",
        before: "---\nsecurity:\n  mfa: true\nlegacy: false\n---\nBody.",
      },
      { after: "Set `PATH=/usr/bin:` now.", before: "Set `PATH=/usr/bin`: now." },
      { after: '```\ngrep "login failed" auth.log\n```', before: '```\ngrep "login  failed" auth.log\n```' },
      { after: "```\nrole admin\n```", before: "```\nrole\tadmin\n```" },
      {
        after: "```\nGET /admin HTTP/1.1\nHost: a\nX-Debug: 1\n```",
        before: "```\nGET /admin HTTP/1.1\nHost: a\n\nX-Debug: 1\n```",
      },
    ];
    const trailing = align({ after: "```\n\nkey: value\n```", before: "```\nkey: value   \n```" });
    expect([cases.map((sides) => align(sides)[0]!.kind), trailing[0]!.kind]).toEqual([
      ["changed", "changed", "changed", "changed", "changed", "changed", "changed"],
      "formatting",
    ]);
  });

  it("calls a line moved under another parent material, and a paragraph split into a list where it stood formatting", () => {
    const cases = [
      {
        after: "- Allowed:\n  - Email\n  - Prohibited:\n  - USB drives",
        before: "- Allowed:\n  - Email\n- Prohibited:\n  - USB drives",
      },
      {
        after: "- Prohibited:\n  - USB drives\n- Personal email",
        before: "- Prohibited:\n  - USB drives\n  - Personal email",
      },
      {
        after: "## Allowed\n\nEmail.\n\n### Prohibited\n\nUSB.",
        before: "## Allowed\n\nEmail.\n\n## Prohibited\n\nUSB.",
      },
      { after: "- Required:\n\n**Prohibited:** USB.", before: "- Required:\n\n## Prohibited\n\nUSB." },
      {
        after: "- Allowed:\n  - email\n  - Prohibited:\n    - USB drives",
        before: "- Allowed: email\n- Prohibited: USB drives",
      },
      { after: "Controls:\n\n- staging\n  - masked dump", before: "Controls:\n\nStaging, masked dump." },
    ];
    const split = align({
      after: "Controls:\n\n- staging\n- masked dump",
      before: "Controls:\n\nStaging, masked dump.",
    });
    expect([
      cases.map((sides) => align(sides).some((row) => row.kind === "changed")),
      split.map((row) => row.kind),
    ]).toEqual([
      [true, true, true, true, true, true],
      ["same", "formatting"],
    ]);
  });

  it("calls a dot inside a host name, or an en-dash minus, material", () => {
    const host = align({ after: "Backups go to backup-acme.com.", before: "Backups go to backup.acme.com." });
    const minus = align({ after: "Store at 20 °C.", before: "Store at –20 °C." });
    expect([host.map((row) => row.kind), minus.map((row) => row.kind)]).toEqual([["changed"], ["changed"]]);
  });

  it("calls a bracket dropped as code is unmarked material, and soft punctuation around it formatting", () => {
    const dropped = align({ after: "Call f(x.", before: "Call `f(x)`." });
    const kept = align({ after: "Call **f(x)**, then stop.", before: "Call `f(x)` then stop." });
    expect([dropped.map((row) => row.kind), kept.map((row) => row.kind)]).toEqual([["changed"], ["formatting"]]);
  });

  it("calls code unmarked where the other side reads differently at those words material", () => {
    const rows = align({ after: "Set env-prod, not env.prod.", before: "Set `env.prod`, not env-prod." });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("calls a link moved to another phrase with the same words material", () => {
    const rows = align({
      after: "Policy here, procedure [here](https://a.test/A).",
      before: "Policy [here](https://a.test/A), procedure here.",
    });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });

  it("calls a statement turned into a question material", () => {
    const rows = align({ after: "Backups are encrypted?", before: "Backups are encrypted." });
    expect(rows.map((row) => row.kind)).toEqual(["changed"]);
  });
});

describe("formattingKinds", () => {
  it("names punctuation as the residue when nothing else differs", () => {
    const before = documentUnits({ markdown: "Owner, platform" }).units;
    const after = documentUnits({ markdown: "Owner: platform" }).units;
    expect(formattingKinds({ after, before })).toEqual(["punctuation"]);
  });

  it("names a link and code span that were added", () => {
    const before = documentUnits({ markdown: "See NET-38 in utils.ts" }).units;
    const after = documentUnits({ markdown: "See [NET-38](https://x.test) in `utils.ts`" }).units;
    expect(formattingKinds({ after, before })).toEqual(["code", "links"]);
  });
});

describe("isMaterial", () => {
  it("holds changed, added and removed material, and nothing else", () => {
    const kinds = ["same", "formatting", "changed", "added", "removed"] as const;
    expect(kinds.filter((kind) => isMaterial({ kind }))).toEqual(["changed", "added", "removed"]);
  });
});
