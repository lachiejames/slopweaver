/**
 * When a close may skip cmux's running-process confirmation.
 *
 * From cmux 0.65.2 `workspace.close` answers `confirmation_required` ("Workspace has a running process; retry
 * with --force") for any workspace with a live process, and a finished seat's idle `claude` at its prompt is one.
 * MEASURED: `slopweaver cmux close workspace:1000000008` and `session close-done` both failed every
 * finished seat that way, three at once. The force is safe exactly where the screen POSITIVELY proves the seat
 * idle: {@link judgeScreen}'s `idle` — no turn running, no background shell or Monitor on its footer, nothing
 * queued — AND some host's own composer at the bottom of the screen (`../cmux/turnState.ts`'s
 * `screenProvesAtRest`: Claude Code's footer under its `❯`, or Codex's `›` composer over its footer, measured). The second half is not redundant: a blank screen carries no running marker either, so
 * `clear; sleep 1000` judges `idle`, and forcing that would kill the process cmux was
 * asking about.
 *
 * Two callers, two shapes. `session close-done` judged its candidate's screen immediately before closing, so it
 * forces up front when that screen proves idle. `cmux close` names a workspace no check has looked at, so it
 * closes unforced first and forces once only on that exact refusal and a fresh proof:
 * {@link closeWorkspaceWithBoundedForce}.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { CmuxClient } from "../cmux/client.js";
import { type CmuxError, isWorkspaceCloseConfirmationRequired } from "../cmux/errors.js";
import { screenProvesAtRest } from "../cmux/turnState.js";
import { judgeScreen, type ScreenVerdict } from "./screenVerdict.js";

/** Why a close may not take force: a screen verdict, or an idle-looking screen with no host's prompt to prove it. */
export type CloseHeldVerdict = Exclude<ScreenVerdict, "idle"> | "unproven";

/** Whether a refused close may be retried with force, and the screen verdict that kept it when not. */
export type CloseForceDecision =
  { readonly kind: "force" } | { readonly kind: "held"; readonly verdict: CloseHeldVerdict };

/**
 * Decide whether a close may skip cmux's running-process confirmation, from the seat's screen alone.
 *
 * @param screen the surface's rendered text, or `undefined` when it could not be read — which holds
 * @returns `force` only for a screen proving Claude Code or Codex idle at its prompt, otherwise `held` with why
 */
export function closeForceDecision({ screen }: { screen: string | undefined }): CloseForceDecision {
  const verdict = judgeScreen({ screen });
  if (verdict !== "idle") {
    return { kind: "held", verdict };
  }
  if (screen === undefined || !screenProvesAtRest({ screen })) {
    return { kind: "held", verdict: "unproven" };
  }
  return { kind: "force" };
}

/** How a bounded close ended when cmux did not fail it. */
export type BoundedWorkspaceClose =
  { readonly kind: "closed"; readonly forced: boolean } | { readonly kind: "held"; readonly verdict: CloseHeldVerdict };

/**
 * Close a workspace no check has looked at: unforced first, then — only when cmux refused it with
 * `confirmation_required` — read its screen once and retry with force once, and only if that screen is idle.
 * At most two close calls and one screen read; every other failure, and a failed forced retry, is returned
 * unchanged.
 *
 * @param client the cmux connection
 * @param workspaceId the resolved workspace to close
 * @returns `closed` (and whether it took force), `held` with the screen verdict, or cmux's own failure
 */
export async function closeWorkspaceWithBoundedForce({
  client,
  workspaceId,
}: {
  client: Pick<CmuxClient, "closeWorkspace" | "readScreen">;
  workspaceId: string;
}): Promise<Result<BoundedWorkspaceClose, CmuxError>> {
  const plain = await client.closeWorkspace({ workspaceId });
  if (plain.isOk()) {
    return ok({ forced: false, kind: "closed" });
  }
  if (!isWorkspaceCloseConfirmationRequired({ error: plain.error })) {
    return err(plain.error);
  }
  const screen = await client.readScreen({ target: { workspaceId } });
  const decision = closeForceDecision({ screen: screen.isOk() ? screen.value : undefined });
  if (decision.kind === "held") {
    return ok(decision);
  }
  const forced = await client.closeWorkspace({ force: true, workspaceId });
  if (forced.isErr()) {
    return err(forced.error);
  }
  return ok({ forced: true, kind: "closed" });
}
