/**
 * Which trees the SUPERVISOR runs on — the pure half of the third standing session `session standing` grades.
 *
 * ## The gap this closes
 *
 * Measured: `session close-done` landed and only 8 of the 22
 * live worktrees carried it. The supervisor escapes that by invoking the MAIN checkout's `bin/slopweaver` by
 * absolute path, which `skills/supervisor/SKILL.md` requires and AGENTS.md restates — so the main checkout is
 * the CLI the supervisor actually runs, and the one every other session reads through when it is told to. The
 * mechanical half of the fix landed as `checkout sync`. What stayed ungraded is the half
 * `session standing` owns: it measures the loop's and the scheduler's two trees each and NO tree for the
 * supervisor or for the main checkout, so both could drift exactly as the loop's did and the one
 * gauge a supervisor runs would say nothing.
 *
 * ## Its two trees are not the same two the loop has
 *
 * A standing session's `bin` is normally resolved from a live pid's argv (`./inspect.ts`'s
 * {@link import("./inspect.js").standingTreeTargets}). That is wrong here, and wrong in the direction that
 * hides the failure: the supervisor's cwd is an ordinary handover worktree — measured live, the
 * pinned workspace sat in `.claude/worktrees.noindex/fresh-supervisor-handoff-<n>` — while the CLI it is
 * required to invoke lives somewhere else entirely. Anchoring on the workspace's own checkout would report a
 * freshly-cut worktree as `current` while the binary every one of its commands actually ran was days behind.
 *
 * So the roles are read from the CONTRACT rather than from a process table:
 *
 * - **`bin`** — the declared main checkout that carries `bin/slopweaver`. Measured whether or not a supervisor
 *   session is open, because it is the tree every session invoking the absolute path reads through.
 * - **`plugin-dir`** — the skill prose the live supervisor is FOLLOWING, from its `claude --plugin-dir` argv.
 *   Absent when no supervisor session is open, which is a plain fact and not an alert: whether the owner's single
 *   intake chat is open is theirs to decide, not a defect this gauge gets to report.
 *
 * ## Resolution is exact, and a non-resolution is stated
 *
 * The pinned workspace is selected by `pinned` AND an exact title match, the same correlation
 * `.claude/rules/cross-session-messages.md` names — and, as that file says, a correlation is never an
 * authentication. cmux enforces no single-pin invariant of its own (`../../cmux/pin.ts`), so two pinned
 * supervisor workspaces is a shape that really occurs; it resolves to nothing and says so, rather than
 * picking the first and grading a tree nobody is running.
 *
 * Pure: the filesystem question "does this checkout carry the CLI" arrives as an injected predicate.
 */
import type { CmuxWorkspaceSummary } from "../../cmux/client.js";

/**
 * The third standing session's own name — the label a graded report, a stream event and a remedy sentence all
 * key off. Declared here rather than beside `LOOP_SESSION` and `SCHEDULER_SESSION` in the CLI, because
 * `./streamEvents.ts` needs it to pick the right remedy and `live/` never imports out of `cli/`.
 */
export const SUPERVISOR_SESSION = "supervisor";

/** The title cmux shows for the owner's single intake chat — what `/slopweaver:supervisor` names its workspace. */
export const SUPERVISOR_WORKSPACE_TITLE = "/slopweaver:supervisor";

/**
 * The repo-relative prefixes whose change makes the SUPERVISOR stale rather than merely behind — its own
 * answer to `../../lib/loopChainPaths.ts`'s question, and deliberately a different list.
 *
 * The loop chain's list is about a bot answering in Slack. The supervisor's two trees are about a CLI and a
 * body of prose: `src` and `bin` are the binary every session invoking the absolute path runs, and `skills`,
 * `.claude/rules` and `AGENTS.md` are what the chat is following. The finding that produced this file is the
 * proof the two lists cannot be one: `session close-done` landed under `src/cli/commands/session/`, which is
 * on the loop chain's list nowhere at all, and only 8 of 22 live worktrees carried it.
 *
 * It is deliberately BROAD where the loop's is narrow, and the asymmetry is about the cost of the remedy
 * rather than about severity. A stale loop costs a respawn — expensive, so its list is enumerated tightly to
 * keep the alert rare. A stale main checkout costs one mechanical `checkout sync`, so alerting on any change
 * to the code it runs is both accurate and cheap to act on. `docs` is excluded on the same test: it is read
 * on demand, never followed.
 */
export const SUPERVISOR_CHAIN_PATHS: readonly string[] = [".claude/rules", "AGENTS.md", "bin", "skills", "src"];

/** The path, relative to a checkout root, that makes it a Slopweaver checkout rather than any other repository. */
export const SUPERVISOR_CLI_RELATIVE_PATH = "bin/slopweaver";

/** One resolution attempt: what it found, and every reason it found nothing. */
export interface SupervisorResolution<T> {
  /** The resolved value, or `undefined` when nothing resolved exactly. */
  readonly value: T | undefined;
  /** Why it did not resolve, or what was ambiguous. Empty when `value` is set. */
  readonly problems: readonly string[];
}

/**
 * The one pinned supervisor workspace, or nothing plus the reason.
 *
 * @param workspaces every cmux workspace, as `workspace.list` reported them
 * @returns the workspace, or `undefined` with the problems that stopped it resolving
 */
export function resolveSupervisorWorkspace({
  workspaces,
}: {
  readonly workspaces: readonly CmuxWorkspaceSummary[];
}): SupervisorResolution<CmuxWorkspaceSummary> {
  const matches = workspaces.filter((workspace) => workspace.pinned && workspace.title === SUPERVISOR_WORKSPACE_TITLE);
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) {
    return { problems: [], value: only };
  }
  if (matches.length === 0) {
    return {
      problems: [
        `no workspace is both pinned and titled ${SUPERVISOR_WORKSPACE_TITLE} — the supervisor's plugin-dir is ` +
          "not measured, which is a fact about what is open rather than a fault",
      ],
      value: undefined,
    };
  }
  return {
    problems: [
      `${String(matches.length)} workspaces are pinned and titled ${SUPERVISOR_WORKSPACE_TITLE} ` +
        `(${matches.map((workspace) => workspace.currentDirectory).join(", ")}) — cmux enforces no single-pin ` +
        "invariant, so which one the owner reads is unknowable here and neither is graded",
    ],
    value: undefined,
  };
}

/**
 * The declared main checkout the supervisor's absolute-path CLI lives in.
 *
 * Selected by carrying the CLI rather than by name or by position: a state home legitimately declares several
 * main checkouts (this machine declares two — the Slopweaver repository and an unrelated application), and
 * only one of them is the tree an absolute-path `slopweaver` runs out of.
 *
 * @param checkoutPaths every declared main checkout's absolute path
 * @param carriesCli whether one checkout carries {@link SUPERVISOR_CLI_RELATIVE_PATH} — injected, so this
 *   stays pure
 * @returns the checkout path, or `undefined` with the problem that stopped it resolving
 */
export function resolveSupervisorBinCheckout({
  checkoutPaths,
  carriesCli,
}: {
  readonly checkoutPaths: readonly string[];
  readonly carriesCli: (options: { readonly path: string }) => boolean;
}): SupervisorResolution<string> {
  if (checkoutPaths.length === 0) {
    return {
      problems: [
        "no main checkouts are declared, so the CLI every session reads through by absolute path is UNMEASURED " +
          "— add a `mainCheckouts` array to $SLOPWEAVER_HOME/profile.json; see docs/main-checkouts.md",
      ],
      value: undefined,
    };
  }
  const carrying = checkoutPaths.filter((path) => carriesCli({ path }));
  const [only] = carrying;
  if (carrying.length === 1 && only !== undefined) {
    return { problems: [], value: only };
  }
  if (carrying.length === 0) {
    return {
      problems: [
        `none of the ${String(checkoutPaths.length)} declared main checkouts carries ` +
          `${SUPERVISOR_CLI_RELATIVE_PATH}, so the CLI the supervisor invokes by absolute path is UNMEASURED`,
      ],
      value: undefined,
    };
  }
  return {
    problems: [
      `${String(carrying.length)} declared main checkouts carry ${SUPERVISOR_CLI_RELATIVE_PATH} ` +
        `(${carrying.join(", ")}) — which one an absolute path names is unknowable here, so neither is graded`,
    ],
    value: undefined,
  };
}
