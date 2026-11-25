# A bump-fix row — the daily seat that drives red dependency bumps green

A scheduled ask gets the dependency bump pull requests green and merged for slopweaver, every 24 hours, taking
all of them over the line. The row exists because a pulls page once held ten renovate bumps red at 13/15, and
nothing drove them home.

`github bump-drive` presses every bump a verb can finish, and SEATS the rest: a rebase or a red leg is
judgement, so it writes a board row and stops ([backlog](../../github/reference/backlog.md)). A `bump-fix` row
is the session that does that work, once a day. `bump-fix-slopweaver` is the declared one
([declared rows](declared-rows.md)).

## The order is the contract

You were seated with ONE command, `slopweaver automation run-due --recipe bump-fix-slopweaver --claim-id <token>`.
**Run it LAST.** A `run-due` settles the firing it runs, and this firing is the whole day's work — settled first,
the day reads done before anything was fixed.

1. **Read the worklist.** The claimed row's own argv is the command: `slopweaver github bump-drive --repo <repo>
--dry-run`, its `<repo>` this install's own, resolved from the declared checkout's `origin` ([declared
   rows](declared-rows.md)). It prints every open bump and the one act it needs, the capped ones included, and writes
   nothing.
2. **Work every `seat` bump.** Read the red leg with `slopweaver github checks --number <n> --repo <repo> --log`
   ([job logs](../../github/reference/job-logs.md)) — never run a CI lane in the seat. Check the head out in a
   worktree of its own under a local branch named EXACTLY like the pull request's head (`renovate/…`), because
   `github push` pushes to the same-named branch. Rebase onto `main` when it is behind, fix what the new version
   broke, commit, `slopweaver github push --force-with-lease`, then `slopweaver github checks --number <n>
--repo <repo> --wait`. A dependency's own breakage is fixed at the source, never by disabling a rule.
3. **Close a bump that can never land.** One whose only change `renovate.json` now forbids — rebased onto
   `main`, its diff is empty — is closed with `slopweaver github close`, naming the rule, and recorded with
   `slopweaver autonomy record`. One of THE OWNER'S bumps in that state, or one Renovate has since merged, the drive
   closes itself (`close-superseded`, [superseded bumps](../../github/reference/superseded-bumps.md)), so a
   worklist line reading that act is already done.
4. **Press a bump whose only red leg is `dev-gate` by hand**, its body untouched. The
   owner's standing rule: a renovate-authored PR keeps its renovate PR description,
   on slopweaver and acme-admin both — so `bump-drive` never plans `rewrite-body` on one (`isRenovateAuthored`), and it
   reads `seat`. `slopweaver github ready` on a draft, then `slopweaver github enqueue --pr <n> --acknowledge
ci-not-green`: the queue requires only `build` and `integration`. Read every other finding before acknowledging it.
   Then re-read the worklist, until no `seat` bump remains.
5. **Press.** Run the real pass — `slopweaver github bump-drive --repo <repo>`, step 1's `<repo>` — which undrafts and
   enqueues through its own typed acts and never writes a Renovate body. Its caps are per pass, so run it again until
   it has nothing left to press. A bump its ladder still will not press, `slopweaver github ready` then
   `slopweaver github enqueue` by hand, reading every finding the enqueue prints before acknowledging one.
6. **Settle.** The worklist is terminal when every bump reads `nothing`, `held`, `review-withheld`,
   `awaiting-human-review` or `close-superseded`. Then run the claimed `run-due` command.

**A Renovate bump you made green whose code owner is all that remains reads `review-withheld`**: it waits on the owner's
review, which the owner is withholding until the owner's word ends the hold. No Queue card for the owner, and never a review
ask to a colleague: name the hold in the settlement and stop
([backlog](../../github/reference/backlog.md)).

**Re-read after every mutation.** The four-hourly `bump-drive-slopweaver` row can fire mid-seat, and renovate
rebases its own branches; a pull request already queued or already moved is a fresh worklist line, not an error.

## What ends the seat without a green

A bump that cannot go green unattended — a major that needs a port, a vendor break with no fix yet — becomes a
board finding with the exact steps (`slopweaver handover register --ask "…" --finding --evidence "…"`) and the opt-out
label (`slopweaver github label --add no-auto-merge`) so the next worklist reads it `held`. Say what you could not prove, then settle and close your workspace.
