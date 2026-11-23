import { describe, expect, it } from "vitest";

import { type CoverageSource, indexSources } from "../../../lib/rareTokens.js";
import {
  COVERED_IMPACT_STEP,
  crossReference,
  discoverMemoryDirs,
  KNOWN_IMPACT_STEP,
  matchingSources,
  REFUTED_IMPACT_STEP,
  readBoardCoverage,
  readMemoryCoverage,
  readRegisterCoverage,
} from "../../../reflect/crossRef.js";
import type { FrictionFinding } from "../../../reflect/finding.js";
import type { SubstrateReader } from "../../../reflect/substrate.js";

const finding = (over: Partial<FrictionFinding> = {}): FrictionFinding => ({
  classKey: "donewhen-probe-named-a-flag-that-does-not-exist",
  consequence: "a measured cost",
  cost: 2,
  coveredBy: [],
  evidence: [],
  firstSeenIso: "2026-08-27T01:00:00.000Z",
  impact: 3,
  knownBy: [],
  refutedBy: [],
  lastSeenIso: "2026-08-27T02:00:00.000Z",
  locus: "handover amend",
  occurrences: 6,
  safety: 4,
  source: "run-journal",
  summary: "a summary",
  ...over,
});

const fakeReader = ({ files }: { files: Readonly<Record<string, string>> }): SubstrateReader => ({
  listNames: (dir) =>
    [
      ...new Set(
        Object.keys(files)
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1).split("/")[0]!),
      ),
    ].toSorted((a, b) => a.localeCompare(b)),
  readText: (path) => files[path],
});

/** Twenty docs whose only shared vocabulary is the filler, so `handover` is common and `donewhen` is not. */
const filler = (): readonly CoverageSource[] =>
  Array.from({ length: 20 }, (_, index) => ({
    id: `filler-${String(index)}`,
    text: "handover amend session probe review board something else entirely",
  }));

describe("indexSources", () => {
  it("rules out a token that appears in more than a tenth of the corpus", () => {
    expect(indexSources({ sources: filler() }).tooCommon.has("handover")).toBe(true);
  });

  it("keeps a token only one source carries", () => {
    const sources = [...filler(), { id: "rare", text: "donewhen filter vitest" }];
    expect(indexSources({ sources }).tooCommon.has("donewhen")).toBe(false);
  });
});

describe("matchingSources", () => {
  it("does NOT match on vocabulary the whole corpus shares", () => {
    expect(matchingSources({ finding: finding(), sources: filler() })).toStrictEqual([]);
  });

  it("matches a source that shares the finding's rare vocabulary", () => {
    const sources = [
      ...filler(),
      { id: "the-real-one", text: "donewhen probes that named a flag which does not exist" },
    ];
    expect(matchingSources({ finding: finding(), sources })).toStrictEqual(["the-real-one"]);
  });

  it("needs more than one shared rare token", () => {
    const sources = [...filler(), { id: "one-word-only", text: "donewhen and nothing else in common" }];
    expect(matchingSources({ finding: finding(), sources })).toStrictEqual([]);
  });

  it("matches nothing against an empty corpus", () => {
    expect(matchingSources({ finding: finding(), sources: [] })).toStrictEqual([]);
  });
});

describe("crossReference", () => {
  const covering: readonly CoverageSource[] = [
    ...filler(),
    { id: "the-board-doc", text: "donewhen probes that named a flag which does not exist" },
  ];
  const knowing: readonly CoverageSource[] = [
    ...filler(),
    { id: "the-memory", text: "donewhen probes that named a flag which does not exist" },
  ];

  it("DEMOTES a finding the board already covers, and never removes it", () => {
    const [annotated] = crossReference({ board: covering, findings: [finding()], memory: [] });
    expect(annotated!.coveredBy).toStrictEqual(["the-board-doc"]);
    expect(annotated!.impact).toBe(3 + COVERED_IMPACT_STEP);
  });

  it("PROMOTES a finding that recurs despite an existing memory", () => {
    const [annotated] = crossReference({ board: [], findings: [finding()], memory: knowing });
    expect(annotated!.knownBy).toStrictEqual(["the-memory"]);
    expect(annotated!.impact).toBe(3 + KNOWN_IMPACT_STEP);
  });

  it("cancels out when both are true", () => {
    const [annotated] = crossReference({ board: covering, findings: [finding()], memory: knowing });
    expect(annotated!.impact).toBe(3);
  });

  it("leaves the class key untouched, so identity survives a change on the board", () => {
    const [annotated] = crossReference({ board: covering, findings: [finding()], memory: knowing });
    expect(annotated!.classKey).toBe("donewhen-probe-named-a-flag-that-does-not-exist");
  });

  it("never demotes below the dial floor", () => {
    const [annotated] = crossReference({ board: covering, findings: [finding({ impact: 1 })], memory: [] });
    expect(annotated!.impact).toBe(1);
  });

  it("leaves a finding alone when neither source knows about it", () => {
    const [annotated] = crossReference({ board: filler(), findings: [finding()], memory: filler() });
    expect(annotated!.impact).toBe(3);
    expect(annotated!.coveredBy).toStrictEqual([]);
    expect(annotated!.knownBy).toStrictEqual([]);
  });
});

describe("readBoardCoverage", () => {
  it("reads each doc's name and its opening", () => {
    const reader = fakeReader({
      files: { "/handovers/one.md": "---\nslug: one\n---\n# a doc", "/handovers/notes.txt": "x" },
    });
    expect(readBoardCoverage({ handoverDir: "/handovers", reader })).toStrictEqual([
      { id: "one", text: "one.md ---\nslug: one\n---\n# a doc" },
    ]);
  });

  it("reads an absent board as no coverage", () => {
    expect(readBoardCoverage({ handoverDir: "/handovers", reader: fakeReader({ files: {} }) })).toStrictEqual([]);
  });
});

describe("readMemoryCoverage", () => {
  it("skips the index, which would otherwise match everything at once", () => {
    const reader = fakeReader({
      files: { "/memory/MEMORY.md": "- everything", "/memory/a-thing.md": "a thing happened" },
    });
    expect(readMemoryCoverage({ memoryDir: "/memory", reader }).map((one) => one.id)).toStrictEqual(["a-thing"]);
  });
});

describe("discoverMemoryDirs", () => {
  it("finds the projects that hold a corpus and skips the ones that do not", () => {
    const reader = fakeReader({
      files: { "/projects/alpha/memory/one.md": "x", "/projects/beta/transcript.jsonl": "y" },
    });
    expect(discoverMemoryDirs({ projectsDir: "/projects", reader })).toStrictEqual(["/projects/alpha/memory"]);
  });
});

/** The register as pages: a parent with no sections, a Survivors page, and a Refuted page. */
const REGISTER: Readonly<Record<string, string>> = {
  "/docs/recurring-failure-register.md": "# The recurring-failure register",
  "/docs/recurring-failure-register/survivors.md": [
    "# Survivors — 27 classes with a confirmed seam",
    "",
    "| n | class | what it refuses | seam |",
    "|---|---|---|---|",
    "| 39 | `donewhen-probe-named-a-flag-that-does-not-exist` | a live survivor | `handover/lifecycle.ts` |",
  ].join("\n"),
  "/docs/recurring-failure-register/refuted-and-seed-candidates.md": [
    "# Refuted — 36 classes. Do not re-propose these.",
    "",
    "| class | why it was refuted |",
    "|---|---|",
    "| `whole-file-read-blows-the-token-cap` | REFUTED — the seam cannot see the size before the read |",
    "| `team-facing-pr-opened-with-no-linear-ticket` | REFUTED — already gated server-side |",
    "",
    "## Filed separately",
    "",
    "- `something-else` — has its own doc.",
  ].join("\n"),
};

describe("readRegisterCoverage", () => {
  it("reads only the refuted section, so a live survivor is never demoted by its own register entry", () => {
    const reader = fakeReader({ files: REGISTER });
    expect(
      readRegisterCoverage({ registerPath: "/docs/recurring-failure-register.md", reader }).map((one) => one.id),
    ).toStrictEqual(["whole-file-read-blows-the-token-cap", "team-facing-pr-opened-with-no-linear-ticket"]);
  });

  it("carries the refutation reason into the match text, because the reason is what a reader needs", () => {
    const reader = fakeReader({ files: REGISTER });
    const sources = readRegisterCoverage({ registerPath: "/docs/recurring-failure-register.md", reader });
    expect(sources[1]!.text).toBe("team-facing-pr-opened-with-no-linear-ticket REFUTED — already gated server-side");
  });

  it("yields nothing when the register is absent, so a missing file is one fewer annotation and not a throw", () => {
    const reader = fakeReader({ files: {} });
    expect(readRegisterCoverage({ registerPath: "/docs/recurring-failure-register.md", reader })).toStrictEqual([]);
  });

  it("reads a refuted class off the child page it lives on, beside the parent", () => {
    const reader = fakeReader({
      files: {
        "/docs/recurring-failure-register.md": "# The recurring-failure register",
        "/docs/recurring-failure-register/refuted-and-seed-candidates.md":
          "# Refuted\n\n| `a-dead-class` | REFUTED — gated |",
      },
    });
    expect(
      readRegisterCoverage({ registerPath: "/docs/recurring-failure-register.md", reader }).map((one) => one.id),
    ).toStrictEqual(["a-dead-class"]);
  });

  it("keeps what it read when the parent is missing, since a missing page means only fewer refutations", () => {
    const reader = fakeReader({
      files: {
        "/docs/recurring-failure-register/refuted-and-seed-candidates.md": "# Refuted\n\n| `a-dead-class` | x |",
      },
    });
    expect(
      readRegisterCoverage({ registerPath: "/docs/recurring-failure-register.md", reader }).map((one) => one.id),
    ).toStrictEqual(["a-dead-class"]);
  });

  it("yields nothing off a page read with a problem, so a live class misread as refuted is never matched", () => {
    const reader = fakeReader({
      files: {
        ...REGISTER,
        "/docs/recurring-failure-register/survivors.md":
          "# Survivors\n\n## Refuted examples\n\n| 1 | `still-live` | x | y |",
      },
    });
    expect(
      readRegisterCoverage({ registerPath: "/docs/recurring-failure-register.md", reader }).map((one) => one.id),
    ).toStrictEqual(["whole-file-read-blows-the-token-cap", "team-facing-pr-opened-with-no-linear-ticket"]);
  });

  it("yields nothing when the refuted heading is gone, rather than parsing the wrong section", () => {
    const reader = fakeReader({
      files: { "/docs/recurring-failure-register.md": "# register\n\n## Survivors\n\n| `a` | b |" },
    });
    expect(readRegisterCoverage({ registerPath: "/docs/recurring-failure-register.md", reader })).toStrictEqual([]);
  });
});

describe("crossReference over the register", () => {
  it("demotes a finding the register already refuted and names it", () => {
    const refuted: readonly CoverageSource[] = [
      ...filler(),
      { id: "the-refuted-class", text: "donewhen probes that named a flag which does not exist" },
    ];
    const [annotated] = crossReference({ board: [], findings: [finding()], memory: [], refuted });
    expect(annotated!.refutedBy).toStrictEqual(["the-refuted-class"]);
    expect(annotated!.impact).toBe(3 + REFUTED_IMPACT_STEP);
  });

  it("leaves impact and refutedBy alone when no refutation matches", () => {
    const [annotated] = crossReference({ board: [], findings: [finding()], memory: [], refuted: [] });
    expect(annotated!.refutedBy).toStrictEqual([]);
    expect(annotated!.impact).toBe(3);
  });
});
