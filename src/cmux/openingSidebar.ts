/**
 * The sidebar row a spawn publishes for a freshly-opened workspace, before its host has even booted — split out
 * of `./spawn.ts`, whose own header says why a spawn writes the sidebar at all. Every write here is a
 * decoration: a failure is logged and ignored, never a refused spawn.
 */
import { logger } from "#lib/logger.js";
import { colourForRole, type SessionRole } from "./role.js";
import {
  type CmuxCli,
  readWorkspaceTitles,
  setStatusPill,
  setWorkspaceColour,
  setWorkspaceTitle,
  WORKSPACE_REF_STATUS_ICON,
  WORKSPACE_REF_STATUS_KEY,
  WORKSPACE_REF_STATUS_PRIORITY,
} from "./sidebar.js";
import { decideTitleRepair } from "./title.js";

/** The just-created workspace, by id (what every write is addressed to) and by ref (what the ref pill shows). */
interface OpenedRow {
  readonly workspaceId: string;
  readonly workspaceRef: string;
}

/**
 * Replace the row's title when it would otherwise read as a host's generic default.
 *
 * A workspace is created with `--name <slug>`, but that only SEEDS the pane's terminal title, and Claude
 * Code overwrites it with whatever it is calling itself — which for a session that has not started work yet
 * is the literal string `Claude Code`. Measured: four rows read `✳ Claude Code` at the same
 * time, every one a handover spawn with a good slug, and all four identical.
 *
 * The custom title is the only field the pane cannot overwrite, so it is what gets set — but only for a bare
 * row, and never over a title anybody chose. `./title.ts` holds that decision; this is its shell.
 *
 * A failure is reported and ignored, exactly like the colour and the pill beside it: the session is about
 * to be given real work, and refusing a spawn over a decoration would destroy that.
 *
 * @param cli the sidebar seam to publish through
 * @param fallbackTitle the plan's own workspace title, set only over a bare row
 * @param workspace the just-created workspace
 */
function repairBareTitle({
  cli,
  fallbackTitle,
  workspace,
}: {
  cli: CmuxCli;
  fallbackTitle: string;
  workspace: OpenedRow;
}): void {
  const titles = readWorkspaceTitles({ cli });
  if (titles.isErr()) {
    logger.error({
      msg: `cmux spawn: the workspace opened, but its title could not be checked: ${titles.error.message}`,
    });
    return;
  }
  const row = titles.value.find((each) => each.workspaceId === workspace.workspaceId);
  if (row === undefined) {
    return;
  }
  const repair = decideTitleRepair({
    customTitle: row.customTitle,
    fallbackTitle,
    hasCustomTitle: row.hasCustomTitle,
    renderedTitle: row.renderedTitle,
  });
  if (repair.kind === "leave") {
    return;
  }
  const renamed = setWorkspaceTitle({ cli, title: repair.title, workspaceRef: workspace.workspaceId });
  if (renamed.isErr()) {
    logger.error({
      msg: `cmux spawn: the workspace opened, but its title could not be set: ${renamed.error.message}`,
    });
  }
}

/**
 * Publish the freshly-opened workspace's own sidebar row, before its host has even booted.
 *
 * Addressed by workspace **id**, never by ref: a `workspace:N` ref that names nothing silently addresses the
 * FOCUSED surface instead (see `client.ts`'s `CmuxTarget`), and the focused surface during a spawn is the
 * supervisor's own — so a stale ref here would overwrite the row of the session doing the spawning. The id is
 * a UUID cmux has just handed back, and `--workspace <uuid>` resolves it (measured).
 *
 * Beside the title repair and the role colour goes **the ref pill**: the supervisor addresses a session as
 * `workspace:266` and briefs the owner in the same vocabulary, but until it existed that token appeared nowhere
 * on the row it names, so a briefing line was unfindable in the sidebar it referred to. The
 * value published is the ref VERBATIM rather than a shortened `ws:266`, because it is the exact token `cmux
 * --workspace` accepts and a second spelling would only be a second thing to translate. It is written from the
 * ref cmux has just returned, so no read is needed to find it.
 *
 * **No checklist and no status lane go up**, from here or from anywhere else in Slopweaver: the owner reads
 * neither and depends on Queue cards and floating notes for a seat's state, and producing them
 * would only waste tokens. cmux still infers its own lane from the session's activity; nothing pins one.
 *
 * A failure is reported and ignored, exactly as in the handover lifecycle: the workspace is real and the
 * session is about to be given real work, and refusing a spawn over a decoration would destroy that.
 *
 * @param cli the sidebar seam to publish through — `SpawnDeps.sidebarCli`
 * @param fallbackTitle the plan's own workspace title, set only over a bare row
 * @param role the session's role, which picks the row's colour
 * @param workspace the just-created workspace
 */
export function publishOpeningSidebar({
  cli,
  fallbackTitle,
  role,
  workspace,
}: {
  cli: CmuxCli;
  fallbackTitle: string;
  role: SessionRole;
  workspace: OpenedRow;
}): void {
  repairBareTitle({ cli, fallbackTitle, workspace });
  const colour = setWorkspaceColour({ cli, colour: colourForRole({ role }), workspaceRef: workspace.workspaceId });
  if (colour.isErr()) {
    logger.error({
      msg: `cmux spawn: the workspace opened, but its role colour could not be published: ${colour.error.message}`,
    });
  }
  const pill = setStatusPill({
    cli,
    icon: WORKSPACE_REF_STATUS_ICON,
    key: WORKSPACE_REF_STATUS_KEY,
    priority: WORKSPACE_REF_STATUS_PRIORITY,
    value: workspace.workspaceRef,
    workspaceRef: workspace.workspaceId,
  });
  if (pill.isErr()) {
    logger.error({
      msg: `cmux spawn: the workspace opened, but its ref pill could not be published: ${pill.error.message}`,
    });
  }
}
