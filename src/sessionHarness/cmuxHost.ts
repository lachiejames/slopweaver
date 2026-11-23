/**
 * The one place a verb opens a live cmux connection: the session harness, plus the cmux-only operations the
 * neutral contract (`./sessionHarness.ts`) deliberately does not carry.
 *
 * Stage 1 of the off-cmux path (`docs/session-harness.md`) is done when every verb reaches a session through the
 * seam. Most of what verbs do is the contract — list, resolve, message, interrupt, close, park. What is left is
 * cmux's own: reading a terminal's screen, its process tree, its pin and its title. Those have no honest neutral
 * shape yet — a vendor's SDK has no screen to read, and the control plane owns presentation — so they stay
 * cmux-only and are NAMED here as what stage 2 replaces, rather than leaking a whole {@link CmuxClient} to every
 * caller.
 *
 * The inventory a helper reads in cmux's row shape (`listWorkspaces`, `resolveWorkspace`) is not one of those: on
 * this surface it is the HARNESS's `list` and `resolve`, rebuilt as rows by `./cmuxSession.ts`, failing with the
 * harness's own error. A helper written against cmux's rows keeps its shape while its inventory goes through the
 * seam, and a second harness answers it the same way. `interruptTurn` and normal delivery are absent: a verb
 * reaches those only through {@link SessionHarness}.
 *
 * A caller cannot close or keep the connection: {@link withCmuxSessionHost} owns its lifetime, and the
 * `session-harness-lifecycle` gate refuses a cmux client constructed anywhere outside this tree and
 * `src/cmux/client.ts`.
 */
import type { Result } from "#lib/result.js";
import { type CmuxClient, type CmuxTarget, type CmuxWorkspaceSummary, withCmuxClient } from "../cmux/client.js";
import type { CmuxError } from "../cmux/errors.js";
import { type ReachOutcome, type ReachWaits, reachSession, realReachWaits } from "../cmux/reach.js";
import { cmuxSessionHarnessOver } from "./cmuxHarness.js";
import { cmuxWorkspaceFromSession } from "./cmuxSession.js";
import type { SessionHarnessError } from "./errors.js";
import type { SessionHarness } from "./sessionHarness.js";

/**
 * The cmux-only operations a verb may still reach, each named for what stage 2 replaces it with:
 *
 * - `readScreen`, `readScreenGrid`, `submitComposer`, `sendLine` — terminal observation and rescue, replaced by
 *   the vendor's own turn events and delivery state.
 * - `processTree`, `workspaceTop`, `topologyStrict`, `listWorkspacesStrict` — cmux's inventory and process
 *   oracles, replaced by the control plane's session registry and explicit liveness events.
 * - `readResumeBinding` — replaced by the vendor's conversation binding.
 * - `renameWorkspace`, `pinWorkspace`, `unpinWorkspace` — replaced by the control plane's presentation state.
 * - `closeWorkspace` — kept only for a caller whose reviewed force policy neither `close` nor `park` expresses.
 *
 * @internal — the raw half of {@link CmuxHostSurface}; a caller names the whole surface or a `Pick` of it.
 */
export type CmuxHostRawOperations = Pick<
  CmuxClient,
  | "closeWorkspace"
  | "listWorkspacesStrict"
  | "pinWorkspace"
  | "processTree"
  | "readResumeBinding"
  | "readScreen"
  | "readScreenGrid"
  | "renameWorkspace"
  | "sendLine"
  | "submitComposer"
  | "topologyStrict"
  | "unpinWorkspace"
  | "workspaceTop"
>;

/**
 * A failure the row-shaped inventory may answer. Production answers the harness's own; the declared type admits
 * cmux's too, so a helper's plain test fake of a cmux client still satisfies the surface — and every helper
 * handles both, which is what lets a second harness stand behind the same rows.
 */
export type CmuxHostInventoryError = CmuxError | SessionHarnessError;

/**
 * The one raw delivery a verb may still reach, beside {@link CmuxHostSurface}: kept off the surface itself so a plain test
 * fake of a cmux client still satisfies the surface, and asked for only by the callers that reach (`Pick`ed, or as
 * `CmuxHostSurface & CmuxHostReach`).
 */
export interface CmuxHostReach {
  /**
   * Type one line into a surface and read back what became of it, NEVER interrupting a running turn — cmux's own
   * reach, failing with cmux's own error. The harness's `message` is this same reach; this raw form exists only for
   * a sender whose record tells a keystroke that may have landed from one cmux refused
   * (`../talk/deliveryOutcome.ts`'s `sendFailureOf`), a distinction the harness's error does not carry yet. Stage 2
   * replaces it with the vendor's delivery state. An interrupt goes through {@link SessionHarness} only.
   */
  readonly reachSession: (options: {
    target: CmuxTarget;
    text: string;
    waits: ReachWaits;
  }) => Promise<Result<ReachOutcome, CmuxError>>;
}

/** What a verb holds beside the harness: cmux's row-shaped inventory through the seam, and the raw cmux-only operations. */
export interface CmuxHostSurface extends CmuxHostRawOperations {
  /** Every live session as a cmux row — the harness's `list`, in the harness's order. */
  readonly listWorkspaces: () => Promise<Result<readonly CmuxWorkspaceSummary[], CmuxHostInventoryError>>;
  /** One handle as the cmux row it names today — the harness's `resolve`, `SESSION_NOT_FOUND` when it names none. */
  readonly resolveWorkspace: (options: {
    ref: string;
  }) => Promise<Result<CmuxWorkspaceSummary, CmuxHostInventoryError>>;
}

/**
 * Every session the harness lists, rebuilt as the cmux workspace rows a caller still speaking cmux's shape
 * reads — the same order, the same fields.
 *
 * @param harness the harness to list through
 * @returns the rows, or the harness's typed failure
 */
export async function listCmuxWorkspacesThrough({
  harness,
}: {
  harness: Pick<SessionHarness, "list">;
}): Promise<Result<readonly CmuxWorkspaceSummary[], SessionHarnessError>> {
  return (await harness.list()).map((sessions) => sessions.map((session) => cmuxWorkspaceFromSession({ session })));
}

/**
 * The host surface over one client and the harness built on it: the inventory through the harness, every raw
 * operation forwarded unchanged, the reach fixed to never interrupt, and nothing else — so the connection's own
 * `close`, `interruptTurn` and the rest are not reachable through it.
 *
 * @param client the connection the opener owns — a test's fake client included
 * @param harness the harness over the same connection, which answers the inventory
 * @returns the surface
 */
export function cmuxHostSurfaceOver({
  client,
  harness,
}: {
  client: CmuxClient;
  harness: Pick<SessionHarness, "list" | "resolve">;
}): CmuxHostSurface & CmuxHostReach {
  return {
    closeWorkspace: (options) => client.closeWorkspace(options),
    reachSession: ({ target, text, waits }) => reachSession({ client, interrupt: false, target, text, waits }),
    listWorkspaces: () => listCmuxWorkspacesThrough({ harness }),
    listWorkspacesStrict: () => client.listWorkspacesStrict(),
    pinWorkspace: (options) => client.pinWorkspace(options),
    processTree: (options) => client.processTree(options),
    readResumeBinding: (options) => client.readResumeBinding(options),
    readScreen: (options) => client.readScreen(options),
    readScreenGrid: (options) => client.readScreenGrid(options),
    renameWorkspace: (options) => client.renameWorkspace(options),
    resolveWorkspace: async ({ ref }) =>
      (await harness.resolve({ handle: ref })).map((target) => cmuxWorkspaceFromSession({ session: target.session })),
    sendLine: (options) => client.sendLine(options),
    submitComposer: (options) => client.submitComposer(options),
    topologyStrict: () => client.topologyStrict(),
    unpinWorkspace: (options) => client.unpinWorkspace(options),
    workspaceTop: (options) => client.workspaceTop(options),
  };
}

/**
 * Run one body against the live session harness and the cmux host surface beside it, over ONE connection closed
 * afterwards whatever happens.
 *
 * @param body what to do with the harness and the host surface
 * @returns whatever `body` returned
 */
export async function withCmuxSessionHost<T>({
  body,
}: {
  body: (options: { harness: SessionHarness; host: CmuxHostSurface & CmuxHostReach }) => Promise<T>;
}): Promise<T> {
  return withCmuxClient({
    body: ({ client }) => {
      const harness = cmuxSessionHarnessOver({ client, waits: realReachWaits() });
      return body({ harness, host: cmuxHostSurfaceOver({ client, harness }) });
    },
  });
}

/**
 * Every live session, as cmux workspace rows, over a connection opened and closed for this one call — the shape
 * for a verb that needs the inventory once and nothing else.
 *
 * @returns the rows, or the harness's typed failure
 */
export async function listLiveCmuxWorkspaces(): Promise<Result<readonly CmuxWorkspaceSummary[], SessionHarnessError>> {
  return withCmuxSessionHost({ body: ({ harness }) => listCmuxWorkspacesThrough({ harness }) });
}
