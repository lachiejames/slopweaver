/**
 * The brief one detective is handed. Pure: it renders text and reaches nothing.
 *
 * ## What a brief is, and the one thing it deliberately is not
 *
 * It is a STARTING LEAD plus the tool surface, and it is not a plan. The owner's ruling is that
 * there is never a finalized plan: it is all dynamic, tugging on different threads and knowing when to reject
 * information versus where to search elsewhere. A detective that executed its brief to the end and stopped has already lost the property
 * the fan-out exists for, so the brief says where to OPEN and then hands over the ladder.
 *
 * The same ruling is why there is no typed lead-request in here: a second wave proposed as readers returning
 * typed lead requests for the supervisor to validate was rejected, because the dynamic planning loop already
 * solves it.
 *
 * So a detective follows its own leads with the verbs it already has. It reports what it found; it never
 * asks permission to look at the next thing.
 *
 * ## Three standing limits every brief carries, and why each is in the TEXT rather than in a gate
 *
 * A detective is a sub-agent reading a prompt, so a limit only binds if it is written where the detective
 * reads. Each of these was a measured failure of one of the lap-two arms:
 *
 * - **`around` is where the answer usually is.** Two of the four lap-two questions were settled by thread
 *   REPLIES that contained none of the search terms. A detective that reads only its hits reaches neither.
 * - **A recalled memory is a hypothesis, never evidence.** A memory can be wrong the way a person's can, and
 *   acting on a wrong one steers later behaviour off bad data. So an exclusion a memory proposes is re-checked on a sample before it is believed, and it
 *   never narrows the probe that already ran.
 * - **Rejecting a return is a move, not a failure.** A top-ranked record can be somebody else's
 *   conversation, a bot's own posting, or the right words in the wrong year. Say why each kept record
 *   earns its place and drop the rest.
 */

import { absentAs } from "#lib/absent.js";
import { ATLAS_LEAD_SOURCE } from "./atlasLead.js";
import type { Lead } from "./fanout.js";
import { type NameFinding, nameFindingLines } from "./nameProbe.js";

/** What a detective needs to know that is not its own lead. */
export interface BriefContext {
  /** The question the whole wave is answering, as the asker put it. */
  readonly question: string;
  /** Which detective this is, and how many there are, so a report can name itself. */
  readonly index: number;
  readonly total: number;
  /** The claims `knowledge recall` returned for this question, already rendered one per line. */
  readonly recalled: readonly string[];
  /**
   * What the pre-planning name step found, or nothing when the question named no ambiguous person.
   *
   * Carried into every brief rather than only into the planner's own report, because the finding a
   * detective needs it for is one it cannot derive: the rows matching the spelling the asker typed may be
   * a different population entirely, and a reader with only its own lead in front of it will fold them in.
   */
  readonly nameFinding: NameFinding | null;
  /** Where this detective writes its report. */
  readonly reportPath: string;
}

/** The verb surface a detective is told about, in the order it should reach for them. */
const LADDER = [
  "slopweaver store probe <keyword> [<keyword> ...] [--regex <p>] [--source <s>]   counts for every shape, with the source split and the ids of anything narrow. Keywords are POSITIONAL; quote a phrase to keep it one keyword",
  "slopweaver store groups --term <t> --shape <s> --facet container|author|source|kind   split one wide cell into readable ones",
  "slopweaver store hits --term <t> --shape <s> [--limit <n>] [--offset <n>]   one page of a shape's records, newest first",
  "slopweaver store peek --id <uuid,...> [--match <term>] [--chars <n>]   a window CENTRED ON THE MATCH — enough to discard a record without opening it",
  "slopweaver store open --id <uuid,...>   the whole stored record, and the URLs its text linked to",
  "slopweaver store around --id <uuid | <channel>:<ts> | a slack link> [--mode conversation|thread|container] [--before <n>] [--after <n>]   the THREAD it sits in plus the top-level channel messages around that thread — what a person scrolling Slack sees. `thread` is the thread alone; `container` is every row in the place, replies interleaved",
];

/**
 * The Datadog half of the ladder, printed only for a detective whose lead is a Datadog one.
 *
 * Only for that detective, because a brief is read in full by a sub-agent and rule 7's no-walls-of-text is
 * about what a reader has to wade through, not only about Slack. A store detective handed Datadog's four
 * rungs, five correlation modes and retention ceiling would read a page it will never use.
 *
 * The retention sentence and the no-regex sentence are both in the TEXT for the same reason the three
 * standing limits are: a limit only binds where the detective reads.
 */
const DATADOG_LADDER = [
  "slopweaver datadog catalogue show --service <s>   what this service's logs, spans, sessions and errors LOOK like, locally, free",
  "slopweaver store probe <keyword> --source datadog [--from 7d] [--env <e,...>]   counts for Datadog's four rungs",
  "slopweaver store groups --term <t> --source datadog --facet service|status|@err.code|@operation_name   where the count lives",
  "slopweaver store hits --term <t> --source datadog [--rung <r>] [--limit <n>] [--regex <p>]   one page of real events, newest first",
  "slopweaver store peek --id dd:<...> --match <term>   a window of one event, centred on the match",
  "slopweaver store open --id dd:<...>   the whole event, every attribute, UNREDACTED",
  "slopweaver store around --id dd:<...> --mode trace|request|session|ip|service   what else was happening",
];

/**
 * The Hex half of the ladder, printed only for a detective whose lead is a Hex one — same bound as the
 * Datadog block above, and the same reason.
 *
 * Every line here is in the TEXT because a limit only binds where the detective reads, and three of them
 * are the owner's own words rather than this repository's taste: Hex is read and NEVER ingested, the long
 * view past Datadog's fifteen days is the thing Hex is for, and the masking Hex already applies is why the
 * owner wants data reached this way instead of through a new grant somewhere else.
 */
const HEX_LADDER = [
  "slopweaver atlas hex read --kind project --query <words>   what the LOCAL atlas already knows, free, no network",
  "slopweaver hex projects --query <words>   the live workspace, narrowed by title, description and categories",
  "slopweaver hex project --project <id> --tables   one project's config, and the warehouse tables its cells query",
  "slopweaver hex cells --project <id> --sql-only   the SQL each cell runs — read this BEFORE any output",
  "slopweaver hex output --cell <id> [--limit n] [--column c] [--date-column c]   the cell's latest rows",
  "slopweaver hex runs --project <id>   when it last actually ran, which is how old those rows are",
  "slopweaver hex connections   which warehouse each connection points at",
];

/**
 * The atlas half of the ladder, printed only for a detective whose lead is an atlas one — same bound as
 * the two blocks above, and the same reason.
 *
 * The first rung is the one that makes the rest cheap: `atlas probe` asks every atlas one question in
 * one statement, so a detective learns which atlas is worth opening before it opens any. The last two
 * rungs are the honesty rungs, and they are IN the ladder rather than in prose because a detective that
 * quotes a count without them has reported a stale generation as the estate's present state.
 */
const ATLAS_LADDER = [
  "slopweaver atlas probe <keyword> [<keyword> ...] [--platform <p>] [--cells <n>]   counts for every atlas at once, per (platform, kind), with each cell's last successful sync",
  "slopweaver atlas <platform> read --query <words> [--kind <k>] [--limit <n>]   the entities themselves, and the claim boundary that comes with them",
  "slopweaver atlas <platform> read --id <entity-id>   one entity whole, every channel that observed it",
  "slopweaver atlas <platform> coverage [--kind <k>] [--open-only]   what this atlas knows it does NOT know — read BEFORE you report an absence",
  "slopweaver atlas freshness <platform>   whether it is inside its own rolling window, or how far behind",
  "slopweaver atlas doctor <platform>   whether it can answer at all, or vouches for a generation nobody can read back",
];

/**
 * The Hex section of a brief.
 *
 * @param lead the detective's starting lead
 * @returns the lines, or nothing when this detective's lead is not a Hex one
 */
function hexSection({ lead }: { lead: Lead }): readonly string[] {
  if (lead.source !== "hex") {
    return [];
  }
  return [
    "## Hex — read the cell's SQL before you read its numbers",
    "",
    "```",
    ...HEX_LADDER,
    "```",
    "",
    "- **You never store what you read here.** `hex output` prints rows to your session and writes nothing,",
    "  and that is the owner's own rule: Hex is never ingested into the corpus. Quote what your report needs",
    "  and no more. What makes reading it safe at all is Hex's own masking and access control.",
    "- **An output is the DRAFT session's latest preview, not a fresh query.** It carries the `runId` it came",
    "  from. Before you believe a number, run `hex runs --project <id>` and say in your report how old it is",
    "  — a failed overnight schedule is exactly how a dashboard comes to show last week.",
    "- **This is the LONG view; Datadog is the recent one.** Datadog keeps about fifteen days, so a question",
    "  about who is affected BEYOND that window is answerable here and nowhere else.",
    "  `hex output --date-column <c>` prints the split: rows both systems still see, rows only Hex does.",
    "  If this wave also has a Datadog detective, yours is the half that reaches past the retention edge.",
    "- **A cell's SQL says what its number MEANS.** Read it before quoting the number — the filter, the date",
    "  window and the table it reads are what decide whether it answers the question you were sent with.",
    "- **There is no verb that runs SQL, on purpose.** If the question needs a query nobody has written, say",
    "  so in your report and name the project it belongs in. Do not try to trigger a run.",
    "- **What you read is UNREDACTED and what you report must not be.** Say when a quote carries identity,",
    "  so the composing session knows to redact it before anything reaches Slack.",
    "",
  ];
}

/**
 * The Datadog section of a brief.
 *
 * @returns the lines, or nothing when this detective's lead is not a Datadog one
 */
function datadogSection({ lead }: { lead: Lead }): readonly string[] {
  if (lead.source !== "datadog") {
    return [];
  }
  return [
    "## Datadog — read the local catalogue BEFORE you run a live query",
    "",
    "```",
    ...DATADOG_LADDER,
    "```",
    "",
    "- **The catalogue is free and the live ladder is not.** `datadog catalogue show` costs no network; a",
    "  live search is metered at 3 requests per 10 seconds on this site (MEASURED). Read the",
    "  shapes, work out which query is worth running, then run it. The shape row carries the exact query",
    "  that reproduces it — paste that rather than inventing one.",
    "- **Every environment, by default.** No `--env` means production, staging and the events whose env tag",
    "  is wrong or missing — the owner's own ruling, because some of this organisation's logs carry the",
    "  wrong env key or none. Narrow with `--env` only when you mean to, and say so in your report.",
    "- **Datadog keeps about fifteen days.** A zero over an older window means NOT RETAINED, never no",
    "  events. The verbs refuse a window past retention rather than returning that zero.",
    "- **Datadog has no regex.** `--regex` on `store hits --source datadog` pulls a bounded page and matches",
    "  HERE, so a pattern that matches nothing on page one has not proven the term is absent.",
    "- **`around --mode ip` is a real move.** An event with a `session.ip` and no `usr.id` is the start of a",
    "  correlation: find what else came from that IP and check whether any of it carried a uid.",
    "- **What you read is UNREDACTED and what you report must not be.** Usernames, emails, IPs and session",
    "  ids come back whole, by the owner's ruling, because redacting mid-investigation is a hindrance. Your",
    "  report is read by the session that composes the answer — quote what you must and say when a quote",
    "  carries identity, so the composer knows to redact it before anything reaches Slack.",
    "",
  ];
}

/**
 * The atlas section of a brief.
 *
 * @param lead the detective's starting lead
 * @returns the lines, or nothing when this detective's lead is not an atlas one
 */
function atlasSection({ lead }: { lead: Lead }): readonly string[] {
  if (lead.source !== ATLAS_LEAD_SOURCE) {
    return [];
  }
  return [
    "## The atlases — a count is of STORED records, never of what a provider holds",
    "",
    "```",
    ...ATLAS_LADDER,
    "```",
    "",
    "- **An atlas is what this organisation's platforms CONTAIN, and it is distinct from the corpus.** The",
    "  corpus is what people said; an atlas is what exists — a user, a group, a repository setting, an",
    "  application, an API operation. `store probe` cannot see any of it and `atlas probe` cannot see the",
    "  corpus. If your question has both halves, climb both ladders and say which answered which.",
    "- **A ZERO is not a provider holding none.** It is this store holding none, which has three different",
    "  causes you must tell apart before you report one: the kind was never synced, the sync failed, or the",
    "  thing genuinely is not there. `atlas <platform> coverage` is what distinguishes them, and it is the",
    "  reason an absence costs you one more command than a presence does.",
    "- **A count is of records, and the records may be stale.** Your lead carries the widest cell's last",
    "  successful sync. Run `atlas freshness <platform>` before you quote a number as the present state, and",
    "  say in your report how old it is. Stale is a reason to say so, never a reason to hedge everything.",
    "- **Some atlases are SURFACE MAPS, not entity stores.** The github atlas holds settings, operations and",
    "  admin pages rather than the repositories and pull requests the corpus holds. Read what the platform's",
    "  own `--help` says it is before you conclude an entity count means what its name suggests.",
    "- **A `detail` hit is the provider's own opaque JSON.** MEASURED: the keyword `password`",
    "  matches 1,804 jumpcloud application templates, which is a true fact about vendor metadata and not a",
    "  finding about this organisation's password posture. Open the entity before you believe the match.",
    "- **What you read is UNREDACTED and what you report must not be.** An atlas carries real user records,",
    "  emails and group memberships. Quote what your report needs, and say when a quote carries identity so",
    "  the composing session knows to redact it before anything reaches Slack.",
    "",
  ];
}

/**
 * The name section of a brief, blank-line-terminated so the caller's own layout does not change when no
 * name step ran.
 *
 * @param finding what the pre-planning variant probe came to, or nothing when it did not run
 * @returns the lines, or nothing at all
 */
function nameSection({ finding }: { finding: NameFinding | null }): readonly string[] {
  const lines = nameFindingLines({ finding });
  return lines.length === 0 ? [] : [...lines, ""];
}

/**
 * Where an atlas detective opens.
 *
 * Its own function rather than a third arm inside {@link openingLine} because that function is what the
 * `cognitive-complexity` gate measured at the ceiling the moment a third source arrived: each arm is a flat
 * template with one branch, and the score is the COUNT of arms rather than anything about any one of them.
 *
 * @param lead the detective's starting lead
 * @returns the opening instruction
 */
function atlasOpening({ lead }: { lead: Lead }): string {
  const opener = `Your lead is in an ATLAS, not in the corpus: ${lead.why}.`;
  const closer = [
    "The atlas says what EXISTS. The corpus says what people said about it. If the question needs both,",
    "climb the store ladder too and say which source answered which half.",
  ];
  if (lead.startShape === null) {
    return [
      opener,
      "No one platform carries it, so start from `slopweaver atlas probe` yourself and find which does.",
      ...closer,
    ].join("\n");
  }
  // A lead carrying a platform but no keyword cannot come out of `atlasLeads` — a platform only buckets when
  // a keyword reached it — so this asks `read` for the platform alone rather than for an empty query.
  const query = lead.keyword === null ? "" : ` --query "${lead.keyword}"`;
  return [
    opener,
    `Open at \`slopweaver atlas ${lead.startShape} read${query}\`, and read that atlas's own \`--help\``,
    "first — some of them map SURFACES rather than storing the entities their name suggests.",
    ...closer,
  ].join("\n");
}

/**
 * The line naming where a detective opens, for a lead that has a keyword.
 *
 * @param lead the detective's starting lead
 * @returns the opening instruction
 */
function openingLine({ lead }: { lead: Lead }): string {
  if (lead.source === "datadog") {
    return [
      `Your lead is in DATADOG, not in the store: ${lead.why}.`,
      lead.startShape === null
        ? "No one service carries it, so start from the catalogue itself and find which does."
        : `Open at \`slopweaver datadog catalogue show --service ${lead.startShape}\` and read what that service`,
      lead.startShape === null ? "" : "actually emits before you run a single live query.",
      "The store may also hold something about this — leave Datadog the moment the evidence points there.",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }
  if (lead.source === "hex") {
    return [
      `Your lead is in HEX, the workspace over the warehouse: ${lead.why}.`,
      lead.startShape === null
        ? "No one project carries it, so start from `slopweaver hex projects` and find which does."
        : `Open at \`slopweaver hex project --project ${lead.startShape} --tables\`, then read its cells' SQL`,
      lead.startShape === null ? "" : "before you read a single number out of it.",
      "Hex is the LONG view. If this question is about who was affected, it is the source that still sees",
      "past Datadog's fifteen days.",
    ]
      .filter((line) => line.length > 0)
      .join("\n");
  }
  if (lead.source === ATLAS_LEAD_SOURCE) {
    return atlasOpening({ lead });
  }
  if (lead.keyword === null) {
    return [
      "You are the DISCOVERY detective. You have no keyword and no source on purpose.",
      "Ask the question in words nobody in the probe used: the vocabulary people use while living a",
      "problem is rarely the vocabulary used to ask about it. If a name section appears below, the forms it",
      "lists are the ones already probed — your job is the form nobody proposed, not a re-run of those. And",
      "challenge every exclusion the recalled claims below propose — if one of them is wrong, you are the",
      "only detective positioned to find out.",
    ].join("\n");
  }
  return [
    `Your lead: the keyword "${lead.keyword}" in ${absentAs({ value: lead.source, whenAbsent: "the whole store" })}.`,
    `${lead.why}.`,
    `Open at that shape — it is the narrowest one that found anything, which is where the signal is —`,
    `then widen only when it runs out. Leave your source the moment the evidence points elsewhere: the`,
    `lead is where you START, never a boundary you may not cross.`,
  ].join("\n");
}

/**
 * The six things a detective may never do, as the brief spells them.
 *
 * Its own section rather than lines inside {@link renderBrief} because each entry is a RULE with a
 * history — two are owner rulings, the `turn`-verb and filesystem-walk lines are a live wave measured
 * (`src/cli/commands/turn/watchLock.ts`), and the last was found by dogfooding this path — so
 * they are read and edited as a set rather than as prose in the middle of a template.
 *
 * @returns the prohibitions block
 */
function prohibitions(): readonly string[] {
  return [
    "## What you may not do",
    "",
    "- You never spawn another agent. The fan-out is FLAT, by the owner's ruling — you are a leaf.",
    "- You never post anything anywhere. You write a report and stop.",
    "- **You never run a `turn` verb** — not `resume`, `watch`, `status`, `review` nor `answer`, and you never",
    "  draft the answer. The request relayed above your task is the WORKER's, and those steps are its own.",
    "- **You never walk the filesystem** — no `find`, `grep -r` or `ls -R` over a home or code directory. The",
    "  store is the index; one walk of a code directory held more than a core for two minutes and found nothing.",
    "- You never claim a connection you cannot show. A shared word is not a link between a finding and a",
    "  person, a ticket or a release.",
    "- **You never answer from the bot's own earlier answer.** A message this bot already posted is a",
    "  stored record like any other, it contains the question's own words, so it ranks for the very",
    "  question you were sent to investigate. It is a HYPOTHESIS — exactly as a recalled lesson is — and",
    "  never evidence. Verify each of its claims against a record someone OTHER than this bot wrote, and",
    "  say in your report which ones you could and could not reach. Finding one is worth reporting: it",
    "  tells the wave this ground has been walked. Citing one as your answer is the failure it looks",
    "  most like success.",
  ];
}

/**
 * Render one detective's whole brief.
 *
 * @param lead what this detective starts on
 * @param context the question, the recalled claims, and where to write
 * @returns the brief, ready to hand to a sub-agent verbatim
 */
export function renderBrief({ lead, context }: { lead: Lead; context: BriefContext }): string {
  const recalled =
    context.recalled.length === 0
      ? "Nothing was recalled for this question. That means nobody has paid for a lesson here yet — not\nthat there are no traps."
      : [
          "What the fleet has learned before, on questions like this one. EVERY LINE BELOW IS A",
          "HYPOTHESIS, NOT EVIDENCE. A claim marked confirmed means it was observed once, not that it is",
          "true now. If one of them proposes excluding something, re-check a sample of what it would have",
          "excluded BEFORE you believe it, and say in your report whether it held:",
          "",
          ...context.recalled.map((line) => `  - ${line}`),
        ].join("\n");
  return [
    `# Detective ${String(context.index)} of ${String(context.total)}`,
    "",
    `The question: ${context.question}`,
    "",
    openingLine({ lead }),
    "",
    ...nameSection({ finding: context.nameFinding }),
    "## Your tools — use these, never hand-written SQL",
    "",
    "```",
    ...LADDER,
    "```",
    "",
    "Read the counts before you read any record. A shape that found four records and a shape that found a",
    "million are the same command and completely different situations, and the counts are how you tell.",
    "",
    ...datadogSection({ lead }),
    ...hexSection({ lead }),
    ...atlasSection({ lead }),
    "## What to do that is not searching",
    "",
    "- **`around` is where the answer usually is.** A hit is a lead; the thing that explains it is very",
    "  often the reply under it, which contains none of your search terms. Read around anything promising.",
    "- **Follow the links.** `store open` gives you the URLs a record's text linked to. A Slack message",
    "  linking a Notion page is an instruction to go read that page.",
    "- **Reject junk out loud.** Say why each record you kept earns its place, and drop the rest without",
    "  ceremony. A detective that reports everything it found has reported nothing.",
    "- **Read who raised it.** A record is more informative the more unusual it is that this person",
    "  produced it. You can check that cheaply with `store groups --facet author`.",
    "",
    recalled,
    "",
    ...prohibitions(),
    "",
    "## Your report",
    "",
    `Write it to ${context.reportPath}. Every finding carries the record id it came from and a verbatim`,
    "quote. End with two sections that are not optional: **what I could not establish**, and **what I",
    "would tell the next detective** — a dead end you name is worth as much as a finding, because it is",
    "what stops the next wave spending a slot on it.",
    "",
  ].join("\n");
}
