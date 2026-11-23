/**
 * Candidate workstreams mined from the owner's own words, the owner's one-word reaction to each, and what a yes becomes.
 *
 * The owner goes through a list of about 100 things that have potentially work streams and answers each one. A session
 * reads the owner's Slack messages and transcripts and writes the candidates (`candidates.json`, one bounded
 * document); the owner answers each with one of five words; every answer is a row in `reactions.jsonl`, the latest
 * row per candidate standing, so the owner can change their mind.
 *
 * ## A yes becomes a register entry by mechanism
 *
 * A yes lands somewhere the Workstreams seat can read, so a yes becomes a register entry. So a yes
 * is promoted at once into a `standing` tile with status `discovery`, its timeline the candidate's own cited
 * evidence. The story fields a candidate cannot know — who agreed, the team, the numbers — read {@link STORY_OWED},
 * one named absence rather than an invented value, and `./candidatesDocument.ts` lists every tile still carrying
 * it as the seat's work. A later no never deletes a tile: it is a RETRACTION for the seat to act on.
 *
 * Pure: the schemas and a candidate's identity across a re-mine; the fold is `./reactionFold.ts`. The batch parser is
 * `./reactionBatch.ts`, the promotion `./promotion.ts`, and `./candidateStore.ts` the effectful half (the write of the owner's reactions is `./reactionStore.ts`).
 */
import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { boardMembershipSchema } from "./boardMembership.js";
import { type CandidatesError, CandidatesErrors } from "./candidateErrors.js";
import { REACTIONS, type Reaction } from "./reactionWords.js";
import { workspaceSchema } from "./schema.js";
import { slackChannelOf } from "./slackChannel.js";

export { REACTIONS, type Reaction } from "./reactionWords.js";

/** Where a reaction came from: a console press, words the owner said or typed and a session relayed, or a session's read. */
export const REACTION_VIAS = ["console", "word", "session"] as const;

/** One of the places a reaction came from. */
export type ReactionVia = (typeof REACTION_VIAS)[number];

/** The value a promoted tile carries in every story field a candidate cannot know, until the seat writes it. */
export const STORY_OWED = "not yet read — the Workstreams seat owes this";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a date is YYYY-MM-DD")
  .refine((date) => {
    const instant = Date.parse(`${date}T00:00:00Z`);
    return !Number.isNaN(instant) && new Date(instant).toISOString().startsWith(date);
  }, "a date is a day the calendar has");

/**
 * Text the file keeps: trimmed, non-empty, and well-formed Unicode — a lone surrogate prints as U+FFFD, so a reading
 * could never say it as held.
 */
export const textSchema = z
  .string()
  .trim()
  .min(1)
  .refine((text) => text.isWellFormed(), "text is well-formed Unicode, with no lone surrogate");

/** A candidate's (or a register entry's) kebab-case id. */
export const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "an id is kebab-case");

/**
 * The longest a candidate id may be — the bound the console's relay already holds it to
 * (`site/lib/talkRelayRequestWire.ts`'s `CANDIDATE_ID`, `relay_steer`'s `maxLength`), so every id the file accepts can
 * carry a spoken ruling and fits a listing line ahead of the ruling it names. Every
 * mined id is `c-NNN`.
 */
const CANDIDATE_ID_MAX_CHARS = 80;

/** A candidate's id: kebab-case, and short enough to carry a spoken ruling. */
export const candidateIdSchema = idSchema.max(
  CANDIDATE_ID_MAX_CHARS,
  `a candidate id is at most ${String(CANDIDATE_ID_MAX_CHARS)} characters`,
);

const evidenceSchema = z
  .strictObject({
    anchor: textSchema.nullable(),
    date: dateSchema,
    href: z
      .string()
      .regex(/^https:\/\//, "an evidence link is https://")
      .nullable(),
    quote: textSchema,
  })
  .refine((one) => one.href !== null || one.anchor !== null, {
    message: "evidence carries a link or an anchor, so it can be checked",
    path: ["href"],
  });

/**
 * What a definition-of-done option judges done by: the `result` itself (we are ISO certified), the `people` it
 * changes (the team embeds ISO in how it works and reaches for the policies), or its `adoption` — teammates reaching
 * for it unprompted. A workstream's definition of done includes these people being across it
 * and owning it, the change-management half other tools skip; and for a PR label, it is working well when
 * other people are selling it for you. Typed rather than left to the mining prose, so a candidate cannot offer only
 * result options.
 */
export const DONE_LENSES = ["result", "people", "adoption"] as const;

/**
 * One way the workstream could count as done, and what choosing it costs. Presenting some options
 * for them to react to, with the tradeoffs of each one, is useful: a person reveals what they actually think done
 * means by reacting to the right options.
 *
 * `text` is the floor; `stretch` the rung beyond it, often a public sentence from someone else. For
 * load testing, that is catching a regression pre-merge, which is all a win would look like; and going beyond that,
 * someone else saying in public that this prevented an incident or saved them time.
 */
const doneOptionSchema = z.strictObject({
  id: idSchema,
  lens: z.enum(DONE_LENSES),
  stretch: textSchema.nullable().default(null),
  text: textSchema,
  tradeoff: textSchema,
});

/** What looks stalled, from the evidence, and the day it stopped moving. */
const stalledSchema = z.strictObject({ since: dateSchema, what: textSchema });

/**
 * A steer of the owner's the candidate matches, dated, with where it was given. The miner reads the owner's earlier
 * steers and every tile shows the ones it answers before the owner reacts.
 */
const priorSteerSchema = z.strictObject({ anchor: textSchema, date: dateSchema, text: textSchema });

/**
 * The team that owns it, kept apart from the people the first conversation is with. Who to loop in is two
 * answers: the team, and, separately, the people the first conversation is with.
 */
const owningTeamSchema = z.strictObject({ name: textSchema, why: textSchema });

/**
 * A person the FIRST conversation is with — who needs to be across the workstream and owning it — and that
 * conversation, owed before work starts, made visible. `opener` is the first message, drafted in the miner's best
 * guess at the person's own voice; `workstreams loop-in` parks it on the Queue, never sends. The team that owns it
 * is {@link owningTeamSchema}, apart.
 */
const loopInSchema = z.strictObject({
  name: textSchema,
  opener: textSchema,
  slack: z.string().regex(/^[UW][A-Z0-9]{6,}$/u, "a person is their Slack member id"),
  why: textSchema,
});

/** One candidate as a candidates document carries it. */
export const candidateSchema = z
  .strictObject({
    /**
     * Which board rows sit under the outcome once the owner keeps it (`./boardMembership.ts`), carried onto the tile a keep
     * writes so the supervisor's coverage reads it off the register; `null` when the candidate proposes none, and on a
     * candidate written before it existed.
     */
    boardMembership: boardMembershipSchema.nullable().default(null),
    /**
     * Two or three ways it could count as done, at least one judged by its `people`; none on a candidate mined before
     * options existed, which reads as none rather than refusing the owner's file.
     */
    doneOptions: z.array(doneOptionSchema).default([]),
    evidence: z.array(evidenceSchema).min(1),
    evidenceCount: z.number().int().nonnegative(),
    first: dateSchema,
    id: candidateIdSchema,
    inRegister: idSchema.nullable(),
    last: dateSchema,
    /** The people owed a conversation before work starts; none on a candidate mined before this existed. */
    loopIn: z.array(loopInSchema).default([]),
    n: z.number().int().positive(),
    name: textSchema,
    outcome: textSchema,
    /** The team that owns it, or `null` when the evidence names none; absent on an older candidate. */
    owningTeam: owningTeamSchema.nullable().default(null),
    /** Everyone the evidence shows involved, by name — wider than {@link loopInSchema}'s people owed a conversation. */
    people: z.array(textSchema),
    /** The owner's earlier steers this candidate answers, oldest first; none on an older candidate. */
    priorSteers: z.array(priorSteerSchema).default([]),
    /**
     * The proposal of the owner's this candidate was mined from (`./proposals.ts`), or `null` for one mined from the history
     * alone; absent on an older candidate.
     */
    proposal: idSchema.nullable().default(null),
    /** What looks stalled, or `null` when the evidence shows nothing stopped; absent on an older candidate. */
    stalled: stalledSchema.nullable().default(null),
    theme: textSchema,
    /** Which workspace a yes files the tile under, stated by the miner because the register requires it stated. */
    workspace: workspaceSchema,
  })
  .refine((one) => one.first <= one.last, { message: "first is on or before last", path: ["last"] })
  .refine((one) => one.doneOptions.length === 0 || (one.doneOptions.length >= 2 && one.doneOptions.length <= 3), {
    message: "a candidate offers two or three definitions of done, or none",
    path: ["doneOptions"],
  })
  .refine((one) => one.doneOptions.length === 0 || one.doneOptions.some((option) => option.lens === "people"), {
    message: "at least one definition of done is judged by the people it changes (lens people)",
    path: ["doneOptions"],
  })
  .refine((one) => new Set(one.doneOptions.map((option) => option.id)).size === one.doneOptions.length, {
    message: "each definition of done has its own id",
    path: ["doneOptions"],
  })
  .refine((one) => new Set(one.loopIn.map((person) => person.slack)).size === one.loopIn.length, {
    message: "each person to loop in appears once",
    path: ["loopIn"],
  });

/**
 * What the mining pass read, per source, as the session that mined it counted — provenance, never a claim the crawl
 * reached the end of that source. Absent on a file mined before this existed.
 */
const minedSourceSchema = z.strictObject({ recordsRead: z.number().int().nonnegative(), source: textSchema });

/** The whole candidates file. */
const candidatesFileSchema = z.strictObject({
  candidates: z.array(candidateSchema).min(1),
  /**
   * Every Slack conversation the evidence links into, by id, with the words the owner knows it by. The register refuses a
   * Slack link into a conversation its own `channels` does not name, so a yes carries these names onto it.
   */
  channels: z.record(z.string().regex(/^[CGD][A-Z0-9]{6,}$/u, "a channel is its Slack conversation id"), textSchema),
  minedFrom: textSchema,
  minedIso: z.iso.datetime(),
  minedSources: z.array(minedSourceSchema).default([]),
  schemaVersion: z.literal(1),
});

/** The words a row may say why with. */
export const WORDS_WITH_A_REASON: ReadonlySet<Reaction> = new Set<Reaction>([
  "abandoned",
  "done",
  "milestone-of",
  "no",
  "outcome-of",
  "superseded",
]);

/** One reactions.jsonl row. */
export const reactionRowSchema = z
  .strictObject({
    anchor: textSchema.nullable(),
    bySession: textSchema,
    candidate: candidateIdSchema,
    /**
     * The owner's words as heard when ruling, so a later reading can NAME the ruling rather than only its kind; `null` on a
     * press, and on a row written before the words were kept.
     */
    heard: textSchema.nullable().default(null),
    iso: z.iso.datetime(),
    /** The candidate's name when the owner answered it: what pins the id to one workstream across a re-mine. */
    name: textSchema,
    /** The register entry a yes became, or `null` — a yes on a candidate already in the register promotes nothing. */
    promotedAs: idSchema.nullable(),
    reaction: z.enum(REACTIONS),
    /**
     * The owner's words on why: required on abandoned, optional on done and no. Absent on a row written before endings
     * existed, so it reads as `null`.
     */
    reason: textSchema.nullable().default(null),
    /** The register workstream a `same-as` names as this one. */
    sameAs: idSchema.nullable().default(null),
    /** The register workstream a `milestone-of` files this one inside, as one of its own milestones. */
    milestoneOf: idSchema.nullable().default(null),
    /** The register workstream an `outcome-of` names this one an outcome of. */
    outcomeOf: idSchema.nullable().default(null),
    /** What replaced it, in the owner's words, on a `superseded` — a workstream, a tool, a decision; kept with its reason. */
    supersededBy: textSchema.nullable().default(null),
    /**
     * The earlier steer of the owner's a yes matches, in the owner's words: a yes can accept one as "taking inspiration
     * from what works in Slopweaver", a steer already given, so the tile shows the steer it answers.
     */
    steer: textSchema.nullable().default(null),
    /** Whose it is, on a `no` that declines it as someone else's — kept as the reason, never dropped. */
    owner: textSchema.nullable().default(null),
    /** The register workstream that covers it as a side effect, on a `no`. */
    coveredBy: idSchema.nullable().default(null),
    via: z.enum(REACTION_VIAS),
  })
  .refine((row) => row.reaction !== "abandoned" || (row.reason !== null && row.anchor !== null), {
    message: "an abandoned row carries why, and the anchor where the owner said it",
    path: ["reason"],
  })
  .refine((row) => WORDS_WITH_A_REASON.has(row.reaction) || row.reason === null, {
    message: "only an abandoned, done, milestone-of, outcome-of, superseded or no row carries a reason",
    path: ["reason"],
  })
  .refine((row) => (row.reaction === "outcome-of") === (row.outcomeOf !== null), {
    message: "an outcome-of row names the workstream it is an outcome of (outcomeOf), and only that row does",
    path: ["outcomeOf"],
  })
  .refine((row) => (row.reaction === "superseded") === (row.supersededBy !== null), {
    message: "a superseded row names what replaced it (supersededBy), and only that row does",
    path: ["supersededBy"],
  })
  .refine((row) => (row.reaction === "same-as") === (row.sameAs !== null), {
    message: "a same-as row names the workstream it is (sameAs), and only a same-as row does",
    path: ["sameAs"],
  })
  .refine((row) => (row.reaction === "milestone-of") === (row.milestoneOf !== null), {
    message: "a milestone-of row names the workstream it is a milestone of (milestoneOf), and only that row does",
    path: ["milestoneOf"],
  })
  .refine((row) => row.reaction === "no" || (row.owner === null && row.coveredBy === null), {
    message: "only a no names whose it is (owner) or what covers it (coveredBy)",
    path: ["owner"],
  })
  .refine((row) => row.reaction === "yes" || row.steer === null, {
    message: "only a yes names the earlier steer it matches",
    path: ["steer"],
  });

/**
 * Every answered id a new candidates set would hand to a different workstream. A row, its `promotedAs` and a
 * tile's `mined:<id>` tag all key on the candidate id, so a re-mine that renumbers would move the owner's yes onto whatever
 * now carries the id: absorbed by the wrong tile, retracted against it, and the real one promoted twice. The set is
 * refused instead. Both directions: every answered candidate is carried forward under its id and name, and no other
 * id takes an answered name — a re-mine that renumbered an answered workstream would otherwise leave the owner's yes on an id
 * nothing carries and offer the same workstream again, unanswered, for a second tile.
 *
 * A definition the owner picked or a title the owner gave commits a candidate exactly as a word does, so every ledger's rows are
 * passed.
 *
 * @param file the candidates about to be written, as the whole catalog they join (`./candidateCatalog.ts`), so an
 * answered stated candidate is never read as dropped by a mined file that does not carry it
 * @param rows every reaction, definition and title row recorded so far — each pins one candidate id to the name it had
 * @param formerNames a stated candidate's previous exact title, keyed by its id (the stated file's `formerNames`): a
 * row answered under exactly that title is the same candidate under the same id, never a rename
 * @returns one problem per answered candidate dropped, renamed or reissued, empty when the set keeps them all
 */
export function answeredIdConflicts({
  file,
  formerNames,
  rows,
}: {
  file: { readonly candidates: readonly Candidate[] };
  formerNames: ReadonlyMap<string, string>;
  rows: readonly { readonly candidate: string; readonly name: string }[];
}): readonly string[] {
  const answered = new Map(rows.map((row) => [row.candidate, row.name] as const));
  const byId = new Map(file.candidates.map((candidate) => [candidate.id, candidate] as const));
  const keep = "carry an answered candidate forward under its id and name, and give a new one a fresh id and name";
  const problems: string[] = [];
  for (const [id, name] of answered) {
    const now = byId.get(id);
    const said = name.normalize("NFKC").trim();
    const answeredUnderFormer = formerNames.get(id)?.normalize("NFKC").trim() === said;
    if (now === undefined) {
      problems.push(`${id} "${name}" is answered but this set drops it — ${keep}`);
    } else if (now.name.normalize("NFKC").trim() !== said && !answeredUnderFormer) {
      problems.push(`${id} was answered as "${name}" but this set names it "${now.name}" — ${keep}`);
    }
  }
  const answeredAs = new Map([...answered].map(([id, name]) => [sameNameKey({ name }), id] as const));
  for (const candidate of file.candidates) {
    const owner = answeredAs.get(sameNameKey({ name: candidate.name }));
    if (owner !== undefined && owner !== candidate.id) {
      problems.push(`${candidate.id} reissues "${candidate.name}", answered as ${owner} — ${keep}`);
    }
  }
  return problems;
}

export type CandidatesFile = z.infer<typeof candidatesFileSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
/** One definition-of-done option on a candidate. */
export type DoneOption = z.infer<typeof doneOptionSchema>;
/** One person a candidate owes a conversation. */
export type CandidateLoopIn = z.infer<typeof loopInSchema>;
export type ReactionRow = z.infer<typeof reactionRowSchema>;

/**
 * When two DIFFERENT candidates' names are one workstream: every letter, mark and digit in any script, normalised and
 * lowercased, the rest folded to single hyphens, never cut. Used only where matching too much costs a refusal (a
 * duplicate within a set, an answered name reissued under another id); whether an answered candidate was RENAMED is
 * judged on its exact name instead, since a loose match there would hand the owner's yes to a different workstream. Not
 * `./promotion.ts`'s id key, which drops every non-ASCII letter and cuts at 60 characters to build an id.
 *
 * @returns the identity key; a name of only punctuation keys as itself, trimmed
 */
function sameNameKey({ name }: { name: string }): string {
  const key = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (key.length > 0) {
    return key;
  }
  return `=${name.trim()}`;
}

/**
 * Every Slack conversation the evidence links into that the file's `channels` does not name, once each — the
 * register's own rule, checked here so a yes is never refused for a name the miner could have given.
 *
 * @returns one problem per unnamed conversation
 */
function unnamedChannels({ file }: { file: CandidatesFile }): readonly string[] {
  const unnamed = new Set<string>();
  for (const evidence of file.candidates.flatMap((one) => one.evidence)) {
    const channel = evidence.href === null ? undefined : slackChannelOf({ href: evidence.href });
    if (channel !== undefined && !Object.hasOwn(file.channels, channel)) {
      unnamed.add(channel);
    }
  }
  return [...unnamed].map((channel) => `evidence links into Slack channel ${channel}, which channels does not name`);
}

/**
 * Validate a candidates document, with the cross-checks a schema cannot express: unique ids, numbers and names
 * ({@link candidateSetProblems}, so "Merge gate" and "merge gate!" are one name), and every Slack conversation
 * the evidence links into named in `channels`.
 *
 * @param value the parsed JSON
 * @returns the file, or every problem named
 */
export function parseCandidatesFile({ value }: { value: unknown }): Result<CandidatesFile, CandidatesError> {
  const parsed = candidatesFileSchema.safeParse(value);
  if (!parsed.success) {
    return err(
      CandidatesErrors.invalid({
        problems: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
    );
  }
  const problems = [
    ...candidateSetProblems({ candidates: parsed.data.candidates }),
    ...unnamedChannels({ file: parsed.data }),
  ];
  if (problems.length > 0) {
    return err(CandidatesErrors.invalid({ problems }));
  }
  return ok(parsed.data);
}

/**
 * What makes a set of candidates not one set: an id, a number or a name (compared by {@link sameNameKey}) carried
 * twice. Run over one mined file, and over the whole catalog the stated candidates and that file make together
 * (`./candidateCatalog.ts`), because the owner's reply names a candidate by its id or its number.
 *
 * @returns one problem per clash, in candidate order, empty for a clean set
 */
export function candidateSetProblems({ candidates }: { candidates: readonly Candidate[] }): readonly string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const numbers = new Set<number>();
  const names = new Map<string, string>();
  for (const one of candidates) {
    if (ids.has(one.id)) {
      problems.push(`candidate id ${one.id} appears twice`);
    }
    if (numbers.has(one.n)) {
      problems.push(`candidate number ${String(one.n)} appears twice`);
    }
    const key = sameNameKey({ name: one.name });
    const first = names.get(key);
    if (first !== undefined) {
      problems.push(`${one.id} "${one.name}" names the same workstream as ${first} — merge them into one candidate`);
    }
    ids.add(one.id);
    numbers.add(one.n);
    if (first === undefined) {
      names.set(key, one.id);
    }
  }
  return problems;
}
