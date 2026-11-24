/**
 * Harvest a corpus tree's identity candidates by STREAMING it — the discovery leg of person resolution,
 * without ever holding the corpus it discovers from.
 *
 * ## Why this file exists
 *
 * `identity resolve <handle|id>` and `identity show` both need the same three inputs: the roster, the
 * hydrated members, and the per-source identities the CORPUS contributes. They used to get the third by
 * calling {@link ../corpus/corpusStore.readCorpusDir} — every record of every window file, materialised
 * into one array — and then throwing all of it away except `identityCandidatesForRecord`'s output.
 *
 * MEASURED on the owner's own corpus (`du -sh ~/.slopweaver/corpus/bronze`; the stream's own
 * figures reproduce with `./bin/slopweaver identity resolve <id>`): 36 files, 7,908 MiB on disk,
 * 2,123,973 rows — contributing **1,402 distinct candidates**. The whole-tree load projects about
 * 15,880 MiB of heap, so the corpus reader's preflight refused it outright and the verb answered nothing
 * at all. Streaming the same tree takes **14.0 s at a 574 MiB peak**, which is the transient of one 8 MiB
 * chunk plus what the collector has not got to yet — flat in the size of the corpus, because the only
 * thing retained is the deduped candidate map.
 *
 * A lookup verb that reads two million rows to answer one question is still doing more work than the
 * question needs. What it must never do is REFUSE, and what it must never do to avoid refusing is drop
 * this leg: measured the same day, **628 of the 1,576 people this corpus resolves are discoverable ONLY
 * from record authorship** — every bot, and everyone who left before the members index was built.
 *
 * ## Why the members index is not consulted first
 *
 * The obvious cheaper shape — resolve from members + roster, and stream only when that misses — was
 * measured and REJECTED. Over the 2,503 raw tokens this corpus resolves from members alone, nine answers
 * change once the record candidates are folded in, and seven of those go from a CONFIDENT person to an
 * AMBIGUOUS one (`cloudflare-workers-and-pages`, `datadog-official`, `acme-agent-system`,
 * the organisation's self-hosted Renovate App, `github-actions`, `github-advanced-security`, `nx-cloud` — each a Linear member
 * whose handle a record-only GitHub identity also claims). A members-first short-circuit would answer all
 * seven confidently and wrongly, which is the one outcome
 * {@link ../cli/commands/identity/identityShow.emitPerson} already calls worse than no answer at all.
 *
 * Reproduce with `./bin/slopweaver identity resolve github-actions` — an ambiguous token names both
 * people and exits non-zero.
 */
import type { IngestError } from "#lib/ingestError.js";
import type { OwnerProtectionResolver } from "../corpus/bronzeProtection.js";
import { parseRow } from "../corpus/corpusRowCore.js";
import { protectedSkipWarnings, readJsonlLines, scanJsonlProtected } from "../corpus/corpusStore.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import type { PersonIdentity } from "./identity.js";
import { identityCandidateKey, identityCandidatesForRecord } from "./personResolver.js";

/**
 * Fold one already-judged file's candidates into `seen`, first-seen order kept, one line at a time.
 *
 * @param path the file to read, which the caller's protected scan listed
 * @param seen the candidates so far, keyed by {@link ./personResolver.identityCandidateKey}
 * @returns the read's outcome, an `Err` when the file could not be read at all
 */
function foldFileCandidates({
  path,
  seen,
}: {
  path: string;
  seen: Map<string, PersonIdentity>;
}): Result<void, IngestError> {
  return safeFs({
    execute: () => {
      readJsonlLines({
        onLine: ({ line }) => {
          if (line.length === 0) {
            return;
          }
          const parsed = parseRow({ line });
          if (!("record" in parsed)) {
            // A corrupt LINE is skipped in silence here, unlike in the corpus reader. That reader is
            // accounting for every row against a conservation law; this one is answering "who is this",
            // and a line that will not parse names nobody. Its own warning is already raised by every
            // reader that does account for it.
            return;
          }
          for (const candidate of identityCandidatesForRecord({ record: parsed.record })) {
            const key = identityCandidateKey({ candidate });
            if (!seen.has(key)) {
              seen.set(key, candidate);
            }
          }
        },
        path,
      });
    },
    operation: "streamIdentityCandidates.read",
    path,
  });
}

/**
 * Every distinct identity candidate a corpus tree contributes, in first-seen order, read one line at a
 * time so peak heap is flat in the size of the tree.
 *
 * The order and the dedupe key are {@link ./personResolver.identityCandidateKey}'s, the ones the retired
 * materialised-array reader used too, so folding the records and streaming them hand
 * {@link ./personResolver.resolvePeople} the same candidates in the same order — equivalent, not merely
 * similar.
 *
 * `unreadable` is in the RETURN TYPE for the reason {@link ../corpus/corpusStore.readCorpusDir} puts it
 * there: a file nobody could open contributes an unknown number of candidates, and "this source named
 * nobody" and "this source could not be read" are otherwise indistinguishable to a caller building an
 * answer out of the result.
 *
 * The walk is judged by the owner's protect list (`scanJsonlProtected`), so a protected tree, or a protect list that
 * cannot be read, is an `Err` before any file is opened — never the empty candidate set it would otherwise read as.
 *
 * @param dir the corpus root to walk (bronze, or one source dir)
 * @param home the Slopweaver home whose protect list applies, beside the account's own; `dir` may sit outside it
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the distinct candidates, the paths that could not be read at all, and a warning per unreadable
 *   file, unlistable directory or path the protect list kept out of the walk — or the protect list's refusal
 */
export function streamIdentityCandidates({
  dir,
  home,
  protection,
}: {
  dir: string;
  home: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<{
  candidates: readonly PersonIdentity[];
  unreadable: readonly string[];
  warnings: readonly string[];
}> {
  const scanned = scanJsonlProtected({
    dir,
    home,
    operation: { target: "identity candidates", verb: "read" },
    protection,
  });
  if (scanned.isErr()) {
    return err(scanned.error);
  }
  const scan = scanned.value;
  const seen = new Map<string, PersonIdentity>();
  const unreadable: string[] = [];
  const warnings: string[] = [];
  for (const file of scan.files) {
    const read = foldFileCandidates({ path: file.path, seen });
    if (read.isErr()) {
      unreadable.push(file.path);
      warnings.push(`${file.path}: could not be read at all — any person named only there will not resolve`);
    }
  }
  for (const unlistable of scan.unreadableDirs) {
    unreadable.push(unlistable);
    warnings.push(`${unlistable}: directory could not be listed — any person named only there will not resolve`);
  }
  warnings.push(...protectedSkipWarnings({ scan }));
  return ok({ candidates: [...seen.values()], unreadable, warnings });
}
