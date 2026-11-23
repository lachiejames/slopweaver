/**
 * `scriptHostInvocation.ts`: where `node`/`tsx` could find the script they run.
 */
import { describe, expect, it } from "vitest";

import { nodeRunScript, optionNamesModule, scriptHostStarts } from "../../../admit/scriptHostInvocation.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** The words `node --run` hands its script, as plain strings, for one literal tail. */
function runScript({ text }: { text: string }): readonly string[] | undefined {
  return nodeRunScript({ args: shellWords({ text }).words })?.map((word) => word.text);
}

describe("nodeRunScript", () => {
  it("reads the attached and spaced spellings, with the words after the script", () => {
    expect(runScript({ text: "--run typecheck --pretty" })).toEqual(["typecheck", "--pretty"]);
    expect(runScript({ text: "--run=lint -- --only x" })).toEqual(["lint", "--only", "x"]);
    expect(runScript({ text: "--run typecheck -- --help" })).toEqual(["typecheck", "--help"]);
  });

  it("names nothing without --run, or past --", () => {
    expect(runScript({ text: "scripts/report.js" })).toBe(undefined);
    expect(runScript({ text: "-- --run typecheck" })).toBe(undefined);
    expect(runScript({ text: "--run" })).toBe(undefined);
  });
});

describe("scriptHostStarts", () => {
  it("skips a host's own subcommand, once, with options on either side of it", () => {
    expect(scriptHostStarts({ args: ["watch", "src/cli/index.ts", "dev", "lint"], host: "tsx" })).toEqual([1]);
    expect(scriptHostStarts({ args: ["--clear-screen=false", "watch", "--", "x.ts"], host: "tsx" })).toEqual([3]);
    expect(scriptHostStarts({ args: ["inspect", "node_modules/.bin/tsc"], host: "node" })).toEqual([1]);
  });

  it("reads another host's subcommand as the script it names", () => {
    expect(scriptHostStarts({ args: ["watch", "x.js"], host: "node" })).toEqual([0]);
    expect(scriptHostStarts({ args: ["watch", "watch", "x.ts"], host: "tsx" })).toEqual([1]);
  });

  it("answers the first non-option word once when every reading agrees", () => {
    expect(scriptHostStarts({ args: ["--inspect", "--", "src/cli/index.ts"], host: "node" })).toEqual([2]);
    expect(scriptHostStarts({ args: ["--import=tsx", "src/cli/index.ts", "dev"], host: "node" })).toEqual([1]);
  });

  it("reads an unknown spaced option both ways", () => {
    expect(
      scriptHostStarts({ args: ["-r", "./preload.js", "node_modules/.bin/tsc", "-p", "."], host: "node" }),
    ).toEqual([1, 2]);
    expect(
      scriptHostStarts({ args: ["--tsconfig", "t.json", "--no-cache", "src/cli/index.ts", "dev"], host: "tsx" }),
    ).toEqual([1, 3, 4]);
  });

  it("names no script for evaluated code or a bare host", () => {
    expect(
      scriptHostStarts({ args: ["-e", "console.log(1)", "node_modules/typescript/lib/tsc.js"], host: "node" }),
    ).toEqual([]);
    expect(scriptHostStarts({ args: ["--print=1", "x.js"], host: "node" })).toEqual([]);
    expect(scriptHostStarts({ args: [], host: "node" })).toEqual([]);
  });
});

describe("optionNamesModule", () => {
  const pattern = /typescript\/lib\/tsc\.js$/u;
  it("finds a module named by an option, attached or spaced, before the evaluated program", () => {
    expect(optionNamesModule({ args: ["--require=./node_modules/typescript/lib/tsc.js", "-e", ""], pattern })).toBe(
      true,
    );
    expect(optionNamesModule({ args: ["-r./node_modules/typescript/lib/tsc.js"], pattern })).toBe(true);
    expect(optionNamesModule({ args: ["--import", "node_modules/typescript/lib/tsc.js", "x.js"], pattern })).toBe(true);
  });

  it("leaves the script's own argv and the evaluated program's data alone", () => {
    expect(optionNamesModule({ args: ["x.js", "--require=node_modules/typescript/lib/tsc.js"], pattern })).toBe(false);
    expect(optionNamesModule({ args: ["-e", "0", "node_modules/typescript/lib/tsc.js"], pattern })).toBe(false);
    expect(optionNamesModule({ args: ["-r", "a.js", "x.js", "node_modules/typescript/lib/tsc.js"], pattern })).toBe(
      false,
    );
  });
});
