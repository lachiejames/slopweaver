/**
 * The PURE core of the `alias` verbs: argv parsing, the two refusal shapes, and the lines one zone's
 * routing rules render as. No fs, no clock, no network — `./run.ts` owns every edge.
 *
 * ## Why the zone is a required flag rather than a configured default
 *
 * The Cloudflare atlas already resolves an account and ONE configured deep zone from the environment, and
 * this verb deliberately does not reuse that. It WRITES. The token reaches every zone the account holds, so
 * a default zone would mean a mistyped label provisions an address on whichever zone the environment
 * happened to name — on a domain the reader never looked at. `--domain` is therefore typed every time, and
 * `resolveZone` refuses one the account does not hold.
 *
 * ## Two error shapes, on purpose
 *
 * Every parse refusal here is either "this flag is required" or "this flag's value is not usable", plus the
 * one mutual-exclusion line `catch-all` needs. Keeping the shapes to that handful is what lets this
 * directory stay on the default `Result<T>` rather than minting a second error union beside
 * `../../../alias/errors.ts`, which already owns everything that can fail once a write starts.
 */

import { ALIAS_PROVIDERS, type AliasProvider, aliasAddress, isAliasProvider } from "../../../alias/address.js";
import type { AliasRule } from "../../../alias/rules.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { flagValueOr, parseFlagTail } from "../../optionParsers.js";

/** Every flag `alias provision` advertises and accepts. */
export const ALIAS_PROVISION_FLAG_NAMES: readonly string[] = [
  "--domain",
  "--identity",
  "--provider",
  "--label",
  "--destination",
  "--json",
  "--home",
];

/** Every flag `alias list` advertises and accepts. */
export const ALIAS_LIST_FLAG_NAMES: readonly string[] = ["--domain", "--json", "--home"];

/** Every flag `alias catch-all` advertises and accepts. */
export const ALIAS_CATCH_ALL_FLAG_NAMES: readonly string[] = [
  "--domain",
  "--destination",
  "--enable",
  "--disable",
  "--json",
  "--home",
];

/** "this flag is required" — one shape, so a reader always learns what the flag is FOR, not just that it is missing. */
function required({ flag, why }: { flag: string; why: string }): string {
  return `--${flag} is required: ${why}`;
}

/** "this flag's value is not usable" — the other shape, always carrying the value it read. */
function unusable({ flag, value, why }: { flag: string; value: string; why: string }): string {
  return `--${flag} ${value} is not usable: ${why}`;
}

/**
 * Whether a string can be a mailbox Cloudflare would forward to.
 *
 * Deliberately shallow: Cloudflare owns the real answer and says so by refusing to verify an address it
 * does not like. What this catches is the typo that would otherwise travel all the way to a write — a bare
 * local part, or a value that swallowed the next flag.
 */
function looksLikeMailbox({ value }: { value: string }): boolean {
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@") || at === value.length - 1) {
    return false;
  }
  return !/\s/.test(value) && !value.startsWith("-");
}

/**
 * What every `alias` verb resolves, whatever else it takes.
 *
 * @internal — named through the three per-verb option types below, never imported on its own.
 */
export interface AliasVerbOptions {
  readonly home: string;
  readonly json: boolean;
  /** The zone, exactly as typed — `resolveZone` decides whether the account holds it. */
  readonly zone: string;
}

/** The validated invocation of `alias provision`. */
export interface AliasProvisionOptions extends AliasVerbOptions {
  readonly identity: string;
  readonly provider: AliasProvider;
  readonly label: string;
  readonly destination: string;
  /** `<identity>-<provider>-<label>@<zone>`, built here so the shell never re-joins the parts. */
  readonly address: string;
}

/** The validated invocation of `alias list`. */
export type AliasListOptions = AliasVerbOptions;

/** The validated invocation of `alias catch-all` — one instruction, never both and never neither. */
export interface AliasCatchAllOptions extends AliasVerbOptions {
  /** The mailbox every unmatched address forwards to, or null when the catch-all is being switched off. */
  readonly destination: string | null;
}

/** The five required fields of `alias provision`, each present or accounted for in `errors`. */
interface ProvisionFields {
  readonly errors: readonly string[];
  readonly zone: string | undefined;
  readonly identity: string | undefined;
  readonly provider: AliasProvider | undefined;
  readonly label: string | undefined;
  readonly destination: string | undefined;
}

/** Validate the five required fields, collecting every problem rather than stopping at the first. */
function provisionFields({ values }: { values: Readonly<Record<string, string>> }): ProvisionFields {
  const errors: string[] = [];
  const zone = values["domain"];
  if (zone === undefined) {
    errors.push(
      required({ flag: "domain", why: "the zone the address lives on, and the only zone this run writes to" }),
    );
  }
  const identity = values["identity"];
  if (identity === undefined) {
    errors.push(required({ flag: "identity", why: "whose plan it is, `ada-owner` in ada-owner-claude-one@" }));
  }
  const providerValue = values["provider"];
  let provider: AliasProvider | undefined;
  if (providerValue === undefined) {
    errors.push(
      required({ flag: "provider", why: `which assistant the seat is for — ${ALIAS_PROVIDERS.join(" or ")}` }),
    );
  } else if (isAliasProvider(providerValue)) {
    provider = providerValue;
  } else {
    errors.push(unusable({ flag: "provider", value: providerValue, why: `it is not ${ALIAS_PROVIDERS.join(" or ")}` }));
  }
  const label = values["label"];
  if (label === undefined) {
    errors.push(required({ flag: "label", why: "the seat's own name, `one` in ada-owner-claude-one@" }));
  }
  const destination = values["destination"];
  if (destination === undefined) {
    errors.push(required({ flag: "destination", why: "the verified mailbox the alias forwards to" }));
  } else if (!looksLikeMailbox({ value: destination })) {
    errors.push(
      unusable({ flag: "destination", value: destination, why: "a mailbox is one local part, an @, and a domain" }),
    );
  }
  return { destination, errors, identity, label, provider, zone };
}

/**
 * Parse the tail of `alias provision`.
 *
 * @param rest the argv tail (after `slopweaver alias provision`)
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every reason this invocation cannot run
 */
export function parseAliasProvisionArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<AliasProvisionOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json"], value: ["home", "domain", "identity", "provider", "label", "destination"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const fields = provisionFields({ values });
  if (fields.errors.length > 0) {
    return err(fields.errors);
  }
  // Every branch in `provisionFields` pushed an error for a field it could not resolve, so an empty error
  // list is the proof that all five are here — asserted rather than re-tested, which would read as a
  // second, weaker check that a reader then has to decide between.
  const built = aliasAddress({
    identity: fields.identity!,
    label: fields.label!,
    provider: fields.provider!,
    zone: fields.zone!,
  });
  if (built.isErr()) {
    return err([built.error.message]);
  }
  return ok({
    address: built.value.address,
    destination: fields.destination!,
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    identity: fields.identity!,
    json: flags.has("json"),
    label: fields.label!,
    provider: fields.provider!,
    zone: fields.zone!,
  });
}

/**
 * Parse the tail of `alias list`.
 *
 * @param rest the argv tail (after `slopweaver alias list`)
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every reason this invocation cannot run
 */
export function parseAliasListArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<AliasListOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "domain"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const zone = values["domain"];
  if (zone === undefined) {
    return err([required({ flag: "domain", why: "the zone whose routing rules are being read" })]);
  }
  return ok({
    home: flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value }),
    json: flags.has("json"),
    zone,
  });
}

/**
 * Parse the tail of `alias catch-all`.
 *
 * `--enable` and `--disable` are opposite instructions rather than a boolean with a default, because the
 * widest write on this verb is the one nobody should be able to make by leaving a flag off.
 *
 * @param rest the argv tail (after `slopweaver alias catch-all`)
 * @param defaultHome the home to use when `--home` is absent
 * @returns the validated options, or every reason this invocation cannot run
 */
export function parseAliasCatchAllArgs({
  rest,
  defaultHome,
}: {
  rest: readonly string[];
  defaultHome: string;
}): Result<AliasCatchAllOptions> {
  const parsed = parseFlagTail({
    rest,
    spec: { boolean: ["json", "enable", "disable"], value: ["home", "domain", "destination"] },
  });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const errors: string[] = [];
  const zone = values["domain"];
  if (zone === undefined) {
    errors.push(required({ flag: "domain", why: "the zone whose catch-all is being set" }));
  }
  const enable = flags.has("enable");
  const disable = flags.has("disable");
  if (enable === disable) {
    errors.push("--enable and --disable are opposite instructions — give exactly one");
  }
  const destination = values["destination"];
  if (enable && destination === undefined) {
    errors.push(required({ flag: "destination", why: "the verified mailbox every unmatched address forwards to" }));
  }
  if (destination !== undefined && !looksLikeMailbox({ value: destination })) {
    errors.push(
      unusable({ flag: "destination", value: destination, why: "a mailbox is one local part, an @, and a domain" }),
    );
  }
  if (errors.length > 0) {
    return err(errors);
  }
  // An empty error list proves `--domain` arrived, and that `--enable` brought a mailbox with it.
  const home = flagValueOr({ fallback: defaultHome, name: "home", parsed: parsed.value });
  if (disable) {
    return ok({
      destination: null,
      home,
      json: flags.has("json"),
      zone: zone!,
    });
  }
  return ok({
    destination: destination!,
    home,
    json: flags.has("json"),
    zone: zone!,
  });
}

/**
 * One rule, as a line a person reads.
 *
 * A rule this verb did not write is printed exactly as it is rather than skipped: the whole point of
 * reading the zone before writing to it is to see what is already there.
 *
 * @param rule the rule read off the zone
 * @returns the line
 */
export function aliasRuleLine({ rule }: { rule: AliasRule }): string {
  const state = rule.enabled ? "on" : "off";
  const target = rule.destinations.length === 0 ? "(no forward action)" : rule.destinations.join(", ");
  const subject = rule.address.length === 0 ? "(not a single-address rule)" : rule.address;
  return `${state}  ${subject} -> ${target}`;
}

/**
 * Whether the zone's standing catch-all is already exactly what was asked for.
 *
 * A catch-all write REPLACES the rule, so this is what makes re-running the verb a no-op instead of a
 * silent re-point — the same protection `provision` gives one address, for the rule that covers every
 * address on the zone.
 *
 * @param rule the catch-all read off the zone
 * @param destination the mailbox asked for, or null when the caller asked to switch it off
 * @returns whether the write would change nothing
 */
export function catchAllUnchanged({ rule, destination }: { rule: AliasRule; destination: string | null }): boolean {
  if (destination === null) {
    return !rule.enabled && rule.destinations.length === 0;
  }
  const [only] = rule.destinations;
  return rule.enabled && rule.destinations.length === 1 && only === destination.toLowerCase();
}

/**
 * What a catch-all write is about to replace, said out loud before it happens.
 *
 * A zone with no catch-all configured reads back as a disabled rule forwarding nowhere, which is not
 * something a person needs warning about — so that case says so plainly rather than announcing a
 * replacement that replaces nothing.
 *
 * @param rule the catch-all read off the zone
 * @returns the line to print before the write
 */
export function catchAllReplacementLine({ rule }: { rule: AliasRule }): string {
  if (!rule.enabled && rule.destinations.length === 0) {
    return "the zone has no catch-all routing mail today; this write is the first";
  }
  return `replacing the standing catch-all — ${aliasRuleLine({ rule })}`;
}

/**
 * Every rule on a zone, as the lines `alias list` prints.
 *
 * @param rules the rules read off the zone
 * @param zone the zone they were read from
 * @returns the lines, the header first
 */
export function aliasListLines({ rules, zone }: { rules: readonly AliasRule[]; zone: string }): readonly string[] {
  if (rules.length === 0) {
    return [`${zone}: no email routing rules`];
  }
  return [`${zone}: ${String(rules.length)} email routing rule(s)`, ...rules.map((rule) => aliasRuleLine({ rule }))];
}
