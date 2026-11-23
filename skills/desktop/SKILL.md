---
name: desktop
description: Install the Slopweaver desktop app as a real Mac app — /Applications/Slopweaver.app, one copy, with the Slopweaver logo as its Dock and menu bar icon, open on the main checkout's console — or reinstall it after the shell changes, or prove a change end to end on the real app before installing it. Use when the owner cannot find the desktop app after closing it, when the desktop shell (`desktop/`) landed a change the owner should be running, when two Slopweaver apps show up, or when the app icon should change. Phrases like "install the desktop app", "I can't find the app", "update the desktop app", "change the app icon", "end to end test the desktop app", "prove it on the real app".
---

Run `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" desktop install` from a checkout of this repository. It needs no hand
and no flags: it builds this checkout's `desktop/` into a temporary folder (from a `git archive` export of HEAD when
the checkout has no local `desktop/` edits), quits any running copy, swaps the
build in at `/Applications/Slopweaver.app` (the previous install kept until the new one has run for 10s without stopping, and put back if it never starts — by the next run if this one is killed first or a copy will not quit), unregisters
every other build LaunchServices knows by the identifier `ai.slopweaver.desktop`, and opens the app on
the profile's declared MAIN checkout, waiting until the app has saved it. The app opens as if from the Dock: no cmux,
Claude Code or Codex session key of the seat running the verb, nor its routed plan or a vendor credential, reaches it,
so the sessions it hosts never inherit that seat's session or plan; the owner's own configuration (`CLAUDE_CONFIG_DIR`)
still does (`src/cmux/outsideEnv.ts`). Report each line it printed.

- **Never during a voice call.** The install quits the app, and a call in it with the app, so `CALL_LIVE` refuses
  it while a call holds a console lease (`talk calls` lists them): at the start, touching nothing, and again at
  every quit, so a call the owner starts mid-install keeps its app and the next install puts right what this one left. A shell fix that landed
  mid-call is a hand step through the chair for after the call, never an install over it.
- **Every build is stamped with its commit**, and the sidebar's ONE update line reads it beside the page's build:
  "Update available" with every change either is missing in one list (the owner's asks first, read in the fold's
  release-notes modal) when origin/main's app source
  differs from the running build's, or the installed app is not the one running, or the page is behind — never a
  console kind and an app kind (the owner's ruling). The app's half of it IS the condition for reinstalling —
  computed, never a judgement of which landing "touched" the app — and it is quiet: never push it, never install
  unasked, since the install quits the owner's app. An app from before stamps reads as an update until one install stamps
  it. Install from the MAIN checkout at origin/main so the stamp is the line the owner expects; a `dirty` stamp (the
  `stamp:` line) means the build carried local `desktop/` edits. `STAMP_MISSING` means the built app came out
  without the stamp: nothing was swapped, read the build.
- **The owner's update is one click: the sidebar's Update button, the menu bar's first item, or Check for Updates… in the
  app-name menu** (the same item and click as the menu bar's). It runs `slopweaver
desktop update` from the main checkout: it waits up to 75s for a call the app just ended to let go
  (`CALL_STILL_LIVE` after that, touching nothing), fast-forwards the checkout (`checkout sync`, `SYNC_REFUSED` when
  it cannot), runs this install, and leaves the app running either way — reopening the installed one if nothing
  is. It writes the cache root's `desktop/last-update.json` (`slopweaver doctor` prints the root), which the next call's voice is told for 30 minutes, so
  "what happened?" is answered from the record. On a call the button reads "End call, update & restart call": the
  app ends the call and restarts it when the update settles, the old app's included. It is the owner's press, never a
  seat's — a seat still never installs unasked, and never runs `desktop update` for the owner. An app from before the
  button has none until one install; the walk-through is the [desktop README](../../desktop/README.md).
- **Main's app is already built when the owner presses it.** Every move of the main checkout (`post-merge`'s
  `desktop-current`) runs `slopweaver desktop prebuild`, which builds and signs HEAD — from a `git archive` export
  of that commit's `desktop/` plus every root file its committed `desktop/package.json` scripts name through `..`
  (`scripts/tsc-owner.sh`), never the checkout — into
  `~/Library/Application Support/Slopweaver/staged/ready` in the background and touches nothing installed; the
  install swaps that in instead of building, but only when it is exactly a clean HEAD signed with the app's identity
  and verifying (`staged: not used — <why>` otherwise, and it builds). It never mints the keychain — the first
  install does — and discards its build when HEAD moved under it. Install and prebuild share one build lock, so
  an install waits for a prebuild in flight (`waiting:`). `desktop prebuild` alone restates the last failure from
  `staged/prebuild.log`.
- **Somebody without a `desktop install` build downloads one.** `.github/workflows/desktop-release.yml` publishes
  `Slopweaver-desktop-arm64.zip` on a `desktop-v<desktop/package.json version>` tag: moved into Applications, it
  asks for a clone once (**Choose a Slopweaver clone…** on its note) and remembers it. Never say a release is
  notarised unless its own notes say so; an ad-hoc one needs `xattr -dr com.apple.quarantine
/Applications/Slopweaver.app` first ([download a release](../../desktop/docs/download-a-release.md)).
- **One copy, always.** The bundle name and identifier never change between builds, so a reinstall replaces the
  install rather than adding one. Never `open desktop/dist/…` for the owner: a build folder is a second app.
- **Signed with one identity, so macOS grants survive a rebuild.** Every build is signed with the self-signed
  identity in `~/Library/Application Support/Slopweaver/signing.keychain-db`, minted on the first install. When the
  signature changed (that first install, a lost keychain, or an unsigned build an older checkout installed) the `permissions:` line says the app's old macOS
  grants were cleared, and the app's permissions guide (menu bar "Turn on …") walks the owner back through the microphone, System Audio Recording and Screen Recording; a clear that failed says
  so, and it or one a rollback followed is made again by the next install. Putting back a differently signed app clears them too. `SIGNING_FAILED` touched nothing installed; its message names the
  keychain to delete if it persists.
- **Spotlight may be switched off on this Mac** (`mdutil -s /`). The `spotlight:` line says so; Launchpad,
  Raycast and the Finder still list the app. Never turn indexing on for the owner — it is a system setting.
- **The icons are one file.** Both the Dock icon and the menu bar mark are drawn from `desktop/assets/logo.png`
  (square, at least 1024px, 8-bit RGB or RGBA, not interlaced). To change them, replace that file and run the install; no code changes. The menu bar
  states are drawn on top of the mark in code (`desktop/src/trayIcon.ts`).
- **A failure names its step.** `STILL_RUNNING` means a copy would not quit in 20s: that is the one hand step
  (Quit Slopweaver from its menu bar icon): a seat asks the pinned supervisor to hand it to the owner
  ([hand](../hand/SKILL.md)), then runs the install again. A Gatekeeper prompt is not expected for a local
  build; if one appears it is also one hand step, never something to clear.
  `ROLLED_BACK` means the new build did not register, start and keep running, so the previous app was put back and opened: read the build,
  never retry blind. `STALE_COPIES_KEPT` means the app is installed and open but another build stayed registered: delete the build
  folders it names (they are build output) and run it again. `INSTALL_IN_PROGRESS` means the install lock was
  refused and nothing was touched: usually another install is still running, so let it finish rather than
  starting a second; the message carries the lock's own reason when it is anything else. A FIRST install that fails
  has no previous app to put back, so its new build stays installed and the error names why: fix it and rerun.
- **Prove a change on the real app before it is installed: `slopweaver desktop e2e`.** It walks a bundle (the
  installed one, or `--app` a candidate build) as a test instance beside the owner's app — its own saved state, no menu bar
  icon unless `--menu-bar` draws its own as Slopweaver Test, no fleet, no update — clicks every page's own sidebar link, opens a card, finds the voice window's chat box and
  checks its reported controls are clipped as drawn, opens a published page of its own in the viewer (written and
  removed by the walk), photographs every step and fails on any page error, console
  error, 5xx, error overlay or page left loading. The walk looks and presses only the strip's + (a tab it closes again); `--call` adds real voice calls
  (live, a held call's heap, a long task, renderer crashes, relaunch), stopping if one cannot be proven ended. **Never
  while the owner is on a call** (the owner's ruling): a live call lease or a microphone another app holds HOLDS the whole run,
  exit 4, no hatch. On an empty Queue the card step is `N/A`, named in the summary, never passed. Exit 0 only
  when no step failed and nothing stopped the run. [What it walks and why it is safe](reference/e2e.md).
- **The installed app hosts sessions; a test instance never does.** The owner's app serves the session harness's
  owner-only socket, so `cmux spawn|list|send|stop|close --harness app` opens and drives a Claude or Codex session as a
  card with a Stop control, its worker started only once that card is on screen. A quit ends every session it
  hosts. `cmux usage --harness app` reads what each hosted session spent this run, by plan, counted at each turn's
  end, so poll it until the session is idle. So the app harness is proven on the installed app, never `desktop e2e`:
  [the app implementation](../../docs/session-harness.md#the-app-implementation).
- **Where the code is.** The decisions are pure in `src/desktop/installPlan.ts`; the verb is
  `src/cli/commands/desktop/installRun.ts`, and every effect on the Mac goes through `installSeams.ts` beside
  it, which is what lets the tests in `unit/cli/commands/desktop/installRun/` run the whole install over a fake Mac.
  The update's decisions are `src/desktop/updateOutcome.ts`, its verb `updateRun.ts` beside the install's, and the
  app's half `desktop/src/updatePlan.ts` and `updateShell.ts`. The prebuild's decisions are
  `src/desktop/stagedBuild.ts`, its verb `prebuildRun.ts`, and the lock both share `buildLock.ts`.

Developing the shell itself stays `cd desktop && yarn start`, which compiles the System Audio Recording helper with
`xcrun swiftc` first; `desktop/README.md` is the shell's own doc.
