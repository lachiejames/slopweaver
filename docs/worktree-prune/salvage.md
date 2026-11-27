# The salvage capture

How `worktree prune` captures a `salvaged` tree's work before the tree goes, and what its push may publish.
The class, the waiver it rests on and the fresh `salvage/<slug>-<sha8>` branch are in
[the classes](classes.md#the-classes); the code is `src/worktree/pruneSalvage.ts` (the
capture), `src/worktree/salvageTrunkHistory.ts` (the history check), `src/worktree/salvageDestination.ts` (the one
url), `src/worktree/salvagePush.ts` (the push), `src/worktree/salvageScan.ts` (the scan's git reads),
`src/worktree/salvageMetadata.ts` (the raw path walk), `src/worktree/salvageCatFile.ts` (the object answer's parse),
`src/worktree/salvageFindings.ts` (what the scan found, and the decline line naming it) and
`src/worktree/salvageHooksOff.ts` (the hooks-off flags every one of them runs git with).

**A salvage pushes to `origin` alone, and never a commit of another history.** `origin` is `PRUNE_REMOTE`
(`src/worktree/pruneRemote.ts`), the one remote every "is this pushed" read in the scan and the recheck names, so
the remote that judged a tree's work "on no remote" is the remote it is sent to. A checkout can carry a remote of
a different history: this repository's own keeps its pre-cut history on `archive` beside the public `origin`, and
`git merge-base origin/main archive/main` exits 1. Salvaged, an archive branch would have put that whole history on
the public repository as one `salvage/…` branch.

**What the salvage path guarantees on its own** (`src/worktree/salvageTrunkHistory.ts`), with no help from the
push-root gate, which passes whenever no register exists:

- **The trunk is `origin`'s HEAD now**, asked with `ls-remote -- <url> HEAD`, never the local
  `refs/remotes/origin/HEAD` symref, which anything can re-point. The url is bound ONCE, through the same checks the
  push makes (the ssh-or-https host judge included, one injected judge for both sides), before the trunk is read, and the push refuses if the url it resolves is not that one. A remote that
  cannot be asked, an answer naming no HEAD or more than one, or a trunk commit not fetched here, declines.
- **The test is the root set, not a merge base.** Every parentless commit the HEAD reaches must be a root of that
  trunk. A branch off the trunk that merged the archive in shares a merge base and still declines, on the
  archive's root.
- **It runs FIRST**, before an index bit is cleared (a write) or a name probed, so a refused tree is left as found.
  HEAD is re-read right before the first `update-index` and again after it; a move either time declines.
- **The pushed commit is checked again**: it must descend from the checked HEAD and pass the same root test against
  the same trunk, so a reset or a merge by another process after the capture sends nothing.
- **The push goes to the url the trunk was read from**, or nowhere.

Replace refs and the commit graph are off for every ancestry read. A deprecated `info/grafts` file has no
per-command switch, so its presence DECLINES: it rewires the parents `rev-list` reports, and the root test could
pass on a history the server would refuse. A shallow boundary only ever costs a decline, never a pass: it makes a
cut commit read as a root, and a root that is not the trunk's declines. An ancestry read that fails for any reason
other than git's own "not an ancestor" answer declines too, naming the failure rather than calling it a verdict.

**A dirty tree is TWO pieces of work and both are captured**, because git's index can hold content no file on
disk has (`MM` in porcelain) and `git add -A` overwrites it. The index is committed on its own first, the
working tree second: two commits, neither over the other. **And every git command a capture runs carries
`-c core.hooksPath=/dev/null -c core.fsmonitor=false`** — hooks off, that invocation only. Both keys,
because `core.fsmonitor` names a second executable git runs to ask what changed and `core.hooksPath` does
not govern it; a monitor running `git add` on its first invocation fires during the capture's very first
`status`. A `.gitattributes` clean/smudge filter is deliberately left ON — that is the repository's own
declared content transform, and skipping it would write bytes git never would. Its command lives in the
repository's git config, so a file it writes inside `git add`, after the capture measures it, is the same
config-writer residue `core.sshCommand` is.

**The SCAN counts those bits too, and that is where the class is actually caught.** Clearing them inside the
capture protects a tree that reached `salvaged`; it does nothing for one whose _only_ changes are hidden,
because that tree's `status --porcelain` is empty, no dirt rule fires, it classifies `merged`, and the
ordinary removal path takes it — salvage never runs at all. A review pass drove exactly that to a real
deletion. So `scanWorktree` reads `git ls-files -v -z` beside the status and reports `hiddenFromStatus`, and
two hold rules read it: an unreadable listing holds unwaivably, like any fact the scan could not read, and a
positive count holds **waivably**, so past `--nuke-after` the tree becomes `salvaged` and the capture below
takes it, unless the run passed `--no-salvage`, which keeps every waivable hold held. The scan itself never clears a bit — it looks, and only the capture writes.

**Every scan read carries the same hooks-off armour the capture does, because a read is not a safe
operation.** `status --porcelain` fires `post-index-change`, and `core.fsmonitor` names a SECOND executable
that `core.hooksPath` does not govern — so in a repository configuring either, git runs somebody else's code
over an index the capture has not protected yet. A review pass reproduced the whole chain with a monitor
running `git add`: staged-only content was overwritten by the SCAN, and the capture then faithfully pushed
the overwritten version and removed the tree. `HOOKS_OFF` is exported from the capture and applied inside
`pruneScan`'s own git runner, so the two can never drift into two different sets of flags.

**And a scan read is BOUNDED at 32 MiB, because the alternative reads as a broken repository.** Node caps a
captured child at 1 MiB by default and throws `ENOBUFS` past it, which a caller that wraps its reads in a
`try` reports as "its working tree could not be read" — a read that had actually worked. Measured on a real
drain lap: `git ls-files -v -z` in the acme-admin monorepo is just over a megabyte, just past that default, so every
worktree there declined its salvage. The capture's shared `readGit` carries the same bound the scan does.
The decline is the safe direction, which is exactly why a whole lap passed before anyone saw it.

**And the capture CLEARS every "stop looking at this file" bit before it measures anything.** A tracked file
marked `--assume-unchanged` (or `--skip-worktree`) and then edited is reported by no `status --porcelain`,
so the capture plans nothing for it, the push verifies, and `git worktree remove` takes the only copy of
those bytes. `git ls-files -v -z` names them — a lowercase status letter, or `S` — and `update-index` clears
them first. The bit is a local index optimisation rather than content, and the tree is about to be deleted,
so clearing it costs nothing and is what makes the measurement honest.

**Only build output that is ignored reaches a capture, and it goes with the tree.** `git add -A` never stages an
ignored file, and `git worktree remove` deletes it once the push confirms. So an ignored file no build writes
again — a path-keyed Codex record, `.slopweaver` or agent state, an `.env.local` — holds the tree at classify
time and never waives, and the apply lists the ignored files again right before the removal
([the owner's word](classes.md#the-owners-word-work-committed-nowhere-is-never-destroyed)). The capture
itself does not ask, so a `dist/` or a `.turbo/` never keeps a week-old dirty tree forever. A stash made from
the tree holds it the same way, because a pushed branch carries no stash.

**Four details of that clearing are load-bearing rather than tidy.** The listing is read with `-z`, because
git's default `core.quotePath=true` renders any path outside printable ASCII as a C-quoted string — `é.txt`
comes back as the eight literal characters `"\303\251.txt"` — and a name handed back in that form matches no
index entry, so `update-index` answers `fatal: Unable to mark file` and the bit never clears. `-z` turns
quoting off by construction, and the same property carries a newline in a filename. And **a bit that will not
clear DECLINES the salvage**: the files it names are exactly the ones whose edits `status --porcelain` will
not report, so going on would measure a tree this code knows it cannot see and then delete it. Keeping a tree
costs a directory the next pass prunes again; the other branch costs the work. The doctrine below governs
here too — a read that failed is not evidence the tree is clean.

The other two come from one measured git behaviour. **Each bit is cleared by its OWN `update-index`**,
because passing `--no-assume-unchanged` and `--no-skip-worktree` to a single command clears the first,
silently leaves the second SET, and exits 0 — after which the capture measured a tree it still could not
see, pushed the file's ORIGINAL bytes, verified that push happily and removed the worktree. And **the
clearing is confirmed by RE-READING `ls-files`, never by the exit status**, for the same reason: a zero exit
was exactly what that bug returned. Whatever is still listed on the second read is still invisible, and the
salvage declines on it. Reproduce the git behaviour:

```bash
d=$(mktemp -d) && git init -q "$d" && cd "$d" && printf 'BASE\n' > f.txt && git add -A &&
  git -c user.email=a@b.c -c user.name=t commit -qm base && git update-index --skip-worktree f.txt &&
  git update-index --no-assume-unchanged --no-skip-worktree -- f.txt; git ls-files -v   # still S
```

**The work itself is counted in PATHS, not in porcelain columns.** The capture asks `diff --cached
--name-only -z` for the index side, and `diff --name-only -z` plus `ls-files --others --exclude-standard -z`
for the working-tree side, and counts NUL terminators. `status --porcelain`'s two columns are
position-significant, and the shared `readGit` ends in `.trim()` — it has to, every other caller wants a bare
sha — so a tree whose first entry was a worktree-only edit arrived as `M file` instead of ` M file`, counted
as STAGED, and made the capture commit an empty index: git exits 1 and every ordinary dirty tree declined.
A path list has no column to lose, and survives a newline in a filename for free. `--no-verify` is a commit-side flag and
does not cover `git switch`, which fires `post-checkout` — nor `git status --porcelain`, which refreshes the
index and fires `post-index-change` BEFORE the capture has even measured it. A hook running `git add` in
either window overwrites the staged content, and nothing downstream notices, because both commits still
succeed and the remote still confirms the sha. Arming only the writes armoured nothing: the status read is
the first thing a salvage does. **This repository declares a
`post-checkout` hook**, so that is a live case rather than a theoretical one. A salvage preserves the bytes
that are there, and the only way to say that about every hook is to run none.

**The push runs none either — the capture scans what it sends, with today's scanner.** A salvaged tree is a
week old, and so is its `pre-push` hook: lefthook reads the TREE's `lefthook.yml`, which runs that tree's
own `validate:local` with that tree's own code. Measured: the first salvage of a long drain,
one supervisor chair's tree, spent 02:52:53 to 03:00:38 inside the hook — the tree's own, week-old lint
lane — and then went red on a `.oxlintrc.jsonc` its pinned oxlint did not accept.
All 32 slopweaver salvages queued behind it were the same shape, so the class cost eight minutes a tree and
reclaimed nothing. That hook is a secrets scan and a working-tree check (`lefthook.yml` says so). The
working-tree check stays in `pushAndVerify`, whose every git command a salvage runs with hooks and `core.fsmonitor` off like its own. The secrets half is `src/worktree/salvageScan.ts`. It reads
HEAD once, resolves the remote to ONE literal url once, asks that url for its default branch (`ls-remote <url> HEAD`,
fetched without writing a ref), lists every blob that sha reaches and that branch does not
(`rev-list --objects --filter=object:type=blob --ignore-missing --stdin`), reads them
with `cat-file --batch`, both under `--no-replace-objects` so a local `refs/replace/*` cannot hand the scan a clean
stand-in, and runs this build's `scanContent` and private denylist over each, over every commit object in the range read raw (author, committer, signature, message), over every changed
path (`git log -z -r --raw --no-abbrev --root --no-renames --diff-merges=separate` over the same range — `-z` because
without it git C-quotes a name holding a backslash or a quote, `core.quotePath=false` or not, and the scan would read
`"a\\b"` where the push sends `a\b`) and over the salvage branch name, since each is published without being inside
any blob. That raw walk also names the blob each path writes, because `rev-list` names an object once, at its first
path, and the identifier scanner forgives by path (a `.github/CODEOWNERS` account row, the README's one owner
reference): each blob's identifiers are judged at EVERY path a range commit writes it at, so a byte-identical copy of
a forgiven file declines at its own path. That holds for a blob the destination's default branch already reaches
too: the listing leaves it out, so the scan reads it separately and judges its identifiers at each path the range
writes it at. A secret is scanned once per LISTED object, since that scanner reads no path; a blob the default
branch already reaches is not secret-scanned, because its bytes are already published there. A
walk the scan cannot parse declines, and so does a submodule entry, which nothing it reads covers. The push then
sends that same sha to that same url (`<sha>^{commit}:refs/heads/<salvage branch>`, `--recurse-submodules=no`, `--no-follow-tags`), and
the read-back asks that url, so neither a commit nor a re-pointed remote in between is ever what gets sent. A secret, an
unreadable denylist, a listing or read git refused, or a blob git did not return each DECLINES; a secret
names its class and path (a path that itself matches a secret pattern is withheld too), a failure to look names what could not be read, and neither quotes content — every `scheme://` url is withheld whole, and
a reason still matching a credential or the private denylist is withheld entirely. A forbidden identifier declines
the same way wherever `IDENTIFIER_VERDICT` reads `refuse`, because the destination is the public repository: the
same rules the repository gate holds every commit to, over those blobs, paths, branch name and commit messages,
naming the class and the path and never the text. A path that itself carries an identifier is withheld from every
decline, a secret's included, and a scanner that throws declines rather than ending the run, its message withheld
since no scanner has judged it. A commit's author and
committer headers are not read for it, since they name a person on every public commit. An identifier stored as
UTF-16 is the scanner's residue, exactly as a secret is. A remote
whose one push url is not its fetch url, whose url is another remote's name or no ssh or https host (a local path is re-pointable by a symlink mid-push), or under any `insteadOf` or `pushInsteadOf` rule (git applies each again to the url it was handed), or with an ssh
command configured (`core.sshCommand`, `GIT_SSH_COMMAND` or `GIT_SSH`: a wrapper holding state can route the scan and
the push to two repositories behind one url), or with TLS verification possibly off (`http.sslVerify`, plain or
url-scoped, set to anything but `true`, `yes`, `on` or `1` — git reads `00` and `0k` as false, so the check fails
closed — or `GIT_SSL_NO_VERIFY` present: no certificate then binds the url, and a configured proxy can answer the scan
from one repository and the push from another) declines too, so scan, push and read-back reach one repository. A
`pushInsteadOf` written between that read and the push is the second residue: a writer of this repository's config
already runs its own code inside the push, through `credential.helper`, so the salvage's promise covers the
configuration it read. The ssh client's own `~/.ssh/config` is outside git and outside that read the same way. It reads objects rather than a rendered patch because a merge
resolution and a `-diff` file render no scannable lines. Only the default branch counts as carried: it is protected
and only moves forward, while any other branch — on another remote, deleted but still tracked here, deleted
between the scan and the push — can stop carrying a commit the push then
publishes. Each of those is a real-git case in `salvageScan/realGitRefs.test.ts`. The residues are a force-push over the
protected default branch inside that window, and the hosted repository deleted, transferred or recreated at the
same path inside it — a host key or certificate binds the server, never the repository behind the path. Each
needs an admin of the destination repository. A binary blob is scanned too, stricter than the repository gate,
because the push publishes every byte. It is read as UTF-8 text, as the gate reads every file, so a secret stored
compressed, encoded or as UTF-16 is beyond it — the scanner's residue, the same for a salvage as for any commit. A declined capture has already committed its work onto the local salvage
branch, so it is never lost: a later run finds commits on no remote, which hold the tree, and the tree stays
until a capture's push is confirmed. Nothing is published. A salvage does not wait on the rest of that lane — corpus
hygiene, the handover register, the secrets registry, the card voice — none of which reads a byte the push
sends.
