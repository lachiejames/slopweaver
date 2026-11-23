/**
 * The generator's command line: each mode it reads, and every line it refuses rather than guessing at — above
 * all a `--spec-dir` that would otherwise fall back to the committed-only check and still print success.
 */
import { describe, expect, it } from "vitest";

import { parseGoogleSecopsGeneratorArgs } from "../../../../atlas/googleSecops/generatorArgs.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("parseGoogleSecopsGeneratorArgs", () => {
  it("reads each mode the generator runs in", () => {
    const modes = [
      ["--verify"],
      ["--verify", "--spec-dir", "/pins"],
      ["--spec-dir", "/pins", "--verify"],
      ["--fetch", "/into"],
      ["--verify", "--fetch", "/into"],
      [],
      ["--spec-dir", "-pins"],
      ["--spec-dir", "a--b"],
    ].map((argv) => unwrap(parseGoogleSecopsGeneratorArgs({ argv })));
    expect(modes).toStrictEqual([
      { fetchInto: undefined, specDirectory: undefined, verifyOnly: true },
      { fetchInto: undefined, specDirectory: "/pins", verifyOnly: true },
      { fetchInto: undefined, specDirectory: "/pins", verifyOnly: true },
      { fetchInto: "/into", specDirectory: "/into", verifyOnly: false },
      { fetchInto: "/into", specDirectory: "/into", verifyOnly: true },
      { fetchInto: undefined, specDirectory: undefined, verifyOnly: false },
      { fetchInto: undefined, specDirectory: "-pins", verifyOnly: false },
      { fetchInto: undefined, specDirectory: "a--b", verifyOnly: false },
    ]);
  });

  it("refuses a directory flag with no directory, another flag in its place, or given twice", () => {
    const lines = [
      ["--verify", "--spec-dir"],
      ["--spec-dir", "--verify"],
      ["--fetch"],
      ["--spec-dir", "/a", "--spec-dir", "/b"],
      ["--spec-dir", "--fetch"],
    ].map((argv) => unwrapErr(parseGoogleSecopsGeneratorArgs({ argv })));
    expect(lines).toStrictEqual([
      ["--spec-dir takes exactly one directory, given once"],
      ["--spec-dir takes exactly one directory, given once"],
      ["--fetch takes exactly one directory, given once"],
      ["--spec-dir takes exactly one directory, given once"],
      ["--spec-dir takes exactly one directory, given once"],
    ]);
  });

  it("refuses an argument it does not name, and both directory flags at once", () => {
    const unknown = ["--specdir", "--verifyx"].map((flag) =>
      unwrapErr(parseGoogleSecopsGeneratorArgs({ argv: [flag, "/pins"] })),
    );
    expect(unknown).toStrictEqual([
      ["unknown argument --specdir — the generator takes --verify, --fetch <dir> and --spec-dir <dir>"],
      ["unknown argument --verifyx — the generator takes --verify, --fetch <dir> and --spec-dir <dir>"],
    ]);
    expect(
      unwrapErr(parseGoogleSecopsGeneratorArgs({ argv: ["--fetch", "/into", "--spec-dir", "/pins"] })),
    ).toStrictEqual(["--fetch and --spec-dir each name where the pinned files are read — give one"]);
  });
});
