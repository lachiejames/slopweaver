/**
 * Every held export's bytes checked against its name on every pass — `<root>/verified-index.json` is what makes that
 * affordable.
 *
 * **Why every export, every pass.** An older export is a snapshot holding the chats the owner deleted before a newer one, and
 * once it is receipted no refresh reads it again. Were only the newest re-hashed, a receipted older one rewritten
 * under the same size would stand, unread, behind a green sync, and a rebuild replaying it (`chatgpt sync --replay`)
 * would read bytes nothing had checked. So a sync and a refresh both refuse while ANY held export fails its hash.
 *
 * **Why an index.** A whole history per kept export, hashed every day, is the cost that would push this back to the
 * newest alone. An entry binds each member's identity (`fileIdentity.ts`) at the moment its export last re-hashed
 * whole and matched; a member whose identity is unchanged since is the same unwritten bytes, so only an export with a
 * moved member is read in full. An entry is recorded only when no member moved while it was hashed.
 *
 * A cache, never a verdict: an index that will not read is reported and read as empty, which costs one full pass and
 * never passes a damaged export. A failed write is reported, and the next pass hashes again.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { logger } from "#lib/logger.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { ChatgptExportErrors } from "./errors.js";
import { verifyHeldContent } from "./exportIntegrity.js";
import { HASH_DIR, parseSmallJson } from "./exportReceipts.js";
import { type FileIdentity, fileIdentity, fileIdentitySchema, sameIdentity } from "./fileIdentity.js";

/** More exports than anyone would ever keep; an index past it is not one this writes. */
const MAX_VERIFIED_BYTES = 1024 * 1024;

const verifiedSchema = z.strictObject({
  entries: z.array(z.strictObject({ contentHash: z.string().regex(HASH_DIR), members: z.array(fileIdentitySchema) })),
  schemaVersion: z.literal(1),
});

type VerifiedEntry = z.infer<typeof verifiedSchema>["entries"][number];

/** One held export, as much of it as a check needs. */
interface HeldForCheck {
  readonly contentHash: string;
  readonly directory: string;
  readonly files: readonly string[];
}

/** Where the index sits. */
function verifiedPath({ root }: { root: string }): string {
  return join(root, "verified-index.json");
}

/** The index's entries; an absent index is empty, and an unreadable one is reported and read as empty. */
function readVerified({ root }: { root: string }): readonly VerifiedEntry[] {
  const path = verifiedPath({ root });
  let text: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_VERIFIED_BYTES) {
      logger.error({ msg: `chatgpt: ${path} is not an index this writes, so every held export is hashed in full` });
      return [];
    }
    text = readFileSync(path, "utf8");
  } catch {
    // Absent before the first pass; anything else costs one full pass, never a pass on damage.
    return [];
  }
  const parsed = verifiedSchema.safeParse(parseSmallJson({ text }));
  if (!parsed.success) {
    logger.error({ msg: `chatgpt: ${path} will not read, so every held export is hashed in full this pass` });
    return [];
  }
  return parsed.data.entries;
}

/** Each member's identity, or `undefined` when any one is not a regular file that stats. */
function memberIdentities({ files }: { files: readonly string[] }): readonly FileIdentity[] | undefined {
  const identities: FileIdentity[] = [];
  for (const path of files) {
    const identity = fileIdentity({ path });
    if (identity === undefined) {
      return undefined;
    }
    identities.push(identity);
  }
  return identities;
}

/** Whether two member lists are the same unwritten files, in the same order. */
function sameMembers({ a, b }: { a: readonly FileIdentity[]; b: readonly FileIdentity[] }): boolean {
  return a.length === b.length && a.every((identity, index) => sameIdentity({ a: identity, b: b[index]! }));
}

/** One export checked: its entry to keep when it stands, or the line naming its damage. */
function checkOne({
  held,
  known,
}: {
  held: HeldForCheck;
  known: VerifiedEntry | undefined;
}): { readonly entry: VerifiedEntry | undefined; readonly rehashed: boolean } | { readonly damage: string } {
  const before = memberIdentities({ files: held.files });
  if (before !== undefined && known !== undefined && sameMembers({ a: known.members, b: before })) {
    return { entry: known, rehashed: false };
  }
  const verified = verifyHeldContent({ directory: held.directory, files: held.files });
  if (verified.isErr()) {
    return { damage: verified.error.message };
  }
  const after = memberIdentities({ files: held.files });
  const unmoved = before !== undefined && after !== undefined && sameMembers({ a: before, b: after });
  return { entry: unmoved ? { contentHash: held.contentHash, members: [...before] } : undefined, rehashed: true };
}

/**
 * Check every held export's bytes against its name, re-reading only those with a member written since it last
 * matched.
 *
 * @param root the managed export root, where the index sits
 * @param held every held export, each already past its shape check
 * @returns one line per export whose bytes are no longer the ones taken in; empty when every one stands
 */
export function damagedHeldExports({ root, held }: { root: string; held: readonly HeldForCheck[] }): readonly string[] {
  const known = new Map(readVerified({ root }).map((entry) => [entry.contentHash, entry]));
  const kept: VerifiedEntry[] = [];
  const damage: string[] = [];
  let rehashed = false;
  for (const one of held) {
    const checked = checkOne({ held: one, known: known.get(one.contentHash) });
    if ("damage" in checked) {
      damage.push(checked.damage);
      continue;
    }
    if (checked.rehashed) {
      rehashed = true;
    }
    if (checked.entry !== undefined) {
      kept.push(checked.entry);
    }
  }
  if (rehashed || kept.length !== known.size) {
    rememberVerified({ entries: kept, root });
  }
  return damage;
}

/** Write the index whole; a failure is reported and costs the next pass one full hash. */
function rememberVerified({ root, entries }: { root: string; entries: readonly VerifiedEntry[] }): void {
  const path = verifiedPath({ root });
  try {
    // Renamed into place, so a link planted at the path is replaced, never written through.
    writeFileAtomic({
      contents: `${JSON.stringify({ entries, schemaVersion: 1 })}\n`,
      dirMode: 0o700,
      fileMode: 0o600,
      path,
    });
  } catch (cause) {
    logger.error({ msg: ChatgptExportErrors.exportStoreFailed({ cause, path }).message });
  }
}
