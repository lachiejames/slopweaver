/**
 * What one Make fill reads, named the way the descriptor counts it.
 *
 * The descriptor's denominator is the SDK's own tool census — every `MakeTools` entry annotated
 * `readOnlyHint` — so the numerator is named in that vocabulary too: each SDK call the fill makes maps to
 * the tool that represents it. `blueprints.get` is `scenarios_get`'s second half (that tool reads a scenario
 * and then its blueprint); the fill already has the scenario from `scenarios.list`, so it reads only the
 * blueprint, under the same logical name. `descriptor.test.ts` checks every name here is a read-only tool.
 */
import type { MakeReadRequest } from "../client.js";
import type { MakeAtlasKind } from "../model.js";

/** Every request kind the fill makes, in a fixed order — what cells and the descriptor iterate. */
export const MAKE_READ_OPS: readonly MakeReadRequest["op"][] = [
  "blueprints.get",
  "connections.list",
  "executions.list",
  "folders.list",
  "hooks.list",
  "organizations.list",
  "scenarios.list",
  "teams.list",
];

/** The logical read-only SDK tool each request is counted as. */
export const MAKE_FILL_OPERATIONS: Readonly<Record<MakeReadRequest["op"], string>> = {
  "blueprints.get": "scenarios_get",
  "connections.list": "connections_list",
  "executions.list": "executions_list",
  "folders.list": "folders_list",
  "hooks.list": "hooks_list",
  "organizations.list": "organizations_list",
  "scenarios.list": "scenarios_list",
  "teams.list": "teams_list",
};

/** The kind each request fills. A scenario's blueprint becomes part of the scenario, not a kind of its own. */
export const MAKE_FILL_KIND: Readonly<Record<MakeReadRequest["op"], MakeAtlasKind>> = {
  "blueprints.get": "scenario",
  "connections.list": "connection",
  "executions.list": "execution",
  "folders.list": "folder",
  "hooks.list": "hook",
  "organizations.list": "organization",
  "scenarios.list": "scenario",
  "teams.list": "team",
};

/**
 * How many execution-list rows are kept per scenario: the newest twenty. Enough to say whether a scenario
 * runs and how its runs end; the execution log itself is Make's, and keeping it all is not this atlas's job.
 */
export const MAKE_EXECUTION_LIMIT = 20;

/**
 * How many pages one paged list may follow before the fill refuses rather than publish a partial list. No
 * organisation has been measured; at a hundred items a page this is ten thousand of one thing in one team.
 */
export const MAKE_MAX_PAGES = 100;
