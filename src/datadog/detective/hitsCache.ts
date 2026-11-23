/**
 * The local cache of Datadog events this install has already pulled down. The effectful edge.
 *
 * ## It exists because Datadog has no get-by-id route
 *
 * MEASURED on this install's site: taking a real event id out of
 * `GET /api/v2/logs/events?filter[query]=*&page[limit]=1` and asking for it directly —
 * `slopweaver datadog raw --path /api/v2/logs/events/<that id>` — returns HTTP 404
 * `{"errors":["Not found"]}`. The search endpoints cannot filter on an event id either, so there is no
 * query that means "this one event".
 *
 * The disclosure ladder is the thing that needs it: `hits` narrows to a page, `peek` windows one record,
 * `open` reads it whole, `around` reads its neighbours — four verbs in four PROCESSES, each given an id by
 * the one before. Without somewhere to put the event, every verb after `hits` would have to re-run the
 * search that found it and hope the ranking had not moved.
 *
 * ## A cache of what was read, never a store of Datadog
 *
 * Nothing lands here that a verb did not just fetch on the caller's own instruction, and nothing is
 * PRE-fetched. That is what keeps it on the right side of "store an event row" — the one thing this design
 * says it will never do. The distinction is not a technicality: the shape catalogue is built on a schedule
 * and kept forever, while this file holds the handful of events a detective actually opened and is safe to
 * delete at any moment. A miss says so and names the verb that fills it, rather than inventing a record.
 *
 * ## Append-only, newest wins
 *
 * One line per event, appended. A re-fetch of the same id appends a second line and the reader keeps the
 * LAST, so a record read twice reflects the second read. Compaction is deliberately absent: the file grows
 * by the events a person asked for, which is hundreds rather than millions, and a compaction pass would be
 * a second mechanism guarding a bound nothing has approached.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { readJsonlLines } from "../../corpus/corpusStore.js";
import { appendLines } from "../../lib/appendSeparator.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";
import type { DatadogRecord } from "./record.js";
import { datadogRecordSchema } from "./schema.js";

/**
 * Append every record a verb just fetched.
 *
 * @param home the Slopweaver home
 * @param records what was fetched, in any order
 */
export function cacheRecords({ home, records }: { home: string; records: readonly DatadogRecord[] }): void {
  if (records.length === 0) {
    return;
  }
  const path = stateHomePaths({ home }).datadogHits;
  mkdirSync(dirname(path), { recursive: true });
  appendLines({
    path,
    text: records.map((record) => `${safeJsonStringify({ label: "datadog hit", value: record })}\n`).join(""),
  });
}

/**
 * Read the named records back out of the cache.
 *
 * The whole file is streamed rather than indexed, because the ids a caller asks for are a handful and the
 * file holds what a person opened — so an index would be a second structure to keep in step with a file
 * whose scan is already milliseconds.
 *
 * @param home the Slopweaver home
 * @param ids the `dd:` ids to read
 * @returns the records found, keyed by id; an id with no entry is simply absent
 */
export function readCachedRecords({
  home,
  ids,
}: {
  home: string;
  ids: readonly string[];
}): ReadonlyMap<string, DatadogRecord> {
  const path = stateHomePaths({ home }).datadogHits;
  const wanted = new Set(ids);
  const found = new Map<string, DatadogRecord>();
  if (!existsSync(path) || wanted.size === 0) {
    return found;
  }
  readJsonlLines({
    onLine: ({ line }) => {
      if (line.trim().length === 0) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = safeJsonParse({ label: "datadog hit", text: line });
      } catch {
        // A malformed line is skipped rather than fatal, which is the opposite of the catalogue's rule and
        // for the opposite reason: a catalogue decides whether to look at all, so a short one misleads,
        // while this file only ever answers "do you already have this id" and a missing answer is handled.
        return;
      }
      const record = datadogRecordSchema.safeParse(parsed);
      if (record.success && wanted.has(record.data.id)) {
        found.set(record.data.id, record.data);
      }
    },
    path,
  });
  return found;
}
