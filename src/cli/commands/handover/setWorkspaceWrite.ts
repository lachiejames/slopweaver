/**
 * `handover set-workspace`'s row writes — stating a workspace, and the `--respell` rewrite of an old spelling. Each
 * re-reads the row under its one lock (`./boardRowLock.ts`) and judges it as it reads NOW, not as the board scan saw
 * it, so no other row edit is written over. `./setWorkspaceRun.ts` holds the verb that drives them.
 */

import { readFileSync } from "node:fs";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { editFrontMatterFields, frontMatterErrorLines } from "../../../handover/frontmatter.js";
import type { Workspace } from "../../../handover/workspace.js";
import { type BoardRowLockOptions, withBoardRowLock } from "./boardRowLock.js";

/** What writing one row did: changed it (`from` is the value its line spelled, an old spelling included), found it already stating the value, or refused. */
export type WorkspaceWrite =
  | { readonly kind: "written"; readonly from: string | undefined }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly problems: readonly string[] };

/**
 * Write `workspace:` and `workspaceBecause:` into one row. A line in an old spelling reads as the workspace it now
 * is, so it is rewritten rather than left unchanged.
 *
 * @param doc the row as the board scan read it
 * @param workspace the workspace to state
 * @param because why, written beside it
 * @param rowLock how the write waits on the row's lock when another writer holds it
 * @returns what happened to the row
 */
export function writeWorkspace({
  doc,
  workspace,
  because,
  rowLock,
}: {
  doc: HandoverDoc;
  workspace: Workspace;
  because: string;
  rowLock?: BoardRowLockOptions;
}): WorkspaceWrite {
  const locked = withBoardRowLock({
    ...rowLock,
    path: doc.path,
    write: ({ target }) => writeWorkspaceAt({ because, doc, target, workspace }),
  });
  if (locked.isErr()) {
    return { kind: "refused", problems: [locked.error.message] };
  }
  return locked.value;
}

/**
 * Rewrite one row's old-spelling `workspace:` line into the role it reads as, keeping its `workspaceBecause:` — the
 * `--respell` write. A row another writer already respelt or re-stated reads as unchanged.
 *
 * @param doc the row as the board scan read it
 * @param rowLock how the write waits on the row's lock when another writer holds it
 * @returns what happened to the row
 */
export function respellWorkspace({
  doc,
  rowLock,
}: {
  doc: HandoverDoc;
  rowLock?: BoardRowLockOptions;
}): WorkspaceWrite {
  const locked = withBoardRowLock({
    ...rowLock,
    path: doc.path,
    write: ({ target }) => respellWorkspaceAt({ doc, target }),
  });
  if (locked.isErr()) {
    return { kind: "refused", problems: [locked.error.message] };
  }
  return locked.value;
}

/** {@link respellWorkspace}'s read, judgement and write, run under the row's lock on the real file `target`. */
function respellWorkspaceAt({ doc, target }: { doc: HandoverDoc; target: string }): WorkspaceWrite {
  const read = currentRow({ doc, target });
  if ("kind" in read) {
    return read;
  }
  const { current, text } = read;
  if (current.workspace === undefined || current.workspaceAlias === undefined) {
    return { kind: "unchanged" };
  }
  // Another writer moved the line to a different old spelling since the scan: the scan's count no longer describes it.
  if (current.workspaceAlias !== doc.workspaceAlias) {
    let scanned = "no old spelling";
    if (doc.workspaceAlias !== undefined) {
      scanned = doc.workspaceAlias;
    }
    return {
      kind: "refused",
      problems: [
        `${doc.slug}: workspace: changed from ${scanned} to ${current.workspaceAlias} since the board was read — ` +
          "nothing written; run --respell again",
      ],
    };
  }
  return writeEdited({
    doc,
    from: current.workspaceAlias,
    set: [{ key: "workspace", value: current.workspace }],
    target,
    text,
    workspace: current.workspace,
  });
}

/** {@link writeWorkspace}'s read, judgement and write, run under the row's lock on the real file `target`. */
function writeWorkspaceAt({
  doc,
  workspace,
  because,
  target,
}: {
  doc: HandoverDoc;
  workspace: Workspace;
  because: string;
  target: string;
}): WorkspaceWrite {
  const read = currentRow({ doc, target });
  if ("kind" in read) {
    return read;
  }
  const { current, text } = read;
  if (current.workspace === workspace && current.workspaceAlias === undefined) {
    return { kind: "unchanged" };
  }
  // The value the line spelled: an old spelling when it carried one, so the written line says what it replaced.
  let from: string | undefined = current.workspace;
  if (current.workspaceAlias !== undefined) {
    from = current.workspaceAlias;
  }
  return writeEdited({
    doc,
    from,
    set: [
      { key: "workspace", value: workspace },
      { key: "workspaceBecause", value: JSON.stringify(because) },
    ],
    target,
    text,
    workspace,
  });
}

/**
 * The row as it reads NOW under its lock, refused when it moved to another slug or does not parse cleanly.
 *
 * @returns the parsed row and its text, or the refusal
 */
function currentRow({
  doc,
  target,
}: {
  doc: HandoverDoc;
  target: string;
}): { readonly current: HandoverDoc; readonly text: string } | Extract<WorkspaceWrite, { kind: "refused" }> {
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch (cause: unknown) {
    return { kind: "refused", problems: [`cannot read ${doc.path}: ${String(cause)}`] };
  }
  const current = parseHandoverDoc({ path: doc.path, text });
  if (current.slug !== doc.slug) {
    return {
      kind: "refused",
      problems: [`${doc.path} now holds the row "${current.slug}", not "${doc.slug}" — nothing was written`],
    };
  }
  if (current.problems.length > 0) {
    return {
      kind: "refused",
      problems: [`${current.slug} does not parse cleanly, so nothing may be written to it: ${current.problems[0]!}`],
    };
  }
  return { current, text };
}

/**
 * Edit the front matter, read it back as the workspace intended, and write it atomically.
 *
 * @param from the value the line spelled before, said on the written line
 * @param set the front-matter fields to write
 * @returns what happened to the row
 */
function writeEdited({
  doc,
  from,
  set,
  target,
  text,
  workspace,
}: {
  doc: HandoverDoc;
  from: string | undefined;
  set: readonly { readonly key: string; readonly value: string }[];
  target: string;
  text: string;
  workspace: Workspace;
}): WorkspaceWrite {
  const edited = editFrontMatterFields({ path: doc.path, remove: [], set, text });
  if (edited.isErr()) {
    return { kind: "refused", problems: frontMatterErrorLines({ error: edited.error }) };
  }
  const readBack = parseHandoverDoc({ path: doc.path, text: edited.value });
  if (readBack.workspace !== workspace || readBack.workspaceAlias !== undefined) {
    return {
      kind: "refused",
      problems: [`${doc.slug}: the edited front matter did not read back as workspace: ${workspace} — nothing written`],
    };
  }
  try {
    writeFileAtomic({ contents: edited.value, path: target });
  } catch (cause: unknown) {
    return { kind: "refused", problems: [`could not write ${doc.path}: ${String(cause)}`] };
  }
  return { from, kind: "written" };
}
