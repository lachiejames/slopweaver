/**
 * The failures a publish meets that are not its page's own files (`./pageAssetErrors.ts`): an instant the store could
 * never read back, and a store write that failed or could not be confirmed. A publish writes nothing on disk (stage 6
 * of `docs/store/published-pages.md`), so none of these names a file left behind.
 */

/** The instant a freeze would be stamped with is no ISO-8601 datetime, so the store could never read it back. */
interface PageInstantInvalidError {
  readonly code: "PAGE_INSTANT_INVALID";
  readonly message: string;
  readonly nowIso: string;
}

/** The store write failed, or committed and then could not be confirmed. */
interface PageStoreUnconfirmedError {
  readonly code: "PAGE_STORE_UNCONFIRMED";
  readonly message: string;
  readonly slug: string;
}

/** Builds each way a publish fails outside its page's files. */
export const PagePublishErrors = {
  instantInvalid: ({ nowIso }: { nowIso: string }): PageInstantInvalidError => ({
    code: "PAGE_INSTANT_INVALID",
    message:
      `"${nowIso}" is not an ISO-8601 datetime with an offset, and a freeze stamped with it is one the store can ` +
      "never read back; nothing was written",
    nowIso,
  }),
  storeUnconfirmed: ({ slug }: { slug: string }): PageStoreUnconfirmedError => ({
    code: "PAGE_STORE_UNCONFIRMED",
    message:
      `writing ${slug} into the store failed or could not be confirmed, so the publish did not complete and the ` +
      "page has no address yet. Re-run the same publish to complete it.",
    slug,
  }),
} as const;
