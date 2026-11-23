import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendBronzeLines } from "../../../corpus/bronzeAppend.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-bronze-append-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("appendBronzeLines", () => {
  it("creates the window's directory and appends each line newline-terminated, after what is already there", () => {
    const file = join(home, "bronze", "chatgpt", "w.jsonl");
    unwrap(appendBronzeLines({ file, lines: ["one"] }));
    unwrap(appendBronzeLines({ file, lines: ["two", "three"] }));
    expect(readFileSync(file, "utf8")).toBe("one\ntwo\nthree\n");
  });

  it("returns a write the disk refuses as one line naming the file, rather than throwing", () => {
    mkdirSync(join(home, "bronze"));
    const blocked = join(home, "bronze", "chatgpt");
    writeFileSync(blocked, "a file where the source's directory belongs", "utf8");
    const failed = unwrapErr(appendBronzeLines({ file: join(blocked, "w.jsonl"), lines: ["lost"] }));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain(`bronze append to ${blocked}/w.jsonl failed: `);
    expect(readFileSync(blocked, "utf8")).toBe("a file where the source's directory belongs");
  });
});
