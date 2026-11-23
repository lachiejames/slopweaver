/**
 * The first session harness: cmux, behind the vendor-neutral contract (`./sessionHarness.ts`).
 *
 * Every operation is the mechanism the `cmux` verbs already used, unchanged — `reachSession`'s screen-aware
 * send and interrupt (`../cmux/reach.ts`), the bounded-force close (`../sessions/closeForce.ts`) — so moving a
 * verb onto the seam changes nothing it does. What it adds is the one refusal cmux cannot honestly avoid:
 * `later`. A cmux session is a terminal; a line typed into a running turn is queued by Claude Code or Codex
 * and delivered at THEIR next boundary, which is `turn`, and nothing on the socket can hold a line until the
 * turn ends. Degrading `later` to `turn` would deliver mid-turn what the sender asked to wait, so it is
 * refused before anything touches the session.
 *
 * `withSessionHarness` is the one place a verb opens the live harness: it owns the connection's lifetime, so
 * a verb body sees only the contract and never the transport behind it.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type CmuxClient, withCmuxClient } from "../cmux/client.js";
import { describeComposer } from "../cmux/composer.js";
import { type ReachWaits, reachSession, realReachWaits } from "../cmux/reach.js";
import { closeWorkspaceWithBoundedForce } from "../sessions/closeForce.js";
import { cmuxTargetOf, harnessErrorFromCmux, sessionFromCmux } from "./cmuxSession.js";
import { type SessionHarnessError, SessionHarnessErrors } from "./errors.js";
import type {
  HarnessMessageOutcome,
  HarnessParkMode,
  HarnessParkOutcome,
  HarnessTarget,
  SessionDelivery,
  SessionHarness,
} from "./sessionHarness.js";

/** The implementation name a refusal carries. */
const CMUX_IMPLEMENTATION = "cmux";

/** Why cmux refuses `later`, in the refusal's own words. */
const CMUX_LATER_WHY =
  "a cmux session is a terminal, so a line typed into a running turn is delivered at the session's next " +
  'boundary (that is "turn"), and the socket cannot hold one until the turn ends';

/**
 * The refusal for a delivery cmux cannot honour, or `undefined` for one it can.
 *
 * @param delivery what the sender asked for
 * @returns the refusal, or `undefined` to proceed
 */
function cmuxDeliveryRefusal({ delivery }: { delivery: SessionDelivery }): SessionHarnessError | undefined {
  if (delivery !== "later") {
    return undefined;
  }
  return SessionHarnessErrors.deliveryUnsupported({
    delivery,
    implementation: CMUX_IMPLEMENTATION,
    why: CMUX_LATER_WHY,
  });
}

/**
 * Park one cmux session: re-resolve it by id — so a workspace that went away fails here rather than addressing the
 * focused one — then close it, forced outright when the caller settled the force, else bounded by a proven-idle
 * screen. The residue reap is Slopweaver policy and stays in the verb (`handover park`'s `parkCloseSeat.ts`).
 *
 * @param client the cmux connection
 * @param target the session to park
 * @param mode whether the force is already settled
 * @returns parked with the session as resolved, held with why, or the typed failure
 */
async function cmuxPark({
  client,
  target,
  mode,
}: {
  client: CmuxClient;
  target: HarnessTarget;
  mode: HarnessParkMode;
}): Promise<Result<HarnessParkOutcome, SessionHarnessError>> {
  const resolved = await client.resolveWorkspace({ ref: target.session.id });
  if (resolved.isErr()) {
    return err(harnessErrorFromCmux({ error: resolved.error, handle: target.session.handle, operation: "park" }));
  }
  const session = sessionFromCmux({ workspace: resolved.value });
  if (mode === "force") {
    const shut = await client.closeWorkspace({ force: true, workspaceId: session.id });
    if (shut.isErr()) {
      return err(harnessErrorFromCmux({ error: shut.error, operation: "park" }));
    }
    return ok({ forced: true, kind: "parked", session });
  }
  const shut = await closeWorkspaceWithBoundedForce({ client, workspaceId: session.id });
  if (shut.isErr()) {
    return err(harnessErrorFromCmux({ error: shut.error, operation: "park" }));
  }
  if (shut.value.kind === "held") {
    return ok({ kind: "held", reason: shut.value.verdict, session });
  }
  return ok({ forced: shut.value.forced, kind: "parked", session });
}

/** cmux draws no Stop control of its own per session, so there is nothing to press: refused, never closed instead. */
const NO_STOP_CONTROL = SessionHarnessErrors.operationFailed({
  causeCode: "NO_STOP_CONTROL",
  message: "a cmux workspace has no Stop control to press; close it with cmux close",
  operation: "press-stop",
});

/**
 * Build the cmux session harness over a connected client.
 *
 * @param client the cmux connection the caller owns and closes
 * @param waits the reach's waits — real timers in production, instant in a test
 * @returns the harness
 */
export function cmuxSessionHarnessOver({ client, waits }: { client: CmuxClient; waits: ReachWaits }): SessionHarness {
  return {
    close: async ({ target }) => {
      const shut = await closeWorkspaceWithBoundedForce({ client, workspaceId: target.session.id });
      if (shut.isErr()) {
        return err(harnessErrorFromCmux({ error: shut.error, operation: "close" }));
      }
      if (shut.value.kind === "held") {
        return ok({ kind: "held", reason: shut.value.verdict });
      }
      return ok({ forced: shut.value.forced, kind: "closed" });
    },
    interrupt: async ({ target }) =>
      (await client.interruptTurn({ target: cmuxTargetOf({ target }) })).mapErr((error) =>
        harnessErrorFromCmux({ error, operation: "interrupt" }),
      ),
    list: async () =>
      (await client.listWorkspaces())
        .map((workspaces) => workspaces.map((workspace) => sessionFromCmux({ workspace })))
        .mapErr((error) => harnessErrorFromCmux({ error, operation: "list" })),
    message: async ({ target, text, delivery }): Promise<Result<HarnessMessageOutcome, SessionHarnessError>> => {
      const refused = cmuxDeliveryRefusal({ delivery });
      if (refused !== undefined) {
        return err(refused);
      }
      const reached = await reachSession({
        client,
        interrupt: delivery === "now",
        target: cmuxTargetOf({ target }),
        text,
        waits,
      });
      if (reached.isErr()) {
        return err(harnessErrorFromCmux({ error: reached.error, operation: "message" }));
      }
      const { composer, disposition, interrupted } = reached.value;
      return ok({
        disposition,
        interrupted,
        ...(composer === undefined ? {} : { inputDetail: describeComposer({ reading: composer }) }),
      });
    },
    park: async ({ target, mode }) => cmuxPark({ client, mode, target }),
    pressStop: async () => err(NO_STOP_CONTROL),
    resolve: async ({ handle, endpointId }) =>
      (await client.resolveWorkspace({ ref: handle }))
        .map((workspace) => ({
          ...(endpointId === undefined ? {} : { endpointId }),
          session: sessionFromCmux({ workspace }),
        }))
        .mapErr((error) => harnessErrorFromCmux({ error, handle, operation: "resolve" })),
  };
}

/**
 * Run one body against the live session harness, closing its connection afterwards whatever happens.
 *
 * @param body what to do with the harness
 * @returns whatever `body` returned
 */
export async function withSessionHarness<T>({
  body,
}: {
  body: (options: { harness: SessionHarness }) => Promise<T>;
}): Promise<T> {
  return withCmuxClient({
    body: ({ client }) => body({ harness: cmuxSessionHarnessOver({ client, waits: realReachWaits() }) }),
  });
}
