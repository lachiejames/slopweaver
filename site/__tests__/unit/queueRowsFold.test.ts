/*
 * Two acts of one kind on one subject are one card on the owner's check-in list: the newest governs, the earlier
 * folds beneath it, and the owner's word on the newest settles the pair. One pull request must never draw twice as
 * two press-merge-when-ready rows.
 */

import { describe, expect, it } from "vitest";

import type { AutonomyRow } from "../../components/live/readAutonomy";
import type { LiveState } from "../../components/live/useLive";
import { foldActs } from "../../lib/actGroups";
import { rowForOpen } from "../../lib/queueOpen";
import { type QueueRow, rowsOf } from "../../lib/queueRows";
import { placedRegister, placementWaits } from "../../lib/registerPlacement";
import { ACME_PLACER, FIXTURE_SELF_REPOSITORY } from "../organisationFixture";

const LOADING = { phase: "loading" } as const;
const PR_1333 = `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/1333`;
const PR_1349 = `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/1349`;

function act({
  actionId,
  kind = "press-merge-when-ready",
  subject = PR_1333,
  doneIso,
  said,
  steer,
  patternFrom,
}: {
  actionId: string;
  kind?: string;
  subject?: string;
  doneIso: string;
  said?: string;
  steer?: string;
  patternFrom?: string;
}): AutonomyRow {
  return {
    actionId,
    directSteer: undefined,
    doneIso,
    kind,
    patternFrom,
    rule: undefined,
    run: undefined,
    said,
    standing: undefined,
    steer,
    subject,
    why: "green",
    witness: undefined,
  };
}

function ready<T>({ value }: { value: T }): LiveState<T> {
  return {
    fixture: undefined,
    observedAtIso: "2026-09-26T13:00:00.000Z",
    phase: "ready",
    stampedByRoute: false,
    value,
  };
}

function actRows({ acts }: { acts: readonly AutonomyRow[] }) {
  return rowsOf({
    reviewers: LOADING,
    standing: LOADING,
    acts: ready({ value: acts }),
    board: LOADING,
    drafts: LOADING,
    hands: LOADING,
    landing: LOADING,
    placer: ACME_PLACER,
    posts: LOADING,
    reviews: LOADING,
    imports: LOADING,
  }).filter((row) => row.kind === "act");
}

const REQUEUE = act({ actionId: "1333-requeue-bf280fc7", doneIso: "2026-09-26T09:42:34.101Z" });
const ENQUEUE = act({ actionId: "1333-enqueue", doneIso: "2026-09-26T08:41:13.315Z" });
const OTHER_PR = act({ actionId: "1349-enqueue", doneIso: "2026-09-26T09:15:42.285Z", subject: PR_1349 });
const OTHER_KIND = act({ actionId: "1333-rerun", doneIso: "2026-09-26T08:00:00.000Z", kind: "rerun-transient-ci" });

describe("two presses on one pull request on the owner's check-in list", () => {
  it("draws one card, the newest press, with the earlier folded beneath it", () => {
    const rows = actRows({ acts: [REQUEUE, OTHER_PR, ENQUEUE] });
    expect(rows.map((row) => row.id)).toEqual(["1333-requeue-bf280fc7", "1349-enqueue"]);
    const record = rows[0].record as Extract<QueueRow["record"], { kind: "act" }>;
    expect([record.kind, record.act, record.earlier]).toEqual(["act", REQUEUE, [ENQUEUE]]);
  });

  it("still opens the one card from a deep link naming the earlier press", () => {
    const rows = actRows({ acts: [REQUEUE, ENQUEUE] });
    expect(rowForOpen({ open: "act:1333-enqueue", rows })!.key).toBe("act:1333-requeue-bf280fc7");
  });

  it("takes the pair off the list once the newest carries the owner's word", () => {
    expect(actRows({ acts: [{ ...REQUEUE, steer: "A" }, ENQUEUE] })).toEqual([]);
  });

  it("keeps the card when only the earlier press carries the owner's word, given before the later one existed", () => {
    expect(actRows({ acts: [REQUEUE, { ...ENQUEUE, steer: "A" }] }).map((row) => row.id)).toEqual([
      "1333-requeue-bf280fc7",
    ]);
  });
});

describe("a row placed by the board it joins waits for the board", () => {
  it("holds a hand step and an act while the board loads, and nothing else", () => {
    const kinds = ["hand", "act", "ask", "draft", "post", "review", "import", "pr"] as const;
    expect(kinds.filter((kind) => placementWaits({ board: LOADING, row: { record: { kind } } }))).toEqual([
      "hand",
      "act",
    ]);
  });

  it("holds one stopping the owner's work as well, so no view names it a provisional owner", () => {
    const stopping = { reason: "marked" } as const;
    const row = { record: { kind: "hand" }, stopping };
    expect([placementWaits({ board: LOADING, row }), placementWaits({ board: ready({ value: [] }), row })]).toEqual([
      true,
      false,
    ]);
  });

  it("draws them once the board is read, and as findings when it could not be", () => {
    const failed = { phase: "not-measured", why: "handover list timed out" } as const;
    expect(placementWaits({ board: ready({ value: [] }), row: { record: { kind: "hand" } } })).toBe(false);
    expect(placementWaits({ board: failed, row: { record: { kind: "act" } } })).toBe(false);
  });

  it("reads the hands and acts registers as loading until the board is read", () => {
    expect(placedRegister({ board: LOADING, state: ready({ value: [] }) })).toEqual(LOADING);
    expect(placedRegister({ board: ready({ value: [] }), state: ready({ value: ["h"] }) })).toEqual(
      ready({ value: ["h"] }),
    );
  });
});

describe("what the fold keeps apart", () => {
  it("keeps a different kind on the same pull request as its own card", () => {
    expect(foldActs({ acts: [REQUEUE, ENQUEUE, OTHER_KIND] }).map((group) => group.act.actionId)).toEqual([
      "1333-requeue-bf280fc7",
      "1333-rerun",
    ]);
  });

  it("keeps an unplaced act apart from a newer act on the same subject placed in one workspace", () => {
    const placed = {
      ...act({ actionId: "new", doneIso: "2026-09-26T12:00:00.000Z", kind: "deploy", subject: "deployed production" }),
      run: "ever-row",
    };
    const unplaced = act({
      actionId: "old",
      doneIso: "2026-09-26T11:00:00.000Z",
      kind: "deploy",
      subject: "deployed production",
    });
    const apart = (one: AutonomyRow): string => (one.run === undefined ? "unplaced" : "placed:team");
    expect(foldActs({ acts: [placed, unplaced], apart }).map((group) => group.act.actionId)).toEqual(["new", "old"]);
  });

  it("folds nothing on an empty ledger read", () => {
    expect(foldActs({ acts: [] })).toEqual([]);
  });

  it("keeps two acts of one kind on two subjects apart when neither carries a plain-words line", () => {
    expect(foldActs({ acts: [REQUEUE, OTHER_PR] }).map((group) => group.act.actionId)).toEqual([
      "1333-requeue-bf280fc7",
      "1349-enqueue",
    ]);
  });
});

/*
 * One thing done seven times is one card, and the owner's one word settles it. Measured: seven acme-admin
 * security-bump rebases, each written up in one sentence, drew seven cards, while a standing instruction the owner
 * had already given should have cleared them all off the Queue.
 */
const SAID =
  "I rebased your security PR onto staging so the reviewer sees it green; the dependency change itself is unchanged";
const ACME_ADMIN = "https://github.com/acme/acme-admin/pull";
const REBASE_PULLS = ["17519", "17535", "17553", "17522", "17524", "17531", "17554"];
const REBASES = REBASE_PULLS.map((pull, index) =>
  act({
    actionId: `${pull}-rebase-2026-09-28`,
    doneIso: `2026-09-28T01:49:3${String(9 - index)}.000Z`,
    kind: "rebase",
    said: SAID,
    subject: `${ACME_ADMIN}/${pull}`,
  }),
);

describe("seven rebases written up in one sentence on the owner's check-in list", () => {
  it("draw one card about all seven pull requests, leading with what was done", () => {
    const rows = actRows({ acts: REBASES });
    expect(rows.map((row) => row.id)).toEqual(["17519-rebase-2026-09-28"]);
    const [row] = rows;
    expect([row.card.question, row.card.subject, row.card.what!.whole]).toEqual([
      "Was rebase on these 7 pull requests the right call?",
      "7 pull requests",
      `7 pull requests: ${SAID}`,
    ]);
  });

  it("fold every earlier rebase under the newest, open from any of their deep links, and find by any of them", () => {
    const rows = actRows({ acts: REBASES });
    const record = rows[0].record as Extract<QueueRow["record"], { kind: "act" }>;
    expect(record.earlier.map((was) => was.actionId)).toEqual(REBASES.slice(1).map((was) => was.actionId));
    expect(record.subjects).toEqual(REBASE_PULLS.map((pull) => `${ACME_ADMIN}/${pull}`));
    expect(rowForOpen({ open: "act:17554-rebase-2026-09-28", rows })!.key).toBe("act:17519-rebase-2026-09-28");
    expect(rows[0].hint).toContain(`${ACME_ADMIN}/17554`);
  });

  it("link every folded pull request, and look none up by branch", () => {
    const record = actRows({ acts: REBASES })[0].record as Extract<QueueRow["record"], { kind: "act" }>;
    const links = record.links as Extract<typeof record.links, { kind: "linked" }>;
    expect([record.lookupBranch, links.kind]).toEqual([undefined, "linked"]);
    expect(links.links.map((link) => link.label)).toEqual(REBASE_PULLS.map((pull) => `acme/acme-admin#${pull}`));
  });

  it("leave the list once the newest carries the owner's word, as the register projects it onto the rest", () => {
    const steered = REBASES.map((one) => ({ ...one, steer: "definitely the desired behavior" }));
    expect(actRows({ acts: steered })).toEqual([]);
  });

  it("stay one card when only an earlier rebase carries the owner's word", () => {
    const [newest, second, ...rest] = REBASES;
    const rows = actRows({ acts: [newest, { ...second, steer: "right call" }, ...rest] });
    expect(rows.map((row) => row.id)).toEqual(["17519-rebase-2026-09-28"]);
  });

  it("keep a rebase written up in a different sentence as its own card", () => {
    const [newest, second, ...rest] = REBASES;
    const rows = actRows({ acts: [newest, { ...second, said: `${SAID}.` }, ...rest] });
    expect(rows.map((row) => row.id)).toEqual(["17519-rebase-2026-09-28", "17535-rebase-2026-09-28"]);
  });
});

describe("a pattern whose subjects are not all pull requests", () => {
  it("counts them as subjects", () => {
    const issue = `https://github.com/${FIXTURE_SELF_REPOSITORY}/issues/1`;
    const acts = [
      act({ actionId: "one", doneIso: "2026-09-28T02:00:00.000Z", kind: "rebase", said: SAID, subject: PR_1333 }),
      act({ actionId: "two", doneIso: "2026-09-28T01:00:00.000Z", kind: "rebase", said: SAID, subject: issue }),
    ];
    expect(actRows({ acts })[0].card.subject).toBe("2 subjects");
  });

  it("never joins a subject naming no workspace to one placed in a workspace, however alike they are written", () => {
    const acts = [
      act({ actionId: "one", doneIso: "2026-09-28T02:00:00.000Z", kind: "rebase", said: SAID, subject: PR_1333 }),
      act({ actionId: "two", doneIso: "2026-09-28T01:00:00.000Z", kind: "rebase", said: SAID, subject: "a-board-row" }),
    ];
    expect(actRows({ acts }).map((row) => [row.id, row.placement.kind])).toEqual([
      ["one", "placed"],
      ["two", "unplaced"],
    ]);
  });
});

/*
 * The register projects the owner's word on a pattern's newest act onto every earlier one, and it reads no board. A
 * word given on a card in one workspace must not take an act off the other workspace's list, which that card never
 * showed.
 */
describe("the owner's word on a pattern's newest act", () => {
  const acme = act({
    actionId: "ev",
    doneIso: "2026-09-28T02:00:00.000Z",
    kind: "rebase",
    said: SAID,
    steer: "right call",
    subject: `${ACME_ADMIN}/17519`,
  });
  const alike = act({
    actionId: "ev-older",
    doneIso: "2026-09-28T01:30:00.000Z",
    kind: "rebase",
    patternFrom: "ev",
    said: SAID,
    steer: "right call",
    subject: `${ACME_ADMIN}/17535`,
  });
  const elsewhere = act({
    actionId: "slop",
    doneIso: "2026-09-28T01:00:00.000Z",
    kind: "rebase",
    patternFrom: "ev",
    said: SAID,
    steer: "right call",
    subject: PR_1333,
  });

  it("settles the acts placed alike, and leaves the act in the other workspace on its list", () => {
    expect(actRows({ acts: [acme, alike, elsewhere] }).map((row) => [row.id, row.record.kind])).toEqual([
      ["slop", "act"],
    ]);
  });

  it("settles nothing when the act it was given on is not in the reading, since nothing can place that act", () => {
    expect(actRows({ acts: [alike] }).map((row) => row.id)).toEqual(["ev-older"]);
  });

  it("leaves a word the owner gave on the act itself alone, wherever the newest is placed", () => {
    expect(actRows({ acts: [acme, { ...elsewhere, patternFrom: undefined }] })).toEqual([]);
  });
});
