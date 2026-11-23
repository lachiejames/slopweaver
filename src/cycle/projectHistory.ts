/**
 * A project's update HISTORY: when it was last updated and how many updates it has had, read from Linear bronze
 * and from a live read, and reconciled so that no source can move it backwards.
 *
 * Three bronze shapes carry it, and each has been the one that was missing: a project record's own
 * `raw.projectUpdates` (absent on every record written since the SDK migration), a standalone update record (which
 * names its project by id only since that migration, and by URL slug before it), and more than one record for the
 * same project. `./projectUpdate.ts` judges what is overdue from the history this module settles.
 *
 * Pure: the caller streams the records.
 */
import { parseIsoMs } from "#lib/date.js";

import { isRecord } from "../lib/parsers.js";

/** One project, reduced to what the update half judges. */
export interface CycleProject {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly status: string;
  readonly leadId: string | undefined;
  readonly lastUpdateIso: string | undefined;
  /** When the project itself started — the age a never-updated project is overdue BY. */
  readonly createdAt: string | undefined;
  readonly updateCount: number;
  readonly recordTsIso: string;
}

/**
 * Read one Linear bronze line into a {@link CycleProject}.
 *
 * @param line one raw JSONL line
 * @returns the project, or `undefined` when the line is not a project record
 */
export function cycleProjectOf({ line }: { line: string }): CycleProject | undefined {
  const parsed: unknown = safeParse({ line });
  if (!isRecord(parsed) || parsed["kind"] !== "project") {
    return undefined;
  }
  const raw: unknown = parsed["raw"];
  if (!isRecord(raw) || typeof parsed["sourceId"] !== "string" || typeof parsed["tsIso"] !== "string") {
    return undefined;
  }
  const updates = updateInstants({ value: raw["projectUpdates"] });
  const status = isRecord(raw["status"]) ? raw["status"] : {};
  return {
    createdAt: typeof raw["createdAt"] === "string" ? raw["createdAt"] : undefined,
    id: parsed["sourceId"],
    lastUpdateIso: updates.at(-1),
    leadId: isRecord(raw["lead"]) && typeof raw["lead"]["id"] === "string" ? raw["lead"]["id"] : undefined,
    name: typeof raw["name"] === "string" ? raw["name"] : "",
    recordTsIso: parsed["tsIso"],
    status: typeof status["name"] === "string" ? status["name"] : "",
    updateCount: updates.length,
    url: typeof raw["url"] === "string" ? raw["url"] : "",
  };
}

/**
 * Whether a line could parse to an `update` record — the cheap test that spares a parse of every other line.
 *
 * It must never refuse a line the parse would accept, so it admits the key and value however JSON may spell them:
 * any whitespace around the colon, and any line carrying a `\\u` escape, the only way JSON can spell a letter
 * differently. Measured on the real home: 81 of 185,148 Linear bronze lines carry one, so this still
 * spares nearly every parse, and parsing every line instead took a plain pass from 25.7s to 42.5s. Repro: `cat ~/.slopweaver/corpus/bronze/linear/*.jsonl |
 * grep -c -F "\\u"`.
 */
function mayBeUpdateLine({ line }: { line: string }): boolean {
  return /"kind"\s*:\s*"update"/.test(line) || line.includes("\\u");
}

/** One status update in bronze, reduced to the two facts the overdue judgement reads. */
export interface CycleProjectUpdate {
  /**
   * The project it was posted to, spelled as a project record's own `sourceId` (`project:<id>`) — only a
   * record written since the SDK migration names it.
   */
  readonly projectId: string | undefined;
  /** The project's slug id read off the update's own URL — the join an older record offers. */
  readonly projectSlugId: string | undefined;
  readonly id: string;
  readonly createdAt: string;
}

/**
 * Read one Linear bronze line into a {@link CycleProjectUpdate}.
 *
 * The standalone `update` record, not the project's own. Since the SDK migration a project
 * record's `raw` is the SDK's project node, which carries no `projectUpdates` connection at all — measured
 * on the real home, every one of the 220 project records written since lacked it — so a project
 * that changed after the migration read as never updated. A new update is a new `sourceId`, so it lands on the
 * first refresh that walks its project whether or not the project record itself deduplicates. An archived
 * update is not a report anyone sees, so it is skipped.
 *
 * Only an SDK-era record carries `raw.project.id`: 81 of 2,439 update lines on the real home. All
 * 2,195 PROJECT updates carry a URL with the project's slug id, the join for the rest; the other 244 are
 * initiative updates, which name neither and are skipped. Repro: `grep -h '"kind":"update"'
 * ~/.slopweaver/corpus/bronze/linear/*.jsonl | jq -s '[length, (map(select(.raw.project.id))|length),
 * (map(select(.sourceId|startswith("projectUpdate:")))|length)]'`.
 *
 * @param line one raw JSONL line
 * @returns the update, or `undefined` when the line is not a live update that names or links its project
 */
export function cycleProjectUpdateOf({ line }: { line: string }): CycleProjectUpdate | undefined {
  if (!mayBeUpdateLine({ line })) {
    return undefined;
  }
  const parsed: unknown = safeParse({ line });
  if (!isRecord(parsed) || parsed["kind"] !== "update" || typeof parsed["sourceId"] !== "string") {
    return undefined;
  }
  const raw: unknown = parsed["raw"];
  if (!isRecord(raw) || typeof raw["createdAt"] !== "string" || typeof raw["archivedAt"] === "string") {
    return undefined;
  }
  const named = isRecord(raw["project"]) ? raw["project"]["id"] : undefined;
  const projectId = typeof named === "string" ? `project:${named}` : undefined;
  const projectSlugId = typeof parsed["url"] === "string" ? projectSlugIdOf({ url: parsed["url"] }) : undefined;
  if (projectId === undefined && projectSlugId === undefined) {
    return undefined;
  }
  return { createdAt: raw["createdAt"], id: parsed["sourceId"], projectId, projectSlugId };
}

/**
 * The stable slug id at the end of a Linear project URL's path segment — `<slugId>` in
 * `…/project/some-project-name-<slugId>/activity#…`. The name before it changes on a rename; the
 * id does not, so it is what an update's URL and its project's URL share. Every one on the real home is twelve
 * hex characters, but the join assumes only that the id is the segment's last hyphen-separated token, or the
 * whole segment when it has no hyphen.
 *
 * @returns the id, or `undefined` when the URL is not a project's
 */
function projectSlugIdOf({ url }: { url: string }): string | undefined {
  return /\/project\/(?:[^/?#]*-)?([0-9A-Za-z]+)(?:[/?#]|$)/.exec(url)?.[1];
}

/**
 * Fold the standalone update records into each project's history. Pure.
 *
 * A project's last update is the later of what its own record carried and the newest update record naming
 * it; its count is the larger of the two, since the two sources overlap for any project read both ways. An
 * update that does not name its project's id is matched by the slug id its URL shares with the project's.
 *
 * @param projects every project row, already reduced to one each
 * @param updates every live update record read
 * @returns the same rows, each carrying the fuller of the two histories
 */
export function withBronzeUpdates({
  projects,
  updates,
}: {
  projects: readonly CycleProject[];
  updates: readonly CycleProjectUpdate[];
}): readonly CycleProject[] {
  const byProject = updatesByProject({ projects, updates });
  return projects.map((project) => {
    const seen = byProject.get(project.id);
    if (seen === undefined) {
      return project;
    }
    const recordLast = project.lastUpdateIso;
    const last =
      recordLast !== undefined && isBefore({ earlier: seen.last, later: recordLast }) ? recordLast : seen.last;
    return { ...project, lastUpdateIso: last, updateCount: Math.max(project.updateCount, seen.ids.size) };
  });
}

/** Each project's update records, grouped by the project they name by id or link by URL slug. */
function updatesByProject({
  projects,
  updates,
}: {
  projects: readonly CycleProject[];
  updates: readonly CycleProjectUpdate[];
}): ReadonlyMap<string, { last: string; ids: Set<string> }> {
  const bySlugId = new Map<string, string>();
  for (const project of projects) {
    const slugId = projectSlugIdOf({ url: project.url });
    if (slugId !== undefined) {
      bySlugId.set(slugId, project.id);
    }
  }
  const byProject = new Map<string, { last: string; ids: Set<string> }>();
  for (const update of updates) {
    const projectId = projectIdOfUpdate({ bySlugId, update });
    if (projectId === undefined) {
      continue;
    }
    const held = byProject.get(projectId);
    if (held === undefined) {
      byProject.set(projectId, { ids: new Set([update.id]), last: update.createdAt });
      continue;
    }
    held.ids.add(update.id);
    if (isBefore({ earlier: held.last, later: update.createdAt })) {
      held.last = update.createdAt;
    }
  }
  return byProject;
}

/** The project an update belongs to: the id it names, else the project whose URL shares its slug id. */
function projectIdOfUpdate({
  bySlugId,
  update,
}: {
  bySlugId: ReadonlyMap<string, string>;
  update: CycleProjectUpdate;
}): string | undefined {
  if (update.projectId !== undefined) {
    return update.projectId;
  }
  return update.projectSlugId === undefined ? undefined : bySlugId.get(update.projectSlugId);
}

/** Every update's `createdAt` inside a `projectUpdates` connection, ascending by instant. */
function updateInstants({ value }: { value: unknown }): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value["nodes"])) {
    return [];
  }
  const instants: string[] = [];
  for (const node of value["nodes"]) {
    if (isRecord(node) && typeof node["createdAt"] === "string") {
      instants.push(node["createdAt"]);
    }
  }
  return instants.toSorted((a, b) => byInstant({ a, b }));
}

/** A sort comparator that orders two timestamps by the instant each names. */
function byInstant({ a, b }: { a: string; b: string }): number {
  if (isBefore({ earlier: a, later: b })) {
    return -1;
  }
  if (isBefore({ earlier: b, later: a })) {
    return 1;
  }
  return 0;
}

/**
 * Whether `earlier` is an earlier instant than `later`, compared as instants so an offset timestamp orders by
 * when it happened rather than by how it is spelled. Two strings either side cannot parse are compared as
 * text, the order every `Z` timestamp Linear writes already sorts in.
 */
function isBefore({ earlier, later }: { earlier: string; later: string }): boolean {
  const earlierMs = parseIsoMs({ tsIso: earlier });
  const laterMs = parseIsoMs({ tsIso: later });
  if (earlierMs === undefined || laterMs === undefined) {
    return earlier < later;
  }
  return earlierMs < laterMs;
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
 * Keep only the newest row per project id.
 *
 * **A tie on the record's timestamp is broken by the update history, never by read order.** A record's
 * `tsIso` is the project's own `updatedAt`, and posting a status update does not move it — so a refresh that
 * re-lands a project after an update writes a second record with the SAME timestamp and one more update.
 * Keeping the first one read kept the stale copy: measured on the real home, two of the owner's
 * three projects each held two records at one `tsIso`, and the plain pass reported the one without the
 * latest update ("84 days", "never"). A history only grows, so on a tie the later last update wins.
 *
 * **The history is the fullest ANY record held, not the kept record's own.** The newest record decides the
 * project's name, lead and status, but a record written since the SDK migration carries no `projectUpdates`
 * at all, so keeping its empty history would forget an update an older record saw. The last update is the
 * latest across every record, and the count the largest.
 *
 * @param projects every project row read, in any order
 * @returns one row per id, the newest by the record's own timestamp, then by its last update, carrying the
 *   fullest history read for that id
 */
export function newestPerProject({ projects }: { projects: readonly CycleProject[] }): readonly CycleProject[] {
  const byId = new Map<string, CycleProject>();
  const history = new Map<string, { last: string | undefined; count: number }>();
  for (const project of projects) {
    const held = byId.get(project.id);
    if (held === undefined || isNewer({ candidate: project, held })) {
      byId.set(project.id, project);
    }
    const seen = history.get(project.id);
    if (seen === undefined) {
      history.set(project.id, { count: project.updateCount, last: project.lastUpdateIso });
      continue;
    }
    seen.count = Math.max(seen.count, project.updateCount);
    if (
      project.lastUpdateIso !== undefined &&
      (seen.last === undefined || isBefore({ earlier: seen.last, later: project.lastUpdateIso }))
    ) {
      seen.last = project.lastUpdateIso;
    }
  }
  return [...byId.values()].map((project) => {
    const seen = history.get(project.id)!;
    return { ...project, lastUpdateIso: seen.last, updateCount: seen.count };
  });
}

/** Whether `candidate` supersedes `held`: a later record, or the same record instant with a longer history. */
function isNewer({ candidate, held }: { candidate: CycleProject; held: CycleProject }): boolean {
  if (candidate.recordTsIso !== held.recordTsIso) {
    return isBefore({ earlier: held.recordTsIso, later: candidate.recordTsIso });
  }
  const candidateLast = candidate.lastUpdateIso;
  const heldLast = held.lastUpdateIso;
  if (candidateLast === heldLast) {
    return held.updateCount < candidate.updateCount;
  }
  // A project with no update at all is older than one with any.
  if (candidateLast === undefined) {
    return false;
  }
  return heldLast === undefined || isBefore({ earlier: heldLast, later: candidateLast });
}

/**
 * One project's update history, as either bronze or a live read reports it.
 *
 * @internal — what {@link liveProjectUpdates} answers and {@link withLiveUpdates} applies.
 */
export interface ProjectUpdateHistory {
  /** The newest update's `createdAt`, or undefined when the project has never had one. */
  readonly lastUpdateIso: string | undefined;
  readonly updateCount: number;
}

/**
 * Read a live `projectUpdates` connection into the same two facts bronze carries — or refuse to.
 *
 * The live reader answers the provider's own connection, the identical `{nodes: [...]}` shape a bronze
 * record's `raw` holds, which is why this reuses the bronze reader rather than parsing the live document a
 * second, subtly different way. A shape either side reads wrong is then wrong in one place.
 *
 * **An absent connection is not an empty one.** This used to answer `{ updateCount: 0 }` for a node that
 * carried no `projectUpdates` at all, and the object read it was handed never selected one — so every
 * verified project was reported never updated, overwriting a correct bronze history (measured).
 *
 * **A partial page is a lower bound, never a whole history.** The connection is complete only when its
 * `pageInfo` says `hasNextPage: false`. Short of that, every update the page DID hold still exists, so its
 * newest one is a floor on the project's last update — and {@link withLiveUpdates} only ever moves a history
 * forward, so a floor can raise bronze and never lower it. What a partial page cannot prove is ABSENCE: one
 * holding no update at all is refused, since "never updated" is exactly the claim it did not see enough to
 * make. Undefined means "not seen", and the caller keeps bronze and says so.
 *
 * @param connection the `projectUpdates` connection a live read answered with
 * @returns the updates the connection held — the whole history when it was complete, a lower bound when it was
 *   not — or undefined when it held nothing readable
 */
export function liveProjectUpdates({ connection }: { connection: unknown }): ProjectUpdateHistory | undefined {
  if (!isRecord(connection) || !Array.isArray(connection["nodes"])) {
    return undefined;
  }
  const updates = updateInstants({ value: connection });
  // A node without a readable `createdAt` is a shape this reader does not understand, not an absent update.
  if (updates.length !== connection["nodes"].length) {
    return undefined;
  }
  // Complete only when the provider SAYS so: a missing or malformed `pageInfo` proves nothing about the rest.
  const pageInfo = connection["pageInfo"];
  const complete = isRecord(pageInfo) && pageInfo["hasNextPage"] === false;
  if (!complete && updates.length === 0) {
    return undefined;
  }
  return { lastUpdateIso: updates.at(-1), updateCount: updates.length };
}

/**
 * Apply what a live read saw to each project's update history, leaving every other field alone.
 *
 * **A live read may move a project's last update FORWARD, never back.** The one error this leg exists to
 * prevent is proposing an update the project already has — a duplicate posted to every watcher under the owner's
 * name. A live history older than bronze's is either a deleted update or a read that saw less than it
 * claims, and the cost of trusting the second is that duplicate; the cost of distrusting the first is one
 * proposal arriving later than it could have. So the later of the two instants wins, and the larger count —
 * a live read of one page is a lower bound on both.
 *
 * Only the two facts the overdue judgement reads are touched. Everything else on the row — the lead, the
 * status, the name — is left exactly as bronze had it, because those are not what went stale and widening
 * the patch would make a verified run and an unverified one disagree about more than freshness.
 *
 * Pure.
 *
 * @param projects every project row the pass holds
 * @param seen the live history, keyed by project id; a project absent from it is returned untouched
 * @returns the same rows, with a live history applied wherever one was read
 */
export function withLiveUpdates({
  projects,
  seen,
}: {
  projects: readonly CycleProject[];
  seen: ReadonlyMap<string, ProjectUpdateHistory>;
}): readonly CycleProject[] {
  return projects.map((project) => {
    const live = seen.get(project.id);
    if (live === undefined) {
      return project;
    }
    const bronzeIsLater =
      project.lastUpdateIso !== undefined &&
      (live.lastUpdateIso === undefined || isBefore({ earlier: live.lastUpdateIso, later: project.lastUpdateIso }));
    if (bronzeIsLater) {
      return project;
    }
    return {
      ...project,
      lastUpdateIso: live.lastUpdateIso,
      updateCount: Math.max(project.updateCount, live.updateCount),
    };
  });
}
