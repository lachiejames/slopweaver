/**
 * Pure argument handling and rendering for `slopweaver atlas slack-drive`. Split from the shell so every
 * line of output is unit-testable with no browser and no `node_modules` tree present, and so `helpTruth`
 * can prove `--help` names exactly what the parser accepts.
 */
import type { DisagreementSummary, SurfaceComparison } from "../../../atlas/slackApi/disagreement.js";
import { disagreements } from "../../../atlas/slackApi/disagreement.js";
import { SLACK_CLIENT_ORIGIN, type SlackSurfacePage } from "../../../atlas/slackApi/surfacePages.js";
import { BRIEF_NO_VERB, type ExtensionBrief } from "../../../browser/brief.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { FlagSpec } from "../../parseFlags.js";
import { booleanFlagsOf, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { type AtlasCommandError, AtlasCommandErrors } from "./errors.js";

/** Every flag this verb accepts. Exported so the help-truth ratchet checks against the real list.
 * @internal
 */
export const ATLAS_SLACK_DRIVE_FLAGS: FlagSpec = {
  boolean: ["json", "dry-run"],
  string: ["home", "session"],
};

/** Every flag NAME, derived from the spec rather than re-listed, so the two cannot drift. */
export const ATLAS_SLACK_DRIVE_FLAG_NAMES: readonly string[] = [
  ...booleanFlagsOf({ spec: ATLAS_SLACK_DRIVE_FLAGS }),
  ...stringFlagsOf({ spec: ATLAS_SLACK_DRIVE_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/** Which quarter of the verb was asked for. */
type AtlasSlackDriveVerb = "plan" | "sync" | "refresh" | "report";

/** The resolved invocation. */
export interface AtlasSlackDriveOptions {
  readonly verb: AtlasSlackDriveVerb;
  readonly json: boolean;
  readonly dryRun: boolean;
  readonly home: string | undefined;
  /** `sync` only: the walk document to publish from, or `-` for stdin. */
  readonly session: string | undefined;
}

/** The verb the caller named — `atlas slack-drive` with none is the read-only `report`, as its usage documents. */
function namedDriveVerb({ positionals }: { positionals: readonly string[] }): string {
  const named = positionals[0];
  if (named === undefined) {
    return "report";
  }
  return named;
}

/**
 * Parse the verb's arguments.
 *
 * @param rest the argv tail after `atlas slack-drive`
 * @returns the resolved options, or `err` with every usage problem found
 */
export function parseAtlasSlackDriveArgs({
  rest,
}: {
  rest: readonly string[];
}): Result<AtlasSlackDriveOptions, AtlasCommandError> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: ATLAS_SLACK_DRIVE_FLAGS });
  if (parsed.isErr()) {
    return err(AtlasCommandErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const { positionals, values } = parsed.value;
  const verb = namedDriveVerb({ positionals });
  if (verb !== "plan" && verb !== "sync" && verb !== "refresh" && verb !== "report") {
    return err(AtlasCommandErrors.slackDriveVerbUnknown({ verb }));
  }
  const home = typeof values["home"] === "string" && values["home"] !== "" ? values["home"] : undefined;
  const session = typeof values["session"] === "string" && values["session"] !== "" ? values["session"] : undefined;
  // One refusal for both misuses, because `--session` has exactly one owner: `sync` cannot publish the browser
  // surface without the walk document, and `refresh` is the unattended half that reads none.
  const sessionMisused = (verb === "sync" && session === undefined) || (verb === "refresh" && session !== undefined);
  if (sessionMisused) {
    return err(AtlasCommandErrors.slackDriveSessionMisused());
  }
  return ok({ dryRun: values["dry-run"] === true, home, json: values["json"] === true, session, verb });
}

/**
 * The headline. Every count is stated every time, including the ones that agree, for the reason
 * `atlas slack-api` prints its completeness line unconditionally: a figure that appears only when something
 * is missing teaches a reader that its absence means "checked and fine".
 *
 * @param summary what the comparison found
 * @returns the summary lines
 */
export function renderDriveSummary({ summary }: { summary: DisagreementSummary }): readonly string[] {
  return [
    `${String(summary.methods)} method(s) held across both surfaces`,
    `  ${String(summary.both)} seen by BOTH the installed SDK and the driven browser`,
    `  ${String(summary.apiOnly)} declared by the SDK that this session's web client never called`,
    `  ${String(summary.browserOnly)} called by the web client that the SDK does not declare — the undocumented surface`,
    `${String(summary.withUndocumentedParams)} method(s) sent a parameter the SDK does not declare`,
    `${String(summary.withUndocumentedResponseFields)} method(s) returned a response field the SDK does not declare`,
  ];
}

/** How many rows of each disagreement family are printed before the rest are summarised as a count. */
export const DISAGREEMENT_ROW_CAP = 20;

/**
 * One disagreement row, as a reader sees it.
 *
 * @param row the comparison
 * @returns the line
 */
function renderRow({ row }: { row: SurfaceComparison }): string {
  if (row.verdict === "browser-only") {
    return `  ${row.method} — browser only, called ${String(row.callCount)}x; the SDK declares no such method`;
  }
  const params = row.paramsBrowserOnly.length === 0 ? "" : ` params: ${row.paramsBrowserOnly.join(", ")}`;
  const paths = row.pathsBrowserOnly.length === 0 ? "" : ` fields: ${row.pathsBrowserOnly.slice(0, 6).join(", ")}`;
  return `  ${row.method} —${params}${paths}`;
}

/**
 * The whole report: the counts, then the rows that actually disagree.
 *
 * @param comparisons every comparison the run made
 * @param summary the counts
 * @returns the report, ready to print
 */
export function renderDriveReport({
  comparisons,
  summary,
}: {
  comparisons: readonly SurfaceComparison[];
  summary: DisagreementSummary;
}): string {
  const rows = disagreements({ comparisons });
  const shown = rows.slice(0, DISAGREEMENT_ROW_CAP);
  const lines = [
    ...renderDriveSummary({ summary }),
    "",
    `${String(rows.length)} method(s) where the two surfaces disagree:`,
    ...shown.map((row) => renderRow({ row })),
  ];
  if (rows.length > shown.length) {
    lines.push(`  … and ${String(rows.length - shown.length)} more — pass --json for the whole list`);
  }
  lines.push(
    "",
    "nothing above is resolved: which surface wins when they disagree is the owner's call, and this is the",
    "list of real instances that call was reserved until the owner could see (docs/atlas-intent/04-corroboration.md)",
  );
  return lines.join("\n");
}

/**
 * The brief a walk of the Slack surface map is given.
 *
 * Two origins rather than one, and that is the whole reason this is assembled rather than a constant: the
 * single-page client and the workspace's settings application are different origins serving different
 * applications, and the settings half is where the owner's ruling actually lands
 * (`docs/atlas-intent/06-holdings.md`). A run with no workspace origin resolved still briefs the client half rather
 * than refusing — a partial walk is a real result, and the unwalked rows stay declared gaps.
 *
 * @param workspaceOrigin the workspace's own origin, or `null` when nothing on disk carries it
 * @returns the brief
 */
export function slackWalkBrief({ workspaceOrigin }: { workspaceOrigin: string | null }): ExtensionBrief {
  const origins =
    workspaceOrigin === null
      ? `${SLACK_CLIENT_ORIGIN}/client/<your workspace>`
      : `${SLACK_CLIENT_ORIGIN}/client/<your workspace> and ${workspaceOrigin}`;
  return {
    finish: "slopweaver atlas slack-drive sync --session <the walk document you assembled>",
    lane: "atlas slack-drive",
    steps: [
      {
        tool: "slopweaver browser act",
        what:
          "--do navigate to every DECLARED page listed below in turn, letting each settle, and record the" +
          " address you actually landed on — a redirect is a finding, not a failure",
      },
      {
        tool: BRIEF_NO_VERB,
        what: "on each page, record every /api/<method> call — its name and its parameter names",
        wouldClose:
          "a CLI route to the responses the relay already captures (`CapturedResponse`," +
          " `src/browser/pageTransport.ts`), which no verb surfaces today",
      },
      {
        tool: "slopweaver browser shot",
        what:
          "photograph a page whose policy below is `required`; you MAY photograph a `permitted` one; never" +
          " photograph a `refused` one, and record the reason instead",
      },
    ],
    url: origins,
  };
}

/**
 * The declared surface map, as the brief prints it — the denominator the walk is judged against.
 *
 * Every row is printed, including the admin-only ones the walk is expected to bounce off, because the
 * owner's floor is existence: a page left out of this list is one the atlas can never report as missing.
 *
 * @param pages every page the surface map declares
 * @returns the lines to print
 */
export function renderDeclaredSurfaces({ pages }: { pages: readonly SlackSurfacePage[] }): readonly string[] {
  const lines = [`${String(pages.length)} declared page(s) — walk each, in this order:`];
  for (const page of pages) {
    const admin = page.needsAdmin ? "  [needs admin — a wall here is the expected result]" : "";
    const held = page.contentsHeldBy === null ? "" : `  [contents held by ${page.contentsHeldBy}]`;
    if (page.notNavigableBecause !== null) {
      lines.push(`  ${page.root}${page.path === "" ? "/" : page.path}  DO NOT NAVIGATE${admin}${held}`);
      lines.push(`      ${page.purpose}`);
      lines.push(`      declared and never attempted: ${page.notNavigableBecause}`);
      continue;
    }
    lines.push(`  ${page.root}${page.path === "" ? "/" : page.path}  shot:${page.screenshot}${admin}${held}`);
    lines.push(`      ${page.purpose}`);
  }
  return lines;
}
