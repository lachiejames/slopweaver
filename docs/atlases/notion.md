# The Notion atlas is a SURFACE MAP, and the pages it wanted have no URLs

Part of [Atlases](../atlases.md).

Owner's ruling, given for Slack and extended to Notion in the same breath: where something better
suited already holds a platform's entities, the atlas holds the surface map — every reachable settings and
admin page, screenshotted. So this atlas holds **no content page at all**, and says so twice: `excludes` names
the omission, and a `held-elsewhere` coverage cell NAMES the holder (`src/corpus/notion/reach.ts`, which
enumerates every id the integration can see on every refresh). The two are different claims and both are owed
— an exclusion alone invites a reader to treat the data as unavailable.

**What a real walk found, and it is not what anyone expected.** MEASURED, and reproducible with
`slopweaver atlas notion walk`:

- **The web client has moved to `app.notion.com`.** A walk that addressed `www.notion.so` reached one page in
  thirty-one and every other failure was that redirect.
- **Notion's settings and admin surface has NO addressable URL.** `0 of 32` declared routes reached.
  `/space/<name>`, `/settings` and `/p/<workspace>/settings` each either render Notion's not-found shell or
  fall through to whatever document the client last showed. Settings is a MODAL opened from the sidebar, which
  is exactly how Notion's own help pages describe it and why they document no URL scheme.
- **A route the app does not have answers HTTP 200 with a real page title**, sometimes on Notion's PUBLIC
  marketing site. So reachability is graded on the settled ORIGIN as well as the path, and a path-only rule had
  counted the public template gallery as a reached workspace surface.

So the thirty-two routes publish **zero pages**, each carrying its own gap naming what stopped it, and those
gaps stay open as the measured evidence that the settings surface has no address. **What fills `browser-walk`
is the settings TABS**: the same `walk` then opens the modal through `browser/notionSettings.ts` — two
disclosure clicks, then only a `role="tab"` the settings click itself created — and photographs every tab
`settingsTabs.ts` declares, one `page` entity per tab under a `settings/<id>` provider id. The surface carries
two coverage cells told apart by scope: `declared-settings-tabs` (`synced` only when every declared tab was
shown AND photographed) and `declared-pages` (the routes). A tab gets its own gap judgement, because a tab
that did not render is a different fact from a route that 404s: `settings-tab-not-rendered`,
`settings-tab-not-attempted` (the session died first), `settings-tab-screenshot-missing`, and the standing
`settings-tab-undeclared-per-install` for the Account tab labelled with the signed-in person's own name.
The two publishers share the `page` kind and partition it by provider id, so neither stales the other's half.

**Three honesty mechanisms here that the sibling walks do not have**, all of which this atlas needed:

- **A missing screenshot is a coverage FAILURE, not a silence.** Both `atlas/vanta/browserWalk.ts` and
  `atlas/crowdstrike/consoleWalk.ts` drop an unwritten PNG with no artifact reference, no failure, and a
  coverage cell still stamped a success — so a run that photographed nothing reads identically to one that
  photographed everything. Here a reached-but-unphotographed page raises its own gap and stops the cell being
  `synced`.
- **Two declared pages that photograph the same bytes evidence nothing.** Artifacts are content-addressed, so
  identical pictures share one file — correct storage, and a silent disaster for a coverage claim. The first
  run of this walk reported twenty-one pages reached and photographed, and all twenty-one screenshots were one
  file, because every one was the not-found shell. `markIndistinguishablePages` catches that whole class, not
  just the vendor-specific case a not-found constant covers.
- **The two publishers hold a lock across read-and-publish.** Both write `method` AND `page`, because the
  corroboration between the channels is the output — where Vanta gives its walk its own kinds and its writers
  never touch one file. That design makes a lost update reachable: a sync that reads a generation, pauses
  while a walk publishes, then resumes, replaces everything the walk wrote and returns success. It takes
  `admit/operationLock.ts`, the same primitive `github stack push` uses.
