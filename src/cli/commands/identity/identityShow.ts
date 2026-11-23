/**
 * `slopweaver identity show` — the whole-corpus resolution, and the person vocabulary the rest of the
 * family reports in.
 *
 * Depth 1 of the escalation ladder `show -> resolve -> narrow`: {@link resolveFor} and {@link emitPerson}
 * are exported because {@link ./identityResolve} reports an exact hit in exactly this vocabulary, not
 * because they are generic plumbing.
 */

import { memberIdentityCandidates } from "../../../corpus/members/project.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { IdentityRecord } from "../../../silver/identity.js";
import type { RawPersonResolution } from "../../../silver/personLookup.js";
import { resolvePersonForRaw } from "../../../silver/personLookup.js";
import { resolvePeople } from "../../../silver/personResolver.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { peopleToJson, personToJson, renderPeople, renderPersonBlock } from "./core.js";
import { homeFor, type IdentityDeps, strFlag, verbTail } from "./identityShared.js";

const SHOW_USAGE = "usage: slopweaver identity show [<handle|id>] [--home <dir>] [--corpus <dir>] [--json]";

/**
 * Load corpus + members + roster and resolve them into canonical people (warnings surfaced through the
 * logger).
 *
 * Members LEAD the candidate list, and that order is load-bearing rather than incidental: an email-bearing
 * member candidate must form its email group before the email-less activity candidate for the same
 * `<source>:<nativeId>` arrives, or that activity candidate claims a single-source group the member's email
 * can no longer merge into.
 *
 * @param overrides the store roster's confirmed people, read once by the caller
 * @returns the canonical people, with every candidate source folded in, or the owner's protect list refusing
 *   the corpus — never a resolution that quietly left the corpus out
 */
export function resolveFor({
  deps,
  home,
  corpus,
  overrides,
}: {
  deps: IdentityDeps;
  home: string;
  corpus: string | undefined;
  overrides: readonly IdentityRecord[];
}): Result<ReturnType<typeof resolvePeople>, string> {
  const loaded = deps.loadCandidates({ home, ...(corpus !== undefined ? { corpus } : {}) });
  if (loaded.refused !== undefined) {
    return err(loaded.refused);
  }
  const members = deps.loadMembers({ home });
  [...loaded.warnings, ...members.warnings].forEach((w) => {
    deps.logger.warn({ msg: w });
  });
  return ok(
    resolvePeople({
      candidates: [...memberIdentityCandidates({ rows: members.rows }), ...loaded.candidates],
      overrides,
    }),
  );
}

/**
 * Emit what a token resolved to. Shared by `show <who>` + `resolve <raw>`.
 *
 * An AMBIGUOUS token names every candidate and exits non-zero: this verb is what a human or an agent runs to
 * answer "who is this?", so a confident wrong answer is the worst outcome available to it — worse than no
 * answer, because nothing downstream can tell the two apart.
 *
 * @returns the process exit code
 */
export function emitPerson({
  deps,
  resolved,
  raw,
  json,
}: {
  deps: IdentityDeps;
  resolved: RawPersonResolution;
  raw: string;
  json: boolean;
}): number {
  if (resolved.kind === "unknown") {
    deps.logger.out({ line: `no canonical person for "${raw}"` });
    return EXIT_EXPECTED_EMPTY;
  }
  if (resolved.kind === "ambiguous") {
    if (json) {
      deps.logger.out({
        line: JSON.stringify({ ambiguous: resolved.people.map((person) => personToJson({ person })), raw }, null, 2),
      });
    } else {
      deps.logger.error({
        msg: `"${raw}" is ambiguous — ${String(resolved.people.length)} people match it, so this verb will not pick one:`,
      });
      resolved.people.forEach((person) => {
        deps.logger.error({ msg: `  ${person.id} (${person.displayName}, ${person.confidence})` });
      });
      deps.logger.error({
        msg: "resolve it by a native id, or pin the intended person in the roster (`slopweaver identity roster replace`)",
      });
    }
    return EXIT_ERROR;
  }
  if (json) {
    deps.logger.out({ line: JSON.stringify(personToJson({ person: resolved.person }), null, 2) });
  } else {
    renderPersonBlock({ person: resolved.person }).forEach((line) => {
      deps.logger.out({ line: line });
    });
  }
  return EXIT_OK;
}

/**
 * Run `identity show [<who>]` over injected dependencies — the testable shell. With no positional it lists
 * every canonical person; with one it filters to that person (`EXIT_EXPECTED_EMPTY` when unknown).
 *
 * @param argv the full process argv
 * @param deps the effectful seams
 * @returns the process exit code
 */
export async function runIdentityShowWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: IdentityDeps;
}): Promise<number> {
  const rest = verbTail({ argv, verb: "show" });
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: SHOW_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json"], string: ["corpus", "home"] },
  });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      deps.logger.error({ msg: e });
    });
    deps.logger.error({ msg: SHOW_USAGE });
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed.value;
  const home = homeFor({ deps, values });
  const roster = await deps.loadRoster({ home });
  if (roster.isErr()) {
    deps.logger.error({ msg: roster.error.message });
    return EXIT_ERROR;
  }
  const resolved = resolveFor({ corpus: strFlag({ key: "corpus", values }), deps, home, overrides: roster.value });
  if (resolved.isErr()) {
    deps.logger.error({ msg: resolved.error });
    return EXIT_ERROR;
  }
  const resolution = resolved.value;
  const json = values["json"] === true;
  const who = positionals[0];
  if (who !== undefined) {
    return emitPerson({ deps, json, raw: who, resolved: resolvePersonForRaw({ raw: who, resolution }) });
  }
  if (json) {
    deps.logger.out({ line: JSON.stringify(peopleToJson({ resolution }), null, 2) });
  } else {
    renderPeople({ resolution }).forEach((line) => {
      deps.logger.out({ line: line });
    });
  }
  return EXIT_OK;
}
