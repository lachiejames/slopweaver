/**
 * The `handover` noun's ASK-SHAPED verbs — `ask`, which parks a run on the owner, `register`, which puts
 * something the owner asked for on the board before anyone decides what to do about it, `offer`, which
 * attaches a concrete Slack draft to a question one of them already recorded, `reconfirm`, which records
 * that such a question still stands without re-asking it, `withdraw`, which lets the run's holder take such a
 * question back when its premise resolved itself, `recheck`, which offers a finding the trunk-moved hold took
 * off the ready set again, `set-repo`, which gives a row `register` left
 * with no `repo:` the checkout a seat opens in, `set-workspace`, which states whose work a row is, `set-priority`,
 * which states the band it ranks in or writes every row's default down, and `quote`,
 * which writes onto a row the words its anchor names — what `register` does as a row is born, for every
 * row born before it.
 *
 * Its own module for the same two reasons `./handoverRulings.ts` is: `./handover.ts` is a declared offender
 * on the file-size ratchet, and these are the one remaining group in it a reader would draw a seam around
 * anyway — they are the verbs the ask-shape gate applies to (see
 * `../../../skills/handover/reference/ask-shape.md`). Their usage text carries that shape, which is most of
 * why the file crossed its floor.
 *
 * **The seam is the SHAPE, not row creation.** `offer` creates nothing; it reads the same
 * `askOfferVerdict` the two recording verbs do (`../commands/handover/askOffer.ts`), and a module drawn
 * round "creates a row" would put the two readers of one gate in two files. `reconfirm` passes no gate
 * but moves the one field of that shape a card ages an ask by, its still-real check.
 *
 * It is NOT a second declaration. `.claude/rules/area-cli.md`'s one-declaration rule is about a second COPY
 * of a verb's `CommandMeta`; every entry below are declared here and nowhere else, and `./handover.ts`
 * spreads this object into the one `handoverManifest` the barrel folds.
 *
 * Lazy for the same reason every manifest is: `--help` is answered from `meta.usage` without loading the
 * module, so every `usage` here is a LITERAL or a `*Usage.ts` leaf's, and the help-truth ratchet keeps it honest.
 */
import { ASK_USAGE } from "../commands/handover/askUsage.js";
import { RECHECK_USAGE } from "../commands/handover/recheckUsage.js";
import { SET_WORKSPACE_USAGE } from "../commands/handover/setWorkspaceUsage.js";
import { SHOT_USAGE } from "../commands/handover/shotUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";
import { lifecycleMeta } from "./handoverLifecycleMeta.js";

/** The verbs that record an ask's shape, or re-date its still-real check without re-asking it. */
export const handoverAskManifest: Readonly<Record<string, VerbManifestEntry>> = {
  ask: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverAskCommand),
    meta: lifecycleMeta({
      example:
        'slopweaver handover ask my-doc --problem "the base branch is not derivable from the doc" ' +
        '--options "main :: every other run is on it\nthe release branch :: this doc cites it once" ' +
        '--lean "main — the one citation reads like a typo" ' +
        '--risk "a run lands on the wrong base and has to be redone" --blast-radius "this one run, no teammate" ' +
        '--still-real "grep base: on the doc still finds nothing" ' +
        '--example "You open the PR the run landed and it sits on the release branch. Should it be on main?"',
      summary: "Record a question only the owner can settle, and pause the run — a legitimate ending",
      usage: ASK_USAGE,
    }),
  }),
  offer: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverOfferCommand),
    meta: lifecycleMeta({
      example:
        'slopweaver handover offer my-doc --action ./draft.json --problem "nobody has replied in the thread" --lean "post it — the room is waiting" ' +
        '--risk "the pull request goes stale unreviewed" --blast-radius "one channel, three reviewers" ' +
        '--still-real "github checks shows no review yet"',
      summary: "Attach a Slack draft, its people and its destinations to the question a run already holds",
      usage:
        "usage: slopweaver handover offer <slug> --action <json|path|-> --problem <line> --lean <line> " +
        "--risk <line> --blast-radius <line> --still-real <line> " +
        "[--base <value>] [--dir <value>] [--home <value>]\n" +
        "  The run must already be waiting on the owner: an offer attaches to the OPEN question, leaving its text " +
        "and the instant it was asked untouched, so a card gains a draft without the ask looking fresh.\n" +
        "  --action is the draft, its <@Uxxxx> mentions and one to three destinations, each with its own " +
        "label and trade-off. The OPTIONS are derived from it — one per destination, in order, HOLD last — " +
        "so this verb advertises no flag that spells them, and one is refused by name.\n" +
        "  It does NOT re-post: the question was delivered when it was asked, and the console reads the " +
        "journal, so the card changes where the owner is already looking.",
    }),
  }),
  reconfirm: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverReconfirmCommand),
    meta: lifecycleMeta({
      example: 'slopweaver handover reconfirm my-doc --still-real "github read shows the PR still OPEN with no review"',
      summary: "Record that the question a run is waiting on still stands, without re-asking or re-posting it",
      usage:
        "usage: slopweaver handover reconfirm <slug> --still-real <line> [--base <value>] [--dir <value>] " +
        "[--home <value>]\n" +
        "  For a refresh pass: the run must be waiting on the owner, and --still-real is the check you just re-ran " +
        "that shows the question is still the owner's. The card ages the ask off this instant; the question's text, " +
        "shape and asked-at instant are untouched.\n" +
        "  Needs no claim on the run, like `handover rule`, and posts nothing — the console reads the journal.",
    }),
  }),
  withdraw: lazy({
    load: () => import("../commands/handover/lifecycleRun.js").then((m) => m.handoverWithdrawCommand),
    meta: lifecycleMeta({
      example:
        'slopweaver handover withdraw my-doc --why "github checks shows the last three runs green with no Nx Cloud 401"',
      summary: "Withdraw your own run's waiting question when its premise resolved itself — not the owner's answer",
      usage:
        "usage: slopweaver handover withdraw <slug> --why <line> [--base <value>] [--dir <value>] [--home <value>]\n" +
        "  For the HOLDER of a run waiting on the owner, when the fact the question waited on resolved without them. " +
        "It journals a withdrawal bound to the open question, never an answer: nothing reads it as the owner's words.\n" +
        "  --why is the one-line check that shows the premise dissolved. The run is open again and the Queue card " +
        "is gone; posts nothing. A question the owner has to settle is `handover answer`'s once they have.",
    }),
  }),
  register: lazy({
    load: () => import("../commands/handover/askRowRun.js").then((m) => m.handoverRegisterCommand),
    meta: {
      createsWorkItem: true,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver handover register --ask "Should listen status count every stuck chat?" --problem "nothing counts the stuck ones" ' +
        '--options "count them in listen status :: one more field on a verb the owner reads\nleave it :: the number stays unknown" ' +
        '--lean "count them — an unknown number is what the board is for" ' +
        '--risk "a stuck chat holds work nobody sees" --blast-radius "every fleet seat" ' +
        '--still-real "listen status prints no stuck count" ' +
        '--example "You open listen status after a quiet morning and it says all clear while two chats sit stuck. ' +
        'Would you rather it counted them?"',
      parseRejectIsIoFree: true,
      summary: "Register something the owner asked for as a board row, before anyone decides what to do about it",
      usage:
        "usage: slopweaver handover register --ask <text> --problem <line> --options <lines> --lean <line> " +
        "--risk <line> --blast-radius <line> --still-real <line> " +
        "(--example <scene> [--example <scene> ...] | --example-gap <line>) " +
        "[--anchor <link>] [--bears-on <line>] " +
        "[--asked-ts <slack ts>] [--asked-iso <iso>] " +
        "[--priority p0|p1|p2|p3] [--slug <slug>] [--repo <path|owner/name|name>] [--branch <name>] [--dir <path>] " +
        "[--tag <key=value>[,...]] [--new-value <key=value>[,...]] [--home <dir>] " +
        "[--workspace team|self --workspace-because <line>] [--full]\n" +
        "       slopweaver handover register --ask <text> --finding --evidence <ref,...> [--observed-by <session>]\n" +
        "       slopweaver handover register --ask <text> --dispatch [--keep-lines] [--branch <name>] [--repo <path|owner/name|name>]\n" +
        "  The SHAPE is mandatory on an ASK and absent on the two rows that ask " +
        "the owner to pick nothing — a --finding, which is a session's own observation, and a --dispatch, which is " +
        "work a seat picks up: --options holds two to four LINES, each " +
        "`<what they could do> :: <what that costs>`, --lean is what they would most likely pick, and --risk, " +
        "--blast-radius and --still-real are the stakes the owner reads at a glance.\n" +
        "  --example is a second-person scene the card LEADS with, ending on the question it really asks — up " +
        "to three for related asks folded onto one card; --example-gap is one line saying why the row cannot " +
        "support a truthful one. Required on every row that heads the owner's card.\n" +
        "  The instant is DERIVED: --asked-ts, or a Slack --anchor's own timestamp. --asked-iso is the " +
        "escape hatch for an ask that did not arrive in Slack, and is refused unless it parses.\n" +
        "  --bears-on is one line saying how the owner's quoted words bear on the question: the Queue card draws it " +
        "after every quote, as why the card is in front of the owner. Refused on a row whose --anchor quotes none of the owner's words.\n" +
        "  --finding marks a row a SESSION registered from what it observed, not from the owner: it still ranks as " +
        "an ask but carries its origin, and a team-facing door refuses it until `handover rule` records the owner's word.\n" +
        "  --dispatch marks a row that is WORK a seat picks up — an already-team-facing pull request of the owner's " +
        "needing a rebase, red CI cleared or threads answered, which is what the landing read registers. " +
        "It is NOT a finding: no door holds on it. Refused beside --finding or any of the six shape flags.\n" +
        "  --keep-lines, with --dispatch only, stores the ask's line breaks instead of flattening it to one line, " +
        "for a brief whose lines code reads back (`vulnerability-fix topup`'s batch).\n" +
        "  --branch declares the head branch the row is about. It is what the landing read joins a row to an " +
        "open pull request by, and what a team-facing door matches a --finding row by — never name similarity.\n" +
        "  --repo is the main checkout a seat's worktree is cut from; a row without one is held off the ready " +
        "set until `handover set-repo` gives it one.\n" +
        "  --tag records typed tags on the new row as it lands, exactly as `handover tag` would; refused beside " +
        "--dir. --new-value acknowledges a value no row carries yet.\n" +
        "  --workspace states whose work the row is, team (the organisation's) or self (this instance's own), " +
        "with --workspace-because saying why; " +
        "the console places a row by it, never by --repo, and a row stating none, naming no pull request and " +
        "sending to no Slack destination shows on the self Queue view only, marked placed by default. A verb that registers rows " +
        "passes one when the row's own source says whose work it is, and none otherwise.",
    } as const,
  }),
  tag: lazy({
    load: () => import("../commands/handover/tagRun.js").then((m) => m.handoverTagCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver handover tag iso-policy-row workstream=iso-certification impact=high --why "ISO certification work"',
      parseRejectIsIoFree: true,
      summary: "Set or drop typed key=value tags on one board row, recorded in its journal with why — idempotent",
      usage:
        "usage: slopweaver handover tag <slug> [<key>=<value> ...] [--drop <key|key=value>[,...]] --why <text> " +
        "[--new-value <key>=<value>[,...]] [--home <dir>]\n" +
        "  The keys are a closed list (skills/handover/reference/row-tags.md). A write names the state the row " +
        "should be in, so a second run changes nothing. A workstream no row carries yet is refused as a likely " +
        "typo unless --new-value names it.",
    } as const,
  }),
  "set-repo": lazy({
    load: () => import("../commands/handover/setRepoRun.js").then((m) => m.handoverSetRepoCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover set-repo a-finding-row --repo ~/dev/personal/slopweaver",
      parseRejectIsIoFree: true,
      summary: "Give a row that names no `repo:` the checkout `cmux spawn` opens its worktree in — add-only",
      usage:
        "usage: slopweaver handover set-repo <slug> [<slug> ...] --repo <path|owner/name|name> [--dir <path>] " +
        "[--home <dir>]\n" +
        "  --repo is the top of a main git checkout, never a linked worktree, or a declared checkout's owner/name or bare " +
        "repository name, never read as a directory. A row that " +
        "already names a repo is refused, never moved.",
    } as const,
  }),
  recheck: lazy({
    load: () => import("../commands/handover/recheckRun.js").then((m) => m.handoverRecheckCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver handover recheck a-finding-row --still-real "settleCardRun.ts at 15f7cd45 still refuses a relay-filed doc"',
      parseRejectIsIoFree: true,
      summary:
        "Offer a finding the trunk-moved hold took off the ready set again, recording the check that shows it real",
      usage: RECHECK_USAGE,
    } as const,
  }),
  "set-workspace": lazy({
    load: () => import("../commands/handover/setWorkspaceRun.js").then((m) => m.handoverSetWorkspaceCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        "slopweaver handover set-workspace iso-compliance-violations-bigtask --workspace team " +
        '--because "the ISO 27001 audit is the organisation\'s"',
      parseRejectIsIoFree: true,
      summary: "State whose work a row is, team or self — what the console's workspace selector reads",
      usage: SET_WORKSPACE_USAGE,
    } as const,
  }),
  "set-priority": lazy({
    load: () => import("../commands/handover/setPriorityRun.js").then((m) => m.handoverSetPriorityCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: 'slopweaver handover set-priority iso-gap-register --priority p0 --because "the audit gate is Friday"',
      parseRejectIsIoFree: true,
      summary:
        "State the band a row ranks in, or backfill every row's kind default — what a Queue card's priority reads",
      usage:
        "usage: slopweaver handover set-priority <slug> [<slug> ...] --priority p0|p1|p2|p3 --because <why> " +
        "[--dir <path>] [--home <dir>]\n" +
        "       slopweaver handover set-priority --backfill [--apply] [--dir <path>] [--home <dir>]\n" +
        "  --because is written beside it as priorityBecause:. --backfill gives every row declaring none its kind's " +
        "default, marked priorityFrom: default so it ranks as before and grooms nothing; dry without --apply.",
    } as const,
  }),
  shot: lazy({
    load: () => import("../commands/handover/shotRun.js").then((m) => m.handoverShotCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover shot vanta-evidence --shot ~/shots/net-93.png --box 40,212,380,36=stale",
      parseRejectIsIoFree: true,
      summary: "Give an open ask the picture its Queue card shows, with a red box and a label on what to read",
      usage: SHOT_USAGE,
    } as const,
  }),
  example: lazy({
    load: () => import("../commands/handover/exampleRun.js").then((m) => m.handoverExampleCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example:
        'slopweaver handover example datadog-tool-error --example "You are in a meeting and the fleet hits an error ' +
        'that blocks two Datadog tools, so it opens a fix PR and self-merges it. Was that the right call?"',
      parseRejectIsIoFree: true,
      summary: "Give an open ask the concrete second-person examples its Queue card leads with, or say why it has none",
      usage:
        'usage: slopweaver handover example <slug> (--example "<scene>" [--example "<scene>" ...] | ' +
        '--example-gap "<line>") [--dir <path>] [--home <dir>]\n' +
        "  A scene puts the owner in it and ends on the question the card is really asking; up to three, numbered, for " +
        "related asks on one row. --example-gap says in one line why the row cannot support a truthful scene. " +
        "Replaces what the row carried; refuses a row not open on the owner; needs no claim on the run.",
    } as const,
  }),
  quote: lazy({
    load: () => import("../commands/handover/quoteRun.js").then((m) => m.handoverQuoteCommand),
    meta: {
      createsWorkItem: false,
      diagnostic: false,
      doorRouted: false,
      dryParseSafe: true,
      effect: "local-state",
      example: "slopweaver handover quote --apply",
      parseRejectIsIoFree: true,
      summary: "Write the owner's own words onto every row whose anchor names them, so its queue card leads with them",
      usage:
        "usage: slopweaver handover quote [<slug> ...] [--apply | --check] [--json] [--dir <path>] [--home <dir>]\n" +
        "       slopweaver handover quote <slug> --anchor <anchor> [--apply] [--json] [--dir <path>] [--home <dir>]\n" +
        "       slopweaver handover quote <slug> --add-steer <anchor> [--apply] [--json] [--dir <path>] [--home <dir>]\n" +
        "  Reads every row anchored on talk:, call:, talk-call: or transcript:, settled ones too, and adds, " +
        "refreshes, repairs or drops its stored quote and each further steer of the owner's related to it. Dry without " +
        "--apply; --check exits 1 while any row still needs a write. --anchor ties one unanchored row to the " +
        "turn of the owner's it came from (slopweaver profile words finds it) and quotes it in the same write; " +
        "--add-steer relates one more anchor of the owner's words to one row, drawn on its card oldest first.",
    } as const,
  }),
};
