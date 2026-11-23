/**
 * The PURE half of the store lock's login rule: where it goes in the container's `pg_hba.conf`, and how a loaded
 * rule set is judged.
 *
 * ## Why the rule is keyed on the Docker network's gateway
 *
 * Every login from the Mac reaches Postgres through Docker's port forward, and arrives from the gateway of the
 * stack's own network. Every Supabase service arrives from its own container's address on that network.
 * MEASURED, on the live stack and a throwaway one: a Mac login to `127.0.0.1:55322` read
 * `inet_client_addr()` = `172.18.0.1`, the gateway `docker network inspect supabase_network_slopweaver` names;
 * a login to `[::1]` arrived as the same IPv4 gateway; authenticator, realtime's `supabase_admin` and
 * `supabase_storage_admin` arrived from 172.18.0.5, .7 and .6. Repro:
 * `psql "$(cat ~/.slopweaver/secrets/store-url)" -tAc "select inet_client_addr()"`.
 *
 * So two lines placed before the first rule that would admit the gateway — admit {@link LOCK_LOGIN_ROLE} by
 * password, refuse every other role — close every password door from the Mac while leaving each service's own
 * login exactly as Supabase set it up. `postgres` and `supabase_admin` keep the CLI's default password, because
 * Storage logs in as `postgres` with it on every start (measured: a changed `postgres` password crash-looped
 * `supabase_storage_*` with `password authentication failed for user "postgres"`); the rule is what refuses
 * that password from the Mac.
 *
 * ## Why the block is marked
 *
 * The lock re-runs after every start, because the file lives in the container's own layer and a recreate
 * restores the image's copy. A marked block is replaced rather than appended, so a re-run never stacks a second
 * copy, and a block a person edited by hand is recognised and rewritten whole.
 */
import { BlockList, isIPv4 } from "node:net";

import { err, ok, type Result } from "#lib/result.js";

import { type StoreLockError, StoreLockErrors } from "./errors.js";

/** The one role the verbs log in as from the Mac. Every session it opens runs as `postgres` (`SET role` default). */
export const LOCK_LOGIN_ROLE = "slopweaver_login";

/** The first line of the managed block — a re-run finds and replaces everything between this and the end marker. */
export const HBA_BLOCK_BEGIN = "# slopweaver store lock: begin — rewritten by `slopweaver store lock`, never edit";

/** The last line of the managed block. */
export const HBA_BLOCK_END = "# slopweaver store lock: end";

/**
 * The managed block for one gateway.
 *
 * @param gateway the IPv4 address Mac logins arrive from
 * @returns the block's lines, markers included
 */
export function managedHbaBlock({ gateway }: { gateway: string }): readonly string[] {
  return [
    HBA_BLOCK_BEGIN,
    `host  all  ${LOCK_LOGIN_ROLE}  ${gateway}/32  scram-sha-256`,
    `host  all  all  ${gateway}/32  reject`,
    HBA_BLOCK_END,
  ];
}

/**
 * The file with the managed block in place: any earlier copy removed, the new one inserted directly above the
 * first connection rule whose address range holds the gateway.
 *
 * @param current the container's `pg_hba.conf` as read
 * @param gateway the IPv4 address Mac logins arrive from
 * @returns the whole file to write, or why the block cannot be placed — never a guess at a position
 */
export function lockedHbaText({
  current,
  gateway,
}: {
  current: string;
  gateway: string;
}): Result<string, StoreLockError> {
  if (!isIPv4(gateway)) {
    return err(StoreLockErrors.hbaUnplaceable({ detail: `the gateway ${gateway} is not an IPv4 address` }));
  }
  const stripped = withoutManagedBlock({ lines: current.split("\n") });
  if (stripped.isErr()) {
    return err(stripped.error);
  }
  const lines = stripped.value;
  const index = lines.findIndex((line) => hostRuleHolds({ gateway, line }));
  if (index === -1) {
    return err(
      StoreLockErrors.hbaUnplaceable({
        detail: `no host rule admits ${gateway}, so there is no rule for the lock to sit above — the file is not the one Supabase ships`,
      }),
    );
  }
  return ok([...lines.slice(0, index), ...managedHbaBlock({ gateway }), ...lines.slice(index)].join("\n"));
}

/**
 * The lines with the managed block removed. An unterminated or repeated block is refused: either means the file
 * was edited by something other than the lock, and rewriting it would guess which half to keep.
 *
 * @param lines the file's lines
 * @returns the lines without the block, or the refusal
 */
function withoutManagedBlock({ lines }: { lines: readonly string[] }): Result<readonly string[], StoreLockError> {
  const begins = lines.flatMap((line, index) => (line.trim() === HBA_BLOCK_BEGIN ? [index] : []));
  const ends = lines.flatMap((line, index) => (line.trim() === HBA_BLOCK_END ? [index] : []));
  if (begins.length === 0 && ends.length === 0) {
    return ok(lines);
  }
  const begin = begins[0];
  const end = ends[0];
  if (begins.length !== 1 || ends.length !== 1 || begin === undefined || end === undefined || end < begin) {
    return err(
      StoreLockErrors.hbaUnplaceable({
        detail: `found ${String(begins.length)} begin and ${String(ends.length)} end marker(s) out of order — the block was edited by hand`,
      }),
    );
  }
  return ok([...lines.slice(0, begin), ...lines.slice(end + 1)]);
}

/**
 * Whether one `pg_hba.conf` line is a TCP rule whose address range holds the gateway.
 *
 * @param line one line of the file
 * @param gateway the IPv4 address to test
 * @returns true for a `host`, `hostssl`, `hostnossl`, `hostgssenc` or `hostnogssenc` rule whose CIDR, `all`,
 *   `samenet` or `samehost` address could match it
 */
function hostRuleHolds({ line, gateway }: { line: string; gateway: string }): boolean {
  const fields = line.trim().split(/\s+/);
  const [type, , , address] = fields;
  if (type === undefined || !type.startsWith("host") || address === undefined) {
    return false;
  }
  return addressHolds({ address, gateway });
}

/**
 * Whether an address field from a rule — as written in the file, or as `pg_hba_file_rules` reports it with its
 * mask in a separate column — admits the gateway.
 *
 * @param address the address field: a CIDR, a bare address, or a keyword
 * @param netmask the separate netmask `pg_hba_file_rules` reports, when the address carries none
 * @param gateway the IPv4 address to test
 * @returns whether the rule could match a login from the gateway; a keyword such as `samenet` counts as a match
 */
export function addressHolds({
  address,
  netmask,
  gateway,
}: {
  address: string;
  netmask?: string;
  gateway: string;
}): boolean {
  if (address === "all" || address === "samenet" || address === "samehost") {
    return true;
  }
  const [network, bitsText] = address.split("/");
  if (network === undefined || !isIPv4(network)) {
    return false;
  }
  const prefix = prefixLength({ bitsText, netmask });
  if (prefix === null) {
    return false;
  }
  const list = new BlockList();
  list.addSubnet(network, prefix, "ipv4");
  return list.check(gateway, "ipv4");
}

/**
 * A prefix length from a `/bits` suffix or a dotted netmask; a bare address is a single host.
 *
 * @param bitsText the text after `/`, when present
 * @param netmask a dotted netmask, when the rule names one instead
 * @returns 0 to 32, or `null` when neither parses
 */
function prefixLength({
  bitsText,
  netmask,
}: {
  bitsText: string | undefined;
  netmask: string | undefined;
}): number | null {
  if (bitsText !== undefined) {
    const bits = Number(bitsText);
    return Number.isInteger(bits) && bits >= 0 && bits <= 32 ? bits : null;
  }
  if (netmask === undefined || netmask.length === 0) {
    return 32;
  }
  if (!isIPv4(netmask)) {
    return null;
  }
  const value = netmask
    .split(".")
    .map(Number)
    .reduce((acc, octet) => acc * 256 + octet, 0);
  const binary = value.toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(binary)) {
    return null;
  }
  const firstZero = binary.indexOf("0");
  if (firstZero === -1) {
    return 32;
  }
  return firstZero;
}

/** One row of `pg_hba_file_rules`, as the lock reads it. */
export interface LoadedHbaRule {
  readonly lineNumber: number;
  readonly type: string | null;
  readonly userNames: readonly string[];
  readonly address: string | null;
  readonly netmask: string | null;
  readonly authMethod: string | null;
  readonly error: string | null;
}

/**
 * What is wrong with the rule set as Postgres parses it, judged for logins from the gateway: the first rule that
 * could match one must admit only {@link LOCK_LOGIN_ROLE} by password, the next must refuse every role, and the
 * file must carry no parse error.
 *
 * Judged on how Postgres PARSES the file (`pg_hba_file_rules`) rather than on its text, so a line Postgres would
 * read differently from this module — a continuation, an include, a typo'd method — is caught. That view parses
 * the file at query time and does not show what the running server loaded; the login proofs in `./reconcile.ts`
 * are what prove the server enforces it.
 *
 * @param rules the loaded rules, in file order
 * @param gateway the IPv4 address Mac logins arrive from
 * @returns one sentence per problem — empty when the lock is in force
 */
export function loadedHbaProblems({
  rules,
  gateway,
}: {
  rules: readonly LoadedHbaRule[];
  gateway: string;
}): readonly string[] {
  const errors = rules.filter((rule) => rule.error !== null);
  if (errors.length > 0) {
    return errors.map((rule) => `pg_hba.conf line ${String(rule.lineNumber)} did not parse: ${rule.error!}`);
  }
  const matching = rules.filter(
    (rule) =>
      rule.type !== null &&
      rule.type.startsWith("host") &&
      rule.address !== null &&
      addressHolds({ address: rule.address, gateway, ...(rule.netmask === null ? {} : { netmask: rule.netmask }) }),
  );
  const [first, second] = matching;
  if (first === undefined) {
    return [`no loaded rule matches a login from ${gateway} — the lock's block is not in force`];
  }
  const problems: string[] = [];
  const firstAdmitsOnlyLogin =
    first.userNames.length === 1 && first.userNames[0] === LOCK_LOGIN_ROLE && first.authMethod === "scram-sha-256";
  if (!firstAdmitsOnlyLogin) {
    problems.push(
      `the first loaded rule for ${gateway} (line ${String(first.lineNumber)}) admits ${first.userNames.join(",")} by ${String(first.authMethod)}, not only ${LOCK_LOGIN_ROLE} by scram-sha-256`,
    );
  }
  const secondRefusesAll =
    second?.userNames.length === 1 && second.userNames[0] === "all" && second.authMethod === "reject";
  if (!secondRefusesAll) {
    problems.push(`no loaded rule refuses every other role from ${gateway} directly after the login's rule`);
  }
  return problems;
}
