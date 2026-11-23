/**
 * The owner's guidance, every source of it in one ranked list — the pure half of `slopweaver profile guidance`, and
 * what the Alignment page's folded guidance section draws.
 *
 * A ruling in force is hard to find from any one place: doctrine sits in `AGENTS.md`, the standing rules the Alignment
 * page counts are class steers in the autonomy ledger, and the rest is spread over five more places. So this names
 * every one of them in RANK order, highest first, and each entry carries the citation a reader goes and checks:
 *
 * 1. **Doctrine** — `AGENTS.md`'s numbered operating rules, which bind every session.
 * 2. **Standing rules** — the owner's class steers (`../autonomy/classSteer.ts`), each settling a whole class of act.
 * 3. **Rulings and memory** — the general rulings, the ruling gates in force, the standing asks, the feedback memories
 *    and the owner profile, each narrower than a class steer.
 *
 * A source that read nothing is EMPTY, and one that would not read is UNREADABLE with its reason. The two are never
 * folded together, because "you have no general rulings" and "your general rulings would not read" are different
 * facts and only one of them is reassuring. No installation's content is held here: every entry is read at run time
 * by the shell (`../cli/commands/profile/guidanceRun.ts`). Pure: reads in, the wire out. The wire's shape, its source
 * list and the doctrine reader live in the import-free leaf `./guidanceWire.ts`, which the site's mirror test reaches.
 */
import { classIdOf, isClassSteerRecord } from "../autonomy/classSteer.js";
import type { AutonomyClassSteerRow, AutonomyRecord } from "../autonomy/types.js";
import type { MemoryCorpusRead, OwnerProfileRead } from "../handover/currencyStandingEntries.js";
import type { StandingGate } from "../handover/rulingGate.js";
import type { GeneralRulings } from "../live/turn/generalRulings.js";
import {
  type GuidanceEntry,
  type GuidanceSourceState,
  type GuidanceWire,
  plainEntry,
  readState,
} from "./guidanceWire.js";
import type { StandingAsk } from "./standingAsks.js";

/** A class steer's scope, read as an own field the way `classAdmits` reads it; `null` when the steer is unscoped. */
function scopeOf({ row }: { row: AutonomyClassSteerRow }): string | null {
  if (!Object.hasOwn(row, "subjectPrefix") || row.subjectPrefix === undefined) {
    return null;
  }
  return row.subjectPrefix;
}

/**
 * The owner's class steers in force: the LATEST row per class, as `../autonomy/query.ts`'s `classCoverage` keeps it,
 * so a re-recorded class shows its current words once.
 *
 * @param records every autonomy record, in append order
 * @returns one line per class, its words and where the owner gave them
 */
export function classSteerEntries({ records }: { records: readonly AutonomyRecord[] }): readonly GuidanceEntry[] {
  const latest = new Map<string, GuidanceEntry>();
  for (const record of records) {
    if (!isClassSteerRecord(record)) {
      continue;
    }
    const classId = classIdOf({ row: record });
    const text = `${classId}: ${record.steer}`;
    latest.delete(classId);
    // An unscoped steer settles every subject of its kinds.
    latest.set(classId, {
      body: text,
      citation: record.anchor,
      kinds: record.kinds.split(","),
      subjectPrefix: scopeOf({ row: record }),
      text,
    });
  }
  return [...latest.values()];
}

/**
 * The general rulings: none recorded is empty, a file that would not read is unreadable.
 *
 * @param rulings the rulings as the store loaded them
 * @returns the source's state
 */
export function generalRulingState({ rulings }: { rulings: GeneralRulings }): GuidanceSourceState {
  if (rulings.kind === "unreadable") {
    return { kind: "unreadable", why: rulings.why };
  }
  if (rulings.kind === "absent") {
    return readState({ entries: [] });
  }
  return readState({
    entries: rulings.rulings.map((ruling) =>
      plainEntry({ body: `${ruling.kind}: ${ruling.act}`, citation: ruling.anchor, text: ruling.act }),
    ),
  });
}

/**
 * The ruling gates in force, each with the verbs it refuses.
 *
 * @param gates the gates in force
 * @returns one line per gate
 */
export function gateEntries({ gates }: { gates: readonly StandingGate[] }): readonly GuidanceEntry[] {
  return gates.map((gate) => {
    const verbs = gate.verbs.map((verb) => `${verb.noun} ${verb.verb}`).join(", ");
    return plainEntry({ citation: gate.anchor, text: `${gate.words} (refuses ${verbs})` });
  });
}

/**
 * The standing asks, each the owner's own words off its anchor.
 *
 * @param asks the asks standing now
 * @returns one line per ask
 */
export function askEntries({ asks }: { asks: readonly StandingAsk[] }): readonly GuidanceEntry[] {
  return asks.map((ask) => plainEntry({ citation: ask.quote.anchor, text: ask.quote.words }));
}

/**
 * The feedback memories across every corpus: a memory of any other type records a fact rather than guidance on how to
 * work, so it is not listed. A corpus that would not read is a gap beside the others, never a silent skip.
 *
 * @param corpora each corpus as the shell read it, or why the corpora could not be listed at all
 * @returns the source's state
 */
export function memoryState({
  corpora,
}: {
  corpora: readonly MemoryCorpusRead[] | { readonly why: string };
}): GuidanceSourceState {
  if ("why" in corpora) {
    return { kind: "unreadable", why: corpora.why };
  }
  const entries: GuidanceEntry[] = [];
  const gaps: string[] = [];
  for (const corpus of corpora) {
    if (corpus.kind === "unreadable") {
      gaps.push(`${corpus.project}: ${corpus.why}`);
      continue;
    }
    entries.push(...feedbackEntriesOf({ corpus }));
  }
  return { entries, gaps, kind: "read" };
}

/** One corpus that read: its feedback memories, each cited at its file. */
function feedbackEntriesOf({
  corpus,
}: {
  corpus: Extract<MemoryCorpusRead, { kind: "read" }>;
}): readonly GuidanceEntry[] {
  return corpus.leaves.flatMap((leaf): GuidanceEntry[] => {
    if (leaf.declaredType !== "feedback") {
      return [];
    }
    const name = memoryNameOf({ declaredName: leaf.declaredName, stem: leaf.stem });
    const text = leaf.description === null ? name : `${name}: ${leaf.description}`;
    return [plainEntry({ citation: `memory:${corpus.project}/${leaf.file}`, text })];
  });
}

/** A memory's name: the one its frontmatter declares, or its file stem when it declares none. */
function memoryNameOf({ declaredName, stem }: { declaredName: string | null; stem: string }): string {
  if (declaredName !== null) {
    return declaredName;
  }
  return stem;
}

/**
 * The owner profile's statements: no profile recorded is empty, a store that did not answer is unreadable.
 *
 * @param profile the profile as the shell read it
 * @returns the source's state
 */
export function profileState({ profile }: { profile: OwnerProfileRead }): GuidanceSourceState {
  if (profile.kind === "unavailable") {
    return { kind: "unreadable", why: profile.why };
  }
  if (profile.kind === "absent") {
    return readState({ entries: [] });
  }
  const citation = `profile revision ${String(profile.revision)}`;
  return readState({
    entries: profile.statements.map((statement) =>
      plainEntry({ citation: `${citation}, observed ${statement.observedAt}`, text: statement.text }),
    ),
  });
}

/**
 * A read source's head count: `empty` only when it holds no entry AND every part of it read, because a part that
 * would not read (a run journal, a memory corpus) may hold exactly the guidance the head would otherwise call absent.
 *
 * @param entries how many entries read
 * @param gaps how many parts of the source would not read
 * @returns `empty`, `<n>`, `NOT READ (<g>)`, or `<n>, <g> NOT READ`
 */
function headCount({ entries, gaps }: { entries: number; gaps: number }): string {
  if (gaps === 0) {
    return entries === 0 ? "empty" : String(entries);
  }
  return entries === 0 ? `NOT READ (${String(gaps)})` : `${String(entries)}, ${String(gaps)} NOT READ`;
}

/**
 * The read as lines: one head per source with its count, or EMPTY, or why it would not read, then one line per entry
 * and one per part that would not read. A source with such a part never heads as empty or as a bare count.
 *
 * @param wire the read
 * @returns the lines
 */
export function guidanceLines({ wire }: { wire: GuidanceWire }): readonly string[] {
  return wire.sources.flatMap((source) => {
    if (source.state.kind === "unreadable") {
      return [`${source.label}: NOT READ — ${source.state.why}`];
    }
    const { entries, gaps } = source.state;
    const head = `${source.label}: ${headCount({ entries: entries.length, gaps: gaps.length })}`;
    return [
      head,
      ...entries.map((entry) => `    ${entry.text}  [${entry.citation}]`),
      ...gaps.map((gap) => `    not read: ${gap}`),
    ];
  });
}
