# What a Vanta resync changed, judged in the seat that ran it

Every `atlas vanta sync` writes what it changed against the generation it replaced to
`$SLOPWEAVER_HOME/vanta/changes/<at>.json` and prints one `changes:` line naming it. Nothing decides what
matters. The session running the `vanta` resync reads the change and judges it, the same way the Datadog
detective findings reach the owner: now and then a Queue card says that something happened in Vanta and asks
whether to post a line to a channel. No rules are written for this, since the diff is usually small; judge what
the owner would want to see and what the owner would not care about.

Without it, a Vanta email is the only signal: a weekly summary, a compliance framework reactivated, seven vendors
discovered, a risk scenario assigned to the owner. The atlas held three of those four, and nothing read it.

## The step, after `atlas vanta sync && atlas vanta walk`

```bash
slopweaver atlas vanta changes                    # every sync no session has judged, oldest first; exit 3 = none
slopweaver atlas vanta changes --kind risk        # one kind, to look closer; never the listing you mark from
```

Read it as the owner would. Each moved kind leads with its counts and the window it covers (`since`), then what was
added, removed, and the CHANGED entities grouped by which fields moved, **rarest group first**. Timestamp churn
(`lastTestRunDate` on every test, `lastCheckDate` on most computers) collapses into one big group at the end;
the handful of status flips or owner reassignments sit at the top as their own groups. A `baseline` kind had no
prior read, so nothing was compared; an `UNREAD` kind failed this sync, so its changes wait for the next one.
A kind marked `! the sync still called this read failed` (the vendor companion write) WAS read and published,
so it is compared anyway — listed unread, its window would be lost — and its `since` comes from the stored
entities, not the manifest the failure left behind.

For each item worth the owner's attention, park ONE bot draft carrying the post you propose and where:

```bash
slopweaver slack draft record --as bot --channel <C…> --why "Vanta: <what happened>; post to <#channel> because <why>" --form -
```

The form is `no-fold` for a one-line notice, `update` when it needs detail; [the card form](../../slack/reference/the-card-form.md)
says what each refuses. The `--why` is the Queue card's "X happened in Vanta, want to post Y to #Z?" — the
channel is your judgement, named in it. Nothing is sent: the owner releases it with the `slack post` command `slack
draft show <id>` prints, or drops it.

**Then mark what you judged**, naming the `at` the listing ended on (it prints the command), never "everything":
a sync landing while you judged stays unread for the next seat.

```bash
slopweaver atlas vanta changes --mark-read <at>
```

When nothing is worth the owner's attention, mark it read anyway and say in the seat's closing line what you looked at
and passed over. A sync whose `changes:` line reads `NOT RECORDED` lost that window — the next sync compares
against what this one published — so say so rather than reporting a clean read. The record is written just BEFORE the publish, so a sync killed between the
two repeats its changes in the next record rather than losing them.

## A framework snoozed or reactivated

Vanta's frameworks list carries an optional, nullable `status` (`ACTIVE`, `DRAFT`, `SNOOZED`, `ARCHIVED`,
`NEW_UPGRADE`), so a framework snoozed, unsnoozed or reactivated reaches the change record as a framework
`status` change. `null` is a framework with no lifecycle status; an absent field is Vanta returning no status
information.
