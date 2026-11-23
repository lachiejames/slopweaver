/*
 * The register framing pass: physical lines become decoded objects with their exact line spans, and a region
 * that never closes, or names one key twice, is refused on the line it starts on.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { frameObjects } from "../../../autonomy/adoptFraming.js";
import { AutonomyErrors } from "../../../autonomy/errors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** Write a register's exact bytes into a throwaway directory and answer its path. */
function registerFile({ text }: { text: string }): string {
  const root = mkdtempSync(join(tmpdir(), "sw-frame-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  const path = join(root, "autonomy.jsonl");
  writeFileSync(path, text, "utf8");
  return path;
}

describe("frameObjects", () => {
  it("hands each object to the callback with its line span and answers the physical line count", () => {
    const path = registerFile({ text: ['{"actionId":"a-1"}', "{", '  "actionId": "a-2"', "}", ""].join("\n") });
    const seen: { actionId: unknown; firstLine: number; lastLine: number }[] = [];

    const framed = frameObjects({
      onObject: ({ value, firstLine, lastLine }) => {
        seen.push({ actionId: value["actionId"], firstLine, lastLine });
        return undefined;
      },
      path,
    });

    expect(unwrap(framed)).toBe(4);
    expect(seen).toEqual([
      { actionId: "a-1", firstLine: 1, lastLine: 1 },
      { actionId: "a-2", firstLine: 2, lastLine: 4 },
    ]);
  });

  it("refuses a file that ends in the middle of an object, on the line the object opened", () => {
    const path = registerFile({ text: ['{"actionId":"a-1"}', '{"actionId":'].join("\n") });

    const framed = frameObjects({ onObject: () => undefined, path });

    expect(unwrapErr(framed)).toEqual(
      AutonomyErrors.corruptRow({
        lineNumber: 2,
        why: "is the start of a JSON object the file ends in the middle of",
      }),
    );
  });

  it("refuses an object naming one key twice before the callback ever sees it", () => {
    const path = registerFile({ text: '{"actionId":"a-1","actionId":"a-2"}\n' });
    const seen: unknown[] = [];

    const framed = frameObjects({
      onObject: ({ value }) => {
        seen.push(value);
        return undefined;
      },
      path,
    });

    expect(unwrapErr(framed)).toEqual(
      AutonomyErrors.corruptRow({
        lineNumber: 1,
        why:
          'names "actionId" twice, and JSON keeps only the last — so adopting it would drop what the session ' +
          "wrote first without saying so. Fix the row in the register, then adopt again",
      }),
    );
    expect(seen).toEqual([]);
  });

  it("stops at the first refusal the callback returns and answers it unchanged", () => {
    const path = registerFile({ text: ['{"actionId":"a-1"}', '{"actionId":"a-2"}', ""].join("\n") });
    const refusal = AutonomyErrors.corruptRow({ lineNumber: 1, why: "the callback refused it" });
    const seen: unknown[] = [];

    const framed = frameObjects({
      onObject: ({ value }) => {
        seen.push(value["actionId"]);
        return refusal;
      },
      path,
    });

    expect(unwrapErr(framed)).toEqual(refusal);
    expect(seen).toEqual(["a-1"]);
  });
});
