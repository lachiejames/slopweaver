/**
 * The two `gmail triage` readings an ACT takes its ids from — `--card`, the pinned ids an answer archives, and
 * `--ruled`, the ids every declared archive rule covers. Neither reads card standing: both act on mail already
 * decided, so whether a group is carded says nothing to them. Split out of `./triageRun.ts`, which dispatches here.
 */
import { safeJsonStringify } from "#lib/safeJson.js";

import type { GmailTriageDocument } from "../../../live/gmail/triage.js";
import { pinnedStillInInbox, ruledTriageIds } from "../../../live/gmail/triageActs.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import type { GmailTriageArgs } from "./triageCore.js";
import type { TriagePinDeps } from "./triagePin.js";

/** The seams these two readings print through, and the pin reader `--card` takes. */
type TriageActDeps = Pick<TriagePinDeps, "readCard" | "writeDiagnostic"> & {
  readonly writeOut: (line: string) => void;
};

/**
 * Print the pinned ids of one card a fresh reading still finds in the inbox; none left is exit 3. A reading that
 * stopped at the message cap cannot tell "left the inbox" from "past the cap", so a pinned id it misses refuses
 * the whole card rather than shrinking the set, and an answer acts on nothing until a wider reading finds them.
 *
 * @param home the state home the pin is read under
 * @param slug the card whose pin is read
 * @returns the exit code: 0 with ids left, 3 with none, 1 when the pin did not read or the reading was capped short
 */
export function printCard({
  args,
  deps,
  document,
  home,
  slug,
}: {
  args: GmailTriageArgs;
  deps: TriageActDeps;
  document: GmailTriageDocument;
  home: string;
  slug: string;
}): number {
  const card = deps.readCard({ home, slug });
  if (card.isErr()) {
    deps.writeDiagnostic(card.error.message);
    return EXIT_ERROR;
  }
  const { ids: pinned, key, pinnedAtIso } = card.value;
  const ids = pinnedStillInInbox({ document, pinned });
  if (!document.complete && ids.length < pinned.length) {
    deps.writeDiagnostic(
      `gmail triage: card ${slug} — ${String(pinned.length - ids.length)} of ${String(pinned.length)} pinned id(s) ` +
        `were not in a reading that STOPPED at the message cap (--limit ${String(args.limit)}), so they may still ` +
        "be in the inbox; act on nothing, and re-run with a higher --limit",
    );
    return EXIT_ERROR;
  }
  if (args.json) {
    const value = { card: slug, ids, key, pinned: pinned.length, pinnedAtIso };
    deps.writeOut(safeJsonStringify({ label: "gmail triage card", space: 2, value }));
  } else {
    deps.writeOut(
      `card ${slug} · key ${key} · pinned ${pinnedAtIso}\n` +
        `${String(ids.length)} of ${String(pinned.length)} pinned id(s) still in the inbox: ${ids.join(" ")}`,
    );
  }
  return ids.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Print the ids every declared archive rule covers; none is exit 3. A reading that stopped at the message cap still
 * prints — every id it holds IS in the inbox — and says on stderr that more ruled mail may sit past the cap.
 *
 * @returns the exit code: 0 with ruled ids, 3 with none
 */
export function printRuled({
  args,
  deps,
  document,
}: {
  args: GmailTriageArgs;
  deps: TriageActDeps;
  document: GmailTriageDocument;
}): number {
  const { groups, ids } = ruledTriageIds({ document });
  if (!document.complete) {
    deps.writeDiagnostic(
      `gmail triage: the reading STOPPED at the message cap (--limit ${String(args.limit)}), so ruled mail may sit ` +
        "past it; archive these, then re-run with a higher --limit",
    );
  }
  if (args.json) {
    const value = { complete: document.complete, groups, ids };
    deps.writeOut(safeJsonStringify({ label: "gmail triage ruled", space: 2, value }));
  } else {
    deps.writeOut(
      [
        `${String(ids.length)} inbox message(s) under a declared archive rule`,
        ...groups.map((group) => `${group.key} (${String(group.ids.length)}): ${group.ids.join(" ")}`),
      ].join("\n"),
    );
  }
  return ids.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}
