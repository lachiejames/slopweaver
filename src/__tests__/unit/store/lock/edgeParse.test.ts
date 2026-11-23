/**
 * The lock edge's pure parsers: the Docker network's gateway, the parsed `pg_hba_file_rules`, the stray-session
 * query, and the server start-time expression.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  gatewayFromInspect,
  gatewaySessionsQuery,
  POSTMASTER_START_SQL,
  parseLoadedRules,
  parsePublishedPorts,
} from "../../../../store/lock/edgeParse.js";

describe("parsePublishedPorts", () => {
  it("keeps the host address of Docker Desktop's default binding, IPv6 unbracketed", () => {
    expect(parsePublishedPorts({ output: "0.0.0.0:55322\n[::]:55322\n" })).toEqual([
      { hostIp: "0.0.0.0", port: 55322 },
      { hostIp: "::", port: 55322 },
    ]);
  });

  it("reads the localhost-only binding exactly as measured", () => {
    expect(parsePublishedPorts({ output: "127.0.0.1:55322\n[::1]:55322\n" })).toEqual([
      { hostIp: "127.0.0.1", port: 55322 },
      { hostIp: "::1", port: 55322 },
    ]);
  });

  it("skips blank lines, non-address hosts and out-of-range ports, keeping the valid line", () => {
    expect(
      parsePublishedPorts({
        output: "\n  127.0.0.1:55322  \nlocalhost:55322\n0.0.0.0:99999\nError: no such container\n",
      }),
    ).toEqual([{ hostIp: "127.0.0.1", port: 55322 }]);
  });

  it("reads nothing out of empty output", () => {
    expect(parsePublishedPorts({ output: "" })).toEqual([]);
  });
});

describe("POSTMASTER_START_SQL", () => {
  it("names the catalog's function, so a search_path cannot swap in another, and reads epoch seconds", () => {
    expect(POSTMASTER_START_SQL).toBe("extract(epoch from pg_catalog.pg_postmaster_start_time())::text");
  });
});

const NETWORK = "supabase_network_acme";

describe("gatewayFromInspect", () => {
  it("reads the one IPv4 gateway", () => {
    expect(
      unwrap(
        gatewayFromInspect({
          network: NETWORK,
          value: { EnableIPv6: false, IPAM: { Config: [{ Gateway: "172.18.0.1", Subnet: "172.18.0.0/16" }] } },
        }),
      ),
    ).toBe("172.18.0.1");
  });

  it("refuses a network with IPv6 on, where a login could arrive from an address the rule does not name", () => {
    const error = unwrapErr(
      gatewayFromInspect({
        network: NETWORK,
        value: { EnableIPv6: true, IPAM: { Config: [{ Gateway: "172.18.0.1" }] } },
      }),
    );
    expect(error.code).toBe("GATEWAY_UNRESOLVED");
    expect(error.message).toContain("IPv6 enabled");
  });

  it("refuses zero or two IPv4 gateways", () => {
    expect(unwrapErr(gatewayFromInspect({ network: NETWORK, value: { IPAM: { Config: [] } } })).message).toContain(
      "found 0",
    );
    expect(
      unwrapErr(
        gatewayFromInspect({
          network: NETWORK,
          value: { IPAM: { Config: [{ Gateway: "172.18.0.1" }, { Gateway: "172.19.0.1" }] } },
        }),
      ).message,
    ).toContain("found 2");
  });

  it("refuses a document with no IPAM config", () => {
    expect(unwrapErr(gatewayFromInspect({ network: NETWORK, value: {} })).message).toContain("no IPAM config");
  });

  it("refuses a document that is not an object", () => {
    expect(unwrapErr(gatewayFromInspect({ network: NETWORK, value: "x" })).message).toContain("not an object");
  });
});

describe("parseLoadedRules", () => {
  it("reads rows, keeping only string user names", () => {
    expect(
      unwrap(
        parseLoadedRules({
          value: [
            {
              address: "172.18.0.1",
              authMethod: "reject",
              error: null,
              lineNumber: 7,
              netmask: "255.255.255.255",
              type: "host",
              userNames: ["all", 3],
            },
          ],
        }),
      ),
    ).toEqual([
      {
        address: "172.18.0.1",
        authMethod: "reject",
        error: null,
        lineNumber: 7,
        netmask: "255.255.255.255",
        type: "host",
        userNames: ["all"],
      },
    ]);
  });

  it("refuses a row with no line number", () => {
    expect(unwrapErr(parseLoadedRules({ value: [{ type: "host" }] })).message).toContain("carries no line number");
  });

  it("refuses a row that is not an object, and a value that is not an array", () => {
    expect(unwrapErr(parseLoadedRules({ value: [null] })).message).toContain("a row is not an object");
    expect(unwrapErr(parseLoadedRules({ value: {} })).message).toContain("not an array");
  });
});

describe("gatewaySessionsQuery", () => {
  it("ends only client sessions from the gateway that are not the login", () => {
    const query = gatewaySessionsQuery({ gateway: "172.18.0.1", includeLogin: false, terminate: true });
    expect(query).toContain("pg_terminate_backend(pid)");
    expect(query).toContain("client_addr = '172.18.0.1'::inet");
    expect(query).toContain("usename is distinct from 'slopweaver_login'");
  });

  it("picks the login's own sessions too once its password was replaced", () => {
    const query = gatewaySessionsQuery({ gateway: "172.18.0.1", includeLogin: true, terminate: true });
    expect(query).toContain("client_addr = '172.18.0.1'::inet");
    expect(query).not.toContain("usename");
  });

  it("only counts when not terminating", () => {
    expect(gatewaySessionsQuery({ gateway: "172.18.0.1", includeLogin: false, terminate: false })).not.toContain(
      "pg_terminate_backend",
    );
  });
});
