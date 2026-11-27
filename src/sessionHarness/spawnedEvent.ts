/**
 * The `spawned` row a launch writes into the session ledger (`./recordingHarness.ts` is its one writer): the model the
 * session actually boots on, and the plan choice the launch's own credential gate made, preferred over the one its
 * spec carried in. Pure — the decorator supplies the address, the instant and the launch's outcome.
 */
import { CODEX_MODEL } from "../codex/profiles.js";
import { decodePlanChoice, type SessionPlanChoice } from "../sessions/planChoice.js";
import { type BootModel, bootModelForSpawn, type SessionEvent, type SessionOpenedBy } from "../sessions/session.js";
import type { HarnessLaunchAddress, HarnessLaunchOperation } from "./errors.js";
import type { HarnessLaunchSpec, SessionLauncher } from "./launch.js";

/**
 * The model a launch's session actually boots on, as the ledger records it.
 *
 * A Codex seat boots the repository's own pin whatever the spawn's `--model` said — both the cmux boot line
 * (`../cmux/seatRoute.ts`) and the app's launch spec (`./appLaunchSpec.ts`) pass `CODEX_MODEL` — so recording the
 * spec's Claude tier there wrote `pinned: sonnet` for a session running `gpt-*`. A Claude seat boots what the spec
 * pinned, or inherits the saved default when it pinned nothing.
 *
 * @param spec the launch spec, read for its host and its model
 * @returns the boot model to record
 */
export function bootModelForLaunch({ spec }: { spec: HarnessLaunchSpec }): BootModel {
  if (spec.host === "codex") {
    return { kind: "pinned", model: CODEX_MODEL };
  }
  return bootModelForSpawn({ model: spec.model });
}

/**
 * The `spawned` event a launch writes — one new row, keyed by the session's id.
 *
 * The plan choice it records is the BOOTED plan's — what the launch's own credential gate decided — when the launch
 * reported one, else the spec's, decided before launch (a Codex seat's route). Neither, and the row carries none; one
 * the ledger's reader would refuse is left off, so the row itself stays readable.
 *
 * @param spec the launch spec
 * @param address the session the launch opened (or left open)
 * @param booted the plan choice the opened session reported, preferred over the spec's
 * @param operation which launch act opened it
 * @param implementation which harness hosts it
 * @param tsIso when it was recorded
 * @returns the event
 */
export function spawnedEventOf({
  spec,
  address,
  booted,
  operation,
  implementation,
  tsIso,
}: {
  spec: HarnessLaunchSpec;
  address: HarnessLaunchAddress;
  booted?: SessionPlanChoice | undefined;
  operation: HarnessLaunchOperation;
  implementation: string;
  tsIso: string;
}): SessionEvent {
  const openedBy: SessionOpenedBy = operation;
  let carried = spec.planChoice;
  if (booted !== undefined) {
    carried = booted;
  }
  // Written only in the shape the reader decodes: a choice it would refuse would make the whole row unreadable, and
  // the session's row matters more than the reason its plan was picked.
  const planChoice = carried === undefined ? undefined : decodePlanChoice({ value: carried });
  return {
    // The last moment anything can say honestly which tier the session booted onto (`../sessions/session.ts`).
    bootModel: bootModelForLaunch({ spec }),
    branch: spec.branch,
    cwd: spec.directory,
    harness: implementation,
    kind: "spawned",
    openedBy,
    sessionKey: spec.ledgerKey,
    surfaceRef: address.endpointHandle,
    tsIso,
    workspaceRef: address.handle,
    ...(spec.slug === undefined ? {} : { slug: spec.slug }),
    // `workspaceId` stays beside `sessionId`: every reader of the ledger today binds a row to its live seat by it.
    ...(address.sessionId === undefined ? {} : { sessionId: address.sessionId, workspaceId: address.sessionId }),
    ...(planChoice === undefined ? {} : { planChoice }),
  };
}

/**
 * The plan choice the launch's own gate set on the plan that booted, when the launch succeeded and carried one. A
 * failed launch that left a session open carries no opened session, so its row falls back to the spec's choice.
 *
 * @param launched the launch's outcome
 * @returns the booted plan's choice, or undefined for a failed launch or one whose gate set none
 */
export function bootedChoiceOf({
  launched,
}: {
  launched: Awaited<ReturnType<SessionLauncher["open"]>>;
}): SessionPlanChoice | undefined {
  if (launched.isErr()) {
    return undefined;
  }
  return launched.value.planChoice;
}
