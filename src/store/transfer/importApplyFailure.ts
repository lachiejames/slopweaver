/**
 * What a thrown apply transaction means for its batch, decided from where it threw and whether the server answered.
 *
 * A throw before the transaction's body returned rolled it back, so none of the batch's rows was written. A throw
 * after the body returned came from COMMIT itself: when the server answered with an SQLSTATE meaning rollback it
 * refused the commit and nothing stands, but when no answer arrived (a dropped connection, a reset socket), or the
 * answer does not settle the outcome (`08007`, a shutdown), the commit may have stood. That case is said to be
 * unknown rather than called a refusal:
 * running the apply again finds a committed batch's receipt and reports it already applied, and otherwise tries the batch
 * again. Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  type ImportApplicationFailedError,
  type ImportCommitUnconfirmedError,
  StoreImportApplyErrors,
} from "./importApplyErrors.js";

/** An SQLSTATE: five digits or capitals, the code a Postgres server answers an error with. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * The SQLSTATE classes whose every code, answering COMMIT, means the server refused it and rolled the transaction
 * back: data exception (22), integrity constraint violation (23, a deferred constraint) and a PL/pgSQL raise (P0, a
 * deferred trigger).
 */
const ROLLED_BACK_CLASSES: ReadonlySet<string> = new Set(["22", "23", "P0"]);

/**
 * The single codes of a mixed class that mean rollback: class 40's own `40000` "transaction rollback", serialization
 * failure, integrity constraint violation and deadlock — never its `40003` "statement completion unknown". Every other
 * code is read as unknown — connection exception (08, `08007` is "transaction resolution unknown" itself), operator
 * intervention (57), resources (53) and invalid transaction state (25) among them — so the classifier errs toward
 * claiming less.
 */
const ROLLED_BACK_CODES: ReadonlySet<string> = new Set(["40000", "40001", "40002", "40P01"]);

/** The innermost message of a thrown chain: the driver's own reason, under drizzle's "Failed query". */
function innermostMessage({ cause }: { cause: unknown }): string {
  let innermost = cause;
  while (innermost instanceof Error && innermost.cause instanceof Error) {
    innermost = innermost.cause;
  }
  return innermost instanceof Error ? innermost.message : String(innermost);
}

/**
 * Whether one link of a thrown chain is an error the server itself sent refusing the transaction: an SQLSTATE beside
 * a severity, in a class that means rollback.
 */
function refusalSent({ link }: { link: Error }): boolean {
  if (!("severity" in link) || !("code" in link)) {
    return false;
  }
  const { code, severity } = link;
  if (typeof severity !== "string" || typeof code !== "string" || !SQLSTATE.test(code)) {
    return false;
  }
  return ROLLED_BACK_CLASSES.has(code.slice(0, 2)) || ROLLED_BACK_CODES.has(code);
}

/**
 * Whether anywhere in a thrown chain the Postgres server refused the transaction, so it certainly did not stand.
 *
 * @returns true when some link carries the server's SQLSTATE in a rollback class, false for a client-side failure or
 *   any code whose outcome the server does not settle
 */
export function commitRefused({ cause }: { cause: unknown }): boolean {
  let link = cause;
  while (link instanceof Error) {
    if (refusalSent({ link })) {
      return true;
    }
    link = link.cause;
  }
  return false;
}

/**
 * The refusal for an apply transaction that threw anything other than the apply's own rollback.
 *
 * @param bodyFinished whether the transaction's body had returned, so the throw came from COMMIT
 * @returns `IMPORT_APPLICATION_FAILED` when the transaction certainly rolled back, or `IMPORT_COMMIT_UNCONFIRMED`
 *   when the commit went unanswered, or was answered with a code that does not say it rolled back, and may have stood
 */
export function applyTransactionFailure({
  batchId,
  cause,
  bodyFinished,
}: {
  batchId: string;
  cause: unknown;
  bodyFinished: boolean;
}): ImportApplicationFailedError | ImportCommitUnconfirmedError {
  const why = innermostMessage({ cause });
  if (!bodyFinished) {
    return StoreImportApplyErrors.applicationFailed({ batchId, register: "the store", why });
  }
  if (commitRefused({ cause })) {
    return StoreImportApplyErrors.applicationFailed({ batchId, register: "the store's commit", why });
  }
  return StoreImportApplyErrors.commitUnconfirmed({ batchId, why });
}

/**
 * What a thrown apply transaction settles to, given what its body returned, if it returned at all. A body that found
 * the batch already applied wrote none of the batch, and the receipt it found was committed by another transaction (a concurrent
 * apply's, perhaps after this one began) and only read by this one, so a COMMIT that then throws changes nothing: the
 * batch stands applied whatever the server answered, and saying its outcome is unknown would claim a re-run might try
 * the batch again, which it never would.
 *
 * @param finished what the transaction's body returned, absent when the throw came before it returned
 * @returns the body's own already-applied outcome, else the failure {@link applyTransactionFailure} names
 */
export function settleThrownApply<Outcome extends { readonly outcome: string }>({
  batchId,
  cause,
  finished,
}: {
  batchId: string;
  cause: unknown;
  finished: Outcome | undefined;
}): Result<Outcome, ImportApplicationFailedError | ImportCommitUnconfirmedError> {
  if (finished?.outcome === "already-applied") {
    return ok(finished);
  }
  return err(applyTransactionFailure({ batchId, bodyFinished: finished !== undefined, cause }));
}
