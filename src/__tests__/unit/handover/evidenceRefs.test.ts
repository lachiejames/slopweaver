/**
 * What a row's `evidence:` items name — over the real evidence of six ready findings seated
 * after the trunk had already answered them (`src/handover/trunkMoved.ts` carries the measurement).
 */
import { describe, expect, it } from "vitest";

import { codeEvidencePaths, evidenceRefs } from "../../../handover/evidenceRefs.js";

/** The six rows' own `evidence:` items, verbatim from their front matter. */
const SIX = {
  codexFallback: ["request:be3152bf-0ee7-4089-acc8-a4aaf32aa059", "verb:codex status --check"],
  nightlyImport: [
    "state:runs/forty-nine-memories-disposition",
    "state:live/recipe/definitions/store-import-fleet-nightly.json",
  ],
  prAboveTheFold: [
    "refused line (problem cell, compiled by github vuln body, not authored): '<code>fflate</code> (npm)' — repro: " +
      "slopweaver github vuln body --file <fix.json> --out pr-form.json then slopweaver github stack push --form - --dry-run",
  ],
  reviewApprove: [
    "https://github.com/acme/acme-admin/pull/17961",
    "https://acme.slack.com/archives/C0SYN000003/p1790521567620219",
    "src/cli/commands/github/reviewerArgs.ts",
  ],
  settleRefuses: [
    "src/cli/commands/handover/settleCardRun.ts:74",
    "src/handover/settleCardErrors.ts:186",
    "bbd9a5ad5",
    "talk:a0000034-0000-4000-8000-000000000037",
  ],
  tokenPass: ["reading:session spend@2026-09-28T21:53:51.139Z"],
} as const;

describe("codeEvidencePaths", () => {
  it("drops a trailing :<line> so the path git is handed is the file the item names", () => {
    expect(codeEvidencePaths({ evidence: SIX.settleRefuses })).toEqual([
      "src/cli/commands/handover/settleCardRun.ts",
      "src/handover/settleCardErrors.ts",
    ]);
  });

  it("drops a trailing :<line>:<column> too", () => {
    expect(codeEvidencePaths({ evidence: ["src/a/b.ts:12:4"] })).toEqual(["src/a/b.ts"]);
  });

  it("drops a leading ./ so the path matches git's --name-only spelling, once", () => {
    expect(codeEvidencePaths({ evidence: ["./src/a.ts", "src/a.ts", "././src/b.ts:3"] })).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});

describe("evidenceRefs over the six measured rows", () => {
  it("reads the review-approve row's source path and its acme-admin pull request", () => {
    expect(evidenceRefs({ evidence: SIX.reviewApprove })).toEqual({
      paths: ["src/cli/commands/github/reviewerArgs.ts"],
      pulls: [{ name: "acme-admin", number: 17961, owner: "acme" }],
      verbs: [],
    });
  });

  it("reads a verb: item as the noun and verb, ignoring its flags", () => {
    expect(evidenceRefs({ evidence: SIX.codexFallback }).verbs).toEqual([{ noun: "codex", verb: "status" }]);
  });

  it("reads every `slopweaver <noun> <verb>` inside free text, each once, and no unprefixed mention", () => {
    expect(evidenceRefs({ evidence: SIX.prAboveTheFold }).verbs).toEqual([
      { noun: "github", verb: "vuln" },
      { noun: "github", verb: "stack" },
    ]);
  });

  it("finds nothing in the two rows that stay residue", () => {
    expect(evidenceRefs({ evidence: SIX.nightlyImport })).toEqual({ paths: [], pulls: [], verbs: [] });
    expect(evidenceRefs({ evidence: SIX.tokenPass })).toEqual({ paths: [], pulls: [], verbs: [] });
  });

  it("reads `owner/name#N` as a pull request and never as a path", () => {
    expect(evidenceRefs({ evidence: ["octo-self/slopweaver#1645"] })).toEqual({
      paths: [],
      pulls: [{ name: "slopweaver", number: 1645, owner: "octo-self" }],
      verbs: [],
    });
  });

  it("ends a shorthand pull number where a sentence does, so a malformed one names nothing", () => {
    const items = ["acme/widgets#7.evil", "acme/widgets#7evil", "landed in acme/widgets#7.", "(acme/widgets#7), then"];
    const seven = [{ name: "widgets", number: 7, owner: "acme" }];
    expect(items.map((item) => evidenceRefs({ evidence: [item] }).pulls)).toEqual([[], [], seven, seven]);
  });

  it("reads a pull URL only on github.com itself, never a host that merely ends in it", () => {
    const items = [
      "https://github.com/octo-self/slopweaver/pull/1645",
      "https://notgithub.com/octo-self/slopweaver/pull/1645",
      "https://evil.github.com/octo-self/slopweaver/pull/1645",
      "https://example.com/github.com/octo-self/slopweaver/pull/1645",
      "see (https://www.github.com/octo-self/slopweaver/pull/1645)",
      "github.com/octo-self/slopweaver/pull/1645",
    ];
    const pull = [{ name: "slopweaver", number: 1645, owner: "octo-self" }];
    expect(items.map((item) => evidenceRefs({ evidence: [item] }).pulls)).toEqual([pull, [], [], [], pull, pull]);
  });

  it("reads a pull number only up to a boundary, so a malformed URL names no pull request", () => {
    const items = [
      "https://github.com/acme/widgets/pull/7evil",
      "https://github.com/acme/widgets/pull/7.evil",
      "https://github.com/acme/widgets/pull/7/files",
      "https://github.com/acme/widgets/pull/7#issuecomment-1",
      "fixed in https://github.com/acme/widgets/pull/7.",
      "(https://github.com/acme/widgets/pull/7), then more",
    ];
    const seven = [{ name: "widgets", number: 7, owner: "acme" }];
    expect(items.map((item) => evidenceRefs({ evidence: [item] }).pulls)).toEqual([[], [], seven, seven, seven, seven]);
  });
});
