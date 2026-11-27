/**
 * The armour every salvage git call carries, in a leaf of its own: the scan, the capture, the history check, the
 * destination and the push all import it, and a leaf is what keeps those modules from importing each other for it.
 */

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
 * **Shared, because the SCAN needs exactly this armour and must not grow a second copy of it.** A fourth
 * review pass reproduced the same loss one stage earlier: `pruneScan` issues the same `status` and
 * `ls-files` reads, had none of this, and a monitor running `git add` let the SCAN overwrite staged-only
 * content that the capture then faithfully pushed in its overwritten form.
 */
export const HOOKS_OFF: readonly string[] = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];
