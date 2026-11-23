/**
 * The Linear STRUCTURE lane: capture the organization, its teams, its team memberships, its workflow states
 * and its cycles into {@link StructureBronzeRow}s.
 *
 * Every one of those is a ROOT connection paged independently and joined locally by id, rather than a nested
 * selection under the team that owns it. That shape arrived in two steps and both are measurements rather
 * than taste: states and cycles moved out first, because `teams(50)` carrying `states(250)` and
 * `cycles(250)` cost 81,430 complexity points against a 10,000 per-query ceiling; members followed when this
 * lane moved onto `@linear/sdk`'s generated documents, whose `Team` fragment carries no connections at all.
 *
 * The GraphQL transport is the ONE shared {@link ../linear/transport} seam the activity and member lanes use
 * — this file built its own client and its own scheduler until the consolidation, which meant a third
 * independent pacer over one shared quota. The node parses are pure + separately tested, in `./structureRows.ts`;
 * a malformed node is skipped, never fatal.
 */

import { LinearDocument } from "@linear/sdk";

import { advanceOrWarn, collectCursorPages, openCursorPage, pushCursorWarning } from "../../lib/paging.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { StructureBronzeRow } from "../structures/types.js";
import { type LinearHydrationError, LinearHydrationErrors } from "./errors.js";
import { hydrateNode } from "./names.js";
import { ORGANIZATION_QUERY } from "./organization.js";
import { CUSTOM_VIEWS_QUERY, CUSTOM_VIEWS_REFS, ISSUE_LABELS_QUERY, ISSUE_LABELS_REFS } from "./queries.js";
import { type LinearReferences, NO_REFERENCES } from "./references.js";
import {
  pageInfoOf,
  projectLinearCycle,
  projectLinearOrg,
  projectLinearState,
  structuresFromTeamsPage,
  teamMembersFromMemberships,
} from "./structureRows.js";
import type { LinearRequest } from "./transport.js";
import { customViewRow, issueLabelRow } from "./vocabularyRows.js";

const PAGE_SIZE = 50;

/**
 * The teams lane, and the three ROOT lanes that carry what used to be nested inside it.
 *
 * Every one of them is now `@linear/sdk`'s own generated document. Three things that were hand-tuned here
 * are consequences of that rather than choices, and each replaced something this file used to have to get
 * right by itself:
 *
 * 1. **`members` is no longer nested under a team at all.** The SDK's `Team` fragment carries no
 *    connections, so the membership edge comes from the ROOT `teamMemberships` connection, whose every node
 *    carries `team { id }` and `user { id }`. That is the same local-join design the issue lane uses — and
 *    it deletes the whole inline-page-then-page-the-overflow machinery this file carried, along with the
 *    silent-truncation bug that machinery existed to fix. MEASURED live (probe in
 *    `~/.slopweaver/probes/linear-sdk-<date>/`): hundreds of memberships across dozens of teams, so
 *    no team can overflow a page that no longer exists.
 * 2. **The teams page got CHEAPER, by 5.7x.** Our own `teams(50)` with its nested `members(50)` cost 3,681
 *    complexity points; `TeamsDocument` at the same page size costs 650, because the expensive half was the
 *    nested connection rather than the fields.
 * 3. **`includeArchived` is a declared variable now, not a literal.** Workspace-wide it is what recovers
 *    cycles 238 -> 694 and workflow states 205 -> 273, so it is passed on every lane that declares it.
 *
 * `visibility` rather than the deprecated `private` is no longer this file's business either: the fragment
 * selects both, and {@link ./structureRows.projectLinearTeam} reads the one Linear still publishes.
 */
const TEAMS_QUERY = String(LinearDocument.TeamsDocument);

/** The ROOT membership edges — `team { id }` and `user { id }` — joined locally onto the team rows. */
const TEAM_MEMBERSHIPS_QUERY = String(LinearDocument.TeamMembershipsDocument);

/** Workflow states, at the ROOT — each bound back to its team by the fragment's own `team { id }`. */
const WORKFLOW_STATES_QUERY = String(LinearDocument.WorkflowStatesDocument);

/** Cycles, at the ROOT — each bound back to its team by the fragment's own `team { id }`. */
const CYCLES_QUERY = String(LinearDocument.CyclesDocument);

/**
 * Page the teams lane. Split out of {@link fetchLinearStructures} so the paging lives in one function and
 * the org/state/cycle assembly in another.
 *
 * @param request the shared Linear transport
 * @param fetchedAtIso when the fetch happened
 * @param membersByTeam the index the ROOT `teamMemberships` walk built, joined onto each row here
 * @param warnings the running warning list, MUTATED in place when a walk ends incompletely
 * @returns every team row, with its member relations
 */
async function collectTeamRows({
  request,
  fetchedAtIso,
  membersByTeam,
  warnings,
}: {
  request: LinearRequest;
  fetchedAtIso: string;
  membersByTeam: ReadonlyMap<string, readonly string[]>;
  warnings: string[];
}): Promise<readonly StructureBronzeRow[]> {
  const rows: StructureBronzeRow[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const open = openCursorPage({
      collected: rows.length,
      cursor,
      lane: "linear teams",
      maxItems: undefined,
      pages,
      seen,
      warnings,
    });
    if (open === undefined) {
      break;
    }
    const data = await request({
      query: TEAMS_QUERY,
      variables: { first: PAGE_SIZE, includeArchived: true, ...(cursor !== undefined ? { after: cursor } : {}) },
    });
    pages += 1;
    const page = structuresFromTeamsPage({ data, fetchedAtIso, membersByTeam });
    rows.push(...page.rows);
    const next = advanceOrWarn({ lane: "linear teams", next: page.nextCursor, seen, warnings });
    if (next === undefined) {
      break;
    }
    cursor = next;
  }
  return rows;
}

/**
 * Hydrate the Linear org structure: the organization row plus every team (+ its states + cycles), paging the
 * teams lane to exhaustion. A failure is fatal (`err`) after the transport's retry budget.
 *
 * @param request the injected GraphQL transport (rate-gated + retried in production)
 * @param fetchedAtIso the hydration timestamp
 * @returns the structure rows + warnings, or `err` on a fatal failure
 */
export async function fetchLinearStructures({
  request,
  fetchedAtIso,
  references = NO_REFERENCES,
}: {
  request: LinearRequest;
  fetchedAtIso: string;
  references?: LinearReferences;
}): Promise<Result<{ rows: readonly StructureBronzeRow[]; warnings: readonly string[] }, LinearHydrationError>> {
  const rows: StructureBronzeRow[] = [];
  // Declared before the try so the nested team-member walk can report an incomplete page here rather than
  // dropping it: this is the nearest surface that reaches the caller.
  const warnings: string[] = [];
  try {
    const orgData = await request({ query: ORGANIZATION_QUERY, variables: {} });
    const orgRow = projectLinearOrg({ fetchedAtIso, raw: isRecord(orgData) ? orgData["organization"] : undefined });
    rows.push(...(orgRow === undefined ? [] : [orgRow]));
    // The membership index comes FIRST: the team rows are joined against it as they are projected, so a
    // team's `member` relations are complete on the row rather than patched onto it afterwards.
    const membersByTeam = teamMembersFromMemberships({
      nodes: await collectRootNodes({
        includeArchived: true,
        key: "teamMemberships",
        query: TEAM_MEMBERSHIPS_QUERY,
        request,
        warnings,
      }),
    });
    rows.push(...(await collectTeamRows({ fetchedAtIso, membersByTeam, request, warnings })));
  } catch (error: unknown) {
    return err(LinearHydrationErrors.structureHydrationFailed({ cause: error }));
  }
  // States and cycles come from the ROOT connections now (see TEAMS_QUERY's note): nesting them under a
  // 50-team page cost 81,430 complexity points against a 10,000 ceiling.
  const states = await rootStructureLane({
    build: ({ node }) => projectLinearState({ fetchedAtIso, node }),
    includeArchived: true,
    key: "workflowStates",
    query: WORKFLOW_STATES_QUERY,
    request,
    warnings,
  });
  const cycles = await rootStructureLane({
    build: ({ node }) => projectLinearCycle({ fetchedAtIso, node }),
    includeArchived: true,
    key: "cycles",
    query: CYCLES_QUERY,
    request,
    warnings,
  });
  rows.push(...states, ...cycles);
  // The two ORG-VOCABULARY lanes are best-effort and additive: a workspace may not expose them, and the org
  // graph is still worth having without them. They live here rather than with the activity crawl because a
  // label and a saved view are scaffolding, not activity — the same reason teams and cycles are.
  const vocabulary = await fetchLinearVocabulary({ fetchedAtIso, references, request });
  rows.push(...vocabulary.rows);
  return ok({ rows, warnings: [...warnings, ...vocabulary.warnings] });
}

/**
 * Page one ROOT connection to exhaustion and hand back its raw nodes; a failure warns and yields nothing.
 *
 * Separate from {@link rootStructureLane} because one caller wants the nodes rather than rows:
 * `teamMemberships` is an INDEX this file joins locally, not a structure kind it files.
 *
 * `includeArchived` is passed only when the lane's document declares it. The SDK's connection documents all
 * do; the two hand-written vocabulary documents in `./queries.ts` do not, and sending a variable an
 * operation never declared is not a shape worth relying on a server to forgive.
 */
async function collectRootNodes({
  request,
  query,
  key,
  includeArchived,
  warnings,
}: {
  request: LinearRequest;
  query: string;
  key: string;
  includeArchived: boolean;
  warnings: string[];
}): Promise<readonly unknown[]> {
  try {
    const nodes = await collectCursorPages<unknown>({
      fetchPage: async ({ cursor }) => {
        const data = await request({
          query,
          variables: {
            first: PAGE_SIZE,
            ...(includeArchived ? { includeArchived: true } : {}),
            ...(cursor !== undefined ? { after: cursor } : {}),
          },
        });
        const connection = isRecord(data) ? data[key] : undefined;
        const info = pageInfoOf({ connection });
        return {
          hasMore: info.hasNext,
          items: isRecord(connection) && Array.isArray(connection["nodes"]) ? connection["nodes"] : [],
          nextCursor: info.hasNext ? info.endCursor : undefined,
        };
      },
    });
    pushCursorWarning({ end: nodes.end, lane: `linear ${key}`, warnings });
    return nodes.items;
  } catch (error: unknown) {
    warnings.push(`linear ${key} lane unavailable: ${error instanceof Error ? error.message : "unknown"}`);
    return [];
  }
}

/** Page one ROOT structure lane to exhaustion, projecting each node; a failure warns and yields nothing. */
async function rootStructureLane({
  request,
  query,
  key,
  includeArchived,
  build,
  warnings,
}: {
  request: LinearRequest;
  query: string;
  key: string;
  includeArchived: boolean;
  build: ({ node }: { node: unknown }) => StructureBronzeRow | undefined;
  warnings: string[];
}): Promise<readonly StructureBronzeRow[]> {
  const nodes = await collectRootNodes({ includeArchived, key, query, request, warnings });
  return nodes.map((node) => build({ node })).filter((row): row is StructureBronzeRow => row !== undefined);
}

/** The org-vocabulary structure rows (issue labels + saved views), each lane best-effort. */
async function fetchLinearVocabulary({
  request,
  fetchedAtIso,
  references,
}: {
  request: LinearRequest;
  fetchedAtIso: string;
  references: LinearReferences;
}): Promise<{ rows: readonly StructureBronzeRow[]; warnings: readonly string[] }> {
  const warnings: string[] = [];
  // Both lanes go through `hydrateNode` because their projectors read NAMES off references the SDK's
  // fragments carry as bare ids — a label's `parent` (which is a LABEL, not an issue) and both lanes'
  // `creator` and `team`. Without the crawl's reference index those resolve to nothing, which is why this
  // function takes one rather than reaching for a default.
  const labels = await rootStructureLane({
    build: ({ node }) =>
      issueLabelRow({ fetchedAtIso, node: hydrateNode({ index: references.index, node, spec: ISSUE_LABELS_REFS }) }),
    includeArchived: true,
    key: "issueLabels",
    query: ISSUE_LABELS_QUERY,
    request,
    warnings,
  });
  const views = await rootStructureLane({
    build: ({ node }) =>
      customViewRow({ fetchedAtIso, node: hydrateNode({ index: references.index, node, spec: CUSTOM_VIEWS_REFS }) }),
    includeArchived: true,
    key: "customViews",
    query: CUSTOM_VIEWS_QUERY,
    request,
    warnings,
  });
  return { rows: [...labels, ...views], warnings };
}
