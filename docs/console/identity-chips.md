# Identity chips, and the thread a reply goes under

A card names people, never raw `<@U…>` ids, because a name helps the owner remember more than a user id does. A
person is a chip whose hover card carries their profile picture, name, position at the company and the workstreams
they relate to for the owner, and a reply card links to its Slack thread. Every field below is derived — member
bronze, the board, `auth.test` — never typed.

## The roster

`slack draft list --json`'s `people` roster ([queue and triage](./queue-and-triage.md)) also names a thread root's
author and every `<@U…>` the root's text or the draft's why names (`draftMemberIds`,
`src/outbound/slack/draftRegister.ts`). Each entry carries the profile `title` (a blank one is absent),
`firstNameUnique`: whether no other current person's names hold that first name as any word (Chris Lucas makes
"Lucas" shared; Slackbot is not a person), and `nameUnique`:
whether no other current person's name is theirs or starts with it (`src/corpus/members/slackPeople.ts`). A person
goes by every name their member row holds — the display name and Slack's real, first and display names — since a
display name is often a handle. Only rows keyed by a member id are counted: member bronze also holds rows keyed by
a display name, each a second copy of somebody, which made every one of those names look shared.

**Each entry carries `org` too: where they sit in the org chart** — their title, Vanta groups and team. It is joined by the member's TRUSTED Slack email
only (a weak or missing address joins nothing) off two stores already on disk, read-only, with no provider call:
the Google directory bronze (`title`, `organizations[0].department` as the team, `orgUnitPath`), reached by a
primary address, an alias or a leaver's pre-`term_emp_` address; and the Vanta atlas's `person` and `group` kinds
(`jobTitle` when Google has no title, employment `status`, and every group by name, the smallest first, so
"Full-time permanent" or "Security council" leads and "Everyone" trails). Only an observed Vanta generation counts,
and a group id no observed group names is left out. **A wrong join draws one person's team on another's chip, so
ambiguity joins nobody**: the address is matched exactly as issued, trimmed and lowercased (`hello+slack@` never
reaches `hello@`); a primary always means its own user, while an alias or leaver's address two users claim means
neither, and an alias never reaches a colleague for a deactivated member, whose address was likely handed on, nor joins anything on a leaver's old address Google
re-issued as someone's primary, or Vanta renamed a leaver off (`term_emp_`) after Google deleted them; an address several Vanta people hold resolves only for an active member with exactly one `CURRENT`
holder, and the stores must agree on whether they still work here, so a live Google account never carries a `FORMER` Vanta
record, a leaver never a `CURRENT` or `UPCOMING` one, and an active member on a leaver's address Vanta says
someone employed holds joins nobody (the stores refresh apart, so a disagreement is a leaver
and a new hire on one address); a bot joins nothing. `org` is absent when neither store holds the address
(`src/corpus/members/orgChartIndex.ts` indexes the stores, `orgChart.ts` joins a member, read by `slack draft list|show|context --json`). A stale org chart is refreshed
by `slopweaver atlas vanta sync` and `slopweaver store identity --pull`, never by this read.

## The chip, and a name everywhere else

**An identity chip is drawn in ONE place: a card's properties**, as who its message tags and who is in its thread,
one chip per person, stacked ([properties](./queue-card-properties.md)), because a chip on every person inline is
visually overwhelming. `PersonChip.tsx` is the face and name, and on hover or focus the picture, name,
title (the org chart's when it holds one, else Slack's), `@handle`, an **org chart** block, and the owner's workstreams
naming them. The block's lines are title, Slack's own title when it differs, team, org unit, Vanta groups and Vanta
status, each naming its store — Google Admin, Vanta or Slack — so a wrong team is traceable
(`site/lib/personOrg.ts`). **A member Slack says has left is drawn deactivated**: the chip greyed — muted ink, no
tint on the chip or its hover band, initials on the muted tile rather than a hue, a dashed edge — and "(deactivated)" beside the name on hover, the org chart block, Google Admin's org unit
included, kept as it was. `deactivated` is member bronze's `profile.active === false`, carried on the roster entry
(`src/corpus/members/slackPeople.ts`); the look is token classes only, since a faded or filtered chip is the faded
text the theme's contrast gate refuses.

**Everywhere else on a card a person is words** (`personWords`, `site/lib/cardPeopleDisplay.ts`, drawn by
`InlineText.tsx` and folded the same way by `inlinePlain`): a `<@U…>`, `<@U…|label>`, bare member id or rostered
name reads as their first name, or their whole name when another colleague shares that first name. **The owner is never
named at all — the card says "you"**: "the owner's" reads "your", "the owner is" reads "you are", either capitalised
opening a sentence. Whether a first name is shared is judged across the whole workspace (`firstNameUnique`), not
among the people one card names, as the owner's ruling words it: a superset, so two people a card names who share a first
name are always told apart, at the cost of a whole name on some cards that would not need one. Counting per card
needs every name a card's sentences match before any is drawn, which no one place holds.

A parked post's own lines — who it is to (`to Quinn, Theo and Abel Sutter in a thread in #team-product-a`),
whose thread it lands on and whose message it replies under — name people the same way (`spokenName`,
`site/lib/slackPeople.ts`). A user group reads as the key the draft recorded, else the `@handle` the wire wrote, else
"@a group", never its `S…` id, which is only ever the hover (`groupLabel`): in a quoted message, in
the conversation above a draft, in a stored thread, in the tag summary and in the Queue's one-line preview alike; the
draft preview itself keeps the names Slack draws. That one-line preview reads a Slack link as its label, else its
address, never its `<https://…|label>` markup: a post's wire text through `slackWireWords`, its
escapes undone once, and a held reply's form words by their complete tokens only, nothing unescaped
(`site/lib/queueReviewLine.ts`).

Names are found the same way they always were: the same spellings the workstream match below uses, longest first so
a whole name is one person, only in the words left after addresses resolve — so a URL, a Slack link's label or a
slug is never cut — and never beside a hyphen, slash or `@` (`withNames`, `site/lib/personMentions.ts`). A bot is
never unique, so is never matched by name.

A stream is listed when one of its OPEN board rows names the person — by id or `@handle` in any case, or by name as a capitalised proper noun: the whole name when it is two words or more and `nameUnique`, the
first name alone only when `firstNameUnique` (a one-word name is a first name) — read off the rows' own `workstream=` tags, with the rows
that matched (`site/lib/personMentions.ts`). Each row is named as words, never linked: a board row has no page of
its own, and a Queue card never cites one (`PersonChip.tsx`). None are listed
for the owner: the owner is on every row.

- The owner's quoted words in the source block stay verbatim (`SourceBlock.tsx`); the sentence beside them is the page's
  own, so it names people as words like any other.
- An unknown labelled mention reads `@label`. An unknown `<@U…>` stays as written and is the drawer's `slack`
  citation finding. A bare id the roster does not name stays words.
- **Never inside the Slack draft preview.** That preview is the exact message the owner approves, so it draws a mention as
  Slack does (`SlackDraft.tsx`), and the thread root it replies under reads `@name` the same way
  (`draftParentInWords`, `site/lib/slackPeople.ts`).

## The thread link

`slack draft record --thread-ts` stores the thread root's permalink on `threadParent.permalink`
(`withThreadPermalink`, `src/cli/commands/slack/draftCompose.ts`): the root's link, built from the `auth.test`
workspace, only for a `C`/`G`/`D` channel and an https workspace, and outside the digest, so linking the thread never
changes what the owner's approval binds. The post card's links row draws it as a Slack citation reading "thread in
dev-alerts" (`threadLinks.tsx`). A row recorded before the field, `sd-70dc71fc` among them, has none and draws no
link.
