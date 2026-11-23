# The KnowBe4 atlas reads who owes training, and a token the owner mints is the only key it holds

Part of [Atlases](../atlases.md).

Owner ask: a KnowBe4 integration and atlas built like every other integration, read-only, serving
the Vanta↔KnowBe4 group mapping and the training update prompt. So the atlas holds the people, the groups and
who sits in them, the training campaigns and each person's enrolment and status, and the phishing tests and
how each recipient did. It changes nothing in KnowBe4, and nothing here can.

```bash
slopweaver atlas knowbe4 sync          # read the account and publish one generation
slopweaver atlas knowbe4 read --kind training-enrollment
slopweaver atlas knowbe4 coverage      # what it read, what it could not, and why
slopweaver atlas knowbe4 reset --confirm archive
```

## The token is the owner's to mint, and the seat never creates or copies one

The one credential is a KnowBe4 **Reporting API** token in `$SLOPWEAVER_HOME/secrets/knowbe4-api-token`
(`0600`, written by `slopweaver secrets set knowbe4-api-token`). `src/live/knowbe4/credential.ts` reads that
file and nothing else — no environment fallback — never through a symlink, never a file its group or others can
read (the store's `0600` is enforced here, not assumed), and never under a home its group or
others can write, where a rename could swap the directory between the check and the read (the secret writer
refuses the same home). With no file, `sync` exits `3` and prints ONE hand step:

> create a NEW Reporting API token in training.knowbe4.com → Account Settings → Account Integrations → API →
> Reporting API (Create New API Token — never regenerate the existing one, which Vanta's connector reads),
> then run `slopweaver secrets set knowbe4-api-token` and paste it

KnowBe4 allows several Reporting API tokens per account, so a **dedicated** token is
the right shape: regenerating the existing one would break Vanta's KnowBe4 connector the moment it rotated.
The Reporting API needs a Platinum, Diamond, SAT Foundations or SAT Advanced subscription; a path that answers
`403` is recorded as `permissionBlocked` naming that requirement, never as an empty kind.

## Read-only is a property of the door, not a promise

`src/live/knowbe4/transport.ts` can send exactly one thing: a `GET` (the method is a type with one member) to
`https://us.api.knowbe4.com` (a constant — Acme's console is `training.knowbe4.com`, the US region), on one of
eleven closed path templates, with only the query keys that template is read with. A parent id must be digits,
and the built URL is re-checked after the URL parser normalises it — and again inside `knowbe4Get`
(`isClosedListUrl`), so no caller can hand it a URL the closed list did not build. Redirects are refused, so the bearer
cannot be forwarded anywhere the door did not choose. The descriptor's `writePolicy` is `refuse-every-write`.

## What it reads — eleven of the 24 published GETs

The Reporting API document (`https://developer.knowbe4.com/elvis-swagger.yml`, sha256 of the copy read in
`src/atlas/knowbe4/descriptor.ts`) publishes 24 GET path templates. The sync calls eleven, one kind each:

| Path                                          | Kind                     | What the atlas keeps                                                        |
| --------------------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `/v1/account`                                 | `account`                | name, subscription tier and end date, seats, domains, risk score            |
| `/v1/users`                                   | `user`                   | email, name, department, job title, status, group ids, risk and phish-prone |
| `/v1/groups`                                  | `group`                  | name, type, member count, status, risk score                                |
| `/v1/groups/{id}/members`                     | `group-member`           | one `<group>:<user>` edge per membership                                    |
| `/v1/training/campaigns`                      | `training-campaign`      | name, status, groups, content, start/end, duration, auto-enrol              |
| `/v1/training/store_purchases`                | `store-purchase`         | module metadata — never a description                                       |
| `/v1/training/policies`                       | `policy`                 | uploaded policy name, status, minimum time                                  |
| `/v1/training/enrollments`                    | `training-enrollment`    | person, campaign, module, status (incl. `Past Due`), enrol/start/complete   |
| `/v1/phishing/campaigns`                      | `phishing-campaign`      | name, status, groups, frequency, last run, last phish-prone %               |
| `/v1/phishing/security_tests`                 | `phishing-security-test` | each test's groups, template name, outcome counts                           |
| `/v1/phishing/security_tests/{id}/recipients` | `phishing-recipient`     | per person: delivered/opened/clicked/reported/… timestamps                  |

The transport only fetches, handing back the body's text; `readPage` (`fill/run.ts`) parses it, and a body that is
not JSON fails its path. Every page goes through a strict per-endpoint boundary first (`fill/boundaries.ts`) — a field the spec never
declared refuses the page rather than riding along — then an ALLOWLIST copies only the named fields
(`fill/project.ts`). Where the wire and the spec disagree the wire wins: a store purchase's id is
`store_purchase_id` as KnowBe4 sends it, not the spec's `store_purchased_id`. Two query parameters are fixed on purpose: the campaigns list always sends
`exclude_percentages=true`, because KnowBe4 caps that list at ten rows for any other value, and enrolments keep
archived people, because an archived person's incomplete assignment is still a fact about the control.

The thirteen uncalled GETs are each named with a reason in `fill/plan.ts`'s `KNOWBE4_NOT_CALLED`: nine by-id
reads that repeat a list row, three risk-score histories, and a per-campaign test list the test list already
covers. `unit/atlas/knowbe4/fillPlan.test.ts` fails if the called and uncalled sets stop partitioning the 24.

## What it does NOT read

- **Device and location telemetry** — a recipient's IP, IP location, browser and OS; a user's phones, manager,
  custom fields, location and sign-in times; the account's admins; module descriptions and policy URLs. The
  boundary declares them so drift is caught; the projector never copies them (`names-not-values`).
- **A per-person due date.** The Reporting API publishes none. An enrolment's `status` — KnowBe4's own
  `Past Due` included — is the authority, and the campaign carries its timing (`claim-not-made`).
- **Callback phishing.** KnowBe4 selects it on both phishing-test paths with `campaign_type=callback` and does
  not say whether the plain list already holds it. `fill/plan.ts`'s `KNOWBE4_UNREAD_PARTITIONS` names both, and
  each publishes an `excluded` coverage cell on its kind, so a phishing kind never reads as holding callback
  results. The first credentialed sync settles whether reading it adds rows or repeats them.
- **PhishER and the User Event API** — separate products and credentials (`out-of-platform`).
- **The console.** The `kmsat-console` surface declares 16 routes and has reached none; it is a declared,
  unfilled browser surface, never a launched browser.

## It shares a rate budget with Vanta, so a run is bounded in requests

KnowBe4 meters the Reporting API per ACCOUNT: 4 a second, 50 a minute (a five-minute lockout past it) and 2,000
plus the licensed-user count a day, and Vanta's connector draws on the same allowance. `knowbe4:read` is one of
the classes `src/lib/providerCall.ts` actually SPACES (`PACED_CLASSES`), at 30% of the per-minute limit
(its row in `src/lib/rateLimitsAdminServices.ts`, not the registry's usual 80%): 15 a minute, leaving Vanta's
connector 35 of the 50 rather than 10. The limiter is per process, so a second sync running at once, or Vanta's
own traffic, is not coordinated with; the first credentialed sync is what shows the real contention. What keeps this door small beside Vanta's is that `fill/run.ts` caps one run at 250 requests, 20
pages of 500 per list, 100 groups and 200 security tests fanned out. Each GET is sent once — `knowbe4Get` passes
`maxAttempts: 1` — so the 250 counts every request that reaches KnowBe4, retries included — and fails after 30
seconds, so one stalled response cannot hang the run. The two fan-outs run
LAST, so it is group members and recipients the ceiling cuts, never the enrolments and campaigns the nag reads.

A run that hits a bound leaves the kind's last WHOLE read exactly as it was — before there is one, it publishes
what it reached — with its cell `deferred` and the bound named, its attempt `failed` naming the bound, and its last
success left at the last whole read, so a partial read never reads as a fresh one and the file is always the kind
as of its `lastSuccessAt`. One path failing never sinks the others: its kind carries the earlier generation's entities and last
success forward. Either way `sync` exits 1 so a scheduler sees it. A 403 is the exception, exiting 0 — its own,
or its parent list's, which refuses the child on the same ground: the kind is stamped with the subscription tier
that would lift it.

## How a list is known to be whole

KnowBe4 has announced a date for removing `page` in favour of `cursor`; the runner pages by `page`
today, and `readList` in `fill/run.ts` does not trust a short page to mean the end:

- **A top-level list ends only on an EMPTY page.** A list that caps or ignores `per_page` is followed to its end
  rather than cut at its first page, for one extra request per list.
- **A page that repeats an id already read in the list fails the path**, on a later page or the same one. That is
  a list no longer honouring `page`, answering its first page again.
- **A per-parent list is checked against the parent's own count** (`expectedRows` in `fill/plan.ts`): a group's
  ACTIVE members against its `member_count` (which counts active members only, while the list also returns
  archived ones, so only a row whose status is `active` counts: `countedRow` in `fill/plan.ts`), a CLOSED phishing test's recipients against its
  `scheduled_count`. A
  list held to a count ends on its first short page, because one more request per parent is what would spend the
  ceiling, and a row count other than the parent's — fewer or more — marks the read as not whole. One with no count
  to hold it to (an active test, or a closed one KnowBe4 sent no count for) is followed to an empty page. A group with no
  `member_count` or no name fails the groups page, so no member list is ever read with nothing to hold it to.
- **A row the mapping or the nag cannot act on fails its page**: an enrolment with no `status`; an enrolment or a
  phishing recipient naming neither a user id nor a non-blank email (`rowsOwned` in `fill/projectShapes.ts`); a campaign
  or security test that leaves out the groups it targets, rather than reading as targeting nobody.

What stays open: an ACTIVE test's recipients are not held to its count, since it may not have sent to everyone
yet, and a row inserted or deleted between two pages can shift another past the read without repeating an id.
Moving to `cursor` closes the second, is the same function, and waits for the first credentialed sync to show the
cursor's shape: the spec says how to START one (`cursor=true`) but not where the next pointer comes back, and every
list body is a bare array, so building it now would be a guess. That sync has to land before KnowBe4's announced
date, when `page` goes; until then a list that stops honouring `page` fails closed (a repeated id, or a count mismatch) rather
than publishing as whole. It is also when the live meaning of `scheduled_count` is confirmed.

A failure's words and a bound's reason reach a coverage cell and a log line, so every one — not only a transport
error — passes through `withTokenWithheld` (`fill/withheld.ts`) before it is published: a bound names the provider ids it
stopped under, and a body echoing the token as one would otherwise carry it out. A strict boundary's refusal goes
further first: it names a field it does not declare by KnowBe4's own key, which can be data or a token spelled
across two keys, so `publishableWords` (`fill/projectShapes.ts`) COUNTS an undeclared or renamed field and names
only the ones this repository declared. A kept row is never edited, so a path any of whose rows quotes the token
(an `email` echoing it, say) fails whole, carrying its earlier generation forward, rather than being stored.

A user whose `groups` KnowBe4 leaves out (the spec does not require it) is kept with `groupIds: null`, membership
unknown, never `[]`, which would read as "in no groups". A bounded group-member fan-out keeps the last whole
membership rather than merging into it: retiring an edge a re-read group dropped would be a failed run shrinking
the kind, which the kit's evidence-loss gate (`src/atlas/kit/evidenceLoss.ts`) refuses, and keeping it beside the
edges the run added would be a set as of no instant at all.

A kind that has only ever been read partially is still published, with no `lastSuccessAt` and its cell
`deferred`, and the sync exits 1. Whether a reader serves such a kind as an answer is the shared atlas kit's
read side, the same for every atlas (`src/atlas/kit/mandatoryKinds.ts` § what this judges), so the update prompt and
the mapping read a kind only once it has a `lastSuccessAt`, and each needs a test over a never-whole fixture to
prove it. An enrolment's `status` is kept as KnowBe4 wrote it, not classified: the spec names `Not Started`, `In
Progress`, `Completed`, `Passed` and `Past Due`, and the nag treats any other value as unknown rather than as done
or owed.

A campaign's or test's target groups are kept as `targetGroups`, each id WITH the name KnowBe4 gives it there,
because a target need not be a row of `/v1/groups`: the spec's own example target is `{ group_id: 0, name: "All
Users" }`, and an id alone would leave the mapping unable to name it. Whether `/v1/groups` emits id `0` is for the
first credentialed sync to show.
