/**
 * Which operand a destination writer (`cp`, `install`, `ln`, `rsync`, `ditto`) overwrites when an option may sit AFTER
 * its operands. rsync and the GNU tools permute their arguments, so `rsync src dst --exclude x` writes `dst` and the
 * last word is an option's value. Pure, no I/O.
 *
 * Each program's options that take the next word as their value are listed below, short and long. A long option this
 * does not know, written without `=`, may or may not take one, so both readings are judged and either destination is
 * refused: `rsync src dst --frob x` judges `x` and `dst`. That errs toward over-refusal, never toward a missed write.
 */
import { longOption } from "./longOption.js";
import { type ShellWord, slicedWord } from "./shellLexing.js";

/** Short option letters that take a value, per program — attached (`-eSSH`) or as the next word. */
const VALUED_LETTERS: Readonly<Record<string, string>> = {
  cp: "St",
  ditto: "",
  install: "BfgmoSt",
  ln: "St",
  rsync: "efBTM@",
};

/** Long options that take the next word as their value when written without `=`, per program. */
const VALUED_LONG: Readonly<Record<string, ReadonlySet<string>>> = {
  cp: new Set(["--suffix", "--target-directory"]),
  ditto: new Set(["--arch", "--bom"]),
  install: new Set(["--group", "--mode", "--owner", "--suffix", "--target-directory", "--strip-program"]),
  ln: new Set(["--suffix", "--target-directory"]),
  rsync: new Set(
    [
      "address",
      "backup-dir",
      "block-size",
      "bwlimit",
      "checksum-choice",
      "chmod",
      "chown",
      "compare-dest",
      "compress-choice",
      "compress-level",
      "contimeout",
      "copy-dest",
      "debug",
      "exclude",
      "exclude-from",
      "files-from",
      "filter",
      "groupmap",
      "iconv",
      "include",
      "include-from",
      "info",
      "link-dest",
      "log-file",
      "log-file-format",
      "max-delete",
      "max-size",
      "min-size",
      "modify-window",
      "only-write-batch",
      "out-format",
      "outbuf",
      "partial-dir",
      "password-file",
      "port",
      "protocol",
      "remote-option",
      "rsh",
      "rsync-path",
      "skip-compress",
      "sockopts",
      "stop-after",
      "stop-at",
      "suffix",
      "temp-dir",
      "timeout",
      "usermap",
      "write-batch",
    ].map((option) => `--${option}`),
  ),
};

/** An rsync operand on another host, `host:path` or `host::module`. */
export const REMOTE_OPERAND = /^[^/]*:/u;

/** One operand, and whether it might instead be the value of the unknown long option before it. */
interface ReadOperand {
  readonly word: ShellWord;
  readonly maybeValue: boolean;
}

/** Whether an option takes the next word: surely, perhaps (an unknown long option), or not. */
function optionTakes({ name, text }: { name: string; text: string }): "value" | "maybe" | undefined {
  if (text.startsWith("--")) {
    if (text.includes("=")) {
      return undefined;
    }
    return VALUED_LONG[name]?.has(text) ? "value" : "maybe";
  }
  const valued = VALUED_LETTERS[name];
  if (valued === undefined) {
    return undefined;
  }
  const letters = text.slice(1);
  for (let index = 0; index < letters.length; index += 1) {
    if (valued.includes(letters[index]!)) {
      // A valued letter takes the rest of its cluster as the value, or the next word when it ends the cluster.
      return index === letters.length - 1 ? "value" : undefined;
    }
  }
  return undefined;
}

/**
 * rsync's long options whose value is a place it writes a file whose name is the program's choice — a replaced file's
 * backup, a partial transfer, a batch file — so the value is judged as a destination itself (for example
 * `--backup-dir=<home>/talk` backs `call-index.txt` up over the live one). Each is read by any abbreviation rsync
 * accepts, down to the shortest no other option shares, so `--backup` and `--partial` stay themselves.
 */
const WRITTEN_VALUES: readonly { readonly full: string; readonly shortest: string }[] = [
  { full: "--backup-dir", shortest: "--backup-d" },
  { full: "--partial-dir", shortest: "--partial-d" },
  { full: "--write-batch", shortest: "--write-b" },
  { full: "--only-write-batch", shortest: "--only" },
];

/** The value of a writing option, spaced (`next`) or attached by `=`, as one word, or none when the option is not one. */
function writtenValue({
  name,
  word,
  next,
}: {
  name: string;
  word: ShellWord;
  next: ShellWord | undefined;
}): readonly ShellWord[] {
  if (name !== "rsync") {
    return [];
  }
  const writes = WRITTEN_VALUES.find(
    ({ full, shortest }) => word.text.startsWith(shortest) && longOption({ full, word: word.text }) !== undefined,
  );
  if (writes === undefined) {
    return [];
  }
  const equals = word.text.indexOf("=");
  if (equals === -1) {
    return next === undefined ? [] : [next];
  }
  return [slicedWord({ end: word.text.length, start: equals + 1, word })];
}

/** The option texts and the operands of an argument list, an unquoted `--` ending the options. */
function readArgs({ name, args }: { name: string; args: readonly ShellWord[] }): {
  options: readonly string[];
  operands: readonly ReadOperand[];
  written: readonly ShellWord[];
} {
  const options: string[] = [];
  const operands: ReadOperand[] = [];
  const written: ShellWord[] = [];
  let ended = false;
  let pending: "value" | "maybe" | undefined;
  for (const [index, arg] of args.entries()) {
    if (pending === "value") {
      pending = undefined;
      continue;
    }
    const option = arg.text.startsWith("-") && arg.text !== "-";
    if (ended || !option) {
      operands.push({ maybeValue: pending === "maybe", word: arg });
    } else if (arg.text === "--" && !arg.quoted) {
      ended = true;
    } else {
      options.push(arg.text);
      written.push(...writtenValue({ name, next: args[index + 1], word: arg }));
      pending = optionTakes({ name, text: arg.text });
      continue;
    }
    pending = undefined;
  }
  return { operands, options, written };
}

/**
 * A destination writer's options and operands, and every operand that is its destination under some reading of the
 * options after its operands.
 *
 * @param name the writer, `cp`, `install`, `ln`, `rsync` or `ditto`
 * @param args its arguments, a `-t` target directory already taken out
 * @returns the option texts, every operand, each possible destination — none for an rsync listing or a remote one —
 *   and each place an option names for a file of the program's own naming (rsync's `--backup-dir`)
 */
export function writerOperands({ name, args }: { name: string; args: readonly ShellWord[] }): {
  readonly options: readonly string[];
  readonly operands: readonly ShellWord[];
  readonly destinations: readonly ShellWord[];
  readonly written: readonly ShellWord[];
} {
  const { options, operands, written } = readArgs({ args, name });
  // One rsync operand and no destination is a listing: rsync only reads it.
  const least = name === "rsync" ? 2 : 1;
  const destinations: ShellWord[] = [];
  let kept = operands.length;
  while (kept >= least) {
    const last = operands[kept - 1]!;
    // A remote destination is on another host: the local operands before it are only read.
    if (name !== "rsync" || !REMOTE_OPERAND.test(last.word.text)) {
      destinations.push(last.word);
    }
    if (!last.maybeValue) {
      break;
    }
    kept -= 1;
  }
  return { destinations, operands: operands.map((operand) => operand.word), options, written };
}

/** Options that make a writer place a source somewhere other than `<destination>/<its last component>`. */
function writesDestinationItself({ name, options }: { name: string; options: readonly string[] }): boolean {
  if (name === "ditto") {
    // ditto copies a directory's CONTENTS into its destination.
    return true;
  }
  // Each long one by any abbreviation too (GNU `cp --par`), a prefix another option shares over-refusing.
  return options.some(
    (option) =>
      ["--no-target-directory", "--parents", "--relative"].some(
        (full) => longOption({ full, word: option }) !== undefined,
      ) ||
      // A file list names the paths written below the destination, relative ones kept (`--files-from`, and
      // its abbreviation `--files-f=`).
      (longOption({ full: "--files-from", word: option }) !== undefined && name === "rsync") ||
      (/^-[A-Za-z]*T/u.test(option) && name !== "rsync") ||
      (/^-[A-Za-z]*R/u.test(option) && name === "rsync"),
  );
}

/**
 * Whether a source's last path component is known as written: not empty, `.` or `..` (a trailing `/` copies
 * contents), free of any expansion, and not after a command substitution, whose output may hold a `/` of its own. A
 * plain variable earlier in the path leaves it known: `"$SLOPWEAVER_HOME"/talk/calls/x.jsonl` ends in `x.jsonl`
 *.
 */
function lastComponentKnown({ source }: { source: ShellWord }): boolean {
  const last = source.text.slice(source.text.lastIndexOf("/") + 1);
  if (/^\.{0,2}$/u.test(last) || /[$`(){}]/u.test(last)) {
    return false;
  }
  return !source.dynamic || !/\$\(|`/u.test(source.text);
}

/**
 * The paths a writer writes into an existing destination DIRECTORY: `<destination>/<last component>` of each source,
 * so `cp ~/.slopweaver/talk/calls/x.jsonl ~/.slopweaver/` writes `~/.slopweaver/x.jsonl` and touches no call state
 *. The destination itself is kept whenever that reading may not hold — `ditto`, a `-T`, `--parents` or
 * rsync's `-R`, a source ending in `/` (its contents are copied), one whose last component an expansion decides, or
 * none at all — and a
 * destination that is a protected file or lies inside a protected directory is still reached through every path here.
 *
 * @param destination the destination word, as written
 * @param sources the operands it copies from
 * @returns the words naming what is written
 */
export function writtenInto({
  name,
  options,
  destination,
  sources,
}: {
  name: string;
  options: readonly string[];
  destination: ShellWord;
  sources: readonly ShellWord[];
}): readonly ShellWord[] {
  const unplaceable = sources.some((source) => !lastComponentKnown({ source }));
  if (sources.length === 0 || unplaceable || writesDestinationItself({ name, options })) {
    return [destination];
  }
  return sources.map((source) => {
    const last = source.text.slice(source.text.lastIndexOf("/") + 1);
    return {
      ...destination,
      quoted: destination.quoted || source.quoted,
      shape: `${destination.shape}/${source.shape.slice(source.text.length - last.length)}`,
      text: `${destination.text}/${last}`,
    };
  });
}
