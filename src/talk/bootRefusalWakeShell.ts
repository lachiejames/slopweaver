/**
 * The effectful half of the boot-refusal wake (`../transcripts/bootRefusalWake.ts`): find the oldest open register
 * card the chair has not been woken for, CLAIM it, read the plans register again to learn why it does not read, type
 * the one line through the courier's own typist, and release the claim when the register read or nothing was typed.
 *
 * ## At most once per card, claimed before the keystroke
 *
 * A follower, a `talk courier --once` backstop and an old courier mid re-exec can all run this pass at once
 * (`skills/supervisor/reference/relay-courier.md`), so a record written AFTER the typing would let two of them type it.
 * The claim is one file per card under `$SLOPWEAVER_HOME/talk/boot-refusals/`, created with `O_EXCL` before anything is
 * typed: one creator wins. It is removed only after a delivery that provably typed nothing (`skipped`, `failed` — the
 * owner's own half-typed words in the composer, cmux unreachable), so the next pass tries again; it stays after `typed`,
 * `queued`, `stranded` or `unconfirmed`, because the keystroke may have landed. A process that dies between the claim
 * and the keystroke loses this one wake; the tick's own BOOTS REFUSED line is the backstop for that
 * (`../supervisor/digestBootsRefused.ts`).
 *
 * The claim comes BEFORE the register read, so only one pass reads per card and two passes never act on two reads
 * taken at different moments. The register is read only while a register card is open and unclaimed,
 * never on a healthy pass. A card whose register reads is released, not kept, ON PURPOSE: the store
 * fault's card is keyed by its code alone, so a store that breaks again before the monitor settles the card raises no
 * new card, and a kept claim would leave that second outage silent. The cost is one local store read per follower
 * pass while such a card stands, at most until the next measured `claude-plan-unusable` pass settles it
 * (`../monitor/claudePlanUnusable.ts`, `claudeRegisterFaultKey`).
 *
 * The fresh read opens the store like every spawn and every monitor pass does, so it gets `connectStore`'s guarded
 * catch-up (`../store/client.ts`: local, landed on `origin/main`, additive only) and nothing more. That is no new
 * migration path, and a store it catches up has stopped refusing boots, so typing nothing is right. Every other `behind` store still refuses, and the investigator judges it.
 *
 * **Residue, stated:** the store is outside this process, so it can heal between the read and the keystroke, and the
 * line then arrives a moment late. That is harmless by construction: the line tells the chair to
 * read before it acts (`skills/supervisor/reference/boots-refused.md` step 2), and a spawn on a healed store boots.
 *
 * Never throws and never fails the courier's pass: every outcome is a value the follower prints.
 */
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Result } from "#lib/result.js";

import { readOpenHandSteps } from "../hand/store.js";
import type { PlanRegisterError } from "../plans/errors.js";
import { stateHomePaths } from "../stateHome.js";
import { type BootRefusalCause, bootRefusalWakeLine, nextUnwokenCard } from "../transcripts/bootRefusalWake.js";

import type { Delivery } from "./deliveryOutcome.js";

/** What one pass did about boot refusals. */
export type BootRefusalWakeOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "residue"; readonly cardId: string }
  | { readonly kind: "lost-race"; readonly cardId: string }
  | { readonly kind: "unreadable"; readonly why: string }
  | {
      readonly kind: "woke";
      readonly cardId: string;
      readonly cause: BootRefusalCause;
      readonly delivery: Delivery;
      /** Why a claim on a delivery that typed nothing could not be released, or `undefined` when none was owed or it was. */
      readonly unreleased: string | undefined;
    };

/**
 * Where one card's claim is kept, under the state-home contract's `talk/` directory.
 *
 * @param home the Slopweaver home
 * @param cardId the register card's id, already validated by its grammar
 * @returns the path
 */
export function bootRefusalClaimPath({ home, cardId }: { home: string; cardId: string }): string {
  return join(dirname(stateHomePaths({ home }).talkTurns), "boot-refusals", cardId);
}

/** A caught value in words. */
function describe({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Whether the line may have reached the chat, so typing it again would say it twice. */
function mayHaveLanded({ delivery }: { delivery: Delivery }): boolean {
  return delivery.kind !== "skipped" && delivery.kind !== "failed";
}

/**
 * Why every boot refuses, from a fresh register read: undefined when it reads, which makes the card residue.
 *
 * @param read the register read's result
 * @returns the cause, or undefined when the register read
 */
export function bootRefusalCauseOf({
  read,
}: {
  read: Result<unknown, PlanRegisterError>;
}): BootRefusalCause | undefined {
  if (read.isOk()) {
    return undefined;
  }
  const { error } = read;
  if (error.code === "REGISTER_STORE_UNAVAILABLE" && error.staleStore === true) {
    return "stale-store";
  }
  return "register-unreadable";
}

/**
 * Create one card's claim, exclusively.
 *
 * @returns `claimed`, `taken` when another pass holds it, or the reason it could not be made
 */
function claim({ path }: { path: string }): "claimed" | "taken" | { readonly why: string } {
  try {
    mkdirSync(dirname(path), { recursive: true });
    closeSync(openSync(path, "wx"));
    return "claimed";
  } catch (cause) {
    if (existsSync(path)) {
      return "taken";
    }
    return { why: `${path} could not be created: ${describe({ cause })}` };
  }
}

/**
 * One pass: wake the chair for the oldest open register card nobody has claimed yet.
 *
 * @param deliver types one line into the pinned chair — the courier's `chairDeliverer`
 * @param readRegister reads the plans register afresh — `planRegisterPort().read` from the verb
 * @param home the Slopweaver home the hand register and the claims live under
 * @returns what the pass did
 */
export async function wakeChairForBootRefusal({
  deliver,
  readRegister,
  home,
}: {
  deliver: (options: { line: string }) => Promise<Delivery>;
  readRegister: () => Promise<Result<unknown, PlanRegisterError>>;
  home: string;
}): Promise<BootRefusalWakeOutcome> {
  const register = readOpenHandSteps({ home });
  if (register.isErr()) {
    return { kind: "unreadable", why: `the hand register could not be read: ${register.error.message}` };
  }
  const cardId = nextUnwokenCard({
    claimed: (id) => existsSync(bootRefusalClaimPath({ cardId: id, home })),
    openCardIds: register.value.steps.map((step) => step.id),
  });
  if (cardId === undefined) {
    return { kind: "none" };
  }
  const path = bootRefusalClaimPath({ cardId, home });
  const claimed = claim({ path });
  if (claimed === "taken") {
    return { cardId, kind: "lost-race" };
  }
  if (claimed !== "claimed") {
    return { kind: "unreadable", why: claimed.why };
  }
  // Only the claimer reads, so two passes never act on two different reads of the same card.
  const cause = bootRefusalCauseOf({ read: await readRegister() });
  if (cause === undefined) {
    const unreleased = release({ path });
    return unreleased === undefined ? { cardId, kind: "residue" } : { kind: "unreadable", why: unreleased };
  }
  const delivery = await deliver({ line: bootRefusalWakeLine({ cardId, cause })! });
  const unreleased = mayHaveLanded({ delivery }) ? undefined : release({ path });
  return { cardId, cause, delivery, kind: "woke", unreleased };
}

/**
 * Remove one card's claim, so a later pass may wake for it.
 *
 * @returns why it could not be removed, or undefined when it was
 */
function release({ path }: { path: string }): string | undefined {
  try {
    unlinkSync(path);
    return undefined;
  } catch (failure) {
    return `${path} could not be removed, so this card wakes nobody again: ${describe({ cause: failure })}`;
  }
}

/**
 * The line the courier prints for one pass, or none for a pass with nothing to say.
 *
 * @param outcome what the pass did
 * @returns the line, or undefined when no unclaimed register card is open
 */
export function bootRefusalWakeReportLine({ outcome }: { outcome: BootRefusalWakeOutcome }): string | undefined {
  switch (outcome.kind) {
    case "none":
    case "lost-race":
      return undefined;
    case "residue":
      return `talk courier: ${outcome.cardId} is open, and the plans register reads — no wake typed`;
    case "unreadable":
      return `talk courier: could not tell whether boots are refused — ${outcome.why}`;
    case "woke": {
      const unreleased = outcome.unreleased === undefined ? "" : ` (${outcome.unreleased})`;
      return `talk courier: boots refused on ${outcome.cardId} (${outcome.cause}) — chair wake ${outcome.delivery.kind}: ${outcome.delivery.detail}${unreleased}`;
    }
  }
}
