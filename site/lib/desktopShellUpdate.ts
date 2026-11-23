/**
 * The update half of the desktop shell's wire (`./desktopShell.ts`): the offer, the outcome and the standing the app
 * tells the console window, and the shell's refusal codes. Pure.
 */
import { isRecord } from "./desktopShellWire";

/** The sidebar's offer, as the menu bar is told it: the button's words, and whether a press does anything now. */
export interface UpdateOfferWire {
  readonly label: string;
  readonly enabled: boolean;
}

/** What one update came to, as the app read it back from `slopweaver desktop update`'s record. */
export type UpdateOutcomeWire =
  | {
      readonly kind: "updated";
      readonly finishedIso: string;
      readonly sha: string;
      readonly logPath: string | undefined;
    }
  | {
      readonly kind: "failed";
      readonly finishedIso: string;
      readonly code: string;
      readonly message: string;
      readonly rolledBack: boolean;
      readonly logPath: string | undefined;
    };

/** The update's standing, as the app tells the console window. */
export interface UpdateState {
  readonly running: boolean;
  readonly outcome: UpdateOutcomeWire | undefined;
}

/** The update half of the bridge, present whole or not at all — bar the swap's deadline, which an older shell lacks. */
export interface UpdateBridge {
  readonly endCallForUpdate: () => Promise<unknown>;
  readonly startUpdate: () => Promise<unknown>;
  readonly relaunchForUpdate: () => void;
  readonly reloadForUpdate: () => void;
  /** Hand the swap's deadline to the shell, which outlives this page. */
  readonly beginSwapForUpdate?: () => void;
  readonly publishUpdateOffer: (input: { readonly offer: UpdateOfferWire | null }) => void;
  readonly updateState: () => Promise<unknown>;
  readonly onUpdateState: (listener: (state: unknown) => void) => () => void;
  readonly onUpdateRun: (listener: (value: unknown) => void) => () => void;
  readonly onUpdateCheck: (listener: (value: unknown) => void) => () => void;
}

/**
 * One outcome off the wire, exactly.
 *
 * @param value what the shell sent
 * @returns the outcome, or `undefined` when it is not one
 */
function updateOutcomeOf({ value }: { value: unknown }): UpdateOutcomeWire | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { kind, finishedIso, logPath } = value;
  if (typeof finishedIso !== "string" || Number.isNaN(Date.parse(finishedIso))) {
    return undefined;
  }
  if (logPath !== undefined && typeof logPath !== "string") {
    return undefined;
  }
  if (kind === "updated") {
    const { sha } = value;
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/u.test(sha)) {
      return undefined;
    }
    return { finishedIso, kind, logPath, sha };
  }
  if (kind !== "failed") {
    return undefined;
  }
  const { code, message, rolledBack } = value;
  if (typeof code !== "string" || typeof message !== "string" || typeof rolledBack !== "boolean") {
    return undefined;
  }
  return { code, finishedIso, kind, logPath, message, rolledBack };
}

/**
 * The update's standing off the wire: exactly `{ running, outcome }`, the outcome `null` before any.
 *
 * @param value what the shell sent
 * @returns the standing, or `undefined` when it is not one
 */
export function updateStateOf({ value }: { value: unknown }): UpdateState | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value["running"] !== "boolean") {
    return undefined;
  }
  const raw = value["outcome"];
  if (raw === null) {
    return { outcome: undefined, running: value["running"] };
  }
  const outcome = updateOutcomeOf({ value: raw });
  if (outcome === undefined) {
    return undefined;
  }
  return { outcome, running: value["running"] };
}

/**
 * Why the shell could not end a call or launch an update, from its answer: `null` is done.
 *
 * @param value what the shell answered
 * @returns `undefined` when it went ahead, else the refusal's code (`UNKNOWN` for an answer that is not one)
 */
export function updateRefusalOf({ value }: { value: unknown }): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (typeof value === "string" && /^[A-Z_]{1,64}$/u.test(value)) {
    return value;
  }
  return "UNKNOWN";
}
