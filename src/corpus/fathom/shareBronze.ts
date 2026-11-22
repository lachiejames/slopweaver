/**
 * What `fathom share` and `fathom discover` read from and do to the fathom source's own bronze.
 *
 * ## Replacing a hand-written row, once
 *
 * Before this verb existed, a session read the four Auditco share pages by hand and wrote four rows keyed
 * `share:<token>`. Those rows carry exactly what the owner ruled out — Fathom's own action
 * items, in `attrs.actionItems` and as `[ACTION ITEM]` lines in the text — and they attribute the speech under
 * an action item to the wrong person. The verb's row for the same call is keyed on the RECORDING id, the
 * identity the API lane already uses, so the dedup index can never collapse the two: the old row has to be
 * REMOVED, every version of it.
 *
 * That removal is the one rewrite of bronze this source does, and it is narrow by construction: it drops a
 * line only when its `sourceId` is `share:<token>` for a token the verb has just read successfully and
 * committed under its recording id. A crash between the commit and the rewrite leaves both rows — a superset,
 * never a loss — and the next run of the verb removes the old one again. Each file is rewritten through
 * {@link ../../lib/writeAtomic.writeFileAtomicStream}, so a failure part-way leaves it exactly as it was.
 */
import { unlinkSync } from "node:fs";

import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { writeFileAtomicStream } from "../../lib/writeAtomic.js";
import type { OwnerProtectionResolver } from "../bronzeProtection.js";
import { type BronzeFileStat, listBronzeFiles } from "../bronzeStorage.js";
import { preflightCorpusAccesses } from "../corpusAccessGuard.js";
import { readJsonlLines } from "../corpusStore.js";

/** The prefix every hand-written share row's `sourceId` opens with. */
const HAND_WRITTEN_PREFIX = "share:";

/** The fathom source's bronze files, judged by the owner's protect list, as one line per refusal. */
function fathomBronzeFiles({
  home,
  protection,
}: {
  home: string;
  protection: OwnerProtectionResolver | undefined;
}): Result<readonly BronzeFileStat[]> {
  return listBronzeFiles({ home, protection, source: "fathom" }).mapErr((failure) => [failure.message]);
}

/**
 * The identity a hand-written share row was keyed on, before the verb keyed them on the recording id.
 *
 * @param token the share token
 * @returns the hand-written row's `sourceId`
 */
export function handWrittenShareSourceId({ token }: { token: string }): string {
  return `${HAND_WRITTEN_PREFIX}${token}`;
}

/**
 * The `sourceId` and share token one bronze line carries, or nulls when it is not a parseable record.
 *
 * @param line one raw JSONL line
 * @returns the line's identity and the share token its attrs name
 */
function shareIdentityOfLine({ line }: { line: string }): {
  sourceId: string | null;
  shareToken: string | null;
} {
  if (line.trim() === "") {
    return { shareToken: null, sourceId: null };
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { shareToken: null, sourceId: null };
  }
  if (!isRecord(value)) {
    return { shareToken: null, sourceId: null };
  }
  const attrs = value["attrs"];
  const token = isRecord(attrs) ? attrs["shareToken"] : undefined;
  return {
    shareToken: typeof token === "string" ? token : null,
    sourceId: typeof value["sourceId"] === "string" ? value["sourceId"] : null,
  };
}

/**
 * Every share token the fathom source already holds a verb-read transcript for.
 *
 * A hand-written `share:<token>` row does NOT count: it is exactly the row a re-read exists to replace, so a
 * discovery pass that treated it as done would leave the summary content in place forever.
 *
 * @param home the Slopweaver home
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the tokens, as a set, or the refusal naming what the owner's protect list covers
 */
export function readShareTokens({
  home,
  protection,
}: {
  home: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<ReadonlySet<string>> {
  const listed = fathomBronzeFiles({ home, protection });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const tokens = new Set<string>();
  for (const file of listed.value) {
    readJsonlLines({
      onLine: ({ line }) => {
        const { sourceId, shareToken } = shareIdentityOfLine({ line });
        if (shareToken !== null && sourceId !== handWrittenShareSourceId({ token: shareToken })) {
          tokens.add(shareToken);
        }
      },
      path: file.path,
    });
  }
  return ok(tokens);
}

/**
 * Every share token a hand-written `share:<token>` row still stands for in the fathom source's bronze.
 *
 * `fathom share` replays the WHOLE source into the store, so while one of these remains, a replay would
 * write that row's Fathom action items to the store however carefully this share removed its own.
 *
 * @param home the Slopweaver home
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the tokens, sorted, each once, or the refusal naming what the owner's protect list covers
 */
export function handWrittenShareTokens({
  home,
  protection,
}: {
  home: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<readonly string[]> {
  const listed = fathomBronzeFiles({ home, protection });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const tokens = new Set<string>();
  for (const file of listed.value) {
    readJsonlLines({
      onLine: ({ line }) => {
        const { sourceId } = shareIdentityOfLine({ line });
        if (sourceId?.startsWith(HAND_WRITTEN_PREFIX) === true) {
          tokens.add(sourceId.slice(HAND_WRITTEN_PREFIX.length));
        }
      },
      path: file.path,
    });
  }
  return ok([...tokens].toSorted());
}

/**
 * Rewrite one already-listed fathom file without the hand-written row's lines, or remove it when none would remain.
 *
 * @param path the file, which the caller's judged listing named
 * @param handWritten the hand-written row's `sourceId`, every version of which is dropped
 * @param kept how many lines would survive; zero removes the file
 * @returns the rewrite's outcome
 */
function rewriteWithout({
  path,
  handWritten,
  kept,
}: {
  path: string;
  handWritten: string;
  kept: number;
}): Result<void, IngestError> {
  return safeFs({
    execute: () => {
      // A file left with no line at all is removed rather than left empty: an empty `.jsonl` still reads
      // as "a corpus exists" to `resolveCorpusDir`, which is why compaction removes one too.
      if (kept === 0) {
        unlinkSync(path);
        return;
      }
      writeFileAtomicStream({
        path,
        produce: ({ write }) => {
          readJsonlLines({
            onLine: ({ line }) => {
              if (line === "" || shareIdentityOfLine({ line }).sourceId === handWritten) {
                return;
              }
              write({ text: `${line}\n` });
            },
            path,
          });
        },
      });
    },
    operation: "fathom.share.supersede",
    path,
  });
}

/** One listed file holding the hand-written row: how many of its lines go, and how many stay. */
interface ShareRowHit {
  readonly path: string;
  readonly hits: number;
  readonly kept: number;
}

/**
 * Count, per listed file, the hand-written row's lines and the lines that would survive. Reads only.
 *
 * @param paths the judged listing's files
 * @param handWritten the hand-written row's `sourceId`
 * @returns one entry per file that holds the row, in listing order
 */
function shareRowHits({ paths, handWritten }: { paths: readonly string[]; handWritten: string }): ShareRowHit[] {
  const found: ShareRowHit[] = [];
  for (const path of paths) {
    let hits = 0;
    let kept = 0;
    readJsonlLines({
      onLine: ({ line }) => {
        if (shareIdentityOfLine({ line }).sourceId === handWritten) {
          hits += 1;
        } else if (line !== "") {
          kept += 1;
        }
      },
      path,
    });
    if (hits > 0) {
      found.push({ hits, kept, path });
    }
  }
  return found;
}

/**
 * Remove every version of the hand-written `share:<token>` rows from the fathom source's bronze.
 *
 * Every file holding the row is judged as a write BEFORE the first rewrite: the listing judged them only as reads,
 * which a read-only entry allows, and a refuser never rewrites file A before finding file B covered.
 *
 * @param home the Slopweaver home
 * @param token the share token whose hand-written row is superseded
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns how many lines were removed across how many files, the protect list's refusal, or why a file could
 *   not be rewritten
 */
export function removeHandWrittenShareRows({
  home,
  token,
  protection,
}: {
  home: string;
  token: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<{ removed: number; files: number }> {
  const handWritten = handWrittenShareSourceId({ token });
  const listed = fathomBronzeFiles({ home, protection });
  if (listed.isErr()) {
    return err(listed.error);
  }
  const hits = shareRowHits({ handWritten, paths: listed.value.map((file) => file.path) });
  const judged = preflightCorpusAccesses({
    accesses: hits.map(({ path }) => ({ access: "write", path })),
    home,
    operation: { target: handWritten, verb: "supersede" },
    protection,
  });
  if (judged.isErr()) {
    return err(judged.error);
  }
  let removed = 0;
  for (const hit of hits) {
    const rewritten = rewriteWithout({ handWritten, kept: hit.kept, path: hit.path });
    if (rewritten.isErr()) {
      return err([`could not rewrite ${hit.path} without ${handWritten}: ${rewritten.error.message}`]);
    }
    removed += hit.hits;
  }
  return ok({ files: hits.length, removed });
}
