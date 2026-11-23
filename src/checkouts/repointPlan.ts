/**
 * `github repoint-plan`'s decision: from what was read on this machine, every local place that names a repository
 * and what the re-cut switch changes it to. Pure — `./repointReaders.ts` gathers the facts, and nothing here writes.
 *
 * The switch moves the OLD history to `<owner>/<archive-name>` and puts a fresh history at `<owner>/<name>`. So
 * the plan splits every place into one of two destinations, and that split is the whole design:
 *   - **archive** — the old main checkout and every worktree of it hold commits of the old history. Their remote
 *     moves to the archive's name; moving one to the fresh repository is exactly the push the old-history guard
 *     (`src/admit/pushRootGate.ts`) exists to stop. Worktrees share their checkout's git config, so there is one
 *     remote action per config key, and every worktree is an observation rather than an action
 *     (`./repointCheckouts.ts`).
 *   - **fresh** — what selects the checkout new work starts from: the profile's declared main checkout (and so every
 *     future cmux spawn path, which derives from it), the desktop app's checkout, a Codex marketplace source inside
 *     the old checkout, and a launch agent's path into it. These move to `--new-checkout` (`./repointFresh.ts`).
 *   - **historical-link** — a state-home link to a numbered pull request, issue or commit (`./repointLinks.ts`).
 *
 * Every write-shaped action carries the sha-256 of the whole file it was planned against, and a remote action the
 * exact URL it expects, so a later apply step can refuse a file that changed since. Without `--new-checkout`, or
 * with anything unread, the plan is `complete: false`: still a useful inventory, never one an apply step may run.
 * The vocabulary it decides in is `./repointModel.ts`.
 */
import { sameGithubRepository } from "#lib/githubRemote.js";
import { err, ok, type Result } from "#lib/result.js";

import { checkoutPart, freshCheckoutProblems } from "./repointCheckouts.js";
import { freshPart } from "./repointFresh.js";
import {
  mergeRepointParts,
  type RepointAction,
  type RepointObservation,
  type RepointPart,
  type RepointUnresolved,
  type RepositoryRepointFacts,
  type RepositoryRepointRequest,
} from "./repointModel.js";

/** The whole dry-run plan, `--json`'s one document. */
export interface RepositoryRepointPlan {
  readonly schemaVersion: 1;
  readonly generatedAtIso: string;
  readonly repository: string;
  readonly archiveRepository: string;
  readonly oldCheckouts: readonly string[];
  readonly newCheckout: string | null;
  readonly pushRoot: string | null;
  readonly complete: boolean;
  readonly actions: readonly RepointAction[];
  readonly unresolved: readonly RepointUnresolved[];
  readonly observations: readonly RepointObservation[];
  /** What "every local place" does not reach, said rather than implied. */
  readonly scope: string;
}

/** Why no plan could be made at all. */
export interface RepointPlanError {
  readonly code: "REPOINT_REQUEST_INVALID";
  readonly message: string;
}

const SCOPE =
  "declared main checkouts and their worktrees, the profile, the desktop app's state, the personal Codex " +
  "marketplace, launch agents and launch daemons, and the state home's authored files. Not scanned: shell " +
  "history, editor and browser state, provider-derived corpora, credentials, and running processes' environment";

/** The repository's owner, or why the request names no plannable repository and archive name. */
function requestOwner({ request }: { request: RepositoryRepointRequest }): Result<string, RepointPlanError> {
  const [owner, name] = request.repository.split("/");
  if (owner === undefined || name === undefined || !/^[A-Za-z0-9._-]+$/.test(request.archiveName)) {
    return err({
      code: "REPOINT_REQUEST_INVALID",
      message: `--archive-name ${request.archiveName} is not a repository name (letters, digits, '.', '_' or '-')`,
    });
  }
  if (sameGithubRepository({ left: request.archiveName, right: name })) {
    return err({
      code: "REPOINT_REQUEST_INVALID",
      message: `--archive-name ${request.archiveName} is the repository's own name; the archive needs a new one`,
    });
  }
  return ok(owner);
}

/** The fresh checkout when it is fit for the switch, else `null` and every reason it is not. */
function resolveNewCheckout({
  facts,
  repository,
  oldCheckouts,
}: {
  facts: RepositoryRepointFacts;
  repository: string;
  oldCheckouts: readonly string[];
}): { readonly newCheckout: string | null; readonly unresolved: readonly RepointUnresolved[] } {
  const fresh = facts.newCheckout;
  if (fresh.kind === "not-given") {
    return {
      newCheckout: null,
      unresolved: [
        {
          locator: "--new-checkout",
          reason: "the fresh clone is not named, so nothing that moves to it can be planned",
          surface: "fresh-checkout",
        },
      ],
    };
  }
  if (fresh.kind === "unreadable") {
    return { newCheckout: null, unresolved: [{ locator: fresh.path, reason: fresh.why, surface: "fresh-checkout" }] };
  }
  const problems = freshCheckoutProblems({ facts, oldCheckouts, repository });
  return {
    newCheckout: problems.length === 0 ? fresh.path : null,
    unresolved: problems.map((reason) => ({ locator: fresh.path, reason, surface: "fresh-checkout" })),
  };
}

/** What follows the switch without a file to change: future spawns, and each running session's plugin directory. */
function processObservations({
  newCheckout,
  oldCheckouts,
}: {
  newCheckout: string | null;
  oldCheckouts: readonly string[];
}): readonly RepointObservation[] {
  const spawn: RepointObservation[] =
    newCheckout === null
      ? []
      : [
          {
            detail:
              "every future cmux spawn and worktree derives from the profile's main checkout, so it follows the profile action",
            disposition: "fresh",
            locator: newCheckout,
            surface: "cmux-spawn",
          },
        ];
  return [
    ...spawn,
    ...oldCheckouts.map((old): RepointObservation => ({
      detail:
        "a running Claude or Codex session keeps the plugin directory it started with (its own worktree); no file " +
        "repoints it, so reseat it after the switch",
      disposition: "running-process",
      locator: old,
      surface: "plugin-directory",
    })),
  ];
}

/** The state home's historical links: one rewrite per file, the non-text count disclosed, the residue unresolved. */
function linkPart({ facts }: { facts: RepositoryRepointFacts }): RepointPart {
  const observations: RepointObservation[] = [];
  if (facts.nonTextFilesWithoutLinks > 0) {
    observations.push({
      detail: `${String(facts.nonTextFilesWithoutLinks)} file(s) that are not text, whose bytes name no link to rewrite`,
      disposition: "unchanged",
      locator: "state home",
      surface: "state-home-links",
    });
  }
  return {
    actions: facts.links.map((file): RepointAction => ({
      expectedSha256: file.sha256,
      kind: "text-replacements",
      path: file.path,
      replacements: file.replacements,
      role: "historical-link",
    })),
    observations,
    unresolved: facts.linkResidue.map((residue) => ({
      locator: residue.locator,
      reason: residue.why,
      surface: "state-home-links",
    })),
  };
}

/**
 * Plan the switch from what was read.
 *
 * @param request the repository, the archive's name and the fresh checkout, when given
 * @param facts everything `./repointReaders.ts` read
 * @returns the plan, or why the request itself cannot be planned
 */
export function planRepositoryRepoint({
  request,
  facts,
}: {
  request: RepositoryRepointRequest;
  facts: RepositoryRepointFacts;
}): Result<RepositoryRepointPlan, RepointPlanError> {
  const owner = requestOwner({ request });
  if (owner.isErr()) {
    return err(owner.error);
  }
  const checkouts = checkoutPart({
    archiveName: request.archiveName,
    checkouts: facts.checkouts,
    repository: request.repository,
  });
  const noOldCheckout: RepointUnresolved[] =
    checkouts.oldCheckouts.length === 0
      ? [
          {
            locator: request.repository,
            reason: "no declared main checkout's remote names the repository, so there is no old checkout to archive",
            surface: "main-checkout",
          },
        ]
      : [];
  const resolved = resolveNewCheckout({
    facts,
    oldCheckouts: [...checkouts.oldCheckouts, ...checkouts.oldToplevels],
    repository: request.repository,
  });
  const newCheckout = resolved.newCheckout;
  const merged = mergeRepointParts({
    parts: [
      checkouts,
      { unresolved: [...noOldCheckout, ...resolved.unresolved] },
      { observations: processObservations({ newCheckout, oldCheckouts: checkouts.oldCheckouts }) },
      freshPart({ facts, newCheckout, oldCheckouts: checkouts.oldCheckouts }),
      linkPart({ facts }),
    ],
  });
  return ok({
    actions: merged.actions,
    archiveRepository: `${owner.value}/${request.archiveName}`,
    complete: newCheckout !== null && merged.unresolved.length === 0,
    generatedAtIso: facts.generatedAtIso,
    newCheckout,
    observations: merged.observations,
    oldCheckouts: checkouts.oldCheckouts,
    pushRoot: facts.pushRoot,
    repository: request.repository,
    schemaVersion: 1,
    scope: SCOPE,
    unresolved: merged.unresolved,
  });
}
