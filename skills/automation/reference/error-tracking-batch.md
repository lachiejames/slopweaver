# An error-tracking-batch row — about five fix pull requests a week, off Error Tracking

The simplest thing is to triage the top-n error patterns over a window. So, beside the unknown-unknowns [organisation hunt](organisation-hunt.md), a batch
the shape of the security and dependency bump batches: **a cap of about five pull requests, about weekly**, each
taken from Datadog Error Tracking, each saying **the user-facing impact, the blast radius and the options**, and
each parked for **the owning team's channel**. `error-tracking-batch-<name>` is the row a registered team repository
declares ([team repository rows](team-repository-rows.md)).

**It is declared HELD** until the owner's yes on the #monitoring proposal the same steer asked for; `automation due` renders
it held and nothing seats it. Lifting the hold is the owner's word on the Queue, never a session's edit.

## The order is the contract

You were seated with ONE command, `slopweaver automation run-due --recipe error-tracking-batch-<name> --claim-id
<token>`. **Run it LAST**: it settles the firing, and the firing is the whole batch.

1. **Read both lists.** The row's own argv is the blast-radius list — `slopweaver datadog errors --query
'env:(prod OR production)' --from 7d --state for-review --order count`, both env spellings because NZ's browser
   apps emit `prod` (with `--track rum`, `env:production` alone missed 47 NZ issues over 7 days). Read the regressions list yourself with `--order
newest`: an issue first seen in a recent release outranks an old one of the same size. Each line names the
   service, the first-seen age and version, and the issue id; `--json` carries the rest.
2. **Pick at most five.** Blast radius first, a fresh regression beside it; skip an issue with an open pull request
   or a board row already on it (`slopweaver handover list`). Five is the cap, not a quota.
3. **Measure each before you write a line of fix.** Impact, blast radius and priority exactly as the regression hunt
   measures them ([measure before you grade](finding-card.md#measure-before-you-grade), [the
   matrix](finding-card.md#the-matrix)): unique users on the parent spans over the window, what the customer or
   staff member sees, and the grade that resolves to. An issue that reaches nobody — a retry that succeeds, a bot's
   malformed URL — is still a fix, graded low and said so. A `datadog apm` figure is sampled indexed spans, so its
   header prints it as a lower bound: a lead, never the blast radius. Corroborate a material count in `datadog logs`.
4. **One pull request per issue, in acme-admin.** The body leads with **impact, blast radius and options**: the fix
   taken, and the alternatives weighed (drop the log to a warning, handle the case, fix the caller). Link the issue
   (`https://<this install's console>/error-tracking/issue/<id>`). Raise it as the owner's, drafted, the way a bump batch is.
5. **Park one post per pull request for the owning team's channel**, as the bot, exactly as a detective
   finding parks ([parking a finding](finding-card.md#parking-a-finding-a-queue-card-then-the-bots-post)
   and [which team](finding-card.md#which-team-name-it-from-evidence-and-say-how)) — `slack draft record --as bot
--kind finding`, three pictures. Nothing posts until the owner approves the card.
6. **Move each triaged issue out of For Review**, yourself: `slopweaver datadog triage --issue <id>[,<id>...]
--state reviewed` once its pull request is up, `--state ignored` when the batch decides it is noise (which also
   mutes the issue's monitor notifications, so the card says so). It reads
   each issue, moves the rest through the door and reads every one back; exit 0 means all of them read back in
   that state. The card names each issue, the state it took and why (the pull request, or what makes it noise),
   and the act is recorded with `autonomy record`. A non-zero exit after a move may still have changed Datadog:
   record the `moved` ids `--json` prints (accepted and read back in that state, not proof nobody else moved
   them; a failure's message names them too), and every `uncertain` one as MAY have moved, never nothing. `--dry-run` reads and plans only. Never a browser click.
7. **Settle.** Run the claimed `run-due`, then answer in the board row with the pull requests and draft ids.

## The numbers that justified the batch

Measured with `slopweaver datadog errors --query env:production --from 1d --state for-review`: the
For Review state at its cap (the API caps a state at 100, so this is a floor), a median age of months, the oldest
near a year, and most of them over 30 days old. And over half of production
error spans over seven days carried no `error.type` at all, so Error Tracking never grouped them:
`slopweaver datadog apm 'env:production status:error -@error.type:*' --from 7d`.

## No GraphQL error-code batch exists

Asked in the same steer. No recipe row, kind or declared row raises GraphQL error-code pull requests today; the
nearest things are two board rows about shared GraphQL error codes. A core-api `GraphQLError` reaching the top of
this list is fixed by this batch like any other issue. A separate GraphQL batch is a new ask for the owner, not a row
this one implies.

## What ends the seat without five

A thin week is a short batch. An issue that cannot be fixed unattended — a vendor fault, a schema change another
team owns — becomes a board finding with the exact steps (`slopweaver handover register --ask "…" --finding
--evidence "…"`) and is moved to Reviewed (`datadog triage`), named on the card with that row as its reason. Say what you could not prove,
then settle and close your workspace.
