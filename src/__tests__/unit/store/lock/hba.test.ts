/**
 * The lock's `pg_hba.conf` block: where it is placed, that a re-run replaces rather than stacks it, that a
 * hand-edited block is refused, and how a parsed rule set is judged.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  addressHolds,
  HBA_BLOCK_BEGIN,
  HBA_BLOCK_END,
  type LoadedHbaRule,
  loadedHbaProblems,
  lockedHbaText,
  managedHbaBlock,
} from "../../../../store/lock/hba.js";

/** The shape of the file the Supabase image ships. */
const SHIPPED = [
  "# TYPE  DATABASE        USER            ADDRESS                 METHOD",
  "local all  supabase_admin     scram-sha-256",
  "local all  all                peer map=supabase_map",
  "host  all  all  127.0.0.1/32  trust",
  "host  all  all  ::1/128  trust",
  "host  all  all  10.0.0.0/8  scram-sha-256",
  "host  all  all  172.16.0.0/12  scram-sha-256",
  "host  all  all  0.0.0.0/0  scram-sha-256",
  "",
].join("\n");

const GATEWAY = "172.18.0.1";

/**
 * A rule as `pg_hba_file_rules` reports it.
 *
 * @param over the fields that differ from a plain host rule
 * @returns the rule
 */
const rule = (over: Partial<LoadedHbaRule>): LoadedHbaRule => ({
  address: "172.16.0.0",
  authMethod: "scram-sha-256",
  error: null,
  lineNumber: 1,
  netmask: "255.240.0.0",
  type: "host",
  userNames: ["all"],
  ...over,
});

describe("lockedHbaText", () => {
  it("places the block directly above the first host rule that holds the gateway", () => {
    const lines = unwrap(lockedHbaText({ current: SHIPPED, gateway: GATEWAY })).split("\n");
    const begin = lines.indexOf(HBA_BLOCK_BEGIN);
    expect(lines.slice(begin, begin + 5)).toEqual([
      ...managedHbaBlock({ gateway: GATEWAY }),
      "host  all  all  172.16.0.0/12  scram-sha-256",
    ]);
    expect(lines[begin - 1]).toBe("host  all  all  10.0.0.0/8  scram-sha-256");
  });

  it("is idempotent — a second pass over its own output changes nothing", () => {
    const once = unwrap(lockedHbaText({ current: SHIPPED, gateway: GATEWAY }));
    expect(unwrap(lockedHbaText({ current: once, gateway: GATEWAY }))).toBe(once);
  });

  it("replaces a block written for an older gateway rather than stacking a second", () => {
    const old = unwrap(lockedHbaText({ current: SHIPPED, gateway: "172.18.0.1" }));
    const moved = unwrap(lockedHbaText({ current: old, gateway: "172.20.0.1" }));
    expect(moved.split("\n").filter((line) => line === HBA_BLOCK_BEGIN)).toHaveLength(1);
    expect(moved).toContain("host  all  slopweaver_login  172.20.0.1/32  scram-sha-256");
    expect(moved).not.toContain("172.18.0.1/32");
  });

  it("refuses a block missing its end marker — the file was edited by hand", () => {
    const error = unwrapErr(lockedHbaText({ current: `${HBA_BLOCK_BEGIN}\n${SHIPPED}`, gateway: GATEWAY }));
    expect(error.code).toBe("HBA_UNPLACEABLE");
    expect(error.message).toContain("found 1 begin and 0 end marker(s)");
  });

  it("refuses an end marker above its begin marker", () => {
    const error = unwrapErr(
      lockedHbaText({ current: `${HBA_BLOCK_END}\n${HBA_BLOCK_BEGIN}\n${SHIPPED}`, gateway: GATEWAY }),
    );
    expect(error.message).toContain("out of order");
  });

  it("refuses a file with no host rule holding the gateway, rather than guessing a position", () => {
    const error = unwrapErr(lockedHbaText({ current: "local all all peer\n", gateway: GATEWAY }));
    expect(error.message).toContain("no host rule admits 172.18.0.1");
  });

  it("refuses a gateway that is not IPv4", () => {
    const error = unwrapErr(lockedHbaText({ current: SHIPPED, gateway: "fd00::1" }));
    expect(error.message).toContain("is not an IPv4 address");
  });
});

describe("addressHolds", () => {
  it("matches a CIDR holding the gateway and refuses one that does not", () => {
    expect(addressHolds({ address: "172.16.0.0/12", gateway: GATEWAY })).toBe(true);
    expect(addressHolds({ address: "10.0.0.0/8", gateway: GATEWAY })).toBe(false);
  });

  it("reads a separate dotted netmask, as pg_hba_file_rules reports it", () => {
    expect(addressHolds({ address: "172.16.0.0", gateway: GATEWAY, netmask: "255.240.0.0" })).toBe(true);
    expect(addressHolds({ address: "172.16.0.0", gateway: GATEWAY, netmask: "255.255.0.0" })).toBe(false);
  });

  it("treats a bare address as one host, and the address keywords as a match", () => {
    expect(addressHolds({ address: GATEWAY, gateway: GATEWAY })).toBe(true);
    expect(addressHolds({ address: "172.18.0.2", gateway: GATEWAY })).toBe(false);
    expect(addressHolds({ address: "samenet", gateway: GATEWAY })).toBe(true);
  });

  it("refuses a non-contiguous netmask and an IPv6 address", () => {
    expect(addressHolds({ address: "172.16.0.0", gateway: GATEWAY, netmask: "255.0.255.0" })).toBe(false);
    expect(addressHolds({ address: "::1/128", gateway: GATEWAY })).toBe(false);
  });
});

describe("loadedHbaProblems", () => {
  const login = rule({ address: GATEWAY, lineNumber: 6, netmask: "255.255.255.255", userNames: ["slopweaver_login"] });
  const reject = rule({ address: GATEWAY, authMethod: "reject", lineNumber: 7, netmask: "255.255.255.255" });
  const wide = rule({ lineNumber: 9 });

  it("is clean when the login rule and then the refusal are the first two that match the gateway", () => {
    expect(loadedHbaProblems({ gateway: GATEWAY, rules: [login, reject, wide] })).toEqual([]);
  });

  it("names the rule that matches the gateway first when it is not the login's", () => {
    expect(loadedHbaProblems({ gateway: GATEWAY, rules: [wide, login, reject] })).toEqual([
      "the first loaded rule for 172.18.0.1 (line 9) admits all by scram-sha-256, not only slopweaver_login by scram-sha-256",
      "no loaded rule refuses every other role from 172.18.0.1 directly after the login's rule",
    ]);
  });

  it("says the block is not in force when no rule matches the gateway", () => {
    expect(
      loadedHbaProblems({ gateway: GATEWAY, rules: [rule({ address: "10.0.0.0", netmask: "255.0.0.0" })] }),
    ).toEqual(["no loaded rule matches a login from 172.18.0.1 — the lock's block is not in force"]);
  });

  it("reports a parse error before judging anything", () => {
    expect(
      loadedHbaProblems({ gateway: GATEWAY, rules: [login, rule({ error: "invalid auth method", lineNumber: 3 })] }),
    ).toEqual(["pg_hba.conf line 3 did not parse: invalid auth method"]);
  });
});
