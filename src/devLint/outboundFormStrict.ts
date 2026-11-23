/**
 * The gate that stops an outbound form silently dropping a key nobody declared.
 *
 * ## Why a gate and not a convention
 *
 * A plain `z.object` DROPS unrecognised keys. `src/outbound/artifact/schema.ts` already carried a prominent
 * warning about exactly that — written after a poll shipped with `mentions:` where the field is `ping:`,
 * validating clean and posting with no ping and no error. The warning did not stop it happening again: a ported
 * alert payload reached the digest form carrying `impact`, `rootCause`, `fixStep` and a `citations` array, all
 * four were dropped, and a card posted without the substance that was its whole point, at exit 0.
 *
 * The warning was in the same file as three of the four offending declarations. So the convention had already
 * been tried, in the strongest form available, and lost — which is the argument for a gate rather than a fourth
 * restatement of it.
 *
 * ## What it enforces
 *
 * Every object schema under `src/outbound/**` is declared with `strictForm` from `src/outbound/strictForm.ts`.
 * That helper refuses an unknown key AND names the nearest valid field, so the two halves of the original defect
 * — the silence, and Zod's own message stopping at the key name — cannot come back separately.
 *
 * `z.strictObject` is refused as well as `z.object`, which is deliberate and is not pedantry about spelling.
 * A raw `strictObject` is SAFE but MUTE: it refuses the key and never says what the key probably meant, which is
 * the difference between a porter fixing their payload in one pass and filing a bug. Allowing it would let the
 * message regress while the safety held, and a half-fix that looks like the fix is the harder thing to notice.
 *
 * ## Scope and honesty
 *
 * A regex over the sources under `src/outbound/`, skipping the helper itself (which must call the real Zod
 * constructor) and skipping tests (a test may legitimately build a loose schema to prove the helper differs from
 * one). It is not defending against a determined author — `z['object']` would evade it — but against a
 * reasonable one reaching for the constructor they already know.
 *
 * An unreadable file is reported and FAILS rather than being counted clean, because a file this gate
 * could not read is a file it did not check.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendAll } from "../lib/arrays.js";
import { repoRootOf, workingTreeFilesOf } from "../lib/gitRepo.js";
import { reportEmptySelection } from "../lib/textFileScan.js";
import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";

/** The one module allowed to call Zod's object constructors directly — it is the wrapper. */
const SANCTIONED = "src/outbound/strictForm.ts";

/**
 * Outbound sources are the scope. Tests are excluded: a test proving `strictForm` behaves differently from a
 * bare `z.object` has to be able to write one.
 */
function inScope({ path }: { path: string }): boolean {
  return path.startsWith("src/outbound/") && path.endsWith(".ts") && !path.endsWith(".test.ts") && path !== SANCTIONED;
}

/**
 * A raw Zod object constructor, in any of the three spellings that reach one.
 *
 * `looseObject` is included for completeness: it is the explicit opt-in to the very behaviour that caused this,
 * so it has no place in an outbound form either.
 */
const RAW_OBJECT = /\bz\s*\.\s*(?:object|strictObject|looseObject)\s*\(/;

/** One offending line. */
interface RawObjectHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Find every raw Zod object constructor in an outbound source.
 *
 * Comment lines are skipped so that PROSE describing the old behaviour — which several of these files now do at
 * length, deliberately — does not fail the gate that the prose exists to explain.
 *
 * @param path the repo-relative path, for reporting
 * @param content the file's text
 * @returns the offending lines
 */
export function findRawObjectSchemas({ path, content }: { path: string; content: string }): readonly RawObjectHit[] {
  return content
    .split("\n")
    .map((text, index) => ({ line: index + 1, path, text: text.trim() }))
    .filter((hit) => !hit.text.startsWith("*") && !hit.text.startsWith("//") && !hit.text.startsWith("/*"))
    .filter((hit) => RAW_OBJECT.test(hit.text));
}

/**
 * Scan every outbound source, print each hit, and return an exit code.
 *
 * @returns 0 when clean, 1 when any outbound schema bypasses `strictForm` or the scan could not run
 */
export function runOutboundFormStrict(): number {
  let root: string;
  let files: readonly string[];
  try {
    root = repoRootOf({ importMetaUrl: import.meta.url });
    files = workingTreeFilesOf({ root });
  } catch {
    // devlint: not-a-refusal -- the repository could not be READ — either the checkout was not found,
    // or its files could not be enumerated — so the gate has no subject to judge
    process.stderr.write("outbound-form-strict: not a git checkout (git ls-files failed)\n");
    return 1;
  }
  const hits: RawObjectHit[] = [];
  const unreadable: string[] = [];
  const selected = files.filter((candidate) => inScope({ path: candidate }));
  for (const path of selected) {
    try {
      appendAll({ from: findRawObjectSchemas({ content: readFileSync(join(root, path), "utf8"), path }), into: hits });
    } catch {
      unreadable.push(path);
    }
  }
  const unseen =
    unreadable.length +
    reportEmptySelection({
      label: "outbound-form-strict",
      selected: selected.length,
      write: (text) => {
        process.stderr.write(text);
      },
    });
  return report({ hits, unreadable, unseen });
}

/** Print the outcome. */
function report({
  hits,
  unreadable,
  unseen,
}: {
  hits: readonly RawObjectHit[];
  unreadable: readonly string[];
  unseen: number;
}): number {
  for (const hit of hits) {
    process.stderr.write(`  ${hit.path}:${String(hit.line)}  ${hit.text}\n`);
  }
  for (const path of unreadable) {
    process.stderr.write(`  ${path}  (unreadable — not checked)\n`);
  }
  const outcome = gateOutcome({ refused: hits.length, unseen });
  if (outcome === "clean") {
    process.stdout.write("outbound-form-strict: clean\n");
    return 0;
  }
  if (outcome === "incomplete") {
    // devlint: not-a-refusal -- a file that could not be read was not checked, so this reports
    // the gap rather than a policy verdict over it
    process.stderr.write("outbound-form-strict: a source could not be read, so this scan is incomplete, not clean.\n");
    return 1;
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "outbound-form-strict" }),
      detail: `${String(hits.length)} outbound schema(s) built with a raw Zod constructor`,
    })}\n`,
  );
  return 1;
}
