/**
 * The effectful shell for `slopweaver linear query`: resolve the owner, scan local bronze, then verify the
 * page it cites against live Linear.
 *
 * The ORDER is the design. Local first, always, because the corpus holds every facet and costs no quota;
 * live last, over the page only, because the one thing the corpus cannot know is what changed after its last
 * refresh. Neither leg is optional in the sense that matters: a run with no credential still answers, and
 * says in words that its citations are unverified.
 */
import { linearToken } from "../../../config.js";
import { type LinearQueryFilter, type LinearQueryHit, rankLinearMatches } from "../../../corpus/linear/query.js";
import { type LinearQueryError, LinearQueryErrors } from "../../../corpus/linear/queryErrors.js";
import { type LinearScanResult, linearBronzeDir, scanLinearBronze } from "../../../corpus/linear/queryScan.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { LinearLiveError } from "../../../live/linear/errors.js";
import { verifyLinearHits } from "../../../live/linear/verify.js";
import type { LinearVerifyDocument } from "../../../live/linear/verifyDocument.js";
import { linearVerifyRequest } from "../../../live/linear/verifyRequest.js";
import { readProfile } from "../../../profileStore.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { linearQueryUsage, OWNER_ASSIGNEE_TOKEN, parseLinearQueryArgs, resolveOwnerLinearHandle } from "./queryCore.js";
import {
  type LinearQueryDocument,
  type LinearVerifySkipReason,
  renderLinearQueryJson,
  renderLinearQueryText,
} from "./queryDocument.js";

const VERB_ARG_OFFSET = 4;

/** Injectable command edges. Plain fakes exercise the shell without a corpus, the Linear SDK or a credential. */
export interface LinearQueryDeps {
  /** Resolve the owner's own Linear handle for `--assignee me`. */
  readonly ownerHandle: (args: { home: string | undefined }) => Promise<Result<string, LinearQueryError>>;
  /** Scan the local Linear bronze for every record matching the filter. */
  readonly scan: (args: {
    home: string | undefined;
    corpus: string | undefined;
    filter: LinearQueryFilter;
  }) => Result<LinearScanResult, LinearQueryError>;
  /** Verify one page of citations live, or report that no credential is configured. */
  readonly verify: (args: {
    home: string | undefined;
    hits: readonly LinearQueryHit[];
  }) => Promise<Result<LinearVerifyDocument, LinearLiveError> | { readonly skipped: LinearVerifySkipReason }>;
  readonly nowIso: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Whether a verify edge answered "no credential" rather than a result. Pure. */
function isSkip(value: unknown): value is { readonly skipped: LinearVerifySkipReason } {
  return typeof value === "object" && value !== null && "skipped" in value;
}

/** What the verification step settled: a document, or the stated reason there is none. */
interface VerifyOutcome {
  readonly verification?: LinearVerifyDocument;
  readonly verifySkipped?: LinearVerifySkipReason;
}

/**
 * Run the live leg, or state why it did not run.
 *
 * @param deps the injected verify seam
 * @param verify whether the caller asked for verification at all
 * @param hits the page of citations
 * @param home the state home the credential is resolved from
 * @returns the verification or the stated skip, or the provider failure
 */
async function verificationStep({
  deps,
  verify,
  hits,
  home,
}: {
  deps: LinearQueryDeps;
  verify: boolean;
  hits: readonly LinearQueryHit[];
  home: string | undefined;
}): Promise<Result<VerifyOutcome, LinearLiveError>> {
  if (!verify) {
    return ok({ verifySkipped: "not-requested" });
  }
  if (hits.length === 0) {
    return ok({ verifySkipped: "no-hits" });
  }
  const outcome = await deps.verify({ hits, home });
  if (isSkip(outcome)) {
    return ok({ verifySkipped: outcome.skipped });
  }
  return outcome.isErr() ? err(outcome.error) : ok({ verification: outcome.value });
}

/**
 * Resolve `--assignee me` to the owner's own handle, leaving every other filter untouched.
 *
 * @param deps the injected owner seam
 * @param filter the parsed filter
 * @param home the state home the roster is read from
 * @returns the filter with a real handle in place of the token, or the refusal
 */
async function resolveAssignee({
  deps,
  filter,
  home,
}: {
  deps: LinearQueryDeps;
  filter: LinearQueryFilter;
  home: string | undefined;
}): Promise<Result<LinearQueryFilter, LinearQueryError>> {
  if (filter.assignee !== OWNER_ASSIGNEE_TOKEN) {
    return ok(filter);
  }
  const handle = await deps.ownerHandle({ home });
  return handle.map((assignee) => ({ ...filter, assignee }));
}

/**
 * Run `linear query` against injected edges.
 *
 * @param rest argv after `linear query`
 * @param deps the owner, scan, verify and output seams
 * @returns the process exit code
 */
export async function runLinearQuery({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: LinearQueryDeps;
}): Promise<number> {
  const parsed = parseLinearQueryArgs({ nowMs: Date.parse(deps.nowIso()), rest });
  if (parsed.isErr()) {
    deps.writeDiagnostic(parsed.error.message);
    deps.writeDiagnostic(linearQueryUsage());
    return EXIT_USAGE;
  }
  const { filter, home, corpus, limit, verify, json } = parsed.value;
  const resolved = await resolveAssignee({ deps, filter, home });
  if (resolved.isErr()) {
    deps.writeDiagnostic(resolved.error.message);
    return EXIT_ERROR;
  }
  const scanned = deps.scan({ corpus, filter: resolved.value, home });
  if (scanned.isErr()) {
    deps.writeDiagnostic(scanned.error.message);
    return EXIT_ERROR;
  }
  // A path the protect list kept out of the walk is said, never silently absent from the count.
  for (const line of scanned.value.warnings) {
    deps.writeDiagnostic(line);
  }
  const ranked = rankLinearMatches({ kind: resolved.value.kind, limit, records: scanned.value.records });
  const verified = await verificationStep({ deps, hits: ranked.hits, home, verify });
  if (verified.isErr()) {
    deps.writeDiagnostic(verified.error.message);
    return EXIT_ERROR;
  }
  const document: LinearQueryDocument = {
    filter: resolved.value,
    hits: ranked.hits,
    matched: ranked.matched,
    newestLocalIso: ranked.hits[0]?.tsIso,
    readAtIso: deps.nowIso(),
    rowsScanned: scanned.value.rowsScanned,
    source: "linear",
    unreadable: scanned.value.unreadable,
    ...verified.value,
  };
  deps.writeOut(json ? renderLinearQueryJson({ document }) : renderLinearQueryText({ document }));
  return EXIT_OK;
}

/**
 * Production edges: the corpus under the resolved state home, the store's identity roster, and the paced
 * Linear transport for the verification leg only.
 *
 * @returns the real owner, scan, verify and output seams
 */
export function productionLinearQueryDeps(): LinearQueryDeps {
  return {
    nowIso: () => new Date().toISOString(),
    ownerHandle: async ({ home }) => {
      const resolvedHome = resolveHome({ named: home });
      const profile = readProfile({ home: resolvedHome });
      // A corrupt `profile.json` names itself: reading it as absent would tell the reader there is no file.
      if (profile.isErr()) {
        return err(LinearQueryErrors.profileUnreadable({ message: profile.error.message, path: profile.error.path }));
      }
      // No `profile.json` at all is the same refusal as one naming nobody, and it names the file so the
      // reader knows which of the two they are looking at rather than being handed a blank id.
      if (profile.value === null) {
        return err(LinearQueryErrors.ownerUnresolved({ profileId: "(no profile.json in this home)" }));
      }
      // The store roster is the authority; an outage refuses rather than answering from nobody.
      const roster = await identityRosterPort().read({ home: resolvedHome });
      if (roster.isErr()) {
        return err(LinearQueryErrors.rosterUnreadable({ message: roster.error.message }));
      }
      return resolveOwnerLinearHandle({
        ownerSlackUserId: profile.value.slackBot?.ownerUserId,
        profileId: profile.value.id,
        roster: roster.value.records,
      });
    },
    scan: ({ home, corpus, filter }) =>
      scanLinearBronze({ dir: linearBronzeDir({ corpus, home }), filter, home: resolveHome({ named: home }) }),
    verify: async ({ home, hits }) => {
      const token = linearToken(home === undefined ? {} : { home });
      if (token === undefined) {
        return { skipped: "no-token" };
      }
      return verifyLinearHits({
        hits,
        nowIso: () => new Date().toISOString(),
        request: linearVerifyRequest({ token }),
      });
    },
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver linear query`. */
export const linearQueryCommand = defineCommand({
  run: (argv) => runLinearQuery({ deps: productionLinearQueryDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
