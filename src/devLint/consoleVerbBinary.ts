/**
 * The console-verb-binary gate — the work console may not launch a child off the inherited `PATH`.
 *
 * ## The criterion
 *
 * Under `site/`, a call to `spawn`, `spawnSync`, `exec`, `execSync`, `execFile` or `execFileSync` whose
 * FIRST argument is a string LITERAL (or a template with no substitution) fails. A command reached through
 * a name — a resolved absolute path in a `const`, a value off an allowlist row — is outside the criterion by
 * construction, because the thing being refused is the *unresolved* command, not the spawn.
 *
 * A second shape fails beside it: `spawn`, `spawnSync`, `execFile` or `execFileSync` whose command is
 * `<name>.bin` — the resolution `slopweaverBin()` returns — and whose options' `env` does not contain
 * `consoleChildEnv({ …, root: <name>.root })`. The binary being right is not the code being right:
 * `bin/slopweaver` runs `${SLOPWEAVER_CLI_DIR:-$PLUGIN_ROOT}`, whatever directory it sits in.
 *
 * No allowlist and no exemption marker. A console that legitimately needs to launch something has the same
 * answer every time: resolve it to an absolute path first, and the resolution is then a value a reader can
 * follow.
 *
 * ## Why a gate rather than a comment in the file it is about
 *
 * `site/` is a separate Yarn project. It declares `outputFileTracingRoot: import.meta.dirname`, imports
 * nothing from `src/`, and a vitest lane reaches only the SLIVER of it that imports nothing back:
 * `config/vitest/unit.ts` selects `site/__tests__/unit/**` as a second root, which is where the console's
 * pure modules (`site/lib/queueCard.ts`, `site/lib/workContext.ts`) are tested. Everything this gate is
 * actually about — React, `next build`, a spawned verb — is outside that sliver, so a defect there still
 * cannot fail a test; it can only break a tile, silently, on a page nobody is looking at. Moving the CHECK
 * to where a lane does reach is the only way THAT class can be held down at all.
 *
 * ## What it was written against
 *
 * `site/lib/spawnVerb.ts` launched the bare name `"slopweaver"` through `spawn`, with `shell: false`, from
 * the day the console could read a verb. Three facts compound there:
 *
 *  - with no shell, the child is resolved off the inherited `PATH` and nothing else;
 *  - the interactive `slopweaver` on the owner's machine is a shell FUNCTION that runs
 *    `git rev-parse --show-toplevel` and prefers `$root/bin/slopweaver` — logic `spawn` never sees;
 *  - `next dev` is long-lived, so the `PATH` it captured can be months old.
 *
 * Together those decided which checkout's CLI answered EVERY tile on the console, from whatever shell
 * happened to start the server. MEASURED: the server answering `localhost:3000` was serving out
 * of the main checkout while the work on the console was standing in a worktree. A console whose numbers
 * come from a checkout the reader cannot name is the confident-but-wrong surface the whole site is built to
 * make impossible.
 *
 * Pure {@link scanConsoleVerbBinary} + an effectful {@link runConsoleVerbBinary} edge, matching the other
 * gates in this directory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NodeVisitor } from "#lib/tsSyntax.js";
import { forEachChild, isStringLiteralLikeNode, isTypeAssertion, ts, withSourceFile } from "#lib/tsSyntax.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";
import {
  gateSelfFiles,
  repoRoot,
  type ScanScope,
  scopedScanFiles,
  isScannablePath as scopeIsScannablePath,
} from "./scanScope.js";

/**
 * One unresolved child launch: where it is, and what it tried to run.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface ConsoleVerbBinaryHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** The launchers whose first argument is the command. `fork` is absent: its first argument is a module path. */
const LAUNCHERS: ReadonlySet<string> = new Set(["exec", "execFile", "execFileSync", "execSync", "spawn", "spawnSync"]);

/** The launcher a call expression names — bare, through a namespace such as `childProcess`, by a quoted name, or wrapped. */
function launcherNameOf({ node }: { node: ts.CallExpression }): string | undefined {
  // Peeled first: `(spawn)(…)` is the same launch.
  const callee = bare({ node: node.expression });
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  if (ts.isElementAccessExpression(callee)) {
    const key = bare({ node: callee.argumentExpression });
    return isStringLiteralLikeNode(key) ? key.text : undefined;
  }
  return undefined;
}

/** Whether an expression is a literal command — a string, or a template with nothing substituted into it. */
function isLiteralCommand({ node }: { node: ts.Expression }): boolean {
  if (ts.isStringLiteral(node)) {
    return true;
  }
  return ts.isNoSubstitutionTemplateLiteral(node);
}

/** The launchers that take `(command, args, options)`, so the child's `env` sits in the third argument. */
const ARGV_LAUNCHERS: ReadonlySet<string> = new Set(["execFile", "execFileSync", "spawn", "spawnSync"]);

/** The one function that pins a child's environment to a checkout — `site/lib/launcherQuiet.ts`. */
const PIN = "consoleChildEnv";

/**
 * The composers known to hand their `env` field on, spread whole under what they add — `site/lib/launcherQuiet.ts`.
 * Named rather than inferred: a call the gate cannot read the body of may discard the pin it was given (Codex
 * review r1-03d), so only one whose contract is known is followed. A new composer joins this list with a test.
 */
const ENV_COMPOSERS: ReadonlySet<string> = new Set(["withQuietLauncher"]);

/**
 * The resolution a command is read off when it is written `<name>.bin`, else `undefined`.
 *
 * That is the shape `slopweaverBin()` hands back, so it is the shape whose `root` the environment must name.
 *
 * @param node the launcher's first argument
 * @returns the identifier holding the resolution
 */
function resolutionNameOf({ node }: { node: ts.Expression }): string | undefined {
  return accessedName({ field: "bin", node });
}

/**
 * An expression with every wrapper that changes nothing at run time peeled off — parentheses, `as`, `<T>x`,
 * `satisfies`, `!` and an instantiation `f<T>` — so `(resolved.bin)` reads as `resolved.bin`.
 *
 * @param node the expression
 * @returns the expression beneath its wrappers
 */
function bare({ node }: { node: ts.Expression }): ts.Expression {
  let inner = node;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    isTypeAssertion(inner) ||
    ts.isExpressionWithTypeArguments(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isNonNullExpression(inner)
  ) {
    inner = inner.expression;
  }
  return inner;
}

/**
 * The identifier an expression reads `field` off, when it is `<identifier>.<field>`, else `undefined`.
 *
 * @param node the expression
 * @param field the property it must read
 * @returns the identifier's name
 */
function accessedName({ node, field }: { node: ts.Expression; field: string }): string | undefined {
  const access = bare({ node });
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== field) {
    return undefined;
  }
  const holder = bare({ node: access.expression });
  return ts.isIdentifier(holder) ? holder.text : undefined;
}

/**
 * The field one object-literal member names when the source fixes that name — `env`, `"env"`, `0`, a method
 * `env() {}`, an accessor or a shorthand `env` — else `undefined`, for a spread or a computed name. A quoted key names a
 * field as plainly as a bare one, and a method named something else cannot touch `env`.
 *
 * @param property one member of an object literal
 * @returns the field it writes, or `undefined` when no reading of the source can say
 */
function staticNameOf({ property }: { property: ts.ObjectLiteralElementLike }): string | undefined {
  if (ts.isSpreadAssignment(property)) {
    return undefined;
  }
  const { name } = property;
  if (ts.isComputedPropertyName(name)) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  // A bigint key or a private name is fixed by the source too, and neither can spell `env`.
  return name.getText();
}

/**
 * The initializer an object literal ends up holding for one field, else `undefined` — the LAST assignment of it,
 * since a later one wins at run time. A later member that may write the field with a value no syntax-only reading
 * can see — a spread, a computed name, or a shorthand, method or accessor OF THAT NAME — makes it `undefined`.
 *
 * @param bag the object literal, as written (wrappers are peeled here)
 * @param field the field to read
 * @returns that field's effective initializer, wrappers peeled
 */
function fieldOf({ bag, field }: { bag: ts.Expression; field: string }): ts.Expression | undefined {
  const literal = bare({ node: bag });
  if (!ts.isObjectLiteralExpression(literal)) {
    return undefined;
  }
  let found: ts.Expression | undefined;
  for (const property of literal.properties) {
    const name = staticNameOf({ property });
    if (name === undefined) {
      found = undefined;
    } else if (name === field) {
      found = ts.isPropertyAssignment(property) ? property.initializer : undefined;
    }
  }
  return found === undefined ? undefined : bare({ node: found });
}

/**
 * Whether an `env` expression IS `consoleChildEnv({ …, root: <name>.root })`, or a known composer
 * ({@link ENV_COMPOSERS}) whose sole options-object argument's `env` field is — followed down that one field only,
 * never into another argument, a branch or an intermediate variable. A pin sitting anywhere else in the expression
 * is not the environment the child receives (a pin in the unused arm of a conditional), so it
 * is refused, not traced.
 *
 * @param node the `env` property's initializer
 * @param name the identifier the command's `.bin` was read off
 * @returns true when that exact resolution's root is what the child is handed
 */
function pinsRootOf({ node, name }: { node: ts.Expression; name: string }): boolean {
  const call = bare({ node });
  if (!ts.isCallExpression(call) || call.arguments.length !== 1) {
    return false;
  }
  // `(consoleChildEnv)(…)` is the same call.
  const callee = bare({ node: call.expression });
  if (!ts.isIdentifier(callee)) {
    return false;
  }
  const [bag] = call.arguments;
  if (bag === undefined) {
    return false;
  }
  if (callee.text !== PIN) {
    if (!ENV_COMPOSERS.has(callee.text)) {
      return false;
    }
    const inner = fieldOf({ bag, field: "env" });
    return inner !== undefined && pinsRootOf({ name, node: inner });
  }
  const root = fieldOf({ bag, field: "root" });
  return root !== undefined && accessedName({ field: "root", node: root }) === name;
}

/**
 * Whether a launch of `<name>.bin` hands the child an environment pinned to `<name>.root`.
 *
 * An absent options argument, or options with no `env`, inherits the server's environment whole — the exact
 * failure — so both are unpinned.
 *
 * @param node the launcher call
 * @param name the identifier the command's `.bin` was read off
 * @returns true when the `env` option pins that resolution's root
 */
function launchIsPinned({ node, name }: { node: ts.CallExpression; name: string }): boolean {
  // Every one of these launchers also takes `(command, options)`, with no args array.
  let options = node.arguments[2];
  const second = node.arguments[1];
  if (options === undefined && second !== undefined && ts.isObjectLiteralExpression(bare({ node: second }))) {
    options = second;
  }
  if (options === undefined) {
    return false;
  }
  const env = fieldOf({ bag: options, field: "env" });
  return env !== undefined && pinsRootOf({ name, node: env });
}

/**
 * Every unresolved child launch in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * Two shapes fail. A LITERAL command resolves off the inherited `PATH`. A command read off a resolution
 * (`resolved.bin`) whose `env` does not pin that same resolution's root runs whatever tree an inherited
 * `PLUGIN_ROOT` or `SLOPWEAVER_CLI_DIR` names, because `bin/slopweaver` picks its code from those and not from
 * where it sits — MEASURED: a console restarted from a supervisor seat ran that seat's
 * stale worktree behind main's binary and drew 673 check-ins the owner's standing rule had settled.
 *
 * @param path the file's repo-relative path, for reporting
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanConsoleVerbBinary({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly ConsoleVerbBinaryHit[] {
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly ConsoleVerbBinaryHit[] => {
      const hits: ConsoleVerbBinaryHit[] = [];
      const visit: NodeVisitor = (node) => {
        if (ts.isCallExpression(node)) {
          const name = launcherNameOf({ node });
          const first = node.arguments[0];
          if (
            name !== undefined &&
            LAUNCHERS.has(name) &&
            first !== undefined &&
            isLiteralCommand({ node: bare({ node: first }) })
          ) {
            hits.push({
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              message:
                `\`${name}(…)\` names its command as a literal, so the child is resolved off whatever PATH the ` +
                "server inherited — which decides, invisibly, which checkout answered. Resolve an absolute path " +
                "first (`site/lib/slopweaverBin.ts`) and pass that value.",
              path,
            });
          }
          const resolution = first === undefined ? undefined : resolutionNameOf({ node: first });
          if (
            name !== undefined &&
            ARGV_LAUNCHERS.has(name) &&
            resolution !== undefined &&
            !launchIsPinned({ name: resolution, node })
          ) {
            hits.push({
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              message:
                `\`${name}(${resolution}.bin, …)\` launches the serving checkout's binary with an environment that ` +
                `does not pin \`${resolution}.root\`, so an inherited PLUGIN_ROOT or SLOPWEAVER_CLI_DIR decides which ` +
                `tree's code runs. Pass \`env: consoleChildEnv({ env: …, root: ${resolution}.root })\` ` +
                "(`site/lib/launcherQuiet.ts`), written directly in the options.",
              path,
            });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/** This gate's declared scan predicate: the console's own TypeScript, minus this gate's files. */
const SCOPE: ScanScope = {
  extensions: [".ts", ".tsx"],
  selfFiles: gateSelfFiles({ stem: "consoleVerbBinary" }),
  trees: ["site/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/**
 * IO edge: scan the console's files, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runConsoleVerbBinary(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("console-verb-binary: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<ConsoleVerbBinaryHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanConsoleVerbBinary({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "console-verb-binary",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (!complete && hits.length === 0) {
    return 1;
  }
  if (hits.length === 0) {
    process.stdout.write(`console-verb-binary: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "console-verb-binary" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
