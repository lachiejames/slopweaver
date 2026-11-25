/**
 * The pure half of seeding the personal Codex marketplace: given what the file holds (or that it is absent),
 * decide whether Slopweaver's local entry is already there, has to be written, or cannot be — never touching
 * another entry. `./marketplaceStore.ts` is the filesystem edge that reads the file and performs the write.
 *
 * The seed is the document `docs/getting-started.md` § Codex once told a person to write by hand. An appended
 * entry is built from the ORIGINAL document rather than the schema's parsed copy, so every key this repository
 * does not read — another plugin's fields, a top-level `interface` block — survives in place and in order.
 */
import { resolve } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import type { CodexPluginSyncError } from "./errors.js";
import { pathWithin } from "./homes.js";
import { CODEX_PLUGIN_NAME, marketplaceEntryOf } from "./plan.js";

/** The marketplace name a seeded file carries. */
export const SEEDED_MARKETPLACE_NAME = "personal";

/** The source path, relative to the user's home, that the seeded or appended entry names. */
export const SEEDED_SOURCE_RELATIVE = "./plugins/slopweaver";

/** The one plugin entry this verb ever adds to a personal marketplace. */
export const SLOPWEAVER_MARKETPLACE_ENTRY = {
  name: CODEX_PLUGIN_NAME,
  source: { path: SEEDED_SOURCE_RELATIVE, source: "local" },
} as const;

/** Slopweaver's local entry: which marketplace carries it and where its source lives. */
export interface PersonalMarketplaceEntry {
  readonly marketplace: string;
  readonly sourcePath: string;
}

/** What to do with the personal marketplace. */
export type MarketplaceWritePlan =
  /** Slopweaver's local entry is already there. */
  | { readonly kind: "unchanged"; readonly entry: PersonalMarketplaceEntry }
  /** Write this whole document — a seed for an absent file, or the original with one entry appended. */
  | {
      readonly kind: "write";
      readonly document: Readonly<Record<string, unknown>>;
      readonly entry: PersonalMarketplaceEntry;
    }
  /** A slopweaver entry is there but is not a local path, so nothing is written and nothing is installed. */
  | { readonly kind: "skip"; readonly why: string };

/**
 * Decide what the personal marketplace needs for Slopweaver's local entry to be in it.
 *
 * @param document the parsed file, or undefined when the file is absent — never undefined for a malformed one
 * @param marketplacePath the file it came from, for the error
 * @param userHome the directory Codex treats as this marketplace's root
 * @returns the plan, or why the document is not a marketplace this verb can read
 */
export function planPersonalMarketplace({
  document,
  marketplacePath,
  userHome,
}: {
  document: unknown;
  marketplacePath: string;
  userHome: string;
}): Result<MarketplaceWritePlan, CodexPluginSyncError> {
  if (document === undefined) {
    return ok({
      document: { name: SEEDED_MARKETPLACE_NAME, plugins: [SLOPWEAVER_MARKETPLACE_ENTRY] },
      entry: { marketplace: SEEDED_MARKETPLACE_NAME, sourcePath: resolve(userHome, SEEDED_SOURCE_RELATIVE) },
      kind: "write",
    });
  }
  const found = marketplaceEntryOf({ document, home: userHome, path: marketplacePath });
  if (found.isErr()) {
    return err(found.error);
  }
  if (found.value.kind === "found") {
    // Repointing a source that holds the marketplace file would replace that file with a link to the export.
    if (pathWithin({ inner: marketplacePath, outer: found.value.sourcePath })) {
      const why = `slopweaver's source path ${found.value.sourcePath} holds the marketplace file itself`;
      return ok({ kind: "skip", why });
    }
    return ok({
      entry: { marketplace: found.value.marketplace, sourcePath: found.value.sourcePath },
      kind: "unchanged",
    });
  }
  return ok(appendedOrSkip({ document, userHome, why: found.value.why }));
}

/** The original document with Slopweaver's entry appended, or a skip when a non-local slopweaver is listed. */
function appendedOrSkip({
  document,
  userHome,
  why,
}: {
  document: unknown;
  userHome: string;
  why: string;
}): MarketplaceWritePlan {
  // `marketplaceEntryOf` has already validated the shape, so these narrowings are invariants, not fallbacks.
  const record = document as Readonly<Record<string, unknown>>;
  const plugins = record["plugins"] as readonly unknown[];
  if (plugins.some((plugin) => isRecord(plugin) && plugin["name"] === CODEX_PLUGIN_NAME)) {
    return { kind: "skip", why };
  }
  return {
    document: { ...record, plugins: [...plugins, SLOPWEAVER_MARKETPLACE_ENTRY] },
    entry: { marketplace: record["name"] as string, sourcePath: resolve(userHome, SEEDED_SOURCE_RELATIVE) },
    kind: "write",
  };
}
