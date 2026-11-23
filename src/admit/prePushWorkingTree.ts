/**
 * The gate that keeps a pre-push verdict about the same thing the push sends.
 *
 * `git push` sends a COMMIT. Every pre-push gate in this repository — `yarn validate:local` as the lefthook
 * hook, and the same hook run ahead of the transport by `slopweaver github push` — reads the FILES ON DISK. When
 * the working tree differs from `HEAD` those are two different subjects, and the gate's green is about the
 * one that stays behind. MEASURED: a typecheck fix sat
 * uncommitted on top of a red commit, so the gate would have passed over the fixed tree while the push sent
 * the red commit. Reproduce the shape in any repository with
 * `git commit -m red && <fix a file without committing> && git status --porcelain`.
 *
 * Pure by construction — it judges the exact text of `git status --porcelain` and nothing else, so the same
 * decision serves the lefthook hook (`./prePushWorkingTreeCli.ts`) and the verb's push gate
 * (`./pushWorkingTreeGate.ts`) without either of them re-deriving it.
 */

/** One `git status --porcelain` entry: git's own two-letter code, and the path it names. */
interface WorkingTreeEntry {
  readonly code: string;
  readonly path: string;
}

/**
 * How many paths a refusal spells before it summarises the rest, so a wholesale change names a few real
 * files rather than scrolling the reason out of view.
 */
const PATHS_NAMED = 10;

/** The fixed width of a porcelain v1 line's `XY ` status prefix, before the path begins. */
const STATUS_PREFIX_WIDTH = 3;

/** What git puts between the two paths of a rename or copy entry; the destination is the one that matters. */
const RENAME_SEPARATOR = " -> ";

/**
 * Read `git status --porcelain` (v1) into its entries.
 *
 * Ignored files are absent because git omits them without `--ignored`, and a rename or copy is reported by
 * its DESTINATION — the path that would have to be committed for the push to carry it.
 *
 * @param statusPorcelain the exact stdout of `git status --porcelain`
 * @returns one entry per reported path, in git's own order, empty when the tree matches HEAD
 */
export function parseWorkingTreeStatus({ statusPorcelain }: { statusPorcelain: string }): readonly WorkingTreeEntry[] {
  const entries: WorkingTreeEntry[] = [];
  for (const line of statusPorcelain.split("\n")) {
    if (line.length <= STATUS_PREFIX_WIDTH) {
      continue;
    }
    const named = line.slice(STATUS_PREFIX_WIDTH);
    const arrow = named.indexOf(RENAME_SEPARATOR);
    entries.push({
      code: line.slice(0, 2),
      path: arrow < 0 ? named : named.slice(arrow + RENAME_SEPARATOR.length),
    });
  }
  return entries;
}

/**
 * Why a push must be refused before any gate runs over a tree that is not what it would send.
 *
 * Empty means the tree matches HEAD and the gate's subject is the commit, which is the only state in which
 * a green gate is evidence about the push.
 *
 * @param statusPorcelain the exact stdout of `git status --porcelain`
 * @returns the refusal lines to print, empty when the working tree is clean
 */
export function prePushWorkingTreeRefusal({ statusPorcelain }: { statusPorcelain: string }): readonly string[] {
  const entries = parseWorkingTreeStatus({ statusPorcelain });
  if (entries.length === 0) {
    return [];
  }
  const named = entries.slice(0, PATHS_NAMED).map((entry) => `  ${entry.code} ${entry.path}`);
  const remainder = entries.length - named.length;
  return [
    `the working tree differs from HEAD, so a pre-push gate would judge files this push does not send (${String(entries.length)} path(s)):`,
    ...named,
    ...(remainder > 0 ? [`  … and ${String(remainder)} more`] : []),
    "commit or stash them, then push again — git push sends the commit, never the tree.",
  ];
}
