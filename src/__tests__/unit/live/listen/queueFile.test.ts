/**
 * The `--queue` durability path: a real round-trip against a temp directory, because this function's whole
 * job IS a filesystem effect — there is no pure core to extract it into and test instead.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendQueueLine } from "../../../../live/listen/queueFile.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("appendQueueLine", () => {
  it("creates the file and its parent directory when neither exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-queue-"));
    fixtureDirs.push(dir);
    const path = join(dir, "nested", "queue.jsonl");

    appendQueueLine({ line: JSON.stringify({ tag: "one" }), path });

    expect(readFileSync(path, "utf8")).toBe('{"tag":"one"}\n');
  });

  it("appends rather than overwrites — one JSONL line per call, in call order", () => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-queue-"));
    fixtureDirs.push(dir);
    const path = join(dir, "queue.jsonl");

    appendQueueLine({ line: JSON.stringify({ tag: "one" }), path });
    appendQueueLine({ line: JSON.stringify({ tag: "two" }), path });

    expect(readFileSync(path, "utf8")).toBe('{"tag":"one"}\n{"tag":"two"}\n');
  });
});
