/**
 * Every `slopweaver desktop …` verb's usage line, and nothing else — a LEAF the manifest quotes, so listing the
 * surface never loads the install's effects (`.claude/rules/area-cli.md` § "Metadata is eager").
 */

/** `slopweaver desktop e2e`'s usage line. */
export const DESKTOP_E2E_USAGE =
  "usage: slopweaver desktop e2e [--app <path>] [--checkout <dir>] [--only <step,...>] [--out <dir>] [--json]\n" +
  "                              [--call [--call-hold-minutes <n>] [--call-card <key,...>|all]\n" +
  "                              [--call-mic-candidate <variant>]] [--context work|slopweaver] [--menu-bar]\n" +
  "                              [--settle-cap <seconds>] [--home <dir>]\n" +
  "  Walk a real Slopweaver.app the way the owner does and photograph every step: the Queue, an opened card, every\n" +
  "  sidebar page reached by its own link, Settings, the pages only an address reaches, the voice window's chat\n" +
  "  box and call button, and the docs. A step fails on an uncaught page error, a console error, a 5xx answer,\n" +
  "  Next's error overlay, a missing landmark, or a page still loading after 30s.\n" +
  "  The bundle runs as a TEST INSTANCE beside the owner's app — its own saved state and lock, no menu bar icon unless\n" +
  "  --menu-bar asks for its own, no fleet launch, no update, no console started — so the owner's running copy is never\n" +
  "  quit or touched. It reads the console\n" +
  "  the checkout already serves. Walk steps open and look, never press: no card is answered, and no call is\n" +
  "  placed unless --call asks for the call leg. The one press is the strip's +, whose tab the step closes.\n" +
  "  Refuses a bundle from before the test switch, which would start as a full second copy of the owner's app, and one\n" +
  "  from before e2e protocol 2, whose windows would record the calls it places as the owner's words.\n" +
  "  Exits 0 when every step passed, 1 otherwise.\n" +
  "  --app <path>      the bundle to walk (default /Applications/Slopweaver.app): a candidate build proves a\n" +
  "                    change before `desktop install` puts it in place\n" +
  "  --checkout <dir>  the checkout whose console it reads (default: this repository's declared main checkout)\n" +
  "  --only <step,...> just these steps, in walk order; an unknown id is refused with the list\n" +
  "  --out <dir>       where the photographs and report.json go (default\n" +
  "                    $SLOPWEAVER_HOME/proof/desktop-e2e/<started instant>)\n" +
  "  --call            then place REAL voice calls on a visible test instance, its microphone a generated WAV:\n" +
  "                    call-live, queue-search, call-holds, long-task-mid-call, card-read,\n" +
  "                    card-read-typed, card-reading-hold and card-next (only with --call-card),\n" +
  "                    fleet-ask, draft-read-back, renderer-killed, typing-after-drop, relaunch,\n" +
  "                    update-swap-resume, renderer-killed-twice,\n" +
  "                    renderer-killed-connecting, call-reopen (--only takes these ids too). Holds an\n" +
  "                    operation lock, holds at once (exit 4) while any call lease is live, and waits out then\n" +
  "                    refuses while the console's call registry holds a conversation of the owner's; stops the leg when\n" +
  "                    a call it placed cannot be proven ended, or a transcript it tracked or that appeared in\n" +
  "                    the store while it ran is not marked as the test instance's (`origin.instance: e2e`,\n" +
  "                    never read as the owner's words); each call's ids and\n" +
  "                    logs go in report.json\n" +
  "  --call-hold-minutes <n>  how long call-holds holds its call, 1 to 30 (default 5); only with --call\n" +
  "  --call-card <key,...>|all  for each card named, after long-task-mid-call: card-read asks the live call to\n" +
  "                    open it, named by its id's words, and say it in the card's own terms; card-read-typed types the\n" +
  "                    same words into the messenger with no call up. Each is then challenged by a typed push-back,\n" +
  "                    and passes only when one call's file holds the key read or opened, an answer, the challenge,\n" +
  "                    the key read or opened again and an answer, in that order. 'all' reads every open Queue and\n" +
  "                    Alignment card off the test instance's own pages first. Keys exactly as this install's console\n" +
  "                    names them (ask:, hand:, draft:, post:, review:, import:, pr:, act: or align:), never a\n" +
  "                    repository constant. Each call is also JUDGED for fidelity — the card and its briefing read,\n" +
  "                    claims dropped, figures added, handed words moved, the challenge re-read or agreed around —\n" +
  "                    into report.json, card-fidelity.json and card-fidelity.html, every failure anchored\n" +
  "                    talk-call:<call>#<segment>; that judgement never fails the scenario. A card leg waits up to 30\n" +
  "                    minutes for a call of the owner's to end. Refused without --call; a card scenario in --only is refused\n" +
  "                    without it. card-reading-hold runs only when --only names it: the live call opens the card,\n" +
  "                    hears 'let me just keep reading', and fails if a resume, a console-started turn, another\n" +
  "                    card or a triage step moves the owner off it within 45s. card-next likewise: the call opens the card,\n" +
  "                    hears 'All right, next card please', and fails if the card is still up 25s after the owner's words\n" +
  "  --call-mic-candidate noise-suppression-off|auto-gain-off|both-off  with --only transcription-fidelity, six\n" +
  "                    seven-minute calls compare that microphone setting against control (today's, gain control\n" +
  "                    explicit), counterbalanced over three paired rounds. Each plays one versioned synthetic script\n" +
  "                    in a pinned say voice, refused when that voice is not installed; the arm is merged into the\n" +
  "                    console's own microphone request and what Chromium applied is recorded. Critical words lost per\n" +
  "                    line, by stratum and gain, go in transcript-fidelity.json with a predeclared decision: invalid,\n" +
  "                    stop-control-near-perfect, inconclusive, candidate-improved or candidate-regressed. Never part\n" +
  "                    of a default --call leg; refused without --only transcription-fidelity, which needs it\n" +
  "  --context work|slopweaver  put every test instance's console in that work context, as its switcher does, before\n" +
  "                    the first step, the card inventory and each call, relaunches included, so a count is read off\n" +
  "                    the Queue that holds the cards; the owner's app keeps its own. Default: the console's own default\n" +
  "  --json            print the report as one JSON object instead of a line per step\n" +
  "  --menu-bar        every instance the run launches draws its own menu bar icon, named Slopweaver Test beside\n" +
  "                    it, in its tooltip, its first line and its Quit, next to the owner's icon, never instead; refuses\n" +
  "                    a bundle without SlopweaverDesktopE2EMenuBarProtocol 1. No step clicks it yet\n" +
  "  --settle-cap <seconds>  how long each walk step waits for its landmark and every loading mark, 1 to 600\n" +
  "                    (default 30): a longer cap MEASURES when a slow page settles, or that it had not by then\n" +
  "  --home <dir>      the state home whose profile declares the main checkouts";

/** `slopweaver desktop install`'s usage line. */
export const DESKTOP_INSTALL_USAGE =
  "usage: slopweaver desktop install [--home <dir>]\n" +
  "  Build the desktop app from this checkout and install it as /Applications/Slopweaver.app, the one copy\n" +
  "  Launchpad, Raycast and the Finder list. Signs it with the app's one local identity, so macOS keeps its\n" +
  "  microphone, System Audio Recording and Screen Recording grants across rebuilds (and clears them when the\n" +
  "  signature changed). Refuses a build missing its System Audio Recording helper.\n" +
  "  Stamps the build with the commit it was made from, which the console's sidebar compares with\n" +
  "  origin/main. Refuses while a voice call is live, because installing ends it.\n" +
  "  Installs the build `desktop prebuild` staged instead of building when it is exactly a clean HEAD,\n" +
  "  signed and verifying, and waits for a prebuild still running rather than building beside it.\n" +
  "  Quits any running copy first, replaces the old install (kept until\n" +
  "  the new one is in place), unregisters every other build LaunchServices knows by the same identifier,\n" +
  "  then opens it once on the declared main checkout so every later launch from Applications serves its\n" +
  "  console. Local only; asks for nothing.\n" +
  "  --home <dir>  the state home whose profile declares the main checkouts";

/** `slopweaver desktop prebuild`'s usage line. */
export const DESKTOP_PREBUILD_USAGE =
  "usage: slopweaver desktop prebuild [--decide | --log] [--home <dir>]\n" +
  "  Build and sign the app at the main checkout's HEAD into ~/Library/Application Support/Slopweaver/staged/ready,\n" +
  "  so the next `desktop install` (the owner's Update now) swaps that build in instead of starting one. Never touches\n" +
  "  /Applications, never quits or opens the app, and never mints the signing identity. Builds nothing outside a\n" +
  "  declared main checkout, over local desktop/ edits, when HEAD is already staged, or when the installed app's\n" +
  "  source already matches HEAD. The post-merge hook runs it on every move of main.\n" +
  "  --decide      the hook's foreground half: print the decision, exiting 3 when nothing is due\n" +
  "  --log         the hook's background half: build, writing every line to staged/prebuild.log instead of stdout\n" +
  "  --home <dir>  the state home whose profile declares the main checkouts";

/** `slopweaver desktop update`'s usage line. */
export const DESKTOP_UPDATE_USAGE =
  "usage: slopweaver desktop update [--outcome <path>] [--log <path>] [--home <dir>]\n" +
  "  What the app's Update button runs, from the main checkout: wait up to 75s for a voice call the app has\n" +
  "  just ended to let go of the console, fast-forward the main checkout (`checkout sync`, which also rebuilds\n" +
  "  the console page), then `desktop install`. Whatever happens, the app is left running — the new build, or\n" +
  "  the previous one put back — and the outcome is written to <cache>/desktop/last-update.json, which\n" +
  "  the next voice call is told, so the owner can ask it what happened.\n" +
  "  --outcome <path>  also write the outcome here (absolute), for the app that launched the update\n" +
  "  --log <path>      the file the launching app sends this run's output to (absolute), named in the outcome\n" +
  "  --home <dir>      the state home whose profile declares the main checkouts";
