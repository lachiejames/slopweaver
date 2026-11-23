/**
 * The usage of every `slopweaver gcp` family, and nothing else.
 *
 * A LEAF on purpose, for the reason `../datadog/monitorUsage.ts` gives: `cli/manifests/gcp.ts` reads these
 * strings on every invocation, so they cannot live in a module that imports Google's auth library. Import only
 * other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

/** What every write family shares. */
const APPROVE_LINES =
  "  Every write reads first, prints each step and an approval digest, and sends NOTHING. Re-run with\n" +
  "  --approve <digest> to send exactly those steps, each recorded in the door ledger.\n";

/** The home line, last in every usage. */
const HOME_LINE = "  --home DIR   the state home whose door ledger records each step";

/** The tail of a family whose writes can change what exists. */
const WRITE_TAIL =
  APPROVE_LINES +
  '  A step that changes something that already exists also needs --edit-existing "<why>"; the reason is\n' +
  "  recorded with it.\n" +
  HOME_LINE;

/** The tail of a family whose every write only ever creates. */
const ADDITIVE_TAIL =
  APPROVE_LINES + "  A write here only ever creates or enables; one already there is NO_CHANGE (exit 3).\n" + HOME_LINE;

/** `slopweaver gcp run`'s usage. */
export const GCP_RUN_USAGE =
  "usage: slopweaver gcp run describe --project P --region R --service S [--json]\n" +
  "       slopweaver gcp run deploy --project P --region R --service S --image IMAGE\n" +
  "         [--service-account EMAIL] [--remove-env K1,K2] [--allow-unauthenticated]\n" +
  '         [--approve <digest>] [--edit-existing "<why>"] [--home DIR] [--json]\n' +
  "  describe   the service's image, service account, env names, URL, ready revision and who may invoke it\n" +
  "  deploy     create the service when it does not exist (additive); deploy a new revision when it does\n" +
  "             (edit-existing). The image must be an Artifact Registry or gcr.io path pinned by :tag or\n" +
  "             @sha256. Every other template key is carried over unchanged\n" +
  "  --remove-env           drop these env vars from the template; each must exist\n" +
  "  --allow-unauthenticated  grant roles/run.invoker to allUsers (edit-existing on an existing service)\n" +
  WRITE_TAIL;

/** `slopweaver gcp secret`'s usage. */
export const GCP_SECRET_USAGE =
  "usage: slopweaver gcp secret describe --project P --secret S [--json]\n" +
  "       slopweaver gcp secret access --project P --secret S [--version N|latest] [--to-file PATH] [--json]\n" +
  "       slopweaver gcp secret create --project P --secret S [--data-file PATH] [--approve <digest>] [--home DIR] [--json]\n" +
  "       slopweaver gcp secret add-version --project P --secret S --data-file PATH\n" +
  '         [--approve <digest>] [--edit-existing "<why>"] [--home DIR] [--json]\n' +
  "       slopweaver gcp secret disable-version --project P --secret S --version N\n" +
  '         [--approve <digest>] [--edit-existing "<why>"] [--home DIR] [--json]\n' +
  "       slopweaver gcp secret add-iam-policy-binding --project P --secret S --role ROLE --member MEMBER\n" +
  '         [--approve <digest>] [--edit-existing "<why>"] [--home DIR] [--json]\n' +
  "  describe         the secret, every version's state, and its IAM bindings — never a payload\n" +
  "  access           check the payload's CRC32C and print its length, sha256 and whether it ends in a\n" +
  "                   newline — never its bytes. --to-file writes it to a NEW 0600 file, refusing an existing path\n" +
  "  create           a new secret, automatic replication; --data-file adds its first version\n" +
  "  add-version      additive on a secret with no enabled version; edit-existing otherwise (latest moves)\n" +
  "  disable-version  always edit-existing\n" +
  "  add-iam-policy-binding  one member on top of the policy, every other grant kept (a public member is\n" +
  "                   edit-existing)\n" +
  "  The payload comes from --data-file only, never argv; its exact bytes are sent, a trailing newline included\n" +
  WRITE_TAIL;

/** `slopweaver gcp service-account`'s usage. */
export const GCP_SERVICE_ACCOUNT_USAGE =
  "usage: slopweaver gcp service-account describe --project P --email EMAIL [--json]\n" +
  "       slopweaver gcp service-account create --project P --account-id ID [--display-name N] [--description D]\n" +
  "         [--approve <digest>] [--home DIR] [--json]\n" +
  "  create   a new user-managed service account, ID@P.iam.gserviceaccount.com; it is granted nothing\n" +
  ADDITIVE_TAIL;

/** `slopweaver gcp services`'s usage. */
export const GCP_SERVICES_USAGE =
  "usage: slopweaver gcp services describe --project P --service API [--json]\n" +
  "       slopweaver gcp services enable --project P --service API [--approve <digest>] [--home DIR] [--json]\n" +
  "  API is a Google API service name, run.googleapis.com\n" +
  ADDITIVE_TAIL;

/** `slopweaver gcp artifacts`'s usage. */
export const GCP_ARTIFACTS_USAGE =
  "usage: slopweaver gcp artifacts describe --project P --region R --repository REPO [--json]\n" +
  "       slopweaver gcp artifacts create --project P --region R --repository REPO [--description D]\n" +
  "         [--approve <digest>] [--home DIR] [--json]\n" +
  "  create   a new Docker-format Artifact Registry repository\n" +
  ADDITIVE_TAIL;
