/**
 * The empty protection resolver a test hands every judged corpus reader and writer.
 *
 * A reader or writer given a fixture home but NO resolver still reads the owner's real protect registry: the default
 * resolver walks every protection home, and that list always includes the account's own default home whatever home
 * the test passed. Only an injected resolver keeps a test off the owner's list, so a test passes this one, or a
 * resolver of its own naming a synthetic entry under its own `mkdtempSync` home.
 */
import type { OwnerProtectionResolver } from "../corpus/bronzeProtection.js";
import { ok } from "../lib/result.js";

/**
 * Protects nothing, and reads no registry.
 *
 * @returns an empty entry list, so every judged path is allowed
 */
export const NO_PROTECTION: OwnerProtectionResolver = () => ok([]);

/**
 * The `home` and `protection` a writer judges against, protecting nothing, for a test whose writer takes a store root
 * rather than a home. With a resolver injected the home is never read for a registry, so it is a label and no more.
 */
export const UNPROTECTED = { home: "/unprotected-fixture-home", protection: NO_PROTECTION } as const;
