/**
 * The committed debt lists `torn-tail-append` and `whole-file-json` read from `.baselines/`, and the decoders
 * each gate reads its list through. A row lost, a field dropped or a shape this gate does not name reddens here,
 * before the gate itself would read the file as a stale or fresh entry.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseTornTailAppendBaseline } from "../../../devLint/tornTailAppend.js";
import { parseWholeFileJsonBaseline } from "../../../devLint/wholeFileJson.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const committed = ({ file }: { file: string }): string =>
  readFileSync(fileURLToPath(new URL(`../../../../.baselines/${file}`, import.meta.url)), "utf8");

describe("parseTornTailAppendBaseline", () => {
  const row = { count: 2, guard: "its own tail read", path: "src/a.ts", shape: "append-open" };

  it("decodes a well-formed list into its rows, each keeping its guard", () => {
    expect(unwrap(parseTornTailAppendBaseline({ text: JSON.stringify({ appends: [row] }) }))).toEqual([row]);
  });

  it("names a file that is not JSON as malformed", () => {
    expect(unwrapErr(parseTornTailAppendBaseline({ text: "{" })).code).toBe("BASELINE_MALFORMED");
  });

  it("refuses a shape the gate does not name, a zero count and a blank guard as the wrong shape", () => {
    const rows = [
      { ...row, shape: "append-later" },
      { ...row, count: 0 },
      { ...row, guard: " " },
    ];
    const codes = rows.map(
      (bad) => unwrapErr(parseTornTailAppendBaseline({ text: JSON.stringify({ appends: [bad] }) })).code,
    );

    expect(codes).toEqual(["BASELINE_SHAPE_INVALID", "BASELINE_SHAPE_INVALID", "BASELINE_SHAPE_INVALID"]);
  });

  it("refuses a field the gate does not read, and a second row for one path and shape, rather than dropping either", () => {
    const lists = [{ appends: [{ ...row, unexpected: true }] }, { appends: [row, { ...row, count: 9 }] }];
    const codes = lists.map((list) => unwrapErr(parseTornTailAppendBaseline({ text: JSON.stringify(list) })).code);

    expect(codes).toEqual(["BASELINE_SHAPE_INVALID", "BASELINE_SHAPE_INVALID"]);
  });
});

describe("the committed torn-tail-append baseline", () => {
  const appends = unwrap(parseTornTailAppendBaseline({ text: committed({ file: "torn-tail-append-baseline.json" }) }));

  it("records five descriptor appends across four files, each with the guard it keeps", () => {
    expect(appends.length).toBeGreaterThan(0);
    expect(appends.map(({ count, path, shape }) => `${path} ${shape} ${String(count)}`)).toEqual([
      "src/worktree/pruneTriggerDetach.ts append-open 1",
      "src/workstreams/ledgerAppend.ts append-open 2",
      "src/outbound/github/walkthroughLedger.ts append-open 1",
      "src/talk/callThreadFiles.ts append-open 1",
    ]);
    expect(appends.reduce((sum, entry) => sum + entry.count, 0)).toBe(5);
  });
});

describe("parseWholeFileJsonBaseline", () => {
  const row = { owes: "unowned — no run", path: "src/a.ts", shape: "jsonl-read-whole" };

  it("decodes a well-formed list into its rows, each keeping who owes it", () => {
    expect(unwrap(parseWholeFileJsonBaseline({ text: JSON.stringify({ sites: [row] }) }))).toEqual([row]);
  });

  it("names a file that is not JSON as malformed", () => {
    expect(unwrapErr(parseWholeFileJsonBaseline({ text: "[" })).code).toBe("BASELINE_MALFORMED");
  });

  it("refuses a shape the gate does not name and a blank owes as the wrong shape, naming the shape it wanted", () => {
    const shapeError = unwrapErr(
      parseWholeFileJsonBaseline({ text: JSON.stringify({ sites: [{ ...row, shape: "jsonl-sideways" }] }) }),
    );
    const owesError = unwrapErr(
      parseWholeFileJsonBaseline({ text: JSON.stringify({ sites: [{ ...row, owes: "" }] }) }),
    );

    expect(shapeError.code).toBe("BASELINE_SHAPE_INVALID");
    expect(shapeError.message).toContain("{ sites: [{ path, shape, owes }, …] }");
    expect(owesError.code).toBe("BASELINE_SHAPE_INVALID");
  });

  it("refuses a field the gate does not read, and a duplicated site, naming one row per path and shape", () => {
    const extra = unwrapErr(parseWholeFileJsonBaseline({ text: JSON.stringify({ sites: [{ ...row, line: 3 }] }) }));
    const twice = unwrapErr(parseWholeFileJsonBaseline({ text: JSON.stringify({ sites: [row, row] }) }));

    expect(extra.code).toBe("BASELINE_SHAPE_INVALID");
    expect(twice.code).toBe("BASELINE_SHAPE_INVALID");
    expect(twice.message).toContain("one row per path and shape");
  });
});

describe("the committed whole-file-json baseline", () => {
  const sites = unwrap(parseWholeFileJsonBaseline({ text: committed({ file: "whole-file-json-baseline.json" }) }));

  it("records twenty-two sites: twenty-one whole .jsonl reads and the one whole corpus payload", () => {
    expect(sites.length).toBe(22);
    expect(sites.filter((site) => site.shape === "jsonl-read-whole").length).toBe(21);
    expect(sites.filter((site) => site.shape === "corpus-payload-whole").map((site) => site.path)).toEqual([
      "src/silver/derive/pipeline.ts",
    ]);
  });

  it("never records the same path and shape twice, since the gate covers a pair once however often it fires", () => {
    const identities = sites.map((site) => `${site.path} ${site.shape}`);

    expect(identities.length).toBeGreaterThan(0);
    expect(new Set(identities).size).toBe(identities.length);
  });
});
