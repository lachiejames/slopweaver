/**
 * A talk relay row and its turn, made by the SHIPPED relay code in a throwaway home: the draft is `formRelayDraft`'s,
 * the turn file `claimTurn`'s and the quote group what `resolveHisWords` reads off that file. Only the row's layout is
 * written here, in the shape `handover register` lays one out, so a guard test judges a real digest and a real record
 * rather than a restatement of either.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hisWordsFields } from "../handover/hisWords.js";
import { recordOfRead } from "../handover/hisWordsRecord.js";
import { resolveHisWords } from "../handover/hisWordsResolve.js";
import type { StatedWorkspace } from "../handover/workspace.js";
import { unwrap } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";
import { formRelayDraft } from "../talk/relayDraft.js";
import type { RelayOffer } from "../talk/relayOffer.js";
import { relayOfferSection } from "../talk/relayOfferRow.js";
import { claimTurn, type TurnRecord } from "../talk/relayStore.js";

/** The owner's words every fixture relays — synthetic, and long enough to read as speech. */
const FIXTURE_HEARD =
  "Um, can you find my rules for the reply and draft from those, rather than us going back and forth";

/** The one relay turn every fixture uses. */
const FIXTURE_TURN_ID = "3d462095-0000-442a-8c38-80591f698fed";

/** The workspace a fixture row states. */
export const FIXTURE_WORKSPACE: StatedWorkspace = {
  because: "the owner said it on the self console",
  workspace: "self",
};

/** An offer a fixture row may carry. */
export const FIXTURE_OFFER: RelayOffer = {
  belowFold: undefined,
  id: "offer-1763520000000",
  label: "Reply using the rules",
  made: "1763520000000",
  text: "Hey, this sounds interesting. Keen to hear more.",
};

/** One relay row in a throwaway home: where it is, what it says, and the turn behind it. */
export interface RelayFixture {
  readonly home: string;
  readonly handoversDir: string;
  readonly path: string;
  readonly anchor: string;
  readonly ask: string;
  readonly text: string;
  readonly turn: TurnRecord;
}

/** The row text, laid out as `handover register` writes a dispatch row, with its quote group and an optional offer. */
function rowText({
  ask,
  anchor,
  group,
  offered,
}: {
  ask: string;
  anchor: string;
  group: readonly { key: string; value: string }[];
  offered: RelayOffer | undefined;
}): string {
  const offer = offered === undefined ? [] : [relayOfferSection({ anchor, offered })];
  return [
    "---",
    "slug: talk-3d4620950000",
    "kind: ask",
    `summary: ${JSON.stringify(ask)}`,
    "status: ready",
    `anchor: ${anchor}`,
    ...group.map(({ key, value }) => `${key}: ${value}`),
    "priority: p1",
    `workspace: ${FIXTURE_WORKSPACE.workspace}`,
    `workspaceBecause: ${JSON.stringify(FIXTURE_WORKSPACE.because)}`,
    "---",
    "",
    `# ${ask}`,
    "",
    "## Work to dispatch",
    "",
    ask,
    "",
    "Registered as work a seat picks up, not as a question.",
    "",
    ...offer,
    "## How this ends",
    "",
    "`slopweaver handover settle talk-3d4620950000 --as filed|answered|declined --witness <value>`.",
    "",
  ].join("\n");
}

/**
 * Make one relay: its turn file claimed in a fresh home, and its row written on that home's board.
 *
 * @param offered the offer the relay carried, or `undefined` for none
 * @returns the fixture; the caller removes `home`
 */
export function relayFixture({ offered }: { offered: RelayOffer | undefined }): RelayFixture {
  const home = mkdtempSync(join(tmpdir(), "relay-words-"));
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: FIXTURE_HEARD,
      heardTailCut: false,
      offered,
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "Find the reply rules and draft from them.",
      turnId: FIXTURE_TURN_ID,
      typed: false,
      wordsAlone: false,
      workspace: FIXTURE_WORKSPACE,
    }),
  );
  const claim = unwrap(claimTurn({ draft, home, nowIso: "2026-11-19T02:58:29.021Z" }));
  // Claude's transcript directory is not part of the Slopweaver home, so it gets its own empty throwaway: a talk
  // anchor never reads it, and the per-file temp root removes it.
  const projectsDir = mkdtempSync(join(tmpdir(), "relay-words-projects-"));
  const read = resolveHisWords({ anchor: draft.anchor, home, projectsDir });
  const group = hisWordsFields({ record: recordOfRead({ anchor: draft.anchor, read }) });
  const handoversDir = stateHomePaths({ home }).handovers;
  const path = join(handoversDir, "talk-3d4620950000.md");
  const text = rowText({ anchor: draft.anchor, ask: draft.ask, group, offered });
  writeFileAtomic({ contents: text, path });
  return { anchor: draft.anchor, ask: draft.ask, handoversDir, home, path, text, turn: claim.record };
}
