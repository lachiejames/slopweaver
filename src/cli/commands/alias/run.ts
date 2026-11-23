/**
 * The effectful shell behind `slopweaver alias` — the one CLI path that provisions a plan's own mailbox.
 *
 * ## Why this verb exists at all
 *
 * The Claude and Codex plans have to live on ORGANISATION-owned identities, not
 * on a personal address, because that is what answers the worry about assistant data sitting on personal
 * accounts and devices. An identity is only organisation-owned if the mailbox behind it is, so the mailbox
 * is the primitive: `claude-<n>@<zone>` and `codex-<n>@<zone>` on a zone in the work Cloudflare account,
 * forwarding to a work mailbox that the gmail door can then read the sign-in code out of.
 *
 * ## The order is the contract
 *
 *   provision:  parse → token → resolve the zone → routing enabled → destination verified →
 *               read the existing rules → [already routed stops here] → door → create → report
 *   catch-all:  parse → token → resolve the zone → routing enabled → read the STANDING catch-all →
 *               [already what you asked for stops here] → destination verified (when forwarding) →
 *               say what is being replaced → door → set → report
 *
 * Every one of those checks is a REFUSAL rather than a warning, and they run before the door rather than
 * after it, so the only request that ever reaches the ledger is one that was going to work.
 *
 * **Both paths read before they write, and that symmetry is the point.** A catch-all update REPLACES the
 * zone's rule wholesale, so a `catch-all` that did not read the standing one first could silently re-point
 * every address on the zone while `provision` was busy refusing to clobber a single one. An adversarial
 * review of this diff found exactly that asymmetry; `getCatchAll` is what closed it.
 *
 * ## What stays out of this verb
 *
 * It provisions a mailbox and nothing else. Buying the plan, typing the card, answering a captcha and
 * verifying a phone number are the owner's own hand — `skills/alias/reference/claude-account-runbook.md`
 * names each of them, and the measured phone cap is why no amount of mailbox automation
 * scales past a handful of plans per person.
 */

import { DEFAULT_GATES } from "../../../admit/door.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { type AliasError, AliasErrors } from "../../../alias/errors.js";
import { type AliasRule, existingRuleFor } from "../../../alias/rules.js";
import { slopweaverHome } from "../../../homeDir.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { CatchAllTarget, ResolvedZone } from "../../../live/cloudflare/emailRouting.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { aliasDoorRequest, notPerformedExit } from "./aliasDoor.js";
import {
  type AliasCatchAllOptions,
  type AliasListOptions,
  type AliasProvisionOptions,
  aliasListLines,
  aliasRuleLine,
  catchAllReplacementLine,
  catchAllUnchanged,
  parseAliasCatchAllArgs,
  parseAliasListArgs,
  parseAliasProvisionArgs,
} from "./core.js";
import { type AliasDeps, type AliasRouting, productionAliasDeps } from "./deps.js";
import { ALIAS_CATCH_ALL_USAGE, ALIAS_LIST_USAGE, ALIAS_PROVISION_USAGE } from "./usage.js";

/** Print each line to stderr and hand back the code, so a refusal is one expression at every call site. */
function refuse({ deps, lines, code }: { deps: AliasDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.err({ line });
  }
  return code;
}

/** The token, or the one line that says how to install it. */
function resolveRouting({ deps, home }: { deps: AliasDeps; home: string }): Result<AliasRouting> {
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    return err(["no Cloudflare token configured — run: slopweaver secrets set cloudflare-token"]);
  }
  return ok(deps.makeRouting({ token }));
}

/** The zone, proven held by this account and proven to have email routing switched on. */
async function writableZone({
  routing,
  zone,
}: {
  routing: AliasRouting;
  zone: string;
}): Promise<Result<ResolvedZone, AliasError>> {
  const resolved = await routing.resolveZone({ zone });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const enabled = await routing.requireRoutingEnabled({ zone: resolved.value });
  if (enabled.isErr()) {
    return err(enabled.error);
  }
  return ok(resolved.value);
}

/** A refusal that has not been printed yet: the lines to say, and the code to exit with. */
interface Refusal {
  readonly code: number;
  readonly lines: readonly string[];
}

/** Everything the write needs, once every check that runs BEFORE the door has passed. */
interface ProvisionReady {
  readonly routing: AliasRouting;
  readonly zone: ResolvedZone;
}

/**
 * Every pre-door check for `alias provision`, in order, stopping at the first that refuses.
 *
 * Separate from the write so that "nothing was written" is a property of the CONTROL FLOW rather than of a
 * reader's care: there is one call to `createForwardRule` in this file, and it is downstream of this
 * returning `ok`.
 */
async function provisionPrechecks({
  options,
  deps,
}: {
  options: AliasProvisionOptions;
  deps: AliasDeps;
}): Promise<Result<ProvisionReady, Refusal>> {
  const routing = resolveRouting({ deps, home: options.home });
  if (routing.isErr()) {
    return err({ code: EXIT_ERROR, lines: routing.error });
  }
  const zone = await writableZone({ routing: routing.value, zone: options.zone });
  if (zone.isErr()) {
    return err({ code: EXIT_EXPECTED_EMPTY, lines: [zone.error.message] });
  }
  const verified = await routing.value.requireVerifiedDestination({
    destination: options.destination,
    zone: zone.value,
  });
  if (verified.isErr()) {
    return err({ code: EXIT_EXPECTED_EMPTY, lines: [verified.error.message] });
  }
  const rules = await routing.value.listRules({ zone: zone.value });
  if (rules.isErr()) {
    return err({ code: EXIT_ERROR, lines: [rules.error.message] });
  }
  const standing = existingRuleFor({ address: options.address, rules: rules.value });
  if (standing !== undefined) {
    // Reported, never duplicated: two literal `to` matchers on one address is a zone nobody can reason
    // about afterwards, and re-running this verb is exactly what a person does when a signup half-worked.
    return err({
      code: EXIT_EXPECTED_EMPTY,
      lines: [
        AliasErrors.ruleAlreadyExists({
          address: options.address,
          destination: standing.destinations.join(", "),
        }).message,
        aliasRuleLine({ rule: standing }),
      ],
    });
  }
  return ok({ routing: routing.value, zone: zone.value });
}

/**
 * Provision one alias address.
 *
 * @param options the validated invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runAliasProvision({
  options,
  deps,
}: {
  options: AliasProvisionOptions;
  deps: AliasDeps;
}): Promise<number> {
  const ready = await provisionPrechecks({ deps, options });
  if (ready.isErr()) {
    return refuse({ code: ready.error.code, deps, lines: ready.error.lines });
  }
  const { routing, zone } = ready.value;
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home: options.home,
    ledger: deps.doorLedger,
    perform: () => routing.createForwardRule({ address: options.address, destination: options.destination, zone }),
    request: aliasDoorRequest({ address: options.address, home: options.home, verb: "provision", zone: zone.name }),
  });
  if (!routed.performed) {
    return refuse({
      code: notPerformedExit({ through: routed }),
      deps,
      lines: [...notPerformedLines({ command: "slopweaver alias provision", through: routed })],
    });
  }
  if (routed.result.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [routed.result.error.message] });
  }
  if (options.json) {
    deps.out({
      line: JSON.stringify(
        { address: options.address, destination: options.destination, rule: routed.result.value, zone: zone.name },
        null,
        2,
      ),
    });
    return EXIT_OK;
  }
  deps.out({ line: `provisioned ${options.address} -> ${options.destination}` });
  deps.out({ line: aliasRuleLine({ rule: routed.result.value }) });
  return EXIT_OK;
}

/**
 * Read every routing rule on a zone.
 *
 * @param options the validated invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runAliasList({ options, deps }: { options: AliasListOptions; deps: AliasDeps }): Promise<number> {
  const routing = resolveRouting({ deps, home: options.home });
  if (routing.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: routing.error });
  }
  const zone = await routing.value.resolveZone({ zone: options.zone });
  if (zone.isErr()) {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [zone.error.message] });
  }
  const rules = await routing.value.listRules({ zone: zone.value });
  if (rules.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [rules.error.message] });
  }
  if (options.json) {
    deps.out({ line: JSON.stringify({ rules: rules.value, zone: zone.value.name }, null, 2) });
    return EXIT_OK;
  }
  for (const line of aliasListLines({ rules: rules.value, zone: zone.value.name })) {
    deps.out({ line });
  }
  return EXIT_OK;
}

/** Everything the catch-all write needs, once every pre-door check has passed. */
interface CatchAllReady {
  readonly routing: AliasRouting;
  readonly zone: ResolvedZone;
  /** The rule this write is about to replace — carried so the report can name it. */
  readonly standing: AliasRule;
}

/**
 * Every pre-door check for `alias catch-all`, in order, stopping at the first that refuses.
 *
 * Reading the STANDING rule is one of them rather than a nicety: a catch-all update replaces the zone's
 * rule wholesale, so a run that skipped this could silently re-point every address on the zone while
 * `provision` was busy refusing to clobber a single one.
 */
async function catchAllPrechecks({
  options,
  deps,
}: {
  options: AliasCatchAllOptions;
  deps: AliasDeps;
}): Promise<Result<CatchAllReady, Refusal>> {
  const routing = resolveRouting({ deps, home: options.home });
  if (routing.isErr()) {
    return err({ code: EXIT_ERROR, lines: routing.error });
  }
  const zone = await writableZone({ routing: routing.value, zone: options.zone });
  if (zone.isErr()) {
    return err({ code: EXIT_EXPECTED_EMPTY, lines: [zone.error.message] });
  }
  const standing = await routing.value.getCatchAll({ zone: zone.value });
  if (standing.isErr()) {
    return err({ code: EXIT_ERROR, lines: [standing.error.message] });
  }
  const destination = options.destination;
  if (catchAllUnchanged({ destination, rule: standing.value })) {
    return err({
      code: EXIT_EXPECTED_EMPTY,
      lines: [`${zone.value.name}'s catch-all is already what you asked for`, aliasRuleLine({ rule: standing.value })],
    });
  }
  if (destination !== null) {
    const verified = await routing.value.requireVerifiedDestination({ destination, zone: zone.value });
    if (verified.isErr()) {
      return err({ code: EXIT_EXPECTED_EMPTY, lines: [verified.error.message] });
    }
  }
  return ok({ routing: routing.value, standing: standing.value, zone: zone.value });
}

/**
 * Point a zone's catch-all at one mailbox, or switch it off.
 *
 * @param options the validated invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runAliasCatchAll({
  options,
  deps,
}: {
  options: AliasCatchAllOptions;
  deps: AliasDeps;
}): Promise<number> {
  const ready = await catchAllPrechecks({ deps, options });
  if (ready.isErr()) {
    return refuse({ code: ready.error.code, deps, lines: ready.error.lines });
  }
  const { routing, zone, standing } = ready.value;
  const destination = options.destination;
  deps.err({ line: catchAllReplacementLine({ rule: standing }) });
  const target: CatchAllTarget = destination === null ? { kind: "drop" } : { destination, kind: "forward" };
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home: options.home,
    ledger: deps.doorLedger,
    perform: () => routing.setCatchAll({ target, zone }),
    request: aliasDoorRequest({ address: `*@${zone.name}`, home: options.home, verb: "catch-all", zone: zone.name }),
  });
  if (!routed.performed) {
    return refuse({
      code: notPerformedExit({ through: routed }),
      deps,
      lines: [...notPerformedLines({ command: "slopweaver alias catch-all", through: routed })],
    });
  }
  if (routed.result.isErr()) {
    return refuse({ code: EXIT_ERROR, deps, lines: [routed.result.error.message] });
  }
  if (options.json) {
    deps.out({ line: JSON.stringify({ rule: routed.result.value, target, zone: zone.name }, null, 2) });
    return EXIT_OK;
  }
  deps.out({ line: aliasRuleLine({ rule: routed.result.value }) });
  return EXIT_OK;
}

/**
 * Run the `alias provision` verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runAliasProvisionArgv(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["provision"] });
  const deps = productionAliasDeps();
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out({ line: ALIAS_PROVISION_USAGE });
    return EXIT_OK;
  }
  const parsed = parseAliasProvisionArgs({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: [...parsed.error, ALIAS_PROVISION_USAGE] });
  }
  return runAliasProvision({ deps, options: parsed.value });
}

/**
 * Run the `alias list` verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runAliasListArgv(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["list"] });
  const deps = productionAliasDeps();
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out({ line: ALIAS_LIST_USAGE });
    return EXIT_OK;
  }
  const parsed = parseAliasListArgs({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: [...parsed.error, ALIAS_LIST_USAGE] });
  }
  return runAliasList({ deps, options: parsed.value });
}

/**
 * Run the `alias catch-all` verb.
 *
 * @param argv the full process argv (the verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runAliasCatchAllArgv(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["catch-all"] });
  const deps = productionAliasDeps();
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.out({ line: ALIAS_CATCH_ALL_USAGE });
    return EXIT_OK;
  }
  const parsed = parseAliasCatchAllArgs({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: [...parsed.error, ALIAS_CATCH_ALL_USAGE] });
  }
  return runAliasCatchAll({ deps, options: parsed.value });
}

export const aliasProvisionCommand = defineCommand({ run: runAliasProvisionArgv });
export const aliasListCommand = defineCommand({ run: runAliasListArgv });
export const aliasCatchAllCommand = defineCommand({ run: runAliasCatchAllArgv });
