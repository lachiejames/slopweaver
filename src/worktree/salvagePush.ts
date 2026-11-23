/**
 * A salvage's PUSH half, split out of `./pruneSalvage` (which captures the work) along the seam between making
 * a commit and publishing one: the armour every salvage git call carries, the one repository the scan, the
 * push and the read-back may all reach, the exact push argv, and the confirmation a removal waits on.
 */
import { type GithubPushEdges, pushAndVerify } from "../admit/githubPush.js";
import { isSecretHit, scanContent } from "../hygiene/scan.js";
import { err, ok, type Result } from "../lib/result.js";
import type { SalvageOutcome, SalvageScan } from "./pruneSalvage.js";
import { type SalvageDestinationError, SalvageDestinationErrors } from "./salvageErrors.js";

/**
 * The prefix EVERY git command a salvage runs carries — READS INCLUDED: hooks off, for that one invocation.
 *
 * `--no-verify` is a commit-side flag and does not cover this. `git switch` runs `post-checkout`, and a
 * review pass reproduced a repository whose own `post-checkout` hook ran `git add -- <file>`: the switch
 * fired it, the hook overwrote the index, and the step that exists to capture the index then committed the
 * working-tree version instead. Every later check still passed — two commits, a leased push, a remote
 * reporting the exact sha — and the staged version went with the worktree. **This repository is one of
 * those repositories**: `lefthook.yml` declares a `post-checkout` job, so the case is live, not theoretical.
 *
 * **Reads are not exempt, and a second review pass proved it.** `git status --porcelain` refreshes the index
 * and fires `post-index-change`; a hook running `git add` there overwrites the staged content BEFORE this
 * file has even measured it, so the capture plans two commits over content that is already gone, and every
 * later check still passes. That read is the first thing a salvage does, so arming only the writes armoured
 * nothing.
 *
 * **`core.hooksPath` is not the whole surface, and a third review pass proved that too.**
 * `core.fsmonitor` names an executable git runs to ask which files changed, and it is governed by its OWN
 * config key — pointing `core.hooksPath` at nothing does not stop it. A monitor that runs `git add` on its
 * first invocation overwrites the staged version during the capture's very first `status`, and the pass
 * reproduced exactly that end to end: both commits succeeded, the leased push verified, the tree was
 * removed, and the staged-only blob reached no commit. So both keys are turned off, together.
 *
 * What is deliberately NOT turned off is a `.gitattributes` clean/smudge filter. That is the repository's
 * own declared content transform — LFS is one — so a capture that skipped it would write bytes git would
 * never have written, which is the opposite of preserving what is there. The residue that leaves is the one
 * `core.sshCommand` already states: the filter's command lives in the repository's git config and runs its
 * own code inside `git add`, so a file it writes there after the capture's ignored-file check — an ignored
 * one no commit carries — is outside what the salvage promises.
 *
 * A salvage preserves the bytes that are there. Nothing it runs may rewrite them, and the only way to say
 * that about every hook — including ones this file has never heard of — is to run none, on every invocation.
 * `/dev/null` is a path no hook can live under, so git looks there, finds nothing, and runs nothing.
 *
 * **Exported, because the SCAN needs exactly this armour and must not grow a second copy of it.** A fourth
 * review pass reproduced the same loss one stage earlier: `pruneScan` issues the same `status` and
 * `ls-files` reads, had none of this, and a monitor running `git add` let the SCAN overwrite staged-only
 * content that the capture then faithfully pushed in its overwritten form.
 */
export const HOOKS_OFF: readonly string[] = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

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
 * @param url the one literal url the scan asked, resolved by {@link oneDestination}
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

/** An ssh or https url, or git's scp-like `user@host:path` — each binds a host by its key or certificate. */
const AUTHENTICATED_URL = /^(?:(?:ssh|https|git\+ssh|ssh\+git):\/\/[^/\s]+\/|[^/\s@:]+@[^/\s:]+:(?!\/))/i;

/**
 * The one repository a salvage's scan, push and read-back may all reach, or why there is not exactly one.
 *
 * Pure. `git push <remote>` sends to EVERY push url, `ls-remote <remote>` and the read-back ask the fetch url,
 * so anything but one push url equal to the fetch url is a destination the scan cannot be bound to. Two more
 * shapes make one literal string reach two repositories, and both refuse: a url that is itself
 * a configured remote's NAME, which git resolves back through that remote's own fetch and push urls, and any
 * `url.<base>.pushInsteadOf` or `insteadOf`: `remote get-url` answers with one rewrite applied, and git
 * applies every rule AGAIN to that literal when the scan and push name it, so a chain turns an ssh url the
 * check accepted into a local path. A configured ssh COMMAND refuses too — `core.sshCommand` in
 * that config, or `GIT_SSH_COMMAND` or `GIT_SSH` in the environment the push inherits: it carries every
 * connection, so a wrapper holding state routes the scan's `ls-remote` and fetch to one repository and the
 * push and read-back to another. One written AFTER this read and before the push is outside it:
 * a writer of this repository's config already runs its own code in the push through `credential.helper`, so
 * the binding is to the configuration read here. The ssh client's OWN config (`~/.ssh/config`'s
 * `ProxyCommand`, `HostName`) is outside git and outside this check the same way: its writer runs code as
 * the owner already.
 *
 * **And the url must name a HOST, over ssh or https.** One string is one repository only when something
 * outside the filesystem binds it: a host key or a TLS certificate. A local path — bare, `file://`, or a
 * symlink to either — is re-pointable between the scan and the push, so the scan reads one repository and the
 * push publishes into another with every string, environment and config unchanged. `git://`
 * and `http://` authenticate no host, and `ext::` runs a command, so all of them refuse too. A host binds the
 * SERVER, not the repository behind the path: one deleted, transferred or recreated at the same path between
 * the scan and the push receives objects the scan read against another. That is the third
 * residue, and like a force-push over the default branch it takes an admin of the destination repository.
 *
 * **A certificate binds only while git checks it.** `http.sslVerify`, plain or url-scoped, set to anything but
 * `true`, `yes`, `on` or `1` (or given bare, which git reads as true), or `GIT_SSL_NO_VERIFY` present at all
 * lets anything on the path, a configured `http.proxy` included, answer
 * the scan from one repository and the push from another, so either refuses. It FAILS CLOSED
 * rather than listing git's false spellings, because git parses any integer, `00` and `0k` included, and a
 * list of false words missed one; a true spelled `2` refuses too, which costs a salvage, never a secret. The trust store
 * git verifies against is the residue: a CA the user or the system installed is trusted exactly as git
 * trusts it.
 *
 * @param remote the remote's name, for the refusal
 * @param fetchUrl `remote get-url`'s answer
 * @param pushUrls `remote get-url --push --all`'s answer, one url a line
 * @param remotes `git remote`'s answer, one configured remote name a line
 * @param config `git config --list`'s answer, one `key=value` a line
 * @param environment the environment the scan and push inherit, read for `GIT_SSH_COMMAND`, `GIT_SSH` and `GIT_SSL_NO_VERIFY`
 * @returns the url, or the refusal
 */
export function oneDestination({
  remote,
  fetchUrl,
  pushUrls,
  remotes,
  config,
  environment,
}: {
  remote: string;
  fetchUrl: string;
  pushUrls: string;
  remotes: string;
  config: string;
  environment: Readonly<Record<string, string | undefined>>;
}): Result<string, SalvageDestinationError> {
  const urls = pushUrls.split("\n").filter((line) => line.trim() !== "");
  if (urls.length !== 1 || urls[0]!.trim() !== fetchUrl.trim()) {
    return err(SalvageDestinationErrors.pushUrlMismatch({ count: urls.length, remote }));
  }
  const url = urls[0]!.trim();
  if (remotes.split("\n").some((name) => name.trim() === url)) {
    return err(SalvageDestinationErrors.urlIsRemoteName({ remote }));
  }
  if (config.split("\n").some((line) => /^url\..*\.(?:push)?insteadof=/i.test(line))) {
    return err(SalvageDestinationErrors.insteadOf());
  }
  const sshInEnvironment = ["GIT_SSH_COMMAND", "GIT_SSH"].some((name) => {
    const value = environment[name];
    return value !== undefined && value !== "";
  });
  if (sshInEnvironment || config.split("\n").some((line) => /^core\.sshcommand=/i.test(line))) {
    return err(SalvageDestinationErrors.sshCommand());
  }
  // git reads GIT_SSL_NO_VERIFY by presence, so an empty value switches verification off too.
  const unverified =
    environment["GIT_SSL_NO_VERIFY"] !== undefined ||
    config.split("\n").some((line) => {
      const setting = /^http\.(?:.*\.)?sslverify(?:=(.*))?$/i.exec(line.trim());
      return setting?.[1] !== undefined && !/^(?:true|yes|on|1)$/i.test(setting[1]);
    });
  if (unverified) {
    return err(SalvageDestinationErrors.tlsUnverified());
  }
  if (!AUTHENTICATED_URL.test(url)) {
    return err(SalvageDestinationErrors.unauthenticatedDestination({ remote }));
  }
  return ok(url);
}

/**
 * Resolve, ONCE, the literal url a salvage's scan, push and read-back all name, or why there is none.
 *
 * @param deps the git edges
 * @param path the worktree
 * @param remote the remote's name
 * @returns the url, or why no one repository could be named
 */
function resolveDestination({
  deps,
  path,
  remote,
}: {
  deps: GithubPushEdges;
  path: string;
  remote: string;
}): Result<string, SalvageDestinationError> {
  try {
    const destination = oneDestination({
      fetchUrl: deps.readGit({ args: [...HOOKS_OFF, "remote", "get-url", remote], cwd: path }),
      pushUrls: deps.readGit({ args: [...HOOKS_OFF, "remote", "get-url", "--push", "--all", remote], cwd: path }),
      remote,
      remotes: deps.readGit({ args: [...HOOKS_OFF, "remote"], cwd: path }),
      config: deps.readGit({ args: [...HOOKS_OFF, "config", "--list"], cwd: path }),
      environment: process.env,
    });
    return destination;
  } catch (error: unknown) {
    return err(SalvageDestinationErrors.unreadable({ cause: error, remote }));
  }
}

/**
 * Push the branch the steps just built, and believe it only once the remote reports the same commit.
 *
 * HEAD is read AGAIN here rather than carried in, because a commit step moved it: pushing the sha from
 * before that step would put the tree's PARENT on the remote and then delete the tree holding the child.
 *
 * **The secrets scan runs HERE, with today's scanner, and the tree's own `pre-push` hook does not run at
 * all.** That hook is the week-old tree's lefthook running the week-old tree's lint lane: measured
 * 2026 at eight minutes a tree and red on stale config, so every salvage was kept and the nightly budget went
 * on two of them — `./salvageScan` carries the measurement. Its purpose was the secrets scan, and pushing a
 * week-old tree unscanned would be worth less than the work being captured, so {@link salvageScanDecline}
 * reads every blob the destination's default branch does not already carry and declines on a secret. HEAD is read
 * once and the remote's url resolved once: the scan reads that sha at that url, and the push and its read-back
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
export function confirmOnRemote({
  deps,
  home,
  path,
  remote,
  scan,
  target,
}: {
  deps: GithubPushEdges;
  /** The state home whose push-root register judges the salvage push: a salvage never bypasses the guard. */
  home: string;
  path: string;
  remote: string;
  scan: SalvageScan;
  target: string;
}): SalvageOutcome {
  let localSha = "";
  try {
    localSha = deps.readGit({ args: [...HOOKS_OFF, "rev-parse", "HEAD"], cwd: path }).trim();
  } catch (error: unknown) {
    const why = error instanceof Error ? error.message : "git could not be asked";
    return { branch: null, declined: `could not read the commit to push — ${why}` };
  }
  const destination = resolveDestination({ deps, path, remote });
  if (destination.isErr()) {
    return { branch: null, declined: `${destination.error.message} — nothing was pushed` };
  }
  const url = destination.value;
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
