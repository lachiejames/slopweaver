/**
 * The transient-references gate's own tests: each class matches its shape and leaves the near-misses, one
 * reference is one finding however many classes could read it, a class reads only the regions it is declared to,
 * and what a class skips as data is reported apart from what it counts.
 */
import { describe, expect, it } from "vitest";
import { lineAt, lineTable } from "../../../devLint/transientReferenceLines.js";
import { candidateMatches, classMatches } from "../../../devLint/transientReferencePatterns.js";
import { regionsOf } from "../../../devLint/transientReferenceRegions.js";
import {
  classTally,
  cleanLineOf,
  countsOf,
  isScannablePath,
  scanTransientFile,
  scanTransientReferences,
} from "../../../devLint/transientReferences.js";

/**
 * The owner pronoun the fixtures spell, assembled so this file spells no whole pronoun of its own: the gate scans it
 * for pronouns like any other file, and skips only the token classes its fixtures spell.
 */
const PRONOUN = ["h", "e"].join("");

/**
 * Installation-state ids in their unreserved shapes, assembled the same way, so the repository spells no literal one
 * a read-only inventory would report. None of them is any installation's real id.
 */
const ROW = ["l", "9f3c2a7b1e4d6058"].join("-");
const PROPOSAL = ["p", "6e1d0c9b8a7f5e4d"].join("-");
const TURN = ["turn", "Q7mX2pL9vR4tK8nB3wY6z"].join("_");
const UUID = ["5b2e9c41", "7d3a", "4f60", "9b18", "2c7e4a913d05"].join("-");
const SLUG = ["a", "made", "up", "run"].join("-");

/** The parts of a counted hit a case asserts. */
const found = ({ path, content }: { path: string; content: string }) =>
  scanTransientReferences({ content, path }).map((hit) => ({ kind: hit.kind, match: hit.match }));

/** The same, for the data bucket. */
const data = ({ path, content }: { path: string; content: string }) =>
  scanTransientFile({ content, path }).data.map((hit) => ({ kind: hit.kind, match: hit.match }));

describe("each class in prose", () => {
  it("counts a written date in an installation year, and leaves a worked example and the modal may", () => {
    const content = "Ruled 31 Aug 2026, again on Sep 3rd. A format reads 1 Jan 2001; you may go.";

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "date", match: "31 Aug 2026" },
      { kind: "date", match: "Sep 3rd" },
    ]);
  });

  it("counts an ISO date and a time of day, and reads a full timestamp as one ISO date", () => {
    const content = "Read 2026-11-09, at 18:15Z; stamped 2026-11-09T23:55:00Z.";

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "iso-date", match: "2026-11-09" },
      { kind: "time-of-day", match: "18:15Z" },
      { kind: "iso-date", match: "2026-11-09T23:55:00Z" },
    ]);
  });

  it("counts a commit hash carrying a digit and a letter, never a hex word, a colour or a long number", () => {
    const content = "main == a254f341, not deadbeef, nor #a254f34, nor 12345678.";

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([{ kind: "commit-hash", match: "a254f341" }]);
  });

  it("counts a pull request by number, label and URL, never a step label, an entity or an anchor", () => {
    const content = "See #3774, PR 3771 and /pull/3777. Step #1, &#8212; and [x](#12-steps) are not.";

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "pr-number", match: "#3774" },
      { kind: "pr-number", match: "PR 3771" },
      { kind: "pr-number", match: "/pull/3777" },
    ]);
  });

  it("counts an owner turn id, never a range of years", () => {
    const content = "owner 272-5 said so, and 257-3 too, across 2025-2026.";

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "turn-id", match: "owner 272-5" },
      { kind: "turn-id", match: "257-3" },
    ]);
  });

  it("counts a session UUID, a call id and a Codex pass, the call id never also a hash", () => {
    const content = "transcript a0000059-0000-4000-8000-000000000065, talk-call e93369ed, Codex r3, finding r1-07.";

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "session-id", match: "a0000059-0000-4000-8000-000000000065" },
      { kind: "call-id", match: "talk-call e93369ed" },
      { kind: "call-id", match: "Codex r3" },
      { kind: "call-id", match: "r1-07" },
    ]);
  });

  it("counts a talk id in every spelling and a relay id, never a talk word or an all-letter id", () => {
    const content =
      "talk-5aa3492694cd, talk:e83ba61d, talk 85d81b00, relay 20260921T031652Z-abcdef012345; talk-to, talk-aaaaaaaaaaaa.";

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "call-id", match: "talk-5aa3492694cd" },
      { kind: "call-id", match: "talk:e83ba61d" },
      { kind: "call-id", match: "talk 85d81b00" },
      { kind: "call-id", match: "20260921T031652Z-abcdef012345" },
    ]);
  });

  it("counts a quotation attributed to the owner, and a date inside it on its own", () => {
    const content = 'owner: "I would rather you do nothing on 14 Oct 2026"';

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "attributed-quote", match: 'owner: "I would rather you do nothing on 14 Oct 2026' },
      { kind: "date", match: "14 Oct 2026" },
    ]);
  });

  it("counts a masculine pronoun for the owner beside the token classes, in source order", () => {
    expect(found({ content: `On 3 Sep 2026 ${PRONOUN} ruled.`, path: "docs/a.md" })).toStrictEqual([
      { kind: "date", match: "3 Sep 2026" },
      { kind: "owner-pronoun", match: PRONOUN },
    ]);
  });

  it("returns nothing for clean text", () => {
    expect(found({ content: "The owner asked, and they wanted it.", path: "docs/a.md" })).toStrictEqual([]);
  });
});

describe("the installation-state identifier classes", () => {
  it("counts a knowledge or proposal row by id, and a knowledge row by its slug", () => {
    const content = `Recorded as ${ROW}, proposed as ${PROPOSAL}, and knowledge row \`ci-gate-is-flaky\`.`;

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "state-row-id", match: ROW },
      { kind: "state-row-id", match: PROPOSAL },
      { kind: "state-row-id", match: "knowledge row `ci-gate-is-flaky" },
    ]);
  });

  it("counts a store pointer by UUID in every spelling, the whole anchor rather than its bare UUID", () => {
    const content = `talk:${UUID}, talk-call:${UUID}, transcript:${UUID}#x, session ${UUID}, --session ${UUID}.`;

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "state-pointer-id", match: `talk:${UUID}` },
      { kind: "state-pointer-id", match: `talk-call:${UUID}` },
      { kind: "state-pointer-id", match: `transcript:${UUID}` },
      { kind: "state-pointer-id", match: `session ${UUID}` },
      { kind: "state-pointer-id", match: `--session ${UUID}` },
    ]);
  });

  it("counts a UUID held under a session-like key, never a synthetic one, a bare one or one under another key", () => {
    const content = JSON.stringify({
      bare: [UUID],
      callId: "aaaaaaaa-0000-4000-8000-000000000003",
      conversation_id: UUID,
      sessionId: UUID,
      uuid: UUID,
    });

    expect(found({ content, path: "site/fixtures/x.json" })).toStrictEqual([
      { kind: "state-pointer-id", match: UUID },
      { kind: "state-pointer-id", match: UUID },
    ]);
    const fixture = `read({ chairSessionId: "${UUID}", id: "${UUID}" });`;

    expect(found({ content: fixture, path: "src/__tests__/unit/x.test.ts" })).toStrictEqual([
      { kind: "state-pointer-id", match: UUID },
    ]);
  });

  it("counts a voice turn id, never a snake_case word", () => {
    const content = `Ruled at ${TURN}; turn_detection is a setting.`;

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([{ kind: "voice-turn-id", match: TURN }]);
  });

  it("counts a supervisor chair by its counter below 9000, its directory and fixture names too, and never one at 9000 or past it", () => {
    const content = [
      "Chair handoff-8999 seated after fresh-supervisor-handoff-291 and supervisor-handoff-7.",
      "Read handoff-291/shell.txt and the handoff-263-tick-zero fixture; handoff-291's own seating.",
      "Synthetic: handoff-9000, fresh-supervisor-handoff-9367, handoff-9291-tick-288, handoff-90080, handoff-<n>.",
    ].join("\n");

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "chair-counter", match: "handoff-8999" },
      { kind: "chair-counter", match: "fresh-supervisor-handoff-291" },
      { kind: "chair-counter", match: "supervisor-handoff-7" },
      { kind: "chair-counter", match: "handoff-291" },
      { kind: "chair-counter", match: "handoff-263" },
      { kind: "chair-counter", match: "handoff-291" },
    ]);
  });

  it("never counts a longer word or number carrying a chair name inside it", () => {
    const content =
      "prehandoff-8, handoff-08, xhandoff-12, handoff-1abc, handoff-7_x, handoff-4́ and handoff-9000-tick-1 are no chair.";

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([]);
  });

  it("reads a chair counter in a test's fixture string and in JSON, as a real installation's id", () => {
    const fixture = 'seat({ dir: "handoff-291-tick-288", ok: "handoff-9367", slug: "fresh-supervisor-handoff-367" });';
    const json = JSON.stringify({ ok: "handoff-9263-tick-0", tickId: "handoff-263-tick-0" });

    expect(found({ content: fixture, path: "src/__tests__/unit/x.test.ts" })).toStrictEqual([
      { kind: "chair-counter", match: "handoff-291" },
      { kind: "chair-counter", match: "fresh-supervisor-handoff-367" },
    ]);
    expect(found({ content: json, path: "src/__tests__/fixtures/x.json" })).toStrictEqual([
      { kind: "chair-counter", match: "handoff-263" },
    ]);
  });

  it("skips a chair counter only in the dev-gate handoff check's two files, whose handoff-1 is a shard record id", () => {
    const content = [
      "// since 3 Sep 2026",
      'const finding = { id: "c-alpha/handoff-1", url: "https://example.invalid/handoff-2" };',
    ].join("\n");

    expect(found({ content, path: "src/devGate/handoffCheck.ts" })).toStrictEqual([
      { kind: "date", match: "3 Sep 2026" },
    ]);
    expect(found({ content, path: "src/__tests__/unit/devGate/handoffCheck.test.ts" })).toStrictEqual([
      { kind: "date", match: "3 Sep 2026" },
    ]);
    expect(found({ content, path: "src/devGate/handoffCheckCore.ts" })).toStrictEqual([
      { kind: "date", match: "3 Sep 2026" },
      { kind: "chair-counter", match: "handoff-1" },
      { kind: "chair-counter", match: "handoff-2" },
    ]);
  });

  it("counts a handover run or board row cited as provenance, never a verb, a short slug or a bare slug", () => {
    const content = [
      `See the \`${SLUG}\` handover, the \`${SLUG}\`, handover 2, and handover \`${SLUG}\`.`,
      `Measured by board row \`${SLUG}\` and slopweaver handover resume ${SLUG}.`,
      `Run handover set-repo, handover resume a-doc, and read \`${SLUG}\` alone.`,
    ].join("\n");

    expect(found({ content, path: "docs/a.md" })).toStrictEqual([
      { kind: "handover-id", match: `\`${SLUG}\` handover` },
      { kind: "handover-id", match: `\`${SLUG}\`, handover` },
      { kind: "handover-id", match: `handover \`${SLUG}\`` },
      { kind: "handover-id", match: `board row \`${SLUG}\`` },
      { kind: "handover-id", match: `handover resume ${SLUG}` },
    ]);
  });

  it("allows every reserved synthetic form, wherever it is written", () => {
    const synthetic = [
      "l-0000000000000001",
      "p-0000000000009007",
      "l-0123456789abcdef",
      "turn_000000000000000000001",
      "talk:aaaaaaaa-0000-4000-8000-000000000001",
      "--session aaaaaaaa-0000-4000-8000-000000000002",
    ];
    const content = `const ids = ${JSON.stringify(synthetic)};`;

    expect(found({ content: synthetic.join(", "), path: "docs/a.md" })).toStrictEqual([
      { kind: "session-id", match: "aaaaaaaa-0000-4000-8000-000000000001" },
      { kind: "session-id", match: "aaaaaaaa-0000-4000-8000-000000000002" },
    ]);
    expect(found({ content, path: "src/__tests__/unit/x.test.ts" })).toStrictEqual([]);
    expect(found({ content: JSON.stringify({ ids: synthetic }), path: "src/__tests__/fixtures/x.json" })).toStrictEqual(
      [],
    );
  });

  it("reads a test's fixture strings for the identifier classes alone, leaving a date and a hash as data", () => {
    const content = `parse({ at: "31 Aug 2026", sha: "b4135f49", row: "${ROW}", turn: "${TURN}", via: "call:${UUID}" });`;
    const path = "src/__tests__/unit/x.test.ts";

    expect(found({ content, path })).toStrictEqual([
      { kind: "state-row-id", match: ROW },
      { kind: "voice-turn-id", match: TURN },
      { kind: "state-pointer-id", match: `call:${UUID}` },
    ]);
    expect(data({ content, path })).toStrictEqual([
      { kind: "date", match: "31 Aug 2026" },
      { kind: "commit-hash", match: "b4135f49" },
    ]);
  });

  it("reads JSON and JSONL for the identifier classes alone, never a pronoun, a date or a hash, nor as data", () => {
    const line = JSON.stringify({ at: "2026-09-01T00:00:00Z", by: PRONOUN, row: ROW, sha: "a254f341", via: TURN });

    expect(found({ content: `${line}\n${line}\n`, path: "src/__tests__/fixtures/x.jsonl" })).toStrictEqual([
      { kind: "state-row-id", match: ROW },
      { kind: "voice-turn-id", match: TURN },
      { kind: "state-row-id", match: ROW },
      { kind: "voice-turn-id", match: TURN },
    ]);
    expect(data({ content: line, path: "site/fixtures/x.json" })).toStrictEqual([]);
  });

  it("never reads a handover run in a fixture string, where a test names the run it builds", () => {
    const content = `stage({ resume: "handover resume ${SLUG}" });`;

    expect(found({ content, path: "src/__tests__/unit/x.test.ts" })).toStrictEqual([]);
    expect(found({ content, path: "src/x.ts" })).toStrictEqual([
      { kind: "handover-id", match: `handover resume ${SLUG}` },
    ]);
  });

  it("counts an install's pointer in a committed bump manifest's reason like any other JSON", () => {
    const content = JSON.stringify({ reason: `approved at talk:${UUID}` });

    expect(found({ content, path: ".baselines/bumps/abc.json" })).toStrictEqual([
      { kind: "state-pointer-id", match: `talk:${UUID}` },
    ]);
  });
});

describe("regions, and what is left as data", () => {
  it("counts a hash in a TypeScript comment, and reports one in a string as data", () => {
    const content = ["// fixed at a254f341", 'const sha = "b4135f49";'].join("\n");

    expect(found({ content, path: "src/x.ts" })).toStrictEqual([{ kind: "commit-hash", match: "a254f341" }]);
    expect(data({ content, path: "src/x.ts" })).toStrictEqual([{ kind: "commit-hash", match: "b4135f49" }]);
  });

  it("counts a written date in a product string, since a reader sees it", () => {
    const content = 'const why = "owner ruling of 28 Sep 2026";';

    expect(found({ content, path: "src/x.ts" })).toStrictEqual([{ kind: "date", match: "28 Sep 2026" }]);
  });

  it("counts a test's name but reports its fixture strings as data", () => {
    const content = ['it("refuses a stale row (Codex r3)", () => {', '  parse({ at: "31 Aug 2026" });', "});"].join(
      "\n",
    );

    expect(found({ content, path: "src/__tests__/unit/x.test.ts" })).toStrictEqual([
      { kind: "call-id", match: "Codex r3" },
    ]);
    expect(data({ content, path: "src/__tests__/unit/x.test.ts" })).toStrictEqual([
      { kind: "date", match: "31 Aug 2026" },
    ]);
  });

  it("reads only a CSS file's comments", () => {
    const content = "/* since 3 Sep 2026 */\n.a { color: #a254f34; }";

    expect(found({ content, path: "site/app/x.css" })).toStrictEqual([{ kind: "date", match: "3 Sep 2026" }]);
  });

  it("carries the line and a preview onto each hit", () => {
    const hit = scanTransientReferences({ content: "first\n  merged at   a254f341  ", path: "docs/a.md" })[0]!;

    expect(hit.line).toBe(2);
    expect(hit.preview).toBe("merged at a254f341");
  });
});

describe("countsOf and the report", () => {
  const hits = [
    ...scanTransientReferences({ content: `${PRONOUN} said on 3 Sep 2026 at a254f341`, path: "skills/b.md" }),
    ...scanTransientReferences({ content: "#3774 and #3775", path: "docs/a.md" }),
  ];

  it("collapses hits into one entry per file and class, in path then class order", () => {
    expect(countsOf({ hits })).toStrictEqual([
      { count: 2, kind: "pr-number", path: "docs/a.md" },
      { count: 1, kind: "owner-pronoun", path: "skills/b.md" },
      { count: 1, kind: "date", path: "skills/b.md" },
      { count: 1, kind: "commit-hash", path: "skills/b.md" },
    ]);
  });

  it("is empty for no hits", () => {
    expect(countsOf({ hits: [] })).toStrictEqual([]);
  });

  it("tallies every class, zeros kept", () => {
    expect(classTally({ hits }).filter(({ count }) => count > 0)).toStrictEqual([
      { count: 1, kind: "owner-pronoun" },
      { count: 1, kind: "date" },
      { count: 1, kind: "commit-hash" },
      { count: 2, kind: "pr-number" },
    ]);
    expect(classTally({ hits: [] }).length).toBe(15);
  });

  it("states the count, the split, and what was left as data, the pronoun class having no data bucket", () => {
    const left = scanTransientFile({ content: 'const sha = "b4135f49";', path: "src/x.ts" }).data;

    expect(cleanLineOf({ current: countsOf({ hits }), data: left, hits })).toBe(
      "5 standing reference(s), 4 debt entr(ies): owner-pronoun 1, date 1, iso-date 0, time-of-day 0, " +
        "commit-hash 1, pr-number 2, turn-id 0, session-id 0, call-id 0, attributed-quote 0, state-row-id 0, " +
        "state-pointer-id 0, voice-turn-id 0, chair-counter 0, handover-id 0; left as data, not counted: 1 (date 0, " +
        "iso-date 0, time-of-day 0, commit-hash 1, pr-number 0, turn-id 0, session-id 0, call-id 0, " +
        "attributed-quote 0, state-row-id 0, state-pointer-id 0, voice-turn-id 0, chair-counter 0, handover-id 0)",
    );
  });
});

describe("isScannablePath", () => {
  it("reads prose and code anywhere in the tree, tests included", () => {
    const paths = [
      "AGENTS.md",
      "skills/github/SKILL.md",
      "site/content/docs/page.mdx",
      "src/__tests__/unit/x.test.ts",
      "site/components/Example.tsx",
      "scripts/hook.sh",
      "docs/diagrams/voice.mmd",
      "lefthook.yml",
      "site/app/console-tw.css",
      "src/__tests__/fixtures/contract/profile-steers.json",
      "site/__tests__/unit/fixtures/repeatedAskCall.jsonl",
      ".baselines/ci-job-seconds-approved.json",
    ];

    expect(paths.filter((path) => isScannablePath({ path }))).toStrictEqual(paths);
  });

  it("scans the gate's own runner, entry and region reader like any other file", () => {
    const paths = [
      "src/devLint/transientReferences.ts",
      "src/devLint/transientReferences.entry.ts",
      "src/devLint/transientReferenceRegions.ts",
      "src/devLint/transientReferencePatterns.ts",
    ];

    expect(paths.filter((path) => isScannablePath({ path }))).toStrictEqual(paths);
  });

  it.each(["src/devLint/transientReferencePatterns.ts", "src/__tests__/unit/devLint/transientReferences.test.ts"])(
    "counts a pronoun in %s, and none of the tokens it spells as examples",
    (path) => {
      const content = `// A turn id reads 272-5, a hash a254f341, a date 2 Nov 2026.\n// ${PRONOUN} wrote it\n`;

      expect(found({ content, path })).toStrictEqual([{ kind: "owner-pronoun", match: PRONOUN }]);
      expect(found({ content, path: "src/devLint/elsewhere.ts" })).toStrictEqual([
        { kind: "turn-id", match: "272-5" },
        { kind: "commit-hash", match: "a254f341" },
        { kind: "date", match: "2 Nov 2026" },
        { kind: "owner-pronoun", match: PRONOUN },
      ]);
    },
  );

  it("leaves out only the pronoun module and its own test, and reads a committed bump manifest", () => {
    const paths = [
      ".baselines/bumps/abc.json",
      "src/devLint/ownerPronouns.ts",
      "src/__tests__/unit/devLint/ownerPronouns.test.ts",
    ];

    expect(paths.filter((path) => isScannablePath({ path }))).toStrictEqual([".baselines/bumps/abc.json"]);
  });
});

describe("regionsOf", () => {
  /** Each region as its kind and the text it spans. */
  const spans = ({ path, content }: { path: string; content: string }) =>
    regionsOf({ content, path }).map((region) => ({
      kind: region.kind,
      text: content.slice(region.start, region.end),
    }));

  it("reads a TypeScript file's comments, strings, template text and JSX text", () => {
    const content = ["// one", 'const a = "two";', "const b = `three ${a} four`;", "const c = <p>five</p>;"].join("\n");

    expect(spans({ content, path: "site/x.tsx" }).map((one) => one.kind)).toStrictEqual([
      "comment",
      "string",
      "string",
      "string",
      "string",
    ]);
    expect(spans({ content, path: "site/x.tsx" })[0]).toStrictEqual({ kind: "comment", text: "// one" });
  });

  it("reads a test file's names as strings and every other literal as a fixture", () => {
    const content = ['describe("outer", () => {', '  it("inner", () => parse({ raw: "data" }));', "});"].join("\n");

    expect(spans({ content, path: "src/__tests__/unit/x.test.ts" })).toStrictEqual([
      { kind: "string", text: '"outer"' },
      { kind: "string", text: '"inner"' },
      { kind: "fixture", text: '"data"' },
    ]);
  });

  it("reads a table-driven test's name, and nothing chained off a finished test call as a name", () => {
    const content = ['it.each([1])("row %s", () => {});', 'it("real name", () => {})("extra");'].join("\n");

    expect(spans({ content, path: "src/__tests__/x.test.ts" })).toStrictEqual([
      { kind: "string", text: '"row %s"' },
      { kind: "string", text: '"real name"' },
      { kind: "fixture", text: '"extra"' },
    ]);
  });

  it("reads a JSON or JSONL file whole, as data", () => {
    expect(spans({ content: '{"a": 1}', path: "src/__tests__/fixtures/x.json" })).toStrictEqual([
      { kind: "data", text: '{"a": 1}' },
    ]);
    expect(spans({ content: "{}\n{}\n", path: "site/fixtures/x.jsonl" })).toStrictEqual([
      { kind: "data", text: "{}\n{}\n" },
    ]);
  });

  it("reads a Markdown file whole, as prose", () => {
    expect(spans({ content: "# Title\n\nbody", path: "docs/a.md" })).toStrictEqual([
      { kind: "prose", text: "# Title\n\nbody" },
    ]);
  });

  it("reads only a CSS file's block comments", () => {
    expect(spans({ content: "/* note */ .a { color: red; }", path: "site/app/x.css" })).toStrictEqual([
      { kind: "comment", text: "/* note */" },
    ]);
  });
});

describe("classMatches", () => {
  it("keeps the earlier class where two overlap, and reports an unread candidate as data", () => {
    const content = "talk-call e93369ed";
    const sorted = classMatches({ candidates: candidateMatches({ content }), regions: [] });

    expect(sorted.counted).toStrictEqual([]);
    expect(sorted.data.map((one) => one.name)).toStrictEqual(["call-id"]);
  });

  it("counts a candidate wholly inside a region its class reads", () => {
    const content = "talk-call e93369ed";
    const sorted = classMatches({
      candidates: candidateMatches({ content }),
      regions: [{ end: content.length, kind: "prose", start: 0 }],
    });

    expect(sorted.counted.map((one) => one.name)).toStrictEqual(["call-id"]);
    expect(sorted.data).toStrictEqual([]);
  });
});

describe("lineAt", () => {
  it("finds the line across LF, CRLF and a lone CR, with a clipped preview", () => {
    const content = "a\rb\r\nc\n  d   e  ";
    const table = lineTable({ content });

    expect(lineAt({ offset: 0, table })).toStrictEqual({ line: 1, preview: "a" });
    expect(lineAt({ offset: 2, table })).toStrictEqual({ line: 2, preview: "b" });
    expect(lineAt({ offset: 5, table })).toStrictEqual({ line: 3, preview: "c" });
    expect(lineAt({ offset: 9, table })).toStrictEqual({ line: 4, preview: "d e" });
  });
});
