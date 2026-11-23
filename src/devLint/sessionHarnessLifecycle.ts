/**
 * The session-harness-lifecycle gate — a session is opened through the session harness seam, and its ledger row is
 * written by the seam's one recorder.
 *
 * ## Why a gate rather than a note
 *
 * Option C's control plane is "one writer, fed by every box" (`docs/session-harness.md`): the session ledger's row
 * is written by `src/sessionHarness/recordingHarness.ts` from what the seam DID, never by each verb remembering to
 * write it. Before the seam, `cmux spawn` called `spawnCmuxSession` and appended its own `spawned` event, and every
 * other opener did the same thing its own way — which is how a second implementation behind the seam would have
 * ended up with no row at all, and nothing would have said so. A caller reaching past the seam reopens that gap
 * through ordinary work, so the direction is held by a gate.
 *
 * ## The criterion
 *
 * Read off the TypeScript AST, in a non-test `.ts` under `src/` outside `src/sessionHarness/`:
 *
 * - `spawn-direct` — a call whose callee is the identifier `spawnCmuxSession` (or a member access ending in it), or
 *   that identifier handed on as a value (a call argument, an initializer, an object property): cmux's launch
 *   reached without the seam's launcher. The value half is there because an injected opener defaulting to
 *   `spawnCmuxSession` once opened drawdown investigations with no ledger row and no call for the gate to see.
 * - `spawned-append` — a call to `appendSessionEvent` whose argument is an object literal carrying an `event`
 *   property that is itself an object literal with `kind: "spawned"`: a session row opened by hand.
 * - `client-construct` — a call whose callee is `withCmuxClient`, `realCmuxClient` or `cmuxClientOver`: a cmux
 *   connection opened outside the seam. `src/cmux/client.ts`, which defines all three, is exempt from this shape
 *   alone. A verb opens one through `src/sessionHarness/cmuxHost.ts`'s `withCmuxSessionHost`, and a launch's spawn
 *   deps through `src/sessionHarness/recordedSpawn.ts` — so swapping the implementation is one tree's change.
 *
 * ## Blind spots, stated rather than discovered
 *
 * An `event` built elsewhere and passed by name (`session note`'s verb appends whatever event it parsed), a callee
 * reached through any alias or a dynamic `import()`, and a `kind` that is not a string literal are outside the
 * criterion. A `closed` append is outside it on purpose: the close verbs (`cmux close`, `session close-done`, the
 * re-seat, the turn ledger) still close rows themselves over a host the seam opened. A raw cmux operation reached
 * through the host surface (`CmuxHostSurface`'s screen reads, sends and closes) is outside it too: that is the named
 * stage-2 debt `docs/session-harness.md` carries, and the connection it rides was opened by the seam, which this gate
 * does hold.
 *
 * Pure {@link scanSessionHarnessLifecycle} + {@link partitionAgainstDebt}, and an effectful
 * {@link runSessionHarnessLifecycle} edge, matching the other gates in this directory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
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

/** Which way a caller reached past the seam. */
type SessionHarnessLifecycleShape = "client-construct" | "spawn-direct" | "spawned-append";

/**
 * One reach past the seam.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface SessionHarnessLifecycleHit {
  readonly path: string;
  readonly line: number;
  readonly shape: SessionHarnessLifecycleShape;
}

/**
 * One recorded reach past the seam, and how many times it fires in its file.
 *
 * @internal — the debt list's own row shape; nothing outside this gate names it.
 */
export interface SessionHarnessLifecycleDebt {
  readonly path: string;
  readonly shape: SessionHarnessLifecycleShape;
  readonly count: number;
  /** The board row that moves it behind the seam. */
  readonly movedBy: string;
}

/** The seam's own tree, the one place a cmux connection, a cmux launch and a session row may be written. */
const SEAM_TREE = "src/sessionHarness/";

/** The file that DEFINES the cmux client constructors, the one place outside the seam a constructor may be named. */
const CLIENT_DEFINITION = "src/cmux/client.ts";

/** The cmux client constructors: each opens (or wraps) a socket connection the seam is meant to own. */
const CLIENT_CONSTRUCTORS: readonly string[] = ["withCmuxClient", "realCmuxClient", "cmuxClientOver"];

/** The callee names {@link shapeOf} matches; a file spelling none of them is never parsed. */
const CALLEE_NAMES = ["spawnCmuxSession", "appendSessionEvent", ...CLIENT_CONSTRUCTORS] as const;

/** The callee's final name, through parentheses and a member access, or `undefined`. */
function calleeName({ call }: { call: ts.CallExpression }): string | undefined {
  let callee: ts.Expression = call.expression;
  while (ts.isParenthesizedExpression(callee)) {
    callee = callee.expression;
  }
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return undefined;
}

/** Whether a property of an object literal is `name: <value>`, answering the value. */
function propertyValue({
  literal,
  name,
}: {
  literal: ts.ObjectLiteralExpression;
  name: string;
}): ts.Expression | undefined {
  for (const property of literal.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) {
      return property.initializer;
    }
  }
  return undefined;
}

/** Whether an `appendSessionEvent` call's argument spells a `spawned` event inline. */
function appendsSpawned({ call }: { call: ts.CallExpression }): boolean {
  const [argument] = call.arguments;
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) {
    return false;
  }
  const event = propertyValue({ literal: argument, name: "event" });
  if (event === undefined || !ts.isObjectLiteralExpression(event)) {
    return false;
  }
  const kind = propertyValue({ literal: event, name: "kind" });
  return kind !== undefined && ts.isStringLiteral(kind) && kind.text === "spawned";
}

/**
 * The shape one call reaches past the seam by, or `undefined` for a call that does not. `definesClient` is true in
 * the one file that defines the constructors, where `withCmuxClient` is built on `realCmuxClient`.
 */
function shapeOf({
  call,
  definesClient,
}: {
  call: ts.CallExpression;
  definesClient: boolean;
}): SessionHarnessLifecycleShape | undefined {
  const name = calleeName({ call });
  if (name !== undefined && CLIENT_CONSTRUCTORS.includes(name) && !definesClient) {
    return "client-construct";
  }
  if (name === "spawnCmuxSession") {
    return "spawn-direct";
  }
  if (name === "appendSessionEvent" && appendsSpawned({ call })) {
    return "spawned-append";
  }
  return undefined;
}

/**
 * Whether a node hands `spawnCmuxSession` on as a value (a call argument, an initializer or an object property)
 * rather than calling it. Passing it by reference is how a caller's injected opener reached cmux past the seam.
 */
function passesSpawnAsValue({ node }: { node: ts.Node }): boolean {
  if (!ts.isIdentifier(node) || node.text !== "spawnCmuxSession") {
    return false;
  }
  const { parent } = node;
  if (ts.isShorthandPropertyAssignment(parent)) {
    return true;
  }
  if (ts.isPropertyAssignment(parent) || ts.isVariableDeclaration(parent)) {
    return parent.initializer === node;
  }
  return ts.isCallExpression(parent) && parent.arguments.includes(node);
}

/**
 * Every reach past the seam in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path, for reporting and to exempt the seam's own tree
 * @param content the file's text
 * @returns each reach, in source order
 */
export function scanSessionHarnessLifecycle({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly SessionHarnessLifecycleHit[] {
  // Every shape names its callee by its own text, so a file spelling none of the names cannot hit: skipping its parse
  // loses nothing and keeps the gate off every other file's AST. An identifier can also be spelled with a `\u`
  // escape the AST normalises away, so a file carrying any `\u` is parsed whatever its raw text names.
  const namesACallee = CALLEE_NAMES.some((name) => content.includes(name)) || content.includes("\\u");
  if (path.startsWith(SEAM_TREE) || !namesACallee) {
    return [];
  }
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly SessionHarnessLifecycleHit[] => {
      const hits: SessionHarnessLifecycleHit[] = [];
      const visit: NodeVisitor = (node) => {
        const line = (): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        if (ts.isCallExpression(node)) {
          const shape = shapeOf({ call: node, definesClient: path === CLIENT_DEFINITION });
          if (shape !== undefined) {
            hits.push({ line: line(), path, shape });
          }
        }
        if (passesSpawnAsValue({ node })) {
          hits.push({ line: line(), path, shape: "spawn-direct" });
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/**
 * Today's DEBT — EMPTY: every opener, row writer and connection is behind the seam, measured by running this gate
 * (`yarn tsx src/devLint/sessionHarnessLifecycle.entry.ts`).
 *
 * **A debt list, not an allowlist.** `count` is how many times each fires in its file, so a SECOND reach added beside
 * a recorded one is still a new hit, and an entry that fires fewer times than it records is stale and fails the gate
 * as loudly, so the list only shrinks. It stays as the mechanism rather than being deleted, so a reach a later stage
 * genuinely cannot move yet is recorded by name with its `movedBy` row instead of being exempted in the criterion.
 */
const DEBT: readonly SessionHarnessLifecycleDebt[] = [];

/**
 * Split a scan's hits into the ones the debt already records and the ones it does not, plus the debt entries that
 * fire fewer times than they record. Grouped on `path` + `shape` and compared by COUNT, so moving a recorded call
 * within its file is not a failure, while a second one added beside it is.
 *
 * @param hits every hit the scan produced
 * @param debt the recorded debt
 * @returns every hit in a group larger than its record, and each over-recorded entry
 */
export function partitionAgainstDebt({
  hits,
  debt,
}: {
  hits: readonly SessionHarnessLifecycleHit[];
  debt: readonly SessionHarnessLifecycleDebt[];
}): { readonly fresh: readonly SessionHarnessLifecycleHit[]; readonly stale: readonly string[] } {
  const groupOf = ({ path, shape }: { path: string; shape: SessionHarnessLifecycleShape }): readonly unknown[] =>
    hits.filter((hit) => hit.path === path && hit.shape === shape);
  const allowanceOf = ({ path, shape }: { path: string; shape: SessionHarnessLifecycleShape }): number =>
    debt.filter((entry) => entry.path === path && entry.shape === shape).reduce((sum, entry) => sum + entry.count, 0);
  const fresh = hits.filter((hit) => groupOf(hit).length > allowanceOf(hit));
  const stale = debt.flatMap((entry) => {
    const fires = groupOf(entry).length;
    if (fires >= entry.count) {
      return [];
    }
    return [`${entry.path} (${entry.shape}): records ${String(entry.count)}, fires ${String(fires)}`];
  });
  return { fresh, stale };
}

/** This gate's declared scan predicate: every non-test `.ts` under `src/`, minus this gate's own files. */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  selfFiles: gateSelfFiles({ stem: "sessionHarnessLifecycle" }),
  trees: ["src/"],
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
 * Print a verdict on stderr: each reach past the seam and its refusal, then each over-recorded debt entry under its
 * own refusal — nothing, for a clean verdict.
 *
 * @returns whether anything was refused
 */
function reportVerdict({
  fresh,
  stale,
}: {
  fresh: readonly SessionHarnessLifecycleHit[];
  stale: readonly string[];
}): boolean {
  for (const hit of fresh) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)} (${hit.shape})\n`);
  }
  if (fresh.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "session-harness-lifecycle" }),
        detail: `${String(fresh.length)} session lifecycle act(s) outside the seam`,
      })}\n`,
    );
  }
  if (stale.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "session-harness-lifecycle-debt" }),
        detail: `${String(stale.length)} DEBT entr(ies) over-recorded`,
      })}\n`,
    );
  }
  for (const entry of stale) {
    process.stderr.write(`  ${entry}\n`);
  }
  return fresh.length > 0 || stale.length > 0;
}

/**
 * IO edge: scan every product source file, judge it against today's {@link DEBT}, print whichever halves of the
 * verdict have something to say, and return 0 (clean) or 1 (a new reach, a stale debt entry, or an incomplete scan).
 *
 * @returns the process exit code
 */
export function runSessionHarnessLifecycle(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("session-harness-lifecycle: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<SessionHarnessLifecycleHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanSessionHarnessLifecycle({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "session-harness-lifecycle",
    scanned: readCount,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  const refused = reportVerdict(partitionAgainstDebt({ debt: DEBT, hits }));
  if (refused || !complete) {
    return 1;
  }
  process.stdout.write(
    `session-harness-lifecycle: clean (${String(readCount)} sources scanned, ${String(hits.length)} recorded in DEBT)\n`,
  );
  return 0;
}
