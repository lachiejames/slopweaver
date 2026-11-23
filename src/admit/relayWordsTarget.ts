/**
 * Whether one `Write` or `Edit` lands on a board row the relay-words guard judges — the guard's ONLY question on the
 * common path, so it is answered from the payload's own strings and reads nothing.
 *
 * The guard is wired to `Edit|Write`, close to the highest-frequency matcher there is, on a machine whose hooks
 * already run 13 to 15 seconds under load. So everything that is not a Markdown file directly in the board directory
 * or its archive is decided here by a lexical test, before any file is opened or any module the judgement needs is
 * loaded (`./relayWordsGuardRunner.ts` imports those lazily, only past this test).
 *
 * ## The one filesystem question, and when it is asked
 *
 * A home reached through a symlink has a second, equally real spelling of every row, and a test that only compares
 * spellings would let one of them through. Resolving every write path would charge every source edit a syscall, so a
 * path is resolved only when it already LOOKS like a board row by name — its directory is called `handovers`, or
 * `archive` inside one — and the plain comparison missed. An ordinary source write never reaches it.
 *
 * Pure: the one filesystem question is injected.
 */
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/** The board's archive, inside the board directory. */
const ARCHIVE_DIR = "archive";

/** The board directory's own name, which a symlinked spelling still carries. */
const BOARD_DIR_NAME = "handovers";

/** The two tools whose payload says what a file will hold afterwards. */
const JUDGED_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit"]);

/**
 * The payload's path as an absolute one, resolved against the payload's `cwd` when it is relative — lexically, with
 * no filesystem access.
 *
 * @param filePath the payload's `file_path`
 * @param cwd the payload's `cwd`, absent when it carries none
 * @returns the absolute path, or `undefined` for a relative path with no `cwd` to resolve it against
 */
function absolutePath({ filePath, cwd }: { filePath: string; cwd: string | undefined }): string | undefined {
  if (isAbsolute(filePath)) {
    return resolve(filePath);
  }
  if (cwd === undefined || !isAbsolute(cwd)) {
    return undefined;
  }
  return resolve(cwd, filePath);
}

/** Whether a directory is NAMED like the board or its archive, whatever it resolves to. */
function namedLikeBoard({ dir }: { dir: string }): boolean {
  if (basename(dir) === BOARD_DIR_NAME) {
    return true;
  }
  return basename(dir) === ARCHIVE_DIR && basename(dirname(dir)) === BOARD_DIR_NAME;
}

/**
 * Whether a `Write` or `Edit` lands directly in the board directory or its archive, on a Markdown file.
 *
 * @param toolName the payload's `tool_name`
 * @param filePath the payload's `file_path`
 * @param cwd the payload's `cwd`, which a relative path is resolved against
 * @param handoversDir the board directory of the home this hook guards
 * @param realDir resolves a directory through every symlink, `undefined` when it cannot — asked only for a path
 *   named like a board row that the plain comparison missed
 * @returns the absolute path the write lands on, or `undefined` when the guard has nothing to judge
 */
export function relayWordsTarget({
  toolName,
  filePath,
  cwd,
  handoversDir,
  realDir,
}: {
  toolName: string;
  filePath: string;
  cwd: string | undefined;
  handoversDir: string;
  realDir: (args: { dir: string }) => string | undefined;
}): string | undefined {
  if (!JUDGED_TOOLS.has(toolName) || !filePath.endsWith(".md")) {
    return undefined;
  }
  const path = absolutePath({ cwd, filePath });
  if (path === undefined) {
    return undefined;
  }
  const dir = dirname(path);
  const boardDirs = [resolve(handoversDir), join(resolve(handoversDir), ARCHIVE_DIR)];
  if (boardDirs.includes(dir)) {
    return path;
  }
  if (!namedLikeBoard({ dir })) {
    return undefined;
  }
  const real = realDir({ dir });
  const realBoardDirs = boardDirs.map((one) => realDir({ dir: one }));
  return real !== undefined && realBoardDirs.includes(real) ? path : undefined;
}
