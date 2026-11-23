# Writing a Linear document

`slopweaver linear document create|update --form <json|->` writes the long-form PAGE Linear hangs off a
project, an initiative, an issue or a team — a proposal, an RFC, a design note. It exists so a proposal reaches
Linear hands-free, through the door, rather than being pasted into the UI by the owner (the owner's
ask).

## The form

```json
{
  "fields": {
    "title": "One intake queue for operations",
    "destination": { "kind": "project", "id": "<project-uuid>" }
  },
  "content": [
    { "kind": "para", "text": "Every request lands in one queue, so nothing waits in a DM." },
    { "kind": "heading", "text": "Why now" },
    { "kind": "bullets", "items": [{ "text": "…" }, { "text": "…" }] }
  ]
}
```

- **`destination` is ONE tagged value**, `kind` one of `project`, `initiative`, `issue`, `team`. Linear's
  `DocumentCreateInput` takes all four ids side by side with no rule for sending two, so the form makes "exactly
  one" unrepresentable to get wrong. An issue destination also takes its identifier (`ENG-42`).
- **`title` is one line** and is the page's own heading in Linear, so the content never repeats it.
- **`content` is the issue's `freeform` block vocabulary, unchanged** — paragraphs, lists, checklists, media,
  code and `##` headings, rendered and refused exactly as [the-form.md](the-form.md) describes. Not the
  structured Problem/Solution shape: a page is not a ticket.

## Above the fold is the lead

Every block BEFORE the first heading is the page's lead, and it goes through the same voice and packing gate
a comment's `summary` does, refusing rather than trimming. Everything after the first heading is below the
fold and is held to the prose rules only. Bare `#<n>` and `ABC-<n>` are linked or refused, and `@{key}`
mentions resolve exactly as [mentions.md](mentions.md) says, `--mention-id` included.

## Create, then update

- **`create`** derives the page id from the form (fields plus rendered content), so a retry after a lost
  response reuses it. An identical form run twice prints `refused: this exact intent was already reserved…`;
  that is the at-most-once guard, not a failure. Keep the `document id:` line it prints.
- **`update --document-id <id>`** replaces the title and content from the complete form you supply. It touches
  only a page slopweaver created (the ledger under `ledgers/linear-documents/`), refuses when the page was
  edited since slopweaver last wrote it, and refuses a form naming a different destination than the one
  recorded at create — moving a page is not a re-render.

A page CAN be updated where a comment cannot: nobody was notified of its words, so re-rendering changes what
the next reader sees and rewrites nothing already in an inbox.

## When the response is lost

- **`… despite a transport error — found at the id we chose`** — a create's id was freshly reserved, so a
  page there proves it landed. Done.
- **`could NOT be read back`** — the write landed and nothing verified it. Do not re-run; open the page.
- An update whose response is lost counts as landed only when the stored title and content are exactly what
  was sent; anything else is reported **indeterminate**, because the page existed before the write.
- **`Linear acknowledged the update … has not moved`** — the mutation answered, but the page's `updatedAt` is
  still the one the precheck read, so nothing shows it applied. Read the page; re-running is safe. Exact
  bytes are not the test there, because Linear normalises markdown on ingest and reports the difference
  instead.

`--dry-run` prints the destination, the title, who an `@{key}` notifies and the exact content bytes, and
performs no effect at all.
