import { describe, expect, it } from "vitest";

import {
  parseReflectBriefOptions,
  REFLECT_BRIEF_DEFAULT_FROM,
  REFLECT_BRIEF_FLAG_SPEC,
  REFLECT_BRIEF_WRITE_DRY_RUN_CONFLICT,
} from "../../../../../cli/commands/reflect/briefCore.js";
import { reflectBriefCommand } from "../../../../../cli/commands/reflect/briefRun.js";
import { REFLECT_BRIEF_USAGE } from "../../../../../cli/commands/reflect/usage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { SURFACE_CAP } from "../../../../../reflect/rank.js";

describe("parseReflectBriefOptions", () => {
  it("defaults to the loop's own daily cadence and the design's cap", () => {
    expect(unwrap(parseReflectBriefOptions({ rest: [] }))).toStrictEqual({
      cap: SURFACE_CAP,
      dryRun: false,
      from: REFLECT_BRIEF_DEFAULT_FROM,
      json: false,
      to: "now",
      write: false,
    });
  });

  it("takes every flag its usage line advertises", () => {
    const parsed = unwrap(
      parseReflectBriefOptions({ rest: ["--from", "7d", "--to", "now-1h", "--cap", "2", "--json", "--dry-run"] }),
    );
    expect(parsed).toStrictEqual({ cap: 2, dryRun: true, from: "7d", json: true, to: "now-1h", write: false });
  });

  it("takes --write, which is what the standing self-improvement row passes", () => {
    const parsed = unwrap(parseReflectBriefOptions({ rest: ["--write"] }));
    expect(parsed).toStrictEqual({
      cap: SURFACE_CAP,
      dryRun: false,
      from: REFLECT_BRIEF_DEFAULT_FROM,
      json: false,
      to: "now",
      write: true,
    });
  });

  it("refuses --write with --dry-run, naming both ends rather than silently picking one", () => {
    const parsed = parseReflectBriefOptions({ rest: ["--write", "--dry-run"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toStrictEqual([REFLECT_BRIEF_WRITE_DRY_RUN_CONFLICT]);
  });

  it("refuses a flag it does not know rather than ignoring it", () => {
    const parsed = parseReflectBriefOptions({ rest: ["--surface-everything"] });
    expect(unwrapErr(parsed)).toEqual(["unknown flag: --surface-everything"]);
  });

  it("refuses a cap that is not a positive integer", () => {
    expect(unwrapErr(parseReflectBriefOptions({ rest: ["--cap", "0"] }))).toEqual(["--cap must be a positive integer"]);
    expect(unwrapErr(parseReflectBriefOptions({ rest: ["--cap", "many"] }))).toEqual([
      "--cap must be a positive integer",
    ]);
  });

  it("advertises exactly the flags it parses", () => {
    const advertised = [...REFLECT_BRIEF_USAGE.matchAll(/--([a-z-]+)/g)].map((match) => match[1]!).toSorted();
    const parsed = [...REFLECT_BRIEF_FLAG_SPEC.boolean, ...REFLECT_BRIEF_FLAG_SPEC.value].toSorted();
    expect(advertised).toStrictEqual(parsed);
  });
});

describe("the reflect brief command module", () => {
  it("answers --help with its usage line and no side effect", async () => {
    expect(await reflectBriefCommand(["node", "slopweaver", "reflect", "brief", "--help"])).toBe(0);
  });

  it("refuses an unknown flag before reading anything", async () => {
    expect(await reflectBriefCommand(["node", "slopweaver", "reflect", "brief", "--nope"])).toBe(2);
  });
});
