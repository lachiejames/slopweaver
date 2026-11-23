/**
 * The slice of a Linear bronze issue record a reconcile reads, and the reader that extracts it.
 *
 * Split from `./classify.ts` so the classification rules stay readable as rules: everything here is shape
 * handling over an untyped line, and nothing here decides anything.
 */

import { absentAs } from "#lib/absent.js";
import { optStr } from "../corpus/slack/shape.js";
import { isRecord } from "../lib/parsers.js";

/** One issue, reduced to the fields a reconcile judges. */
export interface CycleIssue {
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly team: string | undefined;
  readonly stateName: string;
  readonly stateType: string;
  readonly priority: string;
  readonly assigneeId: string | undefined;
  readonly cycleId: string | undefined;
  readonly updatedAt: string;
  readonly projectName: string | undefined;
  /**
   * The project's Linear id, which is what this issue joins its project on. Every row written since the SDK
   * migration carries it, because its `raw.project` is the hydrated `{ id, name }`.
   */
  readonly projectId: string | undefined;
  /** Every URL Linear itself has attached to the ticket — the pull requests among them are the trace. */
  readonly attachmentUrls: readonly string[];
  /** The record's own timestamp, used only to pick the newest row for an issue. */
  readonly recordTsIso: string;
}

/** Linear's own label for a ticket nobody has prioritised — carried rather than left blank. */
const NO_PRIORITY = "No priority";

/** The row's own `url`, else Linear's canonical issue URL for the rare row whose own `url` is absent. */
function issueUrlOf({ identifier, url }: { identifier: string; url: string | undefined }): string {
  if (url !== undefined) {
    return url;
  }
  return `https://linear.app/issue/${identifier}`;
}

/**
 * Read one Linear bronze line into a {@link CycleIssue}.
 *
 * @param line one raw JSONL line
 * @returns the issue, or `undefined` when the line is not a usable issue record
 */
export function cycleIssueOf({ line }: { line: string }): CycleIssue | undefined {
  const parsed: unknown = safeParse({ line });
  if (!isRecord(parsed) || parsed["kind"] !== "issue") {
    return undefined;
  }
  const raw: unknown = parsed["raw"];
  if (!isRecord(raw) || typeof parsed["sourceId"] !== "string" || typeof parsed["tsIso"] !== "string") {
    return undefined;
  }
  const state = isRecord(raw["state"]) ? raw["state"] : {};
  const stateName = optStr({ value: state["name"] });
  const stateType = optStr({ value: state["type"] });
  // A row with no workflow state is not an issue this can judge. Dropped rather than defaulted: a blank
  // state would read as "not completed" and put a row nothing knows anything about on the owner's card.
  if (stateName === undefined || stateType === undefined) {
    return undefined;
  }
  return {
    assigneeId: nested({ field: "id", value: raw["assignee"] }),
    attachmentUrls: attachmentUrlsOf({ value: raw["attachments"] }),
    cycleId: nested({ field: "id", value: raw["cycle"] }),
    identifier: parsed["sourceId"],
    priority: absentAs({ value: optStr({ value: raw["priorityLabel"] }), whenAbsent: NO_PRIORITY }),
    projectId: nested({ field: "id", value: raw["project"] }),
    projectName: nested({ field: "name", value: raw["project"] }),
    recordTsIso: parsed["tsIso"],
    stateName,
    stateType,
    team: nested({ field: "key", value: raw["team"] }),
    title: absentAs({ value: optStr({ value: raw["title"] }), whenAbsent: parsed["sourceId"] }),
    updatedAt: absentAs({ value: optStr({ value: raw["updatedAt"] }), whenAbsent: parsed["tsIso"] }),
    url: issueUrlOf({ identifier: parsed["sourceId"], url: optStr({ value: raw["url"] }) }),
  };
}

/** Every `url` inside an attachments connection's `nodes`. */
function attachmentUrlsOf({ value }: { value: unknown }): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value["nodes"])) {
    return [];
  }
  const urls: string[] = [];
  for (const node of value["nodes"]) {
    const url = isRecord(node) ? optStr({ value: node["url"] }) : undefined;
    if (url !== undefined) {
      urls.push(url);
    }
  }
  return urls;
}

/** One string field off a nested object, `undefined` when either the object or the field is absent. */
function nested({ value, field }: { value: unknown; field: string }): string | undefined {
  return isRecord(value) ? optStr({ value: value[field] }) : undefined;
}

/** `JSON.parse` that answers `undefined` rather than throwing. */
function safeParse({ line }: { line: string }): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * Keep only the newest row per issue identifier.
 *
 * Bronze is append-only across overlapping windows, so the same ticket appears many times and only the last
 * one is its current state.
 *
 * @param issues every issue row read, in any order
 * @returns one row per identifier, the newest by the record's own timestamp
 */
export function newestPerIssue({ issues }: { issues: readonly CycleIssue[] }): readonly CycleIssue[] {
  const byId = new Map<string, CycleIssue>();
  for (const issue of issues) {
    const held = byId.get(issue.identifier);
    if (held === undefined || held.recordTsIso < issue.recordTsIso) {
      byId.set(issue.identifier, issue);
    }
  }
  return [...byId.values()];
}
