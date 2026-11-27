/**
 * A salvage's PUSH half, split out of `./pruneSalvage` (which captures the work) along the seam between making
 * a commit and publishing one: the exact push argv, and the confirmation a removal waits on. The armour is
 * `./salvageHooksOff`'s, the one repository every read and the push reach is `./salvageDestination`'s, and the
 * history the pushed commit must stay within is `./salvageTrunkHistory`'s.
 */
import { type GithubPushEdges, pushAndVerify } from "../admit/githubPush.js";
import { isSecretHit, scanContent } from "../hygiene/scan.js";
import type { SalvageOutcome, SalvageScan } from "./pruneSalvage.js";
import { type HostJudge, resolveDestination } from "./salvageDestination.js";
import { HOOKS_OFF } from "./salvageHooksOff.js";
import { type CheckedHistory, pushableSha } from "./salvageTrunkHistory.js";

/**
 * The same git edges with {@link HOOKS_OFF} in front of every command that does not already carry it — for
 * `pushAndVerify`, which is shared with `github push` and issues its own status read and read-back. Left
 * bare, that status read runs a configured `core.fsmonitor` AFTER the destination was resolved and the
 * scan read it, and a monitor writing a `pushInsteadOf` there re-routes the push to a url nothing scanned
 * against.
 *
 * @param deps the git edges to wrap
 * @returns the wrapped edges
 */
export function armoured({ deps }: { deps: GithubPushEdges }): GithubPushEdges {
  const withHooksOff = ({ args }: { args: readonly string[] }): readonly string[] =>
    args.slice(0, HOOKS_OFF.length).join("\0") === HOOKS_OFF.join("\0") ? args : [...HOOKS_OFF, ...args];
  return {
    ...deps,
    readGit: ({ args, cwd }) => deps.readGit({ args: withHooksOff({ args }), cwd }),
    writeGit: ({ args, cwd }) => deps.writeGit({ args: withHooksOff({ args }), cwd }),
  };
}

/**
 * A decline reason as it may be printed. A git failure's message carries its argv and its stderr, and both can
 * name a url with a token in its userinfo or its query, so every `scheme://` url
 * is withheld whole, and a reason still matching a credential pattern or the private denylist after that is
 * withheld whole rather than half-redacted.
 *
 * @param text the decline reason, possibly quoting git
 * @param denylist the private secret strings the payload scan applied, applied again here
 * @returns the reason with urls withheld, or a line saying it was withheld
 */
export function withheldIfSecret({ text, denylist }: { text: string; denylist: readonly string[] }): string {
  const masked = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s'"]+/gi, "$1<url withheld>");
  const secret = scanContent({ content: masked, denylist, path: "" }).some((hit) => isSecretHit({ label: hit.label }));
  if (secret) {
    return "its reason is withheld because it matches a secret pattern — nothing was pushed";
  }
  return masked;
}

/**
 * The exact `git push` a salvage runs, including the lease that makes "this ref is free" ATOMIC.
 *
 * `--force-with-lease=<ref>:` with an EMPTY expected value is git's way of saying the ref must not yet
 * exist, checked by the receiving end as part of the same update rather than by the sender beforehand. That
 * is the whole reason this is not just `push <target>:<target>`, and a review pass is why it is here: the
 * `./pruneSalvage`'s `freeSalvageName` probe reserves nothing, so between the probe answering "absent" and this push
 * landing, another actor can create the branch — and a plain push would then FAST-FORWARD theirs and the
 * read-back would call it a success. Reproduced against a real bare remote before this flag existed.
 *
 * The probe is still worth running. It turns the common case into a different branch name instead of a
 * failed push, and this lease turns the racing case into a refusal instead of damage.
 *
 * The refspec's source is the SHA, never the branch name: the secrets scan read exactly that commit, and a
 * name could move between the scan and the transport opening, publishing a commit nobody scanned. It is
 * spelled `<sha>^{commit}` because a bare 40-hex source resolves to a same-named local BRANCH first. The
 * destination is the literal url the scan asked, never the remote's name, which could be re-pointed in
 * between. And `--recurse-submodules=no` holds whatever `push.recurseSubmodules` says, because a submodule's
 * commits live in a database the scan never opens, and `--no-follow-tags` holds `push.followTags`, whose
 * annotated tags carry messages the scan never read.
 *
 * @param url the one literal url the scan asked, resolved by `./salvageDestination`'s `resolveDestination`
 * @param target the branch, which must not already exist on that remote
 * @param sha the commit the secrets scan read, and the only one this push may send
 * @returns the argv for `git`, lease first so a reader sees the condition before the refspec
 */
export function salvagePushArgs({ url, target, sha }: { url: string; target: string; sha: string }): readonly string[] {
  return [
    ...HOOKS_OFF,
    "push",
    "--recurse-submodules=no",
    "--no-follow-tags",
    `--force-with-lease=refs/heads/${target}:`,
    url,
    `${sha}^{commit}:refs/heads/${target}`,
  ];
}

/**
 * Push the capture's commit, once it passes `./salvageTrunkHistory`'s `pushableSha`, to the url its trunk was read
 * from — the ONLY way a salvage pushes, so no sha reaches the push without that check.
 *
 * @param checked what the history check accepted
 * @param deps the git edges
 * @param home the state home whose push-root register judges the push
 * @param host the host judge, the one the history check resolved its url with
 * @param path the worktree to push from
 * @param remote the remote to push to
 * @param scan the secrets scan over what the push would send
 * @param target the branch to push, already proven free
 * @returns the branch when the remote confirmed it, or why the tree must be kept
 */
export function pushCheckedHistory({
  checked,
  deps,
  home,
  host,
  path,
  remote,
  scan,
  target,
}: {
  checked: CheckedHistory;
  deps: GithubPushEdges;
  home: string;
  host: HostJudge;
  path: string;
  remote: string;
  scan: SalvageScan;
  target: string;
}): SalvageOutcome {
  const sha = pushableSha({ checked, deps, path, remote });
  if (sha.isErr()) {
    return { branch: null, declined: sha.error.message };
  }
  return confirmOnRemote({ checkedUrl: checked.url, deps, home, host, path, remote, scan, sha: sha.value, target });
}

/**
 * Push the branch the steps just built, and believe it only once the remote reports the same commit.
 *
 * Private, and reached only through {@link pushCheckedHistory}: it pushes whatever sha it is handed, so the one
 * caller is the one that held that sha to the checked history first. The sha is read AFTER the commit steps,
 * because a step moved HEAD: pushing the sha from before it would put the tree's PARENT on the remote and then
 * delete the tree holding the child. The url resolved here must be the one the remote's live trunk was read from,
 * or nothing is sent.
 *
 * **The secrets scan runs HERE, with today's scanner, and the tree's own `pre-push` hook does not run at
 * all.** That hook is the week-old tree's lefthook running the week-old tree's lint lane: measured
 * 2026 at eight minutes a tree and red on stale config, so every salvage was kept and the nightly budget went
 * on two of them — `./salvageScan` carries the measurement. Its purpose was the secrets scan, and pushing a
 * week-old tree unscanned would be worth less than the work being captured, so the injected scan
 * reads every blob the destination's default branch does not already carry and declines on a secret. The sha is
 * fixed and the remote's url resolved once: the scan reads that sha at that url, and the push and its read-back
 * send and ask that same sha at that same url, so neither a commit nor a re-pointed remote in between is ever
 * what gets sent. `pushAndVerify`'s own working-tree
 * check still runs; its `prePushGate` edge is withheld, and the push argv already carries {@link HOOKS_OFF},
 * so git runs no hook either. A decline here loses nothing: every byte the capture preserves is already an
 * immutable commit on the salvage ref, and the tree is KEPT.
 *
 * @param deps the git edges, shared with `github push` so the read-back is the same one
 * @param scan the secrets scan over what the push would send
 * @param path the worktree to push from
 * @param remote the remote to push to
 * @param target the branch to push, already proven free
 * @returns the branch when the remote confirmed it, or why the tree must be kept
 */
function confirmOnRemote({
  checkedUrl,
  deps,
  home,
  host,
  path,
  remote,
  scan,
  sha: localSha,
  target,
}: {
  /** The url the remote's live trunk was read from; the push goes there or nowhere. */
  checkedUrl: string;
  deps: GithubPushEdges;
  /** The state home whose push-root register judges the salvage push: a salvage never bypasses the guard. */
  home: string;
  /** The host judge the history check resolved its url with. */
  host: HostJudge;
  path: string;
  remote: string;
  scan: SalvageScan;
  /** The commit to push, read after the capture's steps and already held to the checked history. */
  sha: string;
  target: string;
}): SalvageOutcome {
  const destination = resolveDestination({ deps, host, path, remote });
  if (destination.isErr()) {
    return { branch: null, declined: `${destination.error.message} — nothing was pushed` };
  }
  const url = destination.value;
  if (url !== checkedUrl) {
    return { branch: null, declined: `${remote}'s url changed after its live trunk was read — nothing was pushed` };
  }
  // Scanned and pushed as ONE immutable sha to ONE literal url, so neither a moved HEAD nor a re-pointed
  // remote between the two is ever what gets sent.
  const scanned = scan({ path, sha: localSha, target, url });
  if (scanned !== null) {
    return { branch: null, declined: scanned };
  }
  const pushed = pushAndVerify({
    deps: { ...armoured({ deps }), prePushGate: undefined },
    home,
    plan: {
      branch: target,
      defaultBranch: "",
      forceWithLease: false,
      gitArgs: salvagePushArgs({ sha: localSha, target, url }),
      localSha,
      purpose: "worktree-salvage",
      remote: url,
      remoteBranchSha: undefined,
      repo: "",
      repoRoot: path,
    },
  });
  if (pushed.kind === "pushed") {
    return { branch: target, declined: null };
  }
  return { branch: null, declined: `the remote did not confirm the work — ${pushed.reason}` };
}
