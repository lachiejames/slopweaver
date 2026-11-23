/**
 * Why this install's own knowledge domains could not be read from, or added to, its store. Its own union, per
 * `.claude/rules/error-handling.md`: a `knowledge` verb refuses on every one before it writes anything, and
 * `knowledge domains add` exits `EXIT_USAGE` on a refused addition but `EXIT_ERROR` on these.
 */
import { type ImportFileProblem, importProblemText, type StoreStepFailure } from "../store/registerImport.js";

/** The store could not be opened or a statement failed — the install's domains are UNKNOWN, never "none". */
export interface KnowledgeDomainStoreUnavailableError {
  readonly code: "KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE";
  readonly message: string;
}

/** The retired `knowledge/domains.json` exists and would not read, so its one-time import cannot happen. */
export interface KnowledgeDomainImportUnreadableError {
  readonly code: "KNOWLEDGE_DOMAIN_IMPORT_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** The retired file is not a valid install vocabulary; nothing was imported. */
export interface KnowledgeDomainImportInvalidError {
  readonly code: "KNOWLEDGE_DOMAIN_IMPORT_INVALID";
  readonly message: string;
  readonly path: string;
  readonly problems: readonly string[];
}

/** The stored rows do not make a valid install vocabulary — corrupt, never read as fewer domains. */
export interface KnowledgeDomainRowsInvalidError {
  readonly code: "KNOWLEDGE_DOMAIN_ROWS_INVALID";
  readonly message: string;
  readonly problems: readonly string[];
}

/** Another writer took one of the slugs between this add's read and its insert; nothing was written. */
export interface KnowledgeDomainAddConflictError {
  readonly code: "KNOWLEDGE_DOMAIN_ADD_CONFLICT";
  readonly message: string;
  readonly taken: readonly string[];
}

/** Every way the store half of the install vocabulary refuses. */
export type KnowledgeDomainStoreError =
  | KnowledgeDomainStoreUnavailableError
  | KnowledgeDomainImportUnreadableError
  | KnowledgeDomainImportInvalidError
  | KnowledgeDomainRowsInvalidError
  | KnowledgeDomainAddConflictError;

/** Constructors for {@link KnowledgeDomainStoreError}. The only place one is built. */
export const KnowledgeDomainStoreErrors = {
  addConflict: ({ taken }: { taken: readonly string[] }): KnowledgeDomainAddConflictError => ({
    code: "KNOWLEDGE_DOMAIN_ADD_CONFLICT",
    message:
      `another writer added ${taken.map((slug) => `"${slug}"`).join(", ")} while this add was being written, so ` +
      `nothing was written; \`slopweaver knowledge domains\` shows what stands now`,
    taken,
  }),
  importProblem: ({
    problem,
  }: {
    problem: ImportFileProblem;
  }): KnowledgeDomainImportUnreadableError | KnowledgeDomainImportInvalidError => {
    const message =
      `this install's knowledge domains moved into the store and the old file must be imported once, but ` +
      `${importProblemText({ problem })} — nothing was imported, so the install's own domains are UNKNOWN`;
    if (problem.kind === "unreadable") {
      return { code: "KNOWLEDGE_DOMAIN_IMPORT_UNREADABLE", message, path: problem.path };
    }
    return { code: "KNOWLEDGE_DOMAIN_IMPORT_INVALID", message, path: problem.path, problems: problem.problems };
  },
  rowsInvalid: ({ problems }: { problems: readonly string[] }): KnowledgeDomainRowsInvalidError => ({
    code: "KNOWLEDGE_DOMAIN_ROWS_INVALID",
    message:
      `the knowledge domains stored for this install are not a valid vocabulary — ${problems.join("; ")} — so ` +
      `no domain can be judged against them`,
    problems,
  }),
  storeUnavailable: ({ doing, reason }: StoreStepFailure): KnowledgeDomainStoreUnavailableError => ({
    code: "KNOWLEDGE_DOMAIN_STORE_UNAVAILABLE",
    message:
      `this install's knowledge domains live in the store, and the store could not ${doing}, so which domains ` +
      `it holds is UNKNOWN (\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
} as const;
