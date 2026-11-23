/**
 * The gate that stops a SECOND copy of a verb's metadata reappearing in a command module.
 *
 * ## Why the typechecker is not enough
 *
 * `defineCommand` now accepts `{ run }` and nothing else, so the obvious spelling —
 * `defineCommand({ run, effect: "none" })` — is rejected by excess-property checking. That check only fires
 * on a FRESH object literal at the call site. Assign the same object to a variable first, or build it with a
 * spread, and TypeScript's structural typing accepts it happily and the extra fields are silently dropped.
 *
 * So a green typecheck is not evidence the duplicate metadata is gone. This is that evidence: a text scan of
 * the command modules for the metadata field names as object keys.
 *
 * ## What it does and does not prove
 *
 * It catches the field names written as an object key — bare (`doorRouted:`) or quoted (`"doorRouted":`,
 * `'doorRouted':`) — outside a comment. It does NOT prove the manifest metadata is correct, and it cannot
 * see a module that smuggles the same information under different names or assembles the key at runtime.
 *
 * The first version of this header claimed it caught the shape "regardless of how it is spelled". A review
 * pass falsified that in one line: a quoted key slipped straight through while every test stayed green. The
 * claim is narrowed rather than the check being called complete, because a gate that overstates its reach is
 * precisely the defect this gate family exists to close.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportScanIntegrity, scanTextFiles } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { lintGateRefusal } from "./refusal/render.js";

/**
 * The `CommandMeta` fields that belong to NO other type in the repo.
 *
 * Deliberately not the full set. `effect` and `createsWorkItem` are also fields of `DoorMeta`, the request
 * metadata every `throughDoor` call legitimately builds inside a command module — the first version of this
 * gate listed them and reported eighteen hits, every one of them a correct `DoorRequest`. A gate that cries
 * wolf gets suppressed, and a suppressed gate is worse than none. (`requiresApproval` was in that same
 * excluded set until it was removed from `CommandMeta` altogether — see `src/cli/defineCommand.ts` — and it
 * remains excluded for the same reason: it is a `DoorMeta` field, and now ONLY a `DoorMeta` field.)
 *
 * These four appear nowhere but a verb's command metadata, so any one of them in a command module means the
 * duplicate block is back. A re-added block would carry every field and therefore trip on these four anyway.
 */
const META_FIELDS: readonly string[] = ["diagnostic", "doorRouted", "dryParseSafe", "parseRejectIsIoFree"];

/** Only the modules a manifest can load — the manifests themselves are the legitimate home for this. */
function inScope({ path }: { path: string }): boolean {
  return path.startsWith("src/cli/commands/") && path.endsWith(".ts");
}

/** One residue hit. */
export interface MetaResidueHit {
  readonly path: string;
  readonly line: number;
  readonly field: string;
  readonly text: string;
}

/**
 * Find any `CommandMeta` field declared as an object property in a command module.
 *
 * Matches `field:` at a property position so prose in a comment, or a local variable that merely shares the
 * name, is not reported. A line inside a block comment is skipped by the caller-visible `*` prefix test.
 *
 * @param path the repo-relative path, for reporting
 * @param content the module text
 * @returns a hit per offending property
 */
export function scanMetaResidue({ path, content }: { path: string; content: string }): readonly MetaResidueHit[] {
  const hits: MetaResidueHit[] = [];
  content.split("\n").forEach((raw, index) => {
    const text = raw.trim();
    if (text.startsWith("*") || text.startsWith("//")) {
      return;
    }
    for (const field of META_FIELDS) {
      // Bare, quoted and computed-quoted keys all count: `doorRouted:`, `"doorRouted":`, `['doorRouted']:`.
      // Two review passes widened this — the first slipped `"doorRouted":` past a bare-only match, the
      // second slipped `["doorRouted"]:` past the quoted one. Both stayed green until then.
      if (new RegExp(`(?:^|[{,[\\s])\\[?\\s*["']?${field}["']?\\s*\\]?\\s*:`).test(text)) {
        hits.push({ field, line: index + 1, path, text });
      }
    }
  });
  return hits;
}

/**
 * Scan every command module for duplicated verb metadata.
 *
 * @returns 0 when clean, 1 on any residue or unreadable module
 */
export function runCommandMetaResidue(): number {
  let root: string;
  let files: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    files = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("command-meta-residue: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const { hits, unreadable, scanned } = scanTextFiles<MetaResidueHit>({
    paths: files.filter((path) => inScope({ path })),
    readText: ({ path }) => readFileSync(join(root, path), "utf8"),
    scan: ({ content, path }) => scanMetaResidue({ content, path }),
  });
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}  declares \`${hit.field}\` — ${hit.text}\n`);
  }
  const complete = reportScanIntegrity({
    label: "command-meta-residue",
    scanned,
    unreadable,
    write: (text) => {
      process.stderr.write(text);
    },
  });
  if (hits.length === 0 && complete) {
    process.stdout.write(`command-meta-residue: clean (${String(scanned)} command modules scanned)\n`);
    return 0;
  }
  if (hits.length > 0) {
    process.stderr.write(
      `${lintGateRefusal({
        declaration: lintDeclarationFor({ id: "command-meta-residue" }),
        detail: `${String(hits.length)} duplicated metadata field(s) in command modules`,
      })}\n`,
    );
  }
  return 1;
}
