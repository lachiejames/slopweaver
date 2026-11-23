/**
 * How `slopweaver dev lint` reads its own tail, for `./wholeTreeCheck.ts`: which runs of it are the whole lap or
 * a whole-Program gate, and which are local work. Pure: words in, a description out.
 */

/**
 * The `dev lint` gates whose one run IS a whole-tree type-checker build: `oxlint` runs `--type-aware` over
 * `.`, which is `tsgolint`, and `named-object-params` builds a whole-repo `ts.Program`. A unit test ties both
 * names to the real gate registry, so a rename cannot leave this set naming nothing.
 */
export const WHOLE_PROGRAM_GATES: ReadonlySet<string> = new Set(["oxlint", "named-object-params"]);

/**
 * The `dev lint` gates that build no type checker but re-check the whole tree CI's `lint` job already checks:
 * `prettier --check .` (76.6s and 8,066 MB of the lap) and `knip`'s whole-project resolution, both measured in
 * `src/devLint/gateGroups.ts`. The same unit test ties these names to the real registry.
 */
export const WHOLE_TREE_GATES: ReadonlySet<string> = new Set(["prettier", "knip"]);

/**
 * The `dev lint` tail, read the way the verb reads it (`src/devLint/devLint.ts`'s `parseLintLane` and
 * `parseOnlySelection`): `--lane local` runs only what CI cannot see, `--lane seat` leaves out every whole-tree
 * gate and narrows `oxlint` to the changed files (`src/devLint/seatLint.ts`), and `--only` narrows the run to
 * named gates, which is local work unless one of them is a whole-Program or whole-tree gate.
 *
 * @param args the words after `dev lint` (or `yarn lint`)
 * @param label how the refusal names the command
 * @returns how a refusal names the whole-tree run they are, or `undefined` when they are local work
 */
export function devLintScope({ args, label }: { args: readonly string[]; label: string }): string | undefined {
  if (args.includes("--help") || args.includes("-h")) {
    return undefined;
  }
  const laneAt = args.indexOf("--lane");
  const lane = laneAt === -1 ? undefined : args[laneAt + 1];
  if (lane === "local" || lane === "seat") {
    return undefined;
  }
  const onlyAt = args.indexOf("--only");
  if (onlyAt === -1) {
    return `${label} (the whole lint lap, tsgolint included)`;
  }
  const selection = args[onlyAt + 1];
  if (selection === undefined) {
    return undefined;
  }
  const names = selection.split(",").map((name) => name.trim());
  const program = names.filter((name) => WHOLE_PROGRAM_GATES.has(name));
  const tree = names.filter((name) => WHOLE_TREE_GATES.has(name));
  const kinds = [
    ...(program.length === 0 ? [] : ["a whole-tree type-checker gate"]),
    ...(tree.length === 0 ? [] : ["a whole-tree CI gate"]),
  ];
  if (kinds.length === 0) {
    return undefined;
  }
  return `${label} --only ${[...program, ...tree].join(",")} (${kinds.join("; ")})`;
}
