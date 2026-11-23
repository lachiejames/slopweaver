/**
 * The usage lines of `slopweaver slack`'s read and helper verbs — alert-summary, canvas, channel, dm, probe, read-file,
 * read-thread, shot, voice-rules and when, with the defaults they quote, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/slack.ts` reads these strings on EVERY invocation, because `--help`, `catalog` and
 * `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command module, a
 * string would put that module and everything it imports on every invocation's load path. The command modules import
 * these from here, never the reverse. Import only other leaves: `src/__tests__/unit/cli/manifestBarrelClosure.test.ts`
 * fails on anything else.
 */

/** The window used when the caller names none. A week is the span the owner asked these summaries over. */
export const DEFAULT_ALERT_WINDOW = "7d";

/**
 * The subject used when the caller names none.
 *
 * Deliberately a neutral word rather than the channel id. `<channel id> 7d — 12 fired…` is a card nobody wants to
 * read, and resolving the channel's real name would cost an extra API call and a seam method this verb does not
 * otherwise need. `--label` is there for when the default is not what you want.
 */
export const DEFAULT_ALERT_LABEL = "Alerts";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_ALERT_SUMMARY_USAGE =
  "usage: slopweaver slack alert-summary --channel <id> [--window 7d] [--label <text>] [--form] [--json]\n" +
  "                                     [--lead <text>] [--intro <json>] [--recommendations <json|->]\n" +
  "                                     [--home <dir>]\n" +
  "  Counts the alert notifications in a channel over a window and emits an alert-summary FORM.\n" +
  "  --channel   the conversation id to read (a DM id works, and is the safe place to try one)\n" +
  `  --window    how far back to read: 90m, 24h, 7d, 2w (default ${DEFAULT_ALERT_WINDOW})\n` +
  `  --label     the card's subject, e.g. the channel's own name (default ${DEFAULT_ALERT_LABEL})\n` +
  // No other verb's flags are named in here, deliberately: `helpTruth` reads every `--token` out of this string
  // and demands THIS parser accept it, so mentioning `slack post --as bot` would advertise a flag this verb has
  // never heard of. The runnable pipe is printed by `alertSummaryLines` instead, where it is output rather than help.
  "  --form      emit ONLY the form JSON, so it can be piped straight into `slack post`\n" +
  "  --json      emit one machine-readable document: the form plus how it was sourced\n" +
  "  --lead      one sentence YOU compose after seeing the counted rows, e.g. from running this once without it\n" +
  "  --intro     a JSON array of 1-4 day-one lines to open the card with, on a scheduled row's first firing\n" +
  '  --recommendations  {"recommendations":[…]}, a path to one, or - : the act that clears each alert that\n' +
  "              fired (its `clears` is a name --json lists under firedNames) and opportunities, below the fold\n" +
  "  Nothing here posts anything, and nothing here runs a model. The counts are pure code; a --lead sentence " +
  "carrying a number the counts cannot account for is dropped, never posted.";

/** The usage block for `slack canvas`. Every flag the parser accepts appears here — the help ratchet reads it. */
export const SLACK_CANVAS_USAGE =
  "usage: slopweaver slack canvas create --title <text> --markdown <file|-> [--channel <id>]\n" +
  "                                      [--as <bot|me>] [--dry-run] [--json] [--home <dir>]\n" +
  "       slopweaver slack canvas replace --canvas <id> --markdown <file|-> [--as <bot|me>]\n" +
  "                                      [--dry-run] [--json] [--home <dir>]\n" +
  "       slopweaver slack canvas delete --canvas <id> [--as <bot|me>] [--dry-run] [--json] [--home <dir>]\n" +
  "  --channel  present  → a canvas attached to that conversation, which everyone in it can read at once.\n" +
  "                        MEASURED: a repeat mints a SECOND document rather than being refused, so the\n" +
  "                        duplicate gate refuses an identical re-run within 24h (override to repeat)\n" +
  "             absent   → a STANDALONE canvas, visible to nobody until access is granted\n" +
  "  --markdown a FILE path, or - for stdin. Never the document itself: a canvas is prose, and a shell\n" +
  "             argument eats backticks, dollars and newlines\n" +
  "  --title    refused past 255 characters, because Slack truncates a long one instead of saying so\n" +
  "  replace    rewrites a canvas's WHOLE body; delete removes it. Both are how a canvas is retracted.";

/** The usage block for `slack channel`. Every flag the parser accepts appears here — the help ratchet reads it. */
export const SLACK_CHANNEL_USAGE =
  "usage: slopweaver slack channel create --name <name> [--as <bot|me>] [--private]\n" +
  "                                       [--purpose <text>] [--topic <text>] [--invite <key,...>]\n" +
  "                                       [--dry-run] [--json] [--home <dir>]\n" +
  "       slopweaver slack channel invite --channel <id> --invite <key,...> [--as <bot|me>] [--dry-run]\n" +
  "                                       [--json] [--home <dir>]\n" +
  "       slopweaver slack channel archive --channel <id> [--as <bot|me>] [--dry-run] [--json] [--home <dir>]\n" +
  "  --as me   (the default) create or invite on YOUR user token — measured as the only lane this install\n" +
  "            can do either on, since the bot token holds neither channels:manage nor groups:write\n" +
  "  --name    REFUSED unless Slack would store it unchanged; the refusal names the canonical form to\n" +
  "            re-run with, because a channel can never be deleted afterwards — only archived\n" +
  "  --invite  identity-map keys, comma separated, resolved by EXACT match before anything is created.\n" +
  "            One unresolvable key refuses the whole create; a person Slack itself then rejects is\n" +
  "            reported by name and does not sink the rest of the batch\n" +
  "  --purpose / --topic  set after the create, each reported as the text SLACK stored (it truncates)\n" +
  "  invite    put people into a channel that ALREADY exists, resolved the same way. Nothing here removes\n" +
  "            anyone: a person invited by mistake is removed by hand in Slack\n" +
  "  archive   the only retraction Slack offers for a channel. The name stays taken.";

/**
 * Slack's own ceiling on a group DM: nine people INCLUDING the opener, so eight others.
 *
 * Checked here rather than left to Slack because the failure it gives back is `too_many_users`, which does
 * not say what the limit is — and the remedy (create a channel instead) is a different verb.
 */
export const SLACK_GROUP_DM_MAX_OTHERS = 8;

/** The usage block for `slack dm`. Every flag the parser accepts appears here — the help ratchet reads it. */
export const SLACK_DM_USAGE =
  "usage: slopweaver slack dm open --with <key,...> [--as <bot|me>] [--dry-run] [--json] [--home <dir>]\n" +
  "  --with    identity-map keys, comma separated, resolved by EXACT match. ONE key opens a 1:1 DM;\n" +
  `            two to ${String(SLACK_GROUP_DM_MAX_OTHERS)} open a group DM. More than that is refused — a channel is the shape for it\n` +
  "  --as bot  (the default) open the conversation the BOT can then post into; --as me opens yours\n" +
  "  Slack resolves one user set to ONE conversation, so this is idempotent: running it twice answers\n" +
  "  the same id and creates nothing the second time. It reports which of those two happened.\n" +
  "  Feed the id it prints to a `slopweaver slack post` send.";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_PROBE_USAGE =
  "usage: slopweaver slack probe --method <name> [k=v ...] [--bot] [--count-field <path>]\n" +
  "                              [--shape-at <path>] [--json] [--home <dir>]\n" +
  "  --method <name>   a dotted Web API method — READ-ONLY, from the probe allowlist (see probePolicy.ts)\n" +
  "  k=v               call arguments, as bare positionals — a value may contain anything but a leading dash\n" +
  "  --bot             use the bot token instead of the user token (default: user)\n" +
  "  --count-field <p> also report a count at one path — an array's length, or a number Slack computed\n" +
  "  --shape-at <p>    also report the field names found at one dotted path, e.g. messages.matches\n" +
  "  --count-where <s> how many array elements carry a field containing a substring, as a fraction:\n" +
  "                    <arrayPath>:<field>~<substring>, e.g. messages.matches:permalink~thread_ts\n" +
  "  --sum-field <s>   the SUM of a numeric field across an array, as <arrayPath>:<field> —\n" +
  "                    e.g. messages:reply_count, how many replies one history page's parents hold\n" +
  "  --exhaust <n>     follow next_cursor for up to n pages, summing --count-field across all of them —\n" +
  "                    the only way to measure a method's RECALL rather than its first page\n" +
  "  --scopes          also report the OAuth scopes the answering token holds, and the ones this method\n" +
  "                    would have accepted — both off Slack's own response_metadata, so a capability\n" +
  "                    question is answered by Slack rather than by a committed manifest\n" +
  "  --expect <p>=<v>  CHECK the value at one dotted path against a value you already hold, reporting\n" +
  "                    matches/differs and never the value itself — how a lane verifies its own work,\n" +
  "                    e.g. --method chat.getPermalink channel=C1 ts=1.2 --expect permalink=<built link>\n" +
  "  --json            emit the shape report as one machine-readable document on stdout\n" +
  "  Reports the response SHAPE — field names, counts, timing — never message bodies. It cannot write.";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_CHANNEL_VIEW_USAGE =
  "usage: slopweaver slack channel-view <channel-id> [--workspace <host>] [--json] [--home <dir>]\n" +
  "  <channel-id>      the conversation to read, C…/G…/D… — the id a /archives/ link carries\n" +
  "  --workspace       the workspace host the link named, e.g. acme.slack.com; the read refuses when the\n" +
  "                    token answers for another workspace, so the same id never draws a different channel\n" +
  "  --json            emit one machine-readable document on stdout, the people it names included\n" +
  "  Reads the channel's newest page LIVE, as Slack desktop would show it, and fetches each picture's\n" +
  "  preview into the private channel-media store — what the console's channel hover window draws.";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_READ_FILE_USAGE =
  "usage: slopweaver slack read-file <F… | file link> [--no-transcript] [--json] [--home <dir>]\n" +
  "  <F… | link>       a Slack file id, or any Slack file/canvas/docs link that carries one.\n" +
  "                    A /archives/ MESSAGE permalink is refused by name — that is `read-thread`\n" +
  "  --no-transcript   read the huddle NOTES only; do not follow huddle_transcript_file_id\n" +
  "  --json            emit one machine-readable document on stdout\n" +
  "  Read-only, and UNREDACTED: a huddle transcript is one person's conversation, so treat the output\n" +
  "  the way `docs/security/slack-huddles.md` treats a huddle, the same as mail — never paste it anywhere the huddle's members are not.";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_READ_THREAD_USAGE =
  "usage: slopweaver slack read-thread <permalink> [--around <n>] [--channel-around <n>] [--since <ts>] " +
  "[--json] [--max-file-mb <n>] [--home <dir>]\n" +
  "  <permalink>       a Slack message link; without a bound, a reply link resolves the whole thread\n" +
  "  --around          return the parent, addressed message, and n neighbouring replies on each side\n" +
  "  --channel-around  add n compact channel-visible messages on each side of the thread parent\n" +
  "                    The visible agent chooses each bound and may widen after reading the residue\n" +
  "  --since           a Slack ts from a previous read; returns only messages posted AFTER it.\n" +
  "                    The whole thread is still fetched — but an edit or deletion above that\n" +
  "                    timestamp is NOT visible in the result. Omit it to read the whole thread\n" +
  "  --json            emit one machine-readable document on stdout\n" +
  "  --max-file-mb     per-attachment size ceiling (default 25); anything larger is reported, not fetched";

/** What `slack shot` advertises. Read by the help/flag ratchet token by token. */
export const SLACK_SHOT_USAGE =
  "usage: slopweaver slack shot <message-permalink> --out <file.png> [--settle <ms>] [--json] [--home <dir>]\n" +
  "  <permalink>  a Slack MESSAGE link (`/archives/<conversation>/p<ts>`). Anything else is refused by\n" +
  "               name — this verb opens one conversation, never the Slack web client at large\n" +
  "  --out        the .png the picture is written to\n" +
  "  --settle     how long the client is given to render before the shot (default 8000, max 60000)\n" +
  "  --json       emit one machine-readable report on stdout\n" +
  "  The picture is of that conversation at its NEWEST messages, so photograph a message just after\n" +
  "  posting it — this verb takes no scroll and an older message is simply not in frame.\n" +
  "  Taken in YOUR OWN Chrome through the Playwright extension relay, navigate-and-photograph only — no\n" +
  "  click, no typing, no page script. It answers the one question no Slack API can: does this message\n" +
  "  RENDER folded? It answers it for ONE layout, the window the relay opened.";

/** What `slack saved` advertises. Read by the help/flag ratchet token by token. */
export const SLACK_SAVED_USAGE =
  "usage: slopweaver slack saved [--json] [--settle <ms>] [--home <dir>]\n" +
  "  Reads YOUR OWN Slack Later (saved-for-later) list: opens Later in your own Chrome through the\n" +
  "  Playwright relay and keeps the one `saved.list` response the client fetches for itself. No published\n" +
  "  API reads Later (`stars.list` returns starred channels only).\n" +
  "  --settle  how long the client is given to load the list (default 8000, max 60000)\n" +
  "  --json    emit one machine-readable report on stdout\n" +
  "  Prints pointers — conversation, ts, state, due date and a permalink — never message text; read one\n" +
  "  with `slack read-thread <permalink>`. It takes no screenshot, clicks nothing, follows no cursor and\n" +
  "  never changes an item, so a list longer than the client's first load is reported as a GAP.";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_VOICE_RULES_USAGE =
  "usage: slopweaver slack voice-rules [--json] [--check-stdin [--slack-draft]] [--home <dir>]\n" +
  "  Prints the operator's CURRENT voice brief before any freeform as-me draft is written: the ADVISORY\n" +
  "  response shape (the body of the memory slackMe.voice.shapeMemoryFile points at) first, then the\n" +
  "  ENFORCED bans — every exact literal/word/phrase (slackMe.voice.exact) verbatim, plus the\n" +
  "  paragraph-spacing rule (slackMe.voice.paragraphSpacing) when it is on. Posts and sends nothing; it\n" +
  "  writes this visible session's receipt for the brief it printed (a digest, never a word of it), which\n" +
  "  every slack draft, post, reply, edit or correct in the owner's name requires — a session without\n" +
  "  one is refused with the brief printed. Run it BEFORE drafting on that lane.\n" +
  '  --json  emit {"enforcement":{...},"paragraphSpacing":...,"rules":[...],"shape":...} as one document —\n' +
  "          `enforcement` says which of the three the send door refuses on and which is only advice\n" +
  "  --check-stdin  judge the message on stdin against the as-me exact rules instead, printing\n" +
  '                 {"kind":"accepted"} or {"kind":"refused","reasons":[...]}; the message is never printed.\n' +
  "                 The talk console's running list asks this before an offer reaches them\n" +
  "  --slack-draft  with --check-stdin: the message is one they post in Slack as themselves, so it must also\n" +
  "                 keep the shape a parked as-me Slack draft keeps (caps, and a paragraph that asks\n" +
  "                 ends on its ask), and no one paragraph past 70 words, which the parked shape does\n" +
  "                 not check; each broken rule is a reason naming counts, never the message\n" +
  "  With nothing configured, prints that plainly rather than an empty document. A configured shape file\n" +
  "  that is missing, unreadable or not a valid memory EXITS 1 and prints no brief at all, rather than a\n" +
  "  partial one that would read as 'this operator has no rules'.";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_WHEN_USAGE =
  "usage: slopweaver slack when <ts-or-permalink> [<ts-or-permalink> ...] [--json]\n" +
  "  <ts-or-permalink> a Slack `ts` (1788220579.306599) or any permalink containing one\n" +
  "  --json            emit one machine-readable document on stdout, for a writer to consume\n" +
  "  Derives the instant a Slack timestamp names. NEVER convert one by hand: a run that did was 80\n" +
  "  minutes out, and the wrong instant reached a board row, two cron schedules and two deadman rules.";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_OWED_USAGE =
  "usage: slopweaver slack owed [--json] [--write] [--now <iso>] [--home <dir>]\n" +
  "  --json          emit exactly one machine-readable document on stdout\n" +
  "  --write         atomically replace $SLOPWEAVER_HOME/live/slack/owed.json with the same document;\n" +
  "                  without it the verb writes nothing at all\n" +
  "  --now <iso>     freeze the instant the 14-day window ends at (default: the clock)\n" +
  "  --home <dir>    the state home to read the corpus from and write into\n" +
  "  Lists the Slack threads you spoke in during the last 14 days whose last word is a person's, not\n" +
  "  yours: ADDRESSED (a DM, or a message naming you) or AMBIENT, when you last spoke, and the permalink.\n" +
  "  Reads the LOCAL corpus only, nothing live; always prints its residue. It never drafts, posts or\n" +
  "  sends. Exit 1 when the read could not see (no owner id, an unreadable file) — never an empty all-clear.";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_AWAITING_USAGE =
  "usage: slopweaver slack awaiting [--json] [--write] [--now <iso>] [--home <dir>]\n" +
  "  --json          emit exactly one machine-readable document on stdout\n" +
  "  --write         atomically replace $SLOPWEAVER_HOME/live/slack/awaiting.json with the same document;\n" +
  "                  without it the verb writes nothing at all\n" +
  "  --now <iso>     freeze the instant the 14-day window and the business-day clock end at (default: the clock)\n" +
  "  --home <dir>    the state home to read the corpus from and write into\n" +
  "  Lists the Slack threads you spoke in during the last 14 days whose last word from a PERSON is yours,\n" +
  "  whose messages since asked something or tagged somebody, and that have had no reply for two business\n" +
  "  days or more: how long it has been quiet, your last message, the people in the thread, the permalink.\n" +
  "  Direct messages are counted, not judged. Reads the LOCAL corpus only; always prints its residue. It\n" +
  "  never drafts, posts or sends — the thread-chase seat parks each chase for your yes. Exit 1 when the\n" +
  "  read could not see or lost lines — never an empty all-clear.";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const SLACK_FINDING_FOLLOWUPS_USAGE =
  "usage: slopweaver slack finding-followups [--json] [--write] [--now <iso>] [--home <dir>]\n" +
  "  --json          emit exactly one machine-readable document on stdout\n" +
  "  --write         atomically replace $SLOPWEAVER_HOME/live/slack/finding-followups.json with the same\n" +
  "                  document; without it the verb writes nothing at all\n" +
  "  --now <iso>     freeze the instant the 14-day window and the business-day clock end at (default: the clock)\n" +
  "  --home <dir>    the state home to read the draft register and the corpus from and write into\n" +
  "  Lists the team-facing findings you shared (released `kind: finding` drafts, the last 14 days) still\n" +
  '  owed their ONE follow-up card: no reply for a full business day, only an untimed "looking into it" with\n' +
  "  nothing after it for a business day, or a reply claiming a fix (at once). Reads the register and the\n" +
  "  LOCAL corpus only; always prints its residue. It never drafts, posts or sends, and never decides a fix\n" +
  "  is deployed — the thread-chase seat parks each card with `slack draft record` for your yes. Exit 1 when the\n" +
  "  read could not see or lost lines — never an empty all-clear.";
