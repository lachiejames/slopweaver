# Publishing

Part of [The golden proposal, as a form](../proposals.md).

`proposal publish` lints the bytes and hands them to the install's destination, through that destination's
own door: a Notion page through `slopweaver notion page`, a local page through the `page publish` core, a
Linear document through `slopweaver linear document`.
Each provider has one write path in this program and a proposal is one caller of it, so the ownership
ledger, the authorship check and the door record are the ones that door already carries rather than a
parallel set that could drift. Which door a publish uses is decided in one place, `ProposalPublishDeps.publish`
(`src/cli/commands/proposal/publishRunShared.ts`), keyed on the target.

## Where a proposal goes is the install's choice

One team keeps proposals in Notion, another in a Linear document, another on a page nobody else reads. So
the destination is not in the code and not a flag repeated on every run: it is set once per install and held
in the store, at `$SLOPWEAVER_HOME/proposals/config/destination.json`.

```bash
slopweaver proposal destination set notion-page --parent <page-id-or-url>
slopweaver proposal destination set local-page
slopweaver proposal destination set linear-document --target-kind <project|initiative|issue|team> --target-id <id>
slopweaver proposal destination show
```

The file is one strict tagged value (`src/outbound/proposal/destination.ts`): an unknown key, an unknown
kind or a later schema version is refused rather than read as something else, and a `notion-page` parent is
judged by the Notion door's own address parser, so `set` cannot store a parent a first publish would then
fail on. With nothing set, `publish`
refuses and names the command above; there is no default destination this repository could assume on an
install's behalf. The proposal FORM never changes with the destination: a new destination is a new arm on
that value and an adapter beside the publish verb, through a door that already exists.

`publish --parent` is retired and refused with a pointer to `destination set`: a parent on the command line
would be a second authority beside the stored one, and two authorities is how a proposal lands somewhere
nobody chose.

## What a local-page destination does

A `local-page` destination writes each proposal into the store as the page `$SLOPWEAVER_HOME/pages/<slug>/`, frozen and
addressed exactly as `slopweaver page publish` does every other local page
(`src/cli/commands/proposal/publishLocal.ts`). Three things differ from a Notion page, each because a local
page has no provider to supply it:

- **`--title` is required.** The rendered proposal carries no title line, because Notion takes the title as a
  page property; a local page has no property, so `publish` refuses without one rather than invent "untitled".
- **The slug is chosen here.** A re-publish writes the slug the intake recorded; a first publish with an intake
  writes `proposal-<intake id>`; one with no intake derives a slug from the title and a digest of the bytes, so
  an edited no-intake publish lands as a new page, exactly as a no-intake Notion publish does.
- **Raw HTML is escaped, not passed through** (`src/outbound/proposal/localPage.ts`). The renderer's own
  toggle and table-of-contents constructs are translated; anything else that looks like a tag is shown as
  text. A `file:` placeholder is stored with the page under `media/` and linked relatively, because the page
  is served from its own address and nothing else.

## What a linear-document destination does

A `linear-document` destination writes each proposal as a Linear document under the one project, initiative,
issue or team the install named, by running the `linear document` command with a typed form
(`src/cli/commands/proposal/publishLinear.ts`). The door's ledger, edit check and read-back are the ones every
other Linear document gets. What differs from a Notion page:

- **`--title` is required**, for the local-page reason: the form's title is the only place it can go. An
  `--icon` is carried at the front of that title, since a Linear document form has no icon of its own.
- **The markdown is read into the door's blocks, not passed as one string**
  (`src/outbound/proposal/linearDocument.ts`), by the same reader `proposal lint` uses. A heading stays a
  heading, a fence becomes a code block, a toggle's summary becomes a bold label over its body (never a
  heading the draft did not write), and the table-of-contents marker drops. So the door's structural checks run
  over the proposal like any other document.
- **A `file:` image is refused**, on its own line or inline in prose. Linear cannot fetch a file on this
  machine and this destination adds no upload. Host it at an https URL, which is kept exactly as written.
- **A re-publish updates the recorded document in place.** The door refuses when somebody edited it in Linear
  since slopweaver wrote it, or when the install's target has moved, because an update never moves a document.
  An identical first publish twice is refused as the duplicate it is.

## What a Notion destination is bound by

Two constraints are worth stating because they are measured rather than chosen.

**A page inherits its parent's permissions.** Notion refuses workspace-parented page creation from an
internal integration:

> Provide a `parent.page_id` or `parent.database_id` parameter to create a page … Internal integrations
> aren't owned by a single user, so creating workspace-level private pages is not supported.

So a `notion-page` destination always names a parent, and privacy is a property of where you publish rather
than of a flag this verb could honour.

**A re-publish replaces the content in place.** Notion's `replace_content` keeps the page id and URL, which
is what makes every existing link still resolve. It also means an update destroys whatever is there, so
`notion page update` refuses unless the local ledger says slopweaver created the page AND the provider says
the integration is still its last editor.

## The hero shot, when it has no URL

The gate wants a cropped proof shot in the top third of any document carrying figures, and the commonest
such shot is a screenshot on the author's own disk with no public URL and no prospect of one. So the hero
field takes two spellings:

```jsonc
"hero": { "url": "https://example.test/shots/hero.png", ... }   // already hosted
"hero": { "url": "file:./shots/hero.png",               ... }   // uploaded at publish
```

`file:` is the same upload opt-in `notion page` uses, and it is documented in full in
[`notion-attachments.md`](../notion-attachments.md): the path is relative to the markdown file being published, the
image is uploaded to Notion's own storage and inserted AT the position it was written rather than appended,
and Notion's single-part ceiling of **20 MB** applies. `slopweaver proposal publish` runs that pass itself.

Two refusals here that look pedantic and are not:

- **A bare local path is rejected**, not accepted-and-uploaded. Notion accepts `![cap](./hero.png)` and
  silently builds a broken external-image block from it, so a local path cannot be told from a mistake by
  the provider. `file:` is the spelling that says _upload this_.
- **A `file:` path takes no whitespace and no `)`**, because the placeholder is found by a line-anchored
  pattern. A path carrying either would never be rewritten into a marker and would reach Notion as a bare
  local path, which is the broken-image case above wearing a publish that reported success.

The CITATION fields are unaffected and stay http(s) throughout: a source a reader cannot open is not a
citation. Only the hero is an image.

## The Slack teaser

The pattern is the proposal link leading a short version of it, and the discussion in the thread. The doc is
the deeper layer; the Slack post is what people read.

It is a SINGLE top-level message, never a sequence, because several top-level messages
leave a reader unsure which one to reply to, and the discussion fragments across them. `proposal teaser`
renders exactly the form `slopweaver slack post --as me` accepts, and prints it. Posting under the owner's
own name is the owner's act, not a verb's — this only removes the excuse that composing the form was fiddly. The
teaser text is a field on the same form the draft came from, capped in the schema, because it is authored
rather than extracted: the short version is a separate act of writing, not a summary.
