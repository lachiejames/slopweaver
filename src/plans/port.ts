/**
 * The one door every reader and writer of the plan register goes through, so where the register LIVES is a
 * single decision rather than thirty.
 *
 * ## Where it lives: the store
 *
 * Everything in `$SLOPWEAVER_HOME` moves into the local Supabase store, and the
 * home becomes deletable. The plan register is the first register to make that trip, because it is one bounded
 * document read on every seat, capacity check and Codex route. {@link planRegisterPort} answers the
 * store-backed port (`./storePort.ts`): the singleton `plan_register` row is the authority, a legacy
 * `plans.json` is imported from once, and `plans.json` plus `claude-accounts/accounts.json` are regenerated
 * after every commit as one-way projections for checkouts that predate the store. A store that cannot be
 * reached is `REGISTER_STORE_UNAVAILABLE`, never a file read.
 *
 * There is no file-backed port to select. The projections are kept until every reader runs this code — the
 * retirement is its own change, "retire plan-register file projections".
 *
 * ## Injection
 *
 * A caller that wants to run without a database — a unit test, which may not mock — passes a plain
 * {@link PlanRegisterPort} value. That is a seam, not a mock: `.claude/rules/testing.md` § "A unit test tests a
 * PURE function". `src/__tests__/planRegisterFixture.ts` builds one over an in-memory row.
 */
import type { Result } from "#lib/result.js";

import type { PlanRegisterError } from "./errors.js";
import { readOnlyStorePlanRegisterPort, storePlanRegisterPort } from "./storePort.js";
import { productionPlanRegisterSeams, readOnlyPlanRegisterSeams } from "./storeRows.js";
import type { PlanMutation, PlanRegisterSnapshot } from "./types.js";

/**
 * Where one register lives and how it is read, named once so a read and the write after it agree.
 *
 * @internal -- a part of {@link PlanRegisterPort}, which is the contract every caller threads.
 */
export interface PlanRegisterRequest {
  /** The Slopweaver home whose register is meant — and whose store selection is read. */
  readonly home: string;
}

/**
 * One change to publish, and the instant of the attempt.
 *
 * @internal -- a part of {@link PlanRegisterPort}, which is the contract every caller threads.
 */
export interface PlanRegisterWrite extends PlanRegisterRequest {
  readonly mutation: PlanMutation;
  readonly nowIso: string;
  /**
   * The revision a caller already judged this change against OUTSIDE the write — `null` for an unadopted
   * register no row backs. A register that has moved since refuses as `REGISTER_REVISION_CONFLICT`, so a check
   * the write cannot make itself (`plans add`'s on-disk store identity, `cli/commands/plans/storeAlias.ts`) holds
   * at commit. ABSENT, the write judges against whatever it reads.
   */
  readonly judgedAtRevision?: number | null | undefined;
}

/**
 * Read the register, or derive the picture an unadopted install already has.
 *
 * @internal -- a part of {@link PlanRegisterPort}, which is the contract every caller threads.
 */
export type PlanRegisterRead = (
  request: PlanRegisterRequest,
) => Promise<Result<PlanRegisterSnapshot, PlanRegisterError>>;

/**
 * Publish one change to the register.
 *
 * @internal -- a part of {@link PlanRegisterPort}, which is the contract every caller threads.
 */
export type PlanRegisterPublish = (
  request: PlanRegisterWrite,
) => Promise<Result<PlanRegisterSnapshot, PlanRegisterError>>;

/** The register's two operations, as one value a caller threads rather than two it could mix up. */
export interface PlanRegisterPort {
  readonly read: PlanRegisterRead;
  readonly write: PlanRegisterPublish;
}

/**
 * The port this install's register is reached through: the store.
 *
 * @returns the port every production reader and writer uses
 */
export function planRegisterPort(): PlanRegisterPort {
  return storePlanRegisterPort({ seams: productionPlanRegisterSeams() });
}

/**
 * The port a reader promised to change nothing reads through: the store row or the derived picture, never an
 * import, a write, or a catch-up of a `behind` store (each refused as `REGISTER_STORE_UNAVAILABLE`). Opening the
 * store still selects it (`../store/config.ts`'s `storeUrlSelection`), as every store read does.
 *
 * @returns the read-only production port
 */
export function readOnlyPlanRegisterPort(): PlanRegisterPort {
  return readOnlyStorePlanRegisterPort({ seams: readOnlyPlanRegisterSeams() });
}
