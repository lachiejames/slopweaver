/**
 * The atlas-manifest-clock gate — refuses a per-atlas copy of the manifest-stamping the kit now owns.
 *
 * ## What went wrong, and why this is a gate rather than a cleanup
 *
 * MEASURED: `slopweaver atlas doctor` reported the 1Password generation as published days before the
 * newest instant in its own `events.jsonl` envelope — the manifest clock 5 days 11 hours behind the newest
 * file it vouched for, every schema test passing. The cause
 * was a private `manifestUpdateFor` that spread the stored manifest and rewrote only `kinds`, so `updatedAt`
 * silently kept whatever it had. FOUR copies of that shape stood at once — `onepassword/sync.ts`,
 * `vanta/sync.ts`, `cloudflare/kindFold.ts`'s `stampKindAttempt` and `vanta/browserSurface.ts`'s
 * `walkManifest`, the last found by this scanner and by no hand audit — the kit owned none, and JumpCloud had
 * already fixed it PRIVATELY, in a file whose own header described the defect the siblings still carried.
 * That is the shape of a regenerating family: it comes back through ordinary, careful work, which is what
 * review does not catch and a gate does. Same argument as `hand-rolled-result`: never fix one platform ad hoc,
 * ask how to make the mistake impossible to make again.
 *
 * ## The criterion, stated so it can be argued with
 *
 * > A function declared OUTSIDE `src/atlas/kit/` whose body returns an object literal that spreads one of
 * > that function's own PARAMETERS and assigns `kinds`.
 *
 * That is the defect's signature and not merely its syntax: taking a manifest in, handing a manifest back
 * with different per-kind statuses, is the job `kit/store.ts`'s `stampAtlasManifest` and `withKindStatus`
 * exist to do exactly once. Three properties follow, and each is deliberate:
 *
 * - **Spreading a CALL is not a hit.** `{ ...initialCanvaManifest({ updatedAt: at }), kinds }` builds a fresh
 *   generation rather than editing a stored one; five atlases do that and none of them drifted.
 * - **Spreading a LOCAL is not a hit.** `cloudflare/reset.ts` binds `initialCloudflareManifest(...)` to a
 *   const and spreads that. Same fresh-build job, one line apart.
 * - **The kit is out of scope by path, not by allowlist.** The kit is where this function is SUPPOSED to
 *   live; a criterion that fired there would be refusing the fix.
 *
 * There is no exemption marker. A false positive is retired by sharpening the criterion above, never by
 * listing the site — the same contract `whole-file-json` carries.
 *
 * Pure {@link scanAtlasManifestClock} + an effectful {@link runAtlasManifestClock} edge, matching every
 * other gate in this directory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bindingElementsOf,
  forEachChild,
  isFunctionLikeDeclaration,
  type NodeVisitor,
  ts,
  withSourceFile,
} from "#lib/tsSyntax.js";
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
 * One per-atlas manifest-stamping copy: where it is, and which parameter it re-spreads.
 *
 * @internal — the scanner's own return shape; nothing outside this gate names it.
 */
export interface ManifestClockHit {
  readonly path: string;
  readonly line: number;
  readonly message: string;
}

/** Where the kit's own implementation lives, and therefore the one place this shape is correct. */
const KIT_PREFIX = "src/atlas/kit/";

/** The parameter names a function binds, including every field it destructures out of an options object. */
function boundParameterNames({ node }: { node: ts.SignatureDeclaration }): ReadonlySet<string> {
  const names = new Set<string>();
  for (const parameter of node.parameters) {
    if (ts.isIdentifier(parameter.name)) {
      names.add(parameter.name.text);
      continue;
    }
    if (ts.isObjectBindingPattern(parameter.name)) {
      for (const element of bindingElementsOf({ pattern: parameter.name })) {
        if (ts.isIdentifier(element.name)) {
          names.add(element.name.text);
        }
      }
    }
  }
  return names;
}

/** Whether an object literal assigns `kinds` — the per-kind statuses this shape exists to rewrite. */
function assignsKinds({ node }: { node: ts.ObjectLiteralExpression }): boolean {
  return node.properties.some((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      return false;
    }
    return ts.isIdentifier(property.name) && property.name.text === "kinds";
  });
}

/** The names an object literal spreads directly, ignoring anything that is not a bare identifier. */
function spreadIdentifiers({ node }: { node: ts.ObjectLiteralExpression }): readonly string[] {
  return node.properties.flatMap((property) =>
    ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression) ? [property.expression.text] : [],
  );
}

/**
 * Every per-atlas manifest-stamping copy in `content`. Pure — parses in memory with the TypeScript AST.
 *
 * @param path the file's repo-relative path, which also decides whether the kit exemption applies
 * @param content the file's text
 * @returns each violation, in source order
 */
export function scanAtlasManifestClock({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly ManifestClockHit[] {
  if (path.startsWith(KIT_PREFIX)) {
    return [];
  }
  return withSourceFile({
    fileName: path,
    text: content,
    use: (sf): readonly ManifestClockHit[] => {
      const hits: ManifestClockHit[] = [];
      const visitFunction = ({ node }: { node: ts.SignatureDeclaration }): void => {
        const parameters = boundParameterNames({ node });
        if (parameters.size === 0) {
          return;
        }
        const walk: NodeVisitor = (inner) => {
          // A nested function re-binds its own parameters, so its body belongs to that signature, not this one.
          if (inner !== node && isFunctionLikeDeclaration(inner)) {
            return;
          }
          if (ts.isObjectLiteralExpression(inner) && assignsKinds({ node: inner })) {
            const respread = spreadIdentifiers({ node: inner }).find((name) => parameters.has(name));
            if (respread !== undefined) {
              hits.push({
                line: sf.getLineAndCharacterOfPosition(inner.getStart(sf)).line + 1,
                message:
                  `this object spreads the parameter \`${respread}\` and rewrites \`kinds\` — that is the per-atlas ` +
                  "manifest-stamping the kit now owns. Use `stampAtlasManifest` (bulk) or `withKindStatus` " +
                  "(one kind) from `src/atlas/kit/store.ts`; see `src/atlas/kit/manifestClock.ts` for the " +
                  "generation that read five days stale because three atlases each kept their own copy.",
                path,
              });
            }
          }
          forEachChild({ node: inner, visit: walk });
        };
        forEachChild({ node, visit: walk });
      };
      const visit: NodeVisitor = (node) => {
        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
          visitFunction({ node });
        }
        if (ts.isMethodDeclaration(node)) {
          visitFunction({ node });
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/** This gate's declared scan predicate: every `.ts` under the source trees, minus its own files. */
const SCOPE: ScanScope = {
  selfFiles: gateSelfFiles({ stem: "atlasManifestClock" }),
  trees: ["src/", "eval/", "hooks/"],
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
 * IO edge: scan every source file, print each violation, return 0 (clean) or 1.
 *
 * @returns the process exit code (0 clean, 1 a violation found or not a git checkout)
 */
export function runAtlasManifestClock(): number {
  let root: string;
  let scanned: readonly string[];
  try {
    root = repoRoot();
    scanned = scopedScanFiles({ root, scope: SCOPE });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("atlas-manifest-clock: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const {
    hits,
    unreadable,
    scanned: readCount,
  } = scanTextFiles<ManifestClockHit>({
    paths: scanned,
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanAtlasManifestClock({ content, path }),
  });
  const complete = reportScanIntegrity({
    label: "atlas-manifest-clock",
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
    process.stdout.write(`atlas-manifest-clock: clean (${String(readCount)} file(s) scanned)\n`);
    return 0;
  }
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}: ${hit.message}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "atlas-manifest-clock" }),
      detail: `${String(hits.length)} violation(s)`,
    })}\n`,
  );
  return 1;
}
