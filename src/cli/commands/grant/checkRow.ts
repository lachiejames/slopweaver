/**
 * The one edge that turns a grant id into a checked row — shared by `show` and `perform` so the two verbs
 * cannot drift into judging a row differently.
 *
 * Every observation the pure `grants/verify.ts` needs is made here, in one place: whether the anchor resolves,
 * whether a file target is actually there, and what the session says it is about to write. A console record
 * (`talk:`, `talk-call:`) is read through `handover/hisWordsResolve.ts`, which owns those records and refuses one
 * that is missing, malformed or not the owner's; a card landing (`call:`) is refused, since its reader does not
 * check which console recorded the words; a transcript pointer or URL is judged on its shape alone, as before, and
 * never opened. `undefined` is preserved
 * where the edge could not look — a system target has no path to stat, and "I could not look" must never
 * arrive as "it is not there". The same holds one level up: a store that could not be read is the OUTER
 * failure, never an empty journal that would make every row `ROW_MISSING`.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import type { GrantCheckError } from "../../../grants/errors.js";
import type { GrantEntry, GrantRow } from "../../../grants/grant.js";
import type { GrantJournalPort } from "../../../grants/port.js";
import type { GrantStoreError } from "../../../grants/storeErrors.js";
import { type AnchorResolution, anchorShapeOf, verifyGrant } from "../../../grants/verify.js";
import { resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";

/** Never read: `ROW_MISSING` is checked before the anchor, so a missing row's anchor is never judged. */
const NO_ROW: AnchorResolution = { kind: "unresolved", why: "no row carries this id" };

/** The journal as read, and the verdict on one row of it. */
export interface CheckedGrant {
  readonly entries: readonly GrantEntry[];
  readonly verified: Result<GrantRow, GrantCheckError>;
}

/**
 * Read the journal and run every computable check on one row.
 *
 * @param grantId the row the session was pointed at
 * @param home the state home whose store holds the journal
 * @param proposedChange exactly what the session is about to write, or `undefined` when it is only reading
 * @param journal where the journal is read from
 * @returns the journal alongside the verified row, or the store refusal when the journal could not be read
 */
export async function checkRow({
  grantId,
  home,
  proposedChange,
  journal,
}: {
  grantId: string;
  home: string;
  proposedChange: string | undefined;
  journal: GrantJournalPort;
}): Promise<Result<CheckedGrant, GrantStoreError>> {
  const read = await journal.readEntries({ home });
  if (read.isErr()) {
    return err(read.error);
  }
  const entries = read.value;
  const row = entries.flatMap((entry) =>
    entry.kind === "grant" && entry.grant.id === grantId ? [entry.grant] : [],
  )[0];
  const verified = verifyGrant({
    entries,
    facts: {
      anchorResolves: row === undefined ? NO_ROW : observeAnchor({ anchor: row.anchor, home }),
      proposedChange,
      targetPresent: row?.target.kind === "file" ? existsSync(row.target.path) : undefined,
    },
    grantId,
  });
  return ok({ entries, verified });
}

/**
 * Whether one anchor resolves: a console record is read for real, a transcript pointer or URL passes on its shape.
 * The resolver's refusal is carried verbatim, so the session reads the owning reader's reason, not a paraphrase.
 */
function observeAnchor({ anchor, home }: { anchor: string; home: string }): AnchorResolution {
  const shape = anchorShapeOf({ anchor });
  if (shape === "unrecognised") {
    return {
      kind: "unresolved",
      why: "it is neither a console record (talk:, talk-call:), a transcript pointer nor a URL",
    };
  }
  if (shape === "card-landing") {
    return {
      kind: "unresolved",
      why:
        "a card landing (call:) does not say which console recorded the words — anchor on the stretch itself, " +
        "talk-call:<call>#<segment>",
    };
  }
  if (shape !== "console-record") {
    return { kind: "resolved" };
  }
  // projectsDir is read only by the transcript scheme, which never reaches here; passed so the resolver stays whole.
  const read = resolveRawWords({ anchor, home, projectsDir: join(claudeHomeDir(), "projects") });
  if (read.isErr()) {
    return { kind: "unresolved", why: read.error.message };
  }
  return { kind: "resolved" };
}
