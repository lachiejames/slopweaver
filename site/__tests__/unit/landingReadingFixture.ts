/*
 * One recorded `github landing` reading over the synthetic Acme admin repository, for the pure tests of the one
 * population the Pull requests page lists and its badge counts, and of the shell's own refresh that keeps it counted.
 */
import type {
  LandingCensusPr,
  LandingReading,
  LandingRepoCensus,
  LandingRow,
  LandingSelection,
} from "../../components/live/readLanding";
import { landingRow } from "./landingRowFixture";

/** The repository every row and census entry here is in; Acme places it in the `work` context. */
export const ACME_ADMIN = "acme/acme-admin";

/** The instant every case is drawn at. */
export const NOW_MS = Date.parse("2026-11-03T21:00:00.000Z");

/** Ten minutes before {@link NOW_MS}: inside the landing cadence. */
export const FRESH_ISO = "2026-11-03T20:50:00.000Z";

/** What the console's own reading is taken over: the owner's, drafts in. */
export const WITH_DRAFTS: LandingSelection = { author: "@me", includeDrafts: true, repos: [ACME_ADMIN] };

/** What the supervisor tick's `--press` reading is taken over: the owner's, drafts out. */
export const WITHOUT_DRAFTS: LandingSelection = { author: "@me", includeDrafts: false, repos: [ACME_ADMIN] };

/**
 * A row of the owner's in the Acme admin repository.
 *
 * @returns the row
 */
export function acmeRow({ number, action = "press" }: { number: number; action?: string }): LandingRow {
  return {
    ...landingRow({ action, number }),
    repoSlug: ACME_ADMIN,
    url: `https://github.com/${ACME_ADMIN}/pull/${String(number)}`,
  };
}

/** An Acme repository in the `work` context that no reading's selection here names, so no census entry carries it. */
export const ACME_WEB = "acme/acme-web";

/**
 * A row of the owner's in {@link ACME_WEB}, a repository the census holds no entry for.
 *
 * @returns the row
 */
export function uncensusedRow({ number }: { number: number }): LandingRow {
  return {
    ...landingRow({ action: "press", number }),
    repoSlug: ACME_WEB,
    url: `https://github.com/${ACME_WEB}/pull/${String(number)}`,
  };
}

/**
 * One open pull request of the owner's on GitHub's own list.
 *
 * @returns the census entry
 */
export function openPr({ number, draft = false }: { number: number; draft?: boolean }): LandingCensusPr {
  return {
    author: "octocat",
    isDraft: draft,
    number,
    title: `pull request ${String(number)}`,
    url: `https://github.com/${ACME_ADMIN}/pull/${String(number)}`,
  };
}

/**
 * GitHub's open list for the Acme admin repository, read at `startedAtIso`.
 *
 * @returns the census
 */
export function acmeCensus({
  prs,
  startedAtIso = FRESH_ISO,
}: {
  prs: readonly LandingCensusPr[];
  startedAtIso?: string;
}): readonly LandingRepoCensus[] {
  return [
    { kind: "read", pullRequests: prs, repo: ACME_ADMIN, startedAtIso, totalCount: prs.length, viewer: "octocat" },
  ];
}

/**
 * A recorded landing reading, its id derived from its instant the way the ledger derives one.
 *
 * @param by who took it: a tick label, or `sync-now` for the console's own
 * @returns the reading
 */
export function landingReading({
  rows,
  census,
  selection,
  by = "tick-11",
  observedAtIso = FRESH_ISO,
}: {
  rows: readonly LandingRow[];
  census: readonly LandingRepoCensus[] | undefined;
  selection: LandingSelection | undefined;
  by?: string;
  observedAtIso?: string;
}): LandingReading {
  return {
    by,
    landing: {
      advisoryRedBypassed: undefined,
      byAction: [],
      census,
      people: new Map(),
      ready: 0,
      residue: [],
      rows,
      selection,
      total: rows.length,
    },
    observedAtIso,
    readingId: `${observedAtIso}-github-landing`,
    recordedAtIso: observedAtIso,
  };
}
