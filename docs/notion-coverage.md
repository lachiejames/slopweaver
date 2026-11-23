# Notion coverage — what the connector reads, and what it does not

Measured by a bounded live crawl, not inferred from the code's intent; where a thing was _not_ observed, this file says so rather than implying it
cannot happen. No page title, id, url, database name, teamspace name or person appears anywhere below.

The reason this file exists: **a page whose body was never indexed is invisible to a query, and nothing about
the answer reports the blindness — it just returns fewer citations.** Depth, and honesty about depth, is the
thing being tracked.

## Scale

| Measure                                        | Value                                   |
| ---------------------------------------------- | --------------------------------------- |
| Pages visible to `search`                      | thousands                               |
| Blocks walked in the census                    | thousands (bounded walk, block depth 6) |
| Pages that returned block content              | every page sampled                      |
| Pages that came back title-and-properties only | 0 sampled                               |

## Block census — what rendered as empty, and whether that was a defect

A renderer that only reads `block[block.type].rich_text` is correct for a paragraph and silently wrong for
every type that carries its text elsewhere. Measured empty-render counts under that rule, and the fix each got:

| Block type                 | Count  | Rendered empty | Verdict                                                          |
| -------------------------- | ------ | -------------- | ---------------------------------------------------------------- |
| `table_row`                | 429    | 429            | **defect — fixed.** `cells` is `rich_text[][]`                   |
| `child_page`               | 139    | 139            | **defect — fixed.** `title` is a bare string                     |
| `image`                    | 75     | 75             | **defect — fixed.** `caption`, not `rich_text`                   |
| `table`                    | 73     | 73             | correct — content lives in its rows                              |
| `divider`                  | 118    | 118            | correct — no text                                                |
| `table_of_contents`        | 16     | 16             | correct — generated, no text                                     |
| `link_preview`             | 6      | 6              | **fixed** — `url`                                                |
| `child_database`           | 4      | 4              | **fixed** — `title`                                              |
| `column` / `column_list`   | 4 / 2  | all            | correct — content in children                                    |
| `video` / `embed` / `file` | 1 each | all            | **fixed** — url + caption                                        |
| `bookmark`                 | 1      | 1              | **fixed** — url + caption                                        |
| `link_to_page`             | 1      | 1              | open — carries only a target id, no prose                        |
| `to_do`                    | 167    | 3              | **partially fixed** — text rendered, `checked` state was dropped |
| `code`                     | 129    | 0              | **improved** — `language` was dropped                            |

`table_row` is the one that mattered. A control matrix, a risk register, a decision log — the documents an
auditor asks for — are tables, and every cell of every one of them was indexed as an empty string.

**A renderer gap in a DATABASE ROW is not recoverable by re-deriving silver.** A row's text is rendered and
its raw block tree is _not_ retained on the record (`raw` holds the page object only), so a gap there closes
only by a re-fetch — the strongest argument in this file for auditing a connector before trusting its depth.
A PAGE's body is stored as a tree, so re-deriving it is local — see "Re-deriving a page's text calls no
Notion" below.

## The pages lane does not recurse

The pages lane reads each body with ONE `pages.retrieveMarkdown` call (`src/corpus/notion/liveMarkdown.ts`)
and parses it into a typed tree (`src/corpus/notion/markdownProjection.ts`). `renderMarkdownBody` has no code
path into another page at all, so the walk cannot leave the page it is capturing. Child pages come back as
ids and are drained by a QUEUE (`src/corpus/notion/pageFrontier.ts`) with a visited set, one shared budget,
and one record per page.

**Measured live**, same command and same `--fetch-cap 25` against a recursive block walk, 81
items both times: **142 requests for the walk, 54 for the markdown call**, and the crawl fell from 396s to
313s. Stored text equals each page's OWN body — three pages compared against their projected markdown gave
a ratio of 1.00, including one with five child references, which is the check that children are not inlined.

The measurement below is why the queue exists rather than the ids simply being dropped.

## Re-deriving a page's text calls no Notion

The parsed tree goes to a content-addressed sidecar under `corpus/bodies/notion` (`src/corpus/notion/bodyStore.ts`), through the same
store the attachment bytes use (`src/corpus/contentStore.ts`), and the page's representative record — chunk
0 — carries `body: "sha256:<digest>"`.

**What that buys, and the two limits, stated rather than left to be discovered:**

- **Changing how a Notion body renders is a local pass** over stored trees instead of a re-fetch of the
  workspace — the defect class at the top of this file, repairable without provider calls.
- **A re-pull is idempotent down to the bytes.** An unchanged body serialises identically, hashes to the same
  digest, finds the file already there and writes nothing — and the record's attr does not move either, so the
  page's fingerprint is byte-identical to what the earlier run wrote.
- **PAGES only.** A database ROW's text is projected from its properties by a different lane
  (`liveApiDatabases.ts`), which never renders a markdown body, so a row carries no `body` attr and the
  paragraph above about `raw` holding the page object only is still exactly true of one.
- **A page record with no `body` attr** is indistinguishable from a page whose body could not be stored. The
  digest's ABSENCE means "re-derivation must re-fetch", so such a record is correct, just not cheap.

## Child-page reachability is load-bearing — measured, against expectation

The obvious-looking simplification is to stop recursing into `child_page` blocks, on the theory that a child
page is separately returned by `search` anyway. **Measured, that is false:**

| Measure                                | Value        |
| -------------------------------------- | ------------ |
| `child_page` blocks found by recursion | 98           |
| …also returned by `search`             | 48           |
| …**invisible to `search`**             | **50 (51%)** |

So a descent is the only path to half of those pages. That reachability is the frontier queue's job, and it
is the reason `renderMarkdownBody` returns `childPageIds` instead of discarding them. Following those
references is also the only thing in the crawl that can reach into a teamspace the integration was never
connected to — an `object_not_found` that would otherwise kill the whole run. Hence the typed skip channel
rather than a narrower crawl.

A child page lands as its own record with its own id, so a citation points at the child rather than at
whichever ancestor would have swallowed it: 12.2% of pages carried another page's body under recursive
inlining, 0 under the queue.

## API surface the connector does not request

Enumerated from `@notionhq/client` 5.23.2's actual method table and request types, not from memory.

### Requested today

`search` (page + data_source) · `pages.retrieveMarkdown` · `blocks.children.list` · `comments.list` · `dataSources.query`
(with `sorts` + a `last_edited_time` `TimestampFilter`, so `--since` bounds the row FETCH rather than
only what is kept) · `users.list`

### Not requested — with what each would add

| Endpoint / parameter                                      | What is lost by not asking                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`request_status` on `search` and `dataSources.query`**  | Notion reports its own result set `incomplete` (`query_result_limit_reached`); the connector reads it as a `result-limit` skip                         |
| **`in_trash` on `search` and `dataSources.query`**        | Archived/trashed pages and rows are never requested. This is the Linear lesson repeating verbatim — archived content exists and is requestable         |
| `dataSources.retrieve` / `databases.retrieve`             | The property **schema** and the database **description** — `description` is hardcoded `""`, so a database's own explanation of itself is never indexed |
| `pages.properties.retrieve`                               | A property with more than 25 relation/rollup references comes back truncated and is never paged                                                        |
| `views.list` / `views.retrieve` / `views.queries.results` | Database views — the saved filters a team actually works through                                                                                       |
| `blocks.meetingNotes.query`                               | Meeting notes                                                                                                                                          |
| `filter_properties`                                       | Narrowing a row query to the columns that matter                                                                                                       |

### Property types rendered vs dropped

Rendered: `title` `rich_text` `select` `status` `multi_select` `number` `checkbox` `date` `url` `email`
`phone_number` `people` `relation`.

Dropped: **`unique_id`** (the human-readable record id, e.g. `RISK-14`), `formula`, `rollup`, `created_time`,
`last_edited_time`, `created_by`, `last_edited_by`, `verification`, `files` (as text — kept as a file ref),
`place`, `button`.

Only `created_time` was actually _observed_ dropped in the sample, because the sampled pages carried few
properties. The rest are read off the renderer table against Notion's documented property set, so treat them
as _possible_ rather than confirmed present in this workspace.

## Attachments are FETCHED, under a measured ceiling

The owner wants the full page including the attachments
on it, with a size limit so a terabyte file is never fetched. Bytes land content-addressed under `corpus/attachments/notion`, and a
record carries the sha256 DIGEST rather than a url, because a Notion signed url expires within the hour.

**Three measured facts shape it**, and each ruled out the obvious design:

- **The corpus holds urls for exactly the files that must not be downloaded.** `stableFileUrl` keeps only an
  author-provided url, never Notion's own, so most stored refs read `file: <name>.pdf` while the ones that DO
  carry a url are third-party links a page happens to reference. Those are classified `external` and left
  alone: someone else's site is not an attachment on the page.
- **The markdown endpoint exposes no fetchable url.** Its media `src` is `file://` plus a percent-encoded
  envelope whose `source` is almost always an `attachment:<uuid>` handle, and where it is a storage url that
  url is unsigned and 403s. The signed url lives only in the block json, so an attachment-bearing page takes
  one extra top-level `blocks.children.list` pass.
- **HEAD is refused.** The signature covers GET, so sizing is a ranged GET reading the total out of
  `Content-Range`.

**The ceiling is 100 MiB**, from 145 real attachments sized across 150 of the 425 attachment-bearing pages:
median 1.51 MiB, p95 9.96, p99 21.17, max 31.97. Reproduce by walking those pages' file blocks and probing
each signed url with `Range: bytes=0-1023`. `--no-notion-attachments` withholds the fetch.

## Other measured limits

- **Comment authorship** files `created_by.id` — **explicit id only**, never a name match — so "who discussed
  this" is answerable for the one record kind that _is_ a discussion.
- **Inline block comments** are not enumerated: `comments.list` is called with the _page_ id, so a comment
  anchored to one block inside the page is not requested.
- **No block-depth cap applies to a page body**: the body is one `pages.retrieveMarkdown` call
  (`src/corpus/notion/liveMarkdown.ts`). `--notion-block-depth` (`src/corpus/notion/caps.ts`) still parses,
  but bounds only the recursive block renderer, which nothing calls (`src/corpus/notion/liveBlocks.ts`).
- **`synced_block`** — a _duplicate_ synced block stores its content under the original's id, so rendering it
  needs a second fetch against a different block. **None occurred in the measured workspace**, so the shape
  is unproven and it is listed here rather than guessed at.
- **The SDK absorbs 429s before the shared block sees them.** `new Client({ auth })` leaves
  `DEFAULT_MAX_RETRIES` at **2**, so the Notion SDK retries and sleeps off a rate limit internally and
  `safeProviderCall` is handed the failure only after that budget is spent — or never, if the SDK's own retry
  succeeds. The shared 429 block therefore does not learn that this provider is limited, and other lanes keep
  spending against an exhausted quota. Observed live: an uncapped run logged five
  `@notionhq/client warn: request fail { code: 'rate_limited' }` lines and survived, entirely inside the SDK.

  This is the same defect the Slack read clients were fixed for by setting `retries: 0` so a 429 reaches the
  block. It is **left unchanged here on purpose**: turning the SDK's retries off changes the crawl's pacing
  and its patience, which belongs in a measured change about ingest rate rather than as a side effect of a
  correctness fix. Recorded so it is a known gap rather than an accident.

## Skip reasons

An unreadable node is a classified skip, never a fatal (except `auth`). The reasons are kept apart because
they call for different responses — see `src/corpus/notion/skips.ts`.

| Reason          | Meaning                                   | Holds the watermark back?                    |
| --------------- | ----------------------------------------- | -------------------------------------------- |
| `auth`          | the token was rejected                    | fatal — the run stops                        |
| `rate-limit`    | outlasted the retry budget                | **yes**                                      |
| `network`       | outlasted the retry budget                | **yes**                                      |
| `result-limit`  | Notion declared its result set incomplete | no — re-scanning returns the same truncation |
| `restricted`    | shared but access-restricted              | no — a sharing setting to change             |
| `unshared`      | not shared with the integration           | no — normal and permanent                    |
| `depth-cap`     | the block renderer's own depth bound      | no                                           |
| `item-deadline` | item spent its per-item REQUEST budget    | no                                           |
| `item-time-cap` | item spent its per-item TIME budget       | no                                           |
| `unknown`       | unclassified                              | no                                           |

`unshared` must not hold the cursor: a cursor held back for a permanently unreadable page wedges the lane
forever, and a gate that can never go green is worth no more than one that always is.

`item-deadline` and `item-time-cap` are kept apart because they answer different questions about a lifted
re-pull: the first says an item did a pathological amount of WORK, the second that it took a pathological
amount of TIME, and only the first gets cheaper when `--notion-item-calls` raises the request budget.

A run always reports its skip count — **including when it is zero**, which is stated explicitly rather than
left as silence. Silence is indistinguishable from a lane that never checked.
