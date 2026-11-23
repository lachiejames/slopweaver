/**
 * A structural census of JumpCloud answers — every key path, its JSON kinds and how often it was present, per
 * registry surface — and NEVER a value. It is what `tools/generateJumpcloudResponseBoundaries.ts` declares each
 * surface's strict boundary from, and `tools/jumpcloudResponseCensus.ts` takes it against the live tenant.
 *
 * How a path is written and which keys are normalised is the kit's (`../kit/responseStructure.ts`). What is
 * JumpCloud's is the per-surface tally around it — statuses, carriers, non-JSON bodies — and the routing below.
 *
 * ## An answer is filed under the surface that ASKED for it
 *
 * The transport sees only a URL, and `registryMatch.ts` admits the first row whose path shape fits. That is right
 * for admission and wrong for a census: `/api/v2/workflows/runs` fits `/api/v2/workflows/{id}` too, and a census
 * filed by first match declares the run list's envelope on the by-id read. So {@link jumpcloudCensusSurfaceFor}
 * picks the row with the most literal segments among the surfaces a read actually pages, and files a tie under a
 * name no surface carries, which the generator refuses.
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import {
  bumpCensusCount,
  isPrototypeName,
  observeResponseStructure,
  ownCensusEntry,
  RESPONSE_CENSUS_COUNT,
  RESPONSE_CENSUS_COUNTS,
  RESPONSE_PATH_CENSUS_FILE,
  type ResponsePathCensus,
  type ResponseStructure,
  responseCensusKey,
  responseJsonKind,
} from "../kit/responseStructure.js";

import { JUMPCLOUD_ORIGINS } from "./generated/specLock.js";
import { JUMPCLOUD_SURFACES } from "./generated/surfaces.js";

/** One surface's tally: the kit's structure, plus what JumpCloud counts around it. */
export interface JumpcloudSurfaceCensus extends ResponseStructure {
  /** Every answer, any status. */
  responses: number;
  /** Answers by HTTP status. */
  statuses: Record<string, number>;
  /** 2xx answers by carrier: `bare-array`, `bare-array-empty`, `empty-text`, or `object{<sorted top-level keys>}`. */
  envelopes: Record<string, number>;
  /** 2xx answers whose body was not JSON. */
  nonJson: number;
}

/** A census across surfaces, by registry name. */
export type JumpcloudResponseCensus = Record<string, JumpcloudSurfaceCensus>;

/** The census exactly as this module writes it, so a file of any other shape is refused when it is read back. */
const CENSUS_FILE = z.record(
  z.string(),
  z.strictObject({
    envelopes: RESPONSE_CENSUS_COUNTS,
    nonJson: RESPONSE_CENSUS_COUNT,
    objects: RESPONSE_CENSUS_COUNTS,
    paths: z.record(z.string(), RESPONSE_PATH_CENSUS_FILE),
    responses: RESPONSE_CENSUS_COUNT,
    statuses: RESPONSE_CENSUS_COUNTS,
  }),
);

/**
 * Every named key counted present more often than objects were seen at its parent — a tally no walk writes, since a
 * named key appears at most once per object. A placeholder key (`<objectid>`, `<unsafe>`) can legitimately repeat
 * within one object, and an array's items are counted per item, so neither is held to it.
 *
 * Why it is checked: censuses are SUMMED (`mergeJumpcloudResponseCensuses`), and a key is required exactly when its
 * count equals its parent's. A sum of censuses that each keep `present <= objects` can only keep an optional key
 * optional; one input breaking it could tip an optional key into required.
 */
function overcountedKeys({ census }: { census: JumpcloudResponseCensus }): readonly string[] {
  const lines: string[] = [];
  for (const [surface, stat] of Object.entries(census)) {
    for (const [path, tally] of Object.entries(stat.paths)) {
      const line = overcountedPath({ path, stat, surface, tally });
      if (line !== undefined) {
        lines.push(line);
      }
    }
  }
  return lines;
}

/** The overcount line for one named key, or `undefined` for a key within its parent's count or one not held to it. */
function overcountedPath({
  path,
  stat,
  surface,
  tally,
}: {
  path: string;
  stat: JumpcloudSurfaceCensus;
  surface: string;
  tally: ResponsePathCensus;
}): string | undefined {
  const dot = path.lastIndexOf(".");
  const key = dot === -1 ? path : path.slice(dot + 1);
  if (path.endsWith("[]") || key.startsWith("<")) {
    return undefined;
  }
  const seen = objectsSeenAt({ parent: dot === -1 ? "" : path.slice(0, dot), stat });
  if (tally.present > seen) {
    return `${surface}: "${path}" counted present ${String(tally.present)} time(s) on ${String(seen)} object(s)`;
  }
  return undefined;
}

/** How many objects a surface saw at one parent path — none at all when the walk never met one there. */
function objectsSeenAt({ parent, stat }: { parent: string; stat: JumpcloudSurfaceCensus }): number {
  const objects = ownCensusEntry<number>({ key: parent, record: stat.objects });
  if (objects === undefined) {
    return 0;
  }
  return objects;
}

/**
 * Read a census file back for the generator, refusing one that is not the shape this module writes rather than
 * declaring boundaries from whatever it holds.
 *
 * @param text the census file's whole text
 * @returns the census, or one line per place the file departs from the census shape or counts a key more often than
 *   its parent was seen
 */
export function parseJumpcloudResponseCensus({ text }: { text: string }): Result<JumpcloudResponseCensus> {
  return checkedCensus({ value: safeJsonParse({ label: "the JumpCloud response census", text }) });
}

/**
 * A census held to every check a census file is: its shape, whole counts no larger than a double holds exactly, and
 * no key counted more often than its parent.
 */
function checkedCensus({ value }: { value: unknown }): Result<JumpcloudResponseCensus> {
  const parsed = CENSUS_FILE.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const overcounted = overcountedKeys({ census: parsed.data });
  if (overcounted.length > 0) {
    return err(overcounted);
  }
  return ok(parsed.data);
}

/** Add every count in `from` into `into`, own keys only. */
function addCounts({
  from,
  into,
}: {
  from: Partial<Record<string, number>>;
  into: Partial<Record<string, number>>;
}): void {
  for (const key of Object.keys(from)) {
    const prior = ownCensusEntry<number>({ key, record: into });
    const added = ownCensusEntry<number>({ key, record: from })!;
    into[key] = prior === undefined ? added : prior + added;
  }
}

/**
 * Sum censuses into one, as though every answer each holds had been observed in a single walk. Neither input is
 * changed.
 *
 * This is what makes a boundary the union of every shape the named censuses EVER saw rather than whatever one walk
 * happened to meet. A field every earlier object carried and no object of today's walk does is present on `N` of
 * `N + M` objects once summed, so it is declared optional rather than dropped; a surface today's walk never reached
 * keeps its measured shape rather than falling back to refusing every record; a kind seen in either stays in the
 * union. Measured: one fresh walk alone dropped optional `lastOccurrenceContext` fields from
 * `v2-alerts-service-list-alerts` because that day's alerts happened not to carry them.
 *
 * The sum is held to the same checks a census file is. A count past `Number.MAX_SAFE_INTEGER` rounds, and a rounded
 * pair can read a key present on `N - 1` of `N` objects as present on all of them — tipping it into required. Every
 * sum of safe integers that rounds lands past that bound, so refusing an unsafe count refuses every rounding.
 *
 * @param censuses the censuses to sum, every one the generator's command line names
 * @returns one census holding every count of every input, or one line per count the sum could not hold exactly
 */
export function mergeJumpcloudResponseCensuses({
  censuses,
}: {
  censuses: readonly JumpcloudResponseCensus[];
}): Result<JumpcloudResponseCensus> {
  const merged: JumpcloudResponseCensus = {};
  for (const census of censuses) {
    for (const surface of Object.keys(census)) {
      const from = ownCensusEntry({ key: surface, record: census })!;
      const into = surfaceEntry({ census: merged, surface });
      into.responses += from.responses;
      into.nonJson += from.nonJson;
      addCounts({ from: from.statuses, into: into.statuses });
      addCounts({ from: from.envelopes, into: into.envelopes });
      addCounts({ from: from.objects, into: into.objects });
      for (const path of Object.keys(from.paths)) {
        const fromPath = ownCensusEntry({ key: path, record: from.paths })!;
        const intoPath = ownCensusEntry({ key: path, record: into.paths });
        if (intoPath === undefined) {
          into.paths[path] = {
            emptyArrays: fromPath.emptyArrays,
            kinds: { ...fromPath.kinds },
            present: fromPath.present,
          };
          continue;
        }
        intoPath.present += fromPath.present;
        intoPath.emptyArrays += fromPath.emptyArrays;
        addCounts({ from: fromPath.kinds, into: intoPath.kinds });
      }
    }
  }
  return checkedCensus({ value: merged });
}

/** The carrier a parsed 2xx body arrived in. A top-level key is recorded as the walk records it, never raw. */
function envelopeOf({ body }: { body: unknown }): string {
  if (Array.isArray(body)) {
    return body.length === 0 ? "bare-array-empty" : "bare-array";
  }
  if (body !== null && typeof body === "object") {
    const keys = new Set(Object.keys(body).map((key) => responseCensusKey({ key })));
    return `object{${[...keys].toSorted().join(",")}}`;
  }
  return responseJsonKind({ value: body });
}

/** Parse a body that may not be JSON, answering `undefined` for one that is not. */
function parsedOrUndefined({ text }: { text: string }): { readonly body: unknown } | undefined {
  try {
    return { body: safeJsonParse({ label: "a JumpCloud answer under census", text }) };
  } catch {
    return undefined;
  }
}

/**
 * Fold one answer into the census. Only its structure is kept: keys, kinds and counts, never a value.
 *
 * @param census the census, updated in place
 * @param surface the registry surface the answer belongs to
 * @param status the HTTP status
 * @param text the raw body
 */
export function observeJumpcloudAnswer({
  census,
  surface,
  status,
  text,
}: {
  census: JumpcloudResponseCensus;
  surface: string;
  status: number;
  text: string;
}): void {
  // Filed under a name no paged surface carries, so the generator refuses it as unrouted.
  const filed = isPrototypeName({ name: surface }) ? `<unsafe ${surface}>` : surface;
  const stat = surfaceEntry({ census, surface: filed });
  stat.responses += 1;
  bumpCensusCount({ counts: stat.statuses, key: String(status) });
  if (status < 200 || status >= 300) {
    return;
  }
  if (text.trim().length === 0) {
    bumpCensusCount({ counts: stat.envelopes, key: "empty-text" });
    return;
  }
  const parsed = parsedOrUndefined({ text });
  if (parsed === undefined) {
    stat.nonJson += 1;
    return;
  }
  bumpCensusCount({ counts: stat.envelopes, key: envelopeOf({ body: parsed.body }) });
  observeResponseStructure({ path: "", structure: stat, value: parsed.body });
}

/** One surface's tally, opened empty the first time the surface answers. */
function surfaceEntry({
  census,
  surface,
}: {
  census: JumpcloudResponseCensus;
  surface: string;
}): JumpcloudSurfaceCensus {
  const seen = ownCensusEntry({ key: surface, record: census });
  if (seen !== undefined) {
    return seen;
  }
  const opened: JumpcloudSurfaceCensus = {
    envelopes: {},
    nonJson: 0,
    objects: {},
    paths: {},
    responses: 0,
    statuses: {},
  };
  census[surface] = opened;
  return opened;
}

/** How many literal segments a registry path has, and whether a concrete path fits its shape. */
function fitOf({ template, path }: { template: string; path: string }): number | null {
  const want = template.split("/");
  const got = path.split("/");
  if (want.length !== got.length) {
    return null;
  }
  let literal = 0;
  for (const [index, segment] of want.entries()) {
    const actual = got[index]!;
    if (segment.startsWith("{") && segment.endsWith("}")) {
      if (actual.length === 0) {
        return null;
      }
      continue;
    }
    if (segment !== actual) {
      return null;
    }
    literal += 1;
  }
  return literal;
}

/**
 * The surface one request belongs to, among the surfaces a read pages: the fitting row with the most literal path
 * segments. A tie is filed as `<ambiguous a|b>`, a name no surface carries; no fit at all is `<unmatched METHOD>`.
 *
 * @param url the absolute URL the transport was handed
 * @param method the HTTP method
 * @param surfaces the registry names a read pages (`pagedSurfaces.ts`)
 * @returns the surface name, or a placeholder no surface carries
 */
export function jumpcloudCensusSurfaceFor({
  url,
  method,
  surfaces,
}: {
  url: string;
  method: string;
  surfaces: readonly string[];
}): string {
  const parsed = new URL(url);
  const fits = JUMPCLOUD_SURFACES.filter(
    (row) => surfaces.includes(row.name) && row.method === method && JUMPCLOUD_ORIGINS[row.origin] === parsed.origin,
  ).flatMap((row) => {
    const literal = fitOf({ path: parsed.pathname, template: row.path });
    return literal === null ? [] : [{ literal, name: row.name }];
  });
  const best = Math.max(...fits.map((fit) => fit.literal));
  const winners = fits.filter((fit) => fit.literal === best).map((fit) => fit.name);
  if (winners.length === 0) {
    return `<unmatched ${method}>`;
  }
  if (winners.length > 1) {
    return `<ambiguous ${winners.join("|")}>`;
  }
  return winners[0]!;
}
