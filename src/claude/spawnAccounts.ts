/**
 * Read the Claude destinations this install can seat a session on, from the ONE register that holds them.
 *
 * ## The register is the source; this module is its Claude-shaped reader
 *
 * The store's `plan_register` row carries both providers' rows, and `src/plans/projection.ts` narrows it to
 * the bare Claude array `parseClaudeAccounts` has always parsed. So the pin rules and every other
 * Claude-specific judgement stay exactly where they were — this module changed WHERE the rows come
 * from, not what makes a set of them valid. An install that has adopted nothing still reads correctly,
 * because the store-backed port (`src/plans/storePort.ts`) derives the same picture from the Claude accounts
 * file. A store that cannot be reached is a FIFTH answer, below: a refusal, never a derived picture.
 *
 * The port is a REQUIRED argument rather than a default, so only a composition root names the production
 * `planRegisterPort()` and a test that forgot to inject one fails to compile instead of reaching a real store
 * through an ambient `SLOPWEAVER_STORE_URL`.
 *
 * ## Four answers from one read, and why none of them collapse
 *
 * `spawnStore.ts` used to resolve the accounts file with `readJsonFile` and collapse every failure into an
 * empty list, on the stated reasoning that "a spawn that cannot boot is worse than a spawn that is not
 * routed". That reasoning is right for exactly one of the cases it covered:
 *
 * - **Nothing is configured.** No register and no accounts file. There is nothing to route over, and the
 *   correct behaviour is the one that predates routing entirely: no store override, the ambient slot, a
 *   byte-identical boot line. A legitimate configuration, not a failure.
 * - **A register is adopted and lists no CLAUDE destination.** Also `undefined`, and this is the case the
 *   register created: an install whose fleet is entirely Codex is configured, deliberately, and its Claude
 *   spawns want the ambient slot rather than a refusal. Registering a Codex plan must never break Claude.
 * - **The configuration is PRESENT and could not be read** — a permission error, a directory in its place,
 *   an I/O failure. Which destinations this install has is then UNKNOWN, and booting anyway means booting on
 *   whatever credential happens to be ambient. That is the silent fall-through routing exists to prevent.
 * - **It read fine and holds something unusable**, an emptied accounts file included. An accounts file
 *   holding `[]` is a file somebody emptied and is refused (`ACCOUNT_CONFIG_INVALID`, {@link EMPTIED_SOURCE_PROBLEM})
 *   — NOT read as the absent install it is byte-identical to. ONE Claude row is a whole fleet, never refused
 *   for its count. The emptied check survives only while the accounts file is the SOURCE; once a register is
 *   adopted the file is a generated projection, a hand-edit to it is `PROJECTION_DIVERGED`, and zero Claude
 *   rows means what the register says it means.
 * - **The store is unreachable.** `REGISTER_STORE_UNAVAILABLE` becomes `ACCOUNT_CONFIG_STORE_UNAVAILABLE`:
 *   unknown, so refused, exactly like an unreadable file — and never relabelled as invalid JSON.
 */
import { readFileSync } from "node:fs";

import { readJsonFile } from "../lib/jsonFile.js";
import { err, ok, type Result } from "../lib/result.js";
import type { PlanRegisterError } from "../plans/errors.js";
import type { PlanRegisterPort } from "../plans/port.js";
import { projectClaudeRows } from "../plans/projection.js";
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { PlanRegisterSnapshot } from "../plans/types.js";
import { stateHomePaths } from "../stateHome.js";

import { parseClaudeAccounts } from "./config.js";
import type { ClaudeAccount } from "./contracts.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "./errors.js";

/** Where the generated Claude projection lives, relative to the Slopweaver home. */
export const ACCOUNTS_PATH = "claude-accounts/accounts.json";

/** The problem a present, emptied accounts SOURCE reports — never the absent install it is byte-identical to. */
export const EMPTIED_SOURCE_PROBLEM =
  `the Claude accounts file ${ACCOUNTS_PATH} is present and lists no plan — delete it for an install with no ` +
  `Claude plans, or register one with \`slopweaver plans add --provider claude\``;

/**
 * The Claude accounts FILE, parsed, for a verb that reads it directly rather than through the register
 * (`claude rotate`, `claude signin`).
 *
 * `parseClaudeAccounts` enforces no count, so `[]` parses — which is right for a register that holds no Claude
 * row, and wrong for a file somebody emptied. Before the two-plan floor came out, that floor refused `[]` for
 * these verbs by accident; this refuses it on purpose, with the same {@link EMPTIED_SOURCE_PROBLEM}
 * `readSpawnAccounts` names. An absent or malformed file still refuses as the parser says.
 *
 * @param home the Slopweaver home whose accounts file is read
 * @returns the configured accounts, one or more of them, in file order
 */
export function readAccountsFile({ home }: { home: string }): Result<readonly ClaudeAccount[], ClaudeRotationError> {
  const value = readJsonFile({ path: `${home}/${ACCOUNTS_PATH}` });
  if (Array.isArray(value) && value.length === 0) {
    return err(ClaudeRotationErrors.accountConfigInvalid({ problems: [EMPTIED_SOURCE_PROBLEM] }));
  }
  return parseClaudeAccounts({ value });
}

/**
 * Whether the Claude accounts file is ABSENT, asked only to separate absent from emptied.
 *
 * The register cannot answer this and deliberately does not try: it derives the same empty picture from a
 * missing file and from one holding `[]`, because for every other purpose those are the same install. The one
 * purpose they are not the same for is this module's, so the question is asked here, once, and only when the
 * projected rows came back empty.
 *
 * `ENOENT` is the one error that means absent — every other error is a file that is there and will not be
 * read, which the register read has already refused on. `readFileSync` and an inspection of the error's
 * `code`, rather than `existsSync` first: a stat-then-read pair answers about two different instants, and the
 * gap between them is where a file another process is writing lands.
 *
 * @param path the Claude accounts file
 * @returns whether the file is not there at all
 */
function accountsFileAbsent({ path }: { path: string }): boolean {
  try {
    readFileSync(path, "utf8");
    return false;
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
    return code === "ENOENT";
  }
}

/**
 * A register failure in the vocabulary a Claude spawn already reports.
 *
 * `REGISTER_UNREADABLE` stays distinct because its message names the file to go and look at. Every arm is
 * refused by the spawn gate alike, with no hatch (`./spawnStore.ts` § Fail CLOSED): each is a configuration this
 * reader could not turn into a fleet, so each leaves every usage limit unread.
 *
 * An invalid register forwards its own PROBLEMS rather than its rendered `message`. Both factories wrap
 * their list in a "not usable:" preamble, so forwarding the rendered string nests one inside the other and
 * a reader gets `the configured Claude accounts are not usable: the plan register is not usable: …`. The
 * problems are the content; the preamble belongs to whichever surface is speaking.
 *
 * @param error what the register read refused with
 * @returns the rotation error a caller displays
 */
function rotationErrorFor({ error }: { error: PlanRegisterError }): ClaudeRotationError {
  if (error.code === "REGISTER_UNREADABLE") {
    return ClaudeRotationErrors.accountConfigUnreadable({ path: error.path });
  }
  if (error.code === "REGISTER_INVALID") {
    return ClaudeRotationErrors.accountConfigInvalid({ problems: error.problems });
  }
  if (error.code === "REGISTER_STORE_UNAVAILABLE") {
    return ClaudeRotationErrors.accountConfigStoreUnavailable({
      message: error.message,
      staleStore: error.staleStore === true,
    });
  }
  return ClaudeRotationErrors.accountConfigInvalid({ problems: [error.message] });
}

/**
 * Whether an empty Claude projection means "nothing configured" rather than "a source somebody emptied".
 *
 * An ADOPTED register listing no Claude row is a deliberate, legitimate configuration — see this module's
 * header. Only while the accounts file is still the source does its emptiness mean somebody emptied it.
 *
 * @param path the Claude accounts file
 * @param snapshot the register as it was read
 * @returns whether the caller should answer `undefined`
 */
function unconfigured({ path, snapshot }: { path: string; snapshot: PlanRegisterSnapshot }): boolean {
  if (snapshot.source === "registered") {
    return true;
  }
  return accountsFileAbsent({ path });
}

/**
 * The Claude destinations this install can seat on, or the reason they could not be established.
 *
 * @param home the Slopweaver home the register lives under
 * @param port where the register is read — `planRegisterPort()` at a composition root, a seam in a test
 * @returns the destinations in registered order; `undefined` when nothing Claude is configured, which is not
 *   an error; or the typed reason a present configuration could not be turned into a fleet
 */
export async function readSpawnAccounts({
  home,
  port,
}: {
  home: string;
  port: PlanRegisterPort;
}): Promise<Result<readonly ClaudeAccount[] | undefined, ClaudeRotationError>> {
  const fleet = await readClaudeFleet({ home, port });
  return fleet.map((read) => read.accounts);
}

/**
 * What one register read gives a Claude gate: the destinations, and the thresholds it judges them by.
 *
 * @internal — the value {@link readClaudeFleet} returns.
 */
export interface ClaudeFleetRead {
  /** The destinations in registered order; `undefined` when nothing Claude is configured, exactly as {@link readSpawnAccounts}. */
  readonly accounts: readonly ClaudeAccount[] | undefined;
  /** The install's Claude thresholds, off the SAME read — never a second one that could see another revision. */
  readonly thresholds: ClaudeThresholds;
}

/**
 * {@link readSpawnAccounts}, plus the Claude thresholds the same register read decoded (`../plans/thresholds.ts`).
 * Every gate that routes, alerts or grades reads through here, so its plans and its bars come from one revision.
 *
 * @param home the Slopweaver home the register lives under
 * @param port where the register is read — `planRegisterPort()` at a composition root, a seam in a test
 * @returns the destinations and thresholds, or the typed reason a present configuration could not be read
 */
export async function readClaudeFleet({
  home,
  port,
}: {
  home: string;
  port: PlanRegisterPort;
}): Promise<Result<ClaudeFleetRead, ClaudeRotationError>> {
  const path = stateHomePaths({ home }).claudeAccountsJson;
  const snapshot = await port.read({ home });
  if (snapshot.isErr()) {
    return err(rotationErrorFor({ error: snapshot.error }));
  }
  const thresholds = snapshot.value.thresholds.claude;
  const rows = projectClaudeRows({ document: snapshot.value.document });
  if (rows.length === 0) {
    if (unconfigured({ path, snapshot: snapshot.value })) {
      return ok({ accounts: undefined, thresholds });
    }
    return err(ClaudeRotationErrors.accountConfigInvalid({ problems: [EMPTIED_SOURCE_PROBLEM] }));
  }
  return parseClaudeAccounts({ value: rows }).map((accounts) => ({ accounts, thresholds }));
}
