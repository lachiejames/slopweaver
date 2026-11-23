# Raising a draft pull request from a turn

Bundled reference for the `loop-bot` skill. Loaded when the body links here, not on every turn.

## Answer the thread FIRST — and the door enforces it

On a PUBLIC channel ask, post a first REVIEWED answer in the thread before you open a pull request or start
any other long build. It goes through the ordinary door (`turn answer`), so it is reviewed and voice-checked
like every answer — first does not mean unchecked — and it is allowed to be short and to say what it does not
yet know. What it must do is say what you have found and what you are about to change: a colleague watching
that thread cannot see your session, your branch, or your card's detail line.

A worker handed a `#dev-alerts` ask once spent two hours and thirty-eight minutes landing the right tool
before its first word reached the thread, and the owner asked what was happening twelve minutes before it
arrived — in public, on a thread other people were reading.

`slopweaver github stack push` refuses while the ask THIS session was dispatched for still holds an
unsuperseded dispatch, which is exactly the state "no answer posted" leaves behind. Two things follow:

- **Meeting the refusal is cheaper than overriding it.** Declare the build on that first answer's form —
  `"followThrough": { "owes": "pull-requests" | "other", "what": "<one line>" }` — and the post clears the gate
  while KEEPING your dispatch, your workspace and your card: it is a `first-answered`, not an ending. Your
  FINAL answer, carrying the outcome and no `followThrough`, is what ends the turn; `turn answer` refuses a
  second plan on the same ask. If you vanish mid-build, the sweep strands the ask (`failed`, or `lease-expired`
  on a lease re-armed at the plan) and a recovery pass re-dispatches it ONCE, saying in the thread that the
  plan was posted. The override is `SLOPWEAVER_ALLOW_ANSWER_FIRST=1`, and the refusal prints it.
- **A DM is not gated, and the gate is a tripwire rather than a fence.** A DM's audience is one person who
  can already see the card. And a worker that ran neither `turn resume` nor `turn status` announced no
  session, so the gate cannot see it and lets the push through — its silence proves nothing.

## Step 5 — only on an explicit "raise a PR" or "raise a ticket"

The owner's ruling: raising a pull request or a ticket on an engineer's explicit request is almost always fine, because a code owner still reviews it and nothing
reaches production. It is a general ruling, so it sits under step (b) of the tag decision tree the brief
prints. Three edges are the rule:

- **Unasked, read and report.** "Here's a big problem, what's going on?" gets the findings, never a pull
  request or a ticket and never "I raised a PR, please review": the asker may read the findings and decide
  they do not warrant one, or question the reading. Only an explicit "can you raise a ticket / a PR / a fix
  for this" made TO THE BOT, in the thread, opens the write, and a fix asked for lands as a draft pull request. The same ask
  made of a person ("@alice can you raise a ticket") is theirs, never the bot's.
- **Enough to raise something good, or ask for it.** When
  the detail is in the thread, obvious, or easily inferred, use it and go, with no confirm step. When it is not, the answer says there is not enough to raise something
  good, that raising it now would be raising slop, and names exactly what is missing. That is an ordinary
  FINAL `turn answer` with no `followThrough`, and never `turn block`: the wait is on the asker, not on the owner,
  and either of the other two leaves the ask live, which makes `witness help` refuse the reply below.
- **The asker's reply can finish the ask, tagged or not** (for example a reply saying to pick
  that up and create the ticket). An untagged reply in a thread a person tagged the bot into is an
  `ownThread` witness line, and the loop runs `witness help` on it
  ([unprompted-help.md](unprompted-help.md#the-asker-answering-what-the-bot-asked-for)). Every `witness help`
  refusal still applies, its daily cap included, and with no loop running the reply stays unanswered, by
  design (AGENTS.md rule 2).

Read `/slopweaver:github` for the form; the shape of a turn that ends in a pull request:

1. **Open it with `github stack push`, as a draft.** `github pr create` is refused: every pull request Slopweaver opens is a native GitHub stack entry, single-PR stacks included. This one
   verb amends the worktree into the current commit, pushes it with an exact lease, opens the pull request
   from the form and registers it — so there is **no separate `github push` first**.

   ```bash
   slopweaver github stack push --form - --dry-run <<'JSON'
   { …the form… }
   JSON
   ```

   A dry run performs no effect at all and prints the exact body bytes plus the real verdict from the same
   validator CI runs. Read that verdict, fix what it flags, then drop `--dry-run` and go. Run
   `slopweaver github stack push --form-example` first if you have not filled this form before.

2. **The canonical body, which the form is the typed pre-image of**, is C3: three DERIVED badges (`risk`,
   `problem`, `proof`, none authored); the explainer; Proof of the problem and Proof of the solution; Checks; Not
   checked, and why; then the Re-run fold. **The explainer is capped at 70 rendered words**, counted by the
   repository's own counter — a bare URL is one word, and a link contributes its text but not its URL. The whole
   layout and its caps: [pull-requests](../../github/reference/pull-requests.md).
3. **No grade, ever.** The description publishes none. State each claim honestly instead — a Check that ran,
   or a Not checked item with the one-line reason nobody ran it. A unit test is not a live seam.
4. **Keep the body lean.** Anything non-obvious goes in an inline review comment on the diff, never in the
   description.
5. **Surface the pull-request URL in the thread the instant it exists** — a `progress step --line`, before
   you run the rest of the work.
6. **An update names ONLY what changed** (`--edit`). Everything unmentioned is re-rendered from the form the
   description already carries — the ledger's cached one when it still describes those exact bytes, otherwise
   the live description parsed back — which is what stops an edit destroying the claims. Never resend a
   whole form to change one field. Address it by `--number`; the branch pair still works but you have to be
   right about both names.

Two policy locks you should expect, each with a key, and neither worth fighting by hand:

- **`this pull request was opened by a different GitHub account`** → you are not the author. Do not override
  it in a bot turn; log it and say whose it is.
- **`--form REPLACES the whole description`** → re-run with `SLOPWEAVER_ALLOW_PR_REPLACE=1` when a whole-form
  write is genuinely what the turn needs, and say so in the pull request. It never releases
  `pr-evidence-loss`: a write dropping a screenshot or run link a settled ask of the owner's named is refused on every
  mode ([pr-update-locks](../../github/reference/pr-update-locks.md)).

And one refusal whose remedy is a flag: **`a partial --edit needs the description's current form to merge
into`** means the description was hand-written, or is in the retired table shape (`RETIRED_SHAPE`), so no
partial edit can be safe on it. Send the whole thing with `--file` instead of reconciling by hand. An absent
`proof-patch-id:` line is not this case — a gold body without one reads back fine.

A ticket asked for instead of, or alongside, a pull request is the same ruling and the same shape through
`/slopweaver:linear`: compose a typed form, then let code render and send it.
