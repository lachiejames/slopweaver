import { describe, expect, it } from "vitest";
import {
  booleanFlagsOf,
  parseFlags,
  repeatedFlagValues,
  stringFlagOr,
  stringFlagsOf,
  tokenizeFlags,
} from "../../../cli/parseFlags.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const spec = { boolean: ["json", "no-semantic"], string: ["home", "limit"] } as const;

describe("tokenizeFlags", () => {
  it("parses string values and boolean switches", () => {
    const t = tokenizeFlags({ args: ["--home", "/x", "--json"], spec });
    expect(t.values).toEqual({ home: "/x", json: true });
    expect(t.positionals).toEqual([]);
    expect(t.errors).toEqual([]);
  });

  it("keeps positionals as the free-text tail when allowed", () => {
    const t = tokenizeFlags({ allowPositionals: true, args: ["what", "is", "auth", "--limit", "5"], spec });
    expect(t.positionals).toEqual(["what", "is", "auth"]);
    expect(t.values).toEqual({ limit: "5" });
    expect(t.errors).toEqual([]);
  });

  it("accepts the --flag=value form", () => {
    expect(tokenizeFlags({ args: ["--home=/x"], spec }).values).toEqual({ home: "/x" });
  });

  it("reports an unknown flag AND a bad positional together (no short-circuit)", () => {
    const t = tokenizeFlags({ args: ["stray", "--bogus"], spec });
    expect(t.errors).toContain("unknown flag: --bogus");
    expect(t.errors).toContain("unexpected argument: stray");
  });

  it("reports a value flag given with no value", () => {
    expect(tokenizeFlags({ args: ["--home"], spec }).errors).toEqual(["--home requires a value"]);
  });

  it("refuses a repeated value flag rather than keeping the last, so an empty first value cannot vanish", () => {
    const t = tokenizeFlags({ args: ["--home", "", "--home", "/x"], spec });
    expect(t.errors).toEqual([
      "--home was given 2 times — pass it once; the parser would keep only the last and drop the rest",
    ]);
  });

  it("counts both spellings of a value flag as the same flag", () => {
    expect(tokenizeFlags({ args: ["--limit=1", "--limit", "2", "--limit=3"], spec }).errors).toEqual([
      "--limit was given 3 times — pass it once; the parser would keep only the last and drop the rest",
    ]);
  });

  it("names every repeated value flag, each once, in first-seen order", () => {
    const t = tokenizeFlags({ args: ["--limit", "1", "--home", "/a", "--limit", "2", "--home", "/b"], spec });
    expect(t.errors).toEqual([
      "--limit was given 2 times — pass it once; the parser would keep only the last and drop the rest",
      "--home was given 2 times — pass it once; the parser would keep only the last and drop the rest",
    ]);
  });

  it("lets a declared repeatable value flag repeat, the caller reading its list off the raw argv", () => {
    const t = tokenizeFlags({
      args: ["--term", "a", "--term", "b", "--home", "/x"],
      spec: { repeatable: ["term"], string: ["home", "term"] },
    });
    expect(t.errors).toEqual([]);
    expect(t.values).toEqual({ home: "/x", term: "b" });
  });

  it("still refuses a repeated value flag the spec did not declare repeatable beside one it did", () => {
    const t = tokenizeFlags({
      args: ["--term", "a", "--term", "b", "--home", "/x", "--home", "/y"],
      spec: { repeatable: ["term"], string: ["home", "term"] },
    });
    expect(t.errors).toEqual([
      "--home was given 2 times — pass it once; the parser would keep only the last and drop the rest",
    ]);
  });

  it("lets a boolean switch repeat, because asking twice loses nothing", () => {
    const t = tokenizeFlags({ args: ["--json", "--json"], spec });
    expect(t.errors).toEqual([]);
    expect(t.values).toEqual({ json: true });
  });

  it("does not count a flag-shaped token after the `--` terminator", () => {
    const t = tokenizeFlags({ allowPositionals: true, args: ["--home", "/x", "--", "--home", "/y"], spec });
    expect(t.errors).toEqual([]);
    expect(t.positionals).toEqual(["--home", "/y"]);
  });

  it("rejects a value flag that would swallow the next flag as its value", () => {
    const t = tokenizeFlags({ args: ["--home", "--json"], spec });
    expect(t.errors).toEqual(["--home requires a value"]);
    expect(t.values).toEqual({});
  });
});

describe("parseFlags", () => {
  it("is ok with typed values when clean", () => {
    const result = parseFlags({ args: ["--home", "/x", "--json"], spec });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).values).toEqual({ home: "/x", json: true });
  });

  it("errors on an unknown flag", () => {
    const result = parseFlags({ args: ["--nope"], spec });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result)).toEqual(["unknown flag: --nope"]);
  });

  it("errors on a stray positional when positionals are disallowed", () => {
    const result = parseFlags({ args: ["stray"], spec });
    expect(result.isOk()).toBe(false);
    expect(unwrapErr(result)).toEqual(["unexpected argument: stray"]);
  });
});

describe("a boolean switch given a value is refused, never coerced", () => {
  // This was a live destructive bug, not a tidiness rule. parseArgs runs non-strict, so `--dry-run=true`
  // arrives as the STRING "true"; every caller tests `values["dry-run"] === true`, which is false for a
  // string. So the most explicit possible request for a preview silently turned the preview OFF and performed
  // the real write. Measured on the github verb before the fix: both `--dry-run=true` and
  // `--dry-run --dry-run=true` resolved to dryRun=false.
  const switchSpec = { boolean: ["dry-run", "json"], string: ["home"] } as const;

  it("accepts the bare switch", () => {
    const parsed = parseFlags({ args: ["--dry-run"], spec: switchSpec });
    expect(parsed.isOk()).toBe(true);
    expect(parsed.isOk() ? parsed.value.values["dry-run"] : undefined).toBe(true);
  });

  const valued = ["--dry-run=true", "--dry-run=false", "--dry-run=1", "--json=true"];

  it.each(valued)("refuses %s rather than reading it as OFF", (arg) => {
    const [flag, value] = arg.split("=");
    const result = parseFlags({ args: [arg], spec: switchSpec });

    expect(unwrapErr(result)).toEqual([
      `${flag} is a switch, not a value: write it on its own as \`${flag}\`. ` +
        `\`${flag}=${value}\` would be read as OFF, which is the opposite of what it looks like`,
    ]);
  });

  it("refuses even when the bare switch came first, because the value overwrites it", () => {
    const result = parseFlags({ args: ["--dry-run", "--dry-run=true"], spec: switchSpec });

    expect(unwrapErr(result)).toEqual([
      "--dry-run is a switch, not a value: write it on its own as `--dry-run`. " +
        "`--dry-run=true` would be read as OFF, which is the opposite of what it looks like",
    ]);
  });

  it("names the flag and shows the correct spelling", () => {
    const parsed = parseFlags({ args: ["--dry-run=true"], spec: switchSpec });
    const message = parsed.isErr() ? parsed.error.join(" ") : "";
    expect(message).toContain("--dry-run is a switch, not a value");
    expect(message).toContain("read as OFF");
  });

  it("leaves a string flag's value alone", () => {
    const parsed = parseFlags({ args: ["--home=/tmp/x"], spec: switchSpec });
    expect(parsed.isOk() ? parsed.value.values["home"] : undefined).toBe("/tmp/x");
  });
});

describe("stringFlagsOf", () => {
  it("names an omitted half as an empty list", () => {
    expect(stringFlagsOf({ spec: {} })).toStrictEqual([]);
  });

  it("does not leak the boolean half", () => {
    expect(stringFlagsOf({ spec: { boolean: ["json"] } })).toStrictEqual([]);
  });

  it("returns the declared list itself, in declared order", () => {
    const names = ["home", "dir"];
    const read = stringFlagsOf({ spec: { string: names } });
    expect(read).toBe(names);
    expect(read).toStrictEqual(["home", "dir"]);
  });
});

describe("booleanFlagsOf", () => {
  it("names an omitted half as an empty list", () => {
    expect(booleanFlagsOf({ spec: {} })).toStrictEqual([]);
  });

  it("does not leak the string half", () => {
    expect(booleanFlagsOf({ spec: { string: ["home"] } })).toStrictEqual([]);
  });

  it("returns the declared list itself, in declared order", () => {
    const names = ["json", "fix"];
    const read = booleanFlagsOf({ spec: { boolean: names } });
    expect(read).toBe(names);
    expect(read).toStrictEqual(["json", "fix"]);
  });
});

describe("repeatedFlagValues", () => {
  it("collects every value a list flag was given, in order", () => {
    const rest = ["q", "--term", "a", "--json", "--term", "b", "--name", "x"];

    expect(repeatedFlagValues({ name: "term", rest })).toEqual(["a", "b"]);
  });

  it("skips a flag whose next token is another flag, and one given last with no value", () => {
    expect(repeatedFlagValues({ name: "term", rest: ["--term", "--json", "--term"] })).toEqual([]);
  });

  it("is empty when the flag is absent", () => {
    expect(repeatedFlagValues({ name: "term", rest: ["--name", "x"] })).toEqual([]);
  });

  // The parser accepts `--x=v`, so a list that missed it left a value unjudged.
  it("reads the inline spelling beside the spaced one, in order, and not a longer flag's", () => {
    const rest = ["--term=a", "--term", "b", "--terms=c", "--term="];

    expect(repeatedFlagValues({ name: "term", rest })).toEqual(["a", "b", ""]);
  });
});

describe("stringFlagOr", () => {
  it("answers the passed value over the default", () => {
    const parsed = unwrap(parseFlags({ args: ["--home", "/given"], spec }));
    expect(stringFlagOr({ fallback: "/default", name: "home", parsed })).toBe("/given");
  });

  it("answers the documented default when the flag was not passed", () => {
    const parsed = unwrap(parseFlags({ args: ["--json"], spec }));
    expect(stringFlagOr({ fallback: "/default", name: "home", parsed })).toBe("/default");
  });

  it("never reaches a string flag passed with no value: the parse refuses it first", () => {
    expect(unwrapErr(parseFlags({ args: ["--home"], spec }))).toEqual(["--home requires a value"]);
  });
});
