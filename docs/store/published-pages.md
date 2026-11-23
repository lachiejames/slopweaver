# Published pages: the store is their only copy

The owner's ruling: a page lives in the store's Storage and
nowhere else. There is no persistent copy of it on the file system and no mechanism mirroring Storage back to one.
Reveal in Finder copies one page out once, on demand, to drag into Slack.

The move lands in this order, so that nothing is deleted until every reader is proven against the store. Today the
tables, batch signing, both folders on the backup and `store pages-import` exist, a publish and a freeze write only
the store, and every verb, the console, the voice and Reveal read a page from the store. The folders a home already
has stay until stage 7.

1. The tables, batch signing, both folders on the backup.
2. `store pages-import` carries every page and version in, byte-verified. It resolves a frozen version by its key and
   hash, never by the absolute `path` in `latest.json`, so a folder restored into another home imports the same.
3. A publish writes to the store as well as the folder, and a store failure fails it.
4. The verbs read a page from the store.
5. The console, the voice and Reveal read a page from the store.
6. A publish writes only to the store, and `--assets-from` names where images are read.
7. Backup, a restore rehearsal, the folders set aside, re-checked, then deleted.

## The shape

Every body is one object in the private `published-pages` bucket, at its own sha-256. The first write creates the
bucket private (`ensureBucket`, `src/store/objects/client.ts`), so its name enters code with the first writer, stage 2.
Five tables hold everything else (`src/store/schema/publishedPages.ts`):

| Table                    | One row is                                                                   |
| ------------------------ | ---------------------------------------------------------------------------- |
| `published_page_blob`    | a distinct body: its hash, size and media type                               |
| `published_page`         | a page: identity, what a reader opens, what a correction diffs against       |
| `published_page_file`    | a file the page currently serves, by its relative path                       |
| `published_page_version` | a frozen version                                                             |
| `published_page_alias`   | another spelling of a page's address, so a record holding it keeps resolving |

**The address stays.** `file:///…/pages/<slug>/index.html` is what records name a page by, and it keeps working as an
identity after the file behind it is gone. Nothing rewrites a stored address.

**A key is a slug, or a freeze key with no page.** A `history-only` row is a freeze-store directory holding versions
with no current page.

**Nothing but the owner and the agent reads these tables.** The bot's policy is `false` on all five, as on every
fleet table.

## The import

`store pages-import` (`src/store/publishedPages/`) reads `pages/` and `published-pages/` whole and changes neither.

- **A refusal anywhere writes nothing**, and every one is named in one run: a symbolic link, anything but a folder or
  a regular file, a name outside `[A-Za-z0-9][A-Za-z0-9._-]*`, a file that changed while read, a page with no
  `index.html`, a freeze with no `latest.json` or a version whose bytes are not its name. Only Finder's `.DS_Store`
  is passed over, and counted.
- **A body's type is its extension's**, the same map the console serves by (`site/__tests__/unit/localPageHref.test.ts`
  binds the two). An extension no reader serves is stored as `application/octet-stream`, never refused.
- **A page is published when its matching freeze was**, else when `index.html` was last modified. An imported
  version is dated by the import.
- **Objects, then rows.** Every held body is checked against the planned bytes first, a disagreement refusing. New bodies
  are uploaded to their sha-256 key, then one transaction writes the rows. A crash between leaves an object no row
  names, which the next run uploads again.
- **Re-runnable.** A page's file rows are made to match its folder, a version is only ever added, and a run over
  unchanged folders writes nothing. A stored page whose page folder is gone is left alone and reported, even when
  its freeze folder remains, because a history never rewrites a page.

## A publish

`publishPage` (`src/pages/publish.ts`) builds the document, reads every file it loads, and hands both to an injected
store writer; every verb that publishes injects `productionPublishPage` (`src/pages/productionPublish.ts`). It writes
nothing under `pages/` or `published-pages/`. The page's address names it; no file is there.

- **Images are read from `--assets-from`.** `page publish --assets-from <dir>` names the directory a relative image
  is read from, the same path under it (`src/pages/pageAssets.ts`). The files are what the document loads, then what
  each stylesheet among them loads, each read once through a descriptor that refuses a link, proved unchanged
  across the read and still the file at its path under the directory afterwards. Anything else in the directory is not the page's. A page that loads a file with no `--assets-from`,
  or one that is not there, is refused before the store is opened, with no hatch: the store would serve it broken.
  `proposal publish` passes its own media list instead of a directory, and every file on it is stored, a linked
  attachment no load names included.
- **One plan, the import's write.** `pageWrite` (`src/store/publishedPages/writePlan.ts`) turns the bytes into the
  same plan a folder import projects, and `storePublishedPage` (`src/store/publishedPages/write.ts`) writes it through
  the import's own write: held bodies checked, objects uploaded by digest, every row in one transaction.
- **A publish states the whole page.** Its files are `index.html` and what it loads, nothing else, so a file the last
  publish stored and this one no longer loads loses its row. Its body and object stay, as every body does.
- **The version is the publish's own.** It is written `published`, dated by its freeze. A version already held is
  never rewritten, so an imported one keeps its origin and only the page's latest freeze moves.
- **The store never moves backwards.** The write transaction takes a per-page advisory lock and refuses
  (`PAGES_PUBLISH_SUPERSEDED`) when the store already holds a later freeze of the page, or other bytes frozen at the
  same instant (two publishes given one `--now`): an earlier publish whose write lands after a later one's fails
  rather than regressing it. Its re-run completes only at the current time, never with a `--now` at or before the
  held freeze. A batch import takes no such lock, so run it when nothing is publishing.
- **A store failure fails the publish, and a re-run completes it.** The error prints no address, and nothing records
  the page: no review record, run artifact, `page-published` stage or stamp. The failure means UNCONFIRMED, not
  absent: a connection that fails to close after the transaction committed is an error too, so the store may already
  hold the version, and publishing the same fragment again converges on it. One failure a re-run does NOT clear: a
  body is keyed by its bytes alone, so bytes the store holds under one media type, published under another extension
  on another page, are refused (`PAGES_HELD_BLOB_CONFLICT`) every time. Renaming the file clears it; a per-file type
  is a schema change.
- **`briefing freeze` is the other writer.** It freezes bytes that may be no page's `index.html`, often under a key
  with no page, so `freezeWrite` plans one version and a history-only row carrying the key's new latest pointer. On a
  local page that moves the page's latest freeze, never its document or files. A key the store holds no version of
  is refused (`PAGES_FREEZE_OPENS_HISTORY`) inside the transaction, naming the held keys within two characters of it,
  unless `--new` says a history is being opened. A store failure fails the freeze, and re-running it completes it.

## Reading

`withPublishedPagesReader` (`src/store/publishedPages/read.ts`) opens this home's store once and answers three reads:
a key's latest frozen version with its bytes, every current page with its title and size, and whether a page serves
a named file. `page find` lists through it; `page tag`, `incident note`, `incident postmortem` and the
`meeting-prep-due` monitor ask it whether a page is published, `browser present` and `talk meeting-due` ask about
every page they name at once, and `proposal drift` reads a local page's clock from it (`src/pages/published.ts`). `briefing corrections` diffs against a page's latest freeze from it, and `briefing
render` and `briefing card` read every page a card names from it (`src/cli/commands/briefing/publishedPageReader.ts`).

- **A page's bytes are fetched before the projection, never inside it.** The card projections are synchronous, so
  the verb gathers every page they will read and fetches each key once over one connection, then hands them a map.
  A page the projection asks for that was not gathered is `PUBLISHED_PAGE_NOT_PREFETCHED`, refused, so a page the
  collector missed is never read as one with no freeze.
- **A synchronous resolve learns its slugs by running.** `browser present` resolves once answering every page
  published, asks the store about exactly the slugs it named, then resolves over that answer
  (`src/browser/presentPublished.ts`). A request naming no page never opens the store, a slug the second resolve
  names that the first did not is refused, and a store that cannot say fails the verb rather than refusing a page.
  `talk meeting-due` asks about the pages tagged to a meeting starting now, and a store that cannot say costs the
  briefing link, never the join link.
- **Only a page the store holds no freeze of keeps the old rule.** Before the card-marks cutoff its question and lean
  stand typed, as a page with no folder did. Any other failure to read one stops the verb, naming the page
  (`PUBLISHED_PAGE_UNREADABLE`), and never types a page that could not be read.

- **Bytes by authenticated download.** A verb holds the Storage credential, so a body comes through the bucket's
  `get`, verified against its digest. A signed address is the viewer's (below), never a verb's.
- **No partial answer and no fallback.** One failed query or download fails the read, and a store that cannot be
  read is an error, never a cue to look in the folders. A file the store does not hold is `false`; a failed query is
  never `false`.
- **A title is parsed from the document's first 8 KiB**, the bound the folder read used, so there is no title
  column. Measured on the owner's store: 129 pages listed with their titles in 1.2 to 2.1 s, sequentially
  (a scratch `tsx` script calling `withPublishedPagesReader({ home, read: (reader) => reader.listCurrent() })`).
- **A page published by code without stage 3 is not in the store.** That run found two such pages. Before a reader
  switches, run `store pages-import` from a checkout that has stage 3, so the store holds every page.

## Serving, and what signing is for

A viewer never holds a signed address for the document or an image. One child process per page open answers a signed
manifest, the console route caches it by slug and proxies each asset's bytes itself, so relative paths, `srcset` and
CSS `url()` keep working and the sandbox, CSP and `nosniff` headers still apply. A signed address is a short-lived
capability, so a batch with one unsigned key fails whole (`signedAddressesByKey`): a page with an image silently
missing is the partial answer a reader cannot see.

The console asks through `slopweaver page read <slug> --presentation --json` (`src/cli/commands/page/readRun.ts`),
because it cannot import `src/`. It prints the page's files, each signed, or `not-found`, or `store-unreadable`, so
`/api/page/<slug>/<file…>` (`site/lib/localPageServe.ts`) answers 404 only for a page or file the store does not
hold, and 503 when the store could not say. A file is served only when its bytes hash to its row's digest.

- **A page open asks the store afresh**, so a republished page is what is shown. Each file the page then loads
  reuses that answer until a minute before its addresses expire (`site/lib/pageStoreSource.ts`), so a page with
  forty images costs one child and one signing request. A file served off a KEPT answer whose address no longer
  answers, or answers other bytes, is asked for once more, fresh, before it is refused; the document and the title
  already read fresh, so theirs is refused at once.
- **The `/view` title reads the same answer** (`site/lib/publishedPageTitle.ts`), so opening a page is one ask.
- **A republish under an open viewer is offered, never forced.** The viewer keeps the version it loaded — one digest
  over every file's path and digest (`site/lib/pageVersion.ts`), so a changed image counts, read in the same ask as
  the title. Its frame names that version (`index.html?v=<digest>`) and is served off the kept answer while it is
  still that version, so a republish landing before the frame's request is offered, never framed unseen. The
  document served then reports the version it was served at by `postMessage` (`site/lib/pageVersionReport.ts`), and
  the viewer compares against that, taken only from its own frame's window, so a frame served fresh past the kept
  window never draws a button for the page already on screen. A visible
  tab asks `/api/page-version/<slug>` every 30 seconds, held during a voice call and asked
  once at hang-up. A different version draws **Load newer version** beside Reveal in Finder
  (`site/components/console/NewerVersion.tsx`); only the press reloads. A store that cannot say offers nothing.

## The voice

The voice names a page by its address, so `talk file read` reads `<home>/pages/<slug>/index.html` out of the store
(`src/talk/heldPage.ts`), and the briefing it opens a card on and every `file_read` after it come from there. The
address is matched as spelled, `~` expanded and the path normalised, with no symbolic link followed, and the bytes
are sniffed, windowed, outlined and masked exactly as the same file read off disk, and an address inside a
credential store is refused as that file is. A slug the store holds no page under is
`PAGE_NOT_IN_STORE`, and a store that cannot say is `PAGE_STORE_UNREADABLE`; neither reads the folder.

- **Only the document.** Any other file under a page is still read off disk: a page published since stage 6 has none
  there, and one published before stops being readable when stage 7 deletes the folders.
- **The briefing route asks for the address itself** (`site/app/api/talk/briefing/[slug]/route.ts`), and refuses a
  read naming any other path.

## Reveal in Finder

`slopweaver page export <slug> --out <file>` (`src/cli/commands/page/exportRun.ts`) is the one copy out. It reads
every file the page serves from one snapshot, each body verified against its digest, and creates one owner-only file
carrying every image the page loads as a `data:` URL (`src/pages/selfContained.ts`). It never replaces a file, and a
page file it cannot carry is reported, never dropped. The desktop's Reveal runs it into a private temporary
directory, keeps one copy at a time and removes it on quit
([reveal in Finder](../../desktop/docs/reveal-in-finder.md)).

## The proof

`src/__tests__/integration/publishedPageObjects.test.ts` runs against the real stack in a throwaway database and a
throwaway bucket. It is opt-in and never runs in CI; its header carries the commands, and it prints the signing time.
`src/__tests__/integration/publishedPagesImport.test.ts` is the import's, the same way: a re-run, a republish, a
publish's own version kept, a history becoming a page, a store-only page, a held conflict and a failed upload.
`src/__tests__/integration/publishedPagesPublish.test.ts` is a publish's and a freeze's: each version `published` at
its freeze, an identical re-publish adding nothing, no folder written, a dropped image losing its row, an imported
version kept, a superseded publish refused, a store that refuses the connection failing the publish until a re-run
completes it, a freeze moving a local page's pointer and not its document, and `--new` refused and then opening a
history.
`src/__tests__/integration/publishedPagesRead.test.ts` is the reader's: the latest frozen bytes, digest, instant and
count, the page list, file presence, the current document, every file a page serves with its bytes, a history with no
page, two `briefing freeze` writes of one, a lost body and a stopped database.

The console's browser lane runs in CI with no Supabase stack, so it publishes its fixture page through the real
publisher into a loopback Storage stand-in, which is all a publish writes, and removes its rows afterwards; [the fixture page's reference](../../skills/desktop/reference/e2e-page-fixture.md)
carries the override pair that selects the stand-in and the narrow remover.
`src/__tests__/e2e/objectStorage.spec.ts` holds the stand-in to the real object client, and the opt-in
`src/__tests__/integration/publishedPageFixtureRemove.test.ts` proves the remover against the real stack: exactly the
fixture's rows go, its body stays, and a slug holding a second version is left whole.

Measured importing the owner's home into a throwaway database
(`SLOPWEAVER_STORE_URL=<throwaway> slopweaver store pages-import`): 134 pages, 723 versions, 877 bodies and 124 MiB
in 24 s, and the re-run wrote nothing in 4 s.

Measured by that test: 300 keys signed in one request in 38 ms, every address giving back its own bytes
with 20 fetches at a time. All 300 fetched at once had the local gateway close sockets, so the console's proxy bounds
its own fetches.
