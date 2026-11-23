/**
 * The one door every reader and writer of the Codex sign-in observations goes through.
 *
 * ## Where they live: the store
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local Supabase store. The
 * observations the fleet's live read files for the `codex-plan-signed-out` monitor are one row per alias in
 * `codex_sign_in_observation` (`../store/schema/codexSignInObservation.ts`); {@link codexSignInPort} answers the
 * store-backed port (`./signInRecordStore.ts`). A `codex-signin/<alias>.json` from before is imported from once,
 * and no file is written. A store that cannot be reached is `CODEX_SIGN_IN_STORE_UNAVAILABLE`, never a file read.
 *
 * ## Injection
 *
 * The port is a REQUIRED argument everywhere it is used, and only a composition root calls
 * {@link codexSignInPort}: `SLOPWEAVER_STORE_URL` in the environment overrides a home's selection, so a test that
 * forgot to pass one could reach a real store. A unit test passes a plain {@link CodexSignInPort} value — a seam,
 * not a mock — built by `src/__tests__/codexSignInFixture.ts` over an in-memory row set.
 */
import type { Result } from "#lib/result.js";

import type { CodexAccountLive } from "./accountLiveParse.js";
import type { CodexSignInAliasRefusal, CodexSignInError, CodexSignInStoreUnavailableError } from "./signInErrors.js";
import type { CodexAuthStamp, CodexSignInRecord } from "./signInRecord.js";
import { productionCodexSignInSeams } from "./signInRecordRows.js";
import { storeCodexSignInPort } from "./signInRecordStore.js";

/**
 * Which aliases to read, under which home — whose store selection, and whose import files, are meant.
 *
 * @internal -- a part of {@link CodexSignInPort}, which is the contract every caller threads.
 */
export interface CodexSignInReadRequest {
  readonly aliases: readonly string[];
  readonly home: string;
}

/**
 * What one live batch said about one store, beside `auth.json`'s stamp from just before it ran and once it answered.
 *
 * @internal -- a part of {@link CodexSignInPort}, which is the contract every caller threads.
 */
export interface CodexSignInObserved {
  readonly alias: string;
  readonly authBefore: CodexAuthStamp;
  readonly authAfter: CodexAuthStamp;
  readonly live: CodexAccountLive;
}

/**
 * What one alias's read found: nothing filed (and nothing to import), an observation at its revision, or why it
 * cannot be read. A refusal is its OWN answer rather than "nothing filed": reading it as absent would clear a card
 * over an observation nobody can read (`.claude/rules/typescript-patterns.md` § No silent fallback).
 */
export type CodexSignInAliasRead =
  | { readonly kind: "absent"; readonly alias: string }
  | { readonly kind: "record"; readonly alias: string; readonly record: CodexSignInRecord; readonly revision: number }
  | { readonly kind: "refused"; readonly alias: string; readonly error: CodexSignInAliasRefusal };

/** What filing one alias's observation did: written, kept by the ordering guard, or refused with why. */
export type CodexSignInWriteOutcome =
  | { readonly kind: "written"; readonly alias: string; readonly revision: number }
  | { readonly kind: "kept"; readonly alias: string; readonly why: string }
  | {
      readonly kind: "refused";
      readonly alias: string;
      readonly error: Exclude<CodexSignInError, CodexSignInStoreUnavailableError>;
    };

/** The observations' two operations, as one value a caller threads rather than two it could mix up. */
export interface CodexSignInPort {
  /** Read every requested alias over ONE connection, in the order asked, importing any not yet in the store. */
  readonly read: (
    request: CodexSignInReadRequest,
  ) => Promise<Result<readonly CodexSignInAliasRead[], CodexSignInStoreUnavailableError>>;
  /** File one live batch's observations: one judgement and one compare-and-set per alias, never retried. */
  readonly record: (request: {
    readonly home: string;
    readonly observed: readonly CodexSignInObserved[];
  }) => Promise<Result<readonly CodexSignInWriteOutcome[], CodexSignInStoreUnavailableError>>;
}

/**
 * The port this install's sign-in observations are reached through: the store.
 *
 * @returns the port every production reader and writer uses
 */
export function codexSignInPort(): CodexSignInPort {
  return storeCodexSignInPort({ seams: productionCodexSignInSeams() });
}
