# The thread edge is a RELATION, and the backfill is its own verb

Part of [The local Supabase store](../store.md).

A reply must be followable to its parent. A thread edge held as a bare string allows no
such query — the parent key comes in four shapes, three of them per-source, none a foreign key — so the edge
is one derived column and one foreign key, and `store query --thread` walks it.

`content` carries two columns. **`parent_source_id`** is the parent's own `source_id`, derived by the
pure `parentSourceId` in `src/store/parentSourceId.ts` at projection time — so the edge is a column, and the
projection and the backfill call one function rather than two copies of one rule. **`parent_id`** is the
relation: a self-referential foreign key, `on delete cascade` like every side table's, `idx_content_parent`
on it, and a partial `idx_content_parent_unresolved` over `(source, parent_source_id)` for the rows that
still have an edge and no relation.

**The relation is resolved by a PASS, and that is forced rather than chosen.** Ingest writes 500 rows per
statement in bronze CAPTURE order, so a reply and the message it answers land in one statement in either
order; a key checked at insert time rejects the batch. `parent_source_id` is in
`CONTENT_REFRESH_ON_CONFLICT` and **`parent_id` deliberately is not** — a re-ingest carries no resolved
uuid, so listing it would null every edge in the store on every refresh and the only symptom would be a
thread walk quietly returning one row.

**Linear's `attrs.parentComment` stays in `metadata`, and that is the one place a derived column does not
claim its input.** Everywhere else in this projection an attribute a column took is REMOVED from
`metadata`, because a fact in two places can disagree with itself. Claiming this one was written and is a
data-loss bug, caught in review before it landed: the backfill re-derives from the STORED row, so the next
`store edges` after a re-ingest would read a null `parentComment`, derive the ISSUE, and overwrite a
correct nested edge with a less specific one — while `parent_id` still pointed at the comment. A derived
key is a FUNCTION of an attribute, not a copy of it, and deleting the input leaves nothing to recompute
from. `parentEdges.test.ts` § "the derivation's own input survives in the row" is the witness, and it
reddens on exactly that edit.

**The rules are a closed per-source list, not "the text before the first colon".** That shortcut was
tried and measured wrong: it turns Linear's `project:<uuid>`, `initiative:<uuid>`, `document:<uuid>`,
`projectUpdate:<uuid>`, `milestone:<uuid>` and `need:<uuid>` into the bare words `project`, `initiative`,
`document`, `projectUpdate`, `milestone` and `need`, and GitHub's `<repo>#<n>:state` into the pull
request's own number — thousands of Linear rows and most of the tens of thousands of GitHub pull requests
claiming a parent that is a word rather than a row. MEASURED against the live store; reproduce with
`slopweaver store edges --json`:

| source | rule               | edges                    | resolve       | dangling              |
| ------ | ------------------ | ------------------------ | ------------- | --------------------- |
| slack  | `:reply:`          | hundreds of thousands    | nearly all    | thousands             |
| slack  | `:file:`           | tens of thousands        | about half    | about half            |
| slack  | `:chunk:` (huddle) | hundreds                 | all           | 0                     |
| github | `:comment:`        | about a hundred thousand | nearly all    | hundreds              |
| github | `:review:`         | tens of thousands        | nearly all    | hundreds              |
| notion | `:chunk:` (page)   | about a hundred thousand | all but one   | 1                     |
| notion | `:comment:`        | over a thousand          | under half    | over half             |
| linear | `:comment:`        | tens of thousands        | nearly all    | hundreds              |
| TOTAL  |                    | **most of a million**    | **about 95%** | **tens of thousands** |

A chunked document's later chunk points at its own **`:chunk:0`**, never at a bare id no row carries — the
bare-page rule resolves a few percent of the Notion rows where this one resolves all but one.

**A dangling edge is the column earning its keep, not a broken rule.** Tens of thousands of rows name a parent outside
the ingested window — a Slack file captured by the files lane whose message was never ingested is most of
it. With only a uuid stored, those are indistinguishable from rows that genuinely start a thread; with
the natural key beside it, the next ingest of that parent resolves them on the next pass.

**`slopweaver store edges` is the verb, not a step in `store push`.** A migration's job is the SHAPE, and
`ALTER TABLE … ADD COLUMN` with no default is a catalog change that finishes instantly on a table of any
size; writing most of a million edges is a data pass. Both halves are idempotent — the key derivation writes only
what differs, the resolution updates a set that strictly shrinks — so an interrupted run is finished by
running it again, and `--keys-only` stops after the first half for checking what a rule change would
write. MEASURED at full scale — all of the store's more than a million identities copied into a throwaway
`edges_proof` database, one cold pass writing every key and every relation in **2 m 47 s**, of which 9.6 s
is this process and the rest is Postgres. A second run over the same database writes nothing.

**The read is `--thread` on the query schema, not a seventh verb.** `store query --source <s> --thread
<native-id>` climbs `parent_id` to the row that has none and then descends from there, which is two index
seeks and no per-source join. Climbing first is the point: a detective lands on a REPLY far more often
than on the message that started it, and a downward-only walk returns the tail of a conversation and calls
it the conversation. A `--thread` with no `--source` is refused, because a native id is unique only within
a source and picking one returns a DIFFERENT conversation rather than an error. This is the one thread
read that works for GitHub, Linear and Notion as well — `probe/aroundSlack.ts`'s `threadWindow`, the string
join on `coalesce(thread_ts, message_ts)` it does not replace, could only ever answer for Slack.
Row-level security is not bypassed by the recursion, and that is in our favour: `content`'s bot predicate
is `visibility = 'public'`, so a walk run as `slopweaver_bot` stops at a private ancestor by the
database's decision.

**Both walks carry a `CYCLE` clause, because one of the four rules reads a provider attribute rather than
an id.** Every id rule names a strictly shorter prefix, so it cannot mint a cycle; Linear's nesting comes
from `attrs.parentComment`, so two comments naming each other is data this store cannot rule out. Without
the clause that is not a wrong answer but a query that never returns — MEASURED by seeding
exactly that pair, where the pre-fix walk was still running when a 5-second `statement_timeout` cancelled
it and the shipped one answers both rows immediately. The final `select … union select id from ancestry`
is the same defence: a thread whose root is unreachable answers with the chain that was walked instead of
with nothing.

## The progressive-disclosure ladder the detectives climb

`slopweaver store probe | groups | hits | peek | open | around` — six verbs so that a Haiku detective navigates this store through a command rather than hand-written SQL. They
are a reading ORDER, and each rung costs more than the one above it: counts, then where the counts
concentrate, then one page of records, then a window of one record, then the whole record, then what was
being said around it.

`probe` is the entry point and the one that carries the design. It fans every keyword across **seven search
shapes** — `exact` (the stemmed word, through the generated tsvector), `wild-left` (`*term`), `slash`
(`/…term…/`), `alnum` (`[0-9a-z]*term[0-9a-z]*`), `wild-right` (`term*`), `wild-both` (`*term*`) and a
caller-authored `regex` — over the WHOLE store, and returns a count per shape with the source split and the
record ids of any cell narrow enough to enumerate.

**What the ladder is for, measured on all of about two million rows** (reproduce each with
`slopweaver store probe <keyword>`):

| keyword   | `exact`         | narrowest rung           | `wild-both`     | whole ladder |
| --------- | --------------- | ------------------------ | --------------- | ------------ |
| `quillen` | dozens          | `wild-left`, a few fewer | thousands       | 1.1 s        |
| `17000`   | 13              | **`slash` 4**            | 20              | 0.6 s        |
| `datadog` | about a million | `slash`, thousands       | about a million | 13.6 s       |

`quillen` is why `exact` is insufficient alone: `to_tsvector` tokenises on punctuation, so a name inside an
email address, a `<@U…|handle>` mention or a URL never produces the bare lexeme and **98.5% of the records
that mention that person are invisible to the search this store shipped**. Only a substring reaches them.

**Two implementation decisions carry the cost, and both are in `src/store/probe/sql.ts`.** Every substring
shape is a subset of `wild-both`, so the ladder is ONE trigram-indexed containment scan that materialises
the hit set and then `count(*) FILTER` over exactly those rows — the `alnum` shape alone, as its own
statement, is 8,416 ms where all five together through the CTE are 789 ms. And that scan narrows on the
two INDEXED expressions (`body`, `coalesce(title,'')`) rather than on their concatenation: naming the
concatenation matches no index, returns the same rows, and takes 8,061 ms.

`idx_content_body_trgm` and `idx_content_title_trgm` are what serve it, declared in `schema/content.ts`
with `pg_trgm` created by `policies.ts`'s extension phase. A term under three characters has no
extractable trigram at all and scans every row — `body ilike '%nz%'` is 5,126 ms against the tsvector's
94 ms — so the probe reports `[no index — scanned every row]` on that cell rather than being quietly slow.

`around` takes an anchor and a window and has **no term parameter**, which is the load-bearing property
rather than an omission: two of the four lap-two questions were settled by thread replies containing none
of the search terms, and a context read that keeps the search predicate returns the hit again and calls it
context. `peek` centres its window on the match rather than on the head of the body, which is what lets a
detective tell pull request `17000` from Zendesk ticket `#170006` without opening either record.

### Human authors first, and `--include-bots` widens

Slack's own search leaves automations out by default, so the detectives start human-only
and widen. The three SEARCH rungs — `probe`, `groups`, `hits` — count and list only rows whose
`content.author_is_bot` is false unless `--include-bots` is given; `--exclude-bots` is the default's own
spelling and both together are refused. `store detect` sizes its wave on the same human-only probe. The
READING rungs — `peek`, `open`, `around` — never filter: a detective that has an anchor is reading a
conversation the way a human sees it in Slack, bot posts in it included.

`probe` does not hide what it left out. Each subject prints `bots: N bot-authored row(s) … not counted`
when its `wild-both` set (or its regex's matches) held any, counted inside the same containment scan by one
more `count(*) FILTER`, and the footer names which author scope ran. Widened, every count is the one it
was before the column existed — the same unfiltered aggregates, with only that `bots` column added beside
them; `probeSql.test.ts` holds both halves. The filter
applies AFTER the trigram or tsvector narrowing, which is why the column carries no index.

**One rule decides the column, `src/store/botAuthor.ts`**, called by the projection on every ingest and
by `slopweaver store bots`, the backfill for rows stored before it existed (the same verb-not-migration
split as `store edges` above; idempotent, writes only what differs in either direction). Slack: a `bot_id`
or the `bot_message` subtype. GitHub: a `[bot]` login or `user.type === "Bot"`. Linear: a `botActor` acting
for a `[bot]` account, or an automation actor (`workflow`, `oauthClient`) with no human author beside it — a
`botActor` alone is not the signal, because Slack thread sync, Slack Asks, email and GitHub issue sync are
conduits for a person's words and over ten thousand synced records name no author object at all. Every other source
has no per-record automation marker in its payload and answers false, so a Notion integration's page is a
known false negative rather than a silent one.

MEASURED on a throwaway `bots_proof` database holding all of `bronze/linear/compact.jsonl` plus
one GitHub and one Slack window file (about a hundred thousand rows): ingest flagged 568 — 523 Slack (all but 6 a
`bot_message` or an app's `bot_profile`, those 6 carrying a bare `bot_id`), 27 GitHub (26 of them the team repository's self-hosted Renovate App), 18 Linear (15
`workflow`, 2 CodeRabbit, 1 Renovate). Every flag cleared by hand, `store bots` restored exactly those 568 in
6.1 s and a second run wrote nothing. `store probe renovate` printed 71 human `wild-both` rows and 27 hidden;
`store hits` listed 71, and 98 with `--include-bots`. Reproduce with `createdb bots_proof`,
`SLOPWEAVER_STORE_URL` at it, `store push`, `store ingest --file … --all`, then the verbs.

### The redacted Slack timestamp, and why `around` keys a thread on the id

One verb shows a message **the way a human sees Slack** — the whole thread it
sits in AND the top-level channel messages before and after it, so a detective can scroll up out of a
thread and spot the nearby conversation on the same topic. That is `store around --mode conversation`, the
default: two labelled bands, `->` on the anchor inside its thread and `**` on that
thread's own row in the channel, each channel row carrying Slack's own reply count.

Building it found the defect underneath it. **`content_slack.message_ts` and `content_slack.thread_ts` are
destroyed by redaction, and always were.** `redactRecord.ts`'s `redactRecord` runs `redactText` over a
record's `text`, `title`, `attrs` and `raw`, and that pass rewrites any run of nine or more digits as
`[number]` — so a Slack `ts`, whose epoch half is ten digits, lands in bronze as `[number].008629`, and
`store/project.ts` promoted both columns out of that scrubbed bag:

```sql
select count(*) filter (where position('[' in message_ts) > 0) as carved,
       count(*) filter (where message_ts ~ '^[0-9]+[.][0-9]+$') as intact,
       count(*) from content_slack;
-- <carved> | 0 | <total>   (hundreds of thousands of rows)
```

93.4% of `message_ts` carved up, **none** intact, and 100% of the non-null `thread_ts` values the same.
The consequence is not a cosmetic one, because `thread_ts` is a JOIN KEY: grouping a thread on a six-digit
tail merges two unrelated threads in one channel whose roots happen to share it, with nothing in the output
marking that it happened. Reproduce the damage:

```sql
with slack as (
  select cs.channel_id, split_part(c.source_id, ':', 2) as true_key,
         coalesce(cs.thread_ts, cs.message_ts) as stored_key
  from content c join content_slack cs on cs.content_id = c.id
  where c.kind in ('message', 'comment')
)
select count(*) as merged_keys, sum(rows) as rows_in_a_merged_group from (
  select count(*) as rows from slack group by channel_id, stored_key
  having count(distinct true_key) > 1
) m;
-- thousands | tens of thousands  -- of hundreds of thousands of thread keys and rows; the worst merges 8
```

**The fix is that `sourceId` is one of the three fields `redactRecord` structurally never passes through a
pass** (`url` and `container` are the others). `corpus/slack/project.ts` builds a top-level message's id as
`<channel>:<ts>` and a reply's as `<channel>:<threadTs>:reply:<replyTs>`, so part two is the thread's root
either way — for a reply it is its thread's, for a root it is its own, which IS its thread's. Verified
intact on every reply and every message, hundreds of thousands of rows. So every Slack read in
`store/probe/aroundSlack.ts` keys on `split_part(content.source_id, ':', 2)` and sorts on the row's own
timestamp, and `store/slackIds.ts` is the one place that layout is parsed — by the reader, by the CLI
parser that accepts a `<channel>:<ts>` id or a pasted Slack permalink as `--id`, and by the projection.

Two things follow that are the shape of the repair rather than a note:

- **`corpus/redact.ts` gained a `SLACK_TS_SPAN` exemption**, beside the UUID, git-oid and sha256 spans that
  were already there for the same class. A `ts` is an address, not a credential, and the span admits only
  digits and a dot, so it widens the redactor by nothing a secret could hide in.
- **`store/project.ts` derives both columns from `sourceId`**, falling back to the payload only when the id
  is not one of the two message layouts; `store/slackColumns.ts` holds that choice. That means **a re-ingest of the bronze already on disk heals every
  existing row with no provider refetch** — `slopweaver store ingest --source slack --all`, an operator act.
  Until it is run, the columns stay carved up and nothing reading them is trustworthy.

The window walk does not use those columns at all, so it is correct today. `channelWindow` selects
`content.container_id = $1::uuid and content.kind = 'message'` — top-level posts only, which is what a
person scrolling a channel sees, and which also keeps a `canvas` (`canvas:<id>`) and a `pin`
(`<channel>:pin:<ts>`) out of a timestamp sort they have no timestamp for. **81 ms on the busiest channel**
(tens of thousands of rows), on `idx_content_container_time`, against 174 ms for the same walk expressed as a join. An
expression index over `split_part(source_id, ':', 2)` would take the thread band off a scan and is the
named follow-up, not part of this.

### The same six verbs reach Datadog, and the vocabulary is the only thing they share

`--source datadog` routes `probe`, `groups` and `hits` at live
Datadog instead of this store, and a `dd:` id routes `peek`, `open` and `around` there with no `--source` at
all — an id is where a detective got to, and making it retype the source would be ceremony. A detective
learns six verbs, not twelve.

What it deliberately does NOT share is the ladder itself. The seven shapes above exist because
`to_tsvector` tokenises on punctuation; Datadog's message index does not, so six of the seven collapse
there. Datadog's ladder is four rungs — `term`, `term-wild` (`*t*`), `all-fields` (`*:t*`),
`all-fields-wild` (`*:*t*`) — and MEASURED over one production day all four returned on the order of tens of thousands of rows; only the
`*:` prefix materially moved the count. So `--shape` is
refused by name against Datadog and `--rung` is its own flag, rather than one being silently mapped onto
the other. Datadog's syntax has no regular expressions at all, so `--regex` on `store hits --source datadog`
pulls a bounded page and matches locally, and says it did.

The join is local: `store detect` probes the question's keywords against the Datadog SHAPE CATALOGUE
(`slopweaver datadog catalogue build|show`, `$SLOPWEAVER_HOME/datadog/catalogue`) before anything reaches
the network, and only a hit there produces a Datadog lead. A catalogue holds the service map, the per-service
volumes and one row per `(family, env, service, site)` shape — paths and types for every attribute, values
only for a closed facet allowlist, a normalised message template, and the query that reproduces it. **No
event is ever stored**: Datadog writes millions of log lines per day into a multiweek index, many times this store's scale over a
retention window.

Two properties come from owner rulings rather than from engineering. **Every environment is in scope by
default** — no `env:` clause anywhere, because some of this organisation's logs carry the wrong env key or
none, and any `env:` clause excludes exactly those. And **nothing is masked in what the bot reads**:
`store open --id dd:…` returns `usr.*` and `session.ip` whole, because redacting mid-investigation is a
hindrance and because `around --mode ip` — find what else came from an IP, check whether any of it carried a
uid — is a move the owner performs personally. The redaction is at the Slack post
(`src/outbound/slack/piiRedaction.ts`), which is the one place an audience appears.

Datadog is metered and this store is not, which is the other reason the gate is local: MEASURED,
`logs_public_search_api` allows **3 requests per 10 seconds** on this site. A wave that probed Datadog on
every keyword of every question would spend that budget on questions Datadog cannot answer.

Who spawns the detectives, how many, and what each is told:
[skills/loop-bot/reference/detective-fanout.md](../../skills/loop-bot/reference/detective-fanout.md).
