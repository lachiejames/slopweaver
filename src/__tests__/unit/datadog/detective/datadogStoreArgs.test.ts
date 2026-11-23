import { describe, expect, it } from "vitest";

import {
  datadogScope,
  parseDatadogAroundArgs,
  parseDatadogGroupsArgs,
  parseDatadogHitsArgs,
  parseDatadogProbeArgs,
  routesToDatadog,
  rungOf,
} from "../../../../cli/commands/store/datadogCore.js";
import { StoreCommandErrors, storeCommandErrorLines } from "../../../../cli/commands/store/errors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("routesToDatadog — decided from RAW argv, before either backend's parser runs", () => {
  it("routes on --source datadog", () => {
    expect(routesToDatadog({ rest: ["knock", "--source", "datadog"] })).toBe(true);
  });

  it("routes on the equals spelling", () => {
    expect(routesToDatadog({ rest: ["--source=datadog"] })).toBe(true);
  });

  it("routes on a dd: id with no --source at all, because an id is where a detective got to", () => {
    expect(routesToDatadog({ rest: ["--id", "dd:log:abc"] })).toBe(true);
  });

  it("does NOT route a store UUID", () => {
    expect(routesToDatadog({ rest: ["--id", "16ab6aec-e951-4682-8b9f-d4425b3816c8"] })).toBe(false);
  });

  it("does NOT route another source", () => {
    expect(routesToDatadog({ rest: ["--source", "slack"] })).toBe(false);
  });
});

describe("datadogScope — no --env means EVERY environment, by the owner's standing ruling", () => {
  it("defaults to no environment narrowing at all", () => {
    expect(datadogScope({ values: {} }).envs).toEqual([]);
  });

  it("defaults to a seven-day window", () => {
    expect(datadogScope({ values: {} }).from).toBe("7d");
  });

  it("reads a comma-separated narrowing", () => {
    expect(datadogScope({ values: { env: "prod, staging" } }).envs).toEqual(["prod", "staging"]);
  });
});

describe("rungOf — --shape is the store's flag and is refused by NAME", () => {
  it("defaults to the rung that cuts", () => {
    expect(unwrap(rungOf({ values: {} }))).toBe("all-fields");
  });

  it("refuses --shape and names --rung instead of silently mapping it", () => {
    expect(storeCommandErrorLines({ error: unwrapErr(rungOf({ values: { shape: "slash" } })) })[0]).toContain("--rung");
  });

  it("refuses a rung Datadog's ladder does not have", () => {
    expect(storeCommandErrorLines({ error: unwrapErr(rungOf({ values: { rung: "alnum" } })) })[0]).toContain(
      "Datadog's ladder has",
    );
  });
});

describe("the four Datadog parsers", () => {
  it("takes probe keywords as positionals", () => {
    expect(unwrap(parseDatadogProbeArgs({ rest: ["knock", "p2028", "--source", "datadog"] })).terms).toEqual([
      "knock",
      "p2028",
    ]);
  });

  it("refuses --regex on probe and names the verb that does support it", () => {
    expect(
      storeCommandErrorLines({
        error: unwrapErr(parseDatadogProbeArgs({ rest: ["k", "--source", "datadog", "--regex", "x"] })),
      })[0],
    ).toContain("store hits --source datadog --regex");
  });

  it("refuses a probe with no keyword", () => {
    const refused = unwrapErr(parseDatadogProbeArgs({ rest: ["--source", "datadog"] }));
    expect(refused).toEqual(StoreCommandErrors.datadogSubjectMissing());
    expect(storeCommandErrorLines({ error: refused })).toEqual([
      "name at least one keyword — a probe with no subject counts nothing",
    ]);
  });

  it("requires a facet on groups and names the useful ones", () => {
    expect(
      storeCommandErrorLines({
        error: unwrapErr(parseDatadogGroupsArgs({ rest: ["--source", "datadog", "--term", "k"] })),
      })[0],
    ).toContain("@err.code");
  });

  it("reads a groups invocation whole", () => {
    const args = unwrap(
      parseDatadogGroupsArgs({ rest: ["--source", "datadog", "--term", "k", "--facet", "service", "--limit", "5"] }),
    );
    expect(args.facet).toBe("service");
    expect(args.limit).toBe(5);
  });

  it("carries a hits --regex through, since it is applied locally", () => {
    const args = unwrap(
      parseDatadogHitsArgs({ rest: ["--source", "datadog", "--term", "k", "--regex", "^\\[job\\]"] }),
    );
    expect(args.regex).toBe("^\\[job\\]");
  });

  it("defaults around to the trace correlation", () => {
    expect(unwrap(parseDatadogAroundArgs({ rest: ["--id", "dd:log:abc"] })).mode).toBe("trace");
  });

  it("refuses an around mode the store has but Datadog does not", () => {
    expect(
      storeCommandErrorLines({
        error: unwrapErr(parseDatadogAroundArgs({ rest: ["--id", "dd:log:abc", "--mode", "thread"] })),
      })[0],
    ).toContain("trace, request, session, ip, service");
  });
});
