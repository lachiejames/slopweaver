/**
 * Turn the portal's own JSON API responses into this atlas's stored entities — the ADMISSION boundary.
 *
 * ## Two endpoints, measured, not guessed
 *
 * MEASURED by walking the portal's API in the owner's session:
 *
 * - **`/api/findings?tab=<state>&page=1&limit=<n>`** returns `{ data: [...], total, page, totalPages,
 *   tabCounts }`. Each `data` row is `{ id, findingId, title, severity, status, createdAt, lastUpdatedAt,
 *   projectName, sourceType }`. The list is fetched one lifecycle TAB at a time, so the finding's state is
 *   the `tab` in the request URL rather than the numeric `status` on the row — the walk asks for each tab it
 *   wants and the reduction reads the answer's own address.
 * - **`/api/findings/stats`** returns `{ total, severities, statuses, sources: [{ uuid, name }] }`. The
 *   `sources` array is one row per PROJECT, which is where the `project` kind comes from.
 *
 * ## Every field is PICKED, never spread
 *
 * Nothing here copies a portal object. Each builder names the fields it admits and drops the rest, so a
 * field Aether adds next month is absent because nobody chose it. `entities.ts`'s strict parse is the second
 * half of the same boundary. A finding whose severity is a word this atlas does not know, or that arrives
 * under a tab that is not a known state, is returned as `unprojectable` rather than stored under a guess — a
 * partial read must be visible.
 *
 * ## Timestamps go through a single converter, and nothing scales an epoch
 *
 * {@link isoOrNull} decides what a non-time looks like once (`typescript-patterns.md` bans `new Date(x*1000)`
 * outside `lib/date.ts`; a `new Date(isoString)` is not that).
 */
import { isRecord } from "../../lib/parsers.js";
import { stableEntityId } from "../kit/identity.js";

import type { AetherFinding, AetherProject } from "./entities.js";
import { AETHER_FINDING_STATES, AETHER_PLATFORM, AETHER_SEVERITIES, type AetherFindingState } from "./model.js";

/** This run's timing and the endpoint an entity was reduced from. */
interface ReductionContext {
  /** This run's ISO timestamp. */
  readonly at: string;
  /** The response URL, kept as the reproduction endpoint on `source`. */
  readonly endpoint: string;
}

/** What the reduction produced from a walk's responses. */
export interface AetherReduction {
  readonly projects: readonly AetherProject[];
  readonly findings: readonly AetherFinding[];
  /** Rows that anchored as a finding but carried a value this atlas does not know, with why. */
  readonly unprojectable: readonly string[];
}

/** A first-party response the reduction reads, with its parsed body. */
export interface ReducibleResponse {
  readonly url: string;
  readonly body: unknown;
}

/** A string field, or `null` when absent, empty or not a string. */
function stringOrNull({ value }: { value: unknown }): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** An ISO instant, or `null` when the field is absent, empty, or not a time this build can store. */
function isoOrNull({ value }: { value: unknown }): string | null {
  const raw = stringOrNull({ value });
  if (raw === null) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** An id as a string, whatever integer or string shape the portal reported it in. */
function idOrNull({ value }: { value: unknown }): string | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }
  return stringOrNull({ value });
}

/** The `tab` query parameter of a findings request, validated against this atlas's known states. */
function tabState({ url }: { url: string }): AetherFindingState | null {
  let tab: string | null = null;
  try {
    tab = new URL(url).searchParams.get("tab");
  } catch {
    return null;
  }
  if (tab === null) {
    return null;
  }
  const lowered = tab.trim().toLowerCase();
  const hit = AETHER_FINDING_STATES.find((state) => state === lowered);
  if (hit === undefined) {
    return null;
  }
  return hit;
}

/** The severity on a finding row, validated against this atlas's known tiers. */
function severityOf({ row }: { row: Record<string, unknown> }): (typeof AETHER_SEVERITIES)[number] | null {
  const raw = stringOrNull({ value: row["severity"] });
  if (raw === null) {
    return null;
  }
  const lowered = raw.trim().toLowerCase();
  const hit = AETHER_SEVERITIES.find((severity) => severity === lowered);
  if (hit === undefined) {
    return null;
  }
  return hit;
}

/** The `data` array of a findings-list response, or `null` when the body is not that shape. */
function findingRows({ body }: { body: unknown }): readonly unknown[] | null {
  if (!isRecord(body)) {
    return null;
  }
  const data = body["data"];
  return Array.isArray(data) ? data : null;
}

/** Build one finding from a `/api/findings` row, or a reason it could not be stored. */
function buildFinding({
  row,
  findingState,
  context,
}: {
  row: Record<string, unknown>;
  findingState: AetherFindingState;
  context: ReductionContext;
}): { finding: AetherFinding } | { unprojectable: string } {
  const code = stringOrNull({ value: row["findingId"] });
  const title = stringOrNull({ value: row["title"] });
  const severity = severityOf({ row });
  if (code === null) {
    return { unprojectable: `a ${findingState} finding row carried no findingId` };
  }
  if (title === null) {
    return { unprojectable: `${code}: no title on the row` };
  }
  if (severity === null) {
    return { unprojectable: `${code}: severity "${String(row["severity"])}" is not a known tier` };
  }
  const parsedId = idOrNull({ value: row["id"] });
  // The finding's code is a stable fallback when the row carries no numeric id; an `if` rather than `??`
  // because a new nullish-coalesce is what `no-silent-fallback` forbids.
  let providerId = code;
  if (parsedId !== null) {
    providerId = parsedId;
  }
  return {
    finding: {
      code,
      findingState,
      firstSeenAt: context.at,
      id: stableEntityId({ components: { code, kind: "finding" }, namespace: AETHER_PLATFORM }),
      projectName: stringOrNull({ value: row["projectName"] }),
      providerId,
      reportedAt: isoOrNull({ value: row["createdAt"] }),
      severity,
      source: {
        artifacts: [],
        deepLink: null,
        deepLinkStatus: "unverified",
        endpoint: context.endpoint,
        observedAt: context.at,
        surface: "aether-portal",
      },
      sourceType: stringOrNull({ value: row["sourceType"] }),
      state: "observed",
      title,
      updatedAt: isoOrNull({ value: row["lastUpdatedAt"] }),
    },
  };
}

/** Fold `/api/findings/stats`'s `sources` array into project rows keyed by uuid. */
function foldProjectSources({ body, into }: { body: unknown; into: Map<string, { name: string }> }): void {
  if (!isRecord(body)) {
    return;
  }
  const sources = body["sources"];
  if (!Array.isArray(sources)) {
    return;
  }
  for (const source of sources) {
    if (!isRecord(source)) {
      continue;
    }
    const uuid = stringOrNull({ value: source["uuid"] });
    const name = stringOrNull({ value: source["name"] });
    if (uuid !== null && name !== null) {
      into.set(uuid, { name });
    }
  }
}

/**
 * Reduce a walk's captured responses into stored findings and projects.
 *
 * Findings are deduped by code across every findings response, so the same finding appearing in both the
 * human page's first-page fetch and the walk's full-page fetch is stored once. Projects come from the stats
 * endpoint's `sources`, and each carries the count of open findings the reduction attributed to it, so a
 * reader can tell a complete finding read from a partial one.
 *
 * @param responses the first-party JSON responses a walk captured, in visit order
 * @param at this run's ISO timestamp
 * @returns the reduced findings and projects, and any row that could not be stored
 */
export function reduceAetherPortal({
  responses,
  at,
}: {
  responses: readonly ReducibleResponse[];
  at: string;
}): AetherReduction {
  const findings = new Map<string, AetherFinding>();
  const unprojectable: string[] = [];
  const projectSources = new Map<string, { name: string }>();

  for (const response of responses) {
    if (response.url.includes("/api/findings/stats")) {
      foldProjectSources({ body: response.body, into: projectSources });
      continue;
    }
    foldFindingsResponse({ at, findings, response, unprojectable });
  }

  const storedFindings = [...findings.values()];
  return {
    findings: storedFindings,
    projects: buildProjects({ at, findings: storedFindings, projectSources }),
    unprojectable,
  };
}

/** Fold one `/api/findings` response's rows into the running finding map and unprojectable list. */
function foldFindingsResponse({
  response,
  findings,
  unprojectable,
  at,
}: {
  response: ReducibleResponse;
  findings: Map<string, AetherFinding>;
  unprojectable: string[];
  at: string;
}): void {
  const rows = findingRows({ body: response.body });
  if (rows === null) {
    return;
  }
  const findingState = tabState({ url: response.url });
  if (findingState === null) {
    unprojectable.push(
      `${response.url}: no known lifecycle tab, so its ${String(rows.length)} finding(s) have no state`,
    );
    return;
  }
  const context: ReductionContext = { at, endpoint: response.url };
  for (const row of rows) {
    const built = buildRow({ context, findingState, findings, row });
    if (built === "skip") {
      continue;
    }
    if ("finding" in built) {
      findings.set(built.finding.code, built.finding);
    } else {
      unprojectable.push(built.unprojectable);
    }
  }
}

/** Classify one raw row: skip a non-object or an already-seen code, else build it. */
function buildRow({
  row,
  findingState,
  findings,
  context,
}: {
  row: unknown;
  findingState: AetherFindingState;
  findings: ReadonlyMap<string, AetherFinding>;
  context: ReductionContext;
}): { finding: AetherFinding } | { unprojectable: string } | "skip" {
  if (!isRecord(row)) {
    return "skip";
  }
  const code = stringOrNull({ value: row["findingId"] });
  if (code !== null && findings.has(code)) {
    return "skip";
  }
  return buildFinding({ context, findingState, row });
}

/** Build the project rows from the stats sources, counting each one's open findings. */
function buildProjects({
  projectSources,
  findings,
  at,
}: {
  projectSources: ReadonlyMap<string, { name: string }>;
  findings: readonly AetherFinding[];
  at: string;
}): readonly AetherProject[] {
  return [...projectSources.entries()].map(([uuid, { name }]) => ({
    firstSeenAt: at,
    id: stableEntityId({ components: { kind: "project", uuid }, namespace: AETHER_PLATFORM }),
    name,
    openFindingCount: findings.filter((finding) => finding.projectName === name && finding.findingState === "open")
      .length,
    providerId: uuid,
    source: {
      artifacts: [],
      deepLink: null,
      deepLinkStatus: "unverified",
      endpoint: "/api/findings/stats",
      observedAt: at,
      surface: "aether-portal",
    },
    state: "observed",
  }));
}
