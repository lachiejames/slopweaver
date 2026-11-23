# Pull-request operations — what each verb refuses, and what each outcome means

One section per `github` write verb that moves a pull request's state rather than its description: what it
does, what it refuses, and which outcomes are the verb working rather than failing. The house format the
description itself must meet is in [pull-requests.md](pull-requests.md).

## Pushing over a tree that is not what you send

`github push` refuses a working tree that differs from HEAD, naming every modified and untracked path — in a
`--dry-run` too, since a dry run exists to disclose what a real invocation would decide. Every pre-push gate
here reads the FILES ON DISK (`yarn validate:local`, run by the lefthook hook and by the verb ahead of the
transport) while `git push` sends the COMMIT, so over a dirty tree the gate's green is about code that stays
behind: measured once, an uncommitted typecheck fix sat on top of a red commit and would have earned
a green gate for the commit actually sent. Commit or stash first. The lefthook hook refuses on the same
criterion (`src/admit/prePushWorkingTree.ts`) and before the gate rather than after, so a bare `git push` gets
it too and pays milliseconds rather than the whole lap; the same refusal covers `stack push`/`adopt`/`sync`.
**That green is not a green `yarn validate`**: the local lane is a secrets scan and a working-tree check, and
the tests and the whole-repo `ts.Program` gate run on CI ([toolchain/rebaseline-and-lanes.md](../../../docs/toolchain/rebaseline-and-lanes.md#two-lanes-the-local-one-is-a-secrets-scan-and-a-working-tree-check-and-everything-else-is-cis) § Two lanes) — watch with `github checks --wait`.

## Mark a draft ready, or close it

`github ready --repo <owner/name> --number <n> --dry-run` first, then repeat without `--dry-run` when the
requested workflow authorises it. The live transition reads the pull request, sends GitHub's
`markPullRequestReadyForReview` mutation once through the door, and reads it back. `marked ready` means the
second read returned `draft: false`; `already ready` is an honest no-op.

`github close --repo <owner/name> --number <n> [--why "…"] [--expect-head <sha>]` is rule 3's missing door. Refuses
a merged, already-closed or silent close (no recent comment or `--why`), a read about another pull request, and —
with `--expect-head`, the head an earlier read judged — one pushed to since, before the comment or the close.

## Requesting review

`github pr request-review --repo <owner/name> --number <n> --reviewer <login,...> --team <slug,...>`. Give at
least one of `--reviewer`/`--team`; both are comma-separated. `--dry-run` first, then repeat without it.
**It is NOT how a review is asked for — asks happen in Slack alone, and nothing proposes this verb as a next
act** ([review-state.md](review-state.md)); use it only when the owner explicitly asks.

- **Every `--reviewer` login is resolved against the derived identity directory FIRST**, before any GitHub
  call. A login the roster does not confirm — case-insensitively, against a person's canonical id, GitHub
  login, or GitHub handle — is refused BY NAME rather than guessed. Never construct a
  login from a pattern (an org-suffix guess, say) — if the roster has not seen the colleague yet, run
  `slopweaver derive` (the live run does this just-in-time on its own) or add them to
  the identity roster (`slopweaver identity roster replace`).
- **`--team` slugs are not roster-checked.** GitHub itself refuses a team slug that is not real on the
  repository's organisation, so there is nothing this verb's own preflight can usefully add.
- **Foreign-author gate, same as `github pr update`.** Requesting review on a pull request you did not
  author is refused unless `SLOPWEAVER_ALLOW_FOREIGN_PR=1` is set for the run.
- **Additive only, like `github label`.** GitHub's endpoint cannot remove a review request, so removal is
  unrepresentable here rather than quietly missing. `requested` means the read-back carried every login and
  team you asked for; `already requested` is an honest no-op that sends nothing.
- **Re-reads the pull request immediately before the write**, refusing if its number, author or open/closed
  state moved since the first read — the same freshness discipline `github pr update` applies to the
  description, narrowed to what this write actually depends on.

## Retargeting a pull request's base branch

```bash
github pr retarget --repo owner/name --number 123 --base main --dry-run
github pr retarget --repo owner/name --number 123 --base main
```

`pr retarget` changes which branch a pull request merges into — the one step of building a native GitHub
stack no other verb covered: `stack adopt` deliberately never retargets a base (see its own module doc), and
`pr update` has no `base` field because changing a base or head is a different pull request, not a
description edit. Without this verb, the only path is the documented `SLOPWEAVER_ALLOW_RAW=1`
break-glass on `gh pr edit --base`, used to stack a pull request onto another by hand.

- **It refuses a base equal to the pull request's own head branch** — a pull request cannot target itself.
- **It reports a base that already matches the live one as a no-op**, not an error, matching `github ready`'s
  "already ready" and `pr request-review`'s "already requested" — a re-run of the same retarget succeeds
  rather than failing.
- **It refuses a pull request that is already a member of a native GitHub stack.** GitHub's stacks API
  requires each entry's base to already match the entry below it, so retargeting a stacked entry directly —
  outside the stack tooling that keeps that invariant — would orphan its membership rather than move it.
  There is no override; remove it from the stack first (`stack remove --pr`) or adjust the stack itself
  (`stack push`/`sync`/`adopt`) instead.
- **Foreign-author gate, same as `github pr update`.** Retargeting a pull request you did not author is
  refused unless `SLOPWEAVER_ALLOW_FOREIGN_PR=1` is set for the run.
- **Re-reads the pull request immediately before the write**, refusing if its number, author, open/closed
  state, base or head commit moved since the first read — the same freshness discipline `github pr update`
  applies to the description, narrowed to what this write actually depends on.
- **Confirms the new base by a fresh read-back**, rather than trusting the PATCH response alone — `retargeted`
  means the second read returned the requested base.
- **`--dry-run` resolves a token and performs GETs** — it never PATCHes and never enters the door.

## Removing or dissolving a native stack

```bash
github stack remove --repo owner/name --pr <number> --dry-run
github stack dissolve --repo owner/name --stack 42 --dry-run
```

GitHub's REST API exposes exactly one native removal endpoint, `POST .../stacks/{n}/unstack` — it removes
every UNMERGED entry at once (a locked or already-merged one is left in place), with no way to name a
single one.

`stack dissolve` maps onto it directly: unstack the named stack and report exactly what survived (usually
nothing, unless a merged entry was left behind). `stack remove` composes it to drop ONE entry: unstack the
whole stack, then — when two or more would remain — recreate it from exactly those, in their original
order, via `create`. A stack with any merged entry refuses `remove` outright, since `unstack` would leave
it in place and there is no way to tell that apart from nothing needing removal; `dissolve` has no such
refusal, since a survivor is exactly what it should report.

Both require `--repo` (never derived from a checked-out remote — neither verb touches Git), take
`--dry-run`, and re-read the stack fresh inside the door, refusing if its own entries moved since planning.
`remove` also carries the foreign-author gate (override: `SLOPWEAVER_ALLOW_FOREIGN_PR=1`); `dissolve` does
not, since a stack can legitimately mix authors.

Pipeline: `parse → token → read + authorise → decide (refuse/no-op/proceed) → [--dry-run stops here] → door →
RE-READ → PATCH the base → read back → confirm the base actually changed → report`.

## Labels

`github label --repo <owner/name> --number <n> --add <label,...>`. `--dry-run` first, then repeat without it.

- **It refuses a label the repository does not already DEFINE**, and that refusal is the point of the verb.
  GitHub's `POST /issues/{n}/labels` CREATES an unknown name with a colour it picks itself rather than
  rejecting it, and reports success — so without the preflight one typo becomes a permanent repository label
  and nothing anywhere says so. Create the label in the repository first, deliberately, or fix the spelling.
- **A truncated defined-label read refuses too.** Past the page ceiling, "not in the list I read" stops
  meaning "not defined", and the honest answer is that the check could not be completed.
- **Add-only.** GitHub's endpoint cannot remove, so removal is unrepresentable here rather than quietly
  missing. `labelled` means the read-back carried every name you asked for; `already labelled` is an honest
  no-op that sends nothing.

## Code-scanning alerts

There is no raw `gh api`/web-UI click for a CodeQL (code-scanning) false positive here — rule 3 forbids the
workaround, so a finding that blocks a pull request goes through this verb instead.

```bash
github alert list --repo owner/name --pr <number> --state open
github alert dismiss --repo owner/name --number 29 --reason used_in_tests --comment "the sensitivity test fixture builds this taint on purpose" --dry-run
```

- **`list` is a pure read**, no door record. `--pr` scopes to one pull request's head ref; `--state` is
  exactly GitHub's own enum (`open`/`dismissed`/`fixed`), open by default.
- **`dismiss` re-reads the exact alert first** — the independent re-verification this verb exists to force,
  not a rubber stamp on whatever the caller already believed.
- **`--reason` is refused outside `false_positive`/`wont_fix`/`used_in_tests`**, and `--comment` is required
  and capped at 280 characters — GitHub's own dismissal comment field refuses more, checked locally so an
  over-length comment fails fast rather than round-tripping. Re-verify the finding is genuinely a false
  positive yourself before dismissing it; this verb states the reason, it does not judge it.
- **The PATCH response IS the read-back** — no second round trip is needed to confirm the dismissal landed.

## Review threads

When a review asks for something the repository forbids, the answer is a reply in the reviewer's own thread
carrying the reasoning, then resolving it — not a dismissal, which leaves nobody any wiser.

```bash
github thread list --repo owner/name --number 123 --open --full
github thread reply --repo owner/name --number 123 --thread PRRT_xxx --body - --resolve --dry-run
```

- **`list` is a pure read** printing the node id the others address; `--open` unresolved only, `--full` whole bodies.
- **`reply --resolve` is ONE operation, reply first.** Top-level GraphQL mutation fields execute serially,
  so a partial failure leaves the thread OPEN with the answer already on it — never resolved in silence.
- **`reply` reads its thread first; after yours, the next word is the reviewer's.** Refused (dry run too, and
  when unreadable) if this identity replied since anybody else spoke, naming that reply; hatch `repeat-thread-reply`.
- **`--body -` reads the reply from stdin**, so a multi-paragraph answer survives shell quoting.
- **`resolve` on its own says nothing.** Prefer `reply --resolve` whenever the thread asked a question; a
  silently resolved thread reads as a dismissal to whoever opened it.
- **`reopen` undoes a resolve**, taking only `--thread`. The landing verbs use it on a walkthrough thread a
  reply raced ([self-review.md](self-review.md)); read the thread before reopening one by hand.
- **A bot reviewer set to request-changes re-reads its own threads**, so resolving them is what lets it
  withdraw the blocking review, outdated threads included: [coderabbit.md](coderabbit.md) is how each is judged.

## Top-level comments

`thread` answers a review pinned to a diff line. A caller reaching for the whole pull request instead —
requesting a bot re-review, say — has a plain top-level comment, and GitHub treats a pull request as an
issue for this one endpoint, so `comment` addresses either.

```bash
github comment create --repo owner/name --number 123 --form - --dry-run
github comment edit --repo owner/name --comment-id 456789 --form -
```

- **`create` posts a fresh comment; `edit` replaces one already posted**, addressed by the numeric id
  `create`'s report carries — never by content, since GitHub assigns no caller-chosen id for either.
- **The form is a message, not a document**: `{"summary": [...], "detail": [...] }`, the same summary/detail
  split `linear comment create` uses rather than the pull-request body's badges/Next/Problem/Solution/Proof
  table. `summary` is the whole thing a reader sees without expanding anything; `detail` is optional and
  renders collapsed.
- **It goes through the same above-the-fold gate the pull-request body uses** — concise, no em dash, no
  colon-list — because rule 7 governs every outbound surface, not only the document-shaped ones.
- **Posted under the operator's own GitHub login — attributable, never authenticated.** A personal token
  cannot post as "the bot"; anyone reading the pull request sees the operator's name on it, the same as every
  other write this door makes. Treat it as attribution, not proof a human typed it.
- **Neither sub-verb retries.** Like a review-thread reply, GitHub issues no caller-chosen id to reserve
  beforehand, so a lost response is reported as a failed read-back rather than silently resent.

## The merge hold

`slopweaver github hold`/`release` govern slopweaver's OWN advisory lane, and only where the base branch has
no native merge queue — on a queued base, [`github enqueue`](merge-queue.md) serialises the landings instead.
The verb, its four undocumented properties and the measurement that keeps it off the default path:
[merge-hold.md](merge-hold.md).
