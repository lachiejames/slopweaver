/**
 * The METRICS census: every metric name this organisation can query, and the tag keys it is queryable by.
 *
 * ## A metric has no event count, and the row says so rather than inventing one
 *
 * Every other product here counts occurrences. A metric is not a thing that happened — it is a name with a
 * type and a tag vocabulary — so its row carries `countFrom: "none"` and a null count. That is the honest
 * answer to "how many", and it is the reason {@link ../census/row.CensusCountFrom} has a third member: a zero
 * here would read as a metric nobody emits, which is exactly the wrong conclusion.
 *
 * ## The tag pass is what the owner's "no hand-built metric URLs" actually needs
 *
 * Knowing a metric exists is not enough to write a query: `sum:trace.http.server.request.hits{...}` needs the
 * tag keys, and the console is where a person would otherwise go and read them. So each name's tags are read
 * (`GET /api/v2/metrics/{name}/all-tags`) and stored as members — the keys with how many distinct values each
 * had — while the values themselves reach the row only through the facet allowlist, capped as everywhere else.
 *
 * MEASURED on this install's site: the tags endpoint is metered as `hosts_and_tags`, 30 requests per 10 seconds,
 * and an instrumented organisation declares a couple of thousand metric names, so the pass is roughly ten minutes.
 */

import { errorMessage } from "../../lib/errorMessage.js";
import type { Logger } from "../../lib/logger.js";
import { presentOr } from "../detective/envelope.js";
import { foldFacetValues, isFacetPath } from "../detective/facets.js";
import { type CensusMember, type CensusRow, censusKey, SERVICE_ABSENT, sortCensusRows } from "./row.js";
import type { CensusClient, ProductCensus } from "./scope.js";

/** How many metric names one listing asks for. */
const NAME_PAGE = 10_000;

/** How many tag reads run at once — the budget is 30 per 10 seconds, so four in flight stays inside it. */
const TAG_CONCURRENCY = 4;

/**
 * Split one `key:value` tag, keeping a value that itself contains a colon whole.
 *
 * @param tag the tag as the metrics API returns it
 * @returns the key and value, or nothing when the tag carries no colon at all
 */
export function splitTag({ tag }: { tag: string }): { key: string; value: string } | null {
  const at = tag.indexOf(":");
  if (at <= 0) {
    return null;
  }
  return { key: tag.slice(0, at), value: tag.slice(at + 1) };
}

/**
 * Fold one metric's tags into the members and the allowlisted facet values a row stores.
 *
 * @param tags every `key:value` the metric declares
 * @returns the members, one per key, and the facets the allowlist admitted
 */
export function foldMetricTags({ tags }: { tags: readonly string[] }): {
  members: readonly CensusMember[];
  facets: ReturnType<typeof foldFacetValues>;
} {
  const byKey = new Map<string, Set<string>>();
  const observations: { path: string; value: unknown }[] = [];
  for (const tag of tags) {
    const split = splitTag({ tag });
    if (split === null) {
      continue;
    }
    const seen = byKey.get(split.key);
    if (seen === undefined) {
      byKey.set(split.key, new Set([split.value]));
    } else {
      seen.add(split.value);
    }
    if (isFacetPath({ path: split.key })) {
      observations.push({ path: split.key, value: split.value });
    }
  }
  return {
    facets: foldFacetValues({ observations }),
    members: [...byKey.entries()]
      .map(([key, values]) => ({ count: values.size, name: key }))
      .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
  };
}

/**
 * Every metric name this organisation declares.
 *
 * An entry with no readable id is dropped rather than kept under an empty name — the SDK types each entry as
 * a union whose third member is its marker for a response it could not parse, so a `type` check on one would
 * be reading a field of a value the SDK has already said it does not understand.
 *
 * @param client the shared client
 * @returns the names, or the line saying why there are none
 */
async function readMetricNames({
  client,
}: {
  client: CensusClient;
}): Promise<{ names: readonly string[]; missed: string | null }> {
  try {
    const response = await client.metrics.listTagConfigurations({ pageSize: NAME_PAGE });
    const data = presentOr({ absent: [], value: response.data });
    const names = data.flatMap((metric) => ("id" in metric && typeof metric.id === "string" ? [metric.id] : []));
    return { missed: null, names };
  } catch (error: unknown) {
    return { missed: `the metric name listing — not read: ${errorMessage({ error })}`, names: [] };
  }
}

/**
 * One metric's declared tags.
 *
 * @param client the shared client
 * @param name the metric name
 * @returns the tags, or the line saying why there are none
 */
async function readMetricTags({
  client,
  name,
}: {
  client: CensusClient;
  name: string;
}): Promise<{ tags: readonly string[]; missed: string | null }> {
  try {
    const response = await client.metrics.listTagsByMetricName({ metricName: name });
    const tags = response.data?.attributes?.tags;
    if (tags === undefined) {
      return { missed: null, tags: [] };
    }
    return { missed: null, tags };
  } catch (error: unknown) {
    return { missed: `the tags of metric ${name} — not read: ${errorMessage({ error })}`, tags: [] };
  }
}

/**
 * Build the metrics census.
 *
 * @param client the shared client
 * @param logger where progress goes, so an eleven-minute pass is not a silent one
 * @returns the rows and everything the pass could not reach
 */
export async function censusMetrics({
  client,
  logger,
}: {
  client: CensusClient;
  logger: Logger;
}): Promise<ProductCensus> {
  const listing = await readMetricNames({ client });
  const notMeasured: string[] = [];
  if (listing.missed !== null) {
    notMeasured.push(listing.missed);
  }
  logger.info({ msg: `census metrics: ${String(listing.names.length)} metric name(s), reading each one's tags` });
  const rows: CensusRow[] = [];
  for (let start = 0; start < listing.names.length; start += TAG_CONCURRENCY) {
    const slice = listing.names.slice(start, start + TAG_CONCURRENCY);
    const read = await Promise.all(slice.map((name) => readMetricTags({ client, name })));
    for (const [index, result] of read.entries()) {
      // The slice is what the index came from, so the name is present — asserted rather than defaulted,
      // because a fallback here would file one metric's tags under another metric's name.
      const name = slice[index]!;
      if (result.missed !== null) {
        notMeasured.push(result.missed);
      }
      const folded = foldMetricTags({ tags: result.tags });
      rows.push({
        count: null,
        countFrom: "none",
        envs: [],
        exemplars: 0,
        facets: folded.facets,
        firstSeenIso: null,
        identity: name,
        key: censusKey({ identity: name, product: "metrics", service: SERVICE_ABSENT }),
        label: name,
        lastSeenIso: null,
        members: folded.members,
        membersTruncated: false,
        paths: [],
        product: "metrics",
        query: `${name}{*}`,
        service: SERVICE_ABSENT,
        statuses: [],
        template: null,
      });
    }
    if ((start + TAG_CONCURRENCY) % 400 === 0) {
      logger.info({ msg: `census metrics ${String(start + TAG_CONCURRENCY)}/${String(listing.names.length)}` });
    }
  }
  return { notMeasured, rows: sortCensusRows({ rows }), services: [] };
}
