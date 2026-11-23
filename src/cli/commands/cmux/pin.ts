/**
 * `slopweaver cmux pin` / `slopweaver cmux unpin` — move the sidebar pin that tells a supervised session the
 * supervisor from a peer (`.claude/rules/cross-session-messages.md`), without the owner's own click.
 *
 * The pin is what `workspace.action`'s own `pin`/`unpin` actions already write (`./run.ts`'s `renameWorkspace`
 * is the same call shape for `rename`). What this verb adds is the refusal cmux itself does not have —
 * `../../../cmux/pin.js`'s `pinCollisionRefusal`, measured to be genuinely necessary: pinning a
 * second workspace left cmux reporting BOTH `pinned: true`.
 */
import type { CmuxError } from "../../../cmux/errors.js";
import { listedPinTarget, type PinRefusal, pinCollisionRefusal } from "../../../cmux/pin.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { listCmuxWorkspacesThrough, withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import type { SessionHarnessError } from "../../../sessionHarness/errors.js";
import { detectSupervisorSession } from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { parseCmuxVerb, stringFlag } from "./core.js";
import { forgetUnpinnedSupervisor, recordSupervisorPin, type StaleRecordOutcome } from "./recordPin.js";
import { targetWorkspaceId } from "./run.js";

/**
 * `cmux pin` — pin a workspace, refusing when a DIFFERENT one is already pinned rather than leaving two.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxPin(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "pin" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const pinned = await withCmuxSessionHost({
    // Every failure stays its own typed value until the one line below that prints it.
    body: async ({
      harness,
      host,
    }): Promise<
      Result<{ readonly ref: string; readonly self: boolean }, CmuxError | PinRefusal | SessionHarnessError>
    > => {
      const target = await targetWorkspaceId({
        env: process.env,
        harness,
        workspaceRef: stringFlag({ name: "workspace", parsed }),
      });
      if (target.isErr()) {
        return err(target.error);
      }
      const workspaces = await listCmuxWorkspacesThrough({ harness });
      if (workspaces.isErr()) {
        return err(workspaces.error);
      }
      const named = listedPinTarget({ targetWorkspaceId: target.value, workspaces: workspaces.value });
      if (named.isErr()) {
        return err(named.error);
      }
      const refused = pinCollisionRefusal({ targetWorkspaceId: target.value, workspaces: workspaces.value });
      if (refused !== undefined) {
        return err(refused);
      }
      const own = await targetWorkspaceId({ env: process.env, harness, workspaceRef: undefined });
      const ref = named.value.workspaceRef;
      return (await host.pinWorkspace({ workspaceId: target.value })).map(() => ({
        ref,
        self: recordSupervisorPin({
          detection: detectSupervisorSession({ env: process.env }),
          nowIso: new Date().toISOString(),
          ownWorkspaceId: own.isOk() ? own.value : undefined,
          pinnedWorkspaceId: target.value,
          workspaceRef: ref,
        }),
      }));
    },
  });
  if (pinned.isErr()) {
    logger.error({ msg: `cmux pin: ${pinned.error.message}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `cmux pin: pinned ${pinned.value.ref}` });
  if (pinned.value.self) {
    logger.out({ line: "cmux pin: recorded this session as the supervisor for the depth guard" });
  }
  return EXIT_OK;
}

/**
 * `cmux unpin` — unpin a workspace. Idempotent: unpinning an already-unpinned workspace is a no-op success,
 * since a caller (a handoff's successor, unpinning its predecessor before pinning itself) cannot know which
 * state it is in without a read it has no other reason to make.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxUnpin(argv: readonly string[]): Promise<number> {
  const parsed = parseCmuxVerb({ argv, verb: "unpin" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const unpinned = await withCmuxSessionHost({
    body: async ({
      harness,
      host,
    }): Promise<Result<{ readonly label: string; readonly stale: StaleRecordOutcome }, string>> => {
      const target = await targetWorkspaceId({
        env: process.env,
        harness,
        workspaceRef: stringFlag({ name: "workspace", parsed }),
      });
      if (target.isErr()) {
        return err(target.error.message);
      }
      const resolved = await harness.resolve({ handle: target.value });
      const label = resolved.isOk() ? resolved.value.session.handle : target.value;
      return (await host.unpinWorkspace({ workspaceId: target.value }))
        .map(() => ({ label, stale: forgetUnpinnedSupervisor({ unpinnedWorkspaceId: target.value }) }))
        .mapErr((cmuxError) => cmuxError.message);
    },
  });
  if (unpinned.isErr()) {
    logger.error({ msg: `cmux unpin: ${unpinned.error}` });
    return EXIT_ERROR;
  }
  logger.out({ line: `cmux unpin: unpinned ${unpinned.value.label}` });
  return unpinned.value.stale === "failed" ? EXIT_ERROR : EXIT_OK;
}

export const cmuxPinCommand = defineCommand({ run: runCmuxPin });

export const cmuxUnpinCommand = defineCommand({ run: runCmuxUnpin });
