/*
 * The shared transcripts shell, driven directly: the `--help` and unscoped short-circuits `prepare` takes before
 * it reads anything, and `sweep` over a REAL temporary transcript this test writes and the shipped code reads
 * back — no mocks, and no dependence on the machine's own `~/.claude`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseTranscriptsTurnsArgs } from "../../../../../cli/commands/transcripts/core.js";
import { prepare, refuse, sweep } from "../../../../../cli/commands/transcripts/scope.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { SessionFile } from "../../../../../transcripts/source.js";

const SESSION = "aaaaaaaa-0000-0000-0000-000000000002";
const USAGE = "usage: slopweaver transcripts turns [--session <value>]";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One transcript on disk holding a single human turn, described as the listing would describe it. */
function seededSession(): SessionFile {
  const projects = mkdtempSync(join(tmpdir(), "transcripts-scope-"));
  fixtureDirs.push(projects);
  const dir = join(projects, "-repo-alpha");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${SESSION}.jsonl`);
  const content = `${JSON.stringify({
    message: { content: "do the thing", role: "user" },
    timestamp: "2026-08-27T10:00:00.000Z",
    type: "user",
  })}\n`;
  writeFileSync(path, content);
  return {
    bytes: Buffer.byteLength(content),
    lastWriteMs: 0,
    path,
    projectDir: "-repo-alpha",
    sessionId: SESSION,
  };
}

describe("prepare", () => {
  it("answers --help with the OK exit code before parsing anything", () => {
    expect(
      prepare({
        argv: ["node", "slopweaver", "transcripts", "turns", "--help"],
        parse: parseTranscriptsTurnsArgs,
        requireScope: true,
        usage: USAGE,
      }),
    ).toEqual({ code: EXIT_OK });
  });

  it("REFUSES an unscoped invocation when the verb requires a scope", () => {
    expect(
      prepare({
        argv: ["node", "slopweaver", "transcripts", "turns"],
        parse: parseTranscriptsTurnsArgs,
        requireScope: true,
        usage: USAGE,
      }),
    ).toEqual({ code: EXIT_USAGE });
  });
});

describe("refuse", () => {
  it("returns the usage exit code", () => {
    expect(refuse({ errors: ["--limit must be a positive whole number"], usage: USAGE })).toBe(EXIT_USAGE);
  });
});

describe("sweep", () => {
  it("walks nothing over an empty selection", () => {
    expect(sweep({ fold: (readings) => [...readings].length, sessions: [] })).toEqual({
      bytes: 0,
      failed: 0,
      results: [],
      walked: 0,
    });
  });

  it("hands each transcript's readings to the fold and counts its bytes", () => {
    const session = seededSession();
    expect(sweep({ fold: (readings) => [...readings].length, sessions: [session] })).toEqual({
      bytes: session.bytes,
      failed: 0,
      results: [1],
      walked: 1,
    });
  });

  it("counts a transcript that will not read as failed rather than abandoning the sweep", () => {
    const readable = seededSession();
    const missing: SessionFile = { ...readable, path: join(readable.path, "..", "gone.jsonl"), sessionId: "gone" };
    expect(sweep({ fold: (readings) => [...readings].length, sessions: [missing, readable] })).toEqual({
      bytes: readable.bytes,
      failed: 1,
      results: [1],
      walked: 1,
    });
  });
});
