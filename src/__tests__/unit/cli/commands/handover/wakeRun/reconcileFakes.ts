/*
 * The reconcile half of `./harness.ts`'s `fakes`: the seams `handover wake` reads a park's landing through, a head
 * and a branch read off per-case tables, the run checkout's origin, and the REAL `handover close` write.
 */
import { err, ok } from "#lib/result.js";

import { productionClose } from "../../../../../../cli/commands/handover/wakeReconcile.js";
import type { HandoverWakeDeps } from "../../../../../../cli/commands/handover/wakeRows.js";
import { WorktreeCommitErrors } from "../../../../../../cli/commands/handover/wakeWorktreeCommit.js";
import { GithubLiveErrors } from "../../../../../../live/github/errors.js";
import type { Recorded } from "./fixtures.js";

/** The commit every faked pull request's head points at, and every worktree stands on unless `commits` says else. */
export const HEAD_OID = "a".repeat(40);

/** One worktree's faked `git status`: its commit, its dirtiness and, when a case names one, the branch `HEAD` names. */
export interface FakeCommit {
  readonly oid: string;
  readonly dirty: boolean;
  readonly branch?: string;
}

/**
 * The branch a worktree path a case does not name has out: its last segment, less a `wt-` prefix — `/wt/asked` and
 * `<home>/wt-asked` both have `asked` out, the slug every case's own pull request is headed on.
 */
function pathBranch({ cwd }: { cwd: string }): string {
  return cwd.split("/").pop()!.replace(/^wt-/u, "");
}

/**
 * A head read off a per-pull-request table — a failed read for any number it does not name, so a case that names
 * none reconciles every ended park as `unknown` and keeps the old path — a branch read that answers what `branches`
 * names per worktree, an origin read that answers `origin` for every checkout, a worktree commit read that answers
 * {@link HEAD_OID}, clean, on the path's own branch, wherever `commits` names nothing, and the real close.
 *
 * @param branches the branch each worktree has out, by path; `null` is detached
 * @param commits each worktree's commit, dirtiness and branch, by path; `null` is a worktree that does not read
 * @param heads each pull request's head branch, by number; its head lives in the pull request's own repository
 * @param origin the `owner/repo` every checkout's `origin` names, or `null` for an origin that does not read
 * @param recorded where each head read is logged
 * @returns the five reconcile seams
 */
export function reconcileFakes({
  branches,
  commits,
  heads,
  origin,
  recorded,
}: {
  branches: Readonly<Record<string, string | null>>;
  commits: Readonly<Record<string, FakeCommit | null>>;
  heads: Readonly<Record<number, string>>;
  origin: string | null;
  recorded: Recorded;
}): Pick<HandoverWakeDeps, "close" | "readBranch" | "readOrigin" | "readPrHead" | "readWorktreeCommit"> {
  return {
    close: productionClose,
    readWorktreeCommit: ({ cwd }) => {
      const commit = commits[cwd];
      if (commit === null) {
        return err(WorktreeCommitErrors.unreadable({ message: `no worktree at ${cwd}` }));
      }
      if (commit === undefined) {
        return ok({ branch: pathBranch({ cwd }), dirty: false, oid: HEAD_OID });
      }
      const { branch = pathBranch({ cwd }), dirty, oid } = commit;
      return ok({ branch, dirty, oid });
    },
    readBranch: ({ cwd }) => {
      const branch = branches[cwd];
      if (branch === undefined) {
        return err({ kind: "io", message: `no branch for ${cwd}`, operation: "git branch --show-current" });
      }
      return ok(branch);
    },
    readOrigin: () => {
      if (origin === null) {
        return err(["no `origin` git remote found"]);
      }
      const [owner, repo] = origin.split("/");
      return ok({ owner: owner!, repo: repo! });
    },
    readPrHead: async ({ number, repo }) => {
      recorded.headReads.push(`${repo}#${String(number)}`);
      const headRefName = heads[number];
      if (headRefName === undefined) {
        return err(GithubLiveErrors.readFailed({ message: "no head in the table" }));
      }
      return ok({ headRefName, headRefOid: HEAD_OID, headRepository: repo, state: "MERGED" });
    },
  };
}
