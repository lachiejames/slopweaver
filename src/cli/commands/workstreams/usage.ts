/** Usage strings for the `workstreams` noun — a leaf the manifest barrel may import (see `area-cli.md`). */

export const WORKSTREAMS_LIST_USAGE =
  "usage: slopweaver workstreams list [--home <dir>] [--json]\n" +
  "  Their workstreams register, read from the store, each workstream's progress DERIVED against its own\n" +
  "  milestones: how many are done, the next one ready, whether its definition of done is. --json prints the\n" +
  "  schema-version-2 document the console's Workstreams page reads and `workstreams put` takes back, carrying\n" +
  "  the register's baseline. Exits 3 when the store holds no workstream and no register document yet, 1 when\n" +
  "  the store refuses.\n" +
  "\n" +
  "example: slopweaver workstreams list --json";

export const WORKSTREAMS_PUT_USAGE =
  "usage: slopweaver workstreams put --file <document.json> [--home <dir>] [--json]\n" +
  "  Make the whole register the document `workstreams list --json` printed, edited, in one store transaction.\n" +
  "  The document's own baseline is checked against the register: one that moved since it was read is refused,\n" +
  "  nothing written, and a document carrying no baseline can only seed an empty register. Every failing rule is\n" +
  "  named; a milestone is finished only by a dated entry carrying the link that proves it.\n" +
  "\n" +
  "example: slopweaver workstreams list --json > document.json && slopweaver workstreams put --file document.json";

export const WORKSTREAMS_CANDIDATES_USAGE =
  "usage: slopweaver workstreams candidates [--home <dir>] [--unruled | --ruled] [--json]\n" +
  "  The workstreams a session mined from a person's connected history, each with their latest reaction, the day\n" +
  "  they gave it and their words as heard, the title and definition of done they gave it, who the first\n" +
  "  conversation is with, where each owed conversation stands on the Queue, and the register entry it is held\n" +
  "  under; then the workstreams they proposed in their own words and the register beside it. Lists what the seat\n" +
  "  owes: a yes, done or abandoned with no entry, a tile not yet saying its definition, a placing note missing from\n" +
  "  the workstream it names, an unread story, a yes since retracted, and a proposal no mine has read yet.\n" +
  "  --unruled keeps only the candidates with no word of theirs yet, which is what the console voice walks them\n" +
  "  through; --ruled keeps the rest, newest ruling first, each naming the ruling. --json prints the one document\n" +
  "  the console's Proposed workstreams section reads. Exits 3 when no candidates exist yet; no register is fine.\n" +
  "\n" +
  "example: slopweaver workstreams candidates --unruled\n" +
  "example: slopweaver workstreams candidates --json";

export const WORKSTREAMS_CANDIDATES_PUT_USAGE =
  "usage: slopweaver workstreams candidates-put --file <candidates.json> [--home <dir>] [--json]\n" +
  "  Validate a whole candidates document and write it atomically to $SLOPWEAVER_HOME/workstreams/candidates.json.\n" +
  "  Nothing is written when one rule fails. Ids and numbers are unique, every piece of evidence carries a link\n" +
  "  or an anchor. Their reactions are kept apart, so re-mining never loses one.\n" +
  "\n" +
  "example: slopweaver workstreams candidates-put --file ./candidates.json";

export const WORKSTREAMS_REACT_USAGE =
  "usage: slopweaver workstreams react <their words> | --candidate <id> --as <reaction>\n" +
  "         [--via console|word|session] [--by-session <who>] [--anchor <where they said it>] [--reason <why>]\n" +
  "         [--same-as <id>] [--milestone-of <id>] [--outcome-of <id>] [--superseded-by <what>]\n" +
  "         [--owner <whose>] [--covered-by <id>] [--steer <their earlier steer>] [--heard <their words>]\n" +
  "         [--home <dir>] [--json]\n" +
  "  Record their reaction to candidates, by number in their own words (`12 yes, 13 no 14-16 sort of 17 let's talk`)\n" +
  "  or one id and one of yes, no, sort-of, not-sure, lets-talk, done, same-as, milestone-of, outcome-of,\n" +
  "  superseded, abandoned. A yes the register does not hold becomes a standing discovery entry there and then,\n" +
  "  its entries the candidate's cited evidence; --steer ties it to a steer they already gave, noted on it.\n" +
  "  Every promotion starts with the milestone `done`, named by the picked definition or else its outcome.\n" +
  "  done keeps it as a closing entry with its outcome, the day closed, its cited entries and its people.\n" +
  "  same-as, milestone-of and outcome-of name a register workstream and leave a note on it (milestone-of also\n" +
  "  files an own milestone there, refused on a closing entry); superseded names what replaced it. A no may\n" +
  "  say whose it is (--owner) and the workstream covering it as a side effect (--covered-by), both kept.\n" +
  "  abandoned (also cancelled) ended without its outcome: it ends the entry the candidate is held under, or\n" +
  "  promotes it already ended, and needs --reason and --anchor. A placing flag or --reason goes with ONE pick of\n" +
  "  its word. The whole batch is refused on an unknown number or word, and nothing is recorded when it fails.\n" +
  "  --heard keeps their words as heard on every row, so a later reading names the ruling, not only its kind; their\n" +
  "  words by number are kept that way when --heard is absent.\n" +
  "\n" +
  'example: slopweaver workstreams react "12 yes, 13 no" --via word --anchor transcript:<session>#<uuid>\n' +
  'example: slopweaver workstreams react --candidate c-105 --as no --via word --heard "<their words>" --anchor talk-call:<call>#turn_<id>\n' +
  "example: slopweaver workstreams react --candidate c-031 --as milestone-of --milestone-of pool-e2e --via console\n" +
  'example: slopweaver workstreams react "83 abandoned" --via word --reason "<their why>" --anchor talk-call:<call>#turn_<id>';

export const WORKSTREAMS_DEFINE_USAGE =
  "usage: slopweaver workstreams define --candidate <id>\n" +
  "         (--option <id> | --text <their words> [--stretch <the rung beyond>] | --all [--first <id>])\n" +
  "         [--via console|word|session] [--by-session <who>] [--home <dir>] [--json]\n" +
  "  Record what DONE means for a mined candidate: one of the definitions of done it offers (each with its\n" +
  "  trade-off, and a stretch rung beyond its floor when it has one), the person's own words with an optional\n" +
  "  stretch, or all of them with --first naming which leads (asked again until it is said). Kept in\n" +
  "  $SLOPWEAVER_HOME/workstreams/definitions.jsonl, the latest\n" +
  "  per candidate standing. Once the candidate is accepted, its `done` milestone and outcome become the\n" +
  "  definition, with a dated note naming the trade-off; picked before the yes, the yes carries it. The same pick again\n" +
  "  appends nothing and repairs a workstream a failed store write left without it.\n" +
  "\n" +
  "example: slopweaver workstreams define --candidate c-012 --option owned-and-read --via console";

export const WORKSTREAMS_LOOP_IN_USAGE =
  "usage: slopweaver workstreams loop-in --candidate <id> --person <slack member id> [--home <dir>] [--json]\n" +
  "  Park the conversation a mined candidate says is owed to one person as a draft on the Queue: the opener the\n" +
  "  candidate carries, to that person's DM, as them. NOTHING IS SENT — they read, edits and sends it from the Queue.\n" +
  "  Parking the same person for the same candidate again parks nothing new while the first draft is held or sent.\n" +
  "\n" +
  "example: slopweaver workstreams loop-in --candidate c-012 --person U0SYN123ABCD";

export const WORKSTREAMS_RETITLE_USAGE =
  "usage: slopweaver workstreams retitle --candidate <id> --title <their title>\n" +
  "         [--via console|word|session] [--by-session <who>] [--home <dir>] [--json]\n" +
  "  Give a mined candidate the title the person wants, in their words — usually the outcome they are after. The\n" +
  "  mined name stays its identity across a re-mine; the title is kept in workstreams/titles.jsonl, the latest\n" +
  "  standing. An entry their own word already promoted from it takes the title, with a dated note keeping the\n" +
  "  mined name; one accepted later takes it on the yes. The same title again appends nothing.\n" +
  "\n" +
  'example: slopweaver workstreams retitle --candidate c-012 --title "Know about a bug the moment it happens" --via word';

export const WORKSTREAMS_PROPOSE_USAGE =
  "usage: slopweaver workstreams propose --title <their words> [--from <candidate id> --relation split|instead|sibling]\n" +
  "         [--why <what they want from it>] [--anchor <where they said it>] [--via console|word|session]\n" +
  "         [--by-session <who>] [--home <dir>] [--json]\n" +
  '  Record a workstream the person proposes in their own words: split off a candidate, instead of it ("not this,\n' +
  '  but THIS"), a sibling beside it, or — with no --from — outright. Kept in workstreams/proposals.jsonl as said;\n' +
  "  the next mine owes each one a candidate with evidence, and `workstreams candidates` lists those still owed.\n" +
  "  Needs no candidates file for one proposed outright.\n" +
  "\n" +
  'example: slopweaver workstreams propose --title "Human PR review friction" --why "<their words>" --via word --anchor talk:<id>';

export const WORKSTREAMS_WHO_FIRST_USAGE =
  "usage: slopweaver workstreams who-first --candidate <id> (--people <names> | --team <owning team>)\n" +
  "         [--via console|word|session] [--by-session <who>] [--home <dir>] [--json]\n" +
  "  Record who the FIRST conversation about a candidate is with, as people (`Jasper and Quinn`), separately from\n" +
  "  the team that owns it. Kept in workstreams/who-first.jsonl, the latest standing; the page shows it over the\n" +
  "  miner's guess and the next mine resolves the people into loop-in drafts. Nothing is sent.\n" +
  "\n" +
  'example: slopweaver workstreams who-first --candidate c-044 --people "Jasper and Quinn" --team "platform team"';
