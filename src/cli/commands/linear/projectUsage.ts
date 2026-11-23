/**
 * The `linear project` usage string — a leaf the manifest barrel may load (see `../../manifests/linear.ts`).
 */

export const LINEAR_PROJECT_USAGE =
  "usage: slopweaver linear project <create|update> --form <json|-> [--project-id <uuid>] [--dry-run] " +
  "[--json] [--home <dir>]\n" +
  "  create      file a new project; the project id is DERIVED from the intent, so a retry after a lost\n" +
  "              response reuses it instead of filing a second project\n" +
  "  update      replace the fields from the form you supply; only projects slopweaver created\n" +
  "  --dry-run   print the exact resolved fields and perform no effect";
