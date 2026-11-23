/**
 * Every `slopweaver slack` usage block the manifest names and no `*Core.ts` already owns, and nothing else.
 *
 * A LEAF, the shape `listen/listenUsage.ts` set for the same reason: `cli/manifests/slack.ts` is enumerated
 * by `--help`, `catalog` and `discoverCommands` on invocations dispatching none of these verbs, so a usage
 * string it reaches through a command module drags that module's Slack client onto every unrelated
 * command's load path (`.claude/rules/area-cli.md` § "Metadata is eager, the run function is lazy").
 * `SLACK_DRAFT_USAGE` lives here rather than in `draftCore.ts` for exactly that reason, and the five write
 * blocks moved out of the manifest itself, which the file-size ratchet had taken past its cap.
 *
 * Keep it importing nothing. A string that needs a value from elsewhere belongs where that value is.
 */

/**
 * What a release does just before it sends, shared by `post` and `reply` because both release a row the same way
 * (`../../../outbound/slack/releaseFreshness.ts`). Owner rulings: an approval never
 * expires by age, and a release the thread has made unnecessary becomes thanks and closes the row.
 */
const RELEASE_RE_READ_LINES =
  "  Before a release sends it RE-READS the conversation since the row's own read: a message a person\n" +
  "            added, edited or removed refuses it, printing that ts set. Approval never expires by age; the\n" +
  "            re-read looks for a material change, never a fresh approval. Read what moved, then pick one:\n" +
  "  --thread-moved-cleared  send it as is: the exact ts set the refusal printed, which you read and judged\n" +
  "            not to change the message. A newer reply than the set refuses again.\n" +
  "  --thanks-instead  an --as me row only: it is no longer needed, so send ONE thanks line in its place\n" +
  "            and close the row. It re-reads too: name the set you judged with --thread-moved-cleared.\n" +
  "            Withdraw a bot row with `slack draft drop`.\n";

/**
 * `post` and `reply` each get their OWN usage, for the same reason the lifecycle verbs do.
 *
 * They share one parser and one flag spec, but not one CONTRACT: `post` REFUSES `--thread-ts` ("use `slack
 * reply`") and `reply --as me` REFUSES `--shape` (every message goes into the thread you named). A single
 * block advertised both flags to both verbs, so half of what it promised each verb was refused on use.
 * Neither string may name the other's flag — the help/flag ratchet reads these token by token.
 */
export const POST_USAGE =
  "usage: slopweaver slack post --as <bot|me> --channel <id> (--form <json|-> | --body <text|->)\n" +
  "       [--shape top-level|thread] [--media a.png,b.pdf] [--resend-unconfirmed]\n" +
  "       [--idempotency-key <key>] [--no-picture-because <why>]\n" +
  "       [--dm-purpose <purpose>]\n" +
  "       [--allow-unresolved-owner] [--dry-run] [--json] [--home <dir>]\n" +
  "       slopweaver slack post --as <me|bot> --draft <id> --approve <digest> [--form <json|->]\n" +
  "       [--thread-moved-cleared <ts,...>] [--thanks-instead <line>]\n" +
  "       [--resend-unconfirmed] [--dry-run] [--json] [--home <dir>]\n" +
  '  --as bot  a schema-enforced CARD ({"kind":"update"}, detail behind a Details label) or a NO-FOLD\n' +
  '            message ({"kind":"no-fold"}, everything visible, no attachment wrapper, no media);\n' +
  "            --form only, and --media rides on the card\n" +
  "  --as me   your own name, in one of three --form shapes. A PUBLIC top-level post is ONE message and a\n" +
  '            multi-message drip there is REFUSED: a discussion piece is {"kind":"one-card"}, whose lines\n' +
  '            carry the breaks, and a roster or batch ask is {"kind":"one-list"}, a lead line, Slack\'s own\n' +
  "            single-spaced bullets and the lines that close them. A thread is a freeform DRIP\n" +
  '            ({"kind":"drip"}, several short messages, no card).\n' +
  "            --shape is REQUIRED and has no default; --body is the raw escape hatch; --media uploads on\n" +
  "            your USER token and attaches under the LAST message sent\n" +
  "  --allow-unresolved-owner  BOT lane only: post a digest whose owner ping cannot resolve, as plain text\n" +
  "            and NOBODY notified. Off by default: the send refuses instead, because a degraded ping used\n" +
  "            to leave only a stderr warning and exit 0.\n" +
  "  --resend-unconfirmed  BOTH lanes: send again a message an earlier run reserved but never confirmed,\n" +
  "            after YOU have read the target and seen it is not there. A send Slack itself refused releases\n" +
  "            its own reservation, so this is for a lost response, never for a refused call.\n" +
  "  --idempotency-key  BOT lane: this DELIVERY's own id, which REPLACES the message content in the\n" +
  "            duplicate key — for a caller that can name the thing being delivered once, such as a\n" +
  "            scheduled recipe firing. A second delivery under the same key is HELD, not warned, and\n" +
  "            there is deliberately no override: nobody is watching a scheduled send.\n" +
  '  --no-picture-because  BOT lane: a composed ({"kind":"update"}) card naming three or more things\n' +
  '            with no picture is HELD once on "which of these would a picture show better than text?"\n' +
  "            Attach that picture with --media, or give the reason none adds value here; it is recorded\n" +
  "            on the send's door-ledger row. Derived and scheduled cards are never asked.\n" +
  "  --dm-purpose  BOT lane: what a post to the owner's DM is FOR — investigation-finding, dogfood-case\n" +
  "            or asked-for. A post aimed at slackBot.ownerUserId or promptChannel (either one, trimmed) without\n" +
  "            one is HELD, with no override; a run blocked on them belongs on the Queue page, never posted.\n" +
  "  --media   a PICTURE is admitted against the visual-evidence store first; a PDF, office file, gzip,\n" +
  "            text deliverable or MP4/QuickTime video carries no such claim and uploads with nothing asked\n" +
  "            of it. Bytes that are neither are REFUSED — a WebP, AVIF, HEIC or SVG is a picture this build\n" +
  "            cannot decode, and waving one through would route around the record store; a WebM is not yet\n" +
  "            a video this build identifies. Judged by BYTES, not extension — bar one: an HTML briefing is\n" +
  "            carried when it is named .html, opens on <!doctype html> or <html>, and holds no <svg or <script.\n" +
  "  Authored prose is checked against the operator's exact voice rules BEFORE any network call and the\n" +
  "            send REFUSES on a match; a `slopweaver hatch open voice-rules` grant sends it unchanged.\n" +
  "  --draft   RELEASE a parked draft (`slack draft`) under the --as it was recorded as — another is refused, and\n" +
  "            so is an as-me finding at the top level of a channel, which posts as the bot.\n" +
  "            A bot row is re-rendered and re-checked through the whole card lane. The channel, shape and\n" +
  "            words come from the row,\n" +
  "            so --channel/--shape/--body/--media are refused. --approve must be the digest `slack draft\n" +
  "            show` prints, and the words re-prepared now must digest to it too, or nothing is sent. --form\n" +
  "            supplies the words for a row recorded from stdin before the register kept them. A release\n" +
  "            into a direct message needs no untagged-bump hatch; a landed release marks the row released.\n" +
  "            A row's attachments are the bytes stored when it was recorded, re-verified by SHA-256 before\n" +
  "            anything is prepared and sent as verified; a missing or changed one refuses the release.\n" +
  "            A THREAD-reply draft is REFUSED here, and so is a top-level one whose why says thread reply:\n" +
  "            `post` would land it in the channel. `slack reply --draft` sends a thread draft\n" +
  RELEASE_RE_READ_LINES +
  "  `post` starts a new message; to answer inside an existing thread use `slopweaver slack reply`.";

export const REPLY_USAGE =
  "usage: slopweaver slack reply --as <bot|me> --channel <id> --thread-ts <ts>\n" +
  "       (--form <json|-> | --body <text|->) [--media a.png,b.pdf] [--resend-unconfirmed]\n" +
  "       [--idempotency-key <key>] [--no-picture-because <why>]\n" +
  "       [--dm-purpose <purpose>]\n" +
  "       [--allow-unresolved-owner] [--dry-run] [--json] [--home <dir>]\n" +
  "       slopweaver slack reply --as <me|bot> --draft <id> --approve <digest> [--form <json|->]\n" +
  "       [--thread-moved-cleared <ts,...>] [--thanks-instead <line>]\n" +
  "       [--resend-unconfirmed] [--dry-run] [--json] [--home <dir>]\n" +
  "  --as bot  a schema-enforced CARD posted into the thread; --form only, and --media rides on the card\n" +
  "  --as me   a freeform DRIP under your own name; --form is a sectioned drip and --body the raw escape\n" +
  "            hatch. Every message goes into the thread you named, so a reply takes no shape flag at all\n" +
  "  --allow-unresolved-owner  BOT lane only: send a digest whose owner ping cannot resolve, as plain\n" +
  "            text and NOBODY notified. Off by default — the send refuses instead.\n" +
  "  --resend-unconfirmed  BOTH lanes: send again a message an earlier run reserved but never confirmed,\n" +
  "            after YOU have read the thread and seen it is not there. A send Slack itself refused releases\n" +
  "            its own reservation, so this is for a lost response, never for a refused call.\n" +
  "  --idempotency-key  BOT lane: this DELIVERY's own id, which REPLACES the message content in the\n" +
  "            duplicate key — for a caller that can name the thing being delivered once, such as a\n" +
  "            scheduled recipe firing. A second delivery under the same key is HELD, not warned, and\n" +
  "            there is deliberately no override: nobody is watching a scheduled send.\n" +
  '  --no-picture-because  BOT lane: a composed ({"kind":"update"}) card naming three or more things\n' +
  '            with no picture is HELD once on "which of these would a picture show better than text?"\n' +
  "            Attach that picture with --media, or give the reason none adds value here; it is recorded\n" +
  "            on the send's door-ledger row. Derived and scheduled cards are never asked.\n" +
  "  --dm-purpose  BOT lane: what a post to the owner's DM is FOR — investigation-finding, dogfood-case\n" +
  "            or asked-for. A post aimed at slackBot.ownerUserId or promptChannel (either one, trimmed) without\n" +
  "            one is HELD, with no override; a run blocked on them belongs on the Queue page, never posted.\n" +
  "  --draft   RELEASE a parked THREAD-reply draft (`slack draft record --thread-ts`) into the thread its row\n" +
  "            names; --channel/--thread-ts come from the row and are refused. --approve must be the digest\n" +
  "            `slack draft show` prints, which binds the thread. A top-level draft is refused: `slack post`\n" +
  RELEASE_RE_READ_LINES +
  "  Authored prose is checked against the operator's exact voice rules BEFORE any network call and the\n" +
  "  send REFUSES on a match; a `slopweaver hatch open voice-rules` grant sends it unchanged.";

/**
 * `edit` and `delete` each get their OWN usage, and that split is the fix rather than tidiness.
 *
 * One shared block cannot be true of either of them: it advertised `--form` to `delete`, which
 * refuses it — while naming none of `edit`'s `--as`,
 * `--body`, `--dry-run`, `--json` or `--home`. That omission is what hid the as-me edit lane: a session read
 * this help twice, concluded there was no way to edit a message under the owner's own name, and started
 * building the path that already existed. The help/flag ratchet now compares each of these against the flag
 * spec its parser tokenises with, so a flag added without a line here fails `yarn validate`.
 */
export const EDIT_USAGE =
  "usage: slopweaver slack edit --channel <id> --ts <ts> [--as <bot|me>] (--form <json|-> | --body <text|->)\n" +
  "       [--allow-unresolved-owner] [--dry-run] [--json] [--home <dir>]\n" +
  "  --as bot  (the default when --as is absent) re-render one of this bot's messages from a new --form of\n" +
  '            its own kind: a card form, `"kind": "answer"`, `"kind": "checklist"` (a turn card) or\n' +
  '            `"kind": "poll"` (question and reason only; the ballot is frozen). A progress message or a\n' +
  "            notice has no renderer: `slack delete` it instead.\n" +
  "  --as me   replace ONE message you posted, from --form (a single-message drip) or --body raw text.\n" +
  "            A drip of N messages is NOT editable; --allow-unresolved-owner is a bot-lane flag and is\n" +
  "            refused here, as --body is refused on the bot lane.\n" +
  "  Only a message the SAME identity posted can be edited. On the bot lane this program checks the\n" +
  "  card's own metadata; on --as me it runs no check of its own, because chat.update on a user token\n" +
  "  only ever succeeds against that identity's own message — Slack is the boundary, which is what the\n" +
  '  dry run means by "no ownership check".\n' +
  "  Authored prose is checked against the exact voice rules first, and the edit REFUSES on a match.";

/**
 * `correct`'s usage — the in-place correction a later re-read owes a claim newer evidence contradicts. Its own verb
 * because it rewrites the STORED message rather than re-rendering a new form (`./correctArgs.ts`).
 */
export const CORRECT_USAGE =
  "usage: slopweaver slack correct --channel <id> --ts <ts> --wrong <exact words> --correction <line>\n" +
  "       [--as <bot|me>] [--magnitude-seen <anchor>] [--urgent --notify-draft <id>] [--dry-run] [--json]\n" +
  "       [--home <dir>]\n" +
  "  Strikes --wrong where the message says it, once, and puts a bold Correction: line directly under it.\n" +
  "  Every other word, the media and the metadata stay. Only a message Slopweaver sent; never a delete,\n" +
  "  never a bare reply. It rides the original send's approval, then reads the message back.\n" +
  "  --as bot  (the default) a card or answer this bot posted, proven by its bot_id and metadata\n" +
  "  --as me   a message sent under YOUR name, edited with your token, proven by its released row in the\n" +
  "            as-me draft register (`slack draft`). A message you typed yourself has none and is refused.\n" +
  "  --magnitude-seen  a figure moved by an ORDER OF MAGNITUDE (10 to 300, 0 to 12) is held for them\n" +
  "            first, as a Queue question; this names where they answered. Same order (10 to 30) needs none.\n" +
  "  --urgent  the readers acted on it: also name --notify-draft, a DM already parked with `slack draft\n" +
  "            record` for their yes. This verb checks that row is held and never sends a DM itself.";

export const DELETE_USAGE =
  "usage: slopweaver slack delete --channel <id> --ts <ts> [--as <bot|me>] [--dry-run] [--json] [--home <dir>]\n" +
  "  --as bot  (the default) remove a card slopweaver posted; --as me removes a message YOU posted\n" +
  "  Only a message the SAME identity posted can be deleted. On the bot lane this program checks the\n" +
  "  card's own metadata; on --as me it runs no check of its own, because chat.delete on a user token\n" +
  "  only ever succeeds against that identity's own message — Slack is the boundary, which is what the\n" +
  '  dry run means by "no ownership check".';

/**
 * The POLL verb's usage. Votes are reactions because slopweaver has no inbound anything — no server, no
 * socket mode, no events listener — so Block Kit buttons could never be received. Stated here because it is
 * the first question anyone asks about a poll that has no buttons.
 */
export const POLL_USAGE =
  "usage: slopweaver slack poll --as bot --channel <id> --form <json|-> [--dry-run] [--json] [--home <dir>]\n" +
  "       slopweaver slack poll results --channel <id> --ts <ts> [--poll-id <id>] [--json] [--home <dir>]\n" +
  "  Votes are REACTIONS: each option is labelled with a keycap emoji and people react to vote.\n" +
  "  `results` reads the votes out of the LOCAL corpus and states which capture they came from.";

/** The usage block. Every flag the parser accepts appears here — the help/flag ratchet reads it token by token. */
export const SLACK_DRAFT_USAGE =
  "usage: slopweaver slack draft record --channel <id> --form <json|-> --why <text> [--as <me|bot>]\n" +
  "                                     [--kind <finding|message>] [--act <reply|bump|review-ask>]\n" +
  "                                     [--row <slug>] [--followup-of <finding id>] [--thread-ts <ts>]\n" +
  "                                     [--media a.mp4,b.png]\n" +
  "                                     [--supersedes <id,...>] [--reviewer <new|in-thread|not-an-ask>]\n" +
  "                                     [--asked-before <none|permalink> [--changed <text>\n" +
  "                                     --changed-media a.png,... | --not-answered <text>]]\n" +
  "                                     [--approved <anchor> | --meaning-changed <text>]\n" +
  "                                     [--self-evident <why> | --tried <what>]\n" +
  "                                     [--impact <how many people, then what happened>]\n" +
  "                                     [--json] [--home <dir>]\n" +
  "       slopweaver slack draft list [--all] [--json] [--home <dir>]\n" +
  "       slopweaver slack draft show <id|--id <id>> [--json] [--home <dir>]\n" +
  "       slopweaver slack draft context <id|--id <id>> [--json] [--home <dir>]\n" +
  "       slopweaver slack draft approve <id|--id <id>> --anchor <anchor> [--variant <original|codex>]\n" +
  "                                    [--home <dir>]\n" +
  "       slopweaver slack draft pick <id|--id <id>> --variant <original|codex> [--anchor <anchor>]\n" +
  "                                 [--home <dir>]\n" +
  "       slopweaver slack draft compare <id|--id <id>> [--home <dir>]\n" +
  "       slopweaver slack draft revise <id|--id <id>> --text <words|-> [--heard <text>]\n" +
  "                                   [--reading <json array>] [--anchor <anchor>] [--json] [--home <dir>]\n" +
  "       slopweaver slack draft restore <id|--id <id>> --version <n> [--heard <text>]\n" +
  "                                    [--reading <json array>] [--anchor <anchor>] [--json] [--home <dir>]\n" +
  "       slopweaver slack draft hold <id|--id <id>>\n" +
  "                                 --reason <not-owner-yes|meaning-changed|thread-moved|no-fleet-slot|slack-refused>\n" +
  "                                 --why <text> [--home <dir>]\n" +
  "       slopweaver slack draft drop <id|--id <id>> --note <text> [--home <dir>]\n" +
  "       slopweaver slack draft corrections [--json] [--home <dir>]\n" +
  "  record  compose a message AS YOU, run every as-me check that does not need the ability to post, and\n" +
  "          PARK it. Nothing reaches Slack: its reads are the channel's own info and auth.test, which\n" +
  "          the checks already need, the thread root for --thread-ts, and each pull request a bump or\n" +
  "          review-ask links (see --act). A multi-message drip is refused\n" +
  "          — a parked draft is ONE message, the only shape the console can show them whole. A message as\n" +
  "          you to the bot in your bot DM (slackBot.promptChannel) — top-level, or a reply under\n" +
  "          your own root there — is REFUSED, naming the direct send: it is dogfooding, sent by the seat\n" +
  "          that needs it, never a card. Once a new as-me row parks with no approval\n" +
  "          and no media, one sealed Codex pass (read-only, no network) drafts the same message blind to\n" +
  "          yours, from the conversation and their voice brief, and it sits beside yours on the Queue card for\n" +
  "          them to pick; a row a Codex session composed gets none. Its progress goes to\n" +
  "          stderr, and the exit is the park's\n" +
  "  --as    me (the default) or bot. `--as bot` parks a bot CARD from a bot form, checked as `slack post\n" +
  "          --as bot` checks one, and needs the bot in a private channel. A finding shared at the top level\n" +
  "          of a channel is the bot's: as me it parks only in a private channel Slack,\n" +
  "          asked under the bot token, says the bot is not in, and a DM or thread reply stays yours\n" +
  "  --kind  finding or message: what the row is. REQUIRED for a top-level row as me outside a DM; a\n" +
  "          thread reply or DM may omit it, where the finding rule never applies\n" +
  "  --act   reply, bump or review-ask: what the message DOES, the Queue card's badge. A thread chase is a\n" +
  "          bump, a first ask for a review a review-ask. Display only, outside the digest; a row without it\n" +
  "          draws no badge, never one guessed from --why. A bump or review-ask reads every GitHub pull\n" +
  "          request it links, live, and is REFUSED when one is closed, merged, missing or unread (a chase on a finished pull request spends the team's attention for nothing)\n" +
  "  --row   the board row that raised the draft, as its slug. Refused unless a handover doc, live or\n" +
  "          archived, holds it. The Queue card shows that row's tags, its workstream first. Display only,\n" +
  "          outside the digest\n" +
  "  --followup-of  the released finding this bump follows up, by draft id (`slack finding-followups`).\n" +
  "          It must be --act bump into that finding's own thread, and it is REFUSED once any other row names\n" +
  "          the finding, held, sent or dropped: one follow-up card per finding. Outside the digest\n" +
  "  --thread-ts  the ROOT ts of the thread this replies under. The row becomes a thread reply that only\n" +
  "          `slack reply` releases, and the digest binds the thread. The root is read first: a ts\n" +
  "          that is no message here, or is a reply rather than the root, parks nothing. One thread's replies\n" +
  "          are ONE card: a reply into a thread already holding one under the same\n" +
  "          identity is REFUSED unless --supersedes names every held reply there — compose one merged reply\n" +
  "          in their voice\n" +
  "  --why   one line saying what the draft is for, so a row in the list reads without opening it. A why\n" +
  "          saying thread reply with no --thread-ts is REFUSED: it would park top-level\n" +
  "  --media files to attach under the message, admitted exactly as `slack post --media` admits them, then\n" +
  "          kept as BYTES in the owner-only draft-media store; the digest binds each one's name, size and\n" +
  "          SHA-256, so a release sends what was recorded, never what sits at the path later\n" +
  "  --supersedes  the HELD drafts this one re-cuts, comma-separated: each is dropped the moment this one\n" +
  "          parks, so no older cut can ever be sent. A target already released or dropped is refused, naming\n" +
  "          where it went. A re-cut of ONE approved row carries their approval; a merge carrying one is refused\n" +
  "  --approved  where they already said yes to these words' CONTENT, as a handover anchor\n" +
  "          (talk:<turn>, talk-call:<call>#<segment>, transcript:<session>#<uuid>). Resolved to their own words,\n" +
  "          else nothing parks. Their yes is the SEND: the next chair pass releases the row, never re-parks it,\n" +
  "          and a mechanical fix (em-dash, drip split, wrong tag, lowercase, link) never asks again. Outside the digest\n" +
  "  --meaning-changed  what changed since their yes to the row --supersedes names: the words mean something\n" +
  "          else, or the thread moved materially. The row carries no approval and waits for their word again.\n" +
  "          A re-cut of a row whose change still waits on their word must re-declare it, or pass --approved\n" +
  "  --self-evident  why a card with no link and no file needs no receipt. A card carrying a link in its\n" +
  "          words or a --media file has its receipts DERIVED and declares neither; one carrying none parks\n" +
  "          only with this or --tried, else it is refused (a claim without its receipts\n" +
  "          never reaches them). Refused on a re-cut of a row they sent back for its receipts. A bump owes none\n" +
  "  --tried what was tried for the receipt the card lacks, and why it failed. The Queue card leads with it.\n" +
  "          Beside a link or file it rides as what is still missing. Outside the digest\n" +
  '  --impact  who the finding hits, leading with how many people ("2,480 customers saw a failed checkout").\n' +
  "          A row raising a finding (--kind finding, or a form declaring a possible problem) parks only with a\n" +
  "          --media screenshot, a link in its words and this, its count in the message's FIRST line; a bot\n" +
  "          finding card's measured blast radius stands in for it. --tried and --self-evident do not answer it\n" +
  "          and there is no hatch (a finding without them is sent back unseen). A held\n" +
  "          row lacking any of it lists as no-proof, the Queue draws no card for it and no release sends it.\n" +
  "          Outside the digest\n" +
  "  --reviewer  new, in-thread or not-an-ask: whether the person a DM review ask goes to was in the\n" +
  "          conversation the work came from. REQUIRED on a DM review ask; `new` refuses an ask that opens on\n" +
  "          the ask rather than on the work the change follows; `not-an-ask` for a DM\n" +
  "          whose wording reads as a review ask but asks nobody for one\n" +
  "  --asked-before  none, or the Slack link of OUR earlier message asking the same thing. REQUIRED when the\n" +
  "          draft asks a question (an answered question is not asked again with nothing\n" +
  "          shown). A link is read live: a reply by anybody else after ours makes it ANSWERED, and it parks\n" +
  '          only with --changed "<what>" plus --changed-media <png,...> (at least one picture, bound into the\n' +
  '          digest), or --not-answered "<why the replies were no answer>". The Queue card shows our message,\n' +
  "          their answer and the proof; a release re-reads it and refuses on an answer since. No hatch\n" +
  "  show   prints the exact bytes a release would post, each attachment, and the digest their approval binds\n" +
  "  context reads the conversation the draft lands in LIVE, on your token: a reply's whole thread, or a post's\n" +
  "          channel tail (its newest top-level messages), every author and mention named off member bronze.\n" +
  "          Attachments are counted, never downloaded. The queue card draws it above the draft\n" +
  "  approve binds their yes at --anchor (the same anchors as --approved, a card landing's call:<call>#<turn>\n" +
  "          too) to a row already HELD, with no re-cut. Resolved to their own whole words, else nothing is\n" +
  "          recorded; whether they MEAN yes is yours to judge. A relay that ruled anything but send-it, an\n" +
  "          unruled relay or landing whose words carry no yes (or a yes beside a take-back), or a relay or\n" +
  "          landing about another card, is REFUSED. The row then owes a send: the receipt prints\n" +
  "          the release command, and the chair's pass refuses to close while it is unsent. A row with\n" +
  "          Codex's draft ready beside it and no pick is REFUSED without --variant, which records their pick\n" +
  "          and the approval together\n" +
  "  pick    records which draft they chose on a row carrying Codex's beside the original, once: codex makes\n" +
  "          Codex's the row's words and digest, original keeps yours. Refused on an approved row. --anchor\n" +
  "          keeps their words choosing it. A release of a row whose pick is owed is refused. Codex's draft is\n" +
  "          REFUSED when it drops the link the original brings as its receipt: re-cut it with the link\n" +
  "  compare runs the Codex pass again on a row still waiting for one: recorded before a pass finished, or a\n" +
  "          pass no Codex seat could take. A ready or refused comparison is final\n" +
  "  revise  rewrites a held as-me row's words in place, every earlier version kept (the\n" +
  "          console voice edits the draft on the card they have open). --text is the whole message as `list\n" +
  "          --json` prints it in editableText: one line per card line, `- ` dot points, a blank line between\n" +
  "          drip messages, <url|label>, <@person>, `code` and *bold*. Admitted as a Codex draft is, plus the\n" +
  "          PR-lead check; body only: destination, identity, thread, files and prior-ask proof stay, a tag\n" +
  "          may be dropped never added, and dropping the receipt link is refused. --heard and --reading (their\n" +
  "          words, the voice's checklist of them) ride on the card. Refused on an approved row, a bot row, or\n" +
  "          one whose pick is owed. Never sends; the new words wait for their yes\n" +
  "  restore puts version --version back as a new version, the history kept. Same refusals as revise\n" +
  "  hold    says why a held row carrying their words is NOT sent now, and the Queue card prints it to them:\n" +
  "          not-owner-yes (the words that landed on its card are not a yes to it) and meaning-changed set an\n" +
  "          approval down; thread-moved, no-fleet-slot and slack-refused keep it, a row approved but blocked.\n" +
  "          A settled yes sticks: not-owner-yes on an approved row is refused unless a newer word of theirs landed\n" +
  "          on its card since, unjudged (an approved card is not re-asked).\n" +
  "          A release Slack refuses records slack-refused itself (legitimate reasons not\n" +
  "          to send exist, and are surfaced, never swallowed)\n" +
  "  drop    resolves a draft without sending it; the row stays in the log, only its state changes\n" +
  "  corrections  every correction they made to a draft as them, one kind at a time (voice rule, who it tags,\n" +
  "          what it attaches, where it goes, shorter, reworded, withheld), each at its own instant, with\n" +
  "          every release they gave as the reviewed baseline. Read off this register, their voice rules and the\n" +
  "          words relayed on a draft's card; the Alignment page draws its releases under the steers chart\n" +
  "  release is NOT here: `slopweaver slack post` sends a top-level one and `slopweaver slack reply` a\n" +
  "          thread one, under the row's own identity, through the door; `show` prints that exact command, with\n" +
  "          this draft's id and digest filled in, for a held draft. A release that lands journals its\n" +
  "          permalink and drops every other held cut of the same message; one whose digest a released row\n" +
  "          already carries is refused, naming where that one landed.";
