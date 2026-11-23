/**
 * The id maps an ingest run carries and the per-batch resolution that fills them: every container a batch names is
 * upserted once, and every person's platform ids are read once per run, so an author resolves with no round trip.
 * `./ingest.ts` writes the batch with them; this module imports nothing back from there.
 */
import { sql } from "drizzle-orm";

import type { StoreClient, StoreWriter } from "./client.js";
import type { ProjectedRecord } from "./project.js";
import { containerTable } from "./schema/container.js";
import { isPersonResolvableSource, PERSON_COLUMN_BY_SOURCE, personTable } from "./schema/person.js";

/**
 * The container ids a run has resolved, so a channel seen in a thousand rows is upserted once.
 *
 * ## Why only {@link ContainerIds.resolve} can fill it
 *
 * A content row's data class is sorted on its record's container, and its `container_id` is read from here. A map a
 * caller could fill would let a row be stored against one container while classed from another — classed `public`
 * on a public channel's rules and filed under a private one. So the map is a private field, and its only writer
 * records the rows the database itself returned, each under that row's OWN `(source, native_id)`, never under the
 * key that was asked for.
 */
export class ContainerIds {
  readonly #ids = new Map<string, string>();

  /**
   * How many containers this run has resolved.
   *
   * @returns the count of distinct containers held
   */
  size(): number {
    return this.#ids.size;
  }

  /**
   * The stored id of one container, when this run has resolved it.
   *
   * @param container the `(source, native id)` pair a record names
   * @returns the container row's id, or `undefined` when it has not been resolved
   */
  idFor({ container }: { container: { readonly source: string; readonly nativeId: string } }): string | undefined {
    return this.#ids.get(cacheKey({ nativeId: container.nativeId, source: container.source }));
  }

  /**
   * Upsert every container in a batch this run has not resolved yet, and record the ids the database returns.
   *
   * `on conflict do update` rather than `do nothing`, because `do nothing` returns no row for a container that
   * already exists and its id would then cost a second round trip. Setting `name` to the excluded value is the
   * cheapest way to make every row eligible for `returning`.
   *
   * @param writer the transaction the batch is being written in
   * @param batch the projected records whose containers are needed
   */
  async resolve({ writer, batch }: { writer: StoreWriter; batch: readonly ProjectedRecord[] }): Promise<void> {
    const wanted = new Map<string, ProjectedRecord["container"]>();
    for (const record of batch) {
      const key = cacheKey({ nativeId: record.container.nativeId, source: record.container.source });
      if (!this.#ids.has(key)) {
        wanted.set(key, record.container);
      }
    }
    if (wanted.size === 0) {
      return;
    }
    const rows = await writer
      .insert(containerTable)
      .values([...wanted.values()])
      .onConflictDoUpdate({
        set: { name: sql`excluded.name` },
        target: [containerTable.source, containerTable.nativeId],
      })
      .returning({ id: containerTable.id, nativeId: containerTable.nativeId, source: containerTable.source });
    for (const row of rows) {
      this.#ids.set(cacheKey({ nativeId: row.nativeId, source: row.source }), row.id);
    }
  }
}

/**
 * The id maps a run carries, so neither a container nor a person costs a round trip per row.
 *
 * `containers` is filled only from the database's own answers — see {@link ContainerIds}.
 * `people` is the whole person table's platform ids, loaded once at the start of a run and READ ONLY:
 * ingest never writes a person (the directory is the one source). A key that is not
 * in the map is an author the store cannot name yet, and the row keeps that author on
 * `author_native_id` so `store identity` can point it at a person the day the directory holds one.
 * `resolved` and `unresolved` count keys, once each.
 */
export interface IdCache {
  readonly containers: ContainerIds;
  readonly people: Map<string, string>;
  readonly resolved: Set<string>;
  readonly unresolved: Set<string>;
}

/**
 * The key a container or a person is cached under.
 *
 * Keyed by source as well as native id, because two sources may name a place or a handle the same thing
 * and the store's own unique index is over the pair.
 *
 * @returns the cache key
 */
export function cacheKey({ source, nativeId }: { source: string; nativeId: string }): string {
  return `${source} ${nativeId}`;
}

/**
 * Load every person's platform ids, once, so an author resolves with no round trip.
 *
 * GitHub logins are keyed lower-cased because GitHub treats them case-insensitively and a record may carry
 * either spelling; a Linear author is keyed by id AND by @-handle, because older captures carry only the
 * handle; every other id is exact.
 *
 * @param client the open store
 * @returns `(source, native id)` to person id, for every id column that is set
 */
export async function loadPeopleIndex({ client }: { client: StoreClient }): Promise<Map<string, string>> {
  const rows = await client.db
    .select({
      githubLogin: personTable.githubLogin,
      id: personTable.id,
      linearDisplayName: personTable.linearDisplayName,
      linearUserId: personTable.linearUserId,
      notionUserId: personTable.notionUserId,
      slackUserId: personTable.slackUserId,
    })
    .from(personTable);
  const index = new Map<string, string>();
  for (const row of rows) {
    if (row.slackUserId !== null) {
      index.set(cacheKey({ nativeId: row.slackUserId, source: "slack" }), row.id);
    }
    if (row.linearUserId !== null) {
      index.set(cacheKey({ nativeId: row.linearUserId, source: "linear" }), row.id);
    }
    if (row.linearDisplayName !== null) {
      index.set(cacheKey({ nativeId: row.linearDisplayName, source: "linear" }), row.id);
    }
    if (row.notionUserId !== null) {
      index.set(cacheKey({ nativeId: row.notionUserId, source: "notion" }), row.id);
    }
    if (row.githubLogin !== null) {
      index.set(cacheKey({ nativeId: row.githubLogin.toLowerCase(), source: "github" }), row.id);
    }
  }
  return index;
}

/**
 * The person a record's author resolves to, or `null` when the store cannot name them.
 *
 * A miss is counted once per `(source, id)` and is not a failure: the row keeps the platform's own author
 * id, and a person who joins the directory later is pointed at by `store identity`, never by a re-ingest.
 *
 * @param author the projected author, already known to be present
 * @param source the record's source
 * @param cache the run's id maps
 * @returns the person id, or `null`
 */
export function personFor({
  author,
  source,
  cache,
}: {
  author: NonNullable<ProjectedRecord["author"]>;
  source: string;
  cache: IdCache;
}): string | null {
  if (!isPersonResolvableSource(source)) {
    return null;
  }
  const nativeId = PERSON_COLUMN_BY_SOURCE[source] === "githubLogin" ? author.nativeId.toLowerCase() : author.nativeId;
  const key = cacheKey({ nativeId, source });
  const id = cache.people.get(key);
  if (id === undefined) {
    cache.unresolved.add(key);
    return null;
  }
  cache.resolved.add(key);
  return id;
}
