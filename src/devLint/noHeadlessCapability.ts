/**
 * The no-headless gate's capability rules (`noHeadless.ts` carries the doctrine and every other rule): NH001, a
 * `node:child_process` import of a member that can outlive its caller; NH002, a bare call to one; and NH008, the
 * console's and the desktop shell's own spawn rule. Split out along that seam when NH008 joined them, so each file stays one a reader
 * can hold.
 */
import { forEachChild, type LentAnswer, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";

import type { NoHeadlessFinding } from "./noHeadless.js";

/** The `node:child_process` members that can outlive the process that started them. */
const ASYNC_MEMBER_NAMES: ReadonlySet<string> = new Set(["spawn", "exec", "execFile", "fork"]);

/** Matches either module spelling, `node:child_process` or bare `child_process`. */
const CHILD_PROCESS_MODULE = String.raw`(?:node:)?child_process`;

/** The quote characters a module specifier may use. Backtick included — see {@link dynamicImportRegex}. */
const QUOTE = "[\"'`]";

/** A named (optionally aliased) import: `import { spawn, exec as e } from "node:child_process"`. */
function namedImportRegex(): RegExp {
  return new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s*["']${CHILD_PROCESS_MODULE}["']`, "g");
}

/** A namespace import: `import * as cp from "child_process"` — banned wholly, any member it later uses. */
function namespaceImportRegex(): RegExp {
  return new RegExp(String.raw`import\s*\*\s*as\s+[A-Za-z_$][\w$]*\s*from\s*["']${CHILD_PROCESS_MODULE}["']`, "g");
}

/** A `require("child_process")` call — banned wholly, regardless of what is destructured from it. */
function requireImportRegex(): RegExp {
  return new RegExp(String.raw`\brequire\s*\(\s*${QUOTE}${CHILD_PROCESS_MODULE}${QUOTE}\s*\)`, "g");
}

/**
 * A dynamic `await import("child_process")` — banned wholly, for the same reason as `require`.
 *
 * The quote class includes a BACKTICK, and that is not tidiness. `import()` and `require()` take an
 * arbitrary expression, so a template literal is a perfectly ordinary specifier — and an adversarial review
 * pass produced exactly that as a working bypass, verified against this gate before the fix:
 * ``const cp = await import(`node:child_process`); cp.spawn("claude", ["-p", …])`` scanned CLEAN. NH002 could
 * not catch it either, because `cp.spawn(` is a member call it deliberately excludes to avoid flagging every
 * `RegExp.prototype.exec` in the tree. A static `import … from` cannot be a template literal, so only the two
 * call forms widen.
 */
function dynamicImportRegex(): RegExp {
  return new RegExp(String.raw`\bimport\s*\(\s*${QUOTE}${CHILD_PROCESS_MODULE}${QUOTE}\s*\)`, "g");
}

/**
 * The line a character offset into a file's text falls on.
 *
 * @param index the character offset
 * @returns its 1-indexed line
 */
export function lineAt({ content, index }: { content: string; index: number }): number {
  return content.slice(0, index).split("\n").length;
}

/**
 * NH001, named/aliased half: every `spawn`/`exec`/`execFile`/`fork` pulled out of a named import clause.
 *
 * @param content the file's text
 * @returns one hit per offending name, at the line the import clause closes on
 */
function namedImportHits({ content }: { content: string }): { line: number; excerpt: string }[] {
  const hits: { line: number; excerpt: string }[] = [];
  const rx = namedImportRegex();
  let match = rx.exec(content);
  while (match !== null) {
    const line = lineAt({ content, index: match.index + match[0].length });
    for (const entry of match[1]!.split(",")) {
      const trimmed = entry.trim();
      const original = trimmed.split(/\s+as\s+/)[0]!.trim();
      if (ASYNC_MEMBER_NAMES.has(original)) {
        hits.push({ excerpt: trimmed, line });
      }
    }
    match = rx.exec(content);
  }
  return hits;
}

/**
 * NH001, concealed half: a namespace import, a `require`, or a dynamic `import()` of `child_process` — each
 * banned outright because none of the three reveals which member a caller goes on to use.
 *
 * @param content the file's text
 * @returns one hit per occurrence
 */
function concealedImportHits({ content }: { content: string }): { line: number; excerpt: string }[] {
  const hits: { line: number; excerpt: string }[] = [];
  for (const rx of [namespaceImportRegex(), requireImportRegex(), dynamicImportRegex()]) {
    let match = rx.exec(content);
    while (match !== null) {
      hits.push({ excerpt: match[0].trim(), line: lineAt({ content, index: match.index }) });
      match = rx.exec(content);
    }
  }
  return hits;
}

/**
 * NH001 — every way this file's text imports the async `node:child_process` capability.
 *
 * @param content the file's text
 * @returns each hit, tagged NH001
 */
function importCapabilityHits({ content }: { content: string }): NoHeadlessFinding[] {
  return [...namedImportHits({ content }), ...concealedImportHits({ content })].map((hit) => ({
    ...hit,
    kind: "NH001" as const,
    path: "",
  }));
}

/**
 * NH002 — a bare call to `spawn`/`exec`/`execFile`/`fork`, never a member call.
 *
 * The negative lookbehind for `.` and a word character is the whole rule: `re.exec(x)` and `foo.spawn(x)`
 * are member calls and must not match, only a call whose callee is the bare name. The `(` sits immediately
 * against the name (no `\s*`) so prose — "one spawn (stdout/stderr buffers…)" reads as an English sentence,
 * not a call, and this codebase's formatter never puts space between a callee and its parenthesis anyway.
 */
const CALL_BACKSTOP = /(?<![.\w])(spawn|execFile|exec|fork)\(/g;

/**
 * NH002 — every bare async-capability call, one line at a time.
 *
 * @param content the file's text
 * @returns each hit, tagged NH002
 */
function callBackstopHits({ content }: { content: string }): NoHeadlessFinding[] {
  const hits: NoHeadlessFinding[] = [];
  content.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(CALL_BACKSTOP)) {
      hits.push({ excerpt: match[0].trim(), kind: "NH002", line: index + 1, path: "" });
    }
  });
  return hits;
}

/**
 * The console's two async spawns, each recognized by the exact text of its call's opening — the callee and its
 * first two arguments — the same call-shape recognition `noHeadless.ts`'s `RECOGNIZED_VISIBLE_LAUNCHES` applies to
 * `sendLine`, never a list of files.
 *
 * - `spawn(resolved.bin, [...argv],` is `site/lib/spawnVerb.ts`'s verb runner: `resolved.bin` is only ever the
 *   serving checkout's `bin/slopweaver`, a verb the rest of this gate already scans, and it is killed at its
 *   own deadline.
 * - `spawn(composition.executable, [...composition.argv],` is `site/lib/talkPlanLaunch.ts`'s Talk call on the
 *   owner's ChatGPT plan: the vendored `codex app-server` that `talk offer` composed, handed straight to a
 *   `PlanCall` that kills it when the owner hangs up, when the page's stream is gone for 30 seconds, when the child
 *   says the transport closed, or at 90 minutes. The visible call IS the session rule 2 asks for; the delegated
 *   thread it runs is that call's backend and lives exactly as long as it does.
 */
const RECOGNIZED_SITE_SPAWNS: readonly string[] = [
  "spawn(resolved.bin, [...argv],",
  "spawn(composition.executable, [...composition.argv],",
];

/**
 * The desktop shell's child processes (`desktop/`), recognized the same way as {@link RECOGNIZED_SITE_SPAWNS}:
 * by the exact text of the call's opening with its whitespace collapsed ({@link callOpening}), so a call prettier
 * wrapped over several lines reads as it would on one. None starts a model; each is a bounded or fire-and-forget
 * helper of the shell itself, and the shell is not a place a headless session may hide. One call causes model
 * sessions, and only visible ones in this app: the bullet on `fleet recover` below.
 *
 * - `execFile(join(checkout, "bin", "slopweaver"), ["fleet", "recover"],` is `fleetProcess.ts`'s `recoverFleet`,
 *   run only when the owner presses Recovery. This one call causes visible app sessions: the verb opens one
 *   throwaway Claude card in this app, checks it answers and closes it, then one Codex card, each a session the
 *   owner can see and stop as it runs. The owner allowed exactly this row, by a ruling on the owner's own card. Its arguments are a
 *   literal pair, so another verb, another argument or a variable argv is not it, and it is recognised in `desktop/`
 *   alone.
 * - `spawn("bash", [join("scripts", "docs-site.sh"), flag],` is `consoleServer.ts` running the checkout's
 *   `scripts/docs-site.sh --status|--serve` to find or start the console, killed at its own deadline.
 * - `spawn(join(checkout.value, "bin", "slopweaver"), ["desktop", "update",` is `updateShell.ts` running the
 *   checkout's own `bin/slopweaver desktop update`, which rebuilds this app.
 * - The four `execFile(` openings for `join(checkout, "bin", "slopweaver")` with `fleet health` and `cmux
 *   revive`, for `"open"`, and for `"osascript"` are `fleetProcess.ts`'s. The `osascript` call types `fleet
 *   resume` into a NEW, visible cmux tab. That file's `run()` takes the call as a closure and not a program, on
 *   purpose: a `run({ file, args })` recognised once would let a later caller hand it `claude` without touching
 *   any recognised call.
 * - `execFile("/usr/bin/osascript", [...],` is `frontWindowShell.ts` reading the front window's title and app. The
 *   program is a literal at the call, because a recognised opening naming a constant would stay recognised when
 *   only the constant changed.
 * - `execFile(helperPath, [verb],` is `systemAudioPermissionShell.ts` running its own signed Swift helper; `verb`
 *   is a closed union there and `helperPath` comes from `systemAudioPermission.ts`'s `helperPathOf`. This one is
 *   the stated residue: the program is a parameter, so changing what `helperPathOf` returns is not seen by the
 *   gate. It is a tripwire, not a fence (AGENTS.md rule 3), and the helper's path is the one place it relies on
 *   review.
 */
const RECOGNIZED_DESKTOP_CHILDREN: readonly string[] = [
  'spawn("bash", [join("scripts", "docs-site.sh"), flag],',
  'spawn(join(checkout.value, "bin", "slopweaver"), ["desktop", "update",',
  'execFile(join(checkout, "bin", "slopweaver"), ["fleet", "health", "--json"],',
  'execFile(join(checkout, "bin", "slopweaver"), ["cmux", "revive", "--json"],',
  // The owner's Recovery press: the one call here that causes model sessions, each a visible card in this app.
  'execFile(join(checkout, "bin", "slopweaver"), ["fleet", "recover"],',
  // `pageRevealShell.ts` copying one page out of the store for Reveal in Finder: the checkout's own verb, bounded.
  'execFile(join(checkout, "bin", "slopweaver"), ["page", "export", slug, "--out", file, "--json"],',
  'execFile("open", [...openCmuxArgs({ raise })],',
  'execFile("osascript", args,',
  'execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", FRONT_WINDOW_PROGRAM],',
  "execFile(helperPath, [verb],",
  // The app harness (stage 2): a session's worker starts ONLY from a lease minted off its visible card
  // (`desktop/src/visibleSessionLease.ts`), the worker starts only its vendor's adapter, and a card's Stop closes
  // through the verb so the ledger records it.
  "spawn(process.execPath, visibleWorkerArgv({ lease }),",
  "spawn(process.execPath, [config.adapterEntry],",
  // A Claude worker's ONE native Claude Code process, started inside the worker's process group only after
  // `claudeSpawnPlanOf` checked the Agent SDK's request against the launch config (the packaged binary, the session's
  // directory), so it can attach a setup token on descriptor 3. Card Stop, close, worker failure and app quit end it
  // with the group. An exact shape for a visible session, never leave for desktop code to run a model generally.
  "spawn(validated.claudePath, validated.args, {",
  'execFile(join(checkout, "bin", "slopweaver"), ["cmux", "close", "--harness", "app",',
];

/** The one file under `src/` that may make an async spawn, and the one call shape it may make. */
const RUN_DUE_VERB_PROCESS_PATH = "src/cli/commands/automation/runDueVerbProcess.ts";

/**
 * `automation run-due`'s verb child, recognized the same way as {@link RECOGNIZED_SITE_SPAWNS}: the executable is the
 * literal `process.execPath`, this process's own node, so changing it to `claude`, a parameter or any other binary
 * fails this gate. Its arguments are this CLI's own exec arguments and entry script, then a row's verb words
 * (`verbChildArgv`); the child is another slopweaver verb process, SIGKILLed by its parent's signal trap (its whole
 * process group when it leads one), never a model. The stated residue: the entry script is a value (resolved from the
 * module's own URL), so what `currentCliLaunch` reads is relied on, not proven, by this gate.
 */
const RECOGNIZED_RUN_DUE_CHILD: readonly string[] = ["spawn(process.execPath, verbChildArgv({ argv, launch }), {"];

/** How far past a call's callee to read when recognizing its shape — longer than any shape above. */
const OPENING_WINDOW = 160;

/**
 * Source text with its whitespace collapsed, so a call wrapped over several lines compares equal to its one-line
 * spelling: no space after an opening bracket, one space everywhere else. Applied to a recognized shape as well as
 * to the call being read, so a shape is spelled as a reader would write it.
 *
 * @param text the source text
 * @returns the collapsed text
 */
function collapsed({ text }: { text: string }): string {
  return text.replace(/([([{])\s+/g, "$1").replace(/\s+/g, " ");
}

/**
 * The opening of the call starting at `index`, collapsed ({@link collapsed}).
 *
 * @param content the file's text
 * @param index where the callee's name starts
 * @returns the normalized opening, `OPENING_WINDOW` characters at most before collapsing
 */
function callOpening({ content, index }: { content: string; index: number }): string {
  return collapsed({ text: content.slice(index, index + OPENING_WINDOW) });
}

/**
 * The call shapes a tree's files may make, or none: the console (`site/`) and the desktop shell (`desktop/`) have
 * recognized child processes, and so does exactly one file under `src/`, {@link RUN_DUE_VERB_PROCESS_PATH}. A shape
 * recognized in one of those is not recognized in any other.
 *
 * @param path the repo-relative path
 * @returns the recognized shapes, or `undefined` when the path is none of them
 */
function recognizedShapesFor({ path }: { path: string }): readonly string[] | undefined {
  if (path === RUN_DUE_VERB_PROCESS_PATH) {
    return RECOGNIZED_RUN_DUE_CHILD;
  }
  if (path.startsWith("site/")) {
    return RECOGNIZED_SITE_SPAWNS;
  }
  if (path.startsWith("desktop/")) {
    return RECOGNIZED_DESKTOP_CHILDREN;
  }
  return undefined;
}

/**
 * NH001/NH008 for a `site/` or `desktop/` file: concealed imports and `exec`/`fork` exactly as everywhere; a bare
 * `spawn(` that is not one of the tree's recognized shapes is NH008 and any other unrecognized call NH002; and a
 * named import is NH001 unless every mention of THAT name in the file is one of its recognized calls
 * ({@link onlyRecognizedUses}), so importing one for nothing, or using it any other way, is still refused.
 *
 * @param content the file's text
 * @param shapes the recognized call shapes for this file's tree
 * @param tsx whether the file is a `.tsx`
 * @returns each hit
 */
function recognizedTreeHits({
  content,
  shapes,
  tsx,
}: {
  content: string;
  shapes: readonly string[];
  tsx: boolean;
}): NoHeadlessFinding[] {
  const calls: NoHeadlessFinding[] = [];
  const recognizedAt = new Map<string, Set<number>>();
  const lines = content.split("\n");
  for (const match of content.matchAll(CALL_BACKSTOP)) {
    const opening = callOpening({ content, index: match.index });
    if (shapes.some((shape) => opening.startsWith(collapsed({ text: shape })))) {
      const member = match[1]!;
      const seen = recognizedAt.get(member);
      if (seen === undefined) {
        recognizedAt.set(member, new Set([match.index]));
      } else {
        seen.add(match.index);
      }
    } else {
      const line = lineAt({ content, index: match.index });
      const kind = match[1] === "spawn" ? "NH008" : "NH002";
      calls.push({ excerpt: lines[line - 1]!.trim(), kind, line, path: "" });
    }
  }
  const imports = treeImportHits({ content, tsx }).filter(
    (hit) => !onlyRecognizedUses({ content, member: hit.excerpt, recognizedAt: recognizedAt.get(hit.excerpt), tsx }),
  );
  return [...imports, ...calls];
}

/**
 * Parse a file the way the TypeScript compiler reads it, with parents set so a node can ask what it sits in, and
 * hand the tree to `use` for the length of the call only.
 *
 * @param content the file's text
 * @param tsx whether to parse JSX, as a `.tsx` file needs
 * @param use reads the tree and answers plain data, never a node
 * @returns whatever `use` answered
 */
function withParsedSource<R>({
  content,
  tsx,
  use,
}: {
  content: string;
  tsx: boolean;
  use: (source: ts.SourceFile) => LentAnswer<R>;
}): LentAnswer<R> {
  return withSourceFile({
    fileName: tsx ? "file.tsx" : "file.ts",
    text: content,
    scriptKind: tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    use,
  });
}

/**
 * NH001 for a `site/` or `desktop/` file: the concealed forms by pattern, as everywhere, and the NAMED import by the
 * parser. The pattern reads `import { … } from "child_process"` across any text between a `{` and the next `}`, so a
 * comment holding `import {` ahead of the real import swallowed it whole and left a later `spawn.call(…)` with no
 * finding at all. The parser sees only import declarations, comments excluded.
 *
 * @param content the file's text
 * @param tsx whether the file is a `.tsx`
 * @returns one hit per async member named in a value import from `child_process`
 */
function treeImportHits({ content, tsx }: { content: string; tsx: boolean }): NoHeadlessFinding[] {
  const named = withParsedSource({
    content,
    tsx,
    use: (source): NoHeadlessFinding[] =>
      source.statements.filter(ts.isImportDeclaration).flatMap((statement) => {
        const line = lineAt({ content, index: statement.getEnd() });
        return childProcessImportElements({ statement })
          .filter((element) => ASYNC_MEMBER_NAMES.has(importedName({ element })))
          .map((element) => ({ excerpt: element.getText(source), kind: "NH001" as const, line, path: "" }));
      }),
  });
  const concealed = concealedImportHits({ content }).map((hit) => ({ ...hit, kind: "NH001" as const, path: "" }));
  return [...named, ...concealed];
}

/**
 * The name an import specifier reads from the module: `spawn` for `spawn` and for `spawn as run` alike.
 *
 * @param element the import specifier
 * @returns the exported name, before any local alias
 */
function importedName({ element }: { element: ts.ImportSpecifier }): string {
  return element.propertyName === undefined ? element.name.text : element.propertyName.text;
}

/**
 * The value-imported names of one `import { … } from "child_process"` declaration, or none for any other import.
 *
 * @param statement the import declaration
 * @returns its named, non-type import specifiers when it imports `child_process` or `node:child_process`
 */
function childProcessImportElements({ statement }: { statement: ts.ImportDeclaration }): readonly ts.ImportSpecifier[] {
  const specifier = statement.moduleSpecifier;
  const clause = statement.importClause;
  const isTypeClause = clause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
  const bindings = clause === undefined || isTypeClause ? undefined : clause.namedBindings;
  const isChildProcess = ts.isStringLiteral(specifier) && /^(?:node:)?child_process$/.test(specifier.text);
  if (!isChildProcess || bindings === undefined || !ts.isNamedImports(bindings)) {
    return [];
  }
  return bindings.elements.filter((element) => !element.isTypeOnly);
}

/**
 * The offset of every identifier node spelling `name` outside an import specifier and a `.name` property access, as the TypeScript parser
 * reads the file: comments are not nodes, and an escaped spelling such as `spawn` still reads as `spawn`.
 *
 * @param content the file's text
 * @param name the identifier to find
 * @param tsx whether to parse JSX, as a `.tsx` file needs
 * @returns each identifier's starting offset, and whether it is the callee of a call (not a `new`, not a bare read)
 */
function identifierUses({
  content,
  name,
  tsx,
}: {
  content: string;
  name: string;
  tsx: boolean;
}): { callee: boolean; offset: number }[] {
  return withParsedSource({
    content,
    tsx,
    use: (source): { callee: boolean; offset: number }[] => {
      const uses: { callee: boolean; offset: number }[] = [];
      const visit: NodeVisitor = (node) => {
        const isPropertyName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
        const isImportedName = ts.isImportSpecifier(node.parent);
        if (ts.isIdentifier(node) && node.text === name && !isPropertyName && !isImportedName) {
          const callee = ts.isCallExpression(node.parent) && node.parent.expression === node;
          uses.push({ callee, offset: node.getStart(source) });
        }
        forEachChild({ node, visit });
      };
      forEachChild({ node: source, visit });
      return uses;
    },
  });
}

/**
 * Whether an imported name is used, and every use of it outside the import clause is a recognized call. Judged by the
 * offset of each identifier token, never by a count and never by a pattern over text, so one recognized call cannot
 * balance a different use and a comment, a multiplication continued on the next line or an escaped spelling cannot
 * hide one: `(spawn)(…)`, `const run = spawn`, `spawn.call(…)` and a lookalike such as `$spawn(…)` standing beside the
 * real name each leave a use at no recognized offset, and the import stays refused.
 *
 * @param content the file's text
 * @param member the imported name
 * @param recognizedAt the offsets of the file's recognized calls to the name, or undefined when it makes none
 * @param tsx whether the file is a `.tsx`, which the parser needs to know
 * @returns true when the name is used, and only in those recognized calls
 */
function onlyRecognizedUses({
  content,
  member,
  recognizedAt,
  tsx,
}: {
  content: string;
  member: string;
  recognizedAt: ReadonlySet<number> | undefined;
  tsx: boolean;
}): boolean {
  if (recognizedAt === undefined || !ASYNC_MEMBER_NAMES.has(member)) {
    return false;
  }
  const uses = identifierUses({ content, name: member, tsx });
  return uses.length > 0 && uses.every((use) => use.callee && recognizedAt.has(use.offset));
}

/**
 * NH001/NH002 everywhere but the console, the desktop shell and run-due's verb child, and NH001/NH008 in them
 * (`site/`, `desktop/`, {@link RUN_DUE_VERB_PROCESS_PATH}), where each one's own recognized child processes pass.
 *
 * @param path the repo-relative path, which decides whether a tree's recognition applies
 * @param content the file's text
 * @returns each hit, with an empty path the caller fills in
 */
export function capabilityHits({ path, content }: { path: string; content: string }): NoHeadlessFinding[] {
  const shapes = recognizedShapesFor({ path });
  if (shapes !== undefined) {
    return recognizedTreeHits({ content, shapes, tsx: path.endsWith(".tsx") });
  }
  return [...importCapabilityHits({ content }), ...callBackstopHits({ content })];
}
