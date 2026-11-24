/**
 * Streaming a corpus tree for identity candidates, over a real temp tree: first-seen order across files and
 * nested directories, dedupe on the shared key, silent skipping of lines that name nobody, and an unlistable
 * directory reported in both `unreadable` and `warnings`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { streamIdentityCandidates } from "../../../silver/identityCandidateStream.js";

/** An owner protect list with no entries, so no test reads the owner's own registry. */
const NO_ENTRIES: OwnerProtectionResolver = () => ok([]);

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "identity-stream-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** One corpus record, with the authorship fields a test varies overridable. */
const rec = (over: Partial<CorpusRecord>): CorpusRecord => ({
  container: "C1",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "1",
  text: "t",
  tsIso: "2026-10-01T00:00:00.000Z",
  url: "https://example.test/1",
  ...over,
});

/** Write lines as one JSONL file. */
const writeJsonl = ({ path, lines }: { path: string; lines: readonly string[] }): void => {
  writeFileSync(path, `${lines.join("\n")}\n`);
};

describe("streamIdentityCandidates", () => {
  it("emits each distinct candidate once, in first-seen order across files and nested directories", () => {
    writeJsonl({
      lines: [
        JSON.stringify(rec({ author: "U0SYN1AAAAAAA", sourceId: "a1" })),
        "{not json",
        "",
        JSON.stringify({ unrelated: true }),
        JSON.stringify(rec({ author: "Ada Display Name", sourceId: "a2" })),
        JSON.stringify(
          rec({ author: "octocat", container: "o/r", kind: "pr", source: "github", sourceId: "#1", url: "u" }),
        ),
      ],
      path: join(root, "a.jsonl"),
    });
    mkdirSync(join(root, "nested"));
    writeJsonl({
      lines: [
        JSON.stringify(rec({ author: "U0SYN1AAAAAAA", sourceId: "b1" })),
        JSON.stringify(rec({ author: "U0SYN2BBBBBBB", sourceId: "b2" })),
      ],
      path: join(root, "nested", "b.jsonl"),
    });
    writeFileSync(join(root, "notes.txt"), JSON.stringify(rec({ author: "U0SYN3CCCCCCC" })));

    expect(unwrap(streamIdentityCandidates({ dir: root, home: root, protection: NO_ENTRIES }))).toEqual({
      candidates: [
        { name: "U0SYN1AAAAAAA", nativeId: "U0SYN1AAAAAAA", source: "slack" },
        { name: "octocat", nativeId: "octocat", source: "github" },
        { name: "U0SYN2BBBBBBB", nativeId: "U0SYN2BBBBBBB", source: "slack" },
      ],
      unreadable: [],
      warnings: [],
    });
  });

  it("reports a directory that cannot be listed in both unreadable and warnings, naming its path", () => {
    const missing = join(root, "missing");

    expect(unwrap(streamIdentityCandidates({ dir: missing, home: root, protection: NO_ENTRIES }))).toEqual({
      candidates: [],
      unreadable: [missing],
      warnings: [`${missing}: directory could not be listed — any person named only there will not resolve`],
    });
  });

  it("refuses a tree the owner's protect list marks no-access, rather than answering with nobody", () => {
    writeJsonl({ lines: [JSON.stringify(rec({ author: "U0SYN1AAAAAAA" }))], path: join(root, "a.jsonl") });
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: root, why: "fixture" };

    const refusal = unwrapErr(streamIdentityCandidates({ dir: root, home: root, protection: () => ok([entry]) }));

    expect(refusal.length).toBe(1);
    expect(refusal[0]).toContain(`it would list ${root}, which the owner's protect list marks no-access`);
  });

  it("names a subtree the protect list kept out of the walk, and reads the candidates beside it", () => {
    writeJsonl({ lines: [JSON.stringify(rec({ author: "U0SYN1AAAAAAA" }))], path: join(root, "a.jsonl") });
    const held = join(root, "held");
    mkdirSync(held);
    writeJsonl({ lines: [JSON.stringify(rec({ author: "U0SYN2BBBBBBB" }))], path: join(held, "b.jsonl") });
    const entry = { addedIso: "2026-01-01T00:00:00.000Z", mode: "no-access" as const, path: held, why: "fixture" };

    const read = unwrap(streamIdentityCandidates({ dir: root, home: root, protection: () => ok([entry]) }));

    expect(read.candidates.map((candidate) => candidate.nativeId)).toEqual(["U0SYN1AAAAAAA"]);
    expect(read.warnings).toEqual([`NOT READ, protected by the owner's list: ${held} [no-access]`]);
  });
});
