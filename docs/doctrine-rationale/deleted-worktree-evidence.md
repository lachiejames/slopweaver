# A deleted worktree's passes: re-proved, or not run

Part of [rule 9](rule-9.md). The landing floor folds a pass only under a checkout that qualifies: its `origin` is the
pull request's repository and it holds the head commit, both asked of git IN that directory. A checkout that was
deleted cannot be asked anything, so on its own that rule loses every pass a removed worktree took.

**MEASURED**: a READY plan and a CLEAN review read from the main checkout cleared the floor while their worktree
stood, and read NOT RUN once `git worktree remove` ran, though main held the very same commit
(`src/__tests__/unit/codex/landingGateWiring/deletedWorktree.test.ts`).

## Why commit ancestry alone is not enough

A fork's commit object can sit in this clone, so "a surviving checkout holds the recorded head" is lineage, never
provenance. Every pass record and Claude fallback request therefore records `originRepository` while its checkout
still exists (`src/codex/originBinding.ts`): `owner/name`, validated at parse, a malformed value read as absent and
never as a match.

## What re-proves a record

A record or fallback receipt is re-homed into a surviving qualifying checkout, in memory only, when ALL hold
(`src/codex/orphanedEvidence.ts`):

- its recorded path is definitely MISSING. A path that exists again is judged by today's qualification, so a reused
  path now holding another repository stays excluded;
- its `originRepository` is the pull request's repository;
- the branch it WROTE is the pull request's branch. Branch continuity's relabel never counts here: it is proved
  from the recording checkout's reflog, and that checkout is the one that is gone;
- that checkout holds its recorded head, and that head is the pull request's head or an ancestor of it. A git error
  is no proof.

Re-proof only PLACES a record. Freshness and diff carry still judge the copy, so a stale review reads stale and a
stale bump witness is still refused. Foreign and unbound receipts are never adopted. A receipt binds exactly as
before, origin aside, and its origin counts only when the hash-bound request file carries the same origin, path,
branch and head as the copy it embeds. The `codex status` table, `codex supersede` and the
other-checkouts line never adopt; `codex status --check` is the landing read, so it adopts exactly as `github
enqueue` does. An orphan that is not adopted stays outside every fold, so no fail-closed count moves.

## What it does not recover

**Records written before `originRepository` existed carry none, so they stay NOT RUN once their path is gone.**
Nothing recovers them retroactively and nothing backfills the field onto old records.
