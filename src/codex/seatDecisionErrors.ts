/**
 * Why a Codex account will not take a seat — the three failures `decideCodexSeat` (`./seatDecision.ts`)
 * distinguishes. Three kinds, not one string, because they are three different facts a caller acts on
 * differently: a register that would not decode is a store fault, a ranking that names no destination is the
 * fleet having nowhere to boot, and a routed account refused by the usage policy or the cap cache is a choice the
 * owner's own thresholds made. `cmux spawn --driver codex`, the chair's hand-off
 * (`../cli/commands/supervisor/chairSuccessorReads.ts`) and `talk offer` all read the same decision.
 */

import type { CodexSeatRouteError } from "../cmux/seatRouteErrors.js";

/** The plan register, or a destination's own evidence, could not be read. */
export interface CodexSeatRegisterUnreadableError {
  readonly code: "REGISTER_UNREADABLE";
  readonly message: string;
}

/** Ranking named no destination the seat may boot against. */
export interface CodexSeatUnroutedError {
  readonly code: "UNROUTED";
  readonly message: string;
  /** The router's own typed reason, so a caller branches on `NO_CODEX_DESTINATION` rather than a message. */
  readonly route: CodexSeatRouteError;
}

/** The routed account may not be spent: absent from the read, or refused by the usage policy or the cap cache. */
export interface CodexSeatRefusedError {
  readonly code: "SEAT_REFUSED";
  readonly message: string;
}

/** Why a Codex seat will not open. */
export type CodexSeatError = CodexSeatRegisterUnreadableError | CodexSeatRefusedError | CodexSeatUnroutedError;

/** Factories for {@link CodexSeatError}, each message the line `cmux spawn` prints after its `cmux spawn: ` prefix. */
export const CodexSeatErrors = {
  registerUnreadable: ({ detail }: { detail: string }): CodexSeatRegisterUnreadableError => ({
    code: "REGISTER_UNREADABLE",
    message: `the plan register could not be read — ${detail}`,
  }),
  seatRefused: ({ refusal }: { refusal: string }): CodexSeatRefusedError => ({
    code: "SEAT_REFUSED",
    message: `refusing — ${refusal}`,
  }),
  unrouted: ({ route }: { route: CodexSeatRouteError }): CodexSeatUnroutedError => ({
    code: "UNROUTED",
    message: `refusing — ${route.message}`,
    route,
  }),
} as const;
