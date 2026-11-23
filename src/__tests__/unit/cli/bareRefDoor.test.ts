import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bareRefGateRefused, bareRefVerdictFor, printedBareRefRefusals } from "../../../cli/bareRefDoor.js";
import { BARE_REFS_HATCH, bareRefsEscapeSentence } from "../../../outbound/linkify/bareRefsHatch.js";
import { envReader, grantedEnv, grantSessionEnv } from "../../hatchGrantFixture.js";

const noEnv = (): string | undefined => undefined;

describe("bareRefVerdictFor", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "bare-ref-door-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses every issue when no grant is held", () => {
    const verdict = bareRefVerdictFor({ env: noEnv, home, issues: ["issue one", "issue two"] });
    expect(verdict.refusals.length).toBe(2);
  });

  it("clears every refusal under this session's live bare-refs grant", () => {
    const env = envReader({ env: grantedEnv({ hatchIds: ["bare-refs"], home }) });
    const verdict = bareRefVerdictFor({ env, home, issues: ["issue one"] });
    expect(verdict.refusals.length).toBe(0);
  });

  it("still refuses with the retired variable set and no grant, because a variable leaves no journal row", () => {
    const env = envReader({ env: { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_BARE_REFS: "1" } });
    const verdict = bareRefVerdictFor({ env, home, issues: ["issue one"] });
    expect(verdict.refusals.length).toBe(1);
  });

  it("refuses nothing with no issues", () => {
    const verdict = bareRefVerdictFor({ env: noEnv, home, issues: [] });
    expect(verdict.refusals.length).toBe(0);
  });

  it("reads the grant from the home it is given, never the one the environment names", () => {
    const otherHome = mkdtempSync(join(tmpdir(), "bare-ref-door-other-"));
    try {
      const env = envReader({ env: grantedEnv({ hatchIds: ["bare-refs"], home }) });
      const underOtherHome = bareRefVerdictFor({ env, home: otherHome, issues: ["issue one"] });
      const underGrantHome = bareRefVerdictFor({ env, home, issues: ["issue one"] });
      expect(underOtherHome.refusals.length).toBe(1);
      expect(underGrantHome.refusals.length).toBe(0);
    } finally {
      rmSync(otherHome, { force: true, recursive: true });
    }
  });
});

describe("printedBareRefRefusals", () => {
  it("prints one line per refusal and reports a stop", () => {
    const lines: string[] = [];
    const stop = printedBareRefRefusals({ out: ({ line }) => lines.push(line), verdict: { refusals: ["a", "b"] } });
    expect(stop).toBe(true);
    expect(lines).toEqual(["refused: a", "refused: b"]);
  });

  it("prints nothing and reports no stop with an empty verdict", () => {
    const lines: string[] = [];
    const stop = printedBareRefRefusals({ out: ({ line }) => lines.push(line), verdict: { refusals: [] } });
    expect(stop).toBe(false);
    expect(lines).toEqual([]);
  });
});

describe("bareRefGateRefused", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "bare-ref-gate-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses live when issues survive and no grant is held, naming the journalled hatch", () => {
    const lines: string[] = [];
    const stop = bareRefGateRefused({
      dryRun: false,
      env: noEnv,
      home,
      issues: ["issue"],
      out: ({ line }) => lines.push(line),
    });
    expect(stop).toBe(true);
    expect(lines).toEqual([
      "refused: issue For one deliberate exception run slopweaver hatch open bare-refs " +
        '--reason "<why this one is a legitimate exception>", then re-run; the grant sends it unchanged.',
    ]);
  });

  it("does not refuse under this session's live bare-refs grant", () => {
    const env = envReader({ env: grantedEnv({ hatchIds: ["bare-refs"], home }) });
    const stop = bareRefGateRefused({ dryRun: false, env, home, issues: ["issue"], out: () => {} });
    expect(stop).toBe(false);
  });
});

describe("bareRefsEscapeSentence", () => {
  it("names the journalled grant verb for the bare-refs row, never a variable", () => {
    expect(BARE_REFS_HATCH).toBe("bare-refs");
    expect(bareRefsEscapeSentence()).toBe(
      "For one deliberate exception run slopweaver hatch open bare-refs " +
        '--reason "<why this one is a legitimate exception>", then re-run; the grant sends it unchanged.',
    );
  });
});
