/**
 * `store pages-import`'s usage — a usage leaf, so the manifest (`../../manifests/storeProjectionMeta.ts`) and the
 * verb (`./pagesImportRun.ts`) quote one declaration.
 */

/** The usage text, quoted by the manifest and printed by the verb. */
export const PAGES_IMPORT_USAGE =
  "usage: slopweaver store pages-import [--dry-run] [--home <dir>] [--json]\n" +
  "  Carries every published page (pages/<slug>/, every file under it) and every frozen version\n" +
  "  (published-pages/<key>/) into the store, each body an object in the private published-pages bucket.\n" +
  "  Reads both folders and never changes either. Any link, odd entry, unsafe name or bad freeze refuses the\n" +
  "  whole run, every one named, before anything is uploaded or written.\n" +
  "  Re-runnable: the store is made to match each page the folders hold, versions are only ever added, and a\n" +
  "  stored page the folders no longer hold is left as it is and reported.\n" +
  "  --dry-run reads and checks both folders without opening a connection, so it cannot count store-only pages.";
