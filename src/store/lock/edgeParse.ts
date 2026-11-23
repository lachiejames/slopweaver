/**
 * The PURE half of the store lock's edge: what `docker network inspect`, `docker port` and `pg_hba_file_rules`
 * print, read into typed values, and the stray-session query the lock runs over the socket. No I/O — `./edge.ts`
 * does the reading and hands each document here.
 */
import { isIP } from "node:net";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import type { PublishedPort } from "../dockerPublication.js";
import { type StoreLockError, StoreLockErrors } from "./errors.js";
import { LOCK_LOGIN_ROLE, type LoadedHbaRule } from "./hba.js";

/**
 * The host address one `docker port` line matched. Exactly one of the two alternatives matches: the
 * bracketed IPv6 address, or the bare IPv4 one.
 *
 * @param groups the named groups of one matched line
 * @returns the address, IPv6 without its brackets
 */
function matchedHost({ groups }: { groups: Record<string, string | undefined> }): string {
  const bracketed = groups["v6"];
  if (bracketed !== undefined) {
    return bracketed;
  }
  return groups["v4"]!;
}

/**
 * What `docker port <container> 5432/tcp` printed, one publication per line: `0.0.0.0:55322`, `[::]:55322`,
 * `127.0.0.1:55322`, `[::1]:55322`. The host address is KEPT, because it is what says whether another machine
 * can reach the port. A line that is not an IP address and a port is skipped, as the port-only read always did.
 *
 * @param output docker's stdout
 * @returns every publication docker printed, IPv6 addresses without their brackets
 */
export function parsePublishedPorts({ output }: { output: string }): readonly PublishedPort[] {
  return output
    .split("\n")
    .map((line) => /^(?:\[(?<v6>[^\]]+)\]|(?<v4>[^:[\]]+)):(?<port>\d{1,5})$/u.exec(line.trim())?.groups)
    .filter((groups): groups is Record<string, string> => groups !== undefined)
    .map((groups) => ({ hostIp: matchedHost({ groups }), port: Number(groups["port"]) }))
    .filter(({ hostIp, port }) => isIP(hostIp) !== 0 && port >= 1 && port <= 65_535);
}

/**
 * The server's start instant as epoch seconds. Never the timestamp's text, which follows the session's `TimeZone` —
 * a per-role setting — so two sessions on one server could print the same instant differently.
 * The function is schema-qualified, so a role's `search_path` cannot resolve it to a same-named function it created.
 * Read both over the socket (`./edge.ts`) and through a login (`./macLogin.ts`), so the two can be compared.
 */
export const POSTMASTER_START_SQL = "extract(epoch from pg_catalog.pg_postmaster_start_time())::text";

/** The query that prints the parsed rules as one JSON array. */
export const HBA_RULES_QUERY = `select coalesce(json_agg(json_build_object(
  'lineNumber', line_number, 'type', type, 'userNames', user_name, 'address', address,
  'netmask', netmask, 'authMethod', auth_method, 'error', error) order by line_number), '[]'::json)
from pg_hba_file_rules;
`;

/**
 * The gateway out of `docker network inspect`'s JSON. Refuses a network with IPv6 enabled, because a login over
 * it would not arrive from the IPv4 gateway the rule names.
 *
 * @param network the network's name, for the refusal
 * @param value the parsed document
 * @returns the one IPv4 gateway, or why there is not exactly one
 */
export function gatewayFromInspect({
  network,
  value,
}: {
  network: string;
  value: unknown;
}): Result<string, StoreLockError> {
  const refuse = ({ detail }: { detail: string }): Result<string, StoreLockError> =>
    err(StoreLockErrors.gatewayUnresolved({ detail, network }));
  if (typeof value !== "object" || value === null) {
    return refuse({ detail: "docker printed something that is not an object" });
  }
  const record = value as { EnableIPv6?: unknown; IPAM?: { Config?: unknown } };
  if (record.EnableIPv6 === true) {
    return refuse({
      detail: "the network has IPv6 enabled, so a Mac login could arrive from an address the rule does not name",
    });
  }
  const config = record.IPAM?.Config;
  if (!Array.isArray(config)) {
    return refuse({ detail: "the network carries no IPAM config" });
  }
  const gateways = (config as unknown[])
    .map((entry) =>
      typeof entry === "object" && entry !== null ? (entry as { Gateway?: unknown }).Gateway : undefined,
    )
    .filter((gateway): gateway is string => typeof gateway === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(gateway));
  const [only] = gateways;
  if (gateways.length !== 1 || only === undefined) {
    return refuse({ detail: `expected one IPv4 gateway, found ${String(gateways.length)}` });
  }
  return ok(only);
}

/**
 * A field that is text, or `null` for anything else.
 *
 * @param field the row's value
 * @returns the string, or `null`
 */
function text({ field }: { field: unknown }): string | null {
  return typeof field === "string" ? field : null;
}

/**
 * Rules out of the JSON array {@link HBA_RULES_QUERY} prints.
 *
 * @param value the parsed array
 * @returns the rules, or why the array is not that shape
 */
export function parseLoadedRules({ value }: { value: unknown }): Result<readonly LoadedHbaRule[], StoreLockError> {
  if (!Array.isArray(value)) {
    return err(StoreLockErrors.stepFailed({ detail: "not an array", step: "reading pg_hba_file_rules" }));
  }
  const rules: LoadedHbaRule[] = [];
  for (const row of value as unknown[]) {
    if (!isRecord(row)) {
      return err(StoreLockErrors.stepFailed({ detail: "a row is not an object", step: "reading pg_hba_file_rules" }));
    }
    const names = row["userNames"];
    const lineNumber = row["lineNumber"];
    if (typeof lineNumber !== "number") {
      return err(
        StoreLockErrors.stepFailed({ detail: "a row carries no line number", step: "reading pg_hba_file_rules" }),
      );
    }
    rules.push({
      address: text({ field: row["address"] }),
      authMethod: text({ field: row["authMethod"] }),
      error: text({ field: row["error"] }),
      lineNumber,
      netmask: text({ field: row["netmask"] }),
      type: text({ field: row["type"] }),
      userNames: Array.isArray(names)
        ? (names as unknown[]).filter((name): name is string => typeof name === "string")
        : [],
    });
  }
  return ok(rules);
}

/**
 * The SQL that counts — and, with `terminate`, ends — every client session from the gateway that is not the
 * lock's login. A reload changes who may authenticate NEXT; it never ends a session already open, so a door
 * opened before the rule took effect stays open until this closes it. A password change never ends one either, so
 * a run that replaced the login's password picks the login's own sessions too.
 *
 * @param gateway the IPv4 address Mac logins arrive from
 * @param terminate whether to end them, or only count them
 * @param includeLogin whether the lock's login counts as well, after its password was replaced
 * @returns one query printing the count
 */
export function gatewaySessionsQuery({
  gateway,
  terminate,
  includeLogin,
}: {
  gateway: string;
  terminate: boolean;
  includeLogin: boolean;
}): string {
  const picked = terminate ? "pg_terminate_backend(pid)" : "pid";
  const role = includeLogin ? "" : `\n    and usename is distinct from '${LOCK_LOGIN_ROLE}'`;
  return `select count(*) from (select ${picked} from pg_stat_activity
  where client_addr = '${gateway}'::inet and backend_type = 'client backend'${role}
    and pid <> pg_backend_pid()) s`;
}
