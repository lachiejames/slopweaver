/**
 * `handover currency`'s standing read — the effectful shell over `../../../handover/currencyStanding.ts`: every
 * auto-memory corpus on this machine, the owner profile in the store, the rulings in the run journals the board
 * already read, and the gates in force in every run journal under the home. Read once per reading and handed to every
 * row; a source that would not read is a gap, never an empty source, so a card's steers half cannot pass over it — a
 * memory folder whose index will not stat included (`existsSync` reads EACCES as no
 * folder at all).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { isGenuinelyAbsent, linkChangeTimesOn } from "#lib/pathLinks.js";

import type { JournalEvidence } from "../../../handover/assemble.js";
import type { StandingRead } from "../../../handover/currencyStanding.js";
import {
  type MemoryCorpusRead,
  memoryPart,
  type OwnerProfileRead,
  profileChangedIso,
  profilePart,
  rulingPart,
} from "../../../handover/currencyStandingEntries.js";
import { gatePart, type RunJournalRead } from "../../../handover/currencyStandingGates.js";
import { parseMemoryLeaf } from "../../../memory/corpus.js";
import { type MemoryCorpusCandidate, memoryCorpusCandidatesUnder, readMemoryCorpus } from "../../../memory/store.js";
import type { MemoryLeaf } from "../../../memory/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { openStore } from "../../../store/client.js";
import { storeUrl } from "../../../store/config.js";
import { readOwnerProfile } from "../../../store/profile/client.js";

/** The two reads a test points somewhere else: where the memory corpora live, and the owner-profile read. */
export interface CurrencyStandingDeps {
  /** A `~/.claude/projects` directory, every `<project>/memory` corpus under it read. */
  readonly projectsDir: string;
  readonly readProfile: (args: { home: string }) => Promise<OwnerProfileRead>;
}

/**
 * How long the owner-profile read may take before it is a gap. A store that does not answer must not hold the tick:
 * `postgres.js` waits on an unreachable host far longer than a reading should.
 */
const PROFILE_READ_DEADLINE_MS = 5000;

/**
 * The owner profile, read from the configured store within {@link PROFILE_READ_DEADLINE_MS}, the connection always
 * closed. No row is `absent`; any other failure is `unavailable` with its reason.
 *
 * @param home the state home whose store is read
 * @returns what the read found
 */
async function readProfileFromStore({ home }: { home: string }): Promise<OwnerProfileRead> {
  const url = storeUrl({ home });
  if (url.isErr()) {
    return { kind: "unavailable", why: url.error.message };
  }
  const client = openStore({ max: 1, url: url.value });
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<OwnerProfileRead>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: "unavailable", why: `the store did not answer within ${String(PROFILE_READ_DEADLINE_MS)}ms` });
    }, PROFILE_READ_DEADLINE_MS);
    timer.unref();
  });
  const read = readOwnerProfile({ client }).then((owner): OwnerProfileRead => {
    if (owner.isOk()) {
      const { alwaysLoaded, waysOfWorking } = owner.value.selfDescription;
      const statements = [...alwaysLoaded, ...waysOfWorking].map(({ observedAt, text }) => ({ observedAt, text }));
      return {
        kind: "read",
        revision: owner.value.revision,
        statements,
        updatedAtIso: profileChangedIso({ updatedAt: owner.value.updatedAt }),
      };
    }
    return owner.error.code === "PROFILE_ABSENT"
      ? { kind: "absent" }
      : { kind: "unavailable", why: owner.error.message };
  });
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
    void client.close();
  }
}

/** The production reads: this user's own Claude Code projects, and the configured store. */
export const PRODUCTION_STANDING_DEPS: CurrencyStandingDeps = {
  projectsDir: join(homedir(), ".claude", "projects"),
  readProfile: readProfileFromStore,
};

/** Why a thrown filesystem error happened, as one line. */
const whyOf = ({ error }: { error: unknown }): string => (error instanceof Error ? error.message : String(error));

/**
 * The `.md` links in a corpus directory, each followed, and every other `.md` entry that is not a file named. The corpus reader takes regular files only, so a linked leaf
 * would otherwise be no leaf at all and its edit could not fail a card; a link that will
 * not follow is a reason, never a skip.
 *
 * @param dir the corpus directory
 * @returns the followed leaves, and why each link that would not follow did not
 */
function linkedLeaves({ dir }: { dir: string }): { readonly leaves: readonly MemoryLeaf[]; readonly whys: string[] } {
  const leaves: MemoryLeaf[] = [];
  const whys: string[] = [];
  // Every `.md` entry the corpus reader skipped: a link is followed, anything else that is not a file is a reason.
  const skipped = readdirSync(dir, { withFileTypes: true }).filter(
    (entry) => !entry.isFile() && entry.name.endsWith(".md"),
  );
  for (const entry of skipped) {
    const { name } = entry;
    if (!entry.isSymbolicLink()) {
      whys.push(`${name} is not a file, so the memory it names cannot be read`);
      continue;
    }
    try {
      const path = join(dir, name);
      const target = statSync(path);
      // A link to a device or a folder reads as text or throws, never as a memory.
      if (!target.isFile()) {
        whys.push(`${name} links to something that is not a file, so the memory it names cannot be read`);
        continue;
      }
      leaves.push(parseMemoryLeaf({ file: name, mtimeMs: target.mtimeMs, text: readFileSync(path, "utf8") }));
    } catch (error) {
      whys.push(`${name} is a link that would not read: ${whyOf({ error })}`);
    }
  }
  return { leaves, whys };
}

/**
 * Each leaf's status-change instant: the latest of its followed target's ctime and that of every link the leaf is
 * reached through — the leaf, its folders, the projects root and above — since retargeting any of them swaps the
 * memories the owner stands on while the targets' own times stay old.
 *
 * RESIDUE, stated rather than discovered: a plain folder ABOVE a linked leaf's target, renamed over by another holding an
 * old file of the same name, swaps the memory with no time here moving. Reading every such
 * folder's ctime would close it and fail every card on any unrelated file landing beside it, in `/tmp` or `~/.claude`.
 *
 * @param dir the corpus directory
 * @param files every leaf's file name in it
 * @returns each file's status-change instant, in epoch milliseconds
 */
function statusChangedOf({ dir, files }: { dir: string; files: readonly string[] }): ReadonlyMap<string, number> {
  return new Map(
    files.map((file) => {
      const path = join(dir, file);
      return [file, Math.max(statSync(path).ctimeMs, ...linkChangeTimesOn({ path }))];
    }),
  );
}

/**
 * One corpus candidate as read: its leaves, linked ones followed, or each reason it would not read.
 *
 * @param candidate the candidate the store found
 * @returns the corpus's read, plus one unreadable read per link that would not follow
 */
function readCandidate({ candidate }: { candidate: MemoryCorpusCandidate }): readonly MemoryCorpusRead[] {
  const project = basename(dirname(candidate.dir));
  if (candidate.kind === "unreadable") {
    return [{ kind: "unreadable", project, why: candidate.why }];
  }
  const corpus = readMemoryCorpus({ dir: candidate.dir });
  if (corpus.isErr()) {
    return [{ kind: "unreadable", project, why: corpus.error.message }];
  }
  let linked: ReturnType<typeof linkedLeaves>;
  let statusChangedMs: ReadonlyMap<string, number>;
  let folderChangedMs: number;
  // Leaves only: `MEMORY.md` and every `INDEX-` topic index route to memories and hold none (`classifyMemoryFile`), so
  // an index edited after a floor is not a memory changed after it.
  const leaves = (): readonly MemoryLeaf[] => [...corpus.value.leaves, ...linked.leaves];
  try {
    linked = linkedLeaves({ dir: candidate.dir });
    statusChangedMs = statusChangedOf({ dir: candidate.dir, files: leaves().map((leaf) => leaf.file) });
    // A deleted leaf is in no listing, so only the folder's own times can say one went.
    const folder = statSync(candidate.dir);
    folderChangedMs = Math.max(folder.mtimeMs, folder.ctimeMs, ...linkChangeTimesOn({ path: candidate.dir }));
  } catch (error) {
    return [{ kind: "unreadable", project, why: whyOf({ error }) }];
  }
  return [
    { folderChangedMs, kind: "read", leaves: leaves(), project, statusChangedMs },
    ...linked.whys.map((why): MemoryCorpusRead => ({ kind: "unreadable", project, why })),
  ];
}

/**
 * Every memory corpus under the projects directory, each read or the reason it would not.
 *
 * What this cannot see, stated rather than discovered: a WHOLE corpus deleted after a card's floor (its `memory`
 * folder, or its `MEMORY.md`) is a corpus that is not there, indistinguishable from one that never was — nothing is
 * left to stat, and the project folder above it moves on every session transcript, so its time would stale every card
 * on every reading. The same holds for a corpus that leaves VIEW without being
 * deleted: the projects directory itself retargeted (a symlink swapped to another tree) lists whatever the new target
 * holds, and the corpora it no longer shows read as never written; the projects
 * directory's own time cannot close it, since it moves on every new project. A leaf deleted from a corpus that remains
 * IS seen, through the folder's own time. Closing the rest needs a register of the corpora earlier readings saw,
 * carried as tombstones.
 *
 * @param projectsDir the directory the corpora sit under
 * @returns each corpus's read, or why the directory itself could not be listed
 */
export function readCorpora({ projectsDir }: { projectsDir: string }): readonly MemoryCorpusRead[] | { why: string } {
  const candidates = memoryCorpusCandidatesUnder({ projectsDir });
  if (candidates.isErr()) {
    return { why: candidates.error.message };
  }
  return candidates.value.flatMap((candidate) => readCandidate({ candidate }));
}

/**
 * Every run journal under the home's runs directory, each read or the reason it would not. No directory is a home that
 * never ran a doc — no journal, never a gap.
 *
 * @param runsDir the directory the journals sit in
 * @returns each journal's read, or why the directory itself could not be listed
 */
function readRunJournals({ runsDir }: { runsDir: string }): readonly RunJournalRead[] | { why: string } {
  let names: readonly string[];
  try {
    names = readdirSync(runsDir).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    // Absent only when the path is genuinely not there: a dangling link on the way is a directory that would not list.
    if (isGenuinelyAbsent({ path: runsDir })) {
      return [];
    }
    return { why: error instanceof Error ? error.message : String(error) };
  }
  return names.map((name): RunJournalRead => {
    const slug = name.slice(0, -".jsonl".length);
    try {
      return { kind: "read", slug, text: readFileSync(join(runsDir, name), "utf8") };
    } catch (error) {
      return { kind: "unreadable", slug, why: error instanceof Error ? error.message : String(error) };
    }
  });
}

/**
 * The reading's one standing read.
 *
 * @param journals each board row's journal, as the reading composed the board
 * @param home the state home whose store holds the owner profile
 * @param nowIso the reading's clock
 * @param deps where the memories live and how the profile is read, {@link PRODUCTION_STANDING_DEPS} in production
 * @returns every entry, every gap and each source's line
 */
export async function readCurrencyStanding({
  journals,
  home,
  nowIso,
  deps,
}: {
  home: string;
  journals: ReadonlyMap<string, JournalEvidence>;
  nowIso: string;
  deps: CurrencyStandingDeps;
}): Promise<StandingRead> {
  const corpora = readCorpora({ projectsDir: deps.projectsDir });
  const memory =
    "why" in corpora
      ? {
          entries: [],
          gaps: [{ why: `your memories could not be listed: ${corpora.why}` }],
          source: `could not read: ${corpora.why}`,
        }
      : memoryPart({ corpora });
  const profile = profilePart({ profile: await deps.readProfile({ home }) });
  const rulings = rulingPart({ journals, nowIso });
  // The runs directory by the home's own text, joined as every journal writer joins it: `homeDir.ts` resolves a home
  // lexically for every verb, so a `pivot/..` in a configured home names the directory the writers wrote to, never
  // the one the kernel would walk to.
  const gates = gatePart({ journals: readRunJournals({ runsDir: stateHomePaths({ home }).runs }), nowIso });
  return {
    entries: [...memory.entries, ...profile.entries, ...rulings.entries, ...gates.entries],
    gaps: [...memory.gaps, ...profile.gaps, ...rulings.gaps, ...gates.gaps],
    sources: { memory: memory.source, profile: profile.source, rulings: `${rulings.source}; ${gates.source}` },
  };
}
