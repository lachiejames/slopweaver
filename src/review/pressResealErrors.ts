/**
 * Why `slopweaver github press-reseal` would not re-key the press register. Its own union, per
 * `.claude/rules/error-handling.md`: the reseal is a repair verb over the press register, and every one of these is
 * a reason it left the register exactly as it found it — bar {@link PressResealReceiptUnwritableError}, which is the
 * one refusal that arrives AFTER the transaction committed, and says so.
 */
import type { StoreStepFailure } from "../store/registerImport.js";

/** The store could not be opened or a statement failed; nothing was re-keyed. */
export interface PressResealStoreUnavailableError {
  readonly code: "RESEAL_STORE_UNAVAILABLE";
  readonly message: string;
}

/** A stored row does not decode as a press at all, so no key can be computed for it. */
export interface PressResealRecordInvalidError {
  readonly code: "RESEAL_RECORD_INVALID";
  readonly message: string;
  readonly pressKey: string;
}

/** A row needing a new key belongs to a repository the caller did not name with `--repo`. */
export interface PressResealRepoNotNamedError {
  readonly code: "RESEAL_REPO_NOT_NAMED";
  readonly message: string;
  readonly repos: readonly string[];
}

/** Two rows would end up under one key — a duplicate press, or a key another row already holds. */
export interface PressResealKeyCollisionError {
  readonly code: "RESEAL_KEY_COLLISION";
  readonly message: string;
  readonly newKey: string;
  readonly oldKeys: readonly string[];
}

/** The register's rows are not the ones the preview digested: something wrote between preview and apply. */
export interface PressResealSourceMovedError {
  readonly code: "RESEAL_SOURCE_MOVED";
  readonly message: string;
  readonly expected: string;
  readonly observed: string;
}

/** An update found its row no longer under the old key, inside the transaction. */
export interface PressResealRowMovedError {
  readonly code: "RESEAL_ROW_MOVED";
  readonly message: string;
  readonly oldKey: string;
}

/** After the re-key the register still would not decode through the ordinary strict reader. */
export interface PressResealReadbackUnsoundError {
  readonly code: "RESEAL_READBACK_UNSOUND";
  readonly message: string;
}

/** The re-key COMMITTED and its receipt could not be journalled. */
export interface PressResealReceiptUnwritableError {
  readonly code: "RESEAL_RECEIPT_UNWRITABLE";
  readonly message: string;
  readonly path: string;
}

/** Every way the reseal refuses. */
export type PressResealError =
  | PressResealStoreUnavailableError
  | PressResealRecordInvalidError
  | PressResealRepoNotNamedError
  | PressResealKeyCollisionError
  | PressResealSourceMovedError
  | PressResealRowMovedError
  | PressResealReadbackUnsoundError
  | PressResealReceiptUnwritableError;

/** Constructors for {@link PressResealError}. */
export const PressResealErrors = {
  keyCollision: ({
    newKey,
    oldKeys,
  }: {
    newKey: string;
    oldKeys: readonly string[];
  }): PressResealKeyCollisionError => ({
    code: "RESEAL_KEY_COLLISION",
    message:
      `re-keying would put ${String(oldKeys.length)} rows (${oldKeys.join(", ")}) under one key ${newKey} — ` +
      "a duplicate press or a key another row already holds; nothing was re-keyed, so read those rows by hand",
    newKey,
    oldKeys,
  }),
  readbackUnsound: ({ reason }: { reason: string }): PressResealReadbackUnsoundError => ({
    code: "RESEAL_READBACK_UNSOUND",
    message: `after re-keying, the press register still would not read (${reason}), so the transaction was rolled back`,
  }),
  receiptUnwritable: ({ path, cause }: { path: string; cause: unknown }): PressResealReceiptUnwritableError => ({
    code: "RESEAL_RECEIPT_UNWRITABLE",
    message:
      `the re-key COMMITTED, and its receipt could not be appended to ${path}: ${String(cause)} — ` +
      "the register is repaired; record what the preview printed by hand",
    path,
  }),
  recordInvalid: ({ pressKey, reason }: { pressKey: string; reason: string }): PressResealRecordInvalidError => ({
    code: "RESEAL_RECORD_INVALID",
    message: `the stored press ${pressKey} ${reason}, so no key can be computed for it and nothing was re-keyed`,
    pressKey,
  }),
  repoNotNamed: ({ repos }: { repos: readonly string[] }): PressResealRepoNotNamedError => ({
    code: "RESEAL_REPO_NOT_NAMED",
    message:
      `rows of ${repos.join(", ")} are stored under keys their fields do not hash to and were not named with ` +
      "--repo; re-keying only the named repositories would leave the register unreadable, so nothing was re-keyed",
    repos,
  }),
  rowMoved: ({ oldKey }: { oldKey: string }): PressResealRowMovedError => ({
    code: "RESEAL_ROW_MOVED",
    message: `the row under ${oldKey} was gone when its update ran, so the transaction was rolled back`,
    oldKey,
  }),
  sourceMoved: ({ expected, observed }: { expected: string; observed: string }): PressResealSourceMovedError => ({
    code: "RESEAL_SOURCE_MOVED",
    expected,
    message:
      `the press register now digests to ${observed}, not the previewed ${expected} — it moved since the ` +
      "preview, so nothing was re-keyed; preview again",
    observed,
  }),
  storeUnavailable: ({ doing, reason }: StoreStepFailure): PressResealStoreUnavailableError => ({
    code: "RESEAL_STORE_UNAVAILABLE",
    message:
      `the press register lives in the store, and the store could not ${doing}, so nothing was re-keyed ` +
      `(\`slopweaver store status\` says what the store is doing). The store said: ${reason}`,
  }),
} as const;
