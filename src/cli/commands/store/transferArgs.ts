/**
 * The arguments `store export` and `store import` take, parsed without touching the filesystem. Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { type Parsed, type StoreCommandError, StoreCommandErrors } from "./errors.js";

/** `store export`'s flags. */
export const STORE_EXPORT_FLAGS: FlagSpec = { boolean: ["json"], string: ["out", "home"] };

/** `store import`'s flags. */
export const STORE_IMPORT_FLAGS: FlagSpec = {
  boolean: ["json", "unmanifested", "stop-on-conflict"],
  string: ["from", "approve", "apply", "home"],
};

/** The shape a plan digest takes, which is the only thing `--approve` accepts. */
const PLAN_DIGEST = /^sha256:[0-9a-f]{64}$/u;

/** The shape a staged batch id takes — a uuid, as staging printed it — which is the only thing `--apply` accepts. */
const BATCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A parsed `store export`. */
export interface StoreExportArgs {
  readonly out: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `store import` that checks, plans and — approved — stages an export. */
export interface StoreImportPlanArgs {
  readonly mode: "plan";
  readonly from: string;
  /** The plan digest the owner approved, which stages the export; absent, the import only plans. */
  readonly approve: string | undefined;
  readonly home: string | undefined;
  readonly unmanifested: boolean;
  readonly json: boolean;
}

/** A parsed `store import --apply`, which applies one staged batch. */
export interface StoreImportApplyArgs {
  readonly mode: "apply";
  readonly batchId: string;
  /** Refuse the whole apply on any append-only difference, rather than keeping each live row. */
  readonly stopOnConflict: boolean;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `store import`: a plan of an export, or the apply of a staged batch. */
export type StoreImportArgs = StoreImportPlanArgs | StoreImportApplyArgs;

/**
 * A directory flag's value: `undefined` when an optional one was not passed, else the refusal for a required
 * one left out or any one passed empty — the same sentence for both, since the fix is the same. Every `store`
 * transfer verb's `--home` goes through it, so they all refuse alike.
 *
 * @param name the flag, without its dashes
 * @param verb the `store` sub-verb the refusal names
 * @returns the value, `undefined` for an optional one not passed, or the refusal
 */
export function directoryFlag({
  values,
  name,
  verb,
  required,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
  verb: string;
  required: boolean;
}): Result<string | undefined, StoreCommandError> {
  const value = values[name];
  if (value === undefined && !required) {
    return ok(undefined);
  }
  if (typeof value !== "string" || value.trim() === "") {
    return err(StoreCommandErrors.directoryValueMissing({ name, verb }));
  }
  return ok(value);
}

/**
 * Parse `store export`'s arguments.
 *
 * @param rest the argv after the verb
 * @returns the arguments, or every refusal
 */
export function parseStoreExportArgs({ rest }: { rest: readonly string[] }): Parsed<StoreExportArgs> {
  return parseFlags({ args: rest, spec: STORE_EXPORT_FLAGS })
    .mapErr((reasons): StoreCommandError => StoreCommandErrors.flagsInvalid({ reasons }))
    .andThen(({ values }): Parsed<StoreExportArgs> => {
      const out = directoryFlag({ name: "out", required: true, values, verb: "export" });
      const home = directoryFlag({ name: "home", required: false, values, verb: "export" });
      if (out.isErr() || home.isErr()) {
        const reasons = [out, home].flatMap((flag) => (flag.isErr() ? [flag.error.message] : []));
        return err(StoreCommandErrors.argumentsRefused({ reasons }));
      }
      return ok({ home: home.value, json: values["json"] === true, out: out.value! });
    });
}

/** `--approve`'s value: absent, or exactly one plan digest. */
function approveFlag({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): Result<string | undefined, StoreCommandError> {
  const value = values["approve"];
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || !PLAN_DIGEST.test(value)) {
    return err(StoreCommandErrors.approveDigestInvalid());
  }
  return ok(value);
}

/**
 * Parse `store import`'s arguments.
 *
 * @param rest the argv after the verb
 * @returns the arguments, or every refusal
 */
export function parseStoreImportArgs({ rest }: { rest: readonly string[] }): Parsed<StoreImportArgs> {
  return parseFlags({ args: rest, spec: STORE_IMPORT_FLAGS })
    .mapErr((reasons): StoreCommandError => StoreCommandErrors.flagsInvalid({ reasons }))
    .andThen(({ values }): Parsed<StoreImportArgs> =>
      values["apply"] === undefined ? planArgs({ values }) : applyArgs({ values }),
    );
}

/** `store import --from …`: every flag but `--apply`'s own. */
function planArgs({ values }: { values: Readonly<Record<string, string | boolean>> }): Parsed<StoreImportArgs> {
  const from = directoryFlag({ name: "from", required: true, values, verb: "import" });
  const home = directoryFlag({ name: "home", required: false, values, verb: "import" });
  const approve = approveFlag({ values });
  const refusals = [from, home, approve].flatMap((flag) => (flag.isErr() ? [flag.error.message] : []));
  if (values["stop-on-conflict"] === true) {
    refusals.push(StoreCommandErrors.stopOnConflictNeedsApply().message);
  }
  if (from.isErr() || home.isErr() || approve.isErr() || refusals.length > 0) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: refusals }));
  }
  return ok({
    approve: approve.value,
    from: from.value!,
    home: home.value,
    json: values["json"] === true,
    mode: "plan",
    unmanifested: values["unmanifested"] === true,
  });
}

/** `store import --apply <batch-id>`: a staged batch, never an export directory. */
function applyArgs({ values }: { values: Readonly<Record<string, string | boolean>> }): Parsed<StoreImportArgs> {
  const home = directoryFlag({ name: "home", required: false, values, verb: "import" });
  const refusals = home.isErr() ? [home.error.message] : [];
  const batchId = values["apply"];
  if (typeof batchId !== "string" || !BATCH_ID.test(batchId)) {
    refusals.push(StoreCommandErrors.applyBatchIdInvalid().message);
  }
  const planOnly = ["from", "approve", "unmanifested"].filter((name) => values[name] !== undefined);
  if (planOnly.length > 0) {
    refusals.push(StoreCommandErrors.applyTakesNoPlanFlags({ names: planOnly }).message);
  }
  if (home.isErr() || typeof batchId !== "string" || refusals.length > 0) {
    return err(StoreCommandErrors.argumentsRefused({ reasons: refusals }));
  }
  return ok({
    batchId,
    home: home.value,
    json: values["json"] === true,
    mode: "apply",
    stopOnConflict: values["stop-on-conflict"] === true,
  });
}
