/**
 * The one `store import-resolve` command every import verb prints for a question it names, so the line a person copies
 * answers that question under the SAME home the printing verb used: the home is always carried, made absolute, and
 * every token is quoted only where a shell needs it. That home's store is the one reached unless the pasting shell
 * sets `SLOPWEAVER_STORE_URL`, which `../../../store/config.ts` reads before any home; the store's connection string
 * carries a password, so it is never printed (the home is printed in full), and the apply notes when its own store came from that variable
 * (`./importApplyLines.ts`'s `withStoreOrigin`). Pure.
 */
import { resolve } from "node:path";

import { shellCommandLine } from "#lib/shellCommandLine.js";

/**
 * The `--home` a printed command carries: the home the verb actually used, made absolute against the directory it ran
 * in. It is never left off, not even for the user's default home: a bare command selects its home from the shell it
 * is pasted into (`$SLOPWEAVER_HOME`, else the default), which need not be the one the verb ran under, so only a
 * named home is sure to act under the same home from any directory or any shell.
 *
 * @param home the home the verb used: the `--home` flag's value as given, else `$SLOPWEAVER_HOME`'s resolved home
 * @param cwd the directory the printing verb ran in
 * @returns the absolute home every printed command names
 */
export function printedHome({ home, cwd }: { home: string; cwd: string }): string {
  return resolve(cwd, home);
}

/**
 * The exact command that applies one staged batch again — what to run after a commit whose outcome is unknown. It
 * repeats the apply it follows, so a strict apply is retried strict.
 *
 * @param batchId the staged batch's id
 * @param home the absolute home {@link printedHome} chose, which the command names
 * @param stopOnConflict whether the apply being repeated ran with --stop-on-conflict
 * @returns one pasteable command line
 */
export function importApplyCommand({
  batchId,
  home,
  stopOnConflict,
}: {
  batchId: string;
  home: string;
  stopOnConflict: boolean;
}): string {
  const strict = stopOnConflict ? ["--stop-on-conflict"] : [];
  return shellCommandLine({
    command: ["slopweaver", "store", "import", "--apply", batchId, ...strict, "--home", home],
  });
}

/**
 * The exact command that answers one staged import question.
 *
 * @param questionId the staged question's id
 * @param action the answer the command records
 * @param home the absolute home {@link printedHome} chose, which the command names
 * @returns one pasteable command line
 */
export function importResolveCommand({
  questionId,
  action,
  home,
}: {
  questionId: string;
  action: string;
  home: string;
}): string {
  return shellCommandLine({
    command: ["slopweaver", "store", "import-resolve", "--question", questionId, "--action", action, "--home", home],
  });
}
