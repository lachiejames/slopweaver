/**
 * The staging half of taking a ChatGPT export in (`./exportStore.ts` publishes it): a private root, a fresh staging
 * directory inside it, and every member copied there, flushed to the device, hashed by name and bytes and dated. A
 * crash anywhere here leaves a staging directory nothing reads, never a half export that looks whole.
 */
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "#lib/result.js";
import { fsyncFile } from "#lib/writeAtomic.js";
import type { ChatgptArchiveDeps } from "./archive.js";
import { type ChatgptExportError, ChatgptExportErrors } from "./errors.js";
import { latestActivityIso } from "./exportFreshness.js";
import { hashMembers } from "./exportIntegrity.js";
import { type MemberSource, stageMember, stagingBudgetBytes } from "./exportSource.js";

/** What staging an export's members produced: its content hash, each member's size, and how late it runs. */
export interface StagedMembers {
  readonly contentHash: string;
  readonly members: readonly { name: string; bytes: number }[];
  readonly latestActivityIso: string | null;
}

/**
 * Make the private export root and a fresh staging directory inside it, refusing a root that is a symbolic link.
 *
 * @param root the managed export root, created `0700` when absent
 * @returns the new staging directory, which the caller removes, or the refusal naming the root
 */
export function openStaging({ root }: { root: string }): Result<string, ChatgptExportError> {
  try {
    mkdirSync(root, { mode: 0o700, recursive: true });
    // A symbolic link standing at the root would carry every write below it out of the home, so it is refused
    // rather than followed.
    if (lstatSync(root).isSymbolicLink()) {
      return err(
        ChatgptExportErrors.exportStoreFailed({
          cause: new Error("the export root is a symbolic link, and an export is never written through one"),
          path: root,
        }),
      );
    }
    chmodSync(root, 0o700);
    return ok(mkdtempSync(join(root, ".staging-")));
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path: root }));
  }
}

/**
 * Copy every member into staging, flushed to the device, then hash names and bytes and date the export.
 *
 * @param source where the members are read from, a zip or a directory
 * @param staging the directory {@link openStaging} made
 * @param archive the process edges for a zip
 * @returns the staged export's hash, members and latest activity, or the first failure
 */
export function stageMembers({
  source,
  staging,
  archive,
}: {
  source: MemberSource;
  staging: string;
  archive: ChatgptArchiveDeps;
}): Result<StagedMembers, ChatgptExportError> {
  const names = source.members.map((member) => member.name);
  // One budget for the whole export, spent member by member, so a run of many files is held to it as one file is.
  const budget = stagingBudgetBytes({ dir: staging });
  if (budget.isErr()) {
    return err(budget.error);
  }
  let left = budget.value;
  for (const member of source.members) {
    const toPath = join(staging, member.name);
    const staged = stageMember({ archive, maxBytes: left, member, source, toPath });
    if (staged.isErr()) {
      return err(staged.error);
    }
    try {
      fsyncFile({ path: toPath });
      left -= statSync(toPath).size;
    } catch (cause) {
      return err(ChatgptExportErrors.exportStoreFailed({ cause, path: toPath }));
    }
  }
  try {
    const { bytes, contentHash } = hashMembers({ directory: staging, names });
    const members = names.map((name, index) => ({ bytes: bytes[index]!, name }));
    const files = names.map((name) => join(staging, name));
    return ok({ contentHash, latestActivityIso: latestActivityIso({ files }), members });
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path: staging }));
  }
}
