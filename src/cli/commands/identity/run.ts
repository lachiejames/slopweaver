/**
 * `slopweaver identity` — read-only cross-source identity resolution. `show` prints every canonical person
 * (their per-source ids + how each was linked); `resolve <token>` answers "who is this?" for a name, handle,
 * email or id; `narrow <token>` hands the whole member index to a haiku sub-agent when that exact lookup
 * missed, and checks the key it picks; `org-domains` prints the domains the resolution checks against. No
 * writes, no SDK/LLM calls — `effect: "none"`, and that holds for `narrow` too: it prints a brief, and the
 * model that reads one belongs to the session, never to this process (rule 2).
 *
 * A thin effectful shell: every read is INJECTED (fakes in tests, production wiring in
 * {@link productionIdentityDeps}); the resolution + rendering are the pure cores.
 *
 * **`resolve` and `show` answer different questions, and the split is the point.**
 *
 * `resolve` reads the MEMBER index and nothing else ({@link ../../../silver/mentionResolver}): every
 * provider's own member list, so a name resolves without a corpus read at all, an outsider is refused rather
 * than returned, and two colleagues of one first name are named rather than picked between. That is what the
 * five measured failures needed — four of which read as ABSENCE while the person was in
 * bronze the whole time.
 *
 * **A miss is never reported as a proven absence.** Before any such sentence is printed, `resolve` runs the
 * NEAR pass ({@link ../../../silver/nearMention}) over the member index's own spellings and names whoever is
 * close — a suggestion it explicitly refuses to pick between, never a resolution. What made that a defect
 * rather than a limitation is in that module's note and in {@link ./core.renderNoExactMatch}'s.
 *
 * `show` keeps the whole-corpus resolution, and `resolve --corpus-scan` opts back into it for the one case
 * the member index genuinely cannot cover: a person who appears only as a record author and is in no
 * members index. It is opt-in because it is not free — the corpus leg is a STREAM rather than a load, and
 * even so it walks every bronze file. {@link ../../../silver/identityCandidateStream} carries that
 * measurement.
 */

/*
 * The four verbs live one module each, at the depth their own escalation ladder puts them:
 * {@link ./identityShared} (the argv + store seam), then {@link ./identityOrgDomains} and {@link
 * ./identityShow} beside each other, then {@link ./identityResolve}, then {@link ./identityNarrow}. This
 * file is the shell: the production wiring, the four thin runners and the four command declarations.
 */

import { slopweaverHome } from "../../../config.js";
import { resolveCorpusDir } from "../../../corpus/corpusResolve.js";
import { readAllMembers } from "../../../corpus/members/store.js";
import { logger } from "../../../lib/logger.js";
import { streamIdentityCandidates } from "../../../silver/identityCandidateStream.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { readIdentityRosterFile } from "../../../silver/identityRosterDecode.js";
import { memberDirectory } from "../../../silver/memberDirectory.js";
import { readSlackUsergroups } from "../../../silver/slackUsergroups.js";
import { defineCommand } from "../../defineCommand.js";
import { runIdentityAvatarsWithDeps } from "./identityAvatars.js";
import { runIdentityNarrowWithDeps } from "./identityNarrow.js";
import { runIdentityOrgDomainsWithDeps } from "./identityOrgDomains.js";
import { runIdentityResolveWithDeps } from "./identityResolve.js";
import { runIdentityRosterWithDeps } from "./identityRoster.js";
import type { IdentityDeps } from "./identityShared.js";
import { runIdentityShowWithDeps } from "./identityShow.js";

/** Production dependencies: real roster + corpus reads. */
function productionIdentityDeps(): IdentityDeps {
  return {
    home: slopweaverHome,
    loadMembers: ({ home }) => readAllMembers({ home }),
    loadCandidates: ({ home, corpus }) => {
      const dir = resolveCorpusDir({ home, ...(corpus !== undefined ? { corpus } : {}) });
      if (dir.isErr()) {
        // The owner's protect list refusing the corpus fails the verb: a resolution over everything else would
        // quietly miss a person the corpus names. Any other resolution failure stays the warning it always was.
        if (dir.error.code === "CORPUS_PROTECTED") {
          return { candidates: [], refused: dir.error.message, warnings: [] };
        }
        return { candidates: [], warnings: [dir.error.message] };
      }
      // STREAMED, never `readCorpusDir`: this verb answers one lookup, and the tree it discovers from is
      // 7.9 GB on the owner's own machine — enough that the corpus reader's heap preflight refused it and
      // `identity resolve` returned no answer at all. The stream retains only the deduped candidates, so
      // there is nothing here for a heap ceiling to refuse.
      //
      // An unreadable file is named as a warning rather than swallowed. `identity` resolves people from the
      // records it sees, so a partial read does not fail loudly — it quietly fails to find someone, which
      // looks identical to that person not being in the corpus.
      // A tree the owner's protect list refuses is never opened, and the refusal fails the verb.
      const read = streamIdentityCandidates({ dir: dir.value, home });
      if (read.isErr()) {
        return { candidates: [], refused: read.error.join("; "), warnings: [] };
      }
      return { candidates: read.value.candidates, warnings: read.value.warnings };
    },
    loadDirectory: memberDirectory,
    loadGroups: readSlackUsergroups,
    loadRoster: async ({ home }) => (await identityRosterPort().read({ home })).map((stored) => stored.records),
    logger,
  };
}

/**
 * Run `identity avatars`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runIdentityAvatars(argv: readonly string[]): number {
  return runIdentityAvatarsWithDeps({ argv, deps: productionIdentityDeps() });
}

/**
 * Run `identity org-domains`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runIdentityOrgDomains(argv: readonly string[]): number {
  return runIdentityOrgDomainsWithDeps({ argv, deps: productionIdentityDeps() });
}

/**
 * Run `identity show`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runIdentityShow(argv: readonly string[]): Promise<number> {
  return runIdentityShowWithDeps({ argv, deps: productionIdentityDeps() });
}

/**
 * Run `identity resolve`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runIdentityResolve(argv: readonly string[]): Promise<number> {
  return runIdentityResolveWithDeps({ argv, deps: productionIdentityDeps() });
}

/**
 * Run `identity narrow`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runIdentityNarrow(argv: readonly string[]): number {
  return runIdentityNarrowWithDeps({ argv, deps: productionIdentityDeps() });
}

/**
 * Run `identity roster show|replace` over the store's roster row.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runIdentityRoster(argv: readonly string[]): Promise<number> {
  return runIdentityRosterWithDeps({
    argv,
    deps: {
      home: slopweaverHome,
      logger,
      port: identityRosterPort(),
      readDocument: ({ path }) => readIdentityRosterFile({ operation: "read the replacement identity roster", path }),
    },
  });
}

export const identityShowCommand = defineCommand({ run: runIdentityShow });

export const identityRosterCommand = defineCommand({ run: runIdentityRoster });

export const identityNarrowCommand = defineCommand({ run: runIdentityNarrow });

export const identityResolveCommand = defineCommand({ run: runIdentityResolve });

export const identityOrgDomainsCommand = defineCommand({ run: runIdentityOrgDomains });

export const identityAvatarsCommand = defineCommand({ run: runIdentityAvatars });
