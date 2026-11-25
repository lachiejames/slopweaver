/**
 * The filesystem edge of the personal Codex marketplace, `$HOME/.agents/plugins/marketplace.json`: read it,
 * name Slopweaver's local entry in it, and — only in a foreground `codex plugin-sync` — seed the file or append
 * that one entry. `./marketplacePlan.ts` decides; this module reads and writes.
 *
 * ## What the write does and does not protect
 *
 * An absent file is CREATED EXCLUSIVELY, so a file that appeared after this run read the directory wins and
 * this run reports `MARKETPLACE_CHANGED`. A present file is re-read immediately before the atomic replace, and
 * a byte difference since the first read refuses the same way. An unparseable file is never overwritten, nor is
 * one holding a number `JSON.stringify` would write back differently. A duplicated key is the residue:
 * `JSON.parse` keeps its last value and no reviver sees the earlier one, so a rewrite drops it. The
 * plugin-sync lock serialises Slopweaver's own writers, but a person editing the file does not take it, so a
 * save landing between the final re-read and the rename is still lost: the window is narrowed, not closed.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { createFileExclusive, writeFileAtomic } from "#lib/writeAtomic.js";

import { type CodexPluginSyncError, CodexPluginSyncErrors } from "./errors.js";
import { pathWithin } from "./homes.js";
import {
  type MarketplaceWritePlan,
  type PersonalMarketplaceEntry,
  planPersonalMarketplace,
} from "./marketplacePlan.js";
import { CODEX_PLUGIN_NAME, PERSONAL_MARKETPLACE_RELATIVE } from "./plan.js";
import { entryPath } from "./realPath.js";

/** What the marketplace file held when it was read: absent, or its exact bytes and their parse. */
export interface MarketplaceSnapshot {
  readonly path: string;
  /** The file's bytes, or undefined when there is no file. */
  readonly raw: string | undefined;
  /** The parsed document, or undefined when there is no file. */
  readonly document: unknown;
}

/**
 * Read the personal marketplace, telling an absent file apart from an unreadable one.
 *
 * @param userHome the user's home, which Codex treats as the personal marketplace's root
 * @returns the snapshot, or why a present file could not be read or parsed
 */
export function readPersonalMarketplace({
  userHome,
}: {
  userHome: string;
}): Result<MarketplaceSnapshot, CodexPluginSyncError> {
  const path = join(userHome, PERSONAL_MARKETPLACE_RELATIVE);
  if (!existsSync(path)) {
    return ok({ document: undefined, path, raw: undefined });
  }
  try {
    const raw = readFileSync(path, "utf8");
    return ok({ document: JSON.parse(raw) as unknown, path, raw });
  } catch (error: unknown) {
    return err(CodexPluginSyncErrors.marketplaceUnreadable({ detail: errorMessage({ error }), path }));
  }
}

/**
 * What the personal marketplace needs, read and decided without writing anything.
 *
 * @param userHome the user's home, root of the personal marketplace
 * @returns the plan and the file it was read from, or why the file is unreadable
 */
export function personalMarketplacePlan({
  userHome,
}: {
  userHome: string;
}): Result<{ readonly snapshot: MarketplaceSnapshot; readonly plan: MarketplaceWritePlan }, CodexPluginSyncError> {
  return readPersonalMarketplace({ userHome }).andThen((snapshot) =>
    planPersonalMarketplace({ document: snapshot.document, marketplacePath: snapshot.path, userHome }).map((plan) => ({
      plan: sourceClearOfMarketplace({ marketplacePath: snapshot.path, plan }),
      snapshot,
    })),
  );
}

/**
 * The plan, or a skip when the entry's source path is the marketplace file or a directory holding it. The sync
 * renames a link onto that source path, which would replace the marketplace file, so each side is compared as
 * the directory entry it really is: a parent reached through a link is followed (`./realPath.ts`).
 */
function sourceClearOfMarketplace({
  marketplacePath,
  plan,
}: {
  marketplacePath: string;
  plan: MarketplaceWritePlan;
}): MarketplaceWritePlan {
  if (plan.kind === "skip") {
    return plan;
  }
  const { sourcePath } = plan.entry;
  if (!pathWithin({ inner: entryPath({ path: marketplacePath }), outer: entryPath({ path: sourcePath }) })) {
    return plan;
  }
  return { kind: "skip", why: `slopweaver's source path ${sourcePath} holds the marketplace file itself` };
}

/**
 * Slopweaver's LOCAL entry as the file stands, never writing — a missing file or entry is a skip with its reason.
 *
 * @param userHome the user's home, root of the personal marketplace
 * @returns the entry, a skip naming why there is none yet, or why the file is unreadable
 */
export function personalMarketplaceEntry({
  userHome,
}: {
  userHome: string;
}): Result<PersonalMarketplaceEntry | { readonly skip: string }, CodexPluginSyncError> {
  return personalMarketplacePlan({ userHome }).map(({ plan, snapshot }) => {
    if (plan.kind === "unchanged") {
      return plan.entry;
    }
    if (plan.kind === "skip") {
      return { skip: plan.why };
    }
    if (snapshot.raw === undefined) {
      return { skip: `no personal Codex marketplace at ${snapshot.path}` };
    }
    return { skip: `the personal Codex marketplace at ${snapshot.path} lists no ${CODEX_PLUGIN_NAME} plugin yet` };
  });
}

/**
 * Make sure Slopweaver's local entry is in the personal marketplace, seeding or appending it when it is not.
 *
 * @param userHome the user's home, root of the personal marketplace
 * @returns the entry, a skip when a non-local slopweaver is listed, or why the file could not be read or written
 */
export function ensurePersonalMarketplace({
  userHome,
}: {
  userHome: string;
}): Result<PersonalMarketplaceEntry | { readonly skip: string }, CodexPluginSyncError> {
  return personalMarketplacePlan({ userHome }).andThen(({ plan, snapshot }) => {
    if (plan.kind === "unchanged") {
      return ok(plan.entry);
    }
    if (plan.kind === "skip") {
      return ok({ skip: plan.why });
    }
    if (snapshot.raw !== undefined && !numbersSurviveRewrite({ raw: snapshot.raw })) {
      const detail = "it holds a number JSON would write back differently, such as 1e400, so it is never rewritten";
      return err(CodexPluginSyncErrors.marketplaceUnreadable({ detail, path: snapshot.path }));
    }
    return writeMarketplace({ document: plan.document, snapshot }).map(() => plan.entry);
  });
}

/**
 * True when every number in the file is spelled exactly as `JSON.stringify` would write it back. Compared on
 * the SOURCE TEXT, never on the parsed value: `9007199254740993` parses already rounded, so a value comparison
 * passes it, while `1e400` (Infinity, written `null`) and `-0` (written `0`) differ too. A spelling such as
 * `1.0` is refused with them — the rewrite would keep its value but not its bytes, and refusing is the safe arm.
 * A runtime that gives the reviver no source text refuses every number rather than passing one unread.
 */
function numbersSurviveRewrite({ raw }: { raw: string }): boolean {
  let survives = true;
  JSON.parse(raw, (_key: string, value: unknown, context?: { readonly source?: string }) => {
    if (typeof value === "number" && context?.source !== JSON.stringify(value)) {
      survives = false;
    }
    return value;
  });
  return survives;
}

/** Write the planned document: an exclusive create for an absent file, a re-checked atomic replace otherwise. */
function writeMarketplace({
  document,
  snapshot,
}: {
  document: Readonly<Record<string, unknown>>;
  snapshot: MarketplaceSnapshot;
}): Result<void, CodexPluginSyncError> {
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  const { path } = snapshot;
  try {
    if (snapshot.raw === undefined) {
      mkdirSync(dirname(path), { recursive: true });
      createFileExclusive({ contents, path });
      return ok(undefined);
    }
    if (readFileSync(path, "utf8") !== snapshot.raw) {
      return err(CodexPluginSyncErrors.marketplaceChanged({ path }));
    }
    writeFileAtomic({ contents, path });
    return ok(undefined);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "ENOENT")) {
      return err(CodexPluginSyncErrors.marketplaceChanged({ path }));
    }
    return err(CodexPluginSyncErrors.marketplaceWriteFailed({ detail: errorMessage({ error }), path }));
  }
}
