/**
 * The effectful edge of `slopweaver memory hygiene`: everything the six checks read — the corpus, the root index,
 * the enforcers, the checkouts and the memories table — gathered into the one `HygieneInputs` the pure assembly
 * (`memory/hygiene/report.ts`) takes.
 *
 * Split from `./hygiene.ts` along the seam the verb already had: that module is argument handling, the report
 * write and exit codes; this one is I/O. The knowledge reader is a parameter so the unit lane never reaches a
 * database.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { readAllMemories } from "../../../knowledge/memoryStore.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeFs } from "../../../lib/safeBoundary.js";
import { findDuplicatePairs } from "../../../memory/hygiene/duplicates.js";
import { findEnforcedMemories } from "../../../memory/hygiene/enforcement.js";
import { readEnforcers } from "../../../memory/hygiene/enforcerSources.js";
import { measureIndexBudget } from "../../../memory/hygiene/indexBudget.js";
import {
  currentKnowledgeBeliefs,
  type KnowledgeRecording,
  knowledgeDocuments,
} from "../../../memory/hygiene/knowledgeRows.js";
import { foldHygieneLedger, readHygieneLedgerRows } from "../../../memory/hygiene/ledger.js";
import { findStaleReferents, findStaleReferentsIn } from "../../../memory/hygiene/referents.js";
import { treeReferentResolver } from "../../../memory/hygiene/referentTree.js";
import type { HygieneInputs } from "../../../memory/hygiene/report.js";
import { readMemoryCorpus } from "../../../memory/store.js";
import { sweepMemoryCorpus } from "../../../memory/sweep.js";
import { ROOT_INDEX_FILE } from "../../../memory/types.js";
import { connectStore } from "../../../store/client.js";
import { resolveAmendsRows } from "./judgedCorpus.js";

/** How the verb reads every knowledge recording — the one seam, so the unit lane never reaches a database. */
export type KnowledgeReader = (args: {
  home: string | undefined;
}) => Promise<Result<readonly KnowledgeRecording[], string>>;

/**
 * Every recording the memories table holds, or the reason it could not be read. The connection is closed in
 * a `finally`, as `knowledge list` closes its own.
 *
 * @param home the state home whose remembered store selection is used
 * @returns every recording, or the failure message
 */
export async function readKnowledgeFromStore({
  home,
}: {
  home: string | undefined;
}): Promise<Result<readonly KnowledgeRecording[], string>> {
  const opened = await connectStore(home === undefined ? {} : { home });
  if (opened.isErr()) {
    return err(opened.error.message);
  }
  const client = opened.value;
  try {
    const rows = await readAllMemories({ client });
    return rows.isErr() ? err(rows.error.message) : ok(rows.value);
  } finally {
    await client.close();
  }
}

/**
 * Read everything the six checks need and run them. The whole effectful edge of the pass, in one place.
 *
 * @param dir the memory directory
 * @param repos the repository roots CHECK 4 resolves against, `--repo` first — CHECK 5 reads the first only, whose canon it is
 * @param home the state home the ledger and the board are read from
 * @param knowledge every knowledge recording, or why the memories table could not be read
 * @param nowIso the injected instant, carried onto the report
 * @param nowMs the same instant, for the sweep's ages
 * @returns every measurement the assembly takes, or why the corpus could not be read
 */
export async function gatherHygieneInputs({
  dir,
  repos,
  home,
  knowledge,
  nowIso,
  nowMs,
}: {
  dir: string;
  repos: readonly string[];
  home: string | undefined;
  knowledge: Result<readonly KnowledgeRecording[], string>;
  nowIso: string;
  nowMs: number;
}): Promise<Result<HygieneInputs>> {
  const read = readMemoryCorpus({ dir });
  if (read.isErr()) {
    return err([`cannot read ${dir} — ${read.error.message}`]);
  }
  const unreadable = repos.filter((root) => !isDirectory({ path: root }));
  if (unreadable.length > 0) {
    return err(unreadable.map((root) => `${root} is not a directory — every referent is resolved against it`));
  }
  // Safe: `hygieneSettings` always puts `--repo` first.
  const repo = repos[0]!;
  const enforcers = readEnforcers({ repo });
  if (enforcers.isErr()) {
    return err(enforcers.error);
  }
  const indexText = readRootIndex({ dir });
  if (indexText.isErr()) {
    return err(indexText.error);
  }
  const roots = checkoutRoots({ repos });
  if (roots.isErr()) {
    return err(roots.error);
  }
  const corpus = await resolveAmendsRows({ corpus: read.value, home });
  const texts = new Map(corpus.leaves.map((leaf) => [leaf.file, leafText({ dir, file: leaf.file })]));
  const resolve = treeReferentResolver({ repos });
  const beliefs = knowledge.isOk() ? currentKnowledgeBeliefs({ recordings: knowledge.value }) : [];
  return ok({
    corpus,
    duplicatePairs: findDuplicatePairs({ leaves: corpus.leaves }),
    enforced: findEnforcedMemories({ enforcers: enforcers.value, leaves: corpus.leaves }),
    indexBudget: measureIndexBudget({ index: corpus.root, text: indexText.value }),
    knowledge: knowledge.isOk() ? { read: true, rows: beliefs.length } : { read: false, why: knowledge.error },
    nowIso,
    staleReferents: [
      ...findStaleReferents({ leaves: corpus.leaves, resolve, texts }),
      ...findStaleReferentsIn({ documents: knowledgeDocuments({ beliefs, roots: roots.value }), resolve }),
    ],
    states: foldHygieneLedger({ rows: readHygieneLedgerRows(home === undefined ? {} : { home }) }),
    sweep: sweepMemoryCorpus({ corpus, now: nowMs, staleAfterDays: null }),
    texts,
  });
}

/** The root index's exact bytes, which the budget check measures as the loader reads them. */
function readRootIndex({ dir }: { dir: string }): Result<string> {
  const indexPath = join(dir, ROOT_INDEX_FILE);
  const indexText = safeFs({
    execute: (): string => readFileSync(indexPath, "utf8"),
    operation: "read the root index",
    path: indexPath,
  });
  return indexText.isOk() ? ok(indexText.value) : err([indexText.error.message]);
}

/**
 * A top-level directory whose contents are no checkout's own claim: a path under it names a dependency's file,
 * which a lockfile bump moves without any row having been wrong.
 */
const NOT_A_ROOT: ReadonlySet<string> = new Set([".git", "node_modules"]);

/**
 * Every top-level directory name across the checkouts — what a knowledge row's prose path must open with to be
 * read as a repo path at all (`extractProseReferents`).
 */
function checkoutRoots({ repos }: { repos: readonly string[] }): Result<ReadonlySet<string>> {
  const names = new Set<string>();
  for (const repo of repos) {
    const entries = safeFs({
      execute: () => readdirSync(repo, { withFileTypes: true }),
      operation: "list a checkout's top-level directories",
      path: repo,
    });
    if (entries.isErr()) {
      return err([entries.error.message]);
    }
    entries.value
      .filter((entry) => entry.isDirectory() && !NOT_A_ROOT.has(entry.name))
      .forEach((entry) => names.add(entry.name));
  }
  return ok(names);
}

/** Whether a path is a directory that can be read. A root that cannot be is a caller mistake, said by name. */
function isDirectory({ path }: { path: string }): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** One leaf's exact bytes, for the referent and enforcement arms, which read prose the parser does not keep. */
function leafText({ dir, file }: { dir: string; file: string }): string {
  try {
    return readFileSync(join(dir, file), "utf8");
  } catch {
    return "";
  }
}
