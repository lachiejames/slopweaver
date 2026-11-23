/**
 * `knowledge redaction-scan`, `knowledge redact` and the redaction inputs every `--redact` flag opens, exercised
 * where they can be without a database: `--help`, a malformed argument list, an unreadable map, and the
 * store-not-configured refusal. What a connected store does with them is
 * `src/__tests__/integration/knowledgeRedactionStore.test.ts`'s, against a real Postgres.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  knowledgeRedactCommand,
  knowledgeRedactionScanCommand,
  runKnowledgeRedact,
  runKnowledgeRedactionScan,
} from "../../../cli/commands/knowledge/redact.js";
import { openRedactionInputs, redactRecordingForWrite } from "../../../cli/commands/knowledge/redactionContext.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import type { MemoryRecording } from "../../../knowledge/memory.js";
import { memoryId } from "../../../knowledge/memoryRow.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { STORE_URL_ENV } from "../../../store/client.js";

/** The argv shape the runners slice: node, index.js, noun, verb, then the verb's own flags. */
function argv({ flags }: { flags: readonly string[] }): readonly string[] {
  return ["node", "index.js", "knowledge", "verb", ...flags];
}

/** A workspace location no committed rule allows, assembled so this file never carries it. */
const location = ({ label }: { label: string }): string => `${label}.slack.com`;

let home: string;
let savedUrl: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sw-redact-"));
  savedUrl = process.env[STORE_URL_ENV];
  delete process.env[STORE_URL_ENV];
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  if (savedUrl === undefined) {
    delete process.env[STORE_URL_ENV];
    return;
  }
  process.env[STORE_URL_ENV] = savedUrl;
});

/** Write this install's replacement map into the test home. */
function writeMap({ text }: { text: string }): void {
  writeFileSync(join(home, "hygiene-replacements.tsv"), text);
}

/** One lesson recording, its claim id derived the way the real writer derives it. */
function lesson({ claim }: { claim: string }): MemoryRecording {
  return {
    behaviourChange: null,
    caveat: null,
    claim,
    domain: "slack",
    evidence: "measured twice",
    id: memoryId({ claim, domain: "slack", kind: "lesson" }),
    importKey: null,
    kind: "lesson",
    learner: "fleet",
    outcome: null,
    question: null,
    recordedAt: new Date("2026-10-01T00:00:00.000Z"),
    recordingId: "00000000-0000-4000-8000-000000000001",
    repro: null,
    retrievalCue: null,
    run: "ad-hoc",
    supersedes: null,
    surface: "api",
    tier: 2,
    verdict: "confirmed",
  };
}

describe("knowledge redaction-scan", () => {
  it("is wired to its runner — the exported command IS what the manifest dispatches", async () => {
    expect(await knowledgeRedactionScanCommand(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses an unknown flag as a usage failure", async () => {
    expect(await runKnowledgeRedactionScan(argv({ flags: ["--apply"] }))).toBe(EXIT_USAGE);
  });

  it("refuses with the store URL missing, rather than reporting a clean register", async () => {
    expect(await runKnowledgeRedactionScan(argv({ flags: ["--home", home] }))).toBe(EXIT_ERROR);
  });
});

describe("knowledge redact", () => {
  it("is wired to its runner — the exported command IS what the manifest dispatches", async () => {
    expect(await knowledgeRedactCommand(argv({ flags: ["--help"] }))).toBe(EXIT_OK);
  });

  it("refuses an unknown flag as a usage failure", async () => {
    expect(await runKnowledgeRedact(argv({ flags: ["--merge"] }))).toBe(EXIT_USAGE);
  });

  it("refuses a map it cannot read before any connection is attempted", async () => {
    mkdirSync(join(home, "hygiene-replacements.tsv"));
    expect(await runKnowledgeRedact(argv({ flags: ["--home", home, "--apply"] }))).toBe(EXIT_ERROR);
  });

  it("refuses with the store URL missing, rather than reporting a rewrite that never happened", async () => {
    expect(await runKnowledgeRedact(argv({ flags: ["--home", home] }))).toBe(EXIT_ERROR);
  });
});

describe("openRedactionInputs", () => {
  it("an install with no map runs the committed rules alone", () => {
    const inputs = unwrap(openRedactionInputs({ home, verb: "knowledge redact" }));
    expect([inputs.home, inputs.map.length]).toEqual([home, 0]);
  });

  it("loads the install's map, in file order", () => {
    writeMap({ text: "literal\toldco\tacme\nregex\tx+\ty\n" });
    const inputs = unwrap(openRedactionInputs({ home, verb: "knowledge redact" }));
    expect(inputs.map.map((rule) => rule.line)).toEqual([1, 2]);
  });

  it("refuses a malformed map with the verb's prefix, never treating it as empty", () => {
    writeMap({ text: "literal\toldco\n" });
    const refusal = unwrapErr(openRedactionInputs({ home, verb: "knowledge redact" }));
    expect(refusal).toContain("knowledge redact: replacement map ");
    expect(refusal).not.toContain("oldco");
  });
});

describe("redactRecordingForWrite", () => {
  it("rewrites the row through the map, then masks a location label the committed rules still find", () => {
    writeMap({ text: "literal\toldco\tacme\n" });
    const row = lesson({ claim: `oldco pages ${location({ label: "wobble" })} by cursor` });
    const redacted = redactRecordingForWrite({ home, recording: row, verb: "knowledge record" })!;
    expect(redacted.claim).toBe(`acme pages ${location({ label: "example" })} by cursor`);
    expect(redacted.recordingId).toBe(row.recordingId);
  });

  it("returns the input row itself when nothing in it needed redacting", () => {
    const row = lesson({ claim: "paging is by cursor" });
    expect(redactRecordingForWrite({ home, recording: row, verb: "knowledge record" })).toBe(row);
  });

  it("writes nothing when the map cannot be parsed", () => {
    writeMap({ text: "literal\toldco\n" });
    const row = lesson({ claim: "paging is by cursor" });
    expect(redactRecordingForWrite({ home, recording: row, verb: "knowledge record" })).toBe(undefined);
  });
});
