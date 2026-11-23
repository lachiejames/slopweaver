/**
 * The whole-file-JSON gate's pure scanner, on inline fixtures — so the gate never scans itself and stays
 * falsifiable without touching the filesystem. Each shape is exercised on the source text that actually
 * shipped the defect, and against the bounded shape it must not confuse with one.
 */
import { describe, expect, it } from "vitest";
import {
  isScannablePath,
  partitionAgainstDebt,
  scanWholeFileJson,
  type WholeFileJsonHit,
} from "../../../devLint/wholeFileJson.js";
import { indexJsonlNames } from "../../../devLint/wholeFileJsonIndex.js";

/** The index built from one inline source, which is all most of these fixtures need. */
const indexOf = ({
  content,
  path = "src/x.ts",
}: {
  content: string;
  path?: string;
}): ReturnType<typeof indexJsonlNames> => indexJsonlNames({ sources: [{ content, path }] });

const EMPTY_INDEX = indexOf({ content: "" });

describe("indexJsonlNames", () => {
  it("indexes a function whose returned expression names a .jsonl", () => {
    const index = indexOf({
      content: 'function asksPath({ home }: { home: string }): string { return join(home, "asks.jsonl"); }',
    });

    expect([...index.functions]).toEqual(["asksPath"]);
  });

  it("indexes a property whose initializer names a .jsonl", () => {
    const index = indexOf({ content: 'const paths = { asksJsonl: join(home, "slack", "asks.jsonl") };' });

    expect([...index.properties]).toEqual(["asksJsonl"]);
  });

  it("skips an object-literal initializer, so a bag of paths never lends its own name to the leaves", () => {
    const index = indexOf({ content: 'const p = { corpus: { bronze: join(home, "b.jsonl") } };' });

    expect(index.properties.has("corpus")).toBe(false);
    expect(index.properties.has("bronze")).toBe(true);
  });

  it("refuses an AMBIGUOUS name — one declaration naming a .jsonl and another not proves nothing", () => {
    const index = indexJsonlNames({
      sources: [
        { content: 'const a = { path: join(home, "door.jsonl") };', path: "src/a.ts" },
        { content: 'const b = { path: join(home, "settings.json") };', path: "src/b.ts" },
      ],
    });

    expect(index.properties.has("path")).toBe(false);
  });

  it("leaves a function with no return expression out of the index", () => {
    const index = indexOf({ content: 'function write(): void { appendFileSync("x.jsonl", line); }' });

    expect(index.functions.has("write")).toBe(false);
  });

  it("indexes a function that returns an INDEXED PROPERTY rather than spelling the .jsonl — askLifecyclePath", () => {
    const index = indexJsonlNames({
      sources: [
        {
          content: 'const paths = { live: { slack: { asksJsonl: join(home, "asks.jsonl") } } };',
          path: "src/stateHome.ts",
        },
        {
          content:
            "function askLifecyclePath({ home }: { home?: string } = {}): string { return stateHomePaths({ home }).live.slack.asksJsonl; }",
          path: "src/live/ask/store.ts",
        },
      ],
    });

    expect([...index.functions]).toEqual(["askLifecyclePath"]);
  });

  it("indexes a function that joins a FILE-LOCAL constant naming a .jsonl — queueLogPath", () => {
    const index = indexOf({
      content: [
        'const QUEUE_FILE = "withheld.jsonl";',
        "function queueLogPath({ home }: { home?: string } = {}): string { return join(stateHomePaths({ home }).queue, QUEUE_FILE); }",
      ].join("\n"),
    });

    expect([...index.functions]).toEqual(["queueLogPath"]);
  });

  it("follows a helper CHAIN to its fixpoint, so a helper of a helper of a literal is indexed", () => {
    const index = indexJsonlNames({
      sources: [
        {
          content: 'function ledgerDir({ home }: { home: string }): string { return join(home, "lock-in.jsonl"); }',
          path: "src/a.ts",
        },
        {
          content: "function lockInLedgerPath({ home }: { home: string }): string { return ledgerDir({ home }); }",
          path: "src/b.ts",
        },
        {
          content:
            "function recordLockIn({ home }: { home: string }): string { const path = lockInLedgerPath({ home }); return path; }",
          path: "src/c.ts",
        },
      ],
    });

    expect([...index.functions].toSorted()).toEqual(["ledgerDir", "lockInLedgerPath", "recordLockIn"]);
  });

  it("indexes a helper whose return is a .jsonl on EITHER arm of a conditional or a ??", () => {
    const index = indexOf({
      content: [
        'function a({ legacy }: { legacy: boolean }): string { return legacy ? join(h, "old.json") : join(h, "new.jsonl"); }',
        'function b({ override }: { override?: string }): string { return override ?? join(h, "runs.jsonl"); }',
      ].join("\n"),
    });

    expect([...index.functions].toSorted()).toEqual(["a", "b"]);
  });

  it("does NOT index a function that merely READS through a helper — a reader returns text, not a path", () => {
    const index = indexOf({
      content: [
        'function asksPath(): string { return join(h, "asks.jsonl"); }',
        'function readAskLifecycleText(): string { return readFileSync(asksPath(), "utf8"); }',
      ].join("\n"),
    });

    expect([...index.functions]).toEqual(["asksPath"]);
  });

  it("does NOT index a function that returns a BAG of paths, even one whose leaves name a .jsonl", () => {
    const index = indexOf({
      content:
        'function stateHomePaths({ home }: { home: string }): Paths { return { asksJsonl: join(home, "asks.jsonl") }; }',
    });

    expect(index.functions.has("stateHomePaths")).toBe(false);
    expect(index.properties.has("asksJsonl")).toBe(true);
  });

  it("does NOT index a property whose initializer merely mentions a helper inside a callback", () => {
    const index = indexOf({
      content: [
        'function asksPath(): string { return join(h, "asks.jsonl"); }',
        'const deps = { readAsks: ({ home }) => readFileSync(asksPath({ home }), "utf8") };',
      ].join("\n"),
    });

    expect(index.properties.has("readAsks")).toBe(false);
  });
});

describe("scanWholeFileJson — shape A, a .jsonl read whole", () => {
  it("flags a read whose path holds a .jsonl literal", () => {
    const content = 'const raw = readFileSync(join(ledgers, "door.jsonl"), "utf8");';

    const hits = scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/admit/ledger.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.shape).toBe("jsonl-read-whole");
    expect(hits[0]!.line).toBe(1);
    expect(hits[0]!.path).toBe("src/admit/ledger.ts");
  });

  it("flags a read through an indexed path helper", () => {
    const content = [
      'function runStorePath({ home }: { home: string }): string { return join(home, "runs.jsonl"); }',
      'const text = readFileSync(runStorePath({ home }), "utf8");',
    ].join("\n");

    const hits = scanWholeFileJson({ content, index: indexOf({ content }), path: "src/sessionStart/runStore.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(2);
  });

  it("flags a path PARKED IN A LOCAL before the read — the shape that hid the JumpCloud resume defect", () => {
    const content = [
      "function jumpcloudResumePath({ directory }: { directory: string }): string {",
      '  return join(directory, "_resume.jsonl");',
      "}",
      "const path = jumpcloudResumePath({ directory });",
      'const raw = readFileSync(path, "utf8");',
    ].join("\n");

    const hits = scanWholeFileJson({ content, index: indexOf({ content }), path: "src/atlas/jumpcloud/resume.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.shape).toBe("jsonl-read-whole");
    expect(hits[0]!.line).toBe(5);
  });

  it("flags a local parked from a .jsonl LITERAL, not only one from an indexed helper", () => {
    const content = [
      'const journal = join(directory, "_resume.jsonl");',
      'const raw = readFileSync(journal, "utf8");',
    ].join("\n");

    const hits = scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/atlas/jumpcloud/resume.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(2);
  });

  it("leaves an AMBIGUOUS local alone — a name bound to a .json elsewhere in the file proves nothing", () => {
    const content = [
      'const path = join(directory, "_resume.jsonl");',
      'const other = () => { const path = join(directory, "manifest.json"); return readFileSync(path, "utf8"); };',
    ].join("\n");

    expect(scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/atlas/jumpcloud/store.ts" })).toEqual([]);
  });

  it("leaves a local holding a .json path alone, so parking a bounded path is still bounded", () => {
    const content = ['const path = join(directory, "manifest.json");', 'const raw = readFileSync(path, "utf8");'].join(
      "\n",
    );

    expect(scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/atlas/jumpcloud/store.ts" })).toEqual([]);
  });

  it("judges a property chain on its LAST segment, so a .json leaf off a jsonl-holding helper is clean", () => {
    const helper = 'function stateHomePaths(): Paths { return { asksJsonl: join(h, "asks.jsonl") }; }';
    const index = indexOf({ content: `${helper}\nconst p = { slackThreads: join(c, ".slack-threads.json") };` });
    const content = 'const raw = readFileSync(stateHomePaths({ home }).corpus.slackThreads, "utf8");';

    expect(scanWholeFileJson({ content, index, path: "src/corpus/slack/threadCursors.ts" })).toEqual([]);
  });

  it("flags the same chain when its last segment IS an indexed jsonl property", () => {
    const index = indexOf({ content: 'const p = { asksJsonl: join(h, "asks.jsonl") };' });
    const content = 'const raw = readFileSync(paths.live.slack.asksJsonl, "utf8");';

    const hits = scanWholeFileJson({ content, index, path: "src/cli/commands/turn/freeze.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.shape).toBe("jsonl-read-whole");
  });

  it("flags the LISTENER's read behind a helper that never spells the .jsonl — the blind spot this closed", () => {
    const index = indexJsonlNames({
      sources: [
        {
          content: 'const paths = { live: { slack: { asksJsonl: join(home, "asks.jsonl") } } };',
          path: "src/stateHome.ts",
        },
        {
          content:
            "function askLifecyclePath({ home }: { home?: string } = {}): string { return stateHomePaths({ home }).live.slack.asksJsonl; }",
          path: "src/live/ask/store.ts",
        },
      ],
    });
    const content = 'return readFileSync(askLifecyclePath(home === undefined ? {} : { home }), "utf8");';

    const hits = scanWholeFileJson({ content, index, path: "src/live/ask/store.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.shape).toBe("jsonl-read-whole");
  });

  it("leaves the sanctioned streaming reader alone", () => {
    const content = "readJsonlLines({ onLine: ({ line }) => rows.push(line), path: bronzeFile({ source, window }) });";

    expect(scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/corpus/corpusStore.ts" })).toEqual([]);
  });

  it("leaves a whole read of a bounded .json file alone", () => {
    const content = 'const raw = readFileSync(join(home, "settings.json"), "utf8");';

    expect(scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/config.ts" })).toEqual([]);
  });
});

describe("scanWholeFileJson — shape B, a .jsonl written whole", () => {
  it("flags a whole-file write to a .jsonl path", () => {
    const content = 'writeFileSync(join(dir, "runs.jsonl"), `${rows.map(toLine).join("\\n")}\\n`, "utf8");';

    const hits = scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/sessionStart/runStore.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.shape).toBe("jsonl-write-whole");
  });

  it("flags a writeFileAtomic whose options path names a .jsonl", () => {
    const content = 'writeFileAtomic({ contents: text, path: join(dir, "asks.jsonl") });';

    const hits = scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/live/slack/asks.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.shape).toBe("jsonl-write-whole");
  });

  it("leaves an APPEND alone — its payload is the batch, never the file", () => {
    const content = 'writeFileSync(join(dir, "dev-gate.jsonl"), `${lines.join("\\n")}\\n`, { flag: "a" });';

    expect(scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/devGate/devGate.ts" })).toEqual([]);
  });

  it("leaves a callback PARAMETER named like a path local alone — the one false positive following a helper produced", () => {
    const content = [
      "const path = autonomyLedgerPath({ home });",
      "const rows = readFoldedAutonomy({ path });",
      'const deps = { writePage: ({ path, html }) => { writeFileSync(path, html, "utf8"); } };',
    ].join("\n");

    expect(
      scanWholeFileJson({
        content,
        index: indexOf({ content: 'function autonomyLedgerPath(): string { return join(h, "autonomy.jsonl"); }' }),
        path: "src/cli/commands/briefing/renderRun.ts",
      }),
    ).toEqual([]);
  });
});

describe("scanWholeFileJson — shape C, a corpus-derived payload serialised whole", () => {
  it("flags the exact call that wrote silver/graph/graph.json", () => {
    const content = [
      'import { readCorpusDir } from "../../corpus/corpusDirRead.js";',
      'writeJsonFile({ path: join(silverGraphDir({ home }), "graph.json"), value: artifacts.graph });',
    ].join("\n");

    const hits = scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/silver/derive/pipeline.ts" });

    expect(hits).toHaveLength(1);
    expect(hits[0]!.shape).toBe("corpus-payload-whole");
    expect(hits[0]!.line).toBe(2);
  });

  it("leaves the identical write alone in a module that does not read the corpus", () => {
    const content = 'writeJsonFile({ path: join(home, "settings.json"), value: settings });';

    expect(scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/config.ts" })).toEqual([]);
  });

  it("puts a module in scope through any of the corpus readers", () => {
    const content = [
      "const members = readAllMembers({ home });",
      "writeJsonFile({ path: rosterPath, value: members });",
    ].join("\n");

    expect(scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/silver/roster.ts" })).toHaveLength(1);
  });

  it("leaves a bare JSON.stringify alone — a log line is bounded by the record it names", () => {
    const content = [
      "const read = readCorpusDir({ dir });",
      "logger.error({ msg: `bad record: ${JSON.stringify(record)}` });",
    ].join("\n");

    expect(scanWholeFileJson({ content, index: EMPTY_INDEX, path: "src/silver/derive/pipeline.ts" })).toEqual([]);
  });
});

describe("partitionAgainstDebt", () => {
  const hit = ({ path, shape }: { path: string; shape: WholeFileJsonHit["shape"] }): WholeFileJsonHit => ({
    excerpt: "readFileSync(p)",
    line: 1,
    path,
    shape,
  });

  it("passes a hit the debt already records", () => {
    const result = partitionAgainstDebt({
      debt: [{ owes: "run-a", path: "src/a.ts", shape: "jsonl-read-whole" }],
      hits: [hit({ path: "src/a.ts", shape: "jsonl-read-whole" })],
    });

    expect(result.fresh).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  it("reports a hit in a recorded file under a DIFFERENT shape as fresh", () => {
    const result = partitionAgainstDebt({
      debt: [{ owes: "run-a", path: "src/a.ts", shape: "jsonl-read-whole" }],
      hits: [
        hit({ path: "src/a.ts", shape: "jsonl-read-whole" }),
        hit({ path: "src/a.ts", shape: "corpus-payload-whole" }),
      ],
    });

    expect(result.fresh).toHaveLength(1);
    expect(result.fresh[0]!.shape).toBe("corpus-payload-whole");
  });

  it("reports a debt entry nothing matches any more as stale, so the ratchet tightens", () => {
    const result = partitionAgainstDebt({
      debt: [
        {
          owes: "stream-the-dense-vector-leg-off-a-flat",
          path: "src/silver/derive/pipeline.ts",
          shape: "corpus-payload-whole",
        },
      ],
      hits: [],
    });

    expect(result.stale).toEqual(["src/silver/derive/pipeline.ts (corpus-payload-whole)"]);
  });

  it("keys on path and shape, not a line number, so moving a call within its file is not a failure", () => {
    const moved: WholeFileJsonHit = { ...hit({ path: "src/a.ts", shape: "jsonl-read-whole" }), line: 400 };

    const result = partitionAgainstDebt({
      debt: [{ owes: "run-a", path: "src/a.ts", shape: "jsonl-read-whole" }],
      hits: [moved],
    });

    expect(result.fresh).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans a source under each declared tree", () => {
    expect(isScannablePath({ path: "src/silver/derive/pipeline.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/regression.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse.ts" })).toBe(true);
  });

  it("skips tests, the tests tree, non-TypeScript files and the gate's own triad", () => {
    expect(isScannablePath({ path: "src/x.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/unit/x.ts" })).toBe(false);
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/wholeFileJson.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/wholeFileJson.entry.ts" })).toBe(false);
  });
});
