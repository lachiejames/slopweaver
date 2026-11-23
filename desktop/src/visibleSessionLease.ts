/**
 * The visible lease: the one value a session's worker can be started with, minted only once that session's card is
 * on the owner's screen with its Stop control (AGENTS.md rule 2 — a model runs only in a session the owner can see and
 * interrupt AS IT RUNS). Pure: the card's window is read through the two questions asked of it, so the rule is
 * testable without Electron.
 *
 * The lease's class is what makes this a mechanism rather than a convention: `sessionWorkerLaunch.ts` takes a lease
 * and nothing else, the class is not exported, and {@link mintVisibleLease} is the only constructor — so a worker
 * launch with no card behind it does not compile, and one forged past the compiler is refused when it is spent. The `no-headless` gate recognises the launch by its call shape,
 * `spawn(process.execPath, visibleWorkerArgv({ lease }),`, so a launch built any other way fails lint.
 *
 * What it does not close, stated: the {@link LeaseWindow} is the caller's word for the card. Code in this process that
 * hands {@link mintVisibleLease} a plain object answering "visible" mints a real lease with no window behind it. The
 * one caller passes `openSessionCard`'s own reading of the BrowserWindow; minting inside `sessionWindow.ts`, from the
 * window object itself, is the mechanism that would close it.
 */
import { err, ok, type Result } from "neverthrow";

import type { WorkerLaunchConfig } from "./sessionWorker/workerWire";

/**
 * The lease itself. The class is not exported, so {@link mintVisibleLease} is its only constructor, and its private
 * field does both halves of the job: it makes the type nominal, so a hand-built object does not compile as a lease,
 * and it cannot be forged at run time, so a cast or plain JavaScript building the same shape is still refused.
 */
class Lease {
  /** Set once a launch has used this lease: one worker per lease. */
  #spent = false;

  readonly workerEntry: string;
  readonly config: WorkerLaunchConfig;

  constructor({ workerEntry, config }: { workerEntry: string; config: WorkerLaunchConfig }) {
    this.workerEntry = workerEntry;
    this.config = Object.freeze({ ...config });
    Object.freeze(this);
  }

  /**
   * Spend a lease, refusing anything this class never built and any lease already spent.
   *
   * @param lease what a launch was handed as its lease
   * @returns the worker's entry script
   */
  static spend({ lease }: { lease: object }): string {
    if (!(#spent in lease) || lease.#spent) {
      throw new Error("refused a worker launch: its lease was never minted from a visible card, or was already spent");
    }
    lease.#spent = true;
    return lease.workerEntry;
  }
}

/** Proof that a session's card was visible, and loaded, at the moment its worker was cleared to start. */
export type VisibleSessionLease = Lease;

/** What the lease asks of the card's window, and nothing more. */
export interface LeaseWindow {
  /** The session this card window was opened for — set where it was opened, never by the caller minting. */
  readonly sessionId: string;
  readonly isVisible: () => boolean;
  readonly isLoading: () => boolean;
  readonly isDestroyed: () => boolean;
  /** The URL the card's window shows; it must be the card of THIS session. */
  readonly shownUrl: () => string;
}

/**
 * Mint the lease, or say which condition the card failed.
 *
 * @param window the card's window
 * @param cardUrl the URL the card for this session was loaded as
 * @param workerEntry the worker's entry script
 * @param config what the worker opens
 * @returns the lease, or the line saying why the worker may not start
 */
export function mintVisibleLease({
  window,
  cardUrl,
  workerEntry,
  config,
}: {
  window: LeaseWindow;
  cardUrl: string;
  workerEntry: string;
  config: WorkerLaunchConfig;
}): Result<VisibleSessionLease, string> {
  if (window.sessionId !== config.sessionId) {
    return err(`the card on screen is session ${window.sessionId}'s, not ${config.sessionId}'s`);
  }
  if (window.isDestroyed()) {
    return err("the session's card was closed before its worker could start");
  }
  if (!window.isVisible()) {
    return err("the session's card is not on screen, so its worker may not start");
  }
  if (window.isLoading() || window.shownUrl() !== cardUrl) {
    return err("the session's card has not finished loading, so its Stop control is not shown yet");
  }
  return ok(new Lease({ config, workerEntry }));
}

/**
 * The worker's argv after the executable — and the one place a lease is SPENT, since every worker launch builds its
 * argv here (the `no-headless` gate pins that call shape). A lease this module never minted, or one already spent,
 * throws: either is a launch with no visible card behind it, an invariant broken, never a case to carry on from.
 *
 * @param lease the visible lease
 * @returns the worker's entry script, alone
 */
export function visibleWorkerArgv({ lease }: { lease: VisibleSessionLease }): readonly string[] {
  return [Lease.spend({ lease })];
}
