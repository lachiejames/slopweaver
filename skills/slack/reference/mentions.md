# Who you can mention, and what refuses

The three resolution layers, what each will and will not take, and the refusals that are deliberate rather
than bugs to work around. The rule — a mention names a PERSON and resolves by exact match — is in
[SKILL.md](../SKILL.md).

Mentions resolve through three layers, strictest first: the store's identity roster (a human
CONFIRMATION, always wins), the **member index** Slack's own `users.list` fills, and last the roster
`slopweaver derive` writes.

**`users.list` is not the whole workspace, and the member index says so rather than pretending.** In a
workspace of an Enterprise Grid, `users.list` cannot return a colleague in a sibling Grid workspace or a
Slack Connect partner — measured, a large minority of the Slack author ids in bronze had no member row for
exactly that reason. `slopweaver refresh` recovers those people from the `user_profile`
Slack stamps on their own messages (`src/corpus/slack/connectMembers.ts`), writing a member row with the
provenance `slack.message.user_profile`. **Those rows carry no email and no `active` flag, because a message
profile has neither** — so they are FOUND by the member layer and then refused by its no-trusted-email rule
below, which turns a silent "no such person" into a named person and a stated reason. Confirm one in
the identity roster (`slopweaver identity roster replace`) to make it addressable; that layer overrides the refusal.

Through the roster layer a key is only addressable if a **Slack** identity owns it — the canonical person
id, the Slack user id, the Slack handle, `@handle`, or the email on that Slack identity; **never** a display
name, and **never** a GitHub/Linear handle, which are exactly the keys a wrong cross-source join would
corrupt.

The **member layer additionally takes a NAME**, and that is safe only because of what it refuses. It matches
by tier — native id, email, handle, full name, then FIRST name, then any other name part — and answers only
when exactly one live colleague at your own email domain matches at the strongest tier reached. Everything
else refuses and says which:

- **two colleagues answer to it** — it names them with their ids and makes you choose;
- **the only match is at another company's email domain** — it refuses rather than tagging a stranger;
- **the only match carries no trusted email** — nothing places them, so nothing is tagged;
- **the colleague has no Slack account** — there is nothing to address.

**The second and third refusals have two exceptions, and both answer "who is placed" another way.** A Slack
workspace bot is addressable unverified. And a person whose Slack id is a **member of the conversation the post
lands in** is addressable at any verification, by id or by name: the membership is the placement — the owner opened the
DM with them, or they are in the channel. The as-me path (`prepareDrip`, so `post --as me`, `draft record` and
the release alike) reads `conversations.members` once when the form mentions anybody; a colleague still wins a
name both answer to, and a read that fails addresses nobody extra.

**A DM tag of somebody NOT in that DM is refused at record time**, with no escape hatch: a DM's members are
fixed, so the person cannot read it and Slack notifies nobody. It applies to 1:1 and group DMs (a group DM reads
`private-channel` on the surface, so the read classifies `is_im`/`is_mpim` itself), never to a channel and never
to the owner's bot DM; an unreadable membership read passes it (`src/outbound/slack/dmMembership.ts`).

**A tag of somebody who has LEFT is refused**, in the same `prepareDrip` pass, so at record time and again at
release, and by `edit --as me` too: every person tagged is read off Slack's live roster (`users.info`, one per
distinct id) and a deactivated account refuses the message, naming who. A Queue reply once tagged a colleague
who had left weeks before, which would be terrible to send in public. The member store is never asked, because a
departure is exactly what changes between refreshes; an account Slack will not describe refuses too, since a check
that could not run checked nothing. The one account that passes without a deactivation answer is a member of
ANOTHER workspace in a shared channel (a Slack Connect partner): Slack omits `deleted` for them, and they never
left this one. It passes only when the record omits `deleted`, carries `is_stranger`, names a `team_id` that
differs from the posting token's own (`auth.test`, read only for that shape), carries the tagged id, and carries no
Enterprise Grid block (`enterprise_user`, `enterprise_id`); short of that it stays unreadable. A Grid member is never
external: its team list is current membership only, so one who just left this workspace reads like a stranger.
No escape hatch: drop the tag, and tag whoever holds their work now (`src/outbound/slack/departedTags.ts`).

Two roster refusals remain and are not bugs to work around: a key **two people claim** is dropped rather
than resolved to whichever came first, and a link `derive` is **holding** can never address a mention.
Confirm either in the identity roster if it is real — that layer overrides every refusal above.

A token the member index names NOBODY for can still resolve through a **heard-as pin**: a `heardAs` list on an
identity roster record, declaring what voice-to-text makes of that colleague's name (`src/silver/heardAs.ts`,
[the roster](../../../docs/security/identity-roster.md)). It never outranks a real match and applies only when
one record claims the token.

A **stale derived roster never blocks a send whose mentions the member index settled**, and `derive` is
not run just-in-time for one. It runs, and is reported, when a key falls through to the roster layer.
