/**
 * The {@link VisibleSessionPlan} for one WITNESS worker — a leaf beside `./plan.ts` rather than inside it, so
 * that file stays under its size cap. Pure, like every planner there.
 */
import type { VisibleSessionHost } from "../supervisor/session.js";
import { planAskSession, type VisibleSessionPlan } from "./plan.js";
import {
  deriveWorkspaceTitle,
  dispatchSessionName,
  dispatchWorkspaceName,
  WORKSPACE_TITLE_MAX_LENGTH,
} from "./planNames.js";

/**
 * A {@link VisibleSessionPlan} for one witness worker — the visible session that checks a single claim made in
 * a thread another bot was tagged in, and posts only when what it finds is material (`../live/witness/`).
 *
 * `planAskSession`'s plan, for the same reason: the current checkout, no worktree, nothing forked, because
 * checking a claim is investigation, not code. Only its names change: the `witness` role, so its workspace
 * and harness name can never be mistaken for an ask's worker or reviewer over the same message. It carries no
 * `respondingToHandle`: a witness answers nobody who asked it anything.
 *
 * @param channel the thread's channel, for the workspace's addressing id only
 * @param messageTs the witnessed message's ts, for the workspace's addressing id only
 * @param text the witnessed message's text, for the workspace's human-readable title
 * @param branch the current checkout's own branch, for the plan's own record
 * @param effort how hard the worker should think — `modelPin.ts`'s `opusSpawnEffort` decides it — or absent
 * @param host which model CLI boots this workspace
 * @param model the model tier or id to pin the worker to at boot, always named by the caller
 * @param pickupCommand the exact line to send once the session has booted — `slopweaver witness resume <id>`
 * @param repoRoot the current checkout's absolute path — both `repoRoot` and `cwd`, since nothing is created
 * @param spawnedAt the already-captured wall-clock time of this spawn, ISO 8601
 * @returns the plan
 */
export function planWitnessSession({
  channel,
  messageTs,
  text,
  ...shared
}: {
  channel: string;
  messageTs: string;
  text: string;
  branch: string;
  effort?: string;
  host: VisibleSessionHost;
  model: string;
  pickupCommand: string;
  repoRoot: string;
  spawnedAt: string;
}): VisibleSessionPlan {
  const asAsk = planAskSession({
    ...shared,
    askChannel: channel,
    askMessageTs: messageTs,
    askQuestion: text,
    respondingToHandle: undefined,
  });
  return {
    ...asAsk,
    sessionName: dispatchSessionName({ askChannel: channel, askMessageTs: messageTs, role: "witness" }),
    workspaceName: dispatchWorkspaceName({ askChannel: channel, askMessageTs: messageTs, role: "witness" }),
    workspaceTitle: `witness: ${deriveWorkspaceTitle({ askQuestion: text })}`.slice(0, WORKSPACE_TITLE_MAX_LENGTH),
  };
}
