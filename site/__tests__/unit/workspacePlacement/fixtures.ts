/*
 * Where a row belongs — one test file per register the workspace selector filters: hand steps, asks (board rows),
 * held replies, parked posts, pull requests, autonomy acts and the Workstreams page. What those files share sits
 * here: the bare board row, the organisation's two pull request shapes, a one-evidence `team` placement, a board
 * row as the verb publishes it, and a three-row board. Moved out of workspacePlacement.test.ts unchanged.
 *
 * The rule: each row has exactly one workspace, derived from its repo, Slack workspace, Linear team or atlas, never
 * from a pattern over its title, and a row with no derivable workspace says so and is a finding, not a default to
 * Slopweaver. Every register in the sibling test files is asked the three questions that rule makes: does a
 * structured field place it, does a row with none stay unplaced, and does a row whose fields disagree say so.
 *
 * The address grammar, the joins and the conflicts are the same for any organisation, so most cases read through
 * Acme's placer. What the organisation decides — its owner, its Slack hosts, whether it has Linear or Vanta at all —
 * runs against Acme and Globex both, in `organisation.test.ts`, so a reader holding one organisation's constant
 * fails there.
 */
import { type Board, readBoard } from "../../../components/live/read";
import { type PlacedBoardFields } from "../../../lib/registerPlacement";
import { type WorkspacePlacement, type WorkspaceSource } from "../../../lib/workspacePlacement";

/** A board row with no evidence at all — what the ISO ask looked like to anything but its pull requests. */
export const BARE: PlacedBoardFields = {
  action: { kind: "none" },
  contextUnread: undefined,
  prUrls: [],
  prUrlsPartial: false,
  slug: "bare",
  tags: [],
  tagsIncomplete: undefined,
  tagsRead: "absent",
  workspace: undefined,
  workspaceUnread: undefined,
};

/** The organisation's two pull request shapes, one per workspace. */
export const ACME_ADMIN_PR = "https://github.com/acme/acme-admin/pull/17870";
/** This build's own pull request shape, the self workspace's counterpart to {@link ACME_ADMIN_PR}. */
export const SLOPWEAVER_PR = "https://github.com/octo-self/slopweaver/pull/1419";

/**
 * `team`, placed by one piece of evidence.
 * @returns a placement in team carrying exactly that one evidence row
 */
export function acmeBy({ source, value }: { source: WorkspaceSource; value: string }): WorkspacePlacement {
  return { by: [{ source, value, workspace: "team" }], kind: "placed", workspace: "team" };
}

/** A board row as `handover list --json` publishes it, IN FLIGHT, with no workspace evidence of its own. */
export const BOARD_ROW: Record<string, unknown> = {
  kind: "doc",
  options: [],
  ownerWait: "not-waiting",
  reason: "declared ready",
  repo: "/Users/x/dev/personal/slopweaver",
  section: "IN FLIGHT",
  status: "ready",
};

/**
 * A board read through the page's own reader: one team row, one self row, one with no evidence.
 * @returns the board `readBoard` parses from those three rows, in that order
 */
export function board(): Board {
  const row = ({ slug, extra }: { slug: string; extra: Record<string, unknown> }): Record<string, unknown> => ({
    kind: "doc",
    options: [],
    ownerWait: "not-waiting",
    reason: "declared ready",
    repo: "/Users/x/dev/personal/slopweaver",
    section: "IN FLIGHT",
    slug,
    status: "ready",
    ...extra,
  });
  return readBoard({
    rows: [
      row({ extra: { prUrls: [ACME_ADMIN_PR] }, slug: "iso-least-privilege" }),
      row({ extra: { workspace: "self" }, slug: "acme-console-pages-react-27-sep" }),
      row({ extra: {}, slug: "no-evidence" }),
    ],
    unresolved: 0,
  })!;
}
