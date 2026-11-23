/**
 * The effectful edge, over a REAL temporary projects directory written by this test and read back by the
 * shipped code — no mocks, and no assumption about the machine's own `~/.claude`.
 *
 * The chunk-boundary case is the one that matters most: the walker reads a transcript in fixed slices, so a
 * record that straddles a slice would be lost or corrupted by a naive implementation, and the file sizes
 * involved (tens of megabytes) mean the bug would only ever appear in production.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { LineReading, TranscriptRecord } from "../../../transcripts/record.js";
import {
  CHUNK_BYTES,
  findTranscript,
  listSessions,
  surveySessions,
  transcriptReadings,
} from "../../../transcripts/source.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A projects directory holding two project dirs, three transcripts, and a nested subagent file. */
function seededProjects(): string {
  const projects = mkdtempSync(join(tmpdir(), "transcripts-source-"));
  fixtureDirs.push(projects);
  const alpha = join(projects, "-repo-alpha");
  const beta = join(projects, "-repo-beta");
  mkdirSync(alpha, { recursive: true });
  mkdirSync(join(alpha, "aaaaaaaa-0000-0000-0000-000000000001", "subagents"), { recursive: true });
  mkdirSync(beta, { recursive: true });
  writeFileSync(join(alpha, "aaaaaaaa-0000-0000-0000-000000000001.jsonl"), `${line({ text: "one" })}\n`);
  writeFileSync(join(alpha, "aaaaaaaa-0000-0000-0000-000000000001", "subagents", "agent-x.jsonl"), "{}\n");
  writeFileSync(join(beta, "bbbbbbbb-0000-0000-0000-000000000002.jsonl"), `${line({ text: "two" })}\n`);
  writeFileSync(join(beta, "not-a-transcript.txt"), "ignored");
  return projects;
}

/** One user line, serialised the way Claude Code writes one. */
function line({ text }: { text: string }): string {
  return JSON.stringify({ message: { content: text, role: "user" }, promptSource: "typed", type: "user" });
}

/** The decoded records of a stream, dropping the undecoded lines. */
function recordsOf({ readings }: { readings: Iterable<LineReading> }): readonly TranscriptRecord[] {
  return [...readings]
    .filter((reading): reading is { readonly record: TranscriptRecord } => "record" in reading)
    .map((reading) => reading.record);
}

describe("listSessions", () => {
  it("lists the top-level transcripts of every project directory, newest first", () => {
    const listed = unwrap(listSessions({ projectsDir: seededProjects() }));
    expect(listed.map((session) => session.sessionId).toSorted()).toStrictEqual([
      "aaaaaaaa-0000-0000-0000-000000000001",
      "bbbbbbbb-0000-0000-0000-000000000002",
    ]);
    expect(listed.map((session) => session.projectDir).toSorted()).toStrictEqual(["-repo-alpha", "-repo-beta"]);
  });

  it("leaves the nested subagent transcripts out, so a session count is a count of windows", () => {
    const listed = unwrap(listSessions({ projectsDir: seededProjects() }));
    expect(listed.length).toBe(2);
    expect(listed.filter((session) => session.sessionId.startsWith("agent-")).length).toBe(0);
  });

  it("reports the size of each transcript", () => {
    const listed = unwrap(listSessions({ projectsDir: seededProjects() }));
    expect(listed.every((session) => session.bytes > 0)).toBe(true);
  });

  it("returns a typed error naming the directory when the corpus is not there at all", () => {
    const error = unwrapErr(listSessions({ projectsDir: join(tmpdir(), "definitely-not-a-projects-dir-9f3a") }));
    expect(error.code).toBe("PROJECTS_DIR_UNREADABLE");
    expect(error.message).toContain("could not be listed");
  });

  it("names a project directory it could not list, through surveySessions, while listing the rest", () => {
    const projects = seededProjects();
    const hidden = join(projects, "-repo-hidden");
    mkdirSync(hidden);
    chmodSync(hidden, 0o000);
    try {
      const survey = unwrap(surveySessions({ projectsDir: projects }));
      expect(survey.unreadableDirs).toStrictEqual(["-repo-hidden"]);
      expect(survey.sessions.length).toBe(2);
    } finally {
      chmodSync(hidden, 0o755);
    }
  });

  it("lists a symlinked project directory by listing it, never by its dirent type, and passes over a stray file", () => {
    const projects = seededProjects();
    const elsewhere = mkdtempSync(join(tmpdir(), "transcripts-linked-"));
    fixtureDirs.push(elsewhere);
    writeFileSync(join(elsewhere, "cccccccc-0000-0000-0000-000000000003.jsonl"), `${line({ text: "three" })}\n`);
    symlinkSync(elsewhere, join(projects, "-repo-linked"));
    writeFileSync(join(projects, "stray.txt"), "not a project");
    const survey = unwrap(surveySessions({ projectsDir: projects }));
    expect(survey.sessions.map((session) => session.projectDir).toSorted()).toStrictEqual([
      "-repo-alpha",
      "-repo-beta",
      "-repo-linked",
    ]);
    expect(survey.unreadableDirs).toStrictEqual([]);
  });

  it("names a project directory it could list but not search, since its transcripts could not be stat'd", () => {
    const projects = seededProjects();
    const beta = join(projects, "-repo-beta");
    chmodSync(beta, 0o444);
    try {
      const survey = unwrap(surveySessions({ projectsDir: projects }));
      expect(survey.unreadableDirs).toStrictEqual(["-repo-beta"]);
      expect(survey.sessions.map((session) => session.projectDir)).toStrictEqual(["-repo-alpha"]);
    } finally {
      chmodSync(beta, 0o755);
    }
  });

  it("returns an empty list, not an error, for a projects directory with no project dirs in it", () => {
    const projectsDir = mkdtempSync(join(tmpdir(), "transcripts-empty-"));
    fixtureDirs.push(projectsDir);
    expect(unwrap(listSessions({ projectsDir }))).toStrictEqual([]);
  });
});

describe("findTranscript", () => {
  it("finds a transcript by SEARCHING the project directories rather than reconstructing the path", () => {
    const projects = seededProjects();
    expect(unwrap(findTranscript({ projectsDir: projects, sessionId: "bbbbbbbb-0000-0000-0000-000000000002" }))).toBe(
      join(projects, "-repo-beta", "bbbbbbbb-0000-0000-0000-000000000002.jsonl"),
    );
  });

  it("returns a typed error for a session that is not there, naming retention as one reason", () => {
    const error = unwrapErr(findTranscript({ projectsDir: seededProjects(), sessionId: "cccccccc" }));
    expect(error.code).toBe("SESSION_NOT_FOUND");
    expect(error.message).toContain("aged out of retention");
  });

  it("refuses an empty session id rather than searching for `.jsonl`", () => {
    const error = unwrapErr(findTranscript({ projectsDir: seededProjects(), sessionId: "" }));
    expect(error.code).toBe("SESSION_NOT_FOUND");
    expect(error.message).toBe("no session id was given, so no transcript can be located");
  });
});

describe("transcriptReadings", () => {
  it("yields one reading per line and reports no problems", () => {
    const projects = seededProjects();
    const stream = unwrap(
      transcriptReadings({ path: join(projects, "-repo-alpha", "aaaaaaaa-0000-0000-0000-000000000001.jsonl") }),
    );
    expect(recordsOf({ readings: stream.readings }).map((record) => record.text)).toStrictEqual(["one"]);
    expect(stream.problems).toStrictEqual([]);
  });

  it("stitches a record that straddles a chunk boundary back together", () => {
    const dir = mkdtempSync(join(tmpdir(), "transcripts-big-"));
    fixtureDirs.push(dir);
    const padding = "x".repeat(4_096);
    const count = Math.ceil((CHUNK_BYTES * 2) / padding.length);
    const lines = Array.from({ length: count }, (_, index) => line({ text: `${index}-${padding}` }));
    const path = join(dir, "big.jsonl");
    writeFileSync(path, `${lines.join("\n")}\n`);
    const stream = unwrap(transcriptReadings({ path }));
    const records = recordsOf({ readings: stream.readings });
    expect(records.length).toBe(count);
    expect(records.at(-1)!.text).toBe(`${count - 1}-${padding}`);
    expect(records.at(-1)!.lineNumber).toBe(count);
    expect(stream.problems).toStrictEqual([]);
  });

  it("keeps a multibyte character whole when it straddles a chunk boundary", () => {
    const dir = mkdtempSync(join(tmpdir(), "transcripts-utf8-"));
    fixtureDirs.push(dir);
    const second = line({ text: "—" });
    const dashAt = Buffer.byteLength(second.slice(0, second.indexOf("—")));
    const padding = CHUNK_BYTES - 2 - dashAt - Buffer.byteLength(line({ text: "" }));
    const first = line({ text: "x".repeat(padding) });
    const path = join(dir, "utf8.jsonl");
    writeFileSync(path, `${first}\n${second}\n`);
    expect(Buffer.byteLength(`${first}\n`) + dashAt).toBe(CHUNK_BYTES - 1);
    const records = recordsOf({ readings: unwrap(transcriptReadings({ path })).readings });
    expect(records.map((record) => record.text.length)).toStrictEqual([padding, 1]);
    expect(records[1]!.text).toBe("—");
  });

  it("decodes only the bytes a short read returned, and reports the shortfall rather than stale bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "transcripts-short-"));
    fixtureDirs.push(dir);
    const path = join(dir, "short.jsonl");
    const first = `${line({ text: "a" })}\n`;
    writeFileSync(path, `${first}${line({ text: "b" })}\n`);
    const stream = unwrap(transcriptReadings({ path }));
    truncateSync(path, Buffer.byteLength(first));
    const readings = [...stream.readings];
    expect(recordsOf({ readings }).map((record) => record.text)).toStrictEqual(["a"]);
    expect(readings.length).toBe(1);
    expect(stream.problems).toStrictEqual([
      `read returned nothing at byte ${Buffer.byteLength(first)} of ${stream.bytes}: the file shrank while it was walked — this pass is INCOMPLETE`,
    ]);
  });

  it("reads a final line that has no trailing newline", () => {
    const dir = mkdtempSync(join(tmpdir(), "transcripts-tail-"));
    fixtureDirs.push(dir);
    const path = join(dir, "tail.jsonl");
    writeFileSync(path, `${line({ text: "a" })}\n${line({ text: "b" })}`);
    const stream = unwrap(transcriptReadings({ path }));
    expect(recordsOf({ readings: stream.readings }).map((record) => record.text)).toStrictEqual(["a", "b"]);
  });

  it("yields nothing for an empty file, and calls that no problem at all", () => {
    const dir = mkdtempSync(join(tmpdir(), "transcripts-void-"));
    fixtureDirs.push(dir);
    const path = join(dir, "void.jsonl");
    writeFileSync(path, "");
    const stream = unwrap(transcriptReadings({ path }));
    expect([...stream.readings]).toStrictEqual([]);
    expect(stream.bytes).toBe(0);
  });

  it("reports a half-written last line as undecoded rather than throwing on it", () => {
    const dir = mkdtempSync(join(tmpdir(), "transcripts-torn-"));
    fixtureDirs.push(dir);
    const path = join(dir, "torn.jsonl");
    writeFileSync(path, `${line({ text: "a" })}\n{"type":"user","mess`);
    const readings = [...unwrap(transcriptReadings({ path })).readings];
    expect(readings.length).toBe(2);
    expect(readings[1]).toStrictEqual({ undecoded: { lineNumber: 2, why: "not-json" } });
  });

  it("returns a typed error naming the path when the transcript cannot be opened", () => {
    const error = unwrapErr(transcriptReadings({ path: join(tmpdir(), "no-such-transcript-4c1e.jsonl") }));
    expect(error.code).toBe("TRANSCRIPT_UNREADABLE");
    expect(error.message).toContain("no-such-transcript-4c1e.jsonl");
  });
});
