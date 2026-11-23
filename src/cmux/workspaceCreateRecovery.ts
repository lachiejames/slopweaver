/**
 * A `workspace.create` that timed out, or whose connection failed under it, is an UNKNOWN outcome, not a failure —
 * so it is reconciled, never retried.
 *
 * ## The defect, measured
 *
 * MEASURED: under load, cmux took longer than the socket's 15 s bound (`./socket.ts`'s
 * `CMUX_CALL_TIMEOUT_MS`) to answer `workspace.create`. The spawn reported "no workspace was opened" — yet
 * cmux finished the create anyway, twice, each titled
 * `Terminal`, each with an empty process tree. Nothing ever typed a boot line into them. The third spawn booted
 * `workspace:430`. Every timed-out spawn therefore left one dead Terminal in the owner's sidebar and called a workspace
 * that existed a failure. The socket drops the late reply as unmatched, since the timer already gave up on it.
 *
 * ## Why ADOPT, and not close it or wait longer
 *
 * A longer bound only moves the same ambiguity to a later threshold, and makes a genuine hang wait longer.
 * Closing the orphan throws away the workspace the caller still wants. Retrying the create would make two. So
 * {@link createOrAdoptWorkspace} snapshots the inventory before the create, and after an unknown outcome polls it
 * for the workspace that was not there before — and, if exactly one appeared, hands it back as the opened workspace,
 * so the boot line is typed into it and the spawn goes on as if the create had answered in time.
 *
 * A transport failure is the same ambiguity as a timeout: `./socket.ts` writes the frame while the connection may
 * still be opening, so a `SOCKET_UNAVAILABLE` cannot show cmux never read it. That is why the socket never REPLAYS a
 * create — a replay after cmux made one makes a second, which no reconciliation can then tell from a concurrent
 * spawn's — and leaves the one attempt to be reconciled here.
 *
 * ## The identity is cwd plus description, never the title
 *
 * `workspace.create`'s `name` only SEEDS the pane title, and the pane overwrites it (`./title.ts`) — the orphans
 * above read `Terminal`. What does survive is the directory and the description, both of which `workspace.list`
 * echoes exactly as created (MEASURED on fifteen live rows: every spawned one reported the
 * `spawned session` description and the worktree path it was created in). A handover spawn's worktree is unique
 * to its slug; an ask or review session sharing a checkout carries its raw workspace name in the description.
 *
 * That is still a correlation, not an idempotency key cmux issued. A nonce would need a field `workspace.list` echoes,
 * and the only free one is the description the owner's sidebar shows (`./workspaceDescription.ts`), so none is carried.
 * Instead no two creates under one fingerprint overlap: {@link createOrAdoptWorkspace} holds a lock keyed by it from
 * the snapshot through the last reconciliation read, and every `workspace.create` Slopweaver sends goes through it.
 * Without the lock, a concurrent spawn's create landing while this one's was lost was ONE new matching row, which
 * this adopted and typed a second boot line into. Two new matching rows are still refused as ambiguous.
 * A lock alone does not cover a create that ANSWERED and released it before its workspace showed in the next one's
 * snapshot, so each create's workspace is claimed under the lock and never adopted after (`./workspaceCreateClaims.ts`).
 *
 * What it does not cover, stated: a lock lives under a state home, so a process on another home creating under the
 * same fingerprint is outside it; and once a reconciliation gives up, its lost create may still land and be the one
 * empty row the NEXT create under that fingerprint adopts — an orphan nothing booted, never a live session.
 *
 * ## What the snapshot read costs a create that would have answered
 *
 * One inventory read before every create, and nothing else on the success path. When cmux is down for that read,
 * `./socket.ts`'s `withSocketRetry` retires the connection it failed on, so the create opens a fresh one.
 */
import { logger } from "../lib/logger.js";
import { err, ok, type Result } from "../lib/result.js";
import type { CmuxClient, CmuxWorkspace, CmuxWorkspaceSummary } from "./client.js";
import type { CmuxError } from "./errors.js";

/** What a workspace this create made must still look like in the inventory, whatever its pane renamed it to. */
export interface WorkspaceCreateFingerprint {
  readonly currentDirectory: string;
  readonly description: string | undefined;
}

/** What one inventory read says about the workspace a timed-out create may have made. */
export type WorkspaceCreateReconciliation =
  | { readonly kind: "none" }
  | { readonly kind: "adopt"; readonly workspace: CmuxWorkspaceSummary }
  | { readonly kind: "ambiguous"; readonly workspaces: readonly CmuxWorkspaceSummary[] };

/**
 * Which workspace, if any, a timed-out create made: the rows absent from the pre-create snapshot whose directory
 * and description match what was created.
 *
 * @param snapshotWorkspaceIds every workspace id that existed before the create was sent
 * @param workspaces the inventory read after it timed out
 * @param expected the directory and description the create was sent with
 * @returns `adopt` with the one match, `ambiguous` with every match in inventory order, or `none`
 */
export function reconcileWorkspaceCreate({
  snapshotWorkspaceIds,
  workspaces,
  expected,
}: {
  snapshotWorkspaceIds: ReadonlySet<string>;
  workspaces: readonly CmuxWorkspaceSummary[];
  expected: WorkspaceCreateFingerprint;
}): WorkspaceCreateReconciliation {
  const matches = workspaces.filter(
    (row) =>
      !snapshotWorkspaceIds.has(row.workspaceId) &&
      row.currentDirectory === expected.currentDirectory &&
      row.description === expected.description,
  );
  const [only] = matches;
  if (only === undefined) {
    return { kind: "none" };
  }
  if (matches.length > 1) {
    return { kind: "ambiguous", workspaces: matches };
  }
  return { kind: "adopt", workspace: only };
}

/**
 * How many inventory reads a timed-out create gets to show its workspace, one `wait` apart.
 *
 * A chosen composition, not a measurement: matched to `./spawnPolling.ts`'s `MAX_BOOT_POLLS` over the same one-second
 * `wait`, so a create gets as long to surface as a boot gets to be witnessed, on top of the 15 s it already had.
 * It bounds READS, not wall-clock — each read is itself one socket call per window, each with its own bound.
 */
export const MAX_WORKSPACE_CREATE_RECONCILE_POLLS = 15;

/** Said on every failure after a timeout, because none of them can promise the create will not still land. */
const MAY_STILL_APPEAR = "the create may still complete later and leave a workspace nothing has booted";

/** Why a workspace could not be opened, and the ref and id of one that exists if the failure came after finding it. */
export interface WorkspaceOpenFailure {
  readonly reason: string;
  readonly workspaceRef: string;
  /** Set once the inventory has named the workspace; a restart keeps it where it renumbers the ref. */
  readonly workspaceId?: string | undefined;
}

/** One inventory row in a failure line: what a human would need to find it in the sidebar. */
function describeRow({ row }: { row: CmuxWorkspaceSummary }): string {
  return `${row.workspaceRef} (${row.workspaceId}, titled ${String(row.title)}, in ${row.currentDirectory})`;
}

/**
 * Resolve the surface of the one workspace a timed-out create made, refusing it when `pane.list` names another.
 *
 * @param client the surface read
 * @param found the inventory row the reconciliation matched
 * @param createFailure the create's own failure message, which every failure line opens with
 * @returns the adopted workspace's four addresses, or why it could not be typed into
 */
async function adoptFound({
  client,
  found,
  createFailure,
}: {
  client: Pick<CmuxClient, "workspaceSurface">;
  found: CmuxWorkspaceSummary;
  createFailure: string;
}): Promise<Result<CmuxWorkspace, WorkspaceOpenFailure>> {
  const surface = await client.workspaceSurface({ workspaceId: found.workspaceId });
  if (surface.isErr()) {
    return err({
      reason: `${createFailure}; it did make ${describeRow({ row: found })}, but its surface could not be resolved: ${surface.error.message}`,
      workspaceId: found.workspaceId,
      workspaceRef: found.workspaceRef,
    });
  }
  if (surface.value.workspaceRef !== found.workspaceRef) {
    return err({
      reason: `${createFailure}; it did make ${describeRow({ row: found })}, but pane.list named it ${surface.value.workspaceRef}, so nothing was typed into it`,
      workspaceId: found.workspaceId,
      workspaceRef: found.workspaceRef,
    });
  }
  return ok(addressesOf({ workspace: surface.value }));
}

/**
 * Poll the inventory for the workspace a timed-out create made, resolving its surface once exactly one appears.
 *
 * @param client the inventory and surface reads
 * @param wait the pause between reads
 * @param snapshotWorkspaceIds every workspace id that existed before the create was sent
 * @param expected the directory and description the create was sent with
 * @param createFailure the create's own failure message, which every failure line opens with
 * @returns the adopted workspace, or why none could be
 */
async function adoptAfterUnknownCreate({
  client,
  wait,
  snapshotWorkspaceIds,
  expected,
  createFailure,
}: {
  client: Pick<CmuxClient, "listWorkspacesStrict" | "workspaceSurface">;
  wait: () => Promise<void>;
  snapshotWorkspaceIds: ReadonlySet<string>;
  expected: WorkspaceCreateFingerprint;
  createFailure: string;
}): Promise<Result<CmuxWorkspace, WorkspaceOpenFailure>> {
  for (let poll = 1; poll <= MAX_WORKSPACE_CREATE_RECONCILE_POLLS; poll++) {
    const listed = await client.listWorkspacesStrict();
    if (listed.isErr()) {
      return err({
        reason: `${createFailure}; the inventory read looking for the workspace it may have made failed (${listed.error.message}) — ${MAY_STILL_APPEAR}`,
        workspaceRef: "",
      });
    }
    const decision = reconcileWorkspaceCreate({ expected, snapshotWorkspaceIds, workspaces: listed.value });
    if (decision.kind === "ambiguous") {
      const rows = decision.workspaces.map((row) => describeRow({ row })).join(", ");
      return err({
        reason: `${createFailure}; ${String(decision.workspaces.length)} new workspaces match what it was asked to make, so none was adopted or closed: ${rows}`,
        workspaceRef: "",
      });
    }
    if (decision.kind === "adopt") {
      return adoptFound({ client, found: decision.workspace, createFailure });
    }
    if (poll < MAX_WORKSPACE_CREATE_RECONCILE_POLLS) {
      await wait();
    }
  }
  return err({
    reason: `${createFailure}; no new workspace in ${expected.currentDirectory} described ${String(expected.description)} appeared within ${String(MAX_WORKSPACE_CREATE_RECONCILE_POLLS)} inventory reads — ${MAY_STILL_APPEAR}`,
    workspaceRef: "",
  });
}

/** Exactly the four addresses, so nothing else a reply object carried rides into the spawn's outcome. */
function addressesOf({ workspace }: { workspace: CmuxWorkspace }): CmuxWorkspace {
  const { surfaceId, surfaceRef, workspaceId, workspaceRef } = workspace;
  return { surfaceId, surfaceRef, workspaceId, workspaceRef };
}

/**
 * Whether a create's failure leaves its outcome UNKNOWN: a `TIMEOUT`, or a transport failure after the frame may have
 * been written — `./socket.ts` never replays a create, so that failure is the create's one attempt. A cmux error
 * frame, a malformed reply and an access refusal are answers, and are not reconciled.
 *
 * @param error the create's failure
 * @returns true when cmux may have made the workspace anyway
 */
function createOutcomeUnknown({ error }: { error: CmuxError }): boolean {
  if (error.code === "TIMEOUT") {
    return true;
  }
  return error.code === "SOCKET_UNAVAILABLE" && error.reason === "transport-unavailable";
}

/**
 * A held create lock: the workspaces earlier creates under the fingerprint made, and a release taken once, however
 * the create and its reconciliation ended, naming the workspace this one made or adopted so the next never adopts it.
 *
 * @internal — named only through {@link HoldWorkspaceCreate}; a caller destructures the lock it returns.
 */
export interface WorkspaceCreateLock {
  readonly claimed: ReadonlySet<string>;
  readonly release: (options: { readonly made: string | undefined }) => void;
}

/**
 * Take the lock one fingerprint's creates are serialised under, or say why not: another create holds it, or it or its
 * claims (`./workspaceCreateClaims.ts`) could not be read. Production keys an operation lock on
 * {@link workspaceCreateLockKey}; a test passes a plain function.
 */
export type HoldWorkspaceCreate = (options: {
  readonly fingerprint: WorkspaceCreateFingerprint;
}) => Result<WorkspaceCreateLock, string>;

/**
 * The operation-lock key one fingerprint's creates are serialised under: the directory and the description, joined by
 * a NUL neither can carry, so two fingerprints can never share a key.
 *
 * @param fingerprint the directory and description the create is sent with
 * @returns the key the lock is taken under
 */
export function workspaceCreateLockKey({ fingerprint }: { fingerprint: WorkspaceCreateFingerprint }): string {
  const described = fingerprint.description === undefined ? "-" : `+${fingerprint.description}`;
  return `cmux-create:${fingerprint.currentDirectory}\u0000${described}`;
}

/**
 * Create a workspace, and when its outcome is unknown, adopt the one cmux made anyway — under the fingerprint's lock,
 * so no other create's row can be the one adopted.
 *
 * Only an unknown outcome ({@link createOutcomeUnknown}) is reconciled. Every other failure is a real answer — cmux
 * refused, or would not admit this process — and is returned exactly as before. A snapshot that could not be read
 * never spoils a create that answered; it only means a timeout has nothing to diff against, which is said. Every
 * read here is `listWorkspacesStrict`, never the lossy `listWorkspaces` (`./strictInventory.ts` says why). A lock that
 * cannot be held opens nothing: an unserialised create is the one whose lost reply cannot be reconciled safely.
 *
 * @param deps the create, inventory and surface calls; the pause between inventory reads after a timeout; and the
 *   fingerprint lock, held from the snapshot through the last reconciliation read
 * @param name the workspace's title
 * @param cwd the directory to open it in
 * @param description the workspace's description metadata, when the plan has one
 * @returns the opened workspace, created or adopted — an adoption is said on stderr — or why none could be opened
 */
export async function createOrAdoptWorkspace({
  deps: { client, holdWorkspaceCreate, wait },
  name,
  cwd,
  description,
}: {
  deps: {
    client: Pick<CmuxClient, "createWorkspace" | "listWorkspacesStrict" | "workspaceSurface">;
    holdWorkspaceCreate: HoldWorkspaceCreate;
    wait: () => Promise<void>;
  };
  name: string;
  cwd: string;
  description: string | undefined;
}): Promise<Result<CmuxWorkspace, WorkspaceOpenFailure>> {
  const lock = holdWorkspaceCreate({ fingerprint: { currentDirectory: cwd, description } });
  if (lock.isErr()) {
    return err({
      reason: `no workspace was created in ${cwd} described ${String(description)}: ${lock.error} — a second create under the same directory and description could not be told from this one's if either reply were lost`,
      workspaceRef: "",
    });
  }
  let made: string | undefined;
  try {
    const opened = await createOrAdoptHeld({ claimed: lock.value.claimed, client, cwd, description, name, wait });
    made = opened.isOk() ? opened.value.workspaceId : undefined;
    return opened;
  } finally {
    lock.value.release({ made });
  }
}

/**
 * {@link createOrAdoptWorkspace}'s body, run while its fingerprint's lock is held.
 *
 * @param claimed the workspaces earlier creates under the fingerprint made, never adopted however new they read
 */
async function createOrAdoptHeld({
  claimed,
  client,
  wait,
  name,
  cwd,
  description,
}: {
  claimed: ReadonlySet<string>;
  client: Pick<CmuxClient, "createWorkspace" | "listWorkspacesStrict" | "workspaceSurface">;
  wait: () => Promise<void>;
  name: string;
  cwd: string;
  description: string | undefined;
}): Promise<Result<CmuxWorkspace, WorkspaceOpenFailure>> {
  const snapshot = await client.listWorkspacesStrict();
  const created = await client.createWorkspace({ cwd, ...(description === undefined ? {} : { description }), name });
  if (created.isOk()) {
    return ok(addressesOf({ workspace: created.value }));
  }
  if (!createOutcomeUnknown({ error: created.error })) {
    return err({ reason: created.error.message, workspaceRef: "" });
  }
  if (snapshot.isErr()) {
    return err({
      reason: `${created.error.message}; nothing could be adopted, because the inventory read before the create failed (${snapshot.error.message}) — ${MAY_STILL_APPEAR}`,
      workspaceRef: "",
    });
  }
  const adopted = await adoptAfterUnknownCreate({
    client,
    expected: { currentDirectory: cwd, description },
    // A claimed id counts as already there: the snapshot can miss a workspace an earlier create made.
    snapshotWorkspaceIds: new Set([...snapshot.value.map((row) => row.workspaceId), ...claimed]),
    createFailure: created.error.message,
    wait,
  });
  return adopted.map((workspace) => {
    logger.warn({
      msg: `cmux spawn: ${created.error.message}, but it made ${workspace.workspaceRef} — adopted it rather than leave it empty`,
    });
    return workspace;
  });
}
