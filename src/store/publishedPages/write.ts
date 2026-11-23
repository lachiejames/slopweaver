/**
 * Write ONE page's publish, or ONE key's freeze, into the store — the only place either is kept (stage 6 of
 * `docs/store/published-pages.md`). The plan is `./writePlan.ts`'s; the write is `./importStore.ts`'s, so a page
 * published here and one imported from the folders are the same rows.
 *
 * ## What a failure leaves, and why a re-run converges
 *
 * Held bodies are checked first, then every new body is uploaded to its content-addressed key, then ONE transaction
 * takes the page's lock and writes every row. A refusal writes nothing; a failure between the upload and the rows
 * leaves an object no row names, which a re-run uploads again to the same key and records. A connection that fails to
 * CLOSE after the rows committed is an error too (`../withConnection.ts`), so a failure means unconfirmed, not absent:
 * the same publish or freeze run again keeps the held version and lands the rest.
 *
 * ## The store never moves backwards
 *
 * The transaction refuses a publish or freeze when the store already holds a later freeze of its key, or other bytes
 * frozen at the same instant (`./importRows.ts` § `laterFreezeHeld`, `PAGES_PUBLISH_SUPERSEDED`), and a version
 * already held is never rewritten, so its `origin` and `first_frozen_at` survive every re-run.
 */
import type { Result } from "#lib/result.js";

import { connectStore, type StoreClient } from "../client.js";
import type { ObjectStore } from "../objects/client.js";
import type { ObjectStoreError } from "../objects/errors.js";
import { withStoreConnection } from "../withConnection.js";
import type { PublishedPagesWriteContext } from "./importPlan.js";
import { importPublishedPages, type PublishedPagesWriteCounts, publishedPageObjects } from "./importStore.js";
import { type PublishedPageWriteError, PublishedPageWriteErrors } from "./writeErrors.js";
import type { PublishedPageWrite } from "./writePlan.js";

type WriteResult<T> = Result<T, readonly PublishedPageWriteError[]>;

/**
 * The write context a planned publish or freeze is written under.
 *
 * @param write the planned write
 * @param importedAt dates any version the write plans that is not its own
 * @returns the context
 */
function contextOf({ write, importedAt }: { write: PublishedPageWrite; importedAt: Date }): PublishedPagesWriteContext {
  if (write.kind === "publish") {
    return { importedAt, kind: "publish", published: write.published };
  }
  return { importedAt, kind: "freeze", opensHistory: write.opensHistory, published: write.published };
}

/**
 * Write a planned publish or freeze over an open connection.
 *
 * @param client an open store connection
 * @param objects opens the bucket — called only when a body is not yet held
 * @param write what `pageWrite` or `freezeWrite` planned
 * @param importedAt dates any version the write plans that is not its own
 * @returns what changed, or every refusal
 */
export async function writePublishedPage({
  client,
  objects,
  write,
  importedAt,
}: {
  client: StoreClient;
  objects: () => Result<ObjectStore, ObjectStoreError>;
  write: PublishedPageWrite;
  importedAt: Date;
}): Promise<WriteResult<PublishedPagesWriteCounts>> {
  return importPublishedPages({ client, context: contextOf({ importedAt, write }), objects, plan: write.plan });
}

/**
 * Write a planned publish or freeze into a home's store, over one connection that is always closed.
 *
 * @param home the home whose store it is written into
 * @param write what `pageWrite` or `freezeWrite` planned
 * @param importedAt dates any version the write plans that is not its own
 * @returns what changed, or every refusal
 */
export async function storePublishedPage({
  home,
  write,
  importedAt,
}: {
  home: string;
  write: PublishedPageWrite;
  importedAt: Date;
}): Promise<WriteResult<PublishedPagesWriteCounts>> {
  return withStoreConnection<StoreClient, PublishedPagesWriteCounts, readonly PublishedPageWriteError[]>({
    body: (client) => writePublishedPage({ client, importedAt, objects: () => publishedPageObjects(), write }),
    connect: async () => (await connectStore({ home, max: 1 })).mapErr((error) => [error]),
    unavailable: ({ cause, doing }) => [PublishedPageWriteErrors.storeUnavailable({ cause, doing })],
  });
}
