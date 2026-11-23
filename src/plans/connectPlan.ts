/**
 * The decisions a Codex Connect makes about the register, pure: where the sign-in lands before it starts, and what
 * the register gains once it has finished.
 *
 * A plan comes only from the user's own sign-in, never from a Codex login found on the machine, so every Connect signs a fresh store in under
 * `$home/codex-accounts/<alias>` and the register gains a row for it. An install that has adopted nothing is adopted
 * first, as it already reads, so the row has a register to land in.
 */
import { join } from "node:path";

import { stateHomePaths } from "../stateHome.js";

import type { ConnectionFailure } from "./connection.js";
import { removedPlans } from "./removed.js";
import { storeIdentity } from "./structure.js";
import type { PlanMutation, PlanRegisterSnapshot } from "./types.js";
import { NO_USAGE_LIMIT, WEEKLY_WINDOW } from "./usageLimit.js";

/** Where one sign-in lands. */
export interface ConnectDestination {
  readonly alias: string;
  readonly storeDir: string;
}

/** The aliases a Connect names its stores by, and so the only ones a Connect worker may sign into or remove. */
export const CONNECT_ALIAS = /^codex-[1-9][0-9]*$/;

/**
 * The file a Connect writes inside the store it creates, holding its attempt id: what ties a record to the directory
 * that attempt made, since a record alone is a file on disk and proves no reservation.
 */
export const CONNECT_RESERVATION_FILE = ".slopweaver-connect";

/** How many numbered aliases a new store may be offered before the planner gives up. */
const ALIAS_SEARCH_LIMIT = 99;

/**
 * The one store a Connect reserves for an alias. Pure: no I/O.
 *
 * @param home the Slopweaver home the store sits under
 * @returns `$home/codex-accounts/<alias>`
 */
export function connectStoreDir({ alias, home }: { alias: string; home: string }): string {
  return join(stateHomePaths({ home }).codexAccountsDir, alias);
}

/**
 * Where a Codex Connect may sign in, in order of preference.
 *
 * @param snapshot the register as read
 * @param home the Slopweaver home new stores are made under
 * @returns every numbered alias no row and no removed row holds, with its store, first preferred — the caller takes
 *   the first whose directory does not exist yet
 */
export function codexConnectDestinations({
  home,
  snapshot,
}: {
  home: string;
  snapshot: PlanRegisterSnapshot;
}): readonly ConnectDestination[] {
  const removed = removedPlans({ document: snapshot.document });
  const takenAliases = new Set([
    ...snapshot.plans.filter((plan) => plan.provider === "codex").map((plan) => plan.alias),
    ...removed.filter((entry) => entry.provider === "codex").map((entry) => entry.alias),
  ]);
  // The register's own store identity on both sides, so a row spelling the same directory another way (a trailing
  // slash, a `..`) still holds it. Lexical, as the register's twin check is: a symlink is out of its reach too.
  const takenStores = new Set(
    [...snapshot.plans.map((plan) => plan.storeDir), ...removed.map((entry) => entry.storeDir)].map((storeDir) =>
      storeIdentity({ storeDir }),
    ),
  );
  const destinations: ConnectDestination[] = [];
  for (let index = 1; index <= ALIAS_SEARCH_LIMIT; index += 1) {
    const alias = `codex-${String(index)}`;
    const storeDir = connectStoreDir({ alias, home });
    if (!takenAliases.has(alias) && !takenStores.has(storeIdentity({ storeDir }))) {
      destinations.push({ alias, storeDir });
    }
  }
  return destinations;
}

/** What the register gains once a sign-in has finished. */
export type ConnectRegistration =
  | {
      readonly kind: "register";
      /** Adopt the derived register first, so the change has a register to land in. */
      readonly adopt: boolean;
      /** The new row. */
      readonly change: PlanMutation;
    }
  | { readonly kind: "refuse"; readonly failure: ConnectionFailure; readonly detail: string };

/**
 * What to write once a sign-in has finished.
 *
 * @param destination where the sign-in landed
 * @param email the address the account reported, when it reported one
 * @param snapshot the register as read after the sign-in
 * @returns the adopt-and-add to publish, or a refusal when the account is already a connected plan
 */
export function codexConnectRegistration({
  destination,
  email,
  snapshot,
}: {
  destination: ConnectDestination;
  email: string | undefined;
  snapshot: PlanRegisterSnapshot;
}): ConnectRegistration {
  if (email === undefined) {
    // No address means no twin check, and an unchecked row could count one subscription twice as capacity.
    return {
      detail: "Codex finished the sign-in without naming the account, so it was not added",
      failure: "ACCOUNT_UNKNOWN",
      kind: "refuse",
    };
  }
  const twin = snapshot.plans.find(
    (plan) =>
      plan.provider === "codex" &&
      plan.alias !== destination.alias &&
      plan.email !== undefined &&
      plan.email.toLowerCase() === email.toLowerCase(),
  );
  if (twin !== undefined) {
    return {
      detail: `${email} is already connected as ${twin.alias}; a second copy of one account adds no capacity`,
      failure: "DUPLICATE_ACCOUNT",
      kind: "refuse",
    };
  }
  return {
    adopt: snapshot.source === "derived",
    change: {
      kind: "add",
      row: {
        alias: destination.alias,
        allowance: WEEKLY_WINDOW,
        provider: "codex",
        storeDir: destination.storeDir,
        email,
        usageLimitPercent: NO_USAGE_LIMIT,
      },
    },
    kind: "register",
  };
}
