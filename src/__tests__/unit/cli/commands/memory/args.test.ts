import { describe, expect, it } from "vitest";

import {
  DIR_HAS_NO_DEFAULT,
  optionalWholeDays,
  QUIET_PERIOD_MS,
  requiredAbsolutePath,
  requiredDir,
  VERB_ARG_OFFSET,
} from "../../../../../cli/commands/memory/args.js";
import type { ParsedFlags } from "../../../../../cli/parseFlags.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** Build a parsed flag set from explicit values, with no positionals. */
function flags({ values }: { values: Readonly<Record<string, string | boolean>> }): ParsedFlags {
  return { positionals: [], values };
}

describe("memory arg constants", () => {
  it("starts a verb's own arguments after node, cli, noun and verb", () => {
    expect(VERB_ARG_OFFSET).toBe(4);
  });

  it("holds a five second quiet period", () => {
    expect(QUIET_PERIOD_MS).toBe(5000);
  });

  it("states why --dir has no default", () => {
    expect(DIR_HAS_NO_DEFAULT).toBe("there is no default: auto-memory is keyed to the repository, not the cwd");
  });
});

describe("requiredAbsolutePath", () => {
  it("returns an absolute path read from the named key, not a sibling's", () => {
    const result = requiredAbsolutePath({
      key: "repo-alpha",
      parsed: flags({
        values: { "dir-bravo": "/dir-bravo-decoy", "repo-alpha": "/repo/alpha-tree", "stale-charlie": "7" },
      }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("/repo/alpha-tree");
  });

  it("refuses a missing flag with the default reason when no why is given", () => {
    const result = requiredAbsolutePath({
      key: "repo-alpha",
      parsed: flags({ values: { "dir-bravo": "/dir-bravo-decoy" } }),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "MISSING_FLAG",
      flag: "--repo-alpha",
      message: "--repo-alpha is required (there is no default)",
    });
  });

  it("refuses a missing flag with the caller's own reason when one is given", () => {
    const result = requiredAbsolutePath({
      key: "root-delta",
      parsed: flags({ values: { "dir-bravo": "/dir-bravo-decoy" } }),
      why: "measured against the wrong tree otherwise",
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "MISSING_FLAG",
      flag: "--root-delta",
      message: "--root-delta is required (measured against the wrong tree otherwise)",
    });
  });

  it("refuses a flag given as a boolean rather than a path", () => {
    const result = requiredAbsolutePath({
      key: "repo-alpha",
      parsed: flags({ values: { "dir-bravo": "/dir-bravo-decoy", "repo-alpha": true } }),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "MISSING_FLAG",
      flag: "--repo-alpha",
      message: "--repo-alpha is required (there is no default)",
    });
  });

  // A truthiness test would call an empty string missing; it was supplied, so it is refused as relative.
  it("refuses an empty value as a relative path rather than as a missing flag", () => {
    const result = requiredAbsolutePath({ key: "repo-alpha", parsed: flags({ values: { "repo-alpha": "" } }) });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "RELATIVE_PATH",
      flag: "--repo-alpha",
      message: "--repo-alpha must be an absolute path, got ``",
      value: "",
    });
  });

  it("refuses a relative path, reporting the value it was given", () => {
    const result = requiredAbsolutePath({
      key: "stale-charlie",
      parsed: flags({ values: { "dir-bravo": "/dir-bravo-decoy", "stale-charlie": "relative/tree" } }),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "RELATIVE_PATH",
      flag: "--stale-charlie",
      message: "--stale-charlie must be an absolute path, got `relative/tree`",
      value: "relative/tree",
    });
  });
});

describe("requiredDir", () => {
  it("returns the absolute directory held under --dir", () => {
    const result = requiredDir({
      parsed: flags({ values: { repo: "/repo-decoy", dir: "/memory/corpus-echo" } }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("/memory/corpus-echo");
  });

  it("refuses a missing --dir with the no-default explanation in its message", () => {
    const result = requiredDir({ parsed: flags({ values: { repo: "/repo-decoy" } }) });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "MISSING_FLAG",
      flag: "--dir",
      message: `--dir is required (${DIR_HAS_NO_DEFAULT})`,
    });
  });

  it("refuses a relative --dir", () => {
    const result = requiredDir({ parsed: flags({ values: { dir: "memory/corpus-foxtrot" } }) });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "RELATIVE_PATH",
      flag: "--dir",
      message: "--dir must be an absolute path, got `memory/corpus-foxtrot`",
      value: "memory/corpus-foxtrot",
    });
  });
});

describe("optionalWholeDays", () => {
  it("parses a positive whole number from the named key", () => {
    const result = optionalWholeDays({
      key: "stale-after",
      parsed: flags({ values: { "other-days": "3", "stale-after": "17" } }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(17);
  });

  it("accepts zero as a real threshold rather than treating it as absent", () => {
    const result = optionalWholeDays({
      key: "grace",
      parsed: flags({ values: { "other-days": "9", grace: "0" } }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe(0);
  });

  it("is exactly null when the flag is absent, whatever siblings hold", () => {
    const result = optionalWholeDays({
      key: "stale-after",
      parsed: flags({ values: { "other-days": "11" } }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBeNull();
  });

  it("refuses a negative number", () => {
    const result = optionalWholeDays({
      key: "stale-after",
      parsed: flags({ values: { "other-days": "4", "stale-after": "-2" } }),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "NOT_WHOLE_NUMBER",
      flag: "--stale-after",
      message: "--stale-after must be a whole number of days, got `-2`",
      value: "-2",
    });
  });

  it("refuses a fractional number", () => {
    const result = optionalWholeDays({
      key: "horizon",
      parsed: flags({ values: { "other-days": "4", horizon: "3.5" } }),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "NOT_WHOLE_NUMBER",
      flag: "--horizon",
      message: "--horizon must be a whole number of days, got `3.5`",
      value: "3.5",
    });
  });

  it("refuses a word", () => {
    const result = optionalWholeDays({
      key: "window",
      parsed: flags({ values: { "other-days": "4", window: "seventeen" } }),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "NOT_WHOLE_NUMBER",
      flag: "--window",
      message: "--window must be a whole number of days, got `seventeen`",
      value: "seventeen",
    });
  });

  it("refuses a bare boolean switch, reporting it as the text true", () => {
    const result = optionalWholeDays({
      key: "cutoff",
      parsed: flags({ values: { "other-days": "4", cutoff: true } }),
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual({
      code: "NOT_WHOLE_NUMBER",
      flag: "--cutoff",
      message: "--cutoff must be a whole number of days, got `true`",
      value: "true",
    });
  });
});
