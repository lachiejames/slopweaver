/*
 * The two kept-line sinks a subset build writes through: the streaming one writes every line it is pushed, the
 * capped one only the newest N, oldest first, with a tie on `tsIso` going to the line seen first.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CorpusJudge } from "../../../corpus/bronzeProtection.js";
import { openCappedSink, openSink } from "../../../corpus/subsetSink.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

/** A judge that allows every path — what a build hands its sinks once its own preflight passed. */
const ALLOW: CorpusJudge = () => ok(undefined);

/** A judge refusing every path with one fixed line, standing in for a protect-list refusal. */
const REFUSE: CorpusJudge = ({ path }) => err([`refused ${path}`]);

const dirs: string[] = [];

/** A file path inside a throwaway directory, under a parent that does not exist yet. */
function nestedPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "subset-sink-"));
  dirs.push(dir);
  return join(dir, "bronze", "slack", "window.jsonl");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("openSink", () => {
  it("writes every pushed line once flushed, creating the missing parent directory", () => {
    const path = nestedPath();
    const sink = unwrap(openSink({ judge: ALLOW, path }));
    sink.push({ line: "first", tsIso: "2026-01-02T00:00:00.000Z" });
    sink.push({ line: "second", tsIso: "2026-01-01T00:00:00.000Z" });
    expect(sink.written()).toBe(2);
    sink.flush();
    expect(readFileSync(path, "utf8")).toBe("first\nsecond\n");
  });

  it("flushes on its own once a batch reaches 8 MiB, before any explicit flush", () => {
    const path = nestedPath();
    const sink = unwrap(openSink({ judge: ALLOW, path }));
    const line = "x".repeat(8 * 1024 * 1024);
    sink.push({ line, tsIso: "2026-01-01T00:00:00.000Z" });
    expect(readFileSync(path, "utf8")).toBe(`${line}\n`);
  });

  it("creates nothing when flushed with no lines", () => {
    const path = nestedPath();
    const sink = unwrap(openSink({ judge: ALLOW, path }));
    sink.flush();
    expect(sink.written()).toBe(0);
    expect(existsSync(dirname(path))).toBe(false);
  });
});

describe("a sink the judge refuses", () => {
  it("is never opened, by either kind, and touches no directory", () => {
    const path = nestedPath();
    expect(unwrapErr(openSink({ judge: REFUSE, path }))).toEqual([`refused ${path}`]);
    expect(unwrapErr(openCappedSink({ judge: REFUSE, limit: 1, path }))).toEqual([`refused ${path}`]);
    expect(existsSync(dirname(path))).toBe(false);
  });
});

describe("openCappedSink", () => {
  it("keeps only the newest lines and writes them oldest first", () => {
    const path = nestedPath();
    const sink = unwrap(openCappedSink({ judge: ALLOW, limit: 2, path }));
    sink.push({ line: "middle", tsIso: "2026-01-02T00:00:00.000Z" });
    sink.push({ line: "oldest", tsIso: "2026-01-01T00:00:00.000Z" });
    sink.push({ line: "newest", tsIso: "2026-01-03T00:00:00.000Z" });
    expect(sink.written()).toBe(2);
    sink.flush();
    expect(readFileSync(path, "utf8")).toBe("middle\nnewest\n");
  });

  it("refuses a line tied with the oldest kept once full, so the line seen first survives", () => {
    const path = nestedPath();
    const sink = unwrap(openCappedSink({ judge: ALLOW, limit: 1, path }));
    sink.push({ line: "seen first", tsIso: "2026-01-01T00:00:00.000Z" });
    sink.push({ line: "seen second", tsIso: "2026-01-01T00:00:00.000Z" });
    sink.flush();
    expect(readFileSync(path, "utf8")).toBe("seen first\n");
  });

  it("keeps tied lines in the order they were seen while under the cap", () => {
    const path = nestedPath();
    const sink = unwrap(openCappedSink({ judge: ALLOW, limit: 3, path }));
    sink.push({ line: "seen first", tsIso: "2026-01-01T00:00:00.000Z" });
    sink.push({ line: "seen second", tsIso: "2026-01-01T00:00:00.000Z" });
    sink.flush();
    expect(readFileSync(path, "utf8")).toBe("seen first\nseen second\n");
  });
});
