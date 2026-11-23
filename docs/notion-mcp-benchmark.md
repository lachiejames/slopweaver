# Notion writes: this door versus the official Notion MCP server

Measured against `@notionhq/notion-mcp-server` **2.5.1** (`latest` at the time of measurement), by starting the real server over stdio and reading its own
`tools/list` — not from its README and not from memory. No page title, database name, teamspace name or
person appears below.

The reason this file exists: **the MCP server and this door reach the same Notion API, so "can it do X" is
almost never the question.** Both create a page, both replace a body, both move one, both trash one. What
differs is what happens around the call, and that difference is invisible until something goes wrong. This
file measures the two surfaces so the comparison is a number rather than an opinion.

Reproduce the MCP half:

```bash
cd "$(mktemp -d)" && printf '{"name":"b","packageManager":"yarn@4.17.1"}' > package.json && touch yarn.lock
yarn add @notionhq/notion-mcp-server@2.5.1
# then speak MCP at it: initialize → notifications/initialized → tools/list, over stdio
```

and this half:

```bash
slopweaver notion --help && for v in image page read verify; do slopweaver notion "$v" --help; done
```

## The surface, measured

| Measure                                       |    Notion MCP 2.5.1 | `slopweaver notion` |
| --------------------------------------------- | ------------------: | ------------------: |
| Tools / verbs exposed                         |                  24 |                   4 |
| Of those, ones that can WRITE                 |                  11 | 2 (`page`, `image`) |
| Bytes of surface description a caller loads   |          **76,215** |           **5,506** |
| …and how much of it is loaded to do one thing | all of it, up front |    one verb's usage |

The 14× is not a style point. An MCP server's tool list is loaded into the model's context before the
model has decided what it is doing, so 76 KB of OpenAPI-derived JSON Schema is the standing cost of having
Notion available at all. A verb's usage is read when the verb is reached.

**Where the MCP's 24 genuinely win.** It exposes block-level reads and writes (`API-patch-block-children`,
`API-update-a-block`, `API-delete-a-block`), data-source create/update/query, comment create, and page
property-item reads. This door has no verb for any of those, deliberately — `notion read` is a bounded
named read of one page and every block nested in it, and the crawl is `refresh`'s job — so an agent that needs to edit one block in place has
something the MCP can do and this cannot. State that rather than claiming parity.

## The four page mutations, side by side

Every row is the same Notion endpoint underneath. The column that matters is the third.

| Act            | MCP tool                      | This door             | What the door adds                                                                                                       |
| -------------- | ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| create a page  | `API-post-page`               | `notion page create`  | intent reservation (at-most-once), markdown body preflight, bare-ref and above-fold gates, image placeholders, read-back |
| replace a body | `API-update-page-markdown`    | `notion page update`  | ledger ownership, provider authorship, canonical-digest comparison, `--overwrite-external-edit` with a journalled reason |
| move a page    | `API-move-page`               | `notion page move`    | ledger ownership, parent read-back before AND after, `unmoved` when it was already there                                 |
| trash a page   | `API-patch-page` (`in_trash`) | `notion page archive` | a NAMED verb rather than a field on the general update, and a read-back that says what went                              |

Three measured details behind that table:

- **`API-move-page` requires exactly `page_id` and `parent`, and nothing else.** No ownership question, no
  read-back, no answer to "it was already there". `notion page move` makes 3 provider calls for the same act
  — `retrievePage` → `pages.move` → `retrievePage` — and the two reads are the whole point: the first is
  what turns an already-correct parent into `unmoved` with nothing sent, and the second is what lets the
  verb claim `moved` on the page's own word rather than on the response body's.
  Witness: `src/__tests__/unit/cli/commands/notion/pageRun/move.test.ts`, "re-parents the page and reports where
  it came from", which asserts that exact sequence.
- **Trashing a page is a PARAMETER on the MCP's general page update.** `in_trash`/`archived` appear in the
  input schema of `API-patch-page`, `API-update-a-block` and `API-query-data-source`. So a model asked to
  "tidy up a property" is one field away from trashing the page, in the same call, with the same tool name in
  the log. `notion page archive` is a word an operator has to type.
- **Zero of the 11 write tools carries any ownership, last-editor, dry-run or confirmation language.** That
  was checked rather than assumed: a regex for `last.edited|ownership|dry.run|confirm|irreversible|destroy`
  over the whole tool list matched exactly one tool, `API-post-search`, and the match was its
  `last_edited_time` SORT parameter. This is not a criticism of the MCP server — a faithful transport of an
  API should not invent policy — it is the statement of which layer the policy has to live in.

## What this door has that no tool list can express

These are the reason the comparison is not "24 versus 4". Each is a refusal, and a refusal is a thing a
verb does, never a thing a schema declares.

- **At-most-once creation.** Notion assigns the page id, so a retried create publishes a second,
  indistinguishable page. The ledger reserves the INTENT — parent ⊕ title ⊕ body — before the call, and a
  repeat is refused as a `duplicate` naming where the first one published
  (`src/outbound/notion/pageLedger.ts`). The MCP has no such primitive, and could not: it is stateless
  across calls by construction.
- **Update safety on the provider's own evidence.** An update replaces every block, so it runs only when the
  ledger says slopweaver created the page AND Notion says the integration is still its last editor. A
  byte-identical canonical read-back is treated as no edit at all — that is the mermaid display-toggle case
  — and a genuine difference needs `--overwrite-external-edit "<why>"`, journalled with who touched it and
  when.
- **Everything through one door.** Every mutation is admitted by `throughDoor` and lands in the door ledger
  with its destination and intent, which is what makes "what has this thing written to Notion" answerable at
  all. Eleven MCP write tools reachable directly from a model leave no such record.
- **The rendering claim is separated from the acceptance claim.** A write that succeeded means Notion
  ACCEPTED the markdown. `notion verify` is what reports what a reader actually sees, and every write prints
  its command. Neither half of that exists on the MCP side.

## The one place the door is knowingly blind, and it is not the MCP's fault

The byte-identical rule that makes `update` usable also makes it blind to a Notion table's **column
widths**: they are layout, absent from `pages.retrieveMarkdown` in either spelling, so a colleague who drags
a column wider becomes the page's last editor while the canonical read-back does not move. The write
proceeds, and replacing every block resets the widths.

The MCP has the same blindness and worse — it does not compare anything at all — so this is not a column in
the table above. What the door does about it is the difference: when it takes that path over a page that
actually carries a table, it SAYS so
(`canonicalCarriesTable` in `src/outbound/notion/markdownBody.ts`, reported by `notion page update`). A
stated gap is a gap someone can check; a silent one is a page nobody knows changed.

## What this file does NOT claim

- **Not a latency or throughput benchmark.** Both go through the same rate-limited Notion API on the same
  integration; the interesting number would be requests-per-act, which the table above gives directly, and a
  wall-clock comparison would mostly measure whichever one ran second against a warm cache.
- **Not a claim that the MCP server is wrong.** It is a faithful, generated transport of Notion's REST API,
  and for block-level editing it reaches things this door does not. The measurements here are about where
  policy lives, not about implementation quality.
- **Not measured: the hosted/remote MCP variant.** Only the npm-published stdio server 2.5.1 was started and
  enumerated. Notion also offers a hosted MCP endpoint with a different, higher-level tool set, and nothing
  here describes it — re-run the reproduction above against that endpoint before citing this file for it.
