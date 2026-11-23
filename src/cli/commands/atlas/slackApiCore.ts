/**
 * Pure argument handling and rendering for `slopweaver atlas slack-api`. Split from the shell so every
 * line of output is unit-testable with no `node_modules` tree present, and so `helpTruth` can prove
 * `--help` names exactly what the parser accepts.
 */
import type { FieldHit, MethodView } from "../../../atlas/slackApi/build.js";
import { TIER_FLOOR_PER_MINUTE } from "../../../atlas/slackApi/methods.js";
import type { DocsFacts, SdkMethod, SlackApiAtlas } from "../../../atlas/slackApi/model.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type AtlasCommandError, AtlasCommandErrors } from "./errors.js";

/** Every flag this verb accepts; the help-truth ratchet checks the names derived from it below. */
const ATLAS_SLACK_API_FLAGS: FlagSpec = {
  boolean: ["json", "browser"],
  string: ["method", "field", "from-har"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const ATLAS_SLACK_API_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: ATLAS_SLACK_API_FLAGS }),
  ...stringFlagsOf({ spec: ATLAS_SLACK_API_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** The resolved invocation. */
export interface AtlasSlackApiOptions {
  readonly json: boolean;
  readonly browser: boolean;
  readonly method: string | undefined;
  readonly field: string | undefined;
  /** A browser capture to regenerate the committed table from. Writes source to stdout; changes nothing. */
  readonly fromHar: string | undefined;
}

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `atlas slack-api`
 * @returns the resolved options, or `err` with every usage problem found
 */
export function parseAtlasSlackApiArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<AtlasSlackApiOptions, AtlasCommandError> {
  const parsed = parseFlags({ args: rest, spec: ATLAS_SLACK_API_FLAGS });
  if (parsed.isErr()) {
    return err(AtlasCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { values } = parsed.value;
  const method = typeof values["method"] === "string" ? values["method"] : undefined;
  const field = typeof values["field"] === "string" ? values["field"] : undefined;
  const fromHar = typeof values["from-har"] === "string" ? values["from-har"] : undefined;
  if (method === "" || field === "") {
    return err(AtlasCommandErrors.slackApiTermEmpty());
  }
  if (fromHar === "") {
    return err(AtlasCommandErrors.slackApiHarPathEmpty());
  }
  return ok({ browser: values["browser"] === true, field, fromHar, json: values["json"] === true, method });
}

/**
 * The headline. Every count is stated every time, including the ones that agree, for the reason
 * `atlas slack` prints its completeness line unconditionally: a figure that appears only when something is
 * missing teaches a reader that its absence means "checked and fine".
 *
 * @param atlas the built atlas
 * @returns the summary lines
 */
export function renderSummary({ atlas }: { atlas: SlackApiAtlas }): readonly string[] {
  const c = atlas.counts;
  return [
    `slack api atlas: @slack/web-api ${atlas.sdkVersion}, built ${atlas.builtAtIso}`,
    `  methods (SDK typings)    : ${String(c.methods)}`,
    `  arguments               : ${String(c.params)}`,
    `  response fields         : ${String(c.responseFields)}  (top level plus one level of nesting)`,
    // The denominator is the whole point — see methods.ts.
    `  with a docs page read   : ${String(c.withDocs)} of ${String(c.methods)}  <- tier and scopes exist ONLY here`,
    `  browser-observed        : ${String(c.browserObserved)}`,
    `    …of those, undocumented: ${String(c.browserOnly)}  (--browser)`,
  ];
}

/**
 * The tier's published floor, as a parenthetical. A FLOOR, in Slack's own words ("50+ per minute"), so a
 * measured throughput above it is expected and one below it is the thing worth investigating.
 *
 * @param tier the published tier, when a docs page named one
 * @returns the parenthetical, or `""` when the tier has no stated per-minute floor
 */
function tierFloor({ tier }: { tier: string | undefined }): string {
  const floor = tier === undefined ? undefined : TIER_FLOOR_PER_MINUTE[tier];
  return floor === undefined ? "" : ` (${String(floor)}+/min)`;
}

/** What one SDK method takes, `*` marking a required argument — a method that declares none takes only the token. */
function argumentList({ sdk }: { sdk: SdkMethod }): string {
  const args = sdk.params.map((p) => `${p.name}${p.optional ? "" : "*"}`).join(", ");
  if (args === "") {
    return "(none but the token)";
  }
  return args;
}

/** What one SDK method answers with — the typings resolve no field for a method whose response they leave opaque. */
function returnFieldList({ sdk }: { sdk: SdkMethod }): string {
  const fields = sdk.responseFields.map((f) => f.name).join(", ");
  if (fields === "") {
    return "(unresolved)";
  }
  return fields;
}

/** The rate-limit tier the docs page names, or `?` for a page that names none. */
function docsTier({ docs }: { docs: DocsFacts }): string {
  const tier = docs.tier;
  if (tier === undefined) {
    return "?";
  }
  return tier;
}

/** The docs page's default and maximum page size, each `?` where the page names none. */
function docsLimits({ docs }: { docs: DocsFacts }): string {
  const limitDefault = docs.limitDefault;
  const limitMax = docs.limitMax;
  return `${limitDefault === undefined ? "?" : String(limitDefault)}/${limitMax === undefined ? "?" : String(limitMax)}`;
}

/**
 * One method in full: what it takes, what it answers with, and what the docs page said if one was read.
 *
 * @param view the merged row
 * @returns the lines
 */
export function renderMethod({ view }: { view: MethodView }): readonly string[] {
  const lines = [`${view.name}`];
  const { sdk, docs, browser } = view;
  if (sdk !== undefined) {
    lines.push(
      sdk.description === "" ? "  (the SDK declares no description)" : `  ${sdk.description}`,
      `  args    : ${argumentList({ sdk })}`,
      `  returns : ${returnFieldList({ sdk })}`,
    );
    for (const [parent, names] of Object.entries(sdk.responseNested).toSorted(([a], [b]) => a.localeCompare(b))) {
      lines.push(`    ${parent}[] : ${names.join(", ")}`);
    }
  } else {
    lines.push("  NOT in the installed SDK typings — no ordinary token reaches this name.");
  }
  lines.push(
    docs === undefined
      ? "  docs    : NOT READ. Tier and scopes are unknown, which is not the same as Tier 3."
      : `  docs    : tier ${docsTier({ docs })}${tierFloor({ tier: docs.tier })} · ${docs.audience} · bot [${docs.botScopes.join(" ")}] · user [${docs.userScopes.join(" ")}] · ${docs.pagination} · limit ${docsLimits({ docs })} · read ${docs.observedOn}`,
  );
  if (docs?.note !== undefined) {
    lines.push(`            ${docs.note}`);
  }
  if (browser !== undefined && browser.undocumentedParams.length > 0) {
    lines.push(`  browser : undocumented params observed — ${browser.undocumentedParams.join(", ")}`);
  }
  return lines;
}

/**
 * The `--field` answer: which methods return a field, and which of those only the web client has seen.
 *
 * @param hits the matches
 * @param field the term that was sought
 * @returns the lines
 */
export function renderFieldHits({ hits, field }: { hits: readonly FieldHit[]; field: string }): readonly string[] {
  if (hits.length === 0) {
    return [
      `no observed response field matches "${field}".`,
      "That is an absence in THIS map, not in Slack: only 11 docs pages were read, and the browser capture",
      "was one workspace load. Widen the map before concluding the field does not exist.",
    ];
  }
  return [
    `${String(hits.length)} method(s) return a field matching "${field}":`,
    ...hits.map(
      (hit) => `  ${hit.browserOnly ? "[browser-only] " : "               "}${hit.method}  ${hit.paths.join(", ")}`,
    ),
    "",
    "[browser-only] means the field was seen ONLY in the first-party web client's traffic. It is a lead to",
    "test with a real token, never a capability to plan around.",
  ];
}

/**
 * The `--browser` answer: the undocumented surface, undocumented parameters first.
 *
 * @param atlas the built atlas
 * @returns the lines
 */
export function renderBrowser({ atlas }: { atlas: SlackApiAtlas }): readonly string[] {
  const rows = [...atlas.browser].toSorted(
    (a, b) => b.undocumentedParams.length - a.undocumentedParams.length || a.name.localeCompare(b.name),
  );
  return [
    `${String(rows.length)} method(s) observed on the wire; ${String(atlas.counts.browserOnly)} are not in the SDK:`,
    ...rows.map(
      (row) =>
        `  ${row.publicSurface ? "PUBLIC  " : "internal"} ${row.name.padEnd(42)} ` +
        `${String(row.responsePathsTotal).padStart(5)} paths  ${row.undocumentedParams.join(", ")}`,
    ),
  ];
}

/**
 * Render whichever view the flags asked for.
 *
 * @param atlas the built atlas
 * @param options the resolved invocation
 * @param views the method views, when `--method` was given
 * @param hits the field hits, when `--field` was given
 * @returns the text to print
 */
export function renderAtlasSlackApi({
  atlas,
  options,
  views,
  hits,
}: {
  atlas: SlackApiAtlas;
  options: AtlasSlackApiOptions;
  views: readonly MethodView[];
  hits: readonly FieldHit[];
}): string {
  const lines = [...renderSummary({ atlas })];
  if (options.method !== undefined) {
    lines.push("", `${String(views.length)} method(s) matching "${options.method}":`, "");
    for (const view of views) {
      lines.push(...renderMethod({ view }), "");
    }
  }
  if (options.field !== undefined) {
    lines.push("", ...renderFieldHits({ field: options.field, hits }));
  }
  if (options.browser) {
    lines.push("", ...renderBrowser({ atlas }));
  }
  return lines.join("\n");
}
