/**
 * Each standing source as the entries `./currencyStanding.ts` reads against a card's floor — memories, the owner
 * profile, rulings — and the gaps where a source would not read. Pure: the shell
 * (`../cli/commands/handover/currencyStandingRead.ts`) hands in what it read.
 */
import type { MemoryLeaf } from "../memory/types.js";
import type { JournalEvidence } from "./assemble.js";
import type { StandingEntry, StandingGap } from "./currencyStanding.js";
import { gatesInForceAt } from "./currencyStandingGates.js";
import { rulingGateId } from "./rulingGate.js";

/** One source's entries, its gaps, and the line naming what it read. */
export interface StandingPart {
  readonly entries: readonly StandingEntry[];
  readonly gaps: readonly StandingGap[];
  readonly source: string;
}

/** One auto-memory corpus as the shell read it: the project directory's name, and its leaves or why they would not read. */
export type MemoryCorpusRead =
  | {
      readonly kind: "read";
      readonly project: string;
      readonly leaves: readonly MemoryLeaf[];
      /** Each leaf's status-change time (`ctime`, the latest of its target's and any link's on its path), by file name: `utimes` cannot set it, so a backdated edit or a retargeted link still shows. */
      readonly statusChangedMs: ReadonlyMap<string, number>;
      /**
       * The corpus folder's own change time — the latest of its mtime, its ctime and any link's on its path. Adding,
       * removing or renaming a leaf moves it, so a memory DELETED after a card's floor still shows, where the leaves
       * alone hold nothing for it.
       */
      readonly folderChangedMs: number;
    }
  | { readonly kind: "unreadable"; readonly project: string; readonly why: string };

/** The owner profile as the shell read it. */
export type OwnerProfileRead =
  | {
      readonly kind: "read";
      readonly revision: number;
      readonly updatedAtIso: string;
      /** The owner's injected statements — always-loaded and ways of working — with when each was observed. */
      readonly statements: readonly { readonly text: string; readonly observedAt: string }[];
    }
  | { readonly kind: "absent" }
  | { readonly kind: "unavailable"; readonly why: string };

/**
 * When a memory leaf last changed: the LATEST of its declared `metadata.modified`, its file's mtime and its ctime — the
 * ctime because `utimes` can set an mtime back past a card's floor and cannot set a ctime. The sweep
 * prefers the declared field because it is asking how old a memory is; this asks whether it could have changed since a
 * card reached the owner, so the later reading is the safe one — a copied file's fresh mtime costs a card its freshness,
 * while a stale declared field preferred over a later edit would hide the edit.
 *
 * @param leaf the parsed leaf
 * @param statusMs the leaf file's ctime, when the shell read one
 * @returns the instant, or `undefined` when no reading is legible
 */
function memoryChangedMs({ leaf, statusMs }: { leaf: MemoryLeaf; statusMs: number | undefined }): number | undefined {
  const declared = leaf.declaredModified === null ? Number.NaN : Date.parse(leaf.declaredModified);
  const readings = [declared, leaf.mtimeMs, statusMs].filter(
    (ms): ms is number => typeof ms === "number" && !Number.isNaN(ms),
  );
  if (readings.length === 0) {
    return undefined;
  }
  return Math.max(...readings);
}

/**
 * A filesystem or declared reading as the instant an entry carries: the millisecond AFTER the one it sits in. Every
 * reading here loses what lies past it: `Date.parse` truncates a declared `09:00:00.0005Z`, a `Date` truncates a ctime 0.5ms past a floor, and at this epoch a millisecond Number
 * cannot hold 100ns, so a kernel time just past a floor IS the floor. A reading exactly on a millisecond
 * is therefore never known to be on it. Up only ever costs a card its freshness, by at most a millisecond.
 *
 * @param ms the reading, in epoch milliseconds
 * @returns the instant one millisecond past its own
 */
function afterIso({ ms }: { ms: number }): string {
  return new Date(Math.floor(ms) + 1).toISOString();
}

/**
 * A leaf's name as an entry shows it: the one its front matter declares, its file's stem when it declares none.
 *
 * @param leaf the parsed leaf
 * @returns the name
 */
function nameOf({ leaf }: { leaf: MemoryLeaf }): string {
  if (leaf.declaredName === null) {
    return leaf.stem;
  }
  return leaf.declaredName;
}

/**
 * One memory leaf as an entry filed to no card, or the gap a leaf with no legible time is.
 *
 * @param project the project directory the leaf's corpus sits under
 * @param leaf the parsed leaf
 * @param statusMs the leaf file's ctime, when the shell read one
 * @returns the entry, or the gap
 */
function memoryEntryOf({
  project,
  leaf,
  statusMs,
}: {
  project: string;
  leaf: MemoryLeaf;
  statusMs: number | undefined;
}): StandingEntry | StandingGap {
  const changedMs = memoryChangedMs({ leaf, statusMs });
  if (changedMs === undefined) {
    return { why: "one of your memories carries no time, so whether it changed after this reached you cannot be told" };
  }
  const name = nameOf({ leaf });
  return {
    atIso: afterIso({ ms: changedMs }),
    pointer: `memory:${project}/${leaf.file}`,
    row: undefined,
    source: "memory",
    text: leaf.description === null ? name : `${name}: ${leaf.description}`,
  };
}

/**
 * Every memory leaf as an entry filed to no card, and each corpus folder as one more: a leaf deleted after a card's
 * floor leaves nothing to read but the folder's own change time. An index file routes and holds no memory of its own,
 * so it is never an entry — though one rewritten by rename moves its folder's time, which only ever costs a card its
 * freshness. A corpus that would not read and a leaf with no legible time are gaps for every card.
 *
 * @param corpora each corpus the shell found, read or not
 * @returns the part
 */
export function memoryPart({ corpora }: { corpora: readonly MemoryCorpusRead[] }): StandingPart {
  const entries: StandingEntry[] = [];
  const folders: StandingEntry[] = [];
  const gaps: StandingGap[] = [];
  for (const corpus of corpora) {
    if (corpus.kind === "unreadable") {
      gaps.push({ why: `one of your memory folders would not read: ${corpus.why}` });
      continue;
    }
    folders.push({
      atIso: afterIso({ ms: corpus.folderChangedMs }),
      pointer: `memory:${corpus.project}/`,
      row: undefined,
      source: "memory",
      text: `A memory in ${corpus.project} was added, removed or renamed`,
    });
    for (const leaf of corpus.leaves) {
      const read = memoryEntryOf({ leaf, project: corpus.project, statusMs: corpus.statusChangedMs.get(leaf.file) });
      if ("atIso" in read) {
        entries.push(read);
      } else {
        gaps.push(read);
      }
    }
  }
  const projects = corpora.length === 1 ? "1 project" : `${String(corpora.length)} projects`;
  return {
    entries: [...entries, ...folders],
    gaps,
    source: `${String(entries.length)} memories read across ${projects}`,
  };
}

/**
 * When the profile row last changed, as an instant a card's floor is compared with: the millisecond AFTER the one its
 * `Date` holds. The column keeps microseconds and a `Date` truncates them, so a revision 0.5ms past a card's floor reads
 * as the floor itself and passes the card. Up only ever costs a card its freshness.
 *
 * @param updatedAt the row's `updated_at`, as the driver decoded it
 * @returns the instant, one millisecond past the truncated one
 */
export function profileChangedIso({ updatedAt }: { updatedAt: Date }): string {
  return new Date(updatedAt.getTime() + 1).toISOString();
}

/** How many of the owner's newest profile statements an entry quotes before the card's fold cuts the rest. */
const PROFILE_QUOTED = 3;

/**
 * The owner profile as one entry filed to no card, dated by its row's last write. No profile recorded is a profile
 * with nothing in it, never a gap; one that would not read is a gap for every card.
 *
 * RESIDUE, stated rather than discovered: absent is read as never written, because a fresh install has no profile and a
 * gap there would leave every card stale forever. A profile written after a floor and then erased by a deliberate
 * `store reset --acknowledge` before the reading reads the same way. What would close it
 * is a profile tombstone the reset writes, which the store does not keep.
 *
 * @param profile what the shell read
 * @returns the part
 */
export function profilePart({ profile }: { profile: OwnerProfileRead }): StandingPart {
  if (profile.kind === "absent") {
    return { entries: [], gaps: [], source: "no owner profile recorded" };
  }
  if (profile.kind === "unavailable") {
    return {
      entries: [],
      gaps: [{ why: `your owner profile could not be read: ${profile.why}` }],
      source: `could not read: ${profile.why}`,
    };
  }
  const newest = profile.statements
    .toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, PROFILE_QUOTED)
    .map((statement) => statement.text);
  const entry: StandingEntry = {
    atIso: profile.updatedAtIso,
    pointer: `profile:revision-${String(profile.revision)}`,
    row: undefined,
    source: "profile",
    text: [`Your owner profile, revision ${String(profile.revision)}`, ...newest].join(" · "),
  };
  return { entries: [entry], gaps: [], source: `revision ${String(profile.revision)}` };
}

/**
 * Every ruling on a board row's journal that places no gate in force at `nowIso`, filed to its own row. A gate in force
 * bears on every card, so it is `./currencyStandingGates.ts`'s, read from every journal rather than the board's — and
 * "in force" is that file's own `gatesInForceAt`, so a ruling left out here is always listed there; and an
 * undecodable ruling line is a gap there too, since that read covers every journal this one does.
 *
 * @param journals each board row's journal, as `handover currency` composed the board
 * @param nowIso the reading's clock, which an expired gate is judged at
 * @returns the part
 */
export function rulingPart({
  journals,
  nowIso,
}: {
  journals: ReadonlyMap<string, JournalEvidence>;
  nowIso: string;
}): StandingPart {
  const entries: StandingEntry[] = [];
  for (const [slug, { events }] of journals) {
    const inForce = new Set(gatesInForceAt({ events, nowIso, slug }).map((gate) => gate.id));
    for (const event of events) {
      if (event.kind !== "ruling") {
        continue;
      }
      const pointer = rulingGateId({ atIso: event.atIso, slug });
      if (!inForce.has(pointer)) {
        entries.push({
          atIso: event.atIso,
          pointer: `ruling:${pointer}`,
          row: slug,
          source: "ruling",
          text: event.ruling,
        });
      }
    }
  }
  return { entries, gaps: [], source: `${String(entries.length)} rulings read` };
}
