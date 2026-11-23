import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadedAndAdmitted } from "../../../../../cli/commands/turn/dispatchAdmit.js";
import { resolvedHome } from "../../../../../cli/commands/turn/dispatchArgs.js";
import { runInitial } from "../../../../../cli/commands/turn/dispatchInitial.js";
import { runPoll } from "../../../../../cli/commands/turn/dispatchRead.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";

/**
 * The five modules `turn dispatch` was split into, as a declared family.
 *
 * Spelled out rather than read off the directory, so a sixth module added to the family reddens this list
 * instead of being silently exempted from every edge assertion below.
 */
const FAMILY = ["dispatchArgs.ts", "dispatchRead.ts", "dispatchAdmit.ts", "dispatchInitial.ts", "dispatch.ts"] as const;

/** One family module's source text. */
function sourceOf({ file }: { file: string }): string {
  return readFileSync(new URL(`../../../../../cli/commands/turn/${file}`, import.meta.url), "utf8");
}

/** Which of the five family modules `file` imports, by its own import specifiers. */
function familyImportsOf({ file }: { file: string }): readonly string[] {
  const text = sourceOf({ file });
  return FAMILY.filter((other) => other !== file).filter((other) =>
    text.includes(`from "./${other.replace(/\.ts$/, ".js")}"`),
  );
}

describe("turn dispatch is five layers with a one-way import graph", () => {
  it("declares all five modules, so no edge case below is vacuous", () => {
    expect(FAMILY.length).toBe(5);
  });

  it("the argument layer imports nothing the verb owns", () => {
    expect(familyImportsOf({ file: "dispatchArgs.ts" })).toEqual([]);
  });

  it("the reporting modes import nothing the verb owns either", () => {
    expect(familyImportsOf({ file: "dispatchRead.ts" })).toEqual([]);
  });

  it("the entrance gates stand on the argument layer alone", () => {
    expect(familyImportsOf({ file: "dispatchAdmit.ts" })).toEqual(["dispatchArgs.ts"]);
  });

  it("the acting modes stand on the argument layer and the entrance gates", () => {
    expect(familyImportsOf({ file: "dispatchInitial.ts" }).toSorted()).toEqual(["dispatchAdmit.ts", "dispatchArgs.ts"]);
  });

  it("the shell reaches the argument layer, the reporting modes and the acting modes", () => {
    expect(familyImportsOf({ file: "dispatch.ts" }).toSorted()).toEqual([
      "dispatchArgs.ts",
      "dispatchInitial.ts",
      "dispatchRead.ts",
    ]);
  });

  it("the reporting modes cannot reach a responder check or a dispatch record, both ways round", () => {
    const read = sourceOf({ file: "dispatchRead.ts" });
    const admit = sourceOf({ file: "dispatchAdmit.ts" });
    const initial = sourceOf({ file: "dispatchInitial.ts" });
    expect(read.includes("responderRefused")).toBe(false);
    expect(admit.includes("responderRefused")).toBe(true);
    expect(read.includes("loadedAndAdmitted")).toBe(false);
    expect(initial.includes("loadedAndAdmitted")).toBe(true);
  });
});

describe("the sweep instant stays per-call", () => {
  it("is called inside the nowIso arrow rather than hoisted into a const", () => {
    const read = sourceOf({ file: "dispatchRead.ts" });
    expect(read).toContain("nowIso: () => sweepInstant({ nowIso })");
    expect(read.includes("= sweepInstant({ nowIso })")).toBe(false);
  });
});

describe("resolvedHome says which home it picked", () => {
  it("returns the --home the caller named", () => {
    expect(resolvedHome({ values: { home: "/somewhere/explicit" } })).toBe("/somewhere/explicit");
  });

  it("falls back to the ambient home, which is a different answer from any named one", () => {
    const ambient = resolvedHome({ values: {} });
    expect(ambient).not.toBe("/somewhere/explicit");
    expect(ambient.startsWith("/")).toBe(true);
  });

  it("ignores a --home that parsed as a boolean rather than a path", () => {
    const ambient = resolvedHome({ values: {} });
    expect(resolvedHome({ values: { home: true } })).toBe(ambient);
  });
});

describe("each layer refuses an input it cannot act on, from its own module", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  /** A throwaway state home this file owns, removed after the case that minted it. */
  function freshHome(): string {
    const home = mkdtempSync(join(tmpdir(), "dispatch-layers-"));
    homes.push(home);
    return home;
  }

  it("the entrance gates refuse a brief path that is not there", () => {
    const outcome = loadedAndAdmitted({
      briefPath: join(freshHome(), "no-such-brief.json"),
      decisionPath: join(freshHome(), "no-such-decision.json"),
      home: freshHome(),
    });
    expect(outcome).toEqual({ code: EXIT_ERROR });
  });

  it("the acting modes refuse the same missing brief", async () => {
    const home = freshHome();
    const code = await runInitial({
      briefPath: join(home, "no-such-brief.json"),
      decisionPath: join(home, "no-such-decision.json"),
      home,
    });
    expect(code).toBe(EXIT_ERROR);
  });

  it("the reporting modes refuse a dispatch token this build did not mint", async () => {
    expect(await runPoll({ dispatchId: "not-a-token", home: freshHome() })).toBe(EXIT_ERROR);
  });
});
