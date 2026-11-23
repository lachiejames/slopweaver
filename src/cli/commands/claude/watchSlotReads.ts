/**
 * The slot reads one `claude watch` tick takes: which plan this process is pinned to, what the ACTIVE slot holds,
 * which stores share its credential, and how much life each store's credential has left. The shell's I/O edge, split out of `./watch.ts`; every
 * judgement over what these read is pure and lives in `../../../claude/watchTick.ts`, `watchTickActiveSlot.ts` and `watchReport.ts`.
 */
import { aliasForStoreDir } from "../../../claude/config.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import {
  alreadyHolds,
  credentialExpiryIso,
  credentialHasAccessToken,
  readClaudeCredential,
} from "../../../claude/credentialDocument.js";
import { type KeychainItemReader, readCredentialDocument } from "../../../claude/keychain.js";
import type { StoreLife } from "../../../claude/watchReport.js";
import { type ActiveSlot, classifyActiveSlot } from "../../../claude/watchTickActiveSlot.js";

/**
 * The plan whose store THIS process was booted against, when a configured plan holds it.
 *
 * This is the strongest answer to which plan is active and it costs nothing — no probe, no keychain read,
 * no record. `watchTick.ts`'s header carries the measurement that put it there: every session
 * on the owner's machine is pinned, so the DEFAULT keychain item every other answer reasons about is
 * whatever a hand `/login` last left in it, and resolution fell through to a five-day-old record that
 * named the wrong store.
 *
 * A pin naming a directory no configured plan holds answers nothing rather than inventing an alias — the
 * process is running under a store this fleet does not manage, and the weaker answers are then the honest
 * ones.
 *
 * @param accounts the configured plans
 * @param pin the store directory this process was booted against — `CLAUDE_SECURESTORAGE_CONFIG_DIR`, passed
 *   in by the shell so this reads no environment of its own
 * @returns the alias this process is pinned to, or undefined when it carries no pin or an unknown one
 */
export function pinnedActiveAlias({
  accounts,
  pin,
}: {
  accounts: readonly ClaudeAccount[];
  pin: string | undefined;
}): string | undefined {
  if (pin === undefined || pin.trim() === "") {
    return undefined;
  }
  return aliasForStoreDir({ accounts, storeDir: pin });
}

/**
 * What the ACTIVE slot's own credential is — live, expired, or not there at all.
 *
 * This is the fact that separates "which plan is active" from "is any plan active at all", and the loop was
 * blind to it. MEASURED: the default slot's credential had expired while
 * all four configured stores held live ones, so every unpinned tick fell through to `unknown` — no
 * organisation comes back for a dead token, and no store byte-matched it — and `unknown` holds every store
 * back. Seven days of keep-alive refreshed nothing, guarding a credential no session could present.
 * Reproduce with `env -u CLAUDE_SECURESTORAGE_CONFIG_DIR slopweaver claude watch --once --dry-run`.
 *
 * The keychain read is all that lives here; {@link classifyActiveSlot} makes the judgement, so the half that
 * releases two guards is pure and has a unit test rather than needing a real slot to exercise it.
 *
 * @param nowIso this tick's instant, ISO-8601 — injected, never read from a hidden clock
 * @returns what the slot holds, and when it expired on the one path where that has already happened
 */
export function readActiveSlot({ nowIso }: { nowIso: string }): ActiveSlot {
  return classifyActiveSlot({ nowIso, slice: readClaudeCredential({ document: readCredentialDocument({}) }) });
}

/**
 * Which stores hold the very credential the active slot is holding.
 *
 * This is the half of the refresh guard that needs no record. A swap COPIES a store's credential into the
 * active slot, so both hold the same token and a refresh under either one REVOKES the other; comparing the
 * documents finds that whether or not this repository has ever written a rotation state. Measured
 * 2026, `rotation-state.json` did not exist on this machine at all, so the recorded-alias guard alone
 * excluded nothing.
 *
 * @param accounts the configured plans
 * @param readItem how a keychain item's text is fetched; omitted, the macOS keychain
 * @returns the aliases whose store holds the active slot's own credential
 */
export function storesSharingActiveCredential({
  accounts,
  readItem,
}: {
  accounts: readonly ClaudeAccount[];
  readItem?: KeychainItemReader;
}): readonly string[] {
  const seam = readItem === undefined ? {} : { readItem };
  const active = readCredentialDocument(seam);
  return accounts.flatMap((account) => {
    const slice = readClaudeCredential({ document: readCredentialDocument({ storeDir: account.storeDir, ...seam }) });
    if (slice === undefined || !alreadyHolds({ document: active, slice })) {
      return [];
    }
    return [account.alias];
  });
}

/**
 * How much life each store's own credential has left.
 *
 * This is the tick's falsifiable witness, and it is read AFTER the touches for exactly that reason: it is
 * what says whether running the keep-alive command achieved anything, rather than only that it ran.
 *
 * @param accounts the configured plans
 * @param readItem how a keychain item's text is fetched; omitted, the macOS keychain
 * @returns one entry per store, in configured order
 */
export function storeLives({
  accounts,
  readItem,
}: {
  accounts: readonly ClaudeAccount[];
  readItem?: KeychainItemReader;
}): readonly StoreLife[] {
  const seam = readItem === undefined ? {} : { readItem };
  return accounts.map((account) => {
    const slice = readClaudeCredential({ document: readCredentialDocument({ storeDir: account.storeDir, ...seam }) });
    const expiresAtIso = slice === undefined ? undefined : credentialExpiryIso({ slice });
    return {
      alias: account.alias,
      hasCredential: credentialHasAccessToken({ slice }),
      ...(account.email === undefined ? {} : { email: account.email }),
      ...(expiresAtIso === undefined ? {} : { expiresAtIso }),
    };
  });
}
