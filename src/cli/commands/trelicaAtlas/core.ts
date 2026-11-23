/**
 * What every Trelica atlas verb parses, and the usage each prints — kept in one module so the manifest row
 * and the verbs cannot drift apart.
 *
 * Nothing here does I/O, so a bad invocation is refused before anything reaches the tenant.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { parseFlagTail, resolveHome } from "../../optionParsers.js";

/**
 * Where a Trelica atlas verb sits: past the runtime, the script, the `atlas` noun and the `trelica`
 * platform.
 *
 * @internal
 */
export const TRELICA_VERB_INDEX = 4;

/**
 * Exported so a test can assert each equals the manifest's own copy.
 *
 * @internal
 */
export const TRELICA_SYNC_USAGE = "usage: slopweaver atlas trelica sync [--json] [--home <dir>]";

/** @internal */
export const TRELICA_WALK_USAGE = "usage: slopweaver atlas trelica walk [--limit <n>] [--json] [--home <dir>]";

/** @internal */
export const TRELICA_REFRESH_USAGE = "usage: slopweaver atlas trelica refresh [--json] [--home <dir>]";

/** @internal */
export const TRELICA_REPORT_USAGE = "usage: slopweaver atlas trelica report [--offboarding] [--json] [--home <dir>]";

/** @internal */
export const TRELICA_RESET_USAGE = "usage: slopweaver atlas trelica reset --confirm archive [--json] [--home <dir>]";

/**
 * What every verb here accepts.
 *
 * @internal
 */
export interface TrelicaVerbOptions {
  readonly home: string;
  readonly json: boolean;
}

/**
 * Parse the flag tail the plain verbs accept.
 *
 * @param rest the verb's own argv tail
 * @returns the options, or every reason the invocation is unusable
 */
export function parseTrelicaVerbOptions({ rest }: { rest: readonly string[] }): Result<TrelicaVerbOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}

/**
 * What `walk` accepts on top of the common tail.
 *
 * @internal
 */
export interface TrelicaWalkOptions extends TrelicaVerbOptions {
  /** Stop after this many declared pages. For PROVING the lane, never for a real generation. */
  readonly limit: number | undefined;
}

/**
 * Parse the flag tail `walk` accepts.
 *
 * `--limit` stops after n pages and the published coverage says so, because a partial walk that reported
 * itself complete is the failure the sibling Slack walk shipped once.
 *
 * @param rest the verb's own argv tail
 * @returns the options, or every reason the invocation is unusable
 */
export function parseTrelicaWalkOptions({ rest }: { rest: readonly string[] }): Result<TrelicaWalkOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["home", "limit"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const raw = parsed.value.values["limit"];
  if (raw === undefined) {
    return ok({
      home: resolveHome({ named: parsed.value.values["home"] }),
      json: parsed.value.flags.has("json"),
      limit: undefined,
    });
  }
  const limit = Number.parseInt(raw, 10);
  if (!Number.isInteger(limit) || limit < 1) {
    return err([`--limit takes a positive whole number of pages, not ${raw}`]);
  }
  return ok({
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
    limit,
  });
}

/**
 * What `report` accepts on top of the common tail.
 *
 * @internal
 */
export interface TrelicaReportOptions extends TrelicaVerbOptions {
  /** Print the offboarding evidence view instead of where the surfaces disagree. */
  readonly offboarding: boolean;
}

/**
 * Parse the flag tail `report` accepts.
 *
 * @param rest the verb's own argv tail
 * @returns the options, or every reason the invocation is unusable
 */
export function parseTrelicaReportOptions({ rest }: { rest: readonly string[] }): Result<TrelicaReportOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json", "offboarding"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
    offboarding: parsed.value.flags.has("offboarding"),
  });
}

/**
 * Parse the flag tail `reset` accepts, which needs the confirmation word spelled out.
 *
 * @param rest the verb's own argv tail
 * @returns the options, or why the invocation is unusable
 */
export function parseTrelicaResetOptions({ rest }: { rest: readonly string[] }): Result<TrelicaVerbOptions> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json"], value: ["confirm", "home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  if (parsed.value.values["confirm"] !== "archive") {
    return err(["reset needs --confirm archive, spelled out, so a generation is never replaced by a typo"]);
  }
  return ok({ home: resolveHome({ named: parsed.value.values["home"] }), json: parsed.value.flags.has("json") });
}
