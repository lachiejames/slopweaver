/**
 * The three kinds of process the cold-seat verdict tells apart — a shell, the `login` a shell may sit under, and any
 * other program — named off a process NAME, the one thing cmux reports (`./coldSeat.ts` § "What 'at its prompt' can
 * and cannot see"). Shared by the judge and the graft that rebuilds a 0.65.2 tab's tree (`./coldGraft.ts`).
 */
import { basename, dirname } from "node:path";

/** The process that hands a tab over to its shell; at a prompt it is the shell's parent and nothing else. */
export const LOGIN_NAME = "login";

/**
 * The one path a tab's `login` is started from, `/usr/bin/login -flp <user> /bin/zsh` on every tab measured. A
 * program at `/tmp/login` that forks a real shell and keeps reading the tty is a `login` to every name-only check,
 * and the path is the one column that says it is not this one.
 */
const LOGIN_PATH = "/usr/bin/login";

/**
 * Whether a `login`-named row's command line starts from {@link LOGIN_PATH}. The argv is the process's own word
 * for itself; its IMAGE is root's and cannot be read off `lsof` as the owner, so `./coldExecutables.ts` holds a
 * `login` to keeping no descriptor on the tab's tty instead.
 *
 * @param argv the full command line the table prints
 * @returns `true` only for `/usr/bin/login …`
 */
export function isSystemLoginArgv({ argv }: { argv: string }): boolean {
  const [name = ""] = argv.trim().split(/\s+/u);
  return name === LOGIN_PATH;
}

/** An interactive shell's process name, once a login shell's leading `-` and any directory are dropped. */
const SHELL_NAMES: ReadonlySet<string> = new Set([
  "ash",
  "bash",
  "csh",
  "dash",
  "elvish",
  "fish",
  "ksh",
  "mksh",
  "nu",
  "oksh",
  "pwsh",
  "sh",
  "tcsh",
  "xonsh",
  "yash",
  "zsh",
]);

/**
 * Whether `name` is a shell's process name, spelled as a login shell (`-zsh`) or by path (`/bin/zsh`).
 *
 * @param name the process name cmux or the table reports
 * @returns `true` for a shell
 */
export function isShellName({ name }: { name: string }): boolean {
  return SHELL_NAMES.has(bareName({ name }));
}

/**
 * A process name with a login shell's leading `-` and any directory dropped: `-/bin/zsh`, `-zsh` and `zsh` are one
 * name. The spelling two reads of one shell agree on (a `zsh` to cmux and a
 * `bash` to the table passed as the same shell, so a pid reused by another shell confirmed the one that was gone).
 *
 * @param name the process name cmux or the table reports
 * @returns the bare name
 */
export function bareName({ name }: { name: string }): string {
  return basename(name.replace(/^-/u, ""));
}

/**
 * The directories a shell cmux starts a tab on lives in. A tab's shell is started by path, `-/bin/zsh` on every tab
 * measured, so a shell spelled by bare name or by a path outside these is not the one cmux started: a
 * program at `/tmp/zsh` reading its stdin is a `zsh` to every name-only check, and the path is the one column that says it is not `/bin/zsh`.
 */
const SHELL_DIRECTORIES: ReadonlySet<string> = new Set([
  "/bin",
  "/opt/homebrew/bin",
  "/opt/local/bin",
  "/usr/bin",
  "/usr/local/bin",
]);

/**
 * Whether a shell's first argv word names a shell by absolute path in one of {@link SHELL_DIRECTORIES}, with or
 * without a login shell's leading `-`.
 *
 * @param word the first word of the table's argv
 * @returns `true` for `-/bin/zsh`, `/usr/local/bin/bash` and the like; `false` for `zsh`, `-zsh` and `/tmp/zsh`
 */
export function isSystemShellPath({ word }: { word: string }): boolean {
  const path = word.replace(/^-/u, "");
  return path.startsWith("/") && SHELL_DIRECTORIES.has(dirname(path)) && SHELL_NAMES.has(basename(path));
}

/**
 * The short-option letters that leave a shell at its prompt, `-l` and `-i` and a bundle of them, judged one by one and
 * case-sensitively. An ALLOWLIST, not a denylist of `c` and `s`: PowerShell's options are single-dash words it reads
 * case-insensitively, so `/usr/local/bin/pwsh -COMMAND '…'` carried no lowercase `c` and passed as a bundle of
 * harmless letters while it ran a loop. cmux starts every tab's shell
 * with no flag at all (`-/bin/zsh`, measured), so nothing a reopened tab runs is refused by this.
 */
const INTERACTIVE_SHORT_LETTERS: ReadonlySet<string> = new Set(["i", "l"]);

/**
 * The long options that leave a shell at its prompt, spelled with every `-` and `_` after the `--` dropped and
 * lowercased, the way zsh reads its own (`--no-rcs`, `--norcs` and `--NO_RCS` are one option). Every other long option
 * is refused: zsh spells `-s` as `--shinstdin` and `--shin-stdin`, fish spells `-c` as `--command`, nu takes `--stdin`,
 * and an allowlist is the one shape that cannot miss a spelling.
 */
const INTERACTIVE_LONG_OPTIONS: ReadonlySet<string> = new Set([
  "interactive",
  "login",
  "noprofile",
  "norc",
  "norcs",
  "posix",
]);

/**
 * Whether a shell's full command line is one an interactive shell at a prompt is started with: the shell by its
 * system path ({@link isSystemShellPath}), then only option words (`-l`, `-i`, `-li`, `--login`) off two allowlists.
 * A word that is not an option is a script, and
 * a shell reading a script — blocked on a FIFO it was handed, say — is childless and sleeping exactly as a prompt is,
 * with its argv the one column that says otherwise. The letters are
 * judged one by one off {@link INTERACTIVE_SHORT_LETTERS}, so a bundled `-ls` is refused with `-s` and `-COMMAND` with its `C`, and a long option is accepted only
 * off {@link INTERACTIVE_LONG_OPTIONS}, so `--shinstdin` is refused as `-s` is.
 * `--`, a lone `-` and any option that itself takes a value (`-o`, `--rcfile`) are refused too: the safe direction,
 * since a shell started that way is not the bare tab a restart leaves.
 *
 * @param argv the full command line the table prints
 * @returns `true` when nothing after the shell's own name could make it read from anywhere but its prompt
 */
export function isInteractiveShellArgv({ argv }: { argv: string }): boolean {
  const [name = "", ...words] = argv.trim().split(/\s+/u);
  return isSystemShellPath({ word: name }) && words.every((word) => isInteractiveShellFlag({ word }));
}

/**
 * Whether one word after a shell's name is an option that leaves it reading its own prompt.
 *
 * @param word the word
 * @returns `true` for an allowlisted long option, or a bundle of allowlisted short-option letters
 */
function isInteractiveShellFlag({ word }: { word: string }): boolean {
  if (word === "--" || word === "-") {
    return false;
  }
  if (word.startsWith("--")) {
    return INTERACTIVE_LONG_OPTIONS.has(word.slice(2).replaceAll(/[-_]/gu, "").toLowerCase());
  }
  return word.startsWith("-") && Array.from(word.slice(1)).every((letter) => INTERACTIVE_SHORT_LETTERS.has(letter));
}

/** The three kinds of process the prompt verdict tells apart: a shell, the `login` a shell may sit under, anything else. */
export type ProcessClass = "shell" | "login" | "program";

/**
 * Which {@link ProcessClass} a process name is, however it is spelled.
 *
 * @param name the process name cmux or the table reports
 * @returns its class
 */
export function processClass({ name }: { name: string }): ProcessClass {
  if (isShellName({ name })) {
    return "shell";
  }
  return basename(name) === LOGIN_NAME ? "login" : "program";
}
