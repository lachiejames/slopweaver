# Which build the app is, and updating it

A child page of the [desktop README](../README.md): how the sidebar knows which build the APP runs, when it says an
update is available, and the one click that updates it. Installing by hand is [the skill](../../skills/desktop/SKILL.md).

## The sidebar says which build the APP is, not only the page

A landing can change the shell while the page line reads "one commit behind": the console rebuilds itself on a
landing, but the shell reaches the owner only once `slopweaver desktop install` rebuilds `/Applications/Slopweaver.app`,
so an app can keep an old look while its page is current. So the install stamps every build with the
commit it was made from (`SlopweaverBuildSha`, `…CommittedIso`, `…Tree` in its `Info.plist`,
`src/desktop/buildStamp.ts`) and refuses an app that comes out unstamped; the app reads its own stamp at launch and
the installed one on every ask (`shellBuild.ts`, `slopweaver:shell-build`, the console window only); and the
sidebar's App half (`site/lib/shellStanding.ts`) names that commit, and a relaunch when the installed app is not the
one running. An app with no stamp has no `shellBuild` and reads "App build not known" until one install.

## "Update available", quietly, whenever origin/main's app differs from the running one

A fold that reads "App not in origin/main's last 50" over a build whose app is byte-identical to main's reads as an
app never rebuilt, so the condition is mechanical: `checkout console
--json` diffs the installed stamp's app source against the upstream tip (`installedApp`,
`src/checkouts/installedApp.ts`), and the line says "update available" exactly when they differ, "current" when they
do not — a landing that merely sits after the build never trips it. It is never pushed and never quits the app: the
update is the owner's act, one press of the button below. With no comparison (a verb that prints none, a stamp the app and the
verb disagree on) the line falls back to placing the build on the first-parent window, and says "may be available" where
it cannot tell.

## What an update brings opens as a release-notes modal

A fold that lists each change in twenty characters, eight of them a commit hash and five a PR number, tells the
reader nothing about what a change is without clicking through to GitHub, which defeats the release-notes experience.
The answer is a modal, not a wider panel or a page, showing only what changes if the owner updates right now.

- **The line says how many, and how many of those are in the app; a button in its fold opens the modal.** Ten
  commits behind matters only when they touch the desktop, the UI or bug fixes. So the line reads `Update available · 7 changes, 3 in the app` and the fold's button `What's
changed — 7 changes, 3 in the app`, both from one `releaseChangeSummary` (`site/lib/releaseNotes.ts`); the fold
  itself lists no commit. "In the app" is two path reads `checkout console --json` makes over the mainline window
  (`src/checkouts/shellChanges.ts`): `changesShell` (what the desktop app is built from) and `changesConsole` (the
  site less its tests, docs pages, their diagrams and captures, plus the `src/talk/` voice runtime). A path signal, not a dependency
  closure; a read that fails leaves its flag unknown, and an unknown is never counted in the app.
- **Grouped so the ones that matter stand out.** _You asked for these_ (the owner's own words behind the landing, whatever it
  touched), then _In the app_, then _Couldn’t tell where_ (a flag unread), then _Behind the scenes_ (both flags no) —
  each newest first, two shown and the rest behind its own fold, an empty group not drawn, every change in exactly one.
  Each card says `Fix` or `New` off its title's `fix:`/`feat:` prefix, beside its area.
- **One list for both builds.** Every change the page or the app is missing, each once, in origin/main's order
  (`experienceChanges`, `site/lib/updateStanding.ts`) — one update, one list, grouped as the bullets above say before
  it is drawn. Nothing older: release history is another page's job.
- **Each change is a sentence, never a hash or a link.** The squash title without its `fix(voice):` prefix,
  capitalised and closed (`site/lib/changeSentence.ts`), its scope a small area label. No model runs in the page, so
  the sentence is the title the pull request already carries. A change's details fold beneath it: the owner's words when they
  asked for it, and the day it landed with its pull request's number as plain text.
- **The ones the owner asked for come first.** The first group is every change whose landing carries the owner's own words (`fleet
landed`'s join), two shown and the rest behind its fold; `fleet landed` is read only while the modal is open.
- **The modal's footer carries the Update button**, the same press as the sidebar's: both draw one controller
  (`useUpdateControl`, `UpdateButton.tsx`), so the menu bar's offer and listeners are registered once. With nothing to
  update to, there is no button. How the LAST update ended stays in the sidebar, never the modal.

## One click updates it, from the sidebar, the menu bar or the app-name menu

A fold that reads "1 commit behind — new build waiting" and "`slopweaver desktop
install` from the main checkout" is not the one update button other apps have. The button is the same from the menu bar,
and on a call the app ends the call, updates and restarts the call; on a failure, the old app is back and the call
restarted so the voice can help you find out what happened.

- **One button under the update line, with one label.** Two kinds of updates, applied two different ways, is one too
  many to think about: one "update now" holds all the changes in one place. The press reads **Update now** (on a
  call, "End call, update & restart call") whatever it takes underneath, picked from the two standings
  (`site/lib/updateAction.ts`, which reads `ShellStanding.fix`, never the words): the full update when the app is
  behind or the checkout has not pulled, a restart when the installed app is not the one running, a reload when
  only the page moved. The line above it is one standing over both (`site/lib/updateStanding.ts`) and what it
  brings is one list in the release-notes modal — every change either build is missing, the owner's asks first — never a
  Console half and an App half. A page
  build still being built shows "Building update…", disabled.
- **Update now** launches `slopweaver desktop update` from the checkout, detached so it outlives the app it quits,
  its output to `userData/updates/<id>.log`. The verb waits for a just-ended call to let go of the console, runs
  `checkout sync` (which rebuilds the console page too), runs the install, and leaves the app running either way.
- **The build is already waiting.** There must never be a moment where fifty PRs have landed and updating now does
  not deliver them because nobody rebuilt; the coordination is the fleet's, not the owner's. So every move of the main checkout builds its app ahead of the owner:
  `lefthook.yml`'s `desktop-current` asks `slopweaver desktop prebuild --decide` and, only when one is due,
  backgrounds `--log`, which builds and signs HEAD into `staged/ready` under the app's support folder — compiling a
  `git archive` export of that commit's `desktop/`, never the checkout, so nothing the checkout does meanwhile can
  reach the build. The install
  the press runs takes that build instead of starting one — when it is exactly a clean HEAD, signed with the app's
  identity and verifying; anything else it names (`staged: not used — …`) and builds fresh, so a stage can make an
  update faster and never wrong. A fresh build of a clean HEAD compiles the same export; only a checkout with local
  `desktop/` edits is built in place, stamped dirty. Both share one build lock, so a press mid-prebuild waits for it rather than
  building twice. The rules are `src/desktop/stagedBuild.ts`.
- **The menu bar's first item carries the same words**, or Check for Updates… with nothing to do, which brings the
  window forward on the build fold. A click runs what the button would, as it stands then.
- **The app-name menu carries the same item, where ChatGPT and Chrome put Check for Updates…** A Mac app's
  application-name menu usually has a check-for-updates option. The shell had set no application menu, so
  Electron's default stood. Now it reads About, a failed update's line when there is one, the update item, Services,
  Hide, Hide Others, Show All and Quit, then Electron's standard File, Edit, View and Window menus, so copy, paste,
  reload, zoom and minimise work as they did; ⌘F, ⌘W and the tab keys are taken in each page before any menu sees
  them. No Help menu: Electron's default one points at Electron. Both menus read one `updateMenuView` and click one
  `clickUpdate` (`updateShell.ts`), so they never word it differently; the layout is `appMenu.ts`, and
  `appMenuShell.ts` sets it only when its plain template changed, since every shell event redraws the menu bar.
- **On a call the button says so** — "End call, update & restart call". The shell asks the overlay to hang up,
  saves that the call is owed a restart (`resumeVoice` in `state.json`), and restarts it once the update settles —
  or after 4 minutes, if the page went away before its next step. What is owed stays saved until a listening voice
  page takes the start: with none listening yet the shell opens the voice window and looks again each second, and
  each change of what it decided is an `update-resume` line in `desktop-events.jsonl` (`resumeDecision`,
  `updatePlan.ts`), naming the app that wrote it, the owner's own or a test instance, since the file is shared. A call the owner already started clears it, so the restart never opens a second call.
  A call in the console window rather than the voice's is refused, with what to do. A page build held for that
  call swaps in as it ends, then the page reloads — within 3 minutes, a deadline the shell holds rather than the
  page, so a console reloaded under the wait still ends in the reload and the restart. A test instance (`desktop e2e`) takes the same steps for its own call and refuses an install
  (`INSTALL_DISABLED`), which would quit and replace the owner's app; `update-swap-resume` proves the swap on a real call.
- **The update survives the quit it causes.** The launch is saved first (`update` in `state.json`), so whichever app
  opens next — the new build, or the previous one the install put back — waits for the outcome record, shows a
  failure in the sidebar and the menu bar, and restarts the call. An update that writes no record within 20 minutes,
  or whose process exits without one, reads `UPDATE_LOST`, naming its log.
- **The voice is told.** The verb also writes `desktop/last-update.json` under the cache root (`src/cacheHome.ts`,
  which `slopweaver doctor` prints); a call minted within 30
  minutes of it opens on what happened (`src/desktop/updateOutcome.ts`), so "what happened?" is answered from the
  record rather than guessed.
