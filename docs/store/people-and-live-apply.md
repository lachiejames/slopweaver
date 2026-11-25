# People: the email is the key, each platform's id is a column

Part of [The local Supabase store](../store.md).

An earlier `person` table held a couple of thousand rows of which nearly half were named by a Slack id
and a fifth by a UUID, dozens of display names shared by two or more rows, and several Slack `B…` bot ids stored under
`"source": "linear"`. The fix is to pull the identities from Google admin and make the email address the key,
with the Slack user id, Linear user id, GitHub user id and handle as columns: each person is an actual person as
provisioned in Google Admin. So `person` (`src/store/schema/person.ts`) is one row per human: `email` UNIQUE NOT NULL and
normalised, `display_name`/`given_name`/`family_name`/`org_unit_path`/`title` from Google, `google_id`, and
`slack_user_id`, `linear_user_id`, `linear_display_name`, `github_id`, `github_login`, `notion_user_id` —
each nullable, each UNIQUE, each pinned by a CHECK to that platform's own id shape. There is no identity
array, no identity table and no trigger over one. `id` stays as the uuid `content.author_id` points at.

**Every defect above is a refusal rather than a row now.** One email is one person, so a human cannot be two
rows. One platform id is one column on one row, so it cannot belong to two people. A Slack id in the Linear
column fails `person_linear_user_id_shape`; a display name in it fails the same way. A person cannot be
named by their id because nothing here ever names one — a name comes from Google or from a member profile,
and a member with neither name nor handle is named by their address.

**Bots are not people, and that is our read on the owner's open question.** A Datadog post carries a Slack bot id
and no mailbox; there is nothing to key it on and nothing to join it to, so it never enters `person`. What
it authored keeps the platform's own author id on the content row: `content.author_native_id` is set for
EVERY row whose record names an author, human or bot, and `content.author_id` is the person that id resolved
to — null for a bot or a stranger. Every reader shows `coalesce(person.display_name,
content.author_native_id)` and `--author` filters on that same value, so a bot's post is still attributed,
to the bot. `content_slack.is_bot`, `bot_id` and `app_id` say which Slack rows those are; the source-neutral
flag the detective verbs filter on is `content.author_is_bot`, decided by `src/store/botAuthor.ts` and
described in [the detective reads](thread-relations-and-detective-reads.md).

### Where the people come from, in order of authority

1. **The Google Workspace directory.** `slopweaver store identity --pull` reads `directory.users.list`
   through the existing read-only Admin grant (`admin.directory.user.readonly`, capability
   `directory-users`) with the official `@googleapis/admin` SDK, every page, values included — the atlas's
   own read of the same method keeps key NAMES only, by design (`withheldValues: true`) — and REPLACES
   `$SLOPWEAVER_HOME/corpus/directory/google-admin.jsonl` whole (`src/corpus/directory/`). A snapshot rather
   than an append-only log because the directory is the one list where absence is information. Suspended and
   archived users are included; `active` is Google's own `!suspended && !archived`.
2. **The member pull** `slopweaver refresh` already writes to `corpus/members/<source>.jsonl`. A member with
   a `trusted` address (unique, personal, not a role alias) joins the person carrying that address — Google's
   primary, any alias, or the address an off-boarded person used before their `term_emp_` rename. Their
   platform id lands on that row. A member with a trusted address Google does NOT hold still becomes a
   person with `google_id` null: staff whose Workspace account was deleted, contractors on their own domain,
   Slack guests on gmail — nobody who leaves is forgotten. Their
   `active` folds the platforms' word (any yes wins, all no is no, silence is null).
3. **A bot is skipped.** A non-bot member with no trusted address is matched by NAME and recorded in
   `person_link_candidate` for review — never applied, because a wrong auto-merge is invisible afterwards
   and a wrong candidate is a row somebody rejects.

**One name is allowed to link, and its three conditions are the argument.** A GitHub account that is a
MEMBER of the organisation, whose profile carries a FULL name matching a person's exactly after
normalisation, where that name is UNIQUE across every person, is linked and recorded as an `accepted`
candidate carrying its signal — auditable, and re-derived every run. MEASURED: only a small minority of
organisation members expose a public address, so without the name-link rule many logins and tens of
thousands of GitHub rows reach nobody.

**Three address shapes the email key cannot see through on its own, each closed exactly rather than
heuristically.** Slack rewrites a deactivated member's address to `deactivateduser<n>-<workspace>@slack-corp.com`,
which the member pull rates `trusted` because it IS unique — to nobody; it is refused as a key (people
were once built on one). Off-boarding renames a leaver to `term_emp_<local>@<domain>` while every platform still
knows them by `<local>@<domain>`, so that used address folds into the directory's, unless the directory has
since re-issued it to somebody else. And a Linear author is named by the `@`-handle alone on tens of thousands of rows —
captures older than the connector's id fix carry `creator: { displayName }` and nothing else — so
`linear_display_name` is a column, taken only from an ORG member (an external user Linear mints for a synced
commenter can echo a member's handle: handles appear on more than one member overall, while the org members'
handles are all distinct).

### The one writer, and what a run does

`slopweaver store identity` (`src/store/identity/reconcile.ts`) is the ONLY code that writes `person`. The
decision is one pure function, `buildPeople` (`src/store/identity/people.ts`), so every branch above is a
unit test over real member shapes; the write is one transaction that first renames in place any stored row
whose google id a draft now carries under a new primary address (through a scratch address, so a swap or a
chain is safe; the row keeps its uuid and everything attached to it), releases any platform id that moved to
another address, upserts every draft on `email`, records the candidates, re-points `content.author_id` from
`author_native_id` through the id columns (one `UPDATE … FROM` per source), and prunes the people this build
did not produce that no content row points at. A second run over unchanged inputs changes nothing. A rename
whose new address another row that stays put already holds would need two rows merged, a rename whose old
address a member with no google id still reports would split one person into two rows, and an address Google
has reissued from one google id to another would hand a preserved person's row to someone else, so the run stops
before any write with `PERSON_COLLIDED`, naming the person; a unique index refusing a write anyway is named
the same way, never as the bare driver line (`src/store/identity/rekey.ts`).

**Record ingest never mints a person.** `src/store/ingestIds.ts` loads the id columns once per run into a map
and looks each author up; a miss leaves `author_id` null and is counted as `authorsUnresolved`. The fallback
that wrote `displayName: author.handle ?? author.nativeId` is gone, and with it the whole path that placed
identities from record authors — a superseded capture's author no longer carries anything its row does not.

**MEASURED on the live store**, migration `0001` then `store identity --pull`. Reproduce with
`slopweaver store identity` (twice, for the idempotence) and the SQL below.

| What                                                      | Before                              | After                                   |
| --------------------------------------------------------- | ----------------------------------- | --------------------------------------- |
| `person` rows                                             | thousands                           | **roughly a thousand**                  |
| … keyed by Google Admin                                   | none                                | hundreds                                |
| … carrying two or more platform ids                       | one                                 | **hundreds**                            |
| … active / deactivated / nobody said                      | none / none / all                   | hundreds in each major class            |
| display names shared by 2+ rows                           | dozens                              | dozens, all of them candidates          |
| display names that are a Slack id or a UUID               | hundreds                            | **none**                                |
| Slack `B…` ids under a Linear source                      | a handful                           | none — a CHECK refuses one              |
| content rows with an author, resolved to a person         | hundreds of thousands (to id-named) | hundreds of thousands, a large majority |
| … by source: linear / slack / notion / github             | —                                   | highest for linear, lowest for github   |
| link candidates: name / same-name pair / exact org member | hundreds pending, none applied      | hundreds / dozens / a small applied set |
| second run: rows written, rows re-pointed                 | —                                   | 0, 0                                    |

```sql
select count(*) people, count(*) filter (where google_id is not null) google,
       count(*) filter (where display_name ~ '^[UBW][0-9A-Z]{8,}$' or display_name ~ '^[0-9a-f]{8}-') idnamed,
       count(*) filter (where (slack_user_id is not null)::int + (linear_user_id is not null)::int
                            + (github_id is not null)::int + (notion_user_id is not null)::int >= 2) multi
from person;
select count(*) from (select display_name from person group by 1 having count(*) > 1) d;
select source, round(100.0 * count(author_id) / count(author_native_id), 1) pct
from content where author_native_id is not null group by 1 order by 2 desc;
```

**The 55 remaining shared names are two real mailboxes each, and every one is a candidate rather than a
merge.** A colleague's personal gmail beside their work address, a staff member's second Workspace account on
the NZ domain, a contractor's `.ctr` account beside their staff one — each is a unique key issued by an
authority, so each is correctly its own person, and only the owner can say which pairs are one human. The
owner ruled that a display name is not a reliable source (many people set a Slack display name unrelated to
their real one), so the duplicate is made VISIBLE instead of guessed at.

**What still does not resolve, stated rather than discovered.** GitHub sits at 11.0% and that is the honest
ceiling of what this install can see: 19,514 of the unresolved rows are `coderabbitai`, 10,300
`github-actions`, and most of the rest are org members whose GitHub profile carries neither a public address
nor a full name, so nothing outside us says which human a login is. The login→SSO-email join is the route
that completes it — `src/connect/github.ts` already probes for it (_"SAML external identities visible"_) —
and it needs an org-admin scope this install's token does not carry. Linear's external users (a Slack- or
GitHub-synced commenter mirrored into Linear) carry no address and no activity, and stay candidates. Gmail
resolves to nobody by construction: record bronze redacts the sender's address, so a mail row's author is a
display name, which is also why `gmail` is absent from `PERSON_COLUMN_BY_SOURCE`.

**A departure is a field, not an absence.** Nobody is deleted and no
grouping is withdrawn. A person Google no longer lists keeps their row, their email and their history, and
is simply not upserted, while a person Google still lists under a changed primary address keeps their row
under the new one; a platform id that vanished from a pull stays where it was, because member bronze
cannot express a departure (an unchanged member writes no row and a missing file reads as empty) and a
reconciler that withdrew on absence would strip a source the first time one pull failed. Only an id that
MOVED to another address is released, because two people cannot hold one. The prune is not an exception to
that: it deletes only a row this build did not produce AND that no content row points at, and it is skipped
entirely when the build produced nobody, so a failed directory pull cannot empty the table. `active` is
three-valued on purpose — `null` means nobody said, which is a different claim from `true`.

**The closed vocabularies are the corpus's own.** `content_kind` is exactly `CorpusKind` and
`content_source` is exactly `CorpusSource` minus `gold` (synthesised at query time, never persisted).
Nothing in the type system connects a Postgres enum to a TypeScript union, so the agreement is a test —
`src/__tests__/unit/store/schemaDrift.test.ts` — and it was written because the first draft of the enum
was wrong in both directions at once: no word for `need`, `huddle` or `transcript`, so every Slack huddle
and Google Meet transcript in bronze was unstorable, and an `email` no connector has ever emitted.

Full-text search is a **generated stored** `tsvector` column, so it cannot drift from the text it indexes.

**There is NO vectors table, and there is no `vector` extension.** Full
text search over the whole store answers in single digit milliseconds and already covers every row for free,
so no pgvector and no index build are needed. No migration in the journal creates either, so
a fresh install replays a history with no pgvector in it.

## Three things that only a live apply catches

Each is recorded where it bit, with a reproduction, and together they are why the migration is applied
against the real local stack rather than trusted for generating — and why one of them was found only once
it was applied against THAT stack rather than a plain Postgres:

- **A `text` column typechecks, generates cleanly, and fails on apply** — `data type text has no default
operator class for access method "gin"`. `searchable` is a `customType` emitting `tsvector` for exactly
  this reason.
- **A policy set can be complete and still deny everyone.** `SELECT` on each table without `USAGE` on the
  schema gives all three roles "relation does not exist" and consults no policy — while unit tests asserting
  what the statement list CONTAINS pass, because a missing grant is an absence.
- **A role can exist, hold every policy, and be assumable by nothing.** MEASURED against the
  local Supabase stack: every `set role slopweaver_bot` answered `permission denied to set role`, so the
  whole segmentation was unreachable. Two facts produce it and neither is in the statement list — Supabase's
  `postgres` is not a superuser, and since Postgres 16 `CREATE ROLE` grants the creator `ADMIN OPTION`
  without `SET`. The second is why it reads as working: `pg_auth_members` shows the membership. The fix is
  one grant per role, `with inherit false, set true`, so a connection asks for a hat instead of wearing all
  three. This one was invisible on the plain Postgres 15 the first pass checked against, where a superuser
  may assume any role.
