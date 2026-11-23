/**
 * The helpers `handover list` and `handover check` genuinely share.
 *
 * `flagNamesOf` is the one with teeth: the help-truth ratchet compares each verb's usage string against
 * these names, so a spec half it dropped would quietly stop being checked. Both halves of a spec, and a
 * spec declaring only one of them, are the cases that matter.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  boolFlag,
  flagNamesOf,
  resolveHandoverDir,
  stringFlag,
  VERB_ARG_OFFSET,
} from "../../../../../cli/commands/handover/commandSupport.js";

describe("flagNamesOf", () => {
  it("prefixes and sorts both halves of a spec", () => {
    expect(flagNamesOf({ spec: { boolean: ["probe", "all"], string: ["dir", "base"] } })).toEqual([
      "--all",
      "--base",
      "--dir",
      "--probe",
    ]);
  });

  it("reads a spec that declares only one half", () => {
    expect(flagNamesOf({ spec: { string: ["doc"] } })).toEqual(["--doc"]);
    expect(flagNamesOf({ spec: { boolean: ["json"] } })).toEqual(["--json"]);
  });

  it("answers an empty spec with no names", () => {
    expect(flagNamesOf({ spec: {} })).toEqual([]);
  });
});

describe("stringFlag", () => {
  it("reads a declared string value", () => {
    expect(stringFlag({ name: "dir", parsed: { positionals: [], values: { dir: "/h" } } })).toBe("/h");
  });

  it("is undefined for an absent flag, and for one that parsed as a boolean", () => {
    expect(stringFlag({ name: "dir", parsed: { positionals: [], values: {} } })).toBe(undefined);
    expect(stringFlag({ name: "probe", parsed: { positionals: [], values: { probe: true } } })).toBe(undefined);
  });
});

describe("boolFlag", () => {
  it("is true only when the flag parsed as true", () => {
    expect(boolFlag({ name: "probe", parsed: { positionals: [], values: { probe: true } } })).toBe(true);
    expect(boolFlag({ name: "probe", parsed: { positionals: [], values: { probe: false } } })).toBe(false);
    expect(boolFlag({ name: "probe", parsed: { positionals: [], values: {} } })).toBe(false);
    expect(boolFlag({ name: "probe", parsed: { positionals: [], values: { probe: "yes" } } })).toBe(false);
  });
});

describe("resolveHandoverDir", () => {
  it("takes an explicit --dir over the state home", () => {
    expect(resolveHandoverDir({ dir: "/elsewhere/handovers", home: "/state" })).toBe("/elsewhere/handovers");
  });

  it("falls back to the given home's handovers directory", () => {
    expect(resolveHandoverDir({ dir: undefined, home: "/state" })).toBe(join("/state", "handovers"));
  });
});

describe("VERB_ARG_OFFSET", () => {
  it("skips node, the cli, the noun and the verb", () => {
    expect(["node", "slopweaver", "handover", "list", "--json"].slice(VERB_ARG_OFFSET)).toEqual(["--json"]);
  });
});
