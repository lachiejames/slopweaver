/**
 * `slopweaver browser`'s usage block, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/browser.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

export const BROWSER_USAGE =
  "usage: slopweaver browser\n" +
  "         <profile|cookies|pin|shot|image-record|annotate|terminal-shot|console-shot|redact|verdicts|\n" +
  "          break-glass|open|inspect|present|sign-in|read|aim|act|scroll|close|sessions>\n" +
  "         [--list] [--set <directory>] [--origin <url>] [--url <address>] [--out <file.png>]\n" +
  "         [--target <adapter:target|ref>] [--readiness-timeout <ms>] [--caption <text>] [--raw]\n" +
  "         [--settle <ms>] [--form <file.json>] [--limit <n>] [--blocked] [--reason <why>]\n" +
  "         [--session <id>] [--do <kind>] [--value <text>] [--observation <id>]\n" +
  "         [--download-dir <dir>] [--expect-name <file>] [--expect-focus <ref>] [--page <url|slug>]\n" +
  "         [--focus] [--no-focus] [--full-page] [--pages <n>] [--up] [--destination <name>]\n" +
  "         [--provider datadog|github] [--org <slug>] [--under <ref>] [--find <text>] [--walk <name>]\n" +
  "         [--json] [--home <dir>]\n" +
  "  open           take an interaction session on a page and hand back its id, its first look and a\n" +
  "                 picture of the viewport. Every later command names that id, and the page stays exactly\n" +
  "                 as you left it between them\n" +
  "  inspect        open ONE page on a platform the browser register names, take the same look, and close\n" +
  "                 its tab again, all in one call — the console voice's browser, with no action to take\n" +
  "  present        take the owner to ONE page and LEAVE its tab open — --destination datadog|linear|github-pulls,\n" +
  "                 resolved on this install (Datadog's own site), a --url on the browser register, or\n" +
  "                 --page <slug>, a published local page opened through the console.\n" +
  "                 Prints one JSON document: where it landed, its title and the session holding the tab.\n" +
  "                 A console page — --page, or a --url on the console itself (the Queue, the board,\n" +
  "                 #settings/<section>), never its /api/ bar a published page — opens as a new tab in\n" +
  '                 the Slopweaver desktop app, answered openedIn "slopweaver-desktop-app".\n' +
  "                 A Slack message permalink goes to the owner's Slack desktop app instead: no tab, no session,\n" +
  '                 answered openedIn "slack-desktop-app"\n' +
  "  sign-in        LOOK whether the owner's Chrome is signed in to --provider datadog|github (--org names the\n" +
  "                 GitHub owner, default the repository's: an organisation's SSO grant is read, a personal account\n" +
  "                 has none and its session is read). Signed in: exit 0. A wall: exit 3, with the one button the\n" +
  "                 fleet presses — printed as the exact `browser act` — or the step that is genuinely the owner's.\n" +
  "                 Every look is recorded, and only a fresh look that reached the owner's hands lets a card ask the\n" +
  "                 owner to sign in. After a press, look again with --session <id>: it judges where the pressed tab\n" +
  "                 is NOW\n" +
  "  read           look at the session's page: a picture of the viewport, its URL, its title, and an\n" +
  "                 OUTLINE of its elements — opened breadth-first to about 6 KiB, each part left shut one\n" +
  "                 line naming the ref that opens it — with the whole file's size beside it. --under <ref>\n" +
  "                 prints that ref's part and --find <text> the lines holding it, both from the session's\n" +
  "                 LATEST look, taking no new one, so its observation id still stands. Never refused by the\n" +
  "                 read-only rail\n" +
  "  aim            show an element and photograph it there, and act on NOTHING: the target scrolled into\n" +
  "                 the viewport, a picture of that viewport before the mark and a second one with the\n" +
  "                 target marked, and what the register says this page may be driven to do. `act` takes\n" +
  "                 the same pictures itself before every write-capable interaction, so reach for this one\n" +
  "                 when you want to LOOK before firing. It grants nothing: an aim is not cited by `act`\n" +
  "                 and never makes an interaction allowed that was not\n" +
  "  act            perform ONE interaction and photograph its own result — --do click|fill|type|select|\n" +
  "                 check|uncheck|hover|press|scroll|drag|upload|download|navigate|back|forward|reload|\n" +
  "                 double-click|dialog-accept|dialog-dismiss\n" +
  "  scroll         move the page one screen at a time and photograph each screen, saying where in the\n" +
  "                 document it is — the loop for when the thing you want is below the fold. Ends with a\n" +
  "                 fresh read, so the next `act` has refs and an observation to cite\n" +
  "  close          close the session's tab and let go of the browser, leaving Chrome running\n" +
  "  sessions       list the sessions this home holds: owner, owner live?, page, age, next reap's verdict\n" +
  "  profile        report, list or record which of YOUR Chrome profiles every browser leg reads\n" +
  "  pin            write the shim every Playwright connect page is launched through, so it opens in that\n" +
  "                 profile whatever Chrome was last used in. Refreshed on every attach; run it by hand\n" +
  "                 only to inspect the script or to repair it\n" +
  "  cookies        report whether that profile currently holds a session for an origin. Never prints,\n" +
  "                 logs or writes a cookie value — only the names and when they lapse\n" +
  "  shot           photograph ONE page through the Playwright extension relay, in that profile. This is\n" +
  "                 the screenshot route for every session — never the Claude-in-Chrome extension. By\n" +
  "                 default it WAITS for a closed, source-owned target to render, crops to it and its\n" +
  "                 query and time range, frames it, captions it and measures it; no click, no typing,\n" +
  "                 no caller-supplied selector. The result is readback-pending until image-record\n" +
  "  image-record   write down what you SAW in an image, so it may be attached to an outbound message.\n" +
  "                 An image with no such record cannot be sent, and one recorded unfit can never be —\n" +
  "                 A failed record is still written; the exit code is what refuses\n" +
  "  annotate       draw boxes and their notes onto an EXISTING PNG: a red frame outside each box, a number\n" +
  "                 beside each when there are several, the notes in a caption band below. --form names the\n" +
  "                 source, the out path, one to four { rect, note } and what you saw. Writes the PNG and a\n" +
  "                 pre-filled <out>.image-record.json, and NO record: open the picture, then run\n" +
  "                 image-record --form on that file. A source recorded unfit is refused — retake it\n" +
  "  terminal-shot  render terminal text to a PNG and file its capture receipt, the exact words drawn as\n" +
  "                 frame text. --form names an absolute textFile (a `cmux read-screen` dump, a command's\n" +
  "                 output), lines { from, to } to keep, a label and the out path. Keep fewer lines than the\n" +
  "                 text holds: a whole screen is refused at `github attach`\n" +
  "  console-shot   photograph one registered click-through of THIS checkout's console and file its capture\n" +
  "                 receipt: --walk <name> --out <file.png>. Builds the CLI and the console, then runs the\n" +
  "                 console lane's own fixtures — a throwaway store and home holding the synthetic organisation,\n" +
  "                 a headless test browser — so it never reads or shows this installation's state. The one\n" +
  "                 value read here is which local Postgres server to create the throwaway database on\n" +
  "  redact         burn opaque solid rectangles into a captured PNG and write a NEW file with its own\n" +
  "                 receipt, pointing at the parent; frame text a rectangle wholly covers is dropped. Never a\n" +
  "                 blur or an overlay. --form names the source, the out path and the rects. A source with no\n" +
  "                 capture receipt, or one recorded unfit, is refused\n" +
  "  verdicts       read back what the browser-door guard DECIDED — every refusal of a retired\n" +
  "                 Claude-in-Chrome call, plus the history of allows and waivers from before the retirement\n" +
  "  break-glass    record a bounded, expiring waiver journalled against this session. Only a --page grant\n" +
  "                 lifts anything: the read-only rule on that one page. Nothing lifts the Claude-in-Chrome retirement\n" +
  "  --list         profile only: print every profile Chrome knows, with the account signed in to it\n" +
  "  --set <dir>    profile only: record one, by the directory name --list shows (e.g. Default)\n" +
  "  --origin <url> cookies only: the origin to ask about, e.g. https://github.com\n" +
  "  --url <addr>   shot only: the page to photograph. Its own origin is the whole lease — a page that\n" +
  "                 settles elsewhere reports off-lease-origin rather than a picture of a sign-in form\n" +
  "  --out <png>    shot only: where the FINAL picture is written; the whole-page capture it was cut\n" +
  "                 from is kept beside it as <out>.raw.png\n" +
  "  --target <id>  shot only: which closed target to wait for and crop to, adapter:target (today:\n" +
  "                 datadog-logs-v1:timeseries, datadog-apm-traces-v1:timeseries). Inferred from the\n" +
  "                 address when omitted; an address no adapter covers reports unsupported-target\n" +
  "                 rather than a whole-page picture\n" +
  "  --readiness-timeout <ms>\n" +
  "                 shot only: how long to wait for the target to render (default 30000, max 60000)\n" +
  "  --caption <t>  shot only: a first caption line — the claim the picture backs\n" +
  "  --raw          shot only: the diagnostic profile — navigate, sleep --settle, photograph the whole\n" +
  "                 page. Carries no record, so no outbound form will attach the result\n" +
  "  --settle <ms>  shot --raw only: how long to sleep after load (default 2000); refused without --raw\n" +
  "  --limit <n>    verdicts only: how many of the most recent rows to print\n" +
  "  --blocked      verdicts only: only refusals and waived refusals\n" +
  "  --reason <why> break-glass only: why the door could not be used instead. Required, never blank\n" +
  "  --session <id> read/aim/act/scroll/close only: the interaction session to drive, as `open` printed it\n" +
  "  --do <kind>    act only: which interaction to perform\n" +
  "  --target <ref> aim/act only: the element, as a ref out of the last `read` (e42, or f1e42 inside a\n" +
  "                 frame).\n" +
  "                 A CSS selector is refused: a ref that has gone stale fails closed, a selector that\n" +
  "                 matches two elements does not\n" +
  "  --value <text> act only: the text to type, the option to choose, the key to press, the URL to go to,\n" +
  "                 or the absolute path of the file to upload\n" +
  "  --observation <id>  act only: the `read` this action was decided against. Required for anything that\n" +
  "                 can change the page, and refused when the page has moved since\n" +
  "  --download-dir <dir>  act --do download only: where the browser puts downloads (default ~/Downloads)\n" +
  "  --expect-name <file>  act --do download only: the filename to expect. Pass it up front when you know\n" +
  "                 it — a download that comes back ambiguous has already happened, so the correction is to\n" +
  "                 collect the file, never to run the command again\n" +
  "  --expect-focus <ref>  act --do type|press only: the element you say holds the cursor. Required — a\n" +
  "                 keystroke carries no element, so it goes wherever focus is; the page is asked where that\n" +
  "                 actually is and a mismatch is refused before anything is typed\n" +
  "  --page <url>   break-glass only: waive the read-only rail on this ONE page. Without it a grant waives\n" +
  "                 nothing on that rail at all\n" +
  "  --focus        aim only: ALSO put the page's own focus on the target. Opt-in on an aim and DEFAULT on\n" +
  "                 an act: an aim is undoored because it performs no write, and a focus fires the page's\n" +
  "                 own focus and blur handlers, so defaulting it here would make that claim false\n" +
  "  --no-focus     act only: mark the target with the highlight ALONE. Focus is the default:\n" +
  "                 the page draws its own focus ring, so the picture shows the page agreeing the\n" +
  "                 element is reachable, and on a page that reveals an affordance on hover it is the only\n" +
  "                 way the picture shows the thing about to be clicked. It is a REAL interaction — focus\n" +
  "                 fires on the target and blur on whatever held the cursor — so it is never taken on a\n" +
  "                 page the register refuses writes on unless a break-glass waiver names that page, and\n" +
  "                 the receipt says when it was dropped\n" +
  "  --full-page    aim/act only: ALSO photograph the whole scrollable page. The pictures are the viewport\n" +
  "                 by default — what you would see — and a whole-page stitch is both unreadable on a tall\n" +
  "                 page and taken over enough time to catch one mid-render\n" +
  "  --pages <n>    scroll only: how many screens to move (default 1). The walk stops early if the page\n" +
  "                 does not move, which is the end of the document or a scroller that ate the wheel\n" +
  "  --up           scroll only: walk up the page instead of down\n" +
  "  --walk <name>  console-shot only: the registered click-through to photograph (automations-context);\n" +
  "                 console-shot takes --out <file.png> too\n" +
  "  --json         machine-readable output\n" +
  "  --home <dir>   the state home whose store holds the recorded choice\n" +
  "  `pin` WRITES the launcher a browser leg uses, so that leg cannot land in a profile you did not\n" +
  "  record (docs/browser-route/brief-profile-and-walks.md): docs/browser-route.md carries the ruling.\n" +
  "  `shot` DRIVES that relay. A photograph is a read, so a `read-before-write` provider\n" +
  "  (Slack, GitHub, Linear, Notion, Vanta, Datadog) is photographed; only a doored provider registered\n" +
  "  `refuse-every-write` is refused. A provider's own read verb is still the better evidence.";
