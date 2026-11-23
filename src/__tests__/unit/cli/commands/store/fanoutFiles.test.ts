/*
 * The fan-out's files read back off disk: a shard file hashes by its bytes, a plan and the replies are refused
 * by path or shape rather than read as empty, and a shard's records come from its file, skipping a stray line.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { digestOf, readPlan, readReplies, shardsFromDisk } from "../../../../../cli/commands/store/fanoutFiles.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh temp directory, removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-fanout-files-"));
  dirs.push(dir);
  return dir;
}

/** One shard record exactly as `store read` writes it. */
const RECORD = {
  author: "ada",
  clipped: false,
  container: "acme/repo",
  id: "r1",
  source: "github",
  text: "the pool was resized",
  title: null,
  tsIso: "2026-11-01T00:00:00.000Z",
  url: "https://example.com/r1",
};

describe("digestOf", () => {
  it("hashes the file's raw bytes", () => {
    const path = join(tempDir(), "s1.jsonl");
    writeFileSync(path, "line one\r\nline two\n", "utf8");
    expect(digestOf({ shardFile: path })).toBe(
      createHash("sha256").update("line one\r\nline two\n", "utf8").digest("hex"),
    );
  });

  it("answers null for a file that cannot be read", () => {
    expect(digestOf({ shardFile: join(tempDir(), "absent.jsonl") })).toBeNull();
  });
});

describe("readPlan", () => {
  it("names the path it could not read", () => {
    const path = join(tempDir(), "plan.json");
    expect(readPlan({ planFile: path })).toStrictEqual({
      errors: [`cannot read the plan at ${path}: ENOENT: no such file or directory, open '${path}'`],
    });
  });

  it("refuses a file that is not a fan-out plan", () => {
    const path = join(tempDir(), "plan.json");
    writeFileSync(path, JSON.stringify({ question: "q" }), "utf8");
    expect(readPlan({ planFile: path })).toStrictEqual({
      errors: [expect.stringContaining(`${path} is not a fan-out plan: `)],
    });
  });

  it("reads each shard's metadata, carrying a token only where the plan has one", () => {
    const path = join(tempDir(), "plan.json");
    const shards = [
      { digest: "d1", id: "s1", records: 1 },
      { digest: "d2", id: "s2", records: 0, token: "t2" },
    ];
    writeFileSync(path, JSON.stringify({ candidates: 1, question: "q", shards }), "utf8");
    expect(readPlan({ planFile: path })).toStrictEqual({ plan: { candidates: 1, question: "q", shards } });
  });
});

describe("shardsFromDisk", () => {
  it("takes records from the shard file, skipping a stray line, and hashes each file", () => {
    const dir = tempDir();
    const bytes = `${JSON.stringify(RECORD)}\n\n${JSON.stringify({ id: 1 })}\n`;
    writeFileSync(join(dir, "s1.jsonl"), bytes, "utf8");
    const read = shardsFromDisk({
      plan: {
        candidates: 1,
        question: "q",
        shards: [
          { digest: "d1", id: "s1", records: 1, token: "t1" },
          { digest: "d2", id: "s2", records: 0 },
        ],
      },
      planPath: join(dir, "plan.json"),
    });
    expect(read.shards).toStrictEqual([
      { digest: "d1", id: "s1", records: [RECORD], token: "t1" },
      { digest: "d2", id: "s2", records: [] },
    ]);
    expect(read.digests.get("s1")).toBe(createHash("sha256").update(bytes, "utf8").digest("hex"));
    expect(read.digests.get("s2")).toBeNull();
  });
});

describe("readReplies", () => {
  it("reads a single reply object as a list of one", () => {
    const path = join(tempDir(), "replies.json");
    writeFileSync(path, JSON.stringify({ findings: [], shard: "s1" }), "utf8");
    expect(readReplies({ repliesFile: path })).toStrictEqual({ replies: [{ findings: [], shard: "s1" }] });
  });

  it("refuses a reply that is not the asked-for shape, by its position", () => {
    const path = join(tempDir(), "replies.json");
    writeFileSync(path, JSON.stringify([{ findings: [], shard: "s1" }, { shard: "s2" }]), "utf8");
    expect(readReplies({ repliesFile: path })).toStrictEqual({
      errors: [expect.stringContaining("reply 2 is not a reader reply: ")],
    });
  });

  it("names the path it could not read", () => {
    const path = join(tempDir(), "replies.json");
    expect(readReplies({ repliesFile: path })).toStrictEqual({
      errors: [`cannot read the replies at ${path}: ENOENT: no such file or directory, open '${path}'`],
    });
  });
});
