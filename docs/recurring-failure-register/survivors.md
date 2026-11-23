# Survivors — the live build candidates

Part of [The recurring-failure register](../recurring-failure-register.md).

Ordered by build cost, then by anchored instance count. `n` is instances anchored in the mining window.

## Medium build cost

| n   | class                                                       | what it refuses                                                                                                                                                                                           | seam                          |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 33  | `parks-on-the-owner-for-what-it-could-do-itself`            | A session stops and asks the owner to authorise, look up or physically perform something it is already authorised and able to do — a step the doc already orders, a lean it already holds, a Slack…       | `briefing/reactNowCard.ts`    |
| 29  | `outbound-claim-ships-without-its-evidence`                 | A card, answer or post states a claim, names a PR/ticket/run/dashboard, or summarises a provider page with no per-claim citation, no working hyperlink and no screenshot — including when the…            | `admit/realArtifact.ts`       |
| 27  | `unverified-absence-impossibility-or-blocker`               | A session declares something absent, impossible, incapable or blocking — a verb that does not exist, a provider that cannot do X, a capability gap, a diagnosis — from help output, docs,…                | `turn/posterAnswer.ts`        |
| 20  | `verification-run-in-a-shape-whose-green-means-nothing`     | A session verifies with an invocation that cannot produce a trustworthy verdict — a gate piped into head/tail so the exit code is the filter's, a bare `vitest run` with no --config, a…                  | `admit/rawTools.ts`           |
| 19  | `door-bypassed-or-its-skill-never-loaded`                   | A Slack/GitHub/Linear/Notion read or write reaches the provider outside the door — an MCP tool, a legacy per-repo CLI, raw gh — or reaches it through the sanctioned verb with the governing…             | `admit/hookPayload.ts`        |
| 18  | `wall-of-text-on-a-surface-no-form-governs`                 | The owner is handed an undifferentiated block of prose on a surface no outbound schema reaches — the in-terminal reply and the PR description/Proof section — so the owner cannot tell what the owner is… | `handover/hookGate.ts`        |
| 13  | `passes-keep-running-instead-of-building`                   | A run keeps spending planning, adversarial and review-bot passes — ten-plus sibling docs for one feature, a seventh adversarial pass, hours of CodeRabbit nitpicks — without an intervening…              | `codex/ledger.ts`             |
| 12  | `bot-answer-review-rounds-uncapped`                         | A turn spawns reviewer after reviewer — four rounds, six rounds, duplicate live reviewers for one ask, three identical respawns after a reviewer dies without writing a verdict — until hours…            | `turn/review.ts`              |
| 10  | `feedback-closed-without-locking-in-the-class`              | Owner feedback is landed as a PR, marked done and proved with a one-off golden proof, with no regression probe binding the behaviour and no row registered for the class the feedback…                    | `handover/lifecycle.ts`       |
| 10  | `long-run-piped-or-unwatched-so-nobody-sees-it`             | A long verb or a Codex pass is launched piped into a buffering filter or in the foreground, so its progress stream goes nowhere and nobody polls it — the owner cannot tell working from…                 | `admit/rawTools.ts`           |
| 9   | `stalled-session-still-reported-as-in-flight`               | A session announces its next action and then produces no event for tens of minutes to nine hours, or sits blocked on a permission prompt, an unanswered question or a sign-in wall — and the…             | `handover/boardEvidence.ts`   |
| 8   | `pr-state-asserted-or-acted-on-from-a-partial-read`         | A PR is called green, or sent to a human for review, on one field of the GitHub API — with unresolved review threads, a CHANGES_REQUESTED decision, a cancelled check or still-draft state…               | `github/requestReviewCore.ts` |
| 8   | `finished-sessions-and-runs-are-left-open`                  | A session whose work has landed — PR merged, run signed off — neither closes its cmux workspace nor moves its doc off ready, so open chats accumulate until the owner spots the dead ones…                | `cmux/run.ts`                 |
| 8   | `idle-or-scheduled-work-declared-with-no-durable-wake`      | A session declares it is idling, sweeping or working until a stated future time using a mechanism that cannot wake it, so the wake never fires, the sweeps silently stop, and the fleet sits…             | `handover/hookGate.ts`        |
| 7   | `fleet-size-judged-by-a-heuristic-not-a-measurement`        | The fleet is either throttled while ready docs queue and the machine has spare memory, or fanned out at supervisor cost with no cap on concurrent workers — because available capacity is…                | `briefing/schema.ts`          |
| 6   | `errors-swallowed-into-empty-defaults`                      | A read, capture or provider call that fails is caught and turned into an empty result or a zero exit code, so the caller reports success while having done nothing and the agent builds on…               | `devLint/noSilentFallback.ts` |
| 5   | `quality-claim-from-a-toy-corpus`                           | An architecture, a fix or a measurement is proven on a fixture, a demo home or a sample and reported as evidence the thing works — the real bugs appear only at real scale, after the design…             | `corpus/subsetStore.ts`       |
| 4   | `door-gate-fires-only-at-post-time-after-the-work-is-spent` | A worker composes an answer and burns full review rounds on it before the admit door is ever consulted, so a mechanical refusal — a missing asker mention, an unresolvable user id — surfaces…            | `admit/wiring.ts:145-169`     |
| 3   | `stacked-prs-are-not-github-native-stacks`                  | A PR whose base is another open PR's head is created as a pseudo-stack by retargeting branches instead of being registered as a native GitHub stack, so the owner sees a chain GitHub does…               | `github/retargetCore.ts:117`  |

## Large build cost

| n   | class                                             | what it refuses                                                                                                                                                                                       | seam                 |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 17  | `owner-facing-row-asserts-state-it-never-re-read` | A briefing card, ranked row, live board or recorded ask describes the state of a live object — a PR, a ticket, a project update, a decision the owner already made — from stored corpus data or from… | `briefing/schema.ts` |

- **`verdict-computed-against-the-wrong-tree`** — the general class behind three measured instances, framed
  by the session that hit two of them: **a verdict computed against the wrong tree, delivered in the voice of
  a verdict about yours.** The three: the merge guard resolves `--base main` to the stale LOCAL
  ref and reports another pull request's deletion as your silent revert (reproduced both ways on a PR that
  does not touch the file — 16 findings against `main`, 15 against `origin/main`, the extra one phantom);
  `reverts-main` fires on a cleanly rebased branch with BOTH halves of its claim false at once; and this
  repo's own launcher ran the plugin mirror and printed `hygiene: not a git checkout` plus a baseline path
  from a tree the caller had never edited.
  **Why they are one class despite looking opposite.** The first two refuse loudly and are wrong; the third
  succeeded and described nothing. Same cost either way, because a reader cannot tell the output from a true
  one — so the honest response and the wrong response look identical from outside. The detectable property is
  not "the check was wrong". It is **the check answered about a tree the caller did not name**.
  **Two halves to any fix, and the second is the one that generalises.** Correct the ref, AND make the report
  NAME the tree it measured. A fix that only corrects the ref leaves the next wrong answer exactly as
  unreadable as this one; a report that states its base tree turns a wrong verdict into a _visible_ wrong
  verdict. The launcher half is gated (see [Gated](gated.md), `code-under-proof-is-not-the-code-you-edited`); the
  merge-guard half is a board row, `the-merge-guard-s-base-relative-findings-are`, which carries all
  three instances as evidence and back-links here. That split is deliberate: the row closes when the defect
  is fixed, the class does not.
  **The merge-guard half is fixed, and what the fix could NOT do is the part worth carrying.** `github
merge` fetches `<remote>/<base>` before measuring and opens every report with `measured in tree:` /
  `measured base:` / `measured head:`; an unfetchable tip degrades to the local ref with an acknowledgeable
  `base-unresolved` finding rather than a silent wrong answer. But the `reverts-main` half could not be made
  "unable to fire on a rebased branch", which is what the row asked for: measured on the same tree, it fires
  identically against `main` and against `origin/main`, because a `reset --soft` squash and a deliberate
  revert leave the SAME git graph — head's parent is base's tip either way — so no merge-base-relative test
  separates them, and a test that could not fire on a rebased branch could not fire on the `reset --soft`
  incident either (`src/__tests__/subprocess/cli/commands/github/mergeRun/endToEnd.test.ts` still reconstructs it). What was actually wrong was the CLAIM: it
  asserted a fork-point identity and a base change it never measured, both false on that branch. It now
  states the measurement and names the commit. **The general lesson: when a check cannot separate two cases,
  the fix is to report what it measured, not to assert the conclusion it prefers.**
  **Fourth instance, and it is this class biting the gate written for it.** The launcher gate above resolved
  which tree is which with a plain `git rev-parse`. Git exports `GIT_DIR` to its hooks and `GIT_DIR`
  overrides which repository every later `git` call reads, so under `pre-push` the gate answered about a
  different repository and REFUSED a correct invocation — inside its own `validate`, on the push that was
  landing it. It passed in isolation and in the full subprocess lane, and failed only in the hook, which is
  the signature of this class: a verdict whose answer depends on a tree nobody named. Fixed by scrubbing the
  same five variables `src/lib/gitRepo.ts`'s `gitEnv()` strips, whose header already records the identical
  defect making the TypeScript gates _"inert in the hook that runs them"_. **The lesson worth carrying: a new
  gate that shells out to `git` inherits this by default, and the repo had already paid for it once in
  another language.**
  **Fifth instance, and the one that changed the fix.** The launcher gate then refused a CORRECT invocation
  for a second, unrelated reason: the host exports `PLUGIN_ROOT` into every session and
  `hooks/lib/resolve-root.sh` prefers it, so typing `<checkout>/bin/slopweaver dev …` ran the plugin mirror.
  The refusal was right and still the weaker answer — it reported the problem accurately while leaving the
  caller unable to do the obvious right thing. **An explicitly typed path outranks an inherited variable**,
  so a `dev` verb runs the checkout its own launcher lives in, and the refusal is kept for the case that
  cannot resolve: standing in one checkout, invoking another's launcher. Ordering matters and was got wrong
  once in passing — an explicit `SLOPWEAVER_CLI_DIR` outranks the new preference, and clobbering it made the
  refusal unreachable for a few minutes. Both directions are pinned by tests.
