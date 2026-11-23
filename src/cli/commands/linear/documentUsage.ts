/**
 * The `linear document` usage string — a leaf the manifest barrel may load (see `../../manifests/linearDocument.ts`).
 */

export const LINEAR_DOCUMENT_USAGE =
  "usage: slopweaver linear document <create|update> --form <json|-> [--document-id <uuid>] " +
  "[--mention-id <key=id,...>] [--dry-run] [--home <dir>]\n" +
  "  create        create one document on a project, initiative, issue or team; the id is DERIVED from the\n" +
  "                form, so a retry after a lost response reuses it instead of creating a second page\n" +
  "  update        re-render the title and content of a document slopweaver created; refused if the page\n" +
  "                was edited since it last wrote, or if the form names a different destination\n" +
  "  --document-id update only: the id `create` printed\n" +
  "  --mention-id  key=<linear-user-id> pairs, comma-separated: address an `@{key}` in the page by an id\n" +
  "                you verified live, for a key the identity roster cannot resolve\n" +
  "  --dry-run     print the exact content bytes and the destination, and perform no effect";
