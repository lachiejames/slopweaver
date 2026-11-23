/**
 * The fleet's own words, each in one plain sentence — what the console voice says when the owner asks what a
 * JumpCloud atlas is.
 *
 * The voice should know pretty much everything the supervisor would know. On a measured Talk transcript the voice
 * answered "I don't have a good answer for what a JumpCloud Atlas actually is — that name isn't explained here."
 *
 * ## One list, two readers
 *
 * {@link TALK_GLOSSARY} is imported by the context pack a sibling seat builds into the voice's instructions at
 * mint time, and read by the `glossary` tool (`slopweaver talk glossary`) when a word is not in the pack. Its
 * name and shape are agreed with that seat, so neither keeps a second copy.
 *
 * ## Where each sentence comes from
 *
 * `docs/what-slopweaver-is.md`, `docs/atlases.md`, `docs/atlas-intent.md`, `AGENTS.md`, and the skill that owns
 * the verb a word names. A sentence here is a pointer's worth, not the doc: a question past it is a
 * `code_read` of that doc.
 */

/** One fleet word and what it means. */
export interface GlossaryEntry {
  /** The word as the owner says it; alternates are separated by " / ". */
  readonly term: string;
  /** One plain sentence. */
  readonly means: string;
  /**
   * The variants of {@link GlossaryEntry.term} the owner does not say themselves — empty when every variant is theirs.
   *
   * Required, so a new entry decides rather than defaulting. `hand post` refuses a floating note whose
   * sentence carries one of these ({@link fleetWordsIn}): a note asking the owner to steer a call that opened with a
   * context pack asks for a task they cannot do without knowing what a context pack is.
   *
   * MEASURED over the owner's 715 distinct recorded turns, header line and `>`-quoted card lines dropped:
   * context pack 0, ask row 0, knowledge row 0, Codex pairing 3, handover doc 4, JumpCloud atlas 5 (one of them
   * the owner's own question about what a JumpCloud atlas is). The files carry the chair's paraphrase too, so a
   * count over-states the owner and only a near-zero one is evidence. Repro: `cd ~/.slopweaver/supervisor-scratch && find .
   * -name 'owner-turn-*.txt' -exec shasum {} + | sort -u -k1,1 | awk '{print $2}' | xargs awk 'FNR>1 && !/^>/' |
   * grep -oiE '\bcontext packs?\b' | wc -l`.
   *
   * **A variant with an ordinary-English sense is never listed**, whatever its count: `door`, `grant`, `lap`,
   * `gold`, `land`, `finding` and `row` are matched bare, so listing one would refuse "Grant the app access".
   * `../briefing/fleetJargon.ts` owns the collocation-sensed half of that problem for cards.
   */
  readonly notOwners: readonly string[];
}

/** Every fleet word the voice should know without looking it up. Ordered for a reader, not for a lookup. */
export const TALK_GLOSSARY: readonly GlossaryEntry[] = [
  {
    means:
      "Slopweaver is the owner's agent fleet plus a local-first world model: steer the supervisor, or tag the bot " +
      "in Slack, and a visible Claude Code or Codex session does the work with every tool it has.",
    notOwners: [],
    term: "Slopweaver",
  },
  {
    means:
      "A pre-built local map of what one SaaS platform actually contains, read from BOTH its API and its " +
      "signed-in browser console, so an investigation looks things up instead of guessing; `slopweaver atlas " +
      "<platform> read` and `coverage` query it, and it lives under ~/.slopweaver/atlas/<platform>.",
    notOwners: [],
    term: "atlas",
  },
  {
    means:
      "The atlas of the organisation's JumpCloud tenancy (the identity and device-management platform): its " +
      "devices, people, groups, admin-authored policies, applications and SaaS accounts, walked read-only from " +
      "the Directory API; it serves the owner's ISO 27001 work such as who owns each failing Vanta device and malware " +
      "detection per device. Its current state is `slopweaver atlas jumpcloud coverage`, never this sentence.",
    notOwners: ["JumpCloud atlas"],
    term: "JumpCloud atlas",
  },
  {
    means:
      "The pinned supervisor chat: the owner's single intake, which reads every source of state, briefs them, and " +
      "routes each instruction to a session; the owner only talks to it, so a relay from it is their word.",
    notOwners: [],
    term: "supervisor",
  },
  {
    means: "The supervisor's seat itself: the one pinned cmux workspace running the supervisor chat, on Fable.",
    notOwners: [],
    term: "chair",
  },
  {
    means:
      "One pass of the supervisor loop: it reads the board, pull requests, sessions and the owner's turns, acts " +
      "on what is obvious, and records a numbered turn.",
    notOwners: [],
    term: "tick",
  },
  {
    means:
      "The one register of all work in flight: every handover doc, ASK row and unanswered Slack tag, ranked " +
      "together; `slopweaver handover list` prints it.",
    notOwners: [],
    term: "board",
  },
  {
    means:
      "A markdown doc on the board that another session can pick up and execute: a slug, a summary, the owner's words, " +
      "a checklist and probes that prove it done; a RUN is one execution of it, journalled.",
    notOwners: ["handover doc"],
    term: "handover / row / handover doc",
  },
  {
    means:
      "A board row that is a question waiting on the owner's word: it carries the words that started it, options A/B/C " +
      "with trade-offs, and the fleet's lean.",
    notOwners: ["ask row"],
    term: "ask / ask row",
  },
  {
    means:
      "Something surfaced for the owner's reaction: a queue item on the console, a react-now entry in the briefing, " +
      "or a floating macOS note for a step only the owner's hands can take.",
    notOwners: [],
    term: "card",
  },
  {
    means:
      "The briefing section of cards that need the owner's judgement right now; everything obvious is done without " +
      "asking and only items needing the owner's judgement land there.",
    notOwners: [],
    term: "react-now",
  },
  {
    means:
      "A visible Claude Code or Codex session opened in a cmux workspace to work one board row; seating one is " +
      "`cmux spawn` or `automation seat`.",
    notOwners: [],
    term: "seat",
  },
  {
    means:
      "The terminal multiplexer app every session runs in; each workspace is a tab with a sidebar row the owner reads, " +
      "and the supervisor's is pinned.",
    notOwners: [],
    term: "cmux",
  },
  {
    means:
      "A check that refuses a change or an act — a lint rule in `yarn lint`, a CI job, a hook, or a verb's own " +
      "guard; a refusal names why and its escape hatch.",
    notOwners: [],
    term: "gate",
  },
  {
    means:
      "The designated override for a policy refusal: an env var such as SLOPWEAVER_ALLOW_<X>=1, a flag, or a " +
      "journalled `slopweaver hatch open`.",
    notOwners: [],
    term: "hatch / escape hatch",
  },
  {
    means:
      "The single route every Slack, GitHub, Linear and Vanta read or write goes through — the `slopweaver` verbs " +
      "and skills, never raw curl, gh, an MCP tool or a hand-driven browser.",
    notOwners: [],
    term: "door",
  },
  {
    means:
      "Merging a pull request: `github landing` reads each open PR of the owner's and says the one next act, and a green, " +
      "gold-anchored one is enqueued on the merge queue unasked.",
    notOwners: [],
    term: "landing / land",
  },
  {
    means:
      "One full cycle of taking a pull request to merge — rebase, CI, review, enqueue; also one full run of a " +
      "gate suite or a loop.",
    notOwners: [],
    term: "lap",
  },
  {
    means:
      "Two things share these words: the corpus tiers (bronze is raw ingested records, silver is the derived " +
      "directory and cross-references, gold is distilled markdown), and a pull request's proof grade (gold is " +
      "evidence gathered against the exact commit merged; silver or bronze may merge when gold was not feasible, " +
      "leaving gold owed).",
    notOwners: [],
    term: "gold / silver / bronze",
  },
  {
    means:
      "A continuous visible session: `loop` is the bot live in Slack answering tags as they arrive; the " +
      "supervisor loop is the chair's recurring tick.",
    notOwners: [],
    term: "loop",
  },
  {
    means:
      "An automation, what the Automations page lists and what was once called a scheduled ask: a cadence plus " +
      "a command or a session to seat, kept under ~/.slopweaver/live/recipe; `automation seat` opens a visible " +
      "session for the due ones.",
    notOwners: [],
    term: "automation / recipe",
  },
  {
    means:
      "A row in the knowledge register — one thing an investigation learned the hard way, with its verdict, what " +
      "was measured and the command that settles it again; `slopweaver knowledge recall` reads it.",
    notOwners: ["knowledge row"],
    term: "knowledge row",
  },
  {
    means:
      "Something a fleet session noticed on its own, not something the owner asked for — recorded as a board row or a " +
      "knowledge row; a fleet-found fix to this repo lands on judgement with a ledger row.",
    notOwners: [],
    term: "finding",
  },
  {
    means:
      "A journalled row recording a decision the owner already made, which the performing session reads " +
      "with `slopweaver grant show` instead of waiting for keystrokes.",
    notOwners: [],
    term: "grant",
  },
  {
    means:
      "One of the Claude subscription accounts the fleet rotates across; plan-five is the fifth, enrolled with " +
      "`slopweaver claude signin --enroll plan-five`.",
    notOwners: [],
    term: "plan-five / plan",
  },
  {
    means:
      "The owner's web console at localhost: Queue, Alignment (steers included), Pull requests, Workstreams, Automations and " +
      "Fleet in its sidebar, Setup, Settings and Docs at its foot, with Machine a link away, every reading a " +
      "slopweaver verb run on this machine.",
    notOwners: [],
    term: "console",
  },
  {
    means:
      "The owner's own Slack bot identity; an unasked post from the fleet goes to the owner's bot DM and the owner " +
      "shares it.",
    notOwners: [],
    term: "the bot",
  },
  {
    means:
      "The local store of the team's GitHub, Slack, Linear and Notion history (plus the owner's mail, diary and calls " +
      "when named), which a turn reads as evidence; it never authors the answer.",
    notOwners: [],
    term: "corpus / world model",
  },
  {
    means: "Codex (OpenAI) plans and reviews every non-trivial change while Claude writes every line (rule 9).",
    notOwners: ["Codex pairing"],
    term: "Codex pairing",
  },
  {
    means:
      "What the console voice is handed when a call opens: the board, recent turns, commit subjects, this " +
      "glossary and recalled knowledge, each cut to a byte budget; `slopweaver talk pack` builds it.",
    notOwners: ["context pack"],
    term: "context pack",
  },
];

/** The entry the install's own bot handles join as variants — the glossary itself names no bot. */
const BOT_TERM = "the bot";

/**
 * The glossary as this install reads it: {@link TALK_GLOSSARY}, with each of the bot's own Slack handles
 * (`profile.json`'s `slackBot.selfHandles`) a further variant of {@link BOT_TERM}, so a turn naming the bot by
 * handle finds its entry.
 *
 * @param botHandles the install's own bot handles; empty leaves the shipped glossary as it is
 * @returns the entries, in the shipped order
 */
export function installGlossary({ botHandles }: { botHandles: readonly string[] }): readonly GlossaryEntry[] {
  const handles = botHandles.filter((handle) => handle.trim() !== "");
  if (handles.length === 0) {
    return TALK_GLOSSARY;
  }
  return TALK_GLOSSARY.map((entry) =>
    entry.term === BOT_TERM ? { ...entry, term: [BOT_TERM, ...handles].join(" / ") } : entry,
  );
}

/**
 * The words in a sentence that are the fleet's and not the owner's, each with what it means.
 *
 * Only {@link GlossaryEntry.notOwners} variants count, matched as whole words with a plural — so "open the
 * context pack" hits and "pack the context" does not.
 *
 * @param text the sentence the owner will read
 * @param entries the list to search; the shipped glossary unless a test hands another
 * @returns every matched variant with its entry, in glossary order; empty when the sentence is all the owner's
 */
export function fleetWordsIn({
  text,
  entries = TALK_GLOSSARY,
}: {
  text: string;
  entries?: readonly GlossaryEntry[];
}): readonly { word: string; entry: GlossaryEntry }[] {
  const said = normalise({ text });
  return entries.flatMap((entry) =>
    entry.notOwners
      .filter((word) => containsWords({ haystack: said, needle: normalise({ text: word }) }))
      .map((word) => ({ entry, word })),
  );
}

/**
 * The glossary entries a question names, best match first.
 *
 * An entry matches when one of its " / " variants appears in the question as whole words, or the question is
 * itself a word inside a variant — so "what is a JumpCloud atlas" returns "JumpCloud atlas" and "atlas", and a
 * bare "gold" returns "gold / silver / bronze". A longer variant ranks first, because it is the more specific
 * answer.
 *
 * @param query what the owner asked about, in any case
 * @param entries the list to search; the shipped glossary unless a test hands another
 * @returns the matching entries, the most specific first; empty when nothing matches
 */
export function glossaryMatches({
  query,
  entries = TALK_GLOSSARY,
}: {
  query: string;
  entries?: readonly GlossaryEntry[];
}): readonly GlossaryEntry[] {
  const asked = normalise({ text: query });
  if (asked === "") {
    return [];
  }
  const scored: { entry: GlossaryEntry; length: number }[] = [];
  for (const entry of entries) {
    const variants = entry.term.split(" / ").map((variant) => normalise({ text: variant }));
    const hits = variants.filter(
      (variant) =>
        containsWords({ haystack: asked, needle: variant }) || containsWords({ haystack: variant, needle: asked }),
    );
    if (hits.length > 0) {
      scored.push({ entry, length: Math.max(...hits.map((hit) => hit.length)) });
    }
  }
  return scored.toSorted((a, b) => b.length - a.length).map((row) => row.entry);
}

/** Lowercase, punctuation to spaces, single-spaced. */
function normalise({ text }: { text: string }): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, " ")
    .trim();
}

/** Whether `needle` occurs in `haystack` on word boundaries, a plural included. Both are already normalised. */
function containsWords({ haystack, needle }: { haystack: string; needle: string }): boolean {
  if (needle === "") {
    return false;
  }
  const padded = ` ${haystack} `;
  return padded.includes(` ${needle} `) || padded.includes(` ${needle}s `) || padded.includes(` ${needle}es `);
}
