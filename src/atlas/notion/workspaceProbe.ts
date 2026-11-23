/**
 * The Notion walk's first step: ask the bare origin where the client sends it, and learn the workspace root
 * from that landing — or say exactly why there is none.
 *
 * Its own module because it is the one step of the walk that decides whether the walk runs at all, and the
 * one whose failure classes have to be told apart: every page after it is a recorded row whatever happens.
 */
import type { BrowserPageTransport } from "../../browser/pageTransport.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { WalkProgress } from "../kit/walkProgress.js";

import { NOTION_WEB_ORIGIN, NOTION_WORKSPACE_PROBE_PATH, workspaceRootFromFinalUrl } from "./browserPages.js";
import { NotionAtlasErrors, notionAtlasErrorLines } from "./errors.js";

/**
 * The workspace root the probe learned, or why there is none — never a missing root with no reason.
 *
 * Correlated rather than two nullable fields, because a workspace-rooted page recorded as never attempted
 * has to say WHICH of two different facts left it unaddressed: the client landed somewhere with no workspace
 * segment, or the probe's own navigation failed.
 */
export type WorkspaceRootResolution =
  | { readonly root: string; readonly rootMissingBecause: null }
  | { readonly root: null; readonly rootMissingBecause: string };

/** Why a workspace-rooted page is unaddressed when the probe LANDED with no workspace segment. */
const NO_WORKSPACE_SEGMENT_BECAUSE =
  "this page hangs off the workspace root and the probe found no workspace segment in the client's own landing URL";

/** Why a workspace-rooted page is unaddressed when the probe's own navigation failed; the transport's `because` follows. */
const PROBE_NAVIGATION_FAILED_BECAUSE =
  "this page hangs off the workspace root, but the workspace-root probe navigation failed: ";

/** What the recovered probe's progress line opens with, before the transport's own `because`. */
const PROBE_FAILED_PROGRESS_PREFIX = "notion browser: workspace-root probe navigation failed — ";

/** What the recovered probe's progress line closes with: the step the walk takes next. */
const PROBE_FAILED_PROGRESS_SUFFIX = "; continuing without a workspace root";

/**
 * Learn the workspace root by asking for the bare origin and reading where the client sent it.
 *
 * ## A failed NAVIGATION here is one page's failure, not the client's
 *
 * MEASURED: the scheduled `resync-atlas-notion` refused outright on `could not navigate
 * to https://app.notion.com/: spawnSync .../node ETIMEDOUT` (`slopweaver automation status` lists each firing's outcome). Only the
 * `workspace`-rooted pages in `browserPages.ts` hang off the workspace root, and a `NAVIGATION_FAILED` on
 * any OTHER page is already a recorded row rather than a refused walk — so one probe timing out cost every
 * page that never needed it, and the settings pass behind them. Such a failure is now reported on
 * `progress` and answered with no root, which is the rootless walk this atlas already publishes when the
 * client lands with no workspace segment; the workspace-rooted pages carry the probe's own reason.
 * Every OTHER transport code — `SESSION_LOST`, `TRANSPORT_UNAVAILABLE`, `OFF_LEASE_ORIGIN` — is a fact
 * about the whole run, so it still refuses. `clerk/browserWalk.ts`'s `rootFromOrigin` is the same call.
 *
 * The progress line and the stored reason quote `because`, never `message`: `message` interpolates the
 * address, and `because` is the transport's own recordable sentence.
 *
 * @param transport the bound page transport
 * @param progress where the recovered navigation failure is reported; `undefined` discards it
 * @param settleMs how long the probe keeps observing after it settles, the walk's own page settle
 * @returns the workspace root or why there is none, or the reason the client could not be reached at all
 */
export async function resolveWorkspaceRoot({
  transport,
  progress,
  settleMs,
}: {
  transport: BrowserPageTransport;
  progress: WalkProgress | undefined;
  settleMs: number;
}): Promise<Result<WorkspaceRootResolution>> {
  const probe = await transport.visit({ settleMs, url: `${NOTION_WEB_ORIGIN}${NOTION_WORKSPACE_PROBE_PATH}` });
  if (probe.isErr()) {
    const failure = probe.error;
    if (failure.code === "NAVIGATION_FAILED") {
      progress?.({ line: `${PROBE_FAILED_PROGRESS_PREFIX}${failure.because}${PROBE_FAILED_PROGRESS_SUFFIX}` });
      return ok({ root: null, rootMissingBecause: `${PROBE_NAVIGATION_FAILED_BECAUSE}${failure.because}` });
    }
    // The probe asks for the bare ORIGIN, which carries no slug, so quoting the transport's own message is
    // safe HERE and nowhere else — every other visit is addressed at a URL that can carry one.
    return err(notionAtlasErrorLines({ error: NotionAtlasErrors.clientUnreachable({ detail: failure.message }) }));
  }
  const root = workspaceRootFromFinalUrl({ finalUrl: probe.value.finalUrl });
  if (root === null) {
    return ok({ root: null, rootMissingBecause: NO_WORKSPACE_SEGMENT_BECAUSE });
  }
  return ok({ root, rootMissingBecause: null });
}
