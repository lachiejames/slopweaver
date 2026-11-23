# `content/console/pull-requests.mdx` — the trust class, and the readings ledger under it

Part of [The console, the board, and the session ledger](../console.md).

The failure this page is built against is the owner's own: a board said a pull request was
green, the owner clicked through, and it had conflicts or a review nobody had handled. Three defects hide in that
sentence, and the page closes two — **a second computation** (the tag on every row is `github landing`'s
own `action` or dispatch `verdict`, the fold is its six tests with their reasons, and a state on the one
selector (`site/lib/prViews.ts`) is a choice about what to SHOW, never a decision that a row is green) and **an unknown instant** (every reading carries
when it was true, and a frozen one says FIXTURE in the same weight). The third, **a poll nobody watched**,
is closed on its read half by the **readings ledger** (`src/readings/`, the `reading` noun): the page never
runs `github landing`, it reads `reading last --producer "github landing" --json` — the last document the
verb printed, appended by whoever ran it (`github landing --record-reading <by>`, which sweep step 7 passes
as `tick-<n>`, and which the verb refuses without `--author @me`, as `reading record` refuses such a document; the
Queue also draws no card off a document whose
own `selection` names another author or none, `site/lib/landingIsOwners.ts`;
`supervisor tick-capture` records every JSON gauge it takes the same way) — and prints who
took it and how long ago in the fold at the page's foot, with the line beside the selector (`site/lib/prFreshness.ts`)
aging the reading rather than the fetch. **The console's own refresh takes a reading**, through one runner the shell
owns (`site/components/console/useLandingAutoRefresh.ts`) — there is no button, because the page simply needs to always be up to date: it POSTs `app/api/sync/[verb]`, whose closed list (`site/lib/syncVerbs.ts`)
resolves `landing` to `github landing --author @me --json --include-drafts --record-reading sync-now` — the organisation's repositories and this build's, read off the store's organisation record, `@me` being GitHub's own spelling of the token's user, and never `--press`,
never `--register`, nothing that acts outward, which is what keeps the console read-only — and the
page then re-reads the ledger, so what it shows is the row that run appended and never a second copy. POST
rather than GET so a prefetch or a crawler cannot take one, and behind `site/lib/consolePress.ts` like every
console write route, so another origin's `no-cors` POST cannot either; the line says "failed to sync" with the
verb's own reason on hover when a run was not taken. Both routes spawn through `site/lib/spawnVerb.ts`: one argv array, one timeout kill, one
stderr tail. **The watched cell** on every row is the other half of the same defect — is anybody watching —
and it is a second fast-lane row, `github watchers --json`: `github checks --wait` and `--until` write a
`watching` row to the checks-read register on their first read and a `watch-done` when the loop returns,
and the verb folds them (`src/outbound/github/watchers.ts`), judging STALE itself from the run's own
`--timeout-seconds`, so the page never computes an age. The refresh calls `refreshLive` for the fold and the
reading alike, so both re-read, and a fold that could not be read draws a staleness mark in every cell, whose
hover says why, rather than "not watched".
The reader of the two row kinds landed one pull request BEFORE the writer, because the register is one file
every session's build parses and fails closed on.

**Who each row is on the hook with** (who was asked, where, when, how long ago, whether to ask again) is a third fast-lane row, `github reviewer list --json`. It joins the last landing reading with the
reviewer register, which `github landing --record-reading` appends every ask to. `site/lib/reviewHook.ts` words
the ask line from the reading alone, and the Waiting on review state reads the same `humanWait.next`, so a
card's state and its line cannot disagree. The suggested reviewer's Approve is an act row,
`reviewer-approve`, that records a pick and sends nothing; a "not them" carries the owner's reason, so the owner says it in the
call's chat with the card open — the console takes no typed words (the owner's ruling) — and the session records it
with `github reviewer pick --verdict decline`. When the two verbs name
different readings, the fold at the foot says so. Tiers, exclusions and the register:
[reviewers](../../skills/github/reference/reviewers.md).

Two mechanisms it added to the kit:

- **A fixture mode, labelled as such.** `site/lib/liveFixtures.ts` is a closed map — the same construction
  as the verb allowlist — from a `?fixture=<name>` to a basename that file chose, so nothing off the URL
  becomes a path. The route serves the capture with its own instant, and the tile's stamp prints FIXTURE
  and the capture's age where a live age would go. A fixture is re-taken with the command on its row,
  never hand-edited.
- **The console is GLASS, in a colour and a mode, and every surface in it is OPAQUE.** The glass is tinted in
  our colours, the colours chosen like Chrome's profile colours, every one readable in light and dark. Every
  surface is solid — the owner wants a hundred percent opacity as the default for everything, the voice messenger
  over the Queue included — so the glass is its edges
  (a bright top edge, a darker bottom one, a soft drop shadow) over an opaque palette fill, never a see-through
  fill and never a backdrop filter. Two independent choices, none read from or written to the system
  appearance: a colour family (`sw-theme-family`, nine of them) and a mode (`sw-theme-mode`, light or dark).
  The 18 palettes live once, in `THEME_PALETTES` (`site/lib/themePalettes.ts`), rendered into the head as
  `:root[data-sw-family][data-sw-mode]` blocks redefining the `--c-*` tokens, with the per-mode verdict
  colours (`VERDICT_INKS`, `--a-*`) beside them and each theme's two orb colours (`--sw-orb-ramp-dark`/`-light`,
  `site/lib/orbRamp.ts`) after those, so the orb follows the theme worn and the presence never sets a colour; a unit test holds body, secondary, link and verdict text at
  4.5:1 or better on every plane and every nested control, as both an sRGB and a P3 screen draw it, and reads
  each glass class's fill out of the stylesheet so a fill mixed toward `transparent` fails it. It also holds a
  verdict word on its own tint up to `bg-<verdict>/15` and body text on an accent tint up to `bg-primary/25`, the
  strongest the components may use (an accent word never sits on an accent tint); shadcn's `destructive` is the
  danger verdict colour, filled under the ground's colour. No word sits on the bare wallpaper: `<main>` wears
  `.sw-glass-page`, the opaque ground fill. Text takes a token. What is left is two registries the
  same test scans the components against: literal text colours, measured on their grounds, and fixed or
  data-driven ones (`text-white`, an inline `color:`, an SVG `<text>`'s `fill`, `text-transparent` over a clipped
  background — the "Thinking…" shimmer, ink swept over muted), each naming a measurement that
  runs — an avatar at every hue, an integration chip on its tint for every integration, every token of the code highlighter's GitHub high-contrast pair on
  its own ground — one pair, `site/lib/codeThemes.ts`, which `code-block.tsx` and every `<Streamdown>`'s code plugin
  (`streamdownPlugins`) both draw with, and Streamdown's own `shikiTheme` too, set after a caller's props with any
  `code`/`pre` override stripped so no caller draws another; each renderer's `<code>` clears the global `code` tint
  so that ground is the one drawn, and Streamdown's faded line numbers are restored to full muted ink in
  `console-tw.css` — or a decorative icon. Nothing fades or filters text: no component or stylesheet rule wears a mask, and none a colour filter
  (a hover moves a border or an underline, never `brightness`), no stylesheet rule sets a partial `opacity` outside an
  animation, and an animation that fades runs only on the orb, its badge icon or the window's edge; every partial
  opacity in a component is a registered mark, icon or orb, except a disabled control's `disabled:opacity-50`, which is how it reads as inactive and which WCAG 1.4.3
  exempts, and a placeholder draws in full muted ink rather than preflight's half-ink. A menu's or dialog's entrance
  and exit fade (`animate-in fade-in-0`) is the one moment text sits below its measured ground, for the length of
  the animation; the settled state is what is measured. The voice stage's gradient runs from a hint of the mood's
  colour, through the ground, to an edge pushed away from the ink (toward white in light, black in dark), and every
  ink it draws is measured on every point of it; its two text frames are opaque card and panel fills. The boot
  script sets the family and mode before the first paint and the picker reads storage through the same `resolveStoredTheme`, carrying the old
  `sw-theme` choice across; `AppearanceSync`, mounted in the console and in the desktop voice overlay, re-applies a
  change made in another window or tab live, one storage refused included: that arrives on the `sw-preference`
  `BroadcastChannel` (`site/lib/preferenceChannel.ts`), which a window opening asks for what is held, each write
  stamped so every window keeps the newest whatever order they arrive in, and reads it ahead of storage, which two
  simultaneous writes can leave holding the older one — and each window that hears a write of a key puts the newest
  back into storage, so a window opened later reads it too; a choice storage refused stays in memory until the next
  write of that key is heard, however soon storage frees up. The stamps are not stored, so both writers closing before either
  hears the other is not repaired: if storage also committed the earlier of two of the owner's choices after the later, the
  next window opens on the earlier. Every write is the owner's input or the boot script's carry of the old `sw-theme` key,
  the same value in every window, written only when that window read no choice; it is unstamped, so a window
  booting in the instant the owner chooses elsewhere can overwrite that choice, which comes back only if a window that
  heard it is still open once the booting window joins the channel — and only while the old key survives, which
  the first window to boot removes.
  Every change after the boot script goes
  through `switchTheme`, which holds transitions off for the instant the palette moves, so no text animates from
  the old ink over the new ground. A code block that has not highlighted yet draws in `--c-ink` on `--c-bg`. A
  floating surface (sidebar, menu, dialog, slide-over, sticky footer, the voice's messenger) wears `.sw-glass`, an
  in-flow one `.sw-glass-plane` and a nested field `.sw-glass-control`, all opaque; nothing wears a backdrop filter,
  which would also trap fixed children. `?sw-surface=native` is the desktop shell's: the page paints its palette's
  flat ground and no wallpaper, in an opaque window. The window remembers it across reloads; any other
  `sw-surface` value clears it. The voice overlay is the one transparent page, so the owner's desktop shows around the orb
  and its panels, and never through them.
- **The sidebar collapses to an icon rail, and the console has a CONTEXT.** The owner's shape: a normal SaaS
  sidebar width that collapses to icons with the minimize control at its top
  (Datadog's shape), and an account-style switcher at the top (Cloudflare's) so the owner can flip between
  Slopweaver and work and always tell which the owner is looking at — nine to five the owner should be on work things.
  Both are browser preferences (`site/components/console/preference.ts`, `useSyncExternalStore` over
  `localStorage`, never a `setState` in an effect). A context is a FILTER, never a second reading:
  `site/lib/workspacePlacement.ts` places a row off its structured fields, never its words — a stated
  workspace (a `workspace:` line, or a board row's declared `context=` tag), a repository (this build's own repository is Slopweaver, any other `acme/<repo>` Acme), a
  Slack, Linear or Vanta address — and a row whose fields name neither or both is a FINDING, drawn in the
  Slopweaver context alone by the one default rule, under a mark that says so, and counted
  ([one-board](../../skills/handover/reference/one-board.md)). Every page says how many rows the context hid,
  the page head carries the context's name, and the sidebar badges count in the same context. Work is the
  first-visit default, by the owner's nine-to-five sentence. **Both choices are ADDRESSABLE** — `?context=` and
  `?rail=` (`CONTEXT_PARAM`/`SIDEBAR_PARAM`, resolved by `chooseView`) win over storage for that view;
  reading one never writes storage, while a CHOICE — the switcher — writes storage and replaces the address
  (`withParamReplaced`), so a link's `?context=` can never pin a page the switcher is trying to move. Opening
  or closing a queue panel keeps both (`panelHref`). **The context is ALWAYS in the address**, as a URL
  parameter, so the owner can bookmark either one: a page arriving without one
  has the shown context written in (`canonicalSearch`, run by `useContextAddress` in the shell), the switcher
  writes it even into an address that never named it (`withParamSet`), and every sidebar link carries it
  (`navHref`), so a bookmark of either Queue pins its context and an addressed view survives crossing pages.
  The rail stays addressed only on demand. That is not a convenience: kept only in `localStorage`, the Slopweaver
  context and the collapsed rail were two surfaces no URL reached, so a pass over every
  browser surface could photograph neither without `browser act` on an unregistered host — which the door
  refuses, correctly. A view a screenshot cannot address is a view nobody reviews.
- **A pull-request row is drawn as GitHub draws one, with a seat on it.** The owner's shape: GitHub items
  GitHub-native like the archive, profile pictures right, the row icon stating
  provenance, and the CI-failing group saying WHO is on each pull request so the owner never wonders whether they have
  to tell somebody. `components/live/PrCard.tsx` is the row — the state icon, repository, number, title,
  labels, the author's avatar and login, a checks chip, a review chip naming who is waiting, and the SEAT.
  The row's line ends in its state in words and its open age (`RowTag` in `PrCard.tsx`, the words from
  `site/lib/prPlainState.ts`). The checks chip, the review chip and the slide-over's state tag
  live in `components/live/PrStatus.tsx`, because a citation chip's hover card draws the SAME three off the same
  landing row ([citations](citations.md)); that tag says the same words as the row.
  The avatar is the member bronze's own `profile.avatarUrl` (`identity avatars --source github --json`, a
  measured slow-lane row), so the page loads an image from GitHub's avatar CDN and no
  other host, `referrerPolicy="no-referrer"`, falling back to initials when one fails; the roster is
  `src/corpus/members/avatars.ts`, and the verb reads bronze only, never GitHub. The seat is a JOIN, never
  a guess (`site/lib/seat.ts`): a live `github watchers` row names a session id, which `session depth`
  resolves to a workspace and slug; with no watcher, the head branch is matched to a `session list` row;
  with neither, a `blockedOn` names what it is PAUSED on and nobody is seated; and a watcher that no seat
  resolves says so rather than naming one. Provenance (`site/lib/provenance.ts`) is printed on the glyph's
  title: a bot's thread waiting on us, or a next act that is a bot-review fix (`spawn-coderabbit`), is CodeRabbit, and otherwise the glyph is the workspace the pull
  request's placement draws it in (`prPlacement`) — Acme's for the organisation's repositories, Slopweaver's
  for this installation's own, and Slopweaver's for one the default rule places — the one rule every Queue
  card reads, so a pull request the Slopweaver view draws never wears Acme's mark.
- **`refreshLive` is called from the handler, never from an effect.** The refresh calls it the instant its run
  has been recorded, in the same turn of the event loop, which is the whole of "re-read" and stays a read —
  of the ledger, here. The timing is the point: a poll answer already in flight when the run returned may
  predate what it wrote, and marking the channel synchronously is what drops that answer. An earlier shape
  bumped a `revision` the hook depended on, and Codex found the gap — the mark reached the channel only after
  React committed, so a poll landing in between was shown stale.

MEASURED: `github landing` took 68 seconds over eleven rows with drafts, which is why the page
reads a ledger on the fast lane rather than the verb on the slow one, and runs the verb only on a bounded
rule rather than a timer: the page's count must equal GitHub's, with a reading no older than the landing cadence.
**The console SHELL owns the count's freshness and its failure recovery, on every page**, so that keeping the counts
fresh, detecting a failed reading and fixing it each has an owner. The tick's reading is one input, never the
guarantee: measured over one day it landed about hourly, with gaps up to nearly two hours (`slopweaver reading
list`), its press read killed at 300 seconds
(`LANDING_TIMEOUT_MS`, `src/supervisor/scratch/tickCapture.ts`). One runner (`useLandingAutoRefresh.ts`) asks, judged
against one record so it never runs twice over one reading: on a reading EVENT — no readable census, not countable as
the owner's whole population (below), or nothing to show — and `due` at 25 minutes old, so the new one lands inside the
cadence. Both wait on the console being IN VIEW. No free clock: one timer wakes it when its next decision falls due,
never inside the backoff over a failed run (`landingShellWakeAtOf`), and coming into view wakes it too. Owned by the
page, the cadence refresh ran only there, and the badge sat on a warning all day on the Queue. Past the cadence no
count is printed while the rows stay (`currentCensusOf`); the sync route runs ONE automatic attempt per reading per
ten minutes across tabs and joins a run in flight (`landingFreshness.ts`, `landingAutoRefresh.ts`, `syncFreshness.ts`,
`app/api/sync/[verb]/route.ts`). The cost is one `github landing --include-drafts` read per ~25 minutes in view. The
line beside the selector ages the reading the ledger shows, never the run: the verb exits 0 when the append was refused.
**A withheld count is not a failed read.** Its mark says "This count is not shown: <why>; <what the console is doing>",
never "could not be read": an aged count that claims a technical error is false.
The why is a fact; what the console is doing comes off the runner's real state (`landingRefreshPlanOf`), and a quoted
read failure is said plainly with its raw message folded (`withheldCountFactsOf`, `site/lib/sidebarCountsBasis.ts`). No
reading recorded yet is withheld the same way, never a failure (`landingNotRecordedWhyOf`).
**The badge and Everything count ONE population: the rows, drafts included.** A badge and a list counting two
different things is a defect, drafts count towards the count, and the default view shows all of them. So the sidebar badge prints exactly the number of cards Everything lists — the landing reading's
rows in this work context (`site/lib/pullRequestPopulation.ts`) — and each state's count in the selector narrows
that same set. A number is printed only when the landing reading's latest read answered (never a reading kept over a
failed read, one handed over while it is read again, nor one the console's own refresh just FAILED to replace, until a
later reading is shown — `landingLatestOf`), the reading was taken with drafts, its census read and is inside the
cadence, and the rows reconcile with the census by ONE equality — the drawn rows' repo#number keys, as a multiset,
equal exactly the owner's open pull requests the census lists for this context, each once, every row's repository read
(any missing, repeated, closed, uncensused or other-author row is `rows-short`, named in the reason) — ONE rule, `pullRequestCountOf`, that the badge and the selector both
call; otherwise every count, the badge's included, prints no number, and the designed empty state gives way to an
explanation. A population gap (`drafts-excluded`, `rows-short`) is read off the reading's own contents whatever its
age, so the shell asks for a fresh reading over it whatever the age; age alone withholds the count, and the badge draws
itself again at that instant on a display-only timer (`badgeRedrawAtOf`) that never asks for a reading. The landing document carries `census`
— GitHub's own open list per selected repository, every author, drafts in (`src/live/github/openCensus.ts`) — as the
WITNESS that the rows are every open pull request of the owner's: the headline counts the part of it the reading's
`--author` matches over the repositories in the work context (the number of the owner's own open pull requests,
never the organisation's whole open count), joins those to the rows by repo and number and names every one no
row carries with its reason (`site/lib/pullRequestCensus.ts`), so open = placed + not placed by construction;
another author's open pull requests are counted apart on the headline, never listed. The voice reads the same
picture. **An empty state never prints a confident zero**, since an explanation is better than nothing: it draws the designed empty state only over a current, counted population — a filter that matches
nothing included — and otherwise says why it cannot show there is nothing, naming GitHub's own count when the
census has one (`pullRequestEmptyDrawOf`). The tick's recorded read keeps `--author @me` without drafts,
because it presses and `--press` refuses `--include-drafts`; its separate `--drafts-only --register` reading boards
the drafts nobody holds and is never recorded — `supervisor tick-capture` keeps it out of the ledger by its
declaration (`TickReading.ledgered`), since it files under the same producer and once stood as the console's latest
landing reading (MEASURED on a supervisor tick). The console's own invocations — the tick and the
shell's own refresh — run the verb as `--author @me`
over the organisation's repositories and this build's own, GitHub's own spelling of the token's user, so no login is a constant here; the
page prints whatever selection the document shown records, and every row prints its repository before its
number. A count whose reading has not arrived prints nothing either, beside the page's
spinner or staleness mark. The fixture is the verb's own reading: recorded with `reading record` into a throwaway home and read back with
`reading last --json`, so the frozen file is exactly what the live row would print.

**The read-only slide-over.** `open` on a row raises a panel over the list — `SlideOver.tsx` is the one
shell, owning the three ways out (its one button, the backdrop, Escape) and nothing else, and `OpenButton` is
the one control, which prevents a summary's own toggle so a press opens the panel and does not also unfold the
row. Three rows open into it: a pull request (`PrSlideOver`, the same `LandingRow` GitHub-shaped — six
tests, checks not green with logs, reviewer threads for CodeRabbit and humans apart, stack position, Slack
asks, board row, the checks-read register's watched line), a working session on `/fleet` (`WorkingSessions.tsx`'s
`SessionPanel`, [its transcript beside its properties](fleet-and-workstreams.md)) and a
board row on `workstreams` (`BoardRowSlideOver`, section, kind, priority, reason and the recorded question,
with an absent priority said rather than skipped). Each panel holds an ID — a number, a workspace id, a slug —
and finds its row again in the CURRENT reading, so a fresh reading re-renders it and a row the verb no longer
prints closes it; `?open=<n>`, `?seat=<workspace id>` and `?row=<slug>` open one from a link. Every panel
reads the row the list already holds — the session panel's transcript, read once by the seat's session id, is
the one fetch — and none holds a control that sends: the plan page drew these panels as places to read, never as places to act.
The plan page's fourth panel, a Slack ask, is not here: no reading on the site lists Slack asks as rows — the
landing row carries only `slackAsked` and `slackWhy`, which the pull-request panel already shows.

## One pull request, read live, drawn as GitHub draws it

The owner's ruling: realtime data in a platform-native view, so the owner feels they are looking at what the
platform would show, for pull
requests, their diffs and reviews, with citation chips and hover cards. `/pull-requests/<owner>/<repo>/<n>`
(`?tab=files` for the diff) is that page. A PR row's title and the census's numbers open it rather than github.com
(`consolePullHref`, `site/lib/pullAddress.ts`). A citation chip opens the pull request IN GITHUB, at the address as
cited, because the owner is not ready for this page to stand in for GitHub on a chip click, the way a Slack chip opens the message in Slack; its hover card's footer then offers
this page on the cited tab ("open it here") and its diff ("open its diff here") unless the citation already named
the diff (`citationFooterOf`, `site/lib/citationFooter.ts`). In the desktop app a github.com link opens in the owner's
browser.

- **It reads on open and never polls**, because a stale diff is worse than a link. `app/api/pull` runs
  `github read <pr> --limit 100 --files --json`, then `identity avatars --source github` for the people it
  names. The page says when GitHub was read and re-reads only on "read it again". `site/lib/pullView.ts`
  refuses the whole document on any shape it does not know, and the wrapper's residue is listed at the foot
  of the page, so a list longer than the read (files past 100, a long conversation) is named rather than lost.
- **It says when the diff is already on its base.** GitHub draws a diff against the branch's merge base, so an
  open +1/−1 says nothing about the base today: one pull request drew one while staging had held the line since
  an earlier one landed. Under `--files` an un-merged read carries `data.diffOnBase` (`src/live/github/diffOnBase.ts`): every
  changed file's copy on the base's current tip, judged hunk by hunk (`diffOnBaseJudge.ts`) as `on-base`,
  `partly`, `not-on-base` or `unknown` with its reason (each file's own at `data.diffOnBaseFiles`, last, so the
  20 KiB `talk verb` cut keeps the verdict and the CI rollup), and the header draws it with the tip it checked
  (`pullDiffOnBaseNotice`). A read without one says it was not checked; the console voice says "already in"
  only off this verdict (`src/talk/prFactLines.ts`).
- **Conversation**: the description, then comments, reviews and inline threads in time order. A review
  thread shows its code (`hunkTail`) and is folded when resolved. The sidebar has each reviewer's latest
  deciding review (a later comment does not undo an approval), requested teams, the head commit's checks
  with failures first, labels, and GitHub's own merge state. **Files changed**: each file's patch numbered
  on the side GitHub numbers it (`site/lib/unifiedDiff.ts`), each thread under its line, and outdated ones
  after the file.
- **People are chips with hover cards** (`PullPersonChip`, beside a queue card's `PersonChip`): the roster's picture and name, and where the person
  stands on this pull request. The roster's Slack and Linear join is not drawn: `identity show` resolves
  the whole corpus, too slow for a hover.
- **Nothing remote is fetched but avatars.** A body's pictures are counted and linked to GitHub, never
  drawn. A PR body's tables grow to their full height (Streamdown caps them with an inline `maxHeight`) and
  a long link or a code block cannot widen one past its box.

## The shared kit its readers stand on

Two mechanisms of the console's shared reading kit, both measured and both load-bearing:

- **`format` on the allowlist row.** `hand list` and `autonomy list` print JSONL, which is the
  `whole-file-json` rule rather than an inconsistency — both read registers that grow for as long as the
  install runs. The case that forces the branch is the ORDINARY one: `hand list --json` with nothing
  waiting on the owner prints nothing at all, and `JSON.parse("")` throws, so a single-document reader would
  report `NOT MEASURED` precisely when the answer was a clean zero.
- **`pane pr-status` is on the SLOW lane despite answering in 10s**, because the verb publishes its own
  poll contract — one `gh pr list` per repository per 60s — and a 20-second timer would triple the call
  rate it planned for against a token every agent shares. No page draws that row; it stays because the
  contract it records is the verb's, not a page's.

**The readers refuse rather than substitute.** A verb changing its `--json` shape breaks a tile, never the build,
and the unit lane pins the refusal only for the shapes its fixtures carry (`site/__tests__/unit/cardReferences.test.ts`
drives `readBoard` over a malformed board). A reader in `site/components/live/read.ts` or a sibling
such as `readNow.ts` answers `undefined` for a shape it does not recognise, and the tile says the shape changed, rather than
coalescing a missing field into a confident zero. A known value the payload has no field for is an absence the
tile states, never another field standing in.
