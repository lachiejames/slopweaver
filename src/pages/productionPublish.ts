/**
 * The publisher every verb injects in production: `publishPage` bound to the store write. It is its own file because
 * `../store/publishedPages/writePlan.ts` imports `pagePath` from `./publish.ts`, so the store write cannot be
 * imported there without a cycle.
 */
import { err, ok } from "../lib/result.js";
import { storePublishedPage } from "../store/publishedPages/write.js";
import { pageWrite } from "../store/publishedPages/writePlan.js";
import { type PagePublisher, type PageStoreWriter, publishPage } from "./publish.js";

/** Writes one page into the store, flattening each refusal to the message a caller prints. */
const storeWriter: PageStoreWriter = async ({ home, slug, document, assets, frozenAt, importedAt }) => {
  const planned = pageWrite({ assets, document, frozenAt, home, slug });
  if (planned.isErr()) {
    return err(planned.error.map((error) => error.message));
  }
  const written = await storePublishedPage({ home, importedAt, write: planned.value });
  if (written.isErr()) {
    return err(written.error.map((error) => error.message));
  }
  return ok(undefined);
};

/**
 * Publish one page into the store, its only copy.
 *
 * @param request the page to publish
 * @returns its identity and what was frozen, or every reason it is not published
 */
export const productionPublishPage: PagePublisher = (request) => publishPage({ ...request, write: storeWriter });
