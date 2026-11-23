/**
 * The usage text of the three `write vanta` document verbs — `create-document`, `upload-evidence` and
 * `submit-document` — kept in a leaf beside `./documentRun.ts`, which imports each one back for its `--help`
 * and its usage-error tail. A leaf holds text only: no I/O, and no import of a command module.
 */

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_CREATE_DOCUMENT_USAGE =
  "usage: slopweaver write vanta create-document --title <text> --description <text>\n" +
  "       [--cadence P0D|P1D|P1W|P1M|P3M|P6M|P1Y|P2Y] [--reminder-window P0D|P1D|P1W|P1M|P3M]\n" +
  "       [--time-sensitivity MOST_RECENT|DURING_AUDIT_WINDOW] [--sensitive]\n" +
  "       [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
  "       [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Creates an evidence document in Vanta. THIS API SURFACE HAS NO UPDATE CALL: the title, description,\n" +
  "  cadence, reminder window, time sensitivity and sensitivity are settable HERE AND NOWHERE ELSE\n" +
  "  --approve    the digest printed by --dry-run, which covers that exact request. Without it the door\n" +
  "               HOLDS and nothing is sent; the refusal is recorded, and the digest is in it\n" +
  "  --dry-run    resolve and print the exact request, send nothing, touch no ledger";

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_UPLOAD_EVIDENCE_USAGE =
  "usage: slopweaver write vanta upload-evidence --document <id> --file <path>\n" +
  "       [--description <text>] [--effective-at <iso-date>]\n" +
  "       [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
  "       [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Attaches a file to an existing Vanta evidence document. The file's bytes are NEVER printed by\n" +
  "  --dry-run — only its name, media type, byte count, SHA-256 and the metadata travelling with it\n" +
  "  --approve    the digest printed by --dry-run, which covers that exact request and the file's SHA-256,\n" +
  "               so a different file under the same name stops matching\n" +
  "  --dry-run    resolve and print the exact request, send nothing, touch no ledger";

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_SUBMIT_DOCUMENT_USAGE =
  "usage: slopweaver write vanta submit-document --document <id>\n" +
  "       [--approve <digest>] [--dry-run] [--json] [--home <dir>]\n" +
  "       [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Submits an existing Vanta evidence document for review. This advances a compliance record an auditor\n" +
  "  reads, and this API surface offers no way to withdraw it\n" +
  "  --approve    the digest printed by --dry-run, which covers that exact request\n" +
  "  --dry-run    resolve and print the exact request, send nothing, touch no ledger";
