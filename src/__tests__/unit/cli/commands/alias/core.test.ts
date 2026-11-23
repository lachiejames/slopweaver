import { describe, expect, it } from "vitest";
import {
  aliasListLines,
  aliasRuleLine,
  catchAllReplacementLine,
  catchAllUnchanged,
  parseAliasCatchAllArgs,
  parseAliasListArgs,
  parseAliasProvisionArgs,
} from "../../../../../cli/commands/alias/core.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const HOME = "/tmp/alias-core-test-home";

/** A complete `alias provision` tail, so a case testing one flag is not reporting a different missing one. */
const PROVISION: readonly string[] = [
  "--domain",
  "acme.com",
  "--identity",
  "ada-owner",
  "--provider",
  "claude",
  "--label",
  "five",
  "--destination",
  "ops@acme.com",
];

describe("parseAliasProvisionArgs", () => {
  it("builds the identity-first address from the five flags", () => {
    const parsed = parseAliasProvisionArgs({ defaultHome: HOME, rest: PROVISION });

    expect(parsed.isOk()).toBe(true);
    const options = unwrap(parsed);
    expect(options.address).toBe("ada-owner-claude-five@acme.com");
    expect(options.identity).toBe("ada-owner");
    expect(options.provider).toBe("claude");
    expect(options.label).toBe("five");
    expect(options.destination).toBe("ops@acme.com");
    expect(options.zone).toBe("acme.com");
    expect(options.home).toBe(HOME);
    expect(options.json).toBe(false);
  });

  it("takes --home over the default, and reads --json", () => {
    const parsed = parseAliasProvisionArgs({
      defaultHome: HOME,
      rest: [...PROVISION, "--home", "/tmp/elsewhere", "--json"],
    });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).home).toBe("/tmp/elsewhere");
    expect(unwrap(parsed).json).toBe(true);
  });

  it("names every absent flag at once rather than one per run", () => {
    const parsed = parseAliasProvisionArgs({ defaultHome: HOME, rest: [] });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual([
      "--domain is required: the zone the address lives on, and the only zone this run writes to",
      "--identity is required: whose plan it is, `ada-owner` in ada-owner-claude-one@",
      "--provider is required: which assistant the seat is for — claude or codex",
      "--label is required: the seat's own name, `one` in ada-owner-claude-one@",
      "--destination is required: the verified mailbox the alias forwards to",
    ]);
  });

  it("refuses a provider it does not know, naming the closed set", () => {
    const parsed = parseAliasProvisionArgs({
      defaultHome: HOME,
      rest: [
        "--domain",
        "acme.com",
        "--identity",
        "ada-owner",
        "--provider",
        "gemini",
        "--label",
        "five",
        "--destination",
        "ops@acme.com",
      ],
    });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["--provider gemini is not usable: it is not claude or codex"]);
  });

  it("refuses a destination that is not a mailbox", () => {
    const parsed = parseAliasProvisionArgs({
      defaultHome: HOME,
      rest: [
        "--domain",
        "acme.com",
        "--identity",
        "ada-owner",
        "--provider",
        "claude",
        "--label",
        "five",
        "--destination",
        "ops",
      ],
    });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual([
      "--destination ops is not usable: a mailbox is one local part, an @, and a domain",
    ]);
  });

  it("refuses a label carrying a provider, which would leave two places to split the address", () => {
    const parsed = parseAliasProvisionArgs({
      defaultHome: HOME,
      rest: [
        "--domain",
        "acme.com",
        "--identity",
        "ada-owner",
        "--provider",
        "claude",
        "--label",
        "claude-five",
        "--destination",
        "ops@acme.com",
      ],
    });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual([
      '"claude-five" cannot be part of an alias address: it carries the provider claude, which is what ' +
        "separates the identity from the label",
    ]);
  });

  it("refuses an identity carrying a provider for the same reason", () => {
    const parsed = parseAliasProvisionArgs({
      defaultHome: HOME,
      rest: [
        "--domain",
        "acme.com",
        "--identity",
        "claude-smith",
        "--provider",
        "claude",
        "--label",
        "five",
        "--destination",
        "ops@acme.com",
      ],
    });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("it carries the provider claude");
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    const parsed = parseAliasProvisionArgs({ defaultHome: HOME, rest: [...PROVISION, "--catch-all"] });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).join(" ")).toContain("--catch-all");
  });
});

describe("parseAliasListArgs", () => {
  it("takes the zone", () => {
    const parsed = parseAliasListArgs({ defaultHome: HOME, rest: ["--domain", "acme.com"] });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).zone).toBe("acme.com");
    expect(unwrap(parsed).home).toBe(HOME);
  });

  it("refuses a run with no zone", () => {
    const parsed = parseAliasListArgs({ defaultHome: HOME, rest: [] });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["--domain is required: the zone whose routing rules are being read"]);
  });
});

describe("parseAliasCatchAllArgs", () => {
  it("carries the mailbox when enabling", () => {
    const parsed = parseAliasCatchAllArgs({
      defaultHome: HOME,
      rest: ["--domain", "acme.com", "--enable", "--destination", "ops@acme.com"],
    });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).destination).toBe("ops@acme.com");
  });

  it("needs no mailbox when disabling, and says so by carrying none", () => {
    const parsed = parseAliasCatchAllArgs({ defaultHome: HOME, rest: ["--domain", "acme.com", "--disable"] });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).destination).toBeNull();
  });

  it("refuses a run naming neither instruction", () => {
    const parsed = parseAliasCatchAllArgs({ defaultHome: HOME, rest: ["--domain", "acme.com"] });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["--enable and --disable are opposite instructions — give exactly one"]);
  });

  it("refuses a run naming both instructions", () => {
    const parsed = parseAliasCatchAllArgs({
      defaultHome: HOME,
      rest: ["--domain", "acme.com", "--enable", "--disable", "--destination", "ops@acme.com"],
    });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual(["--enable and --disable are opposite instructions — give exactly one"]);
  });

  it("refuses --enable with no mailbox to enable it towards", () => {
    const parsed = parseAliasCatchAllArgs({ defaultHome: HOME, rest: ["--domain", "acme.com", "--enable"] });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed)).toEqual([
      "--destination is required: the verified mailbox every unmatched address forwards to",
    ]);
  });
});

describe("aliasRuleLine", () => {
  it("prints a forwarding rule as its state, address and destination", () => {
    const line = aliasRuleLine({
      rule: { address: "claude-five@acme.com", destinations: ["ops@acme.com"], enabled: true, ruleId: "r1" },
    });

    expect(line).toBe("on  claude-five@acme.com -> ops@acme.com");
  });

  it("names a rule that matches no single address rather than pretending it matches one", () => {
    const line = aliasRuleLine({ rule: { address: "", destinations: [], enabled: false, ruleId: "r2" } });

    expect(line).toBe("off  (not a single-address rule) -> (no forward action)");
  });
});

describe("catchAllUnchanged", () => {
  it("is unchanged when the standing rule already forwards to exactly that one mailbox", () => {
    const rule = { address: "", destinations: ["ops@acme.com"], enabled: true, ruleId: "c" };

    expect(catchAllUnchanged({ destination: "ops@acme.com", rule })).toBe(true);
  });

  it("compares the mailbox case-insensitively, since Cloudflare lower-cases what it stores", () => {
    const rule = { address: "", destinations: ["ops@acme.com"], enabled: true, ruleId: "c" };

    expect(catchAllUnchanged({ destination: "OPS@Acme.com", rule })).toBe(true);
  });

  it("is CHANGED when the standing rule forwards somewhere else", () => {
    const rule = { address: "", destinations: ["old@acme.com"], enabled: true, ruleId: "c" };

    expect(catchAllUnchanged({ destination: "ops@acme.com", rule })).toBe(false);
  });

  it("is CHANGED when the standing rule forwards to two mailboxes, not the one asked for", () => {
    const rule = { address: "", destinations: ["ops@acme.com", "other@acme.com"], enabled: true, ruleId: "c" };

    expect(catchAllUnchanged({ destination: "ops@acme.com", rule })).toBe(false);
  });

  it("is CHANGED when the standing rule names the mailbox but is switched off", () => {
    const rule = { address: "", destinations: ["ops@acme.com"], enabled: false, ruleId: "c" };

    expect(catchAllUnchanged({ destination: "ops@acme.com", rule })).toBe(false);
  });

  it("is unchanged when switching off a zone that already catches nothing", () => {
    const rule = { address: "", destinations: [], enabled: false, ruleId: "c" };

    expect(catchAllUnchanged({ destination: null, rule })).toBe(true);
  });

  it("is CHANGED when switching off a zone that is still forwarding", () => {
    const rule = { address: "", destinations: ["ops@acme.com"], enabled: true, ruleId: "c" };

    expect(catchAllUnchanged({ destination: null, rule })).toBe(false);
  });
});

describe("catchAllReplacementLine", () => {
  it("names what is being replaced", () => {
    const rule = { address: "", destinations: ["old@acme.com"], enabled: true, ruleId: "c" };

    expect(catchAllReplacementLine({ rule })).toBe(
      "replacing the standing catch-all — on  (not a single-address rule) -> old@acme.com",
    );
  });

  it("announces no replacement on a zone that has no catch-all yet", () => {
    const rule = { address: "", destinations: [], enabled: false, ruleId: "c" };

    expect(catchAllReplacementLine({ rule })).toBe(
      "the zone has no catch-all routing mail today; this write is the first",
    );
  });
});

describe("aliasListLines", () => {
  it("says a zone has no rules rather than printing an empty list", () => {
    expect(aliasListLines({ rules: [], zone: "acme.com" })).toEqual(["acme.com: no email routing rules"]);
  });

  it("heads the list with the zone and the count", () => {
    const lines = aliasListLines({
      rules: [{ address: "claude-five@acme.com", destinations: ["ops@acme.com"], enabled: true, ruleId: "r1" }],
      zone: "acme.com",
    });

    expect(lines).toEqual(["acme.com: 1 email routing rule(s)", "on  claude-five@acme.com -> ops@acme.com"]);
  });
});
