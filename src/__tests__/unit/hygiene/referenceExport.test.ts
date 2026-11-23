/**
 * Reading the zero-references inputs off a temp home — a genuine filesystem fixture. The export itself runs
 * real git and lives in the subprocess lane (`subprocess/hygiene/referenceExport.test.ts`).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readReferenceInputs } from "../../../hygiene/referenceExport.js";
import { ReferenceExportErrors } from "../../../hygiene/referenceExportErrors.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";

let home: string;

/** Write the map file under the temp home. */
const writeMap = ({ text }: { text: string }): string => {
  const path = stateHomePaths({ home }).referenceMap;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "zr-inputs-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("ReferenceExportErrors.stepFailed", () => {
  it("names the step and keeps only a thrown error's first line, where git's own stderr follows", () => {
    const error = ReferenceExportErrors.stepFailed({
      cause: new Error("Command failed: git archive\nfatal: a long stderr tail"),
      step: "archive",
    });
    expect(error.code).toBe("EXPORT_STEP_FAILED");
    expect(error.message).toBe("archive failed: Command failed: git archive");
  });

  it("prints a non-Error cause as text", () => {
    expect(ReferenceExportErrors.stepFailed({ cause: "ETIMEDOUT", step: "unzip" }).message).toBe(
      "unzip failed: ETIMEDOUT",
    );
  });
});

describe("readReferenceInputs", () => {
  it("reads the map's rows, with no denylist when the home has none", () => {
    const mapPath = writeMap({ text: "class\tflags\tpattern\npeople\ti\t\\bzorblatt\\b\n" });
    const inputs = unwrap(readReferenceInputs({ home, mapPath }));
    expect(inputs.map.map((row) => row.className)).toEqual(["people"]);
    expect(inputs.denylist).toEqual([]);
  });

  it("refuses a missing map, naming where it was looked for", () => {
    const mapPath = stateHomePaths({ home }).referenceMap;
    const error = unwrapErr(readReferenceInputs({ home, mapPath }));
    expect(error.code).toBe("REFERENCE_MAP_ABSENT");
    expect(error.message).toContain(mapPath);
  });

  it("refuses a map path that is a directory, so it cannot be read", () => {
    const mapPath = join(home, "a-directory");
    mkdirSync(mapPath);
    expect(unwrapErr(readReferenceInputs({ home, mapPath })).code).toBe("REFERENCE_INPUT_UNREADABLE");
  });

  it("passes a malformed map's own failure through", () => {
    const mapPath = writeMap({ text: "people\ti\tzorblatt\n" });
    expect(unwrapErr(readReferenceInputs({ home, mapPath })).code).toBe("MAP_HEADER_MISSING");
  });
});
