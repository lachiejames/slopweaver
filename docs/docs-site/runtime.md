# One server per worktree, recorded — and what reaps the ones that outlive a seat

Part of [The local docs site](../docs-site.md).

The owner once opened Activity Monitor, found **nine** `next-server` processes and asked whether they were in
use. Eight were docs dev servers that seats had started to look at their own pages and never
stopped, **four of them in one worktree** on four consecutive ports. Nothing here had chosen those ports —
this script never passed one, so Next took 3000 and auto-incremented past every server already holding one.
The defect was not the port: it was that **nothing recorded that a server existed**, so no relaunch could
reuse one and nothing could stop one.

The run record is that missing fact — one JSON file per worktree under the cache root's `docs-site/`
(`src/cacheHome.ts`, mirrored in bash by the script; `--print-cache-paths` prints it, and a `docs-site/` an older
script left under the home is renamed there with a link left until no server started before the move is running),
carrying the pid, the port, the log path and **who started it** (`starterPid`, `starterSessionId`, from
Claude Code's own `CLAUDE_PID`/`CLAUDE_CODE_SESSION_ID`; both absent for a `yarn docs` typed in a plain
terminal). It makes four things possible: `--start` reuses a live server instead of minting another,
`--stop` ends one by name, `--overflow` starts a server only when none is up and stops **exactly the one it
started**, and the reap below can tell a server whose reader is gone from one whose reader is sitting in
another worktree. A record whose pid is dead, or whose pid no longer carries the port it was recorded with,
is treated as absent — that is the pid-recycling guard, and it is why the check reads the live argv rather
than trusting the file.

That fixes every server started from here on. The ones already standing, and the ones a seat leaves behind
when it dies before its `--stop` ever runs, are `slopweaver machine reap`'s
(`src/live/machine/devServers.ts`). It ends a dev server on three criteria — **no live session is reading
it**, its board row is terminal, or it is a **duplicate** and another server in the same worktree has been
up longer — and `slopweaver perf` counts the class in its one line above the fold and owes a REACT line for
it. Two boundaries are deliberate and worth knowing before you go looking for a server it did not take: it
only ever touches a FLEET worktree — one under the repository's own worktrees directory (`inFleetWorktree`)
— so the server you run in the main checkout to read these docs is never a target, and **the
longest-running server of a worktree always survives** a duplicate verdict.

**"No live session is reading it" is two questions, and the second one is why the record carries a
starter.** MEASURED: a live seat whose own worktree was `today-is-the-platform-native-daily-ui-…`
ran `cd <sync-now worktree> && bash scripts/docs-site.sh --start --port 3001` nine times in one morning. No
session registry row named the sync-now worktree, so the reap called each server seat-closed and killed it,
and the seat started another to finish reading its page — the server the owner watched reappear under a
worktree with no seat. A seat works wherever it likes; only the worktree it LIVES in is in the registry. So a
server is seat-closed only when no session sits in its worktree **and** the session its record names is no
longer live, matched by session id as well as pid so a recycled pid protects nothing. The cost is one error
in the safe direction: a live seat that starts a server and never returns holds it until the seat dies, its
row goes terminal, or a second server appears beside it.

```bash
slopweaver machine reap --dry-run   # what it would take, and what it would leave alone, with reasons
```

## The production console: built and served, rebuilt when the checkout moves

The console the owner reads at `http://localhost:3000` is a **production build served by `next start`** from the
main checkout, never `next dev`, because the dev server made the app feel slow. MEASURED, same pages both ways: `next dev` shipped about 4.5 MB of
JavaScript to every console page and took 12.8 s to compile a docs page on its first visit; the production
build ships about 750 KB and answers every page in under 10 ms.

**Every server the script starts listens on 127.0.0.1 only** (`console_host`, passed as `--hostname` to
`next start` and both `next dev` starts, last so a caller's own `-H` cannot widen it), while every address it
prints stays `http://localhost:<port>`: the bookmark, the desktop app's parser and the page's microphone grant
all key on that origin, and Node's fetch and Chromium reach 127.0.0.1 when `localhost`'s `::1` refuses. Not
`--hostname localhost`, which binds only the first address it resolves to, `::1` on macOS. Next's own default is
every interface, which would put the console, and the mail and Slack it reads, on the local network.
`lsof -nP -iTCP:3000 -sTCP:LISTEN` reads `TCP 127.0.0.1:3000 (LISTEN)`.

```bash
bash scripts/docs-site.sh --serve                 # build into a slot and start `next start` on :3000, recorded
bash scripts/docs-site.sh --refresh               # bring it onto HEAD now, in the foreground
bash scripts/docs-site.sh --refresh --background  # the same, returning at once — what the two triggers run
```

**It follows the checkout by itself.** A build left stale behind main is rebuilt by a hook when main moves, not by
the owner or the fleet remembering to. Two triggers, both where HEAD actually moves, and nothing else — no watcher, no poll, no daemon:

- lefthook's `post-merge` runs `console-current` in any checkout holding a build slot, which is only one that
  has run `--serve`; every other worktree's pull pays one `test -d` and prints nothing.
- `slopweaver checkout sync` asks for the same refresh after its fast-forward and prints a `console:` line.

The fast-forward fires the hook too, so the second request is told _a rebuild is already running_. The
refresh holds a kernel lock (`lockf`, `flock` off macOS) on a file descriptor the round and its `yarn` keep
open, so nothing a finished refresh leaves behind can hold it. Yarn closes that descriptor before it starts
`next build`, so a build orphaned by a kill outlives the lock. Every round first stops what a killed round
left in this `site/` and the live record does not name, and waits for it to exit, so two builds never share a
slot. It proves each is its own by the `.next-serve-a|b` slot a dev server never uses: a build by the
`<slot>/lock` Next holds while it builds, a server by the slot in its `yarn start`'s environment. A
`next-server` whose `yarn` is gone proves nothing, so the round leaves it and refuses its port, naming the pid
to kill (never `--stop`, which forgets the record the next pull rebuilds from). With neither lock tool
installed a refresh refuses loudly rather than reading as one already running. A trigger arriving mid-build
leaves the work to the running refresh. That refresh re-reads HEAD after it releases the lock, and builds
again if HEAD moved (three rounds at most).

**Two build slots, so the console stays up while it builds.** A build is about 25 s, and building over the
tree `next start` is reading deletes the chunks its open pages still ask for. So a refresh builds into
whichever of `site/.next-serve-a` / `site/.next-serve-b` the server is NOT reading, and only then restarts onto
it — the console is down for a restart, not a build. `next.config.mjs` takes the slot from
`SLOPWEAVER_SITE_DIST_DIR`; `tsconfig.json` names both slots' type globs so a build never rewrites it, which
would dirty the main checkout and make the next `checkout sync` refuse it. The install before a build is
`--immutable` for the same reason. Those globs also pull the SERVING slot's and any old dev run's generated
route types into the build's typecheck, so a build first removes every dist directory's `types/` and
`dev/types/` (`clear_generated_types`): a validator written before a route was deleted still imports it, and
failed every round after a route deletion until it did. Nothing serving reads them.

**A rebuild never drops a live voice call.** A landing's swap once turned the owner's next sidebar click into a full
reload that ended the call, so the swap, or the reload it forces, waits until no call is
live. A production server is started with `SLOPWEAVER_CONSOLE_HOLD_DIR`
(`<record>.hold/` beside the record), and the console voice beats a one-minute lease into its `calls/` every
fifteen seconds while a call is live (`site/app/api/console/call/route.ts`). A round that has built its slot
then holds the restart while any lease is unexpired, writing `waiting.json` — the sidebar build chip shows _new
build waiting_ (the voice itself says nothing about it, by the owner's ruling), and `checkout sync`'s `console:` line names it — and swaps once the call ends. **No clock ends a hold**:
a 30-minute cap once fired and the restart ended the owner's live plan call. A crashed tab stops beating, so
its lease lapses within a minute. A call being MINTED has no live page to beat for it, so `/api/talk/offer` writes
its own lease before it spawns `talk offer` and holds it for the route's whole bound: without it, a round
found no lease mid-mint and killed the follow-on call after the 90-minute limit. The page's half covers a call started on a stale page: any navigation that would
unload the document mid-call — Next's forced reload when the build id changed, a crossing into the docs' layout, a
link off the console — is held on the Navigation API's `navigate` event and opened when the owner hangs up
(`site/lib/consoleHold.ts`).

**The swap ends the old server; freeing its port is not enough.** `next start` closes its listener on SIGTERM
and keeps answering the keep-alive sockets a browser already holds. Measured: a call opened 25 s after
a swap, and every tool claim the page sent rode a pooled socket to the outgoing server, whose memory never held
the call, so each was refused "no plan call is live". The round freezes the old server's whole process tree with
SIGSTOP, parent before children so nothing forks out of the walk, then SIGKILLs it where it stands. That is safe
because the hold above guarantees no call is live, and a frozen process that is killed runs no handler. It waits
for every process to exit, and starts nothing if any are still there or if any never stopped within a second, since
that one's children were read unfrozen (`end_tree`, driven by
`src/__tests__/subprocess/scripts/docsSiteEndTree.test.ts`).

**A start counts once it answers a page, and a failure never loses the console.** `next start` listens
BEFORE it loads its config and build, and exits when that load fails, so a listening port proves nothing.
A new server counts as up only when every listener on the port is its own and a page answers within two
minutes; until then the record still names the last build that answered. Nothing in a refresh deletes a
production record, so a refresh that fails, or is killed at any point, leaves the old build and the record
in place, and the next round stops whatever it left running. A failed build leaves the old server serving,
or restarts it if the console was down; a new build that will not start goes back to the old slot. If
neither starts, `--status` reports the console as DOWN, and the next pull, sync or `--refresh` brings it
back. `--start` and plain `yarn docs` refuse to run a dev server over a production record.

The record is the one described above with three more fields — `mode: "production"`, the `sha` it was built
from, and the `slot` — and the refresh's own lines go to a `.refresh.log` beside it. `machine reap` never
touches it: the main checkout is not a fleet worktree.

**The sidebar says which build a page is, and whether it is the latest**, so the owner can see a page is one
version behind and hard refresh onto the latest build. Every build
the script runs exports `SLOPWEAVER_BUILD_SHA` and `SLOPWEAVER_BUILD_COMMITTED_ISO` (`export_build_identity`), and
`site/next.config.mjs` bakes both into the bundle — nothing in the config asks git, so a production bundle's sha is
the one its record names. `slopweaver checkout console --json` reads the served build from the record, the
checkout's HEAD, its upstream (its remote and ref read from git's own branch config, never split out of a
`corp/team/main`-shaped name, resolved by its full `refs/remotes/…` name so a tag or branch of the short name never
stands in for it, and fetched by a refspec naming that tracking ref, at most once a minute across every tab, by an exclusive per-minute claim in
a `.fetch-claims/` beside the record, keyed by the checkout path's whole digest, that no reading ever releases, so none can remove another's; its age is that
upstream's own `fetched.<digest>` stamp there, written only when a fetch succeeds, never `FETCH_HEAD`, which git
touches on a failed one),
up to fifty first-parent upstream commits with their pull requests, and whether a round is running or
holding a build for a call. The page compares its own baked sha with that (`site/lib/buildStanding.ts`) and
polls once a minute without reloading: latest, behind with the server serving a newer build, a build held for a
call, rebuilding, a checkout that has not pulled, or a moved checkout nothing is rebuilding (the `--refresh` step
with its log). "Newer" is a position in that history, never two unequal shas; a build outside the fifty is "not in
origin/main's last 50" — older or off the line, the reading cannot tell — and it is never counted.

**The owner reads one update, never two kinds.** The owner does not want to think about two kinds of update and two
ways of applying them: one "update now", with all the changes in one place. So the page's standing and the app's (below) are joined
into one line (`site/lib/updateStanding.ts`): _Up to date_, _Update available · N changes_ with every commit either
build is missing in one list, _Building update…_, or _Update status not known_ with why. A fetch of the upstream
that failed or is old is a failed read, never that sentence: a staleness mark naming it beside the answer it last
gave (`upstreamUnread`), on every path and beside any other reason. The app's own answer that would not read is the
same — its last good build kept, marked (`shellUnread`) — and a failed part of the build reading joins the mark. In the desktop app the
step is always the one Update now button ([builds and updates](../../desktop/docs/builds-and-updates.md)); in a
browser, where there is no app, the fold names the hard refresh.

The same reading carries `installedApp`: the stamp in `/Applications/Slopweaver.app`'s `Info.plist` and whether
the app's own source (`SHELL_PATHSPEC`, `src/checkouts/shellChanges.ts`) differs at the upstream tip from that
commit — `git diff --name-only` by CONTENT, never by place, because an app installed from a pull request's
pre-squash branch head sits on no first-parent line while its source is byte-identical to main's. When it differs the field carries the fork (`merge-base`) the sidebar places the build by. `absent` and
`unreadable` are two kinds, and a `dirty` stamp, or one read with no upstream, is never compared. The app's
standing uses it only when the running app, the installed app and this stamp are one clean build, and over a stale
fetch is not known rather than current (`site/lib/shellStandingContent.ts`).

## Internal, and local-first

The owner's ruling: **there is no public docs host and there is not meant to be one.**
The card this replaced proposed GitHub Pages, and the owner had not realised Pages is public — these docs
are internal, only the owner reads them today, and a team-facing synced copy is a later question that has not been
asked yet. So the site has no deploy target, no CI publish step and no `basePath`: it is served from the
checkout, and a proposal for a public docs host is never made. The shape the owner pictures is the Next.js, Stripe
or Nextra docs the owner already knows — many pages, none too long, code examples with a copy button, a showcase — reached
by an existing convention rather than a new tool to learn.

`next.config.mjs` carries that as a comment rather than as a convention, because a docs site with no deploy
step reads as an oversight to the next person who opens it.

## Why `site/` is not a Yarn workspace

The root `package.json` pins every dependency exactly (`yarn.config.cjs`), and every job in
`.github/workflows/ci.yml` that installs anything runs `yarn install --immutable` — a count is not written here
because the job list moves (`compile` joined it later) and a stale number reads as a fact. Declaring a `site` workspace would push Next.js,
React and their trees into the root lockfile and into every one of those installs, forever, to serve a
site one person reads locally.

So `site/` is a **separate Yarn project**: its own `package.json`, its own `yarn.lock`, its own
`.yarnrc.yml`. Yarn asks for exactly that when a nested package directory is meant to stand alone — an
empty lockfile is the marker that makes it a project rather than a misfiled workspace. `scripts/docs-site.sh`
scrubs the inherited `PROJECT_CWD` and `npm_*`/`YARN_*` variables before invoking the nested Yarn, because
an inherited one points the nested invocation back at the outer project.

**Nextra resolves through one Yarn patch**, `site/.yarn/patches/nextra-npm-4.6.1-*.patch` — the one tracked
file under the otherwise-ignored `site/.yarn/`. Nextra's MDX loader built a Twoslash transformer at module
load, and Twoslash imports the classic `typescript` compiler API, which the TypeScript 7 pin does not ship;
Nextra has no option to turn that default off and no page here authors a Twoslash block, so the patch deletes
the construction and adds nothing. The Twoslash packages stay in `site/yarn.lock` — a patch changes a
package's files, never the dependency graph — but nothing reaches them. `site/__tests__/integration/nextraPatch.test.ts`
reads the INSTALLED loader in the `site` CI job (`yarn test:nextra-patch`, before `yarn build`), so a Nextra
bump that drops the patch reddens before the build does; a bump re-cuts it with `yarn patch nextra` in `site/`.

**Which gates still reach it, and which do not.** Prettier and oxlint walk the whole working tree, so
`yarn lint` DOES check `site/` — measured: the first lint run over it reported five missing return types
and a formatting diff across ten files, and both had to be fixed before the gate went green. What `site/`
is outside is everything scoped by a config file — `tsconfig.json`'s `include`, `knip.json`'s `project`,
and every vitest lane bar one root. That root is the unit lane's second, `site/__tests__/unit/**`, and it
collects the console's PURE modules and nothing else. Its own typecheck is `next build`, which runs `tsc` over the site's own
`tsconfig.json`; `bash scripts/docs-site.sh --build` is how you run it. So the trade is narrower than
"uncovered": style and a11y are gated, types are gated by the site's own build, and behaviour is proved by
building it and looking at it.
