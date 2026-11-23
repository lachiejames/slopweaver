/**
 * The shell pieces every verb reading the authored working state back out of the store shares: opening the
 * store, the newest stored bytes at one path, the home a verb runs against, and a usage refusal. Split out of
 * `./authoredRun.ts` when `./slackAsksRun.ts` became a second reader of the same rows.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { StoreError } from "../../../store/errors.js";
import { newestPerPath } from "../../../store/fleet/authoredFile.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../exitCodes.js";

import type { AuthoredStoreSession, AuthoredVerbDeps } from "./authoredDeps.js";
import { AUTHORED_IMPORT_COMMAND } from "./authoredUsage.js";

/** A store session opened for one verb, or the exit code that verb already printed a reason for. */
export type AuthoredOpened =
  { readonly kind: "open"; readonly session: AuthoredStoreSession } | { readonly kind: "exit"; readonly code: number };

/**
 * Open the store for a verb, printing why when it cannot be.
 *
 * @param verb the verb's name, for the lines
 * @param home the state home
 * @returns the session, or the exit code to return
 */
export async function openAuthoredStore({
  verb,
  home,
  deps,
}: {
  verb: string;
  home: string;
  deps: AuthoredVerbDeps;
}): Promise<AuthoredOpened> {
  const opened = await deps.openStore({ home });
  if (opened.isErr()) {
    deps.writeDiagnostic(`store ${verb}: the store could not be opened (${opened.error.code})`);
    deps.writeDiagnostic(`  ${opened.error.message}`);
    return { code: EXIT_ERROR, kind: "exit" };
  }
  if (opened.value.kind === "no-store") {
    deps.writeDiagnostic(
      `store ${verb}: ${home} selects no store, so there is nothing to read — this verb never reads the disk copy`,
    );
    return { code: EXIT_ERROR, kind: "exit" };
  }
  return { kind: "open", session: opened.value.session };
}

/**
 * The newest stored bytes at one path.
 *
 * @param session the open store
 * @param relativePath the path under the home
 * @returns the bytes, or why there are none
 */
export async function newestAuthoredBody({
  session,
  relativePath,
}: {
  session: AuthoredStoreSession;
  relativePath: string;
}): Promise<Result<Buffer, StoreError | FleetImportError>> {
  const versions = await session.versions({ relativePath });
  if (versions.isErr()) {
    return err(versions.error);
  }
  const [newest] = newestPerPath({ versions: versions.value });
  if (newest === undefined) {
    return err(FleetImportErrors.authoredPathNotStored({ importCommand: AUTHORED_IMPORT_COMMAND, path: relativePath }));
  }
  const body = await session.body({ bodySha256: newest.bodySha256 });
  if (body.isErr()) {
    return err(body.error);
  }
  if (body.value === undefined) {
    return err(FleetImportErrors.authoredBodyNotStored({ bodySha256: newest.bodySha256, path: relativePath }));
  }
  return ok(body.value);
}

/**
 * The home `--home` named, or the resolved one.
 *
 * @param named the `--home` value, when given
 * @returns the state home
 */
export function authoredHomeOf({ named, deps }: { named: string | undefined; deps: AuthoredVerbDeps }): string {
  if (named === undefined) {
    return deps.defaultHome();
  }
  return named;
}

/**
 * Print a usage refusal and return its exit code.
 *
 * @param problems each line saying what was wrong
 * @param usage the verb's usage block
 * @returns the usage exit code, {@link EXIT_USAGE}, a caller mistake is refused with
 */
export function refuseAuthoredUsage({
  problems,
  usage,
  verb,
  deps,
}: {
  problems: readonly string[];
  usage: string;
  verb: string;
  deps: AuthoredVerbDeps;
}): number {
  for (const line of problems) {
    deps.writeDiagnostic(`store ${verb}: ${line}`);
  }
  deps.writeDiagnostic(usage);
  return EXIT_USAGE;
}
