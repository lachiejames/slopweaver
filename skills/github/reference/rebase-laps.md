# Re-pushing an open pull request while its base moves

Bundled reference for the `github` skill, linked from [the gold anchor](gold-anchor.md) and
[base freshness](base-freshness.md). A landing lap here is rebase, gate, push, read the checks, enqueue.
Each section below is a way that lap quietly costs a second one.

## `stack push` opens a pull request; `github push` re-pushes it

**`stack push` amends the worktree into the checked-out commit only when there is something to amend.** When the
tree it stages is already HEAD's, it pushes HEAD as is and the SHA you proved is the SHA GitHub gets; otherwise it
amends, prints `amended <old> → <new>`, and pushes the new one. A C3 description names no commit, so an amend cannot
stale the body; it can stale a proof gathered on the pre-amend SHA, so commit first or take the screenshot after the push.

Once the pull request exists, **every re-push is `github push --force-with-lease`**, which does not amend:
the SHA you proved is the SHA that lands, and the push prints its gold anchor for your record ([the gold
anchor](gold-anchor.md)).

**A `stack push` that fails after an amend has still moved your head.** Every gate runs before the amend, but
a push or create that fails after it leaves a rewritten commit locally with nothing sent; its `amended <old> → <new>`
line says so. After any `stack push` failure, `git log --oneline -1` comes first. A refusal for a worktree edited
mid-push ([stacks](stacks.md)) is the exception: HEAD is unmoved, the index is staged.

## A rebase that changed the diff changes the proof, not an anchor

A pure rebase leaves the patch id alone, so the proof stands and the description needs no edit. **A rebase whose
conflicts you resolved by hand changes the diff** — measured three times on one pull request, each rebase minting a
new SHA — so the screenshots and checks in the description may describe code that is no longer there. Re-gather
them and replace only the slot that changed: `--edit '{"solutionProof": …}'` carries every other field from the
live description. Confirm on the LIVE body with `github read <pr-url>`, never on the authoring file.

## What re-runs CI, and what does not

On a pull request, `ci.yml` fires on `opened`, `synchronize` and `reopened` only, plus `merge_group` in the queue. **`github ready` and a
description edit start no `build` or `integration` lap**, so a draft's green stands through readying; a body
edit re-runs only `pr-body-gate.yml`'s `dev-gate`. The trigger list and the measurement that cut it are in
`ci.yml`'s own header. Undraft before landing all the same: `enqueue` and `merge --admin` both refuse a draft.

A rollup reading `FAILURE` while every check passed is a superseded run, `ci-rollup-superseded` in
[merge-queue.md](merge-queue.md); a rollup reading `SUCCESS` over CodeQL alone on a `CONFLICTING` pull request
is a required context that never ran, `required-context-missing` there and in [review-state.md](review-state.md).

## In a landing wave, take the base's shape and re-add only your row

Landing one atlas took six rebases in one afternoon as eight sibling atlases landed.
Every conflict in the shared registries — the atlas manifest, `src/atlasHome.ts`, `docs/atlases.md`, the
registry tests — resolved fastest and correctly as **take base's file wholesale, then re-insert the one row
that is yours**. Merging both sides by hand spliced two atlases' rows together twice and once invented a field
base's resolver does not take, caught by the build rather than by review.

**A workaround for a gate can be obsolete before it lands.** That branch carried a workaround for the
file-size ratchet because `src/devLint/helpFlagOptOut.ts` derived a manifest's noun from its filename; two
rebases later a sibling had taught the gate to resolve it properly, and the workaround was dead weight. Before
pushing a workaround for a gate, re-read that gate on the current base.

## Diffstat against the fetched base, and read the DELETIONS

`git worktree add -b` branches from whatever the current checkout's HEAD is, which another session can have
left stale. MEASURED: a branch two commits behind `origin/main` showed another pull request's new
382-line file and its rewrite of a shared file as **1,061 deletions of mine**, and CI stayed green throughout —
it tests the tree, not what the merge would remove. Rebase onto the fetched base, then confirm the diffstat
carries no deletion you did not intend; `github merge`'s `reverts-main` finding is the gate behind this
([pull-requests.md](pull-requests.md)).

## An expensive proof wants one held base, not a rebase per notification

When gold is a live-corpus run or a timed benchmark rather than CI going green, a rebase that changes the
diff invalidates the measurement. MEASURED on one pull request: three rebases in one
session, each re-running about ten minutes of real-corpus measurement, and one re-measurement changed a
headline number — a sibling had turned a V8 fatal into a typed refusal — so carrying the old figure would have
shipped a false claim past a green gate.

The moment a proof looks expensive, rebase once, validate, measure, push, and hand off at once. Where the
base has no merge queue, take a hold for that one window ([merge-hold.md](merge-hold.md)); on a queued base
this is the one exception [pull-requests.md](pull-requests.md) names. Before claiming a measurement survives
an amend, `git diff <measured-sha> <head> --stat`: comment-and-doc-only is the one case where it does.
