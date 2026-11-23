import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parseCodexReviewOptions } from "../../../../../cli/commands/codex/core.js";
import { CodexCommandErrors } from "../../../../../cli/commands/codex/errors.js";
import { propertiesOrExit, resolveProperties } from "../../../../../cli/commands/codex/properties.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const COMMON = ["--pass", "r1", "--base", "main", "--bound-seconds", "240", "--max-diff-bytes", "1000"];

let dir: string | undefined;
afterEach(() => {
  rmSync(dir!, { force: true, recursive: true });
});

describe("propertiesOrExit", () => {
  it("answers the properties, or the usage exit code once the refusal is printed", () => {
    dir = mkdtempSync(join(tmpdir(), "codex-props-"));
    const inline = unwrap(
      parseCodexReviewOptions({ rest: [...COMMON, "--property-id", "r1-01", "--property", "nothing leaks"] }),
    );
    const unreadable = unwrap(
      parseCodexReviewOptions({ rest: [...COMMON, "--properties-file", join(dir, "absent.json")] }),
    );

    expect(propertiesOrExit({ options: inline })).toEqual([{ id: "r1-01", statement: "nothing leaks" }]);
    expect(propertiesOrExit({ options: unreadable })).toBe(EXIT_USAGE);
  });
});

describe("resolveProperties", () => {
  it("answers the one inline property", () => {
    dir = mkdtempSync(join(tmpdir(), "codex-props-"));
    const options = unwrap(
      parseCodexReviewOptions({ rest: [...COMMON, "--property-id", "r1-01", "--property", "nothing leaks"] }),
    );

    expect(unwrap(resolveProperties({ options }))).toEqual([{ id: "r1-01", statement: "nothing leaks" }]);
  });

  it("names an unreadable properties file", () => {
    dir = mkdtempSync(join(tmpdir(), "codex-props-"));
    const path = join(dir, "absent.json");
    const options = unwrap(parseCodexReviewOptions({ rest: [...COMMON, "--properties-file", path] }));

    expect(unwrapErr(resolveProperties({ options })).code).toBe("PROPERTIES_FILE_UNREADABLE");
  });

  it("refuses a file that is not a JSON object", () => {
    dir = mkdtempSync(join(tmpdir(), "codex-props-"));
    const path = join(dir, "props.json");
    writeFileSync(path, "[]");
    const options = unwrap(parseCodexReviewOptions({ rest: [...COMMON, "--properties-file", path] }));

    expect(unwrapErr(resolveProperties({ options }))).toEqual(CodexCommandErrors.propertiesNotObject());
  });
});
