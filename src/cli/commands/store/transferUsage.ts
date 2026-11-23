/**
 * The usage text the store transfer verbs print for `--help` and beside a refusal. A leaf, so the runners
 * and their argument parsers share one copy.
 */

/** `store export`. */
export const STORE_EXPORT_USAGE =
  "usage: slopweaver store export --out <dir> [--home <dir>] [--json]\n" +
  "  Writes the installation's owned state — the knowledge register and its recalls, the owner profile and\n" +
  "  voice register, the owner directives, standing asks and steer verdicts — into a NEW private directory\n" +
  "  with a manifest naming every part's rows, bytes and sha256. Refuses a target that exists.";

/** `store import`. */
export const STORE_IMPORT_USAGE =
  "usage: slopweaver store import --from <dir> [--approve <sha256:digest>] [--unmanifested] [--home <dir>] [--json]\n" +
  "       slopweaver store import --apply <batch-id> [--stop-on-conflict] [--home <dir>] [--json]\n" +
  "  Checks an export — the manifest, every part's bytes and hash, every row against its own domain's\n" +
  "  schema — then plans it against the live store: each part's rows counted new, identical or\n" +
  "  conflicting, and a question for every restored instruction (directive, correction, standing ask)\n" +
  "  the store does not already hold, and for every row that disagrees with what the store holds now.\n" +
  "  Prints the content digest and a plan digest, and writes nothing. --approve <plan digest> stages the\n" +
  "  export in the store — every row and every question, in one transaction — once the plan it makes now\n" +
  "  carries exactly that digest; staging the same export again writes nothing. Nothing staged is live.\n" +
  "  --unmanifested reads an export made before manifests, at the part file names only; a part it does\n" +
  "  not hold is reported unavailable, never as empty.\n" +
  "  --apply <batch-id> applies a staged batch once every activation and conflict question is answered (an\n" +
  "  alignment is reported, never waited on): the batch in ONE transaction with a receipt, or none of it;\n" +
  "  the batch's receipt is looked for first, and a batch already applied is reported with nothing run;\n" +
  "  otherwise each register's legacy home file is imported first in its own transaction, as before an\n" +
  "  export, and stands, never counted in the writes reported. A restored instruction left inactive is\n" +
  "  written inactive. An\n" +
  "  append-only row that differs from the one the store holds keeps the current row and is reported, one\n" +
  "  not yet acknowledged with the command that acknowledges it; --stop-on-conflict refuses the whole apply on any.\n" +
  "  A commit whose outcome the server did not settle is reported unknown, never as nothing written, with the\n" +
  "  same --apply to run again, --stop-on-conflict kept: it reports the batch already applied if the commit stood, and\n" +
  "  otherwise tries it again.\n" +
  "  Every command printed to paste names the home this run used, never the store's connection string; SLOPWEAVER_STORE_URL wins\n" +
  "  over any home, so paste one where that variable is as it was for this run: unset if it was unset, the same URL if\n" +
  "  it was set, which the apply then says under the commands it printed.";

/** `store import-resolve`. */
export const STORE_IMPORT_RESOLVE_USAGE =
  "usage: slopweaver store import-resolve --question <import-q-id> --action <answer> [--home <dir>] [--json]\n" +
  "  Records the owner's answer to one staged import question: activate or leave-inactive for a restored\n" +
  "  instruction, keep-current or take-imported for a row that disagrees with the store, keep-current for an\n" +
  "  append-only difference an apply reported. An answer is never changed: the same one again writes\n" +
  "  nothing, and a different one is refused. `store import --apply` writes what the answers admit.";

/** `store import-questions`. */
export const STORE_IMPORT_QUESTIONS_USAGE =
  "usage: slopweaver store import-questions [--home <dir>] [--json]\n" +
  "  Lists every staged import question nobody has answered yet, oldest batch first, each with the answers\n" +
  "  it takes. Writes nothing.";
