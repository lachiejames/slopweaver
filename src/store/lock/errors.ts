/**
 * The store lock's own typed failures — one union for `src/store/lock/`, per `error-handling.md`.
 *
 * A union rather than a `readonly string[]` because callers branch on it: `store start` refuses to call a start
 * clean on any of these, `store verify` turns a NOT-MEASURED one into a finding rather than a crash, and the
 * first-transition backup gate stops the lock before any write on `BACKUP_GATE_FAILED`.
 */
import type { DockerExposureLabel } from "../dockerPublication.js";

/** The Docker network the stack's containers share could not be read, or did not name exactly one IPv4 gateway. */
export interface LockGatewayUnresolvedError {
  readonly code: "GATEWAY_UNRESOLVED";
  readonly message: string;
  readonly network: string;
}

/** The container's `pg_hba.conf` is not a shape the managed block can be placed in safely. */
export interface LockHbaUnplaceableError {
  readonly code: "HBA_UNPLACEABLE";
  readonly message: string;
}

/** A command into the stack (docker, psql inside the container) failed. */
export interface LockStepFailedError {
  readonly code: "STEP_FAILED";
  readonly message: string;
  readonly step: string;
}

/** A login the lock depends on did not behave as the lock requires — accepted when it must be refused, or the reverse. */
export interface LockProofFailedError {
  readonly code: "PROOF_FAILED";
  readonly message: string;
  readonly proof: string;
}

/** The store selected is not this checkout's local stack, so there is nothing for the lock to reach. */
export interface LockNotLocalStackError {
  readonly code: "NOT_LOCAL_STACK";
  readonly message: string;
}

/** The database port is published beyond loopback, so another machine can reach it and the lock is not written. */
export interface LockPortExposedError {
  readonly code: "PORT_EXPOSED";
  readonly message: string;
  /** What kind of exposure each non-loopback publication is, never the address. */
  readonly exposures: readonly DockerExposureLabel[];
}

/** The retained backup the first lock needs could not be taken, or did not restore. */
export interface LockBackupGateFailedError {
  readonly code: "BACKUP_GATE_FAILED";
  readonly message: string;
}

/** The new connection string could not be written to `secrets/store-url`. */
export interface LockSecretWriteFailedError {
  readonly code: "SECRET_WRITE_FAILED";
  readonly message: string;
}

/** Every way the lock can fail. */
export type StoreLockError =
  | LockGatewayUnresolvedError
  | LockHbaUnplaceableError
  | LockStepFailedError
  | LockProofFailedError
  | LockNotLocalStackError
  | LockPortExposedError
  | LockBackupGateFailedError
  | LockSecretWriteFailedError;

/** The factories, so every site builds a variant the same way. */
export const StoreLockErrors = {
  backupGateFailed: ({ reasons }: { reasons: readonly string[] }): LockBackupGateFailedError => ({
    code: "BACKUP_GATE_FAILED",
    message: `the retained backup the first lock takes did not complete, so nothing was changed: ${reasons.join("; ")}`,
  }),
  gatewayUnresolved: ({ network, detail }: { network: string; detail: string }): LockGatewayUnresolvedError => ({
    code: "GATEWAY_UNRESOLVED",
    message: `could not read one IPv4 gateway for the Docker network ${network}: ${detail}`,
    network,
  }),
  hbaUnplaceable: ({ detail }: { detail: string }): LockHbaUnplaceableError => ({
    code: "HBA_UNPLACEABLE",
    message: `the container's pg_hba.conf cannot take the lock's rules safely: ${detail}`,
  }),
  notLocalStack: ({ detail }: { detail: string }): LockNotLocalStackError => ({
    code: "NOT_LOCAL_STACK",
    message: `the selected store is not this checkout's local Supabase stack, so there is nothing to lock: ${detail}`,
  }),
  portExposed: ({ exposures }: { exposures: readonly DockerExposureLabel[] }): LockPortExposedError => ({
    code: "PORT_EXPOSED",
    exposures,
    message:
      `refusing to lock the store: the database port is published on ${exposures.join(" and ")}, so another ` +
      `machine may reach it, and the lock's rule cannot see logins that arrive that way. Publish the local stack ` +
      `on loopback only (Docker Desktop: Settings > Resources > Network, Port binding behavior "Localhost only"), ` +
      `then run \`yarn store:start\` again.`,
  }),
  proofFailed: ({ proof, detail }: { proof: string; detail: string }): LockProofFailedError => ({
    code: "PROOF_FAILED",
    message: `${proof}: ${detail}`,
    proof,
  }),
  secretWriteFailed: ({ reasons }: { reasons: readonly string[] }): LockSecretWriteFailedError => ({
    code: "SECRET_WRITE_FAILED",
    message: `could not write secrets/store-url: ${reasons.join("; ")}`,
  }),
  stepFailed: ({ step, detail }: { step: string; detail: string }): LockStepFailedError => ({
    code: "STEP_FAILED",
    message: `${step} failed: ${detail}`,
    step,
  }),
} as const;
