/**
 * Flag specs, usage text and the shared parse for the `hand` noun. Pure: no I/O, no clock.
 *
 * Kept apart from the verb modules so the help-truth ratchet can read a flag list without importing a
 * command, exactly as `../autonomy/core.ts` does.
 */
import { handStepKindsPhrase } from "../../../hand/handKinds.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/** argv positions before a verb's own arguments: `node`, `index.js`, `hand`, `<verb>`. */
export const VERB_ARG_OFFSET = 4;

const POST_FLAGS: FlagSpec = {
  boolean: ["json", "quiet", "check-in", "blocks", "standalone"],
  string: [
    "id",
    "row",
    "supersedes",
    "what",
    "literal",
    "checklist",
    "where",
    "url",
    "open",
    "opened",
    "no-address",
    "cites",
    "unblocks",
    "if-ignored",
    "witness",
    "context",
    "by-session",
    "posted-iso",
    "shot",
    "box",
    "recheck",
    "read-owner-words",
    "home",
  ],
  repeatable: ["box"],
};

const RECHECK_FLAGS: FlagSpec = { boolean: ["json", "dry-run"], string: ["by-session", "home"] };

const LIST_FLAGS: FlagSpec = { boolean: ["json", "ranked", "gaps"], string: ["by-session", "home"] };

const SHOW_FLAGS: FlagSpec = { boolean: ["json"], string: ["by-session", "home"] };

const SNOOZE_FLAGS: FlagSpec = { boolean: ["json"], string: ["for", "by-session", "home"] };

const WAKE_FLAGS: FlagSpec = { boolean: ["json"], string: ["by-session", "home"] };

const MUTE_FLAGS: FlagSpec = { boolean: ["json"], string: ["by-session", "home"] };

const DONE_FLAGS: FlagSpec = { boolean: ["json"], string: ["did", "by-session", "home"] };

const RETRACT_FLAGS: FlagSpec = { boolean: ["json"], string: ["why", "by-session", "home"] };

const PUSH_FLAGS: FlagSpec = { boolean: ["json", "dry-run"], string: ["by-session", "home"] };

/** The `--`-prefixed names of one spec, for the help-truth ratchet. */
function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  const { boolean: booleans = [], string: strings = [] } = spec;
  return [...strings, ...booleans].map((name) => `--${name}`).toSorted();
}

/** `--`-prefixed post flags. */
export const HAND_POST_FLAG_NAMES: readonly string[] = flagNames({ spec: POST_FLAGS });
/** `--`-prefixed list flags. */
export const HAND_LIST_FLAG_NAMES: readonly string[] = flagNames({ spec: LIST_FLAGS });
/** `--`-prefixed show flags. */
export const HAND_SHOW_FLAG_NAMES: readonly string[] = flagNames({ spec: SHOW_FLAGS });
/** `--`-prefixed snooze flags. */
export const HAND_SNOOZE_FLAG_NAMES: readonly string[] = flagNames({ spec: SNOOZE_FLAGS });
/** `--`-prefixed wake flags. */
export const HAND_WAKE_FLAG_NAMES: readonly string[] = flagNames({ spec: WAKE_FLAGS });
/** `--`-prefixed mute flags. */
export const HAND_MUTE_FLAG_NAMES: readonly string[] = flagNames({ spec: MUTE_FLAGS });
/** `--`-prefixed done flags. */
export const HAND_DONE_FLAG_NAMES: readonly string[] = flagNames({ spec: DONE_FLAGS });
/** `--`-prefixed retract flags. */
export const HAND_RETRACT_FLAG_NAMES: readonly string[] = flagNames({ spec: RETRACT_FLAGS });
/** `--`-prefixed push flags. */
export const HAND_PUSH_FLAG_NAMES: readonly string[] = flagNames({ spec: PUSH_FLAGS });
/** `--`-prefixed recheck flags. */
export const HAND_RECHECK_FLAG_NAMES: readonly string[] = flagNames({ spec: RECHECK_FLAGS });

/**
 * Parse `hand recheck`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHandRecheckArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: RECHECK_FLAGS });
}

/**
 * Parse `hand post`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHandPostArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: POST_FLAGS });
}

/**
 * Parse `hand list`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHandListArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LIST_FLAGS });
}

/**
 * Parse `hand show`'s flags. An optional step id is the one positional.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseHandShowArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SHOW_FLAGS });
}

/**
 * Parse `hand snooze`'s flags. The step's id is the one positional.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseHandSnoozeArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SNOOZE_FLAGS });
}

/**
 * Parse `hand wake`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHandWakeArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: WAKE_FLAGS });
}

/**
 * Parse `hand mute`'s flags. The action (`list`, `add`, `remove`) and the kind are the positionals.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseHandMuteArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: MUTE_FLAGS });
}

/**
 * Parse `hand done`'s flags. The step's id is the one positional.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseHandDoneArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: DONE_FLAGS });
}

/**
 * Parse `hand retract`'s flags. Every positional is a step id.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags and positionals, or the parser's refusals
 */
export function parseHandRetractArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: RETRACT_FLAGS });
}

/**
 * Parse `hand push`'s flags.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's refusals
 */
export function parseHandPushArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: PUSH_FLAGS });
}

/** What `hand post --help` prints. */
export const POST_USAGE =
  "usage: slopweaver hand post --id <slug> --what <one sentence> --unblocks <what is waiting> \\\n" +
  "         [--if-ignored <what happens if the owner does nothing>] \\\n" +
  "         --witness <the command that settles it> --by-session <text> \\\n" +
  "         (--row <board-row slug> | --standalone) (--blocks | --check-in) [--supersedes <open step id>] \\\n" +
  "         (--url <https://…> | --open <kind>:<id> | --literal <exact text to copy> | --no-address <why>) \\\n" +
  "         [--checklist <json array of {action, command?, find?, url?}>] \\\n" +
  "         [--opened <https://… the fleet opened>] [--where <where it goes>] [--cites <url,url>] \\\n" +
  "         [--shot <png> --box <x,y,w,h=label> ...] \\\n" +
  "         [--recheck browser-session:<https origin> | slack-member:<channel id>] \\\n" +
  "         [--read-owner-words <call anchor,...>] \\\n" +
  "         [--context slopweaver|work] [--posted-iso <iso>] [--quiet] [--home <dir>] [--json]\n" +
  "\n" +
  `Records ONE step only the owner's hands can take — ${handStepKindsPhrase()} —\n` +
  "and raises the floating note for it in the same breath. This register is never somewhere work goes to sit: under rule\n" +
  "10 a session that CAN do the thing does it, and a step naming the fleet as its actor is refused — so is a\n" +
  'go-ahead ("say the word", "ok to", "should I", "want me to"…) carrying nothing to weigh: no decision, no\n' +
  "--cites, no link to the record, no named sd- Slack draft. Do the obvious act and `slopweaver autonomy record` it.\n" +
  "\n" +
  "Every step says WHERE it happens: --url or --open, --literal with --where saying where it goes (or --url when\n" +
  "the paste goes on a page), or --no-address with why there is none — never silence. A sign-in carries --url\n" +
  "with its sign-in page, --opened plus --where naming the window the fleet opened, or a --literal command plus\n" +
  "--where; --no-address never excuses one.\n" +
  "\n" +
  "A --literal command the fleet could run itself is refused: run it (in the background when it waits on the owner, as\n" +
  "a browser sign-in does) and post only what is left — sign in in the window it opened, with --opened. A command\n" +
  "carries only the owner's secret, their password, their approval, a grant only their account holds or a sign-in listener that\n" +
  "must live in the owner's terminal.\n" +
  "\n" +
  "A command of the owner's goes in --literal, beside --url when the step has both: the note copies it and the queue card\n" +
  "draws it as a copy block. One written into --what, --where, --unblocks or --if-ignored is refused. So is a `secrets set`\n" +
  "naming a secret the shipped registry lacks: land the branch that adds its row (the refusal names it) first.\n" +
  "ONE command per copy block: a step with two, or with any `secrets set`, is a --checklist — the script the owner runs\n" +
  "through, one tickable line each, every command its own copy block, a `secrets set` line naming where its value\n" +
  "sits on the provider page (skills/hand/reference/checklist.md).\n" +
  "\n" +
  "  --id        short and sayable; the owner types it back at `hand done`\n" +
  "  --row       the board row this step unblocks, as its slug. The card leaves the owner's queue by itself the moment\n" +
  "              that row reads done, cancelled or rejected. Refused unless the row is on the board and still\n" +
  "              open, and refused while another open step names it — one open card per row\n" +
  "  --standalone  no board row owns this step. Exactly one of --row and --standalone, always\n" +
  "  --supersedes  the open step this one replaces: the new card and the old one's settling are ONE register\n" +
  "              line, so a crash never leaves the new card beside the old one open. A re-cut keeps its row\n" +
  "  --what      the ONE sentence. Refused past 120 characters, and refused if it is two sentences\n" +
  "  --literal   the exact text the note puts on the owner's clipboard before the owner has read it. Never a link, and never\n" +
  "              an `open` of one — refused: a link is --url, so the note opens it itself\n" +
  '  --checklist the step as lines the owner ticks off, a JSON array: each {"action": one plain sentence, "command"?:\n' +
  '              one command for the owner, "find"?: ["Additional information", "Client ID"] — where on the page the\n' +
  '              value sits, outermost first, REQUIRED beside a `secrets set`, "url"?: the page}. Never beside --literal\n' +
  "  --where     where it goes — the field, the prompt, the console\n" +
  "  --url       the ONE http(s) address; the note draws a blue Open for it. A published page goes by its\n" +
  "              viewer address — a file:// one is refused, naming it. The post opens it in the owner's Chrome first\n" +
  "              and refuses a page that errors, does not load or draws nothing; with no --shot, the card\n" +
  "              carries what it saw (SLOPWEAVER_ALLOW_UNSEEN_HAND_URL=1 overrides). A --check-in --row whose\n" +
  "              row's pull request is unmerged is refused (SLOPWEAVER_ALLOW_UNMERGED_CHECK_IN=1).\n" +
  "              A console queue link with no context= gets --context added, so it opens in the row's context\n" +
  "  --open      the queue row the note opens, as <kind>:<id> (ask:<slug>, hand:<id>, pr:<owner>.<repo>.<n>…): mints the\n" +
  "              console deep link, carrying --context, in place of --url. One of the two, never both\n" +
  "  --opened    the http(s) page the fleet already opened on the owner's screen for this step — a sign-in it ran the\n" +
  "              command for. Needs --where naming that window; refused beside --literal. Not an Open button\n" +
  "  --no-address  why the step has no link and nothing to paste, drawn on its card so the owner sees the reason.\n" +
  "              Refused past 120 characters, beside --url, --open or --literal, and on a sign-in\n" +
  "  --cites     the records the step names, as addresses, comma-separated: https://, a localhost\n" +
  "              console route or a local page, each drawn as its integration's citation chip.\n" +
  "              A step naming #N, PR N or N PR is refused unless --cites or --url carries that number,\n" +
  "              because the queue card draws each one as a citation chip and a chip needs its address\n" +
  "  --shot      a PNG screenshot of the provider page the step happens on, stored 0600 under the home by its\n" +
  "              SHA-256; the queue card draws it with a numbered red box on each --box. Needs one --box\n" +
  "  --box       one red box, x,y,width,height=label in the PNG's own pixels, the label one line of at\n" +
  "              most 60 characters. Repeat it, 1 to 9 times; refused without --shot or outside the picture\n" +
  "  --unblocks  what is waiting on it. REQUIRED: a step with no why is one the owner has to go and research\n" +
  "  --if-ignored  what happens if the owner does nothing, and what the owner might not like about it — an incident read that\n" +
  "              stalls, or only routine freshness. The card draws it under the call to action, in place of\n" +
  "              --unblocks, because it is how the owner ranks the card. Write it on every --blocks step\n" +
  "  --witness   the command that settles it. REQUIRED, for the same reason\n" +
  "  --recheck   the precondition the supervisor's tick re-reads (`hand recheck`), so the card leaves the owner's queue the\n" +
  "              tick it is already met: browser-session:<origin> for a sign-in an atlas reads (refused for an\n" +
  "              origin none does — src/hand/sessionProbes.ts), slack-member:<C… id> for a channel the owner joins.\n" +
  "              A `Sign in…` step linking a read origin gets browser-session without it\n" +
  "  --context   `slopweaver` or `work`, when the step belongs to one of them. The console's switcher\n" +
  "              otherwise reads the prose for a repository slug, and a step about the organisation's own\n" +
  "              obligations names none — so say it here rather than let a guess place the row\n" +
  "  --blocks    work is stopped on the owner until the owner takes the step: every surface leads with it\n" +
  "  --check-in  the step is an evaluation or a dogfood try of something the fleet already did, not work\n" +
  "              stopped on the owner: every surface ranks it after what blocks a colleague or the fleet.\n" +
  "              Exactly one of --blocks and --check-in, always — an unmarked step used to lead as a blocker\n" +
  "  --quiet     record it and draw nothing — for a step that is genuinely not urgent\n" +
  "  --read-owner-words  the call anchors (call:<id>#<segment>) of what the owner said over the --row's held-question\n" +
  "              card (ask:<slug>) since it was asked, each read in its call. A step naming a row whose run is waiting\n" +
  "              on the owner is refused while any such words go unnamed: they may already answer the question\n" +
  "              (skills/hand/reference/row-and-recut.md)";

/** What `hand list --help` prints. */
export const LIST_USAGE =
  "usage: slopweaver hand list [--ranked] [--gaps] [--by-session <text>] [--home <dir>] [--json]\n" +
  "\n" +
  "Every step still waiting on the owner, OLDEST FIRST and by no other key — a wait on a person is a state, not\n" +
  "a countdown. Reconciles anything the owner pressed Done on before it reads, so the list is current.\n" +
  "\n" +
  "  --ranked  the one ranking every surface shares instead (src/waiting/rank.ts): what blocks a colleague\n" +
  "            first, check-ins last, oldest first within a tier; with --json each row carries its tier\n" +
  "  --gaps    only the open cards naming a place on the web they link nowhere on (src/hand/placeLink.ts),\n" +
  "            each with the host, then a count — read-only; exits 0 whatever it finds";

/** What `hand show --help` prints. */
export const SHOW_USAGE =
  "usage: slopweaver hand show [<id>] [--by-session <text>] [--home <dir>] [--json]\n" +
  "\n" +
  "Raises the floating note for one open step — the oldest, unless an id names another — REPLACING a note of\n" +
  "that step already up, which closes itself, so there is still one. The note floats\n" +
  "above whatever the owner is looking at, takes no keyboard focus, and puts the step's literal on their clipboard\n" +
  "as it opens. Its Done button settles the step; Not now… offers 1 hour, 3 hours or Tomorrow, each of which\n" +
  "closes it until then — never a bare dismiss. On a monitor's card it ends in More…: Never for this kind\n" +
  "(`hand mute`), and, where the monitor says what worse means, When it gets worse.";

/** What `hand snooze --help` prints. */
export const SNOOZE_USAGE =
  "usage: slopweaver hand snooze <id> --for 1h|3h|tomorrow [--by-session <text>] [--home <dir>] [--json]\n" +
  "\n" +
  "Takes a step's note down UNTIL a time the owner chose — an hour, three hours, or 09:00 Melbourne tomorrow — and\n" +
  "writes nothing about whether the step happened: it stays open, on every list, marked snoozed until then.\n" +
  "The same answer the note's Not now… band gives. `hand wake` raises the note again once the time passes.";

/** What `hand wake --help` prints. */
export const WAKE_USAGE =
  "usage: slopweaver hand wake [--by-session <text>] [--home <dir>] [--json]\n" +
  "\n" +
  "Raises the note again for every snoozed step whose time has come and which is still open, then forgets\n" +
  "the snooze. Each note stacks beside any already up; a step whose raise fails stays snoozed-lapsed and is\n" +
  "tried on the next pass. Safe to run on a schedule; the supervisor's tick runs it.";

/** What `hand mute --help` prints. */
export const MUTE_USAGE =
  "usage: slopweaver hand mute list|add <kind>|remove <kind|subject> [--by-session <text>] [--home <dir>] [--json]\n" +
  "\n" +
  'The note\'s "Never for this kind" answer, read and reversed. A muted monitor kind still posts its cards —\n' +
  "on the Queue, in `hand list`, in the push banner — but no automatic raise draws its floating note; `hand show`\n" +
  'still does. `list` names every mute and every hold the owner set with "When it gets worse"; `add <kind>` mutes from\n' +
  "a terminal or the console; `remove <kind>` brings the kind's notes back from the next pass, and `remove\n" +
  "<subject>` (a held card's `mon-…` id, as `list` prints it) releases that hold. A notice kind is refused: its\n" +
  "note is its only delivery. `slopweaver monitor list` names every kind.";

/** What `hand recheck --help` prints. */
export const RECHECK_USAGE =
  "usage: slopweaver hand recheck [--dry-run] [--by-session <text>] [--home <dir>] [--json]\n" +
  "\n" +
  "Re-reads the precondition of every open step that names one — the owner's sign-in on a platform an atlas reads, a\n" +
  "channel the owner has to join — and settles each one ALREADY met, journalled as retired by recheck, its note closed.\n" +
  "One read per distinct precondition: a sign-in is the bare origin through the owner's work Chrome, the first navigation\n" +
  "that platform's own walk makes, never a click; a channel is conversations.members under the owner's Slack token. A read\n" +
  "that fails keeps its step. The supervisor's tick runs it before the sign-in monitor. Exit 3 when no open step\n" +
  "names a precondition.\n" +
  "\n" +
  "  --dry-run  read every precondition and report, settle nothing";

/** What `hand done --help` prints. */
export const DONE_USAGE =
  "usage: slopweaver hand done <id> --did <what was done> --by-session <text> [--home <dir>] [--json]\n" +
  "\n" +
  "Settles one step and closes its note. `--did` records what actually happened, in the words of whoever\n" +
  "watched it — never a guess.";

/** What `hand retract --help` prints. */
export const RETRACT_USAGE =
  "usage: slopweaver hand retract <id> [<id> …] --why <text> --by-session <text> [--home <dir>] [--json]\n" +
  "\n" +
  "Takes a step off the owner's queue that was never the owner's to take — a mis-post, not work done. Settles it with a\n" +
  "`did` that reads as a retraction and names --why, and closes its note. Not `hand done`, which says the\n" +
  "step happened, and not `hand snooze`, which leaves it open. Every id is checked open before any is\n" +
  "written, so one wrong id retracts nothing.";

/** What `hand push --help` prints. */
export const PUSH_USAGE =
  "usage: slopweaver hand push [--dry-run] [--by-session <text>] [--home <dir>] [--json]\n" +
  "\n" +
  "The push lane. Sends ONE macOS notification when something has ARRIVED on the owner since the last pass, and\n" +
  "at no other time — never on persistence, never on departure, and never on age. There is no clock in the\n" +
  "decision at all, which is the owner's ruling that a wait on a person is a state rather than a countdown made\n" +
  "mechanical: a lane that re-pinged the owner about a sign-in the owner already knows about is one the owner switches off.\n" +
  "\n" +
  "Safe to run on a schedule. It also raises the floating note when a hand step is among what arrived.\n" +
  "\n" +
  "  --dry-run  decide and report, send nothing and record nothing";
