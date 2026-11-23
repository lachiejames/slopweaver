/**
 * Derive the macOS keychain service name Claude Code uses for one credential store, so this repository can
 * ask whether a plan is signed in WITHOUT running the model binary and without ever reading a secret.
 *
 * ## Why this is derived here rather than asked for
 *
 * The obvious way to learn whether a store holds a login is to run the vendor's own
 * `claude auth status --json` against it. That would work, and doctrine rule 2 would arguably permit it,
 * since it starts no model. It is still not what this does. `security find-generic-password` without `-w`
 * answers the same question from metadata alone — it returns whether the item EXISTS and never the secret —
 * so the readiness check needs neither the model binary in command position nor a credential in this
 * process. Choosing the weaker capability that answers the question is the point.
 *
 * ## The derivation, decoded from Claude Code v2.1.259 and verified live
 *
 * The shipped binary builds the service name as `"Claude Code" + "-credentials" + suffix`, where the suffix
 * is empty for the default store and `-<first 8 hex of sha256 of the NFC-normalised store path>` otherwise.
 * Verified both ways: the default store's item is `Claude Code-credentials` and exists, and a
 * scratch store at a known path was predicted to be `Claude Code-credentials-c13a1cd9` and confirmed ABSENT
 * before any login — which is what makes the derivation falsifiable rather than assumed. Reproduce with:
 *
 * ```sh
 * security find-generic-password -s "Claude Code-credentials" | grep '"svce"'
 * ```
 *
 * This is an undocumented internal detail of another program, so a caller must treat a miss as "not signed
 * in yet" rather than as proof of anything about the machine.
 */
import { createHash } from "node:crypto";

/** What every store's service name starts with, default store included. */
const SERVICE_STEM = "Claude Code-credentials";

/** How many hex characters of the digest the suffix carries — the shipped binary takes the first eight. */
const SUFFIX_HEX_LENGTH = 8;

/**
 * The keychain service name for one credential store.
 *
 * @param storeDir the directory `CLAUDE_SECURESTORAGE_CONFIG_DIR` names, or undefined for the default store
 * @returns the exact `svce` value the keychain item is filed under
 */
export function claudeStoreService({ storeDir }: { storeDir?: string }): string {
  if (storeDir === undefined) {
    return SERVICE_STEM;
  }
  const digest = createHash("sha256").update(storeDir.normalize("NFC")).digest("hex");
  return `${SERVICE_STEM}-${digest.slice(0, SUFFIX_HEX_LENGTH)}`;
}

/**
 * The argument vector that asks the keychain whether one store holds a login, WITHOUT requesting the
 * secret. The absent `-w` is the whole point and must not be added: with it, this would print a token into
 * whatever captured the output.
 *
 * @param account the keychain account field, which Claude Code sets from `$USER`
 * @param storeDir the store to ask about, or undefined for the default store
 * @returns the argv to hand `security`, secret-free by construction
 */
export function claudeStoreProbeArgv({ account, storeDir }: { account: string; storeDir?: string }): readonly string[] {
  return ["find-generic-password", "-a", account, "-s", claudeStoreService(storeDir === undefined ? {} : { storeDir })];
}
