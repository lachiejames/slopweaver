import { describe, expect, it } from "vitest";

import { parseLinearFormCreateArgs } from "../../../../../cli/commands/linear/formCreateArgs.js";
import type { FlagSpec } from "../../../../../cli/parseFlags.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SPEC: FlagSpec = {
  boolean: ["dry-run", "json"],
  string: ["form", "home", "mention-id"],
};

const UUID_A = "3F8A2C1E-9B4D-4E7A-8C5F-1D2E3F4A5B6C";
const UUID_B = "a1b2c3d4-0e1f-4a2b-9c3d-4e5f6a7b8c9d";
const UUID_C = "5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("parseLinearFormCreateArgs", () => {
  it("parses a full invocation with a dry run, a home and two verified mentions", () => {
    const result = parseLinearFormCreateArgs({
      argv: [
        "create",
        "--form",
        "form-alpha",
        "--home",
        "/home-bravo",
        "--dry-run",
        "--mention-id",
        `cj=${UUID_A},seth=${UUID_B}`,
      ],
      flags: SPEC,
      noun: "comment",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      dryRun: true,
      formSource: "form-alpha",
      home: "/home-bravo",
      json: false,
      mentionIds: new Map([
        ["cj", UUID_A.toLowerCase()],
        ["seth", UUID_B],
      ]),
    });
  });

  it("parses a json invocation with no home, no dry run and no mentions", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--form", "form-charlie", "--json"],
      flags: SPEC,
      noun: "relation",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      dryRun: false,
      formSource: "form-charlie",
      home: undefined,
      json: true,
      mentionIds: new Map(),
    });
  });

  it("accepts a stdin form marker as the form source", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--home", "/home-delta", "--form", "-"],
      flags: SPEC,
      noun: "project-update",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      dryRun: false,
      formSource: "-",
      home: "/home-delta",
      json: false,
      mentionIds: new Map(),
    });
  });

  // dryRun=[T,F,F,F,T] json=[F,T,F,T,T] home=[T,F,T,F,T] mentions=[T,F,F,T,F]: no two columns are equal or
  // complementary, so no flag can be read off another's value or presence, nor off its negation.
  it("parses a json invocation carrying one mention and no dry run or home", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--json", "--mention-id", `lee=${UUID_C}`, "--form", "form-echo"],
      flags: SPEC,
      noun: "initiative-update",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      dryRun: false,
      formSource: "form-echo",
      home: undefined,
      json: true,
      mentionIds: new Map([["lee", UUID_C]]),
    });
  });

  it("parses a dry-run json invocation with a home and no mentions", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--dry-run", "--home", "/home-foxtrot", "--json", "--form", "form-golf"],
      flags: SPEC,
      noun: "comment",
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      dryRun: true,
      formSource: "form-golf",
      home: "/home-foxtrot",
      json: true,
      mentionIds: new Map(),
    });
  });

  it("refuses a first token other than create, naming the noun it was asked for", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["delete", "--form", "form-echo"],
      flags: SPEC,
      noun: "relation-delta",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "USAGE",
      message: "usage: slopweaver linear relation-delta create --form <json|-> [...]",
      noun: "relation-delta",
    });
  });

  it("refuses an empty argv as a usage error", () => {
    const result = parseLinearFormCreateArgs({ argv: [], flags: SPEC, noun: "initiative-update" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "USAGE",
      message: "usage: slopweaver linear initiative-update create --form <json|-> [...]",
      noun: "initiative-update",
    });
  });

  it("refuses a flag the verb's spec does not declare", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--form", "form-foxtrot", "--bogus"],
      flags: { boolean: ["dry-run", "json"], string: ["form", "home"] },
      noun: "relation",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "FLAGS_REFUSED",
      message: "unknown flag: --bogus",
      reasons: ["unknown flag: --bogus"],
    });
  });

  it("refuses --mention-id for a verb that does not declare it", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--form", "form-golf", "--mention-id", `cj=${UUID_A}`],
      flags: { boolean: ["dry-run", "json"], string: ["form", "home"] },
      noun: "relation",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "FLAGS_REFUSED",
      message: `unknown flag: --mention-id; unexpected argument: cj=${UUID_A}`,
      reasons: ["unknown flag: --mention-id", `unexpected argument: cj=${UUID_A}`],
    });
  });

  it("reports a missing form and a malformed mention together, form first", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--mention-id", "nokey"],
      flags: SPEC,
      noun: "comment",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "ARGUMENTS_REFUSED",
      message:
        "--form <json|-> is required (use `-` to read the form from stdin); " +
        '--mention-id takes `key=<linear-user-id>` pairs, comma-separated; got "nokey"',
      reasons: [
        "--form <json|-> is required (use `-` to read the form from stdin)",
        '--mention-id takes `key=<linear-user-id>` pairs, comma-separated; got "nokey"',
      ],
    });
  });

  it("refuses a valid form carrying a malformed mention, reporting only the mention", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--form", "form-hotel", "--mention-id", "cj=not-a-uuid"],
      flags: SPEC,
      noun: "comment",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "ARGUMENTS_REFUSED",
      message:
        '--mention-id "cj" is not a Linear user id: "not-a-uuid". It must be the UUID Linear itself issues — ' +
        "`slopweaver linear states --team <key>` prints one per member.",
      reasons: [
        '--mention-id "cj" is not a Linear user id: "not-a-uuid". It must be the UUID Linear itself issues — ' +
          "`slopweaver linear states --team <key>` prints one per member.",
      ],
    });
  });

  // Dry-run, json and a home, against the form-first case's none: a missing form is refused under every flag.
  // The case above's opposite on dry-run, json and home, so a malformed mention is refused under every flag.
  it("refuses a malformed mention under dry-run, json and a home too", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--dry-run", "--json", "--home", "/home-juliet", "--form", "form-kilo", "--mention-id", "nokey"],
      flags: SPEC,
      noun: "comment",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "ARGUMENTS_REFUSED",
      message: '--mention-id takes `key=<linear-user-id>` pairs, comma-separated; got "nokey"',
      reasons: ['--mention-id takes `key=<linear-user-id>` pairs, comma-separated; got "nokey"'],
    });
  });

  it("refuses a missing form with no mention given, reporting only the form", () => {
    const result = parseLinearFormCreateArgs({
      argv: ["create", "--json", "--dry-run", "--home", "/home-india"],
      flags: SPEC,
      noun: "comment",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "ARGUMENTS_REFUSED",
      message: "--form <json|-> is required (use `-` to read the form from stdin)",
      reasons: ["--form <json|-> is required (use `-` to read the form from stdin)"],
    });
  });
});
