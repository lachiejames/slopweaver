/**
 * The two halves one 1Password sync gathers, before `./sync.ts` folds and publishes them.
 *
 * ## Two credentials, two independent halves, and neither blocks the other
 *
 * The roster comes off the injected `op` runner and the activity feed off the Events API, built from its own
 * resolved credential by an injected client builder. Either may be absent: an absent one marks its own kinds
 * `not-configured` and keeps their stored files, and the other half is gathered regardless.
 */
import { err, ok, type Result } from "#lib/result.js";

import { ONEPASSWORD_SIGNIN_STEP, type OnepasswordEventsCredentials } from "./credentials.js";
import type { OnepasswordEventsClient } from "./eventsClient.js";
import type { OnepasswordKind, OnepasswordKindFile } from "./model.js";
import { syncAdminCliKinds } from "./syncAdminChannel.js";
import type { OnepasswordProgress, OnepasswordSyncKindOutcome, OpSurfaceRunner } from "./syncCore.js";
import { syncEvents } from "./syncEventsChannel.js";

/**
 * Builds the Events API client from resolved credentials - swapped for a fake in tests.
 *
 * @internal
 */
export type OnepasswordEventsClientBuilder = (input: {
  credentials: OnepasswordEventsCredentials;
}) => OnepasswordEventsClient;

/** The kinds this atlas assembles from the `op` session, in the order their dependencies require. */
const ADMIN_CLI_KINDS: readonly OnepasswordKind[] = [
  "user",
  "group",
  "group-member",
  "vault",
  "vault-grant",
  "integration",
];

/** Mark every kind of one channel `not-configured`, which is what an absent credential earns. */
function unconfiguredKinds({
  kinds,
  storedFiles,
  reason,
}: {
  kinds: readonly OnepasswordKind[];
  storedFiles: Record<OnepasswordKind, OnepasswordKindFile>;
  reason: string;
}): readonly (OnepasswordSyncKindOutcome & { file: OnepasswordKindFile })[] {
  return kinds.map((kind) => ({
    complete: false,
    entityCount: storedFiles[kind].entities.length,
    file: storedFiles[kind],
    kind,
    reasons: [reason],
  }));
}

/** One kind's outcome carried together with the file that outcome produced. */
export type OnepasswordKindResult = OnepasswordSyncKindOutcome & { readonly file: OnepasswordKindFile };

/**
 * The roster half: every `op` kind, or every one of them marked `not-configured` when there is no session.
 *
 * An absent `op` session is not an error - see this file's header on why either half may be missing.
 *
 * @param runOp the injected `op` runner, or `null` when no usable session was resolved
 * @param storedFiles the trusted prior generation, which an unconfigured kind keeps untouched
 * @returns one result per roster kind, or why the `op` walk could not be folded at all
 */
export function gatherAdminKinds({
  at,
  onProgress,
  runOp,
  storedFiles,
}: {
  at: string;
  onProgress: OnepasswordProgress;
  runOp: OpSurfaceRunner | null;
  storedFiles: Record<OnepasswordKind, OnepasswordKindFile>;
}): Result<readonly OnepasswordKindResult[]> {
  if (runOp === null) {
    return ok(
      unconfiguredKinds({
        kinds: ADMIN_CLI_KINDS,
        reason: `no usable \`op\` session - ${ONEPASSWORD_SIGNIN_STEP}`,
        storedFiles,
      }),
    );
  }
  const synced = syncAdminCliKinds({ at, onProgress, run: runOp, storedFiles });
  if (synced.isErr()) {
    return err(synced.error);
  }
  return ok(ADMIN_CLI_KINDS.map((kind) => synced.value[kind]!));
}

/**
 * The activity half: the audit walk, or the `event` kind marked `not-configured` when no token is set.
 *
 * @param eventsCredentials the resolved token, or why it could not be resolved - the failure is the reason
 *   recorded against the kind rather than a run failure
 * @param since the ISO instant the audit walk starts from
 * @param storedFiles the trusted prior generation, whose `event` file an unconfigured run keeps untouched
 * @returns the `event` kind's result, or why the walk failed
 */
export async function gatherEventsKind({
  at,
  buildEventsClient,
  eventsCredentials,
  onProgress,
  since,
  storedFiles,
}: {
  at: string;
  buildEventsClient: OnepasswordEventsClientBuilder;
  eventsCredentials: Result<OnepasswordEventsCredentials>;
  onProgress: OnepasswordProgress;
  since: string;
  storedFiles: Record<OnepasswordKind, OnepasswordKindFile>;
}): Promise<Result<OnepasswordKindResult>> {
  if (eventsCredentials.isErr()) {
    return ok(unconfiguredKinds({ kinds: ["event"], reason: eventsCredentials.error.join("; "), storedFiles })[0]!);
  }
  return syncEvents({
    at,
    client: buildEventsClient({ credentials: eventsCredentials.value }),
    onProgress,
    since,
    stored: storedFiles.event,
  });
}
