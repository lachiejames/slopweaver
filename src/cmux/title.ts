/**
 * Keeping a sidebar row's title from reading `Claude Code`.
 *
 * A cmux row renders its workspace's CUSTOM title when one is set, and otherwise whatever the pane's own
 * terminal process last called itself. Claude Code names that after the task it is working on, which is the
 * best title on the sidebar when it exists — the owner said so, and this module exists to preserve it.
 *
 * The problem is what it says when it has no task: the literal string `Claude Code`. Measured on the live
 * fleet, four of nineteen rows read `✳ Claude Code` at once — every one of them a handover spawn
 * with a perfectly good slug, all four identical, and all four therefore unusable for finding anything.
 *
 * **`--name` at creation does not fix it.** Every one of those four was created with `workspace create
 * --name <slug>`; that only SEEDS the pane title, and the pane overwrites it the moment Claude Code decides
 * what to call itself. The custom title is the only field a pane cannot clobber, so it is the only lever.
 *
 * **Which makes this a repair, not a policy.** Pinning a custom title on every row would throw away exactly
 * the pane titles the owner likes. So the rule is narrow: pin the fallback only at the moment a row would
 * otherwise read as a generic default, and never touch a title that somebody — a human, or a session with
 * something better to say — deliberately set.
 */

/**
 * The titles that carry no information, lower-cased, after the lane glyph is stripped.
 *
 * Matched EXACTLY rather than by prefix, and that is the whole difficulty: `Claude Code` is generic and
 * `Claude Code plugin loader bug` is the best title on the sidebar. A prefix rule would eat the second.
 */
const GENERIC_TITLES = new Set(["", "claude code", "claude", "codex", "codex cli", "shell", "bash", "zsh"]);

/**
 * The lane glyphs cmux prefixes onto a rendered title, which are not part of the title itself.
 *
 * Present on nearly every row (`✳ Claude Code`), so a comparison that does not strip them matches nothing.
 */
const LANE_GLYPHS = /^[✳◐◑●○⚡✴✲]+\s*/u;

/**
 * Whether a rendered row title says nothing about the session it names.
 *
 * @param title the row's rendered title, lane glyph and all
 * @returns true when the title is empty or one of the hosts' own generic defaults
 */
export function isGenericWorkspaceTitle({ title }: { title: string }): boolean {
  const bare = title.replace(LANE_GLYPHS, "").trim().toLowerCase();
  return GENERIC_TITLES.has(bare);
}

/** What to do about one row's title. */
type TitleRepair = { readonly kind: "leave" } | { readonly kind: "set"; readonly title: string };

/**
 * Decide whether a row's title needs replacing, and with what.
 *
 * Pure, and the whole decision lives here so the three call sites that publish to a row share one rule
 * rather than three near-copies of it.
 *
 * The order of the checks is the argument:
 *
 * 1. **A deliberate custom title is never touched**, generic or not. If a human renamed the row, or a
 *    session published a summary of its own through `cmux title`, that is a considered choice and this
 *    repair has no standing to overrule it. Measured live: three rows carried one, including the recipe
 *    scheduler's own status line.
 * 2. **A pane title that says something is left alone**, which is the case this repair exists to protect.
 * 3. **Only a bare row is pinned**, and only to a fallback the caller supplies.
 *
 * A caller with no usable fallback gets `leave`: a row reading `Claude Code` is bad, and replacing it with
 * an empty string or the word `undefined` is worse.
 *
 * @param customTitle the row's custom title, when it has one — used only to tell "we have not pinned this"
 *   from "somebody chose this"
 * @param fallbackTitle what to pin when the row is bare, normally the handover slug
 * @param hasCustomTitle whether a custom title is set at all, which is what makes the row's title deliberate
 * @param renderedTitle the title the row actually shows today
 * @returns the repair to apply, or `leave` when the row already reads well enough
 */
export function decideTitleRepair({
  customTitle,
  fallbackTitle,
  hasCustomTitle,
  renderedTitle,
}: {
  customTitle?: string | undefined;
  fallbackTitle: string;
  hasCustomTitle: boolean;
  renderedTitle: string;
}): TitleRepair {
  if (hasCustomTitle && customTitle !== undefined && customTitle.trim() !== "") {
    return { kind: "leave" };
  }
  if (!isGenericWorkspaceTitle({ title: renderedTitle })) {
    return { kind: "leave" };
  }
  const fallback = fallbackTitle.trim();
  return fallback === "" || isGenericWorkspaceTitle({ title: fallback })
    ? { kind: "leave" }
    : { kind: "set", title: fallback };
}

/**
 * The fallback title for a row, derived from the directory it works in.
 *
 * For every session Slopweaver opens this IS the handover slug: a spawn's worktree is
 * `.claude/worktrees/<slug>`, so the last path segment is the slug and nothing has to be threaded through to
 * get it. For a workspace nobody spawned it is whatever that directory is called, which still beats four
 * identical rows reading `Claude Code`.
 *
 * Taken from the ROW's own directory rather than the calling process's, so a session repairing another row
 * cannot label it with its own slug.
 *
 * @param currentDirectory the row's working directory, absolute
 * @returns the last path segment, or an empty string when there is none
 */
export function fallbackTitleFor({ currentDirectory }: { currentDirectory: string }): string {
  const segments = currentDirectory.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) {
    return "";
  }
  return segments[segments.length - 1]!;
}
