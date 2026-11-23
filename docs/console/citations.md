# Citations: one chip for every reference on every page

Part of [The console, the board, and the session ledger](../console.md).

Every link a card draws, and every inline reference — a pull request, a ticket, a Slack thread, a Vanta control, a Datadog
monitor, a JumpCloud route, any atlas provider's address, a board row, a queue card, a talk turn, a local page — is
ONE `CitationChip` (`site/components/console/CitationChip.tsx`, the archived console's citation chip re-made): a
pill tinted in its integration's colour with that integration's app icon, smaller and baseline-aligned inside a
sentence, that opens the record **in a new tab, never over the page citing it** — the desktop app's tab strip,
or a browser tab, because a link that opened over the page took the owner off the Queue — and on hover or focus a
card whose header strip carries the same tint, the icon and the source's name, then the place in it — never the raw
address: a link renders one way on a card, and a URL is not it. The colour and the app icon are what let the owner
tell at a glance which integration a citation is about. The KIND is the
reference's, never the prose's: a caller passes a typed `CitationReference` (`site/lib/citationDisplay.ts` — an
address, or a board row, queue card or talk turn by its id), an address's kind is its host looked up in ONE
registry (`site/lib/citationKinds.ts`, a row per atlas provider — `citationKindsMirror.test.ts` fails when an
atlas platform has none — plus this console's places), and the place is that integration's own path parser
(`site/lib/citationPlaces.ts`). **The icon is the integration's own mark, the way its favicon reads — never letters**
such as a two-letter abbreviation; the Slack logo on a thread link is the model: the archive's ported
marks, else a simple-icons brand mark (CC0, imported one by one), else a neutral link glyph in the integration's
colour (lucide's `Link2`, `CitationMark.tsx`). A mark is BUNDLED, never fetched: a favicon loaded on render is a
request to that host before the owner follows anything. A card's link label reads as a place, never a URL — `the thread in
#dev-alerts` draws "thread in dev-alerts", and a label that is only an address draws its parsed place instead
(`cardLinkLabel`, `site/lib/cardLinks.ts`). The card's header and place are read off the reference alone
(`citedSource`), and a local page's `file://` address links the console's own route to it (`consoleHref`,
`site/lib/localPageHref.ts`), which Chrome follows from an `http://` page.

**A pull request or a Linear ticket carries more on its card**: rather than a bare link, the owner sees its title,
whether its checks pass or fail, and whether it needs review. The chip fills its own detail block (`site/components/console/CitedDetail.tsx`, pure half
`site/lib/citedRecord.ts`), mounted inside the hover card so nothing is read until it opens. A pull request the
landing reading holds draws its title and the PULL-REQUESTS PAGE'S OWN state, checks, next act and open-review
chips (`site/components/live/PrStatus.tsx`, `tagOf` in `site/lib/reviewHook.ts`) off that same row — the reading
the shell already polls, handed down by `ShellLandingProvider` (`site/components/console/shellLanding.tsx`) rather
than read again — joined with the reviewer pick exactly as the page joins it (`github reviewer list`, the page's own
`reviewers` channel, read as the card opens so a pick the page records reaches the card), and aged by the reading's instant. A pull request the reading does not hold (merged, closed, somebody
else's) is read through `/api/cited` with `github pr summary`: its title and lifecycle, and a line saying checks
and review are read for the owner's open ones only. A ticket is `linear read` joined to `linear states --no-record` — its
title and its state's own name, drawn by Linear's category. A read that fails is a staleness mark whose hover says why; a caller's
own `detail` replaces all of it. **A Queue card never cites a board row** (the owner learns to ignore them, and the card already carries the band and
status the row would): a related or blocking row is its own words, a
person's hover card counts the rows naming them, and a slug in a card's sentence stays words (the Queue passes no
`boardSlugs` to `cardReferences`). **No surface links a board row**, since a row has no page of its own: a typed
board-row citation, and any `/workstreams?row=` address written into a step's `go to` or a card's words, draws as
its words, because `referenceHref` answers no address for one (`opensNowhere`). So does any console address under a
retired page, `/board` or `/machine`, whose route is gone. A `#N`, `PR N` or known team's key that resolves to
nothing is a FINDING, not silent words: the open drawer draws one amber line, `citations — links nowhere:
ABC-1 · #<number>` (`unlinkedMentions`, `data-citation-finding`). Navigation — the sidebar, a tab, an Open
button — is not a citation and stays a plain link.

## Every briefing the voice reads is a chip

One resolution serves both: a briefing the voice can see on a card and the owner cannot is a bug, even one that sits
only in its row's summary. `read_card` and `open_card` find a card's briefings in every string its row carries
(`cardBriefingAddresses`, `site/lib/openCard.ts`), and every place a row is built or rebuilt appends each one its
pages do not already name (`withBriefingPages`, `site/lib/cardBriefingPages.ts`) — to an act's links strip as well,
since an act panel draws that instead, and a thread reply's strip carries the card's pages beside its thread
(`threadLinks`). A console address on another port is routed to the console serving now and named by its slug. A page is named three ways and each is the same briefing: its `file://`
address, the console route (`/api/page/<slug>/index.html`, absolute or relative), and the ledger identity
`page:<slug>`. A relative route or an identity counts only as its own word, never inside another address
(`https://example.com/?next=page:foo` names no page).
