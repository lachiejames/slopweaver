/**
 * Where one simple command's program sits, past leading constructs, assignments and wrappers — the step every program
 * grammar of the call-state tripwire (`./callStateOperands.ts`) takes first. An `env -S`/`--split-string` string is
 * split into the words it runs, as env itself does, so `env -S "rm x.jsonl"` reaches `rm`. Pure, no I/O.
 */
import { PREFIXES, programName, under } from "./callStateArgs.js";
import { type ShellWord, shellWords, slicedWord } from "./shellLexing.js";

/**
 * Each wrapper's options that take the next word as their value — short letters (valued when one ends a cluster, so
 * `sudo -Eu alice`) and long options written without `=`: `env -u NAME`, `sudo -p prompt`.
 */
const PREFIX_VALUED: Readonly<Record<string, { readonly letters: string; readonly long: ReadonlySet<string> }>> = {
  // macOS `arch -arch arm64 rm …`: the `-arch` word ends in its valued letter, `-arm64` in none.
  arch: { letters: "eh", long: new Set() },
  caffeinate: { letters: "tw", long: new Set() },
  command: { letters: "", long: new Set() },
  doas: { letters: "uC", long: new Set() },
  env: { letters: "uCPS", long: new Set(["--unset", "--chdir", "--split-string"]) },
  exec: { letters: "a", long: new Set() },
  nice: { letters: "n", long: new Set(["--adjustment"]) },
  nohup: { letters: "", long: new Set() },
  stdbuf: { letters: "ioe", long: new Set(["--input", "--output", "--error"]) },
  sudo: {
    letters: "CDghpRrtTUu",
    long: new Set([
      "--chdir",
      "--chroot",
      "--close-from",
      "--command-timeout",
      "--group",
      "--host",
      "--other-user",
      "--prompt",
      "--role",
      "--type",
      "--user",
    ]),
  },
  time: { letters: "fo", long: new Set(["--format", "--output"]) },
  // GNU `timeout [options] DURATION program`: the duration is stepped over after the options.
  timeout: { letters: "sk", long: new Set(["--signal", "--kill-after"]) },
};

/** Each wrapper's options that change the directory the program runs in. */
const PREFIX_CHDIR: Readonly<Record<string, ReadonlySet<string>>> = {
  env: new Set(["-C", "--chdir"]),
  sudo: new Set(["-D", "--chdir"]),
};

/**
 * The directory the wrappers before the program move it into — `env -C DIR`, `sudo -D DIR`, `--chdir=DIR` — each
 * relative one under the one before it (`env -C <home>/talk env -C calls rm live.jsonl`). A valued option's value is
 * stepped over, never read as the next wrapper: `env -u sudo -C <dir>` unsets a variable named `sudo` and still moves.
 *
 * @param leading the words before the program: its assignments and wrappers
 * @returns the directory the program runs in, from where the segment runs, or `undefined` when no wrapper moves it
 */
export function wrapperChdir({ leading }: { leading: readonly ShellWord[] }): ShellWord | undefined {
  let prefix = "";
  let dir: ShellWord | undefined;
  for (let index = 0; index < leading.length; index += 1) {
    const word = leading[index]!;
    if (!word.text.startsWith("-")) {
      const named = programName({ text: word.text }).toLowerCase();
      if (PREFIXES.has(named)) {
        prefix = named;
      }
      continue;
    }
    dir = movedTo({ dir, moved: chdirValue({ index, leading, options: PREFIX_CHDIR[prefix] }) });
    if (prefixTakesValue({ option: word.text, prefix })) {
      index += 1;
    }
  }
  return dir;
}

/** Where a wrapper's chdir leaves the program: a relative move under the one before it, none leaving it where it was. */
function movedTo({ dir, moved }: { dir: ShellWord | undefined; moved: ShellWord | undefined }): ShellWord | undefined {
  if (moved === undefined) {
    return dir;
  }
  return dir === undefined ? moved : under({ dir, word: moved });
}

/** The directory one wrapper word names by a chdir option, spaced or `--chdir=`, or `undefined` when it names none. */
function chdirValue({
  leading,
  index,
  options,
}: {
  leading: readonly ShellWord[];
  index: number;
  options: ReadonlySet<string> | undefined;
}): ShellWord | undefined {
  const word = leading[index]!;
  if (options === undefined) {
    return undefined;
  }
  if (options.has(word.text) && index + 1 < leading.length) {
    return leading[index + 1]!;
  }
  if (word.text.startsWith("--chdir=")) {
    return slicedWord({ end: word.text.length, start: "--chdir=".length, word });
  }
  return undefined;
}

/** Wrappers that take one positional word before the program they run. */
const PREFIX_POSITIONAL: ReadonlySet<string> = new Set(["timeout"]);

/** Whether a wrapper's option takes the next word as its value. */
function prefixTakesValue({ prefix, option }: { prefix: string; option: string }): boolean {
  const valued = PREFIX_VALUED[prefix];
  if (valued === undefined) {
    return false;
  }
  if (option.startsWith("--")) {
    return valued.long.has(option);
  }
  return option.length > 1 && valued.letters.includes(option.slice(-1));
}

/**
 * Unquoted reserved words a command may follow, which run it rather than name it (`! rm <call file>` still
 * removes it; the `!` only negates the status).
 */
const RESERVED_LEADERS: ReadonlySet<string> = new Set([
  "!",
  "{",
  "(",
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
  "coproc",
]);

/**
 * How many words a `coproc` takes before what it runs: itself, and a NAME when a compound command follows it, as in
 * `coproc NAME { rm <call file>; }` (`coproc rm <call file>` runs the `rm`).
 */
function coprocWidth({ words, index }: { words: readonly ShellWord[]; index: number }): number {
  const name = words[index + 1];
  const after = words[index + 2];
  const compound = after !== undefined && !after.quoted && RESERVED_LEADERS.has(after.text);
  return name !== undefined && compound && /^[A-Za-z_]\w*$/u.test(name.text) ? 2 : 1;
}

/**
 * How many words before the program one leading construct takes, or 0 when the word is no leader: a reserved word,
 * an assignment, `function NAME`, a `case WORD in … PATTERN)` header, or a word closing on an unquoted `)` — a later
 * case arm's pattern or a `name()` definition (`case x in x) rm <call file>;; esac`).
 */
function leaderWidth({ words, index }: { words: readonly ShellWord[]; index: number }): number {
  const word = words[index]!;
  if (!word.quoted && word.text === "coproc") {
    return coprocWidth({ index, words });
  }
  if (!word.quoted && RESERVED_LEADERS.has(word.text)) {
    return 1;
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word.unquotedPrefix) || word.shape.endsWith(")")) {
    return 1;
  }
  if (!word.quoted && word.text === "function") {
    return 2;
  }
  if (!word.quoted && word.text === "case") {
    const arm = words.findIndex((later, at) => at > index && later.shape.endsWith(")"));
    return arm === -1 ? words.length - index : arm - index + 1;
  }
  return 0;
}

/**
 * The string one `env` option word hands `-S` to split, and how many words it spans: `-S str`, `-Sstr`, a cluster
 * ending in `S` (`-iS str`), `--split-string str`, `--split-string=str` or any unambiguous abbreviation of it, as GNU
 * reads one. `undefined` when the word sets no split string.
 */
function splitString({
  words,
  at,
}: {
  words: readonly ShellWord[];
  at: number;
}): { value: string; width: number } | undefined {
  const text = words[at]!.text;
  const next = words[at + 1];
  const long = /^--([a-z-]+)(?:=(.*))?$/su.exec(text);
  if (long !== null) {
    const [, name, attached] = long;
    if (!"split-string".startsWith(name!)) {
      return undefined;
    }
    if (attached !== undefined) {
      return { value: attached, width: 1 };
    }
    return next === undefined ? undefined : { value: next.text, width: 2 };
  }
  // The first valued letter takes the rest of the cluster, so `-uS` unsets a variable named `S`.
  const valued = /^-[^-uCPS]*([uCPS])(.*)$/su.exec(text);
  if (valued === null || valued[1] !== "S") {
    return undefined;
  }
  if (valued[2] !== "") {
    return { value: valued[2]!, width: 1 };
  }
  return next === undefined ? undefined : { value: next.text, width: 2 };
}

/**
 * Step past one wrapper's options from `index`: where what follows them starts, or the command's words with an `env`
 * split string split in place when an option sets one.
 */
function pastOptions({
  words,
  index,
  prefix,
}: {
  words: readonly ShellWord[];
  index: number;
  prefix: string;
}): { index: number } | { split: readonly ShellWord[] } {
  let at = index;
  while (at < words.length && words[at]!.text.startsWith("-")) {
    const split = prefix === "env" ? splitString({ at, words }) : undefined;
    if (split !== undefined) {
      const inner = shellWords({ text: split.value }).words;
      return { split: [...words.slice(0, at), ...inner, ...words.slice(at + split.width)] };
    }
    at += prefixTakesValue({ option: words[at]!.text, prefix }) ? 2 : 1;
  }
  return { index: at };
}

/**
 * The words one simple command runs, an `env` split string split in place, and where its program sits among them —
 * past leading constructs, assignments and wrappers.
 *
 * @param words the command's words with every redirection already removed
 * @returns the words, split, and the program's index among them, or `undefined` when there is no program
 */
export function programAt({ words }: { words: readonly ShellWord[] }): {
  words: readonly ShellWord[];
  at: number | undefined;
} {
  let index = 0;
  while (index < words.length) {
    const width = leaderWidth({ index, words });
    if (width > 0) {
      index += width;
      continue;
    }
    // Quoting a wrapper's name changes nothing it runs — a quoted `time` is `/usr/bin/time` — so it is stepped over
    // either way (`"env" rm <call file>`).
    const prefix = programName({ text: words[index]!.text }).toLowerCase();
    if (!PREFIXES.has(prefix)) {
      return { at: index, words };
    }
    const past = pastOptions({ index: index + 1, prefix, words });
    if ("split" in past) {
      return programAt({ words: past.split });
    }
    index = PREFIX_POSITIONAL.has(prefix) ? past.index + 1 : past.index;
  }
  return { at: undefined, words };
}
