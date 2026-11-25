/**
 * The ALLOWLIST of what `home reclaim` may enter, and the classes of junk it may take inside one.
 *
 * Of the bytes in the user-level home, delete what is obviously junk —
 * `node_modules`, build output — with **no retention policy**, and keep anything that could hold useful
 * information not re-derivable elsewhere.
 *
 * ## Why this is an allowlist and could never be a denylist
 *
 * `../../store/homeRegisters.ts` declares the home registers (count them: `grep -rh '^    kind:' src/store/homeRegisters/ | wc -l`)
 * and says, in its own header, that the list
 * cannot be complete — it carries a `residue` count of the top-level entries no register claims precisely
 * because new ones appear. Under a denylist a directory nobody has thought about yet defaults to
 * DELETABLE, and the first thing that would have taken is `exec-store/`: 3.2 GB of content-addressed
 * native binaries that every checkout privatised before the store moved to the cache root
 * (`../../cacheHome.ts`) is hardlinked to (`../../worktree/execInodes.ts`),
 * which is large, rebuildable and content-addressed — junk by every heuristic and the dedup mechanism
 * itself. So the verb can only name what is below, and nothing else in the home is reachable by it at all.
 *
 * ## Why there is no `duplicate-copy` class, and why `supervisor-scratch` is not a root
 *
 * Both existed here and both did real damage, so this section is the finding rather than a design note.
 * One reclaim took 553,910 entries out of `supervisor-scratch` as
 * byte-identical duplicates while its `handoff-<n>` directory was the LIVE supervisor chair's, and among them were
 * `handoff-<n>/shell.txt` and `handoff-<n>/autonomy-qualified.jsonl` — two files `../../supervisor/scratch/carry.ts`
 * and `../../cli/commands/supervisor/scratchRun.ts` open by NAME on every pass. The briefing publish
 * refused to render four minutes later, and the chair restored both out of the home's git history.
 *
 * **Under a scratch root the PATH is the state.** A script that opens `autonomy-qualified.jsonl` is not
 * asking for those bytes, it is asking for that name, and no walk can know which names some other module
 * will open next. Identical content there is the ordinary case rather than the suspicious one — measured
 * on the restored tree, that directory holds `autonomy-raw-188.jsonl` through `autonomy-raw-197.jsonl` at
 * exactly 440,746 bytes each (repro: `ls -l $SLOPWEAVER_HOME/supervisor-scratch/handoff-<n>/autonomy-raw-*.jsonl`),
 * because a snapshot that did not change between passes is a real reading and not a stray copy.
 *
 * So there is no safe residue to narrow the class down to, and it is gone rather than fenced. What
 * survives is a criterion about what a directory IS, never about what its bytes look like.
 *
 * ## Why a finished pass's scratch goes whole
 *
 * A Codex pass leaves two siblings under `orchestration`: `<passId>/`, its record (`record.json` and
 * `artifact.md`, the pass's whole conclusion, mirrored into the store as a `codex_pass` row by
 * `../../cli/commands/store/codexPassDirs.ts`), and `<passId>.scratch/`, the working directory its sandbox
 * may write. The scratch is a WORKSPACE, not an output: once the artifact exists the pass is over, and nothing
 * opens its scratch again — the store import, the pass ledger (`../../codex/ledgerStore.ts`) and this verb
 * all skip `.scratch` by name, and the pass's conclusion is its artifact, never a file left on the bench.
 *
 * Two entry points take this one class. The pass itself, the moment its artifact is written, removes its OWN
 * scratch and nothing else (`./passScratch.ts`, called from `../../codex/passPersist.ts`), so a finished pass
 * no longer waits for somebody to run a verb. `home reclaim --root codex-scratch` stays the bulk and fallback
 * path: a pass that crashed before persisting, a self-reclaim that was refused, and every scratch from before
 * the pass did this. Both write the same ledger row; the pass's carries `pass:<passId>` as its session.
 *
 * MEASURED, and why taking only package trees stopped being enough: `orchestration` stood at 56 GB
 * (28 GB earlier), and a reclaim that took only `node_modules`, `dist`, `.next` and the Yarn caches would
 * have freed 4.2 GB of it. The rest is what review and planning passes build to check a claim: whole
 * repository clones with their own object stores (`review-tree/.git`, `mutation-check/.git`, `repo-sim/.git`,
 * packs up to 328 MB), caches under names no list anticipated, and a desktop build (repro: `find
 * $SLOPWEAVER_HOME/orchestration -mindepth 2 -maxdepth 3 -name .git -type d | head`). A local commit in such a
 * clone is a pass's experiment, and what it showed is in the artifact. A name list chases what passes happen
 * to build; the scratch boundary is the one line `../../codex/artifactStore.ts` itself draws.
 *
 * ## Why there is no age anywhere in this file
 *
 * A retention policy is what the owner declined, and `skills/sweep` already carries the same doctrine for board
 * rows: what stops earning its keep is swept by EVIDENCE, never age. The criterion below is a fact about
 * what a directory IS — the workspace of a pass whose artifact exists.
 */

/**
 * Which reclaim class a candidate falls in.
 *
 * One member, and that is the point: a second one has to survive the argument in this file's header
 * before it is written here.
 *
 * @internal — reached as {@link ReclaimRoot.takes}; nothing outside this module names it.
 */
export type ReclaimClass =
  /** The whole `<passId>.scratch` workspace of a Codex pass whose `<passId>/artifact.md` exists. */
  "finished-scratch";

/** One root the verb may enter, and the single class it may take there. */
export interface ReclaimRoot {
  /** What `--root` names on the command line. */
  readonly name: string;
  /** The path's one segment under `$SLOPWEAVER_HOME`. Never absolute, never containing `..`. */
  readonly homeSegment: string;
  /** The one class of junk reclaimable inside this root. */
  readonly takes: ReclaimClass;
  /** Why this root holds junk at all — printed in the report, so the reader never has to go and find out. */
  readonly because: string;
}

/**
 * Every root `home reclaim` can reach. One, and adding a second is a reviewed change to this array.
 *
 * `orchestration` loses only its `<passId>.scratch` children, and only where the sibling
 * `<passId>/artifact.md` exists — a pass that finished. `../../codex/artifactStore.ts` writes the artifact
 * last, so its presence is the liveness test, and the 21 scratch directories with no finished sibling held
 * 2.9 MB between them (repro: `cd $SLOPWEAVER_HOME/orchestration && for s in *.scratch; do [ -f
 * "${s%.scratch}/artifact.md" ] || echo "$s"; done | xargs du -sck | tail -1`), so skipping them costs
 * nothing and removes the only way this verb could delete a running pass's workspace. The record directory
 * is never a candidate: it is what the witness re-checks.
 */
export const RECLAIM_ROOTS: readonly ReclaimRoot[] = [
  {
    because:
      "Codex runs under a workspace-write sandbox with the repository deliberately unwritable and absent " +
      "from additionalDirectories, so the one place a pass may write is the scratch this home mints for " +
      "it (codex/artifactStore.ts createPassScratch) — which is why the clones, installs and builds a pass " +
      "ran to check a claim land in a user-level home, and why they are spent once its artifact exists",
    homeSegment: "orchestration",
    name: "codex-scratch",
    takes: "finished-scratch",
  },
] as const;

/**
 * Find the declared root a `--root` name selects.
 *
 * @param name what the caller typed
 * @returns the root, or undefined when nothing is declared under that name
 */
export function findRoot({ name }: { name: string }): ReclaimRoot | undefined {
  return RECLAIM_ROOTS.find((root) => root.name === name);
}

/**
 * Every declared root's name, for a refusal that has to say what the caller could have typed.
 *
 * @returns the names, in declaration order
 */
export function declaredRootNames(): readonly string[] {
  return RECLAIM_ROOTS.map((root) => root.name);
}
