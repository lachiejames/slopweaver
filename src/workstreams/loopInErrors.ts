/**
 * Why a loop-in draft was not parked — its own union, apart from the candidates' (`./candidateErrors.ts`).
 *
 * A union because the kinds are BRANCHED ON: `workstreams loop-in` exits 2 when the call names a candidate or person
 * the candidates do not owe a conversation, and 1 when the candidates will not read or the park itself refused. There
 * is no "no candidates yet" kind: the owner's stated outcomes are always candidates (`./candidateCatalog.ts`).
 */
import type { CandidatesError } from "./candidateErrors.js";

/** The candidates could not be read, so nothing names who is owed a conversation. */
export interface LoopInCandidatesError {
  readonly code: "LOOP_IN_CANDIDATES";
  readonly message: string;
  readonly cause: CandidatesError;
}

/** The candidate or the person is not one the candidates say is owed a conversation. */
export interface LoopInNotOwedError {
  readonly code: "LOOP_IN_NOT_OWED";
  readonly message: string;
  readonly candidate: string;
  readonly person: string;
}

/** Another press is parking the same person on the same candidate. */
export interface LoopInLockedError {
  readonly code: "LOOP_IN_LOCKED";
  readonly message: string;
  readonly holder: string;
}

/** `slack draft record` refused the park; its own lines already said why. */
export interface LoopInParkRefusedError {
  readonly code: "LOOP_IN_PARK_REFUSED";
  readonly message: string;
  readonly exitCode: number;
}

/** The park succeeded but its report did not read, so the draft's id is unknown here. */
export interface LoopInParkReportUnreadableError {
  readonly code: "LOOP_IN_PARK_REPORT_UNREADABLE";
  readonly message: string;
  readonly detail: string;
}

export type LoopInError =
  | LoopInCandidatesError
  | LoopInNotOwedError
  | LoopInLockedError
  | LoopInParkRefusedError
  | LoopInParkReportUnreadableError;

/** The one place every loop-in failure is built. */
export const LoopInErrors = {
  candidates: ({ cause }: { cause: CandidatesError }): LoopInCandidatesError => ({
    cause,
    code: "LOOP_IN_CANDIDATES",
    message: `nothing parked — ${cause.message}`,
  }),
  locked: ({ holder }: { holder: string }): LoopInLockedError => ({
    code: "LOOP_IN_LOCKED",
    holder,
    message: `another press is parking this conversation right now — nothing parked; ${holder}`,
  }),
  notOwed: ({ candidate, person, why }: { candidate: string; person: string; why: string }): LoopInNotOwedError => ({
    candidate,
    code: "LOOP_IN_NOT_OWED",
    message: `nothing parked — ${why}`,
    person,
  }),
  parkRefused: ({ exitCode }: { exitCode: number }): LoopInParkRefusedError => ({
    code: "LOOP_IN_PARK_REFUSED",
    exitCode,
    message: `slack draft record refused the park (exit ${String(exitCode)}), so nothing is on the Queue — its lines above say why`,
  }),
  parkReportUnreadable: ({ detail }: { detail: string }): LoopInParkReportUnreadableError => ({
    code: "LOOP_IN_PARK_REPORT_UNREADABLE",
    detail,
    message: `the draft parked, but its report did not read, so its id is unknown here — check the Queue; ${detail}`,
  }),
} as const;
