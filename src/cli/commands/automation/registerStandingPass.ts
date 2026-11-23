/**
 * One `automation register-standing` pass, the lock already held for a real one: read every registry, compose the
 * declaration, extend the team registry, write what is absent or superseded, and report. The verb's contract and the
 * reasons for it are in `./registerStanding.ts`'s header.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type DeclaredStandingRowsError, standingRowsFor } from "../../../live/automation/declaredStandingRows.js";
import { loadRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { recipeErrorLines } from "../../../live/automation/errors.js";
import {
  type OwnRepositoryDeclaration,
  ownRepositoryDeclaration,
  ownRepositoryStateOf,
  ownRepositoryUnresolvedLine,
} from "../../../live/automation/ownRepository.js";
import { recordOwnRepository } from "../../../live/automation/ownRepositoryStore.js";
import { readAutomationRetirements, retiredRecipeIds } from "../../../live/automation/retirementStore.js";
import {
  BUMP_DRIVE_OWN_RECIPE_ID,
  BUMP_FIX_OWN_RECIPE_ID,
} from "../../../live/automation/standingOwnRepositoryRows.js";
import type { StandingRow } from "../../../live/automation/standingRow.js";
import { absentStandingRows } from "../../../live/automation/standingRowAbsence.js";
import { standingRowLines, writeStandingRows } from "../../../live/automation/standingRowStore.js";
import { supersededStandingRows } from "../../../live/automation/standingRowSupersession.js";
import {
  addTeamRepository,
  readTeamRepositories,
  type TeamRepositoryStoreError,
  writeTeamRepositories,
} from "../../../live/automation/teamRepositoryStore.js";
import type { TeamRepositoryRegistration } from "../../../live/automation/teamStandingRows.js";
import { stateHomePaths } from "../../../stateHome.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/** The resolved invocation. */
export interface RegisterStandingOptions {
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly home: string;
  /** The team repository to register first, canonical; omitted registers nothing new. */
  readonly registration?: TeamRepositoryRegistration;
}

/** The injected edges, so the pass is testable with plain fakes. */
export interface RegisterStandingDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** One declared checkout's own `origin` slug — `originSlugOf`, a git read, in production. */
  readonly originOf: (args: { cwd: string }) => string | undefined;
}

/** What the pass did to the team repository registry. */
type TeamRepositoryOutcome =
  | { readonly kind: "none-requested" }
  | { readonly kind: "registered" | "would-register" | "already-registered"; readonly repository: string };

/**
 * The registry as it stands once the requested registration is added, and what that addition was.
 *
 * @param home the state home whose registry is read
 * @param registration the requested registration, if any
 * @param dryRun whether the outcome is one a write would make
 * @returns every registration the declaration should cover, and the registry outcome, or why it is refused
 */
function plannedRegistry({
  home,
  registration,
  dryRun,
}: {
  readonly home: string;
  readonly registration: TeamRepositoryRegistration | undefined;
  readonly dryRun: boolean;
}): Result<
  { readonly repositories: readonly TeamRepositoryRegistration[]; readonly outcome: TeamRepositoryOutcome },
  TeamRepositoryStoreError
> {
  return readTeamRepositories({ home }).andThen((read) => {
    if (registration === undefined) {
      return ok({ outcome: { kind: "none-requested" } as const, repositories: read.repositories });
    }
    return addTeamRepository({ current: read.repositories, registration }).map((repositories) => {
      const repository = registration.repository;
      if (repositories === read.repositories) {
        return { outcome: { kind: "already-registered", repository } as const, repositories };
      }
      const kind = dryRun ? ("would-register" as const) : ("registered" as const);
      return { outcome: { kind, repository }, repositories };
    });
  });
}

/**
 * One pass, lock already held for a real one.
 *
 * @param deps the injected edges
 * @param options the resolved invocation
 * @returns the process exit code
 */
export function registerPass({
  deps,
  options,
}: {
  readonly deps: RegisterStandingDeps;
  readonly options: RegisterStandingOptions;
}): number {
  const refuse = ({ error }: { readonly error: DeclaredStandingRowsError }): number => {
    deps.writeDiagnostic(`automation register-standing · ${error.message}`);
    return EXIT_ERROR;
  };
  // Resolved and said FIRST, so a registry refusing below cannot swallow the one warning that a stored copy of either
  // row still fires as written.
  const ownRepository = ownRepositoryDeclaration({ home: options.home, originOf: deps.originOf });
  if (ownRepository.isOk()) {
    warnOfUnresolved({ deps, ownRepository: ownRepository.value });
  }
  // Read under the same lock `automation retire` writes under. An unreadable retirement registry refuses the
  // whole pass: read as "nothing retired", it would write every retired row straight back.
  const retirements = readAutomationRetirements({ home: options.home });
  if (retirements.isErr()) {
    return refuse({ error: retirements.error });
  }
  const planned = plannedRegistry({ dryRun: options.dryRun, home: options.home, registration: options.registration });
  if (planned.isErr()) {
    return refuse({ error: planned.error });
  }
  if (ownRepository.isErr()) {
    return refuse({ error: ownRepository.error });
  }
  // Composed BEFORE the registry is written, so a registration whose rows collide with a generic row's id is
  // refused with nothing written rather than leaving a registry every later read refuses.
  const declared = standingRowsFor({
    ownRepository: ownRepository.value,
    retiredIds: retiredRecipeIds({ retirements: retirements.value.retirements }),
    teamRepositories: planned.value.repositories,
  });
  if (declared.isErr()) {
    return refuse({ error: declared.error });
  }
  if (planned.value.outcome.kind === "registered") {
    const registered = writeTeamRepositories({ home: options.home, repositories: planned.value.repositories });
    if (registered.isErr()) {
      return refuse({ error: registered.error });
    }
  }
  return writeDeclared({
    declared: declared.value.rows,
    deps,
    options,
    ownRepository: ownRepository.value,
    teamRepository: planned.value.outcome,
  });
}

/** Say that neither own-repository row is declared and a stored copy still fires, when that is so. */
function warnOfUnresolved({
  deps,
  ownRepository,
}: {
  readonly deps: RegisterStandingDeps;
  readonly ownRepository: OwnRepositoryDeclaration;
}): void {
  const state = ownRepositoryStateOf({ ownRepository });
  if (state.kind === "unresolved") {
    deps.writeDiagnostic(`automation register-standing · ${ownRepositoryUnresolvedLine({ state })}`);
  }
}

/**
 * Record the address when this pass writes one of the two rows, since a recorded address is what later lets a pass
 * overwrite a row on it: one it merely found there is somebody's, and a later move reads it as REPOSITORY DRIFT.
 * BEFORE the write, so a pass dying between the two leaves an address the next one still recognises. So a record
 * says a pass MEANT to write there, not that it did: a write refused on an occupied path leaves the record standing, and
 * an exact row placed by hand on that address later reads as the pass's. Closing that takes a record per written row.
 */
function recordOwnAddress({
  home,
  ownRepository,
  writtenIds,
}: {
  readonly home: string;
  readonly ownRepository: OwnRepositoryDeclaration;
  readonly writtenIds: readonly string[];
}): Result<void, string> {
  const writesOwnRow = writtenIds.some((id) => id === BUMP_DRIVE_OWN_RECIPE_ID || id === BUMP_FIX_OWN_RECIPE_ID);
  if (ownRepository.kind !== "resolved" || !writesOwnRow) {
    return ok(undefined);
  }
  const recorded = recordOwnRepository({ home, repository: ownRepository.repository });
  return recorded.isErr() ? err(recorded.error.message) : ok(undefined);
}

/** Compare the declared rows against the store, write what is missing, and report. */
function writeDeclared({
  declared,
  deps,
  options,
  ownRepository,
  teamRepository,
}: {
  readonly declared: readonly StandingRow[];
  readonly deps: RegisterStandingDeps;
  readonly options: RegisterStandingOptions;
  readonly ownRepository: OwnRepositoryDeclaration;
  readonly teamRepository: TeamRepositoryOutcome;
}): number {
  const paths = stateHomePaths({ home: options.home }).live.recipe;
  // Asked AGAIN right before the write: the lock is a lease another writer may take over from a pass paused past
  // its staleness, and a retirement landing after that takeover is absent from the declaration read at the top.
  const retirementsNow = readAutomationRetirements({ home: options.home });
  if (retirementsNow.isErr()) {
    deps.writeDiagnostic(`automation register-standing · ${retirementsNow.error.message} — nothing written`);
    return EXIT_ERROR;
  }
  const retiredNow = retiredRecipeIds({ retirements: retirementsNow.value.retirements });
  const live = declared.filter((row) => !retiredNow.has(row.definition.recipeId));
  const store = loadRecipeDefinitions({ board: null, directory: paths.definitionsDir });
  const absent = absentStandingRows({
    declared: live,
    existing: store.definitions,
    unreadable: store.rejected.map((rejection) => rejection.file.replace(/\.json$/u, "")),
  });
  const superseded = supersededStandingRows({
    declared: live,
    existing: store.definitions,
    files: store.definitionFiles,
  });
  const absentIds = absent.map((row) => row.recipeId);
  const supersededIds = superseded.filter((row) => row.ambiguousFiles.length === 0).map((row) => row.recipeId);
  if (!options.dryRun) {
    const recorded = recordOwnAddress({
      home: options.home,
      ownRepository,
      writtenIds: [...absentIds, ...supersededIds],
    });
    if (recorded.isErr()) {
      deps.writeDiagnostic(`automation register-standing · ${recorded.error} — nothing written`);
      return EXIT_ERROR;
    }
  }
  const written = writeStandingRows({
    absentIds,
    ambiguousIds: superseded.filter((row) => row.ambiguousFiles.length > 0).map((row) => row.recipeId),
    definitionsDir: paths.definitionsDir,
    dryRun: options.dryRun,
    rows: live,
    supersededIds,
  });
  return reportWritten({ deps, options, ownRepository, teamRepository, written });
}

/** The registry outcome as the one line a reader sees, or nothing when no registration was asked for. */
function teamRepositoryLines({ outcome }: { readonly outcome: TeamRepositoryOutcome }): readonly string[] {
  if (outcome.kind === "none-requested") {
    return [];
  }
  const verb = outcome.kind.replace("-", " ");
  return [`automation register-standing · ${verb} team repository ${outcome.repository}`];
}

/**
 * Report one pass's outcome and answer its exit code. An unresolved own repository is non-zero though every other row
 * was written: the pass left two declared rows undeclared, and exiting clean would be the tick lying about its coverage.
 */
function reportWritten({
  deps,
  options,
  ownRepository,
  teamRepository,
  written,
}: {
  deps: RegisterStandingDeps;
  options: RegisterStandingOptions;
  ownRepository: OwnRepositoryDeclaration;
  teamRepository: TeamRepositoryOutcome;
  written: ReturnType<typeof writeStandingRows>;
}): number {
  if (written.isErr()) {
    recipeErrorLines({ error: written.error }).forEach((line) => {
      deps.writeDiagnostic(`automation register-standing · ${line}`);
    });
    return EXIT_ERROR;
  }
  const report = written.value;
  const ownRepositoryState = ownRepositoryStateOf({ ownRepository });
  if (options.json) {
    deps.writeOut(
      safeJsonStringify({
        label: "automation register-standing",
        value: { ownRepository: ownRepositoryState, standingRows: report, teamRepository },
      }),
    );
  } else {
    [...teamRepositoryLines({ outcome: teamRepository }), ...standingRowLines({ report })].forEach((line) => {
      deps.writeOut(line);
    });
  }
  const unsatisfied = report.outcomes.filter((outcome) => outcome.kind === "refused");
  return unsatisfied.length > 0 || ownRepositoryState.kind === "unresolved" ? EXIT_ERROR : EXIT_OK;
}
