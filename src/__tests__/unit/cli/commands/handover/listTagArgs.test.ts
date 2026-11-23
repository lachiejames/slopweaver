/**
 * `handover list --tag`'s argument half: every occurrence read into one filter before the board is scanned, and
 * no occurrence the shared repeat helpers would skip — a skipped term widens a filter silently.
 */
import { describe, expect, it } from "vitest";

import { listTagArgs } from "../../../../../cli/commands/handover/listTagArgs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const VALUELESS = "--tag requires a value — key=value, key, or '!key'";

describe("listTagArgs", () => {
  it("reads no filter and hands the tail back whole when --tag is absent", () => {
    const read = unwrap(listTagArgs({ rest: ["--all", "--json"] }));
    expect(read.filter.terms).toEqual([]);
    expect(read.rest).toEqual(["--all", "--json"]);
  });

  it("ANDs every occurrence, both spellings and comma members, and strips them from the tail", () => {
    const read = unwrap(
      listTagArgs({ rest: ["--tag", "platform=slack,impact", "--json", "--tag=!origin", "--tag", "kind=ask"] }),
    );
    expect(read.filter.terms.map((term) => term.text)).toEqual(["platform=slack", "impact", "!origin", "kind=ask"]);
    expect(read.rest).toEqual(["--json"]);
  });

  it("refuses a --tag with no value, at the end or before another flag, rather than dropping it", () => {
    expect(unwrapErr(listTagArgs({ rest: ["--tag"] }))).toEqual([VALUELESS]);
    expect(unwrapErr(listTagArgs({ rest: ["--tag", "--json"] }))).toEqual([VALUELESS]);
    expect(unwrapErr(listTagArgs({ rest: ["--tag", "impact=high", "--tag"] }))).toEqual([VALUELESS]);
  });

  it("refuses an empty --tag= and a malformed term through the filter's own parser", () => {
    expect(unwrapErr(listTagArgs({ rest: ["--tag="] }))).toEqual([
      "a --tag filter term is empty — write key=value, key, or !key",
    ]);
    expect(unwrapErr(listTagArgs({ rest: ["--tag", "platfrom=slack"] }))).toEqual([
      '"platfrom" is not a tag key — did you mean platform?',
    ]);
  });
});
