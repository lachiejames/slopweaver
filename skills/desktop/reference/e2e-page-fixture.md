# The `pages` step's fixture page

The `pages` step of `slopweaver desktop e2e` ([e2e](e2e.md)) opens the walk's OWN page, never one of the owner's:
such a page can run script or name a remote image, and an error in the viewer's frame reaches the walk's watcher, so
the step would be testing the owner's content.

## Publishing it

Before the walk it publishes one inert page (`src/desktop/e2eFixture.ts`: no script, image, stylesheet, form or
address) as `desktop-e2e-<uuid>` through the REAL publisher (`src/desktop/e2ePageFixtureStore.ts`), under the AMBIENT
home because the console already running serves that one, never `--home`: into the store and its Storage, which is
all a publish writes, so the step passes only when the console served the page out of the store. A publish that
fails, or lands other bytes or another path, is `PAGE_FIXTURE_PUBLISH_FAILED` and nothing launches.

It opens `/view?src=/api/page/<slug>/index.html&back=/queue` by address and passes when the fixture's marked heading
is drawn in the frame at exactly that path, and the viewer's own bar draws **Back to the Queue** and **Reveal in
Finder** (which only the desktop shell draws). Neither is pressed. While the walk runs, `page find` lists it.

## Taking it back out

When the walk ends, whatever happened, the fixture's store rows go. `PAGE_FIXTURE_STORE_CLEANUP_FAILED` names
what was left.

The rows go under the publisher's own lock, with the page row locked against an import, and only when every column
of every row under the slug is what the walk's own publish wrote. That means its home's address, its body, its freeze
instant and a `published` version, with no alias (`src/store/publishedPages/removeFixtureVerdict.ts`). Anything else
leaves the slug whole and rolls every delete back. The content-addressed blob stays, like any other. The one state it
cannot tell apart is the same bytes published to the walk's own nonce slug from the same home in the same millisecond,
whose rows are identical.

## In CI

The console's browser lane (`yarn test:e2e`) publishes the same page per worker the same way. CI has a plain Postgres
and no Supabase stack, so global setup starts a loopback Storage stand-in
(`src/__tests__/e2e/fixtures/fakeObjectStorage.ts`) with a key generated for the run. It names that stand-in to the
store's object client through `SLOPWEAVER_E2E_OBJECTS_API_URL` and `SLOPWEAVER_E2E_OBJECTS_SERVICE_KEY`
(`src/store/objects/e2eSelection.ts`): both or neither, a loopback `http` origin and a key of at least 32 URL-safe
characters, else refused, never a fall back to the local stack. `objectStorage.spec.ts` proves the real client
against that stand-in; a worker's teardown removes its page and refuses unless no row of it is left.
