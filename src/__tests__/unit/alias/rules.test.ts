import { describe, expect, it } from "vitest";

import { existingRuleFor, forwardRuleBody, readAliasRule } from "../../../alias/rules.js";

/** One rule payload as Cloudflare's own console writes it for a single forwarded address. */
const payload = ({
  address = "claude-one@acme.com",
  destination = "owner@gmail.com",
  enabled = true,
}: { address?: string; destination?: string; enabled?: boolean } = {}): Record<string, unknown> => ({
  actions: [{ type: "forward", value: [destination] }],
  enabled,
  matchers: [{ field: "to", type: "literal", value: address }],
  tag: "rule-1",
});

describe("readAliasRule", () => {
  it("reads the address, destinations and id off a single-address forward", () => {
    expect(readAliasRule({ payload: payload() })).toEqual({
      address: "claude-one@acme.com",
      destinations: ["owner@gmail.com"],
      enabled: true,
      ruleId: "rule-1",
    });
  });

  it("lower-cases what Cloudflare stored, so a hand-typed capital still matches", () => {
    const read = readAliasRule({
      payload: payload({ address: "Claude-One@Acme.com", destination: "Owner@Gmail.com" }),
    });
    expect([read.address, read.destinations]).toEqual(["claude-one@acme.com", ["owner@gmail.com"]]);
  });

  it("claims no address for a composite matcher somebody wrote by hand", () => {
    const composite = {
      ...payload(),
      matchers: [
        { field: "to", type: "literal", value: "claude-one@acme.com" },
        { field: "to", type: "literal", value: "codex-one@acme.com" },
      ],
    };
    expect(readAliasRule({ payload: composite }).address).toBe("");
  });

  it("reads an absent enabled flag as disabled, never as mail flowing", () => {
    const missing = { ...payload(), enabled: undefined };
    expect(readAliasRule({ payload: missing }).enabled).toBe(false);
  });

  it("answers an empty rule for a payload that is not an object at all", () => {
    expect(readAliasRule({ payload: "nonsense" })).toEqual({
      address: "",
      destinations: [],
      enabled: false,
      ruleId: "",
    });
  });
});

describe("existingRuleFor", () => {
  const rules = [
    readAliasRule({ payload: payload() }),
    readAliasRule({ payload: payload({ address: "codex-one@acme.com" }) }),
  ];

  it("finds the rule already routing an address, whatever its case", () => {
    expect(existingRuleFor({ address: "CLAUDE-ONE@acme.com", rules })!.destinations).toEqual(["owner@gmail.com"]);
  });

  it("finds nothing for an address nobody has routed", () => {
    expect(existingRuleFor({ address: "claude-two@acme.com", rules })).toBe(undefined);
  });
});

describe("forwardRuleBody", () => {
  it("writes the one shape Cloudflare's own console writes, enabled and named for this verb", () => {
    expect(forwardRuleBody({ address: "claude-one@acme.com", destination: "owner@gmail.com" })).toEqual({
      actions: [{ type: "forward", value: ["owner@gmail.com"] }],
      enabled: true,
      matchers: [{ field: "to", type: "literal", value: "claude-one@acme.com" }],
      name: "slopweaver alias claude-one@acme.com",
    });
  });
});
