/**
 * The programs that ARE a check, for `./wholeTreeCheck.ts`: `tsc`, a type-aware lint (`oxlint --type-aware`,
 * `tsgolint`), `vitest`, a Prettier check and `knip`. Each is judged by its own invocation module; this one
 * names what a refusal says. Pure: words in, a description out. The walk that finds these programs, wherever a
 * command line hides them, stays in `./wholeTreeCheck.ts`.
 */
import { knipScope, prettierScope } from "./formatToolInvocation.js";
import { typeAwareLintScope } from "./oxlintInvocation.js";
import type { ShellWord } from "./shellLexing.js";
import { tscScope } from "./tscInvocation.js";
import { vitestRunLane } from "./vitestInvocation.js";

/**
 * `tsc`: a check over a project unless every operand is a source file and it names no project.
 *
 * @param args the words after `tsc`
 * @returns how a refusal names the whole-tree run, or `undefined` when it is local work
 */
export function tscLane({ args }: { args: readonly string[] }): string | undefined {
  if (tscScope({ args }) !== "project") {
    return undefined;
  }
  return `${["tsc", ...args].join(" ")} (tsc over the whole project)`;
}

/**
 * One check program and its arguments. `oxlint` without a type mode never builds the checker, so it is not
 * this gate's business at any width.
 *
 * @param args the words after the program
 * @param program the program's own name, without its directory
 * @param cwd the directory it runs in, when known
 * @param fed whether an `xargs` in the same command list hands it operands at run time
 * @returns how a refusal names the whole-tree run, or `undefined` for local work or a program that is no check
 */
export function checkToolLane({
  args,
  program,
  cwd,
  fed,
}: {
  args: readonly ShellWord[];
  program: string;
  cwd: string | undefined;
  fed: boolean;
}): string | undefined {
  const texts = args.map((word) => word.text);
  if (program === "tsc") {
    return tscLane({ args: texts });
  }
  if (program === "vitest") {
    return vitestRunLane({ args: texts, cwd, fed });
  }
  if (program === "prettier") {
    return prettierLane({ args, fed });
  }
  if (program === "knip") {
    return knipScope({ args }) === "local" ? undefined : "knip (whole-project dependency resolution, CI's lint job)";
  }
  if (program !== "oxlint" && program !== "tsgolint") {
    return undefined;
  }
  const scope = typeAwareLintScope({ args, program });
  return scope.kind === "local" ? undefined : `${program} --type-aware over ${scope.over} (tsgolint)`;
}

/**
 * `prettier`: a whole-tree format check unless an `xargs` feeds it files or it names only files.
 *
 * @param args the words after `prettier`
 * @param fed whether an `xargs` in the same command list hands it operands at run time
 * @returns how a refusal names the whole-tree run, or `undefined` when it is local work
 */
function prettierLane({ args, fed }: { args: readonly ShellWord[]; fed: boolean }): string | undefined {
  if (fed) {
    return undefined;
  }
  const scope = prettierScope({ args });
  return scope.kind === "local" ? undefined : `prettier over ${scope.over} (a whole-tree format check, CI's lint job)`;
}
