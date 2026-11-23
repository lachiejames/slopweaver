/**
 * The gate that keeps a TypeScript compiler invocation from dying at a ceiling nobody named.
 *
 * This module is the TypeScript 6 criterion, the V8 heap policy. Which policy the gate judges by, and the
 * native-owner criterion TypeScript 7.1 needs, are `./tscOwnerContract.ts`'s: `TYPESCRIPT_PIN` selects one.
 *
 * ## The hole this closes
 *
 * MEASURED on this checkout. `yarn build` was `tsc -p tsconfig.json` with no
 * heap ceiling at all, and it could not run:
 *
 *     $ yarn build
 *     FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory
 *     (last GC at 4,085.3 MB, 61s elapsed, exit 129)
 *
 * The same project with the ceiling `yarn typecheck` has always carried finishes clean — 18,785 files,
 * `Memory used: 4,966,039K`, total 60.04s, zero errors. Reproduce either half:
 *
 *     node --max-old-space-size=8192 node_modules/typescript/bin/tsc -p tsconfig.json --extendedDiagnostics
 *     node node_modules/typescript/bin/tsc -p tsconfig.json          # dies at V8's own default
 *
 * **Nothing anywhere would have told us.** `yarn build` ran in no workflow, in no `lefthook` hook and not in
 * `yarn validate`; its only caller in the tree is `slopweaver worktree create --build`, which is off by
 * default. So the one way to discover the failure was to type the command, and nothing typed it. A `yarn build`
 * that dies at the default ceiling must fail closed, never be something that could be missed.
 *
 * That is two properties, and they are complementary rather than alternatives. `compile` in
 * `.github/workflows/ci.yml` makes the command RUN, so a compiler error or an insufficient ceiling reddens
 * the required check. This gate makes the ceiling DECLARED, so a script cannot go back to relying on a
 * default that is a fixed table lookup rather than a reading of the machine. Neither proves the other's
 * property: a present-but-too-small ceiling is still a CI failure, and a green CI lap says nothing about
 * the next script somebody writes.
 *
 * ## The criterion, stated rather than counted
 *
 * > Every `package.json` script that names the TypeScript compiler must be ONE direct `node` command that
 * > carries exactly one positive `--max-old-space-size` argument BEFORE the compiler entrypoint.
 *
 * No allowlist, no exemption marker, no script-name exception — renaming `build` must not evade it. The
 * ceiling never arrives through `NODE_OPTIONS`: a job-wide or shell-wide variable is a blanket that covers
 * every process including the ones whose growth nobody is watching, which is the reasoning `ci.yml`'s
 * `lint` and `typecheck` jobs already carry, and the owner has ruled that workaround permanently off.
 *
 * The criterion deliberately reaches a small-project or single-file compiler call too. Classifying "whole
 * repo" would mean resolving a tsconfig's `include`, its `extends` chain, its `files` and its project
 * references — a fragile size classifier that still could not answer the question, since a `-p` argument
 * names a project and never its size.
 *
 * ## The blind spot, stated rather than discovered
 *
 * This is a LITERAL package-script gate. It reads `package.json`'s own script strings and nothing else, so
 * a compiler call reached through a shell script, a JS wrapper, a dynamically built executable name, an
 * external task runner or the TypeScript API is invisible to it. It does not prove a declared ceiling is
 * SUFFICIENT — only `compile` going green proves that — and it does not force a fresh measurement when
 * somebody edits the number. Its conservative matching cuts the other way too: a script that merely
 * mentions the compiler in an informational message is refused rather than reasoned about, because a gate
 * that tried to interpret arbitrary shell would have to become one — with ONE exception it does read, a
 * shell COMMENT, because `echo ok # tsc` runs no compiler under any reading at all.
 *
 * **SELECTION over an unreadable command is a heuristic, and composing obfuscations can still beat it.**
 * This is the bound, stated because pretending completeness is the worse failure. Once a command carries a
 * shell operator this gate will not read it, so whether it is even a SUBJECT is decided by
 * {@link UNREADABLE_WORD_BREAK} splitting the raw text and stripping quotes and backslashes — enough for
 * `t\sc</dev/null`, not a shell parser. Brace expansion (`tsc{,}`) and ANSI-C quoting (`ts$'c'`) are two
 * spellings that reach `tsc` in a shell and not here, and a determined author can compose more.
 *
 * That is deliberate rather than unfinished, and the reason is what this gate is FOR. The failure it was
 * built from is `tsc -p tsconfig.json` — a ceiling lost by ordinary editing, which is the thing that
 * actually happened and cost a silent broken build. Every spelling a person might write WITHOUT meaning to
 * evade anything is covered, including the three Codex found that look innocent (`--max_old_space_size`, a
 * second heap flag later in the same line, and `lib/_tsc.js`). Nobody writes `t\sc</dev/null` in a `package.json` by
 * accident, so hardening against it buys no real coverage while making the reader harder to trust. A gate
 * whose stated scope is honest is worth more than one whose author believed it was total.
 *
 * ## What the earlier versions of this gate got wrong, and how
 *
 * Four defects, all found by a Codex review pass and none findable by reading the code, which is the whole
 * argument for the pass. The first three are the SAME shape: the gate compared a spelling, and the shell or
 * V8 read a different one. The fourth is the inverse, and the most instructive.
 *
 * Both stated properties broke at once. The evasion: V8 reads `--max_old_space_size` as the same
 * flag as `--max-old-space-size`, so `--max-old-space-size=8192 --max_old_space_size=0` was ONE occurrence
 * to a matcher comparing the dashed spelling and TWO to V8, the last of which restores the default ceiling.
 * {@link canonicalFlag} carries the measurement. The false refusal: a `tsc` inside a shell comment selected
 * the script and refused it.
 *
 * A BACKSLASH then broke the fixed gate. `--max-old-space-size=8192 --max\-old-space-size=0`
 * reached {@link canonicalFlag} as `--max\-old-space-size`, which canonicalises to nothing V8 ever sees —
 * while the shell strips the backslash before `node` is executed, so V8 gets two occurrences and applies the
 * second. Measured on Node v24.21.0: `heap_size_limit` 4,496,293,888, identical to the default. The reader
 * was not processing shell escapes at all, so {@link consumeEscaped} now does, by the shell's own rule
 * rather than by dropping every backslash — inside double quotes a backslash escapes only five characters
 * and is otherwise literal, and getting THAT wrong would have traded an evasion for a false refusal.
 * Reproduce the bypass against the fixed gate:
 *   node --max-old-space-size=8192 --max\-old-space-size=0 -e 'console.log(require("v8").getHeapStatistics().heap_size_limit)'
 *
 * Its third finding moved layer entirely — not the JUDGEMENT but the SELECTION.
 * `node node_modules/typescript/bin/tsc</dev/null --version` contains `<`, so the reader refuses it, and
 * the fallback deciding whether an unreadable command is even a SUBJECT split on whitespace alone: one
 * word, basename `null`, not a compiler, never judged at all, while a sibling compliant script carried the
 * assessment to green. {@link UNREADABLE_WORD_BREAK} is the fix and carries the reasoning for
 * over-selecting rather than under-selecting.
 *
 * The fourth is the one worth reading if you only read one, and it arrived only after the property was
 * NARROWED to what this gate honestly claims. `node node_modules/typescript/lib/_tsc.js -p tsconfig.json`
 * runs the real compiler at the default ceiling with no obfuscation anywhere in it —
 * {@link COMPILER_STEMS} knew the two public spellings and not the module they both load, so the script
 * was never selected. A person could write that line meaning nothing by it, which is precisely the class
 * this gate exists for, and it was invisible while the property under review was an absolute one that
 * invited counterexamples nobody would ever type.
 *
 * All four are closed, each with its own case in the test file. Three were one mistake at different layers
 * — the gate compared one spelling while the shell or V8 read another — and the fourth is its mirror,
 * judging only what a matcher had already agreed to look at. None was reachable by reading the code, which
 * is the whole argument for the review pass.
 *
 * Pure core / effectful shell: this file is the whole judgement over text; `./tscHeapContractRun.ts` reads
 * the file and prints.
 */

/** What one script's command text amounted to when read as a simple command. */
export type CommandReading =
  | { readonly kind: "tokens"; readonly tokens: readonly string[] }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * One script the contract refused, with the line `dev lint` prints for it.
 *
 * @internal — this gate's own return shape and its test.
 */
export interface TscHeapFinding {
  /** The `package.json` script key, so a reader can go straight to it. */
  readonly script: string;
  /** The whole refusal line, already naming the script and what is wrong with it. */
  readonly line: string;
}

/** What reading a whole scripts map amounted to. */
export interface TscHeapAssessment {
  /** Every script key whose command names the compiler — the gate's subjects. */
  readonly compilerScripts: readonly string[];
  /** One entry per refused script, in script order. */
  readonly findings: readonly TscHeapFinding[];
}

/** The heap argument a compiler invocation must carry, as this gate reports it. */
export const HEAP_FLAG = "--max-old-space-size";

/**
 * The shell constructs a subject command may not contain, since this gate reads no shell at all. A bare
 * parenthesis is shell syntax, a subshell or a syntax error, never an argument (Codex 8b r2).
 */
const SHELL_OPERATORS: readonly string[] = ["&&", "||", "|", ";", "&", ">", "<", "`", "$(", "(", ")", "\n"];

/**
 * How an UNREADABLE command is broken into words for SELECTION only — whitespace, plus every character a
 * shell operator is built from.
 *
 * Whitespace alone is not enough, and that gap was the third evasion Codex found: no shell character
 * separates `node_modules/typescript/bin/tsc</dev/null`, so a whitespace split hands {@link namesCompiler}
 * one word whose basename is `null`, the script is never selected as a subject at all, and a compiler
 * running at V8's default ceiling passes the gate by never being looked at. Reproduce against the fixed
 * gate with a script of `node node_modules/typescript/bin/tsc</dev/null --version`.
 *
 * Breaking on these characters deliberately OVER-selects — a word here is not a shell word. That is the
 * safe direction: selection only decides what gets judged, and the judgement an unreadable command then
 * receives is {@link readSimpleCommand}'s refusal naming the operator, never a pass.
 */
const UNREADABLE_WORD_BREAK = /[\s&|;<>`$()]+/u;

/**
 * The file extensions Node will resolve for a JavaScript entrypoint, stripped before a basename is judged.
 */
const JS_EXTENSION = /\.(?:js|cjs|mjs)$/u;

/**
 * Every path basename STEM that is the TypeScript compiler, extension already removed.
 *
 * `_tsc` is not an obfuscation — it is the real compiler module beside the `tsc` shim that loads it, and
 * `node node_modules/typescript/lib/_tsc.js -p tsconfig.json` compiles this project at V8's default
 * ceiling. Codex found it against the NARROWED property, then broke the literal fix by dropping the
 * extension: Node resolves `lib/_tsc` to `lib/_tsc.js` and runs it just the same. Comparing STEMS rather
 * than whole filenames is what closes both at once, and it is why this is a stem set and not the obvious
 * list of filenames. Re-check it against the installed package rather than trusting this comment:
 *   ls node_modules/typescript/lib node_modules/typescript/bin | grep -E '^_?tsc'
 */
const COMPILER_STEMS: ReadonlySet<string> = new Set(["tsc", "_tsc"]);

/**
 * A V8 flag name reduced to the ONE spelling V8 itself judges it by.
 *
 * V8 reads `--max_old_space_size` and `--max-old-space-size` as the same flag, so a gate that matched only
 * the dashed spelling could be walked straight past: `--max-old-space-size=8192 --max_old_space_size=0` is
 * two occurrences to V8, the last of which restores the default ceiling, and one occurrence to a matcher
 * that cannot see the alias. MEASURED on Node v24.21.0 — that pair reports a
 * `heap_size_limit` of 4,496,293,888 bytes against 8,791,261,184 for the dashed flag alone. Reproduce:
 *   node --max-old-space-size=8192 --max_old_space_size=0 -e 'console.log(require("v8").getHeapStatistics().heap_size_limit)'
 *   node --max-old-space-size=8192 -e 'console.log(require("v8").getHeapStatistics().heap_size_limit)'
 * This is the gate's own no-evasion property at work.
 *
 * @param name the flag name as written, without its `=value` tail
 * @returns the name with every underscore read as the hyphen V8 reads it as
 */
function canonicalFlag({ name }: { name: string }): string {
  return name.replaceAll("_", "-");
}

/**
 * Whether a token names the TypeScript compiler, by its path basename.
 *
 * `tsc`, `./node_modules/.bin/tsc`, `node_modules/typescript/bin/tsc` and a `tsc.js` entrypoint all answer
 * true; anything else answers false. Matching on the basename is what makes a renamed wrapper visible
 * rather than a spelling this gate quietly accepts.
 *
 * @param token one whitespace-delimited, quote-stripped word
 * @returns true when the token is a compiler entrypoint
 */
export function namesCompiler({ token }: { token: string }): boolean {
  const basename = token.split("/").pop();
  if (basename === undefined) {
    return false;
  }
  return COMPILER_STEMS.has(basename.replace(JS_EXTENSION, ""));
}

/**
 * Whether a command is one of this gate's subjects at all.
 *
 * Selection is deliberately BROAD, and it over-selects on purpose: any word naming the compiler makes a
 * script a subject, whatever runs it. A narrower rule — the compiler must sit in command position, or after
 * a known runner — reads better and opens a silent hole, because the runner list becomes an allowlist and
 * a spelling nobody enumerated (`npx`, `pnpm dlx`, a wrapper script) stops being selected at all. A false
 * refusal is loud and is fixed in the diff that caused it; a missed subject is the failure this gate exists
 * to prevent. So `echo tsc` IS refused here, and that is the trade rather than a defect.
 *
 * The ONE thing it does not read is a shell COMMENT. `echo ok # tsc` runs no compiler by any reading, and
 * refusing it would be this gate failing to tokenise rather than a trade it chose.
 * A command whose quoting cannot be read at all is still a subject: it falls back to the raw split, so it
 * reaches a finding instead of falling out of the selection.
 *
 * @param command the script's command text exactly as `package.json` holds it
 * @returns true when any word it actually runs names the compiler
 */
export function mentionsCompiler({ command }: { command: string }): boolean {
  const reading = readSimpleCommand({ command });
  if (reading.kind === "tokens") {
    return reading.tokens.some((token) => namesCompiler({ token }));
  }
  return command
    .split(UNREADABLE_WORD_BREAK)
    .map((chunk) => chunk.replace(/['"\\]/gu, ""))
    .some((token) => namesCompiler({ token }));
}

/** How far a quote-aware read of a command has got, folded one character at a time. */
interface TokeniserState {
  /** The words closed so far, in order. */
  readonly tokens: readonly string[];
  /** The word being built, which may legitimately be empty inside quotes. */
  readonly current: string;
  /** The quote character still open, or `""` outside quotes. */
  readonly quote: string;
  /** Whether a quote was opened in the current word, so `""` closes as an empty token rather than nothing. */
  readonly open: boolean;
  /** Whether a shell comment has started, after which no character is read at all. */
  readonly done: boolean;
  /** Whether the previous character was a backslash that escapes this one. */
  readonly escaped: boolean;
}

/**
 * The characters a backslash escapes INSIDE double quotes. Outside quotes it escapes every character;
 * inside single quotes it escapes none. Anything else after a backslash in double quotes is two literal
 * characters, which is the shell's rule and the reason this is a set rather than a flag.
 */
const DOUBLE_QUOTE_ESCAPES: ReadonlySet<string> = new Set(["$", "`", '"', "\\"]);

/**
 * Fold the character a backslash escaped, with the backslash itself already consumed.
 *
 * @param state the read, with `escaped` set by the backslash before this character
 * @param character the character the backslash preceded
 * @returns the state with the escape resolved into the word being built
 */
function consumeEscaped({ state, character }: { state: TokeniserState; character: string }): TokeniserState {
  const keepsBackslash = state.quote === '"' && !DOUBLE_QUOTE_ESCAPES.has(character);
  const literal = keepsBackslash ? `\\${character}` : character;
  return { ...state, current: state.current + literal, escaped: false, open: true };
}

/**
 * The readings that must be settled BEFORE a character can be judged as quoting, whitespace or a comment.
 *
 * All three are cases where the character in hand does not mean what it looks like: a comment has already
 * swallowed the rest of the line, a backslash before it took its meaning away, or it is that backslash.
 * Separated from {@link stepTokeniser} because folding them into the same chain put that function over the
 * `cognitive-complexity` ceiling — and the seam is a real one, not a way of making a number smaller: these
 * three answer "is this character even its own character", and the rest answers what it then means.
 *
 * @param state how far the read has got
 * @param character the next character of the command text
 * @returns the settled state, or undefined when this character still has to be read normally
 */
function stepBeforeQuoting({
  state,
  character,
}: {
  state: TokeniserState;
  character: string;
}): TokeniserState | undefined {
  if (state.done) {
    return state;
  }
  if (state.escaped) {
    return consumeEscaped({ character, state });
  }
  if (character === "\\" && state.quote !== "'") {
    return { ...state, escaped: true };
  }
  return undefined;
}

/**
 * Fold ONE character into a quote-aware read of a command, once {@link stepBeforeQuoting} has declined it.
 *
 * Separated from {@link readSimpleCommand} so the shell around it — the operator test, the unclosed-quote
 * refusal, the trailing word — stays readable, and so each thing a character can mean is one branch rather
 * than a clause in a chain.
 *
 * @param state how far the read has got
 * @param character the next character of the command text
 * @returns the state after reading it
 */
function stepTokeniser({ state, character }: { state: TokeniserState; character: string }): TokeniserState {
  const settled = stepBeforeQuoting({ character, state });
  if (settled !== undefined) {
    return settled;
  }
  const outsideQuotes = state.quote === "";
  if (character === "#" && outsideQuotes && state.current === "" && !state.open) {
    return { ...state, done: true };
  }
  const isQuote = character === '"' || character === "'";
  if (isQuote && outsideQuotes) {
    return { ...state, open: true, quote: character };
  }
  if (isQuote && state.quote === character) {
    return { ...state, quote: "" };
  }
  // Only a blank separates words, as in the shell running the script: a carriage return or any other
  // whitespace stays inside the word, so text the shell reads as one word is never read here as several (Codex 8b r2).
  if (outsideQuotes && (character === " " || character === "\t")) {
    const closed = state.current !== "" || state.open ? [...state.tokens, state.current] : state.tokens;
    return { ...state, current: "", open: false, tokens: closed };
  }
  return { ...state, current: state.current + character };
}

/**
 * Read a command as ONE simple command: quote-aware words, and no shell construct at all.
 *
 * An unquoted `#` begins a shell comment, so everything from it is dropped rather than tokenised. Without
 * that, `echo ok # tsc` reads as a command naming the compiler and is refused for running one it does not
 * run at all.
 *
 * @param command the script's command text
 * @returns its tokens, or why it could not be read as a simple command
 */
export function readSimpleCommand({ command }: { command: string }): CommandReading {
  const operator = SHELL_OPERATORS.find((candidate) => command.includes(candidate));
  if (operator !== undefined) {
    const shown = operator === "\n" ? "a newline" : `\`${operator}\``;
    return { kind: "unreadable", why: `it is not one simple command — ${shown} makes its failure maskable` };
  }
  // `split("")` rather than a spread: every delimiter this tokeniser tests for is ASCII, and every
  // character it does not treat as one is concatenated straight back in order, so splitting by UTF-16
  // unit is lossless here — and it keeps the lint rule about spreading a string honest rather than
  // side-stepped by an `Array.from` that does the very same thing.
  const state = command
    .split("")
    .reduce<TokeniserState>((carried, character) => stepTokeniser({ character, state: carried }), {
      current: "",
      done: false,
      escaped: false,
      open: false,
      quote: "",
      tokens: [],
    });
  if (state.quote !== "") {
    return { kind: "unreadable", why: "its quoting does not close, so no reader can say what it runs" };
  }
  if (state.escaped) {
    return { kind: "unreadable", why: "it ends on a backslash, so its last word is not one this reader can close" };
  }
  const tail = state.current !== "" || state.open ? [state.current] : [];
  return { kind: "tokens", tokens: [...state.tokens, ...tail] };
}

/** Where a command's one heap argument sits, or what is wrong with how it carries one. */
export type HeapArgument =
  { readonly kind: "at"; readonly lastIndex: number } | { readonly kind: "wrong"; readonly why: string };

/**
 * Read the one heap argument a command carries.
 *
 * A separated value (`--max-old-space-size 8192`) is accepted alongside the joined spelling, because both
 * are what Node itself accepts and refusing one would be this gate inventing a style rule. Zero, a negative,
 * an empty value, a non-integer and a second occurrence are all refused: each is a ceiling a reader would
 * believe and V8 would not apply.
 *
 * @param tokens the command's tokens, already read
 * @returns the index of the argument's LAST token, or the clause explaining its absence or its defect
 */
export function heapArgument({ tokens }: { tokens: readonly string[] }): HeapArgument {
  const hits = tokens.flatMap((token, index) => {
    const [name] = token.split("=");
    if (name === undefined) {
      return [];
    }
    return canonicalFlag({ name }) === HEAP_FLAG ? [index] : [];
  });
  const [index] = hits;
  if (index === undefined) {
    return { kind: "wrong", why: `it names no \`${HEAP_FLAG}\`, so it runs at V8's own default ceiling` };
  }
  if (hits.length > 1) {
    const why =
      `it names \`${HEAP_FLAG}\` ${String(hits.length)} times, counting the \`_\` spelling V8 reads as the same ` +
      "flag, and only the LAST of them decides the ceiling";
    return { kind: "wrong", why };
  }
  const token = tokens[index];
  if (token === undefined) {
    return { kind: "wrong", why: `its \`${HEAP_FLAG}\` could not be read back` };
  }
  const equals = token.indexOf("=");
  const joined = equals !== -1;
  const raw = joined ? token.slice(equals + 1) : tokens[index + 1];
  if (raw === undefined || !/^\d+$/u.test(raw) || Number(raw) <= 0) {
    return { kind: "wrong", why: `its \`${HEAP_FLAG}\` value is not a positive whole number of MiB` };
  }
  return { kind: "at", lastIndex: joined ? index : index + 1 };
}

/**
 * The one clause explaining why a compiler-naming command does not meet the contract, if it does not.
 *
 * @param command the script's command text exactly as `package.json` holds it
 * @returns the clause, or `undefined` when the command is a compliant direct invocation
 */
export function refusalClause({ command }: { command: string }): string | undefined {
  if (command.includes("NODE_OPTIONS")) {
    return "it reaches its ceiling through `NODE_OPTIONS`, a blanket over every process in the shell rather than a flag on the one that needs it";
  }
  const reading = readSimpleCommand({ command });
  if (reading.kind === "unreadable") {
    return reading.why;
  }
  const { tokens } = reading;
  if (tokens[0] !== "node") {
    return "it does not run the compiler as a direct `node` invocation, so no argument of its own can carry a ceiling";
  }
  const entrypoint = tokens.findIndex((token) => namesCompiler({ token }));
  if (entrypoint === -1) {
    return "it names the compiler somewhere its own words do not, so what it actually runs cannot be read";
  }
  const heap = heapArgument({ tokens });
  if (heap.kind === "wrong") {
    return heap.why;
  }
  if (heap.lastIndex > entrypoint) {
    return `its \`${HEAP_FLAG}\` sits AFTER the compiler entrypoint, where Node passes it through as a compiler argument instead of applying it`;
  }
  return undefined;
}

/**
 * Judge a whole `package.json` scripts map against the contract.
 *
 * Every script value is examined whatever its key, so renaming `build` evades nothing. Order is the map's
 * own, which is the order a reader opening the file will scan.
 *
 * @param scripts the parsed `scripts` map
 * @returns which scripts were subjects, and one finding per refusal
 */
export function assessTscHeapContract({ scripts }: { scripts: Readonly<Record<string, string>> }): TscHeapAssessment {
  const subjects = Object.entries(scripts).filter(([, command]) => mentionsCompiler({ command }));
  const findings = subjects.flatMap(([script, command]) => {
    const clause = refusalClause({ command });
    if (clause === undefined) {
      return [];
    }
    return [{ line: `\`${script}\` runs the TypeScript compiler and ${clause}: ${command}`, script }];
  });
  return { compilerScripts: subjects.map(([script]) => script), findings };
}
