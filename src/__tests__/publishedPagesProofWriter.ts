/**
 * The production store write over a proof database and bucket, for the integration lane's published-pages proofs.
 * `storePublishedPage` resolves its store from the home's config; these take the proof URL and bucket instead, so the
 * live store and the real bucket are never touched, and they run the same plan and the same write it does.
 */
import { err, ok, type Result } from "../lib/result.js";
import type { PageStoreWriter } from "../pages/publish.js";
import { openStore, type StoreClient } from "../store/client.js";
import type { ObjectStore } from "../store/objects/client.js";
import type { ObjectStoreError } from "../store/objects/errors.js";
import type { PublishedPagesWriteCounts } from "../store/publishedPages/importStore.js";
import { writePublishedPage } from "../store/publishedPages/write.js";
import { type PublishedPageWriteError, PublishedPageWriteErrors } from "../store/publishedPages/writeErrors.js";
import { type PublishedPageWrite, pageWrite } from "../store/publishedPages/writePlan.js";
import { withStoreConnection } from "../store/withConnection.js";

/** Opens the proof bucket. */
type ProofObjects = () => Result<ObjectStore, ObjectStoreError>;

/**
 * Write one planned publish or freeze over a fresh connection to `url`, closed afterwards, as `storePublishedPage`
 * does over the home's store.
 *
 * @param url the proof database, or one nothing listens on to stand for the store being down
 * @param objects opens the proof bucket
 * @param write what `pageWrite` or `freezeWrite` planned
 * @param importedAt dates any version the write plans that is not its own
 * @returns what changed, or every refusal
 */
async function proofWrite({
  url,
  objects,
  write,
  importedAt,
}: {
  url: string;
  objects: ProofObjects;
  write: PublishedPageWrite;
  importedAt: Date;
}): Promise<Result<PublishedPagesWriteCounts, readonly PublishedPageWriteError[]>> {
  return withStoreConnection<StoreClient, PublishedPagesWriteCounts, readonly PublishedPageWriteError[]>({
    body: (client) => writePublishedPage({ client, importedAt, objects, write }),
    connect: async () => ok(openStore({ url })),
    unavailable: ({ cause, doing }) => [PublishedPageWriteErrors.storeUnavailable({ cause, doing })],
  });
}

/**
 * The production page writer over the proof store, keeping each write's counts.
 *
 * @param url the proof database
 * @param objects opens the proof bucket
 * @param counts where each successful write's counts are appended
 * @returns the writer a publish is handed
 */
export function proofPageWriter({
  url,
  objects,
  counts,
}: {
  url: string;
  objects: ProofObjects;
  counts: PublishedPagesWriteCounts[];
}): PageStoreWriter {
  return async ({ home, slug, document, assets, frozenAt, importedAt }) => {
    const planned = pageWrite({ assets, document, frozenAt, home, slug });
    if (planned.isErr()) {
      return err(planned.error.map((error) => error.message));
    }
    const written = await proofWrite({ importedAt, objects, url, write: planned.value });
    if (written.isErr()) {
      return err(written.error.map((error) => error.message));
    }
    counts.push(written.value);
    return ok(undefined);
  };
}

/**
 * A writer that plans each page as production would and keeps the plan unwritten, so a proof can write it later —
 * a publish whose checks passed before another one landed.
 *
 * @returns the writer and the plans it kept
 */
export function pausedPageWriter(): { readonly writer: PageStoreWriter; readonly paused: PublishedPageWrite[] } {
  const paused: PublishedPageWrite[] = [];
  return {
    paused,
    writer: async ({ home, slug, document, assets, frozenAt }) => {
      const planned = pageWrite({ assets, document, frozenAt, home, slug });
      if (planned.isErr()) {
        return err(planned.error.map((error) => error.message));
      }
      paused.push(planned.value);
      return ok(undefined);
    },
  };
}
