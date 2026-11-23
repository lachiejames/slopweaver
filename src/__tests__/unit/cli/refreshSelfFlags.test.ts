/**
 * The `--self` surface: how the roots are resolved, and the refusal when nothing is configured.
 *
 * The refusal matters more than it looks. Without it, an unconfigured `--self` walks nothing, writes nothing and
 * exits reporting an empty corpus — which is indistinguishable from a corpus that really is empty. The whole
 * point is to say what to set instead.
 */
import { describe, expect, it } from "vitest";

import {
  parseRefreshOptions,
  resolveSelfRoots,
  SELF_ROOTS_ENV,
  selectRefreshSources,
  selfRootDiagnostics,
} from "../../../cli/commands/refresh/core.js";
import { RefreshErrors } from "../../../cli/commands/refresh/errors.js";
import { FETCHABLE_SOURCES } from "../../../integrations/corpusSources.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("parseRefreshOptions — the self flags", () => {
  it("is off for a bare refresh, so nothing touches the filesystem", () => {
    const options = unwrap(parseRefreshOptions({ rest: [] }));

    expect(options.self).toBe(false);
    expect(options.selfRoots).toEqual([]);
  });

  it("turns on with --self", () => {
    expect(unwrap(parseRefreshOptions({ rest: ["--self"] })).self).toBe(true);
  });

  it("collects a repeated --self-root, in order", () => {
    const options = unwrap(parseRefreshOptions({ rest: ["--self", "--self-root", "/a", "--self-root", "/b"] }));

    expect(options.selfRoots).toEqual(["/a", "/b"]);
  });

  it("leaves every other flag working alongside it", () => {
    const options = unwrap(parseRefreshOptions({ rest: ["--self", "--self-root", "/a", "--source", "slack"] }));

    expect(options.self).toBe(true);
    expect(options.sources).toEqual(["slack"]);
    expect(options.selfRoots).toEqual(["/a"]);
  });
});

describe("resolveSelfRoots", () => {
  it("prefers the flags over the environment", () => {
    expect(resolveSelfRoots({ envValue: "/from/env", selfRoots: ["/from/flag"] })).toEqual(["/from/flag"]);
  });

  it("splits the environment variable on colons", () => {
    expect(resolveSelfRoots({ envValue: "/one:/two", selfRoots: [] })).toEqual(["/one", "/two"]);
  });

  it("drops blank entries, so a trailing separator is not a root", () => {
    expect(resolveSelfRoots({ envValue: "/one::/two:", selfRoots: [] })).toEqual(["/one", "/two"]);
  });

  it("trims whitespace around an entry", () => {
    expect(resolveSelfRoots({ envValue: " /one : /two ", selfRoots: [] })).toEqual(["/one", "/two"]);
  });

  it("deduplicates a repeated root, so a directory is not scanned twice", () => {
    expect(resolveSelfRoots({ envValue: undefined, selfRoots: ["/one", "/one", "/two"] })).toEqual(["/one", "/two"]);
  });

  it("resolves to nothing when neither is set", () => {
    expect(resolveSelfRoots({ envValue: undefined, selfRoots: [] })).toEqual([]);
  });
});

/**
 * `--self` drops the implicit GitHub default, because otherwise there is no way to spell "scan only my own
 * writing" — the free no-network lane would crawl GitHub on every invocation.
 */
describe("selectRefreshSources with --self", () => {
  it("selects no fetched source for a bare --self run", () => {
    expect(unwrap(selectRefreshSources({ allSources: false, self: true, sources: [] }))).toEqual([]);
  });

  it("still defaults to GitHub for a bare refresh", () => {
    expect(unwrap(selectRefreshSources({ allSources: false, self: false, sources: [] }))).toEqual(["github"]);
  });

  it("fetches what was asked for when a source is named alongside --self", () => {
    expect(unwrap(selectRefreshSources({ allSources: false, self: true, sources: ["github"] }))).toEqual(["github"]);
  });

  it("still fetches everything for --all-sources alongside --self", () => {
    expect(unwrap(selectRefreshSources({ allSources: true, self: true, sources: [] }))).toEqual([
      "github",
      "slack",
      "linear",
      "notion",
    ]);
  });

  it("refuses self as a --source value, whether or not --self was passed", () => {
    const expected = RefreshErrors.unknownSource({ expected: FETCHABLE_SOURCES, unknown: ["self"] });
    const withSelf = unwrapErr(selectRefreshSources({ allSources: false, self: true, sources: ["self"] }));
    const withoutSelf = unwrapErr(selectRefreshSources({ allSources: false, self: false, sources: ["self"] }));

    expect(withSelf).toEqual(expected);
    expect(withoutSelf).toEqual(expected);
    expect(withSelf.message).toBe(
      "unknown --source: self (expected github|slack|linear|notion|gmail|calendar|fathom|chatgpt|outlook-calendar)",
    );
  });
});

describe("selfRootDiagnostics", () => {
  it("refuses a --self run with nothing configured, and names both ways to configure it", () => {
    const errors = selfRootDiagnostics({ roots: [], self: true });

    expect(errors.length).toBe(2);
    expect(errors[1]!).toContain("--self-root");
    expect(errors[1]!).toContain(SELF_ROOTS_ENV);
  });

  it("says nothing when a root is configured", () => {
    expect(selfRootDiagnostics({ roots: ["/dev/state"], self: true })).toEqual([]);
  });

  it("says nothing when --self was not asked for, even with no roots", () => {
    expect(selfRootDiagnostics({ roots: [], self: false })).toEqual([]);
  });
});
