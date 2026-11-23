import { describe, expect, it } from "vitest";
import { unseatableLineOf } from "../../lib/fleetDoctrineRows";
import { boardOf, boardRow, lists, placedOn, ranked, reconcileOf, textsOf } from "./fleetDoctrineFixture";

describe("unseatableLineOf", () => {
  it("names each held reason, a park on nothing and a started run nobody is on, and counts a row once", () => {
    const reconcile = reconcileOf({
      held: [
        { ...ranked({ id: "abc-started" }), standing: "in-flight" },
        { ...ranked({ id: "abc-released" }), standing: "in-flight" },
        { ...ranked({ id: "abc-parked" }), standing: "in-flight" },
      ],
      holds: {
        kind: "read",
        lists: lists({
          released: { ids: ["abc-released"], kind: "read" },
          repoless: ["relay-2", "relay-1", "relay-1"],
          superseded: ["fresh-supervisor-handoff-9001"],
          trunkMoved: ["finding-1"],
        }),
      },
    });
    const board = [
      boardRow({ parkedCheckpoint: "no-wake", slug: "abc-parked" }),
      boardRow({ ownerWait: "owner", parkedCheckpoint: "no-wake", slug: "abc-on-owner" }),
      boardRow({ parkedCheckpoint: "wake", slug: "abc-waking" }),
    ];
    const line = unseatableLineOf({
      board: boardOf({ rows: board }),
      reconcile: { kind: "read", value: reconcile },
    });
    expect(line.sentence).toBe(
      "7 board rows kept from a seat: 2 no repo, 1 retired chair, 1 trunk moved, 1 released, 1 parked on nothing, 1 started, nobody on it.",
    );
    expect(line.tone).toBe("attention");
    expect(textsOf({ line })).toEqual([
      ["relay-1", "relay-2"],
      ["fresh-supervisor-handoff-9001"],
      ["finding-1"],
      ["abc-released"],
      ["abc-parked"],
      ["abc-started"],
    ]);
  });

  it("calls a slug two docs claim ready-but-refused only while it is ready and unplaced", () => {
    const reconcile = reconcileOf({
      aligned: [placedOn({ id: "abc-placed" })],
      holds: { kind: "read", lists: lists({ shared: ["abc-twice", "abc-placed", "abc-held"] }) },
      ready: [ranked({ id: "abc-twice" }), ranked({ id: "abc-placed" })],
    });
    const line = unseatableLineOf({
      board: boardOf({ rows: [] }),
      reconcile: { kind: "read", value: reconcile },
    });
    expect(line.sentence).toBe("1 board row kept from a seat: 1 slug claimed twice.");
    expect(textsOf({ line })).toEqual([["abc-twice"]]);
  });

  it("never counts a row a live seat is on, whichever hold list names it", () => {
    const reconcile = reconcileOf({
      aligned: [placedOn({ id: "abc-x" })],
      held: [{ ...ranked({ id: "abc-x" }), standing: "in-flight" }],
      holds: {
        kind: "read",
        lists: lists({ released: { ids: ["abc-x"], kind: "read" }, repoless: ["abc-x"], trunkMoved: ["abc-x"] }),
      },
    });
    const board = [boardRow({ parkedCheckpoint: "no-wake", slug: "abc-x" })];
    const line = unseatableLineOf({
      board: boardOf({ rows: board }),
      reconcile: { kind: "read", value: reconcile },
    });
    expect(line).toEqual({
      groups: [],
      key: "unseatable",
      quoted: [],
      sentence: "No board row kept from a seat.",
      tone: "ok",
    });
  });

  it("names a parked checkpoint that will not read as not checked, never as a measured zero", () => {
    const reconcile = reconcileOf({ held: [{ ...ranked({ id: "abc" }), standing: "in-flight" }] });
    const board = [boardRow({ parkedCheckpoint: "unread", slug: "abc" })];
    const line = unseatableLineOf({
      board: boardOf({ rows: board }),
      reconcile: { kind: "read", value: reconcile },
    });
    expect(line.sentence).toBe("None of the board rows looked at is kept from a seat. 1 place not checked.");
    expect(textsOf({ line })).toEqual([
      [
        "1 board row carries a parked checkpoint that will not read, so whether each waits on anything was not checked (abc)",
      ],
    ]);
    expect(line.tone).toBe("unread");
  });

  it("says nothing is kept from a seat when the verb looked everywhere and found nothing", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [] }),
      reconcile: { kind: "read", value: reconcileOf() },
    });
    expect(line).toEqual({
      groups: [],
      key: "unseatable",
      quoted: [],
      sentence: "No board row kept from a seat.",
      tone: "ok",
    });
  });

  it("names each released run whose journal did not read, never only how many", () => {
    const reconcile = reconcileOf({
      holds: {
        kind: "read",
        lists: lists({
          released: {
            kind: "unread",
            unreadableIds: ["beta", "alpha"],
            why: "2 run journals carry an unreadable line",
          },
        }),
      },
    });
    const line = unseatableLineOf({ board: boardOf({ rows: [] }), reconcile: { kind: "read", value: reconcile } });
    expect(line.groups.at(-1)).toEqual({
      items: [
        {
          href: undefined,
          key: "released runs were not counted (alpha, beta)",
          text: "released runs were not counted (alpha, beta)",
          why: "2 run journals carry an unreadable line",
        },
      ],
      label: "not checked",
    });
    expect(line.tone).toBe("unread");
  });

  it("reads 'at least' and names each place the verb could not look", () => {
    const trunkWhy = "fatal: couldn't find remote ref main\nerror: fetch failed";
    const reconcile = reconcileOf({
      held: undefined,
      holds: {
        kind: "read",
        lists: lists({
          released: undefined,
          repoless: ["relay-1"],
          supersessionUnresolved: "no pinned chair",
          trunkUnread: [{ repo: "acme/app", slugs: ["finding-1", "finding-2"], why: trunkWhy }],
        }),
      },
    });
    const line = unseatableLineOf({
      board: boardOf({ rows: [] }),
      reconcile: { kind: "read", value: reconcile },
    });
    expect(line.sentence).toBe("At least 1 board row kept from a seat: 1 no repo. 4 places not checked.");
    // The trunk's own reason, a git command's stderr, is quoted apart from the words naming it, whole (steer 7).
    const trunk = "acme/app's trunk did not read, so 2 findings went unchecked (finding-1, finding-2)";
    expect(line.groups.at(-1)).toEqual({
      items: [
        {
          href: undefined,
          key: "no supervisor chair was judged retired",
          text: "no supervisor chair was judged retired",
          why: "no pinned chair",
        },
        { href: undefined, key: trunk, text: trunk, why: trunkWhy },
        ...[
          "the reconcile reading predates released runs, so none was counted (relay-1)",
          "the reconcile reading predates its held rows, so started runs with no seat were not counted (relay-1)",
        ].map((text) => ({ href: undefined, key: text, text })),
      ],
      label: "not checked",
    });
    expect(line.tone).toBe("attention");
  });

  it("names every unplaced board row beside an uncarried release list, since any could be released", () => {
    const reconcile = reconcileOf({
      holds: { kind: "read", lists: lists({ released: undefined, repoless: ["beta"] }) },
    });
    const line = unseatableLineOf({
      board: boardOf({ rows: [boardRow({ slug: "alpha" })] }),
      reconcile: { kind: "read", value: reconcile },
    });
    expect(line.sentence).toBe("At least 1 board row kept from a seat: 1 no repo. 1 place not checked.");
    expect(textsOf({ line }).at(-1)).toEqual([
      "the reconcile reading predates released runs, so none was counted (alpha, beta)",
    ]);
    expect(line.tone).toBe("attention");
  });

  it("is not read, never zero, when only the gaps are known", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [] }),
      reconcile: { kind: "read", value: reconcileOf({ holds: { kind: "absent" } }) },
    });
    expect(line.sentence).toBe("None of the board rows looked at is kept from a seat. 1 place not checked.");
    expect(line.tone).toBe("unread");
  });

  it("never reads a complete zero over a board whose scan could not finish", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [], unreadable: ["broken-row.md"], unresolved: 2 }),
      reconcile: { kind: "read", value: reconcileOf() },
    });
    expect(line.sentence).toBe("None of the board rows looked at is kept from a seat. 2 places not checked.");
    expect(line.groups.at(-1)).toEqual({
      items: ["the board could not read broken-row.md", "the board's sweep ran out of time on 2 docs"].map((text) => ({
        href: undefined,
        key: text,
        text,
      })),
      label: "not checked",
    });
    expect(line.tone).toBe("unread");
  });

  it("never floors a started run over a board gap, shown or not, since an unread doc could park it", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [boardRow({ slug: "abc-shown" })], unreadable: ["abc-hidden.md"] }),
      reconcile: {
        kind: "read",
        value: reconcileOf({
          held: [
            { ...ranked({ id: "abc-hidden" }), standing: "in-flight" },
            { ...ranked({ id: "abc-shown" }), standing: "in-flight" },
          ],
          holds: { kind: "read", lists: lists({ repoless: ["abc-repoless"] }) },
        }),
      },
    });
    expect(line.sentence).toBe("At least 1 board row kept from a seat: 1 no repo. 2 places not checked.");
    expect(line.groups.map((group) => group.items.map((item) => item.text))).toEqual([
      ["abc-repoless"],
      [
        "the board could not read abc-hidden.md",
        "a doc the board could not read may park 2 started runs with no seat, so whether each is parked was not checked (abc-hidden, abc-shown)",
      ],
    ]);
    expect(line.tone).toBe("attention");
  });

  it("names a row ranked only in top or starving beside an uncarried release list", () => {
    const reconcile = reconcileOf({
      holds: { kind: "read", lists: lists({ released: undefined }) },
      starving: [ranked({ id: "s" })],
      top: [ranked({ id: "x" })],
    });
    const line = unseatableLineOf({
      board: boardOf({ rows: [] }),
      reconcile: { kind: "read", value: reconcile },
    });
    expect(line.sentence).toBe("None of the board rows looked at is kept from a seat. 1 place not checked.");
    expect(textsOf({ line })).toEqual([["the reconcile reading predates released runs, so none was counted (s, x)"]]);
    expect(line.tone).toBe("unread");
  });

  it("names every unseated row not started, held or ready, beside a board gap, since an unread doc could park it on nothing", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [], unreadable: ["other.md"] }),
      reconcile: {
        kind: "read",
        value: reconcileOf({
          held: [{ ...ranked({ id: "w" }), standing: "waiting-on-owner" }],
          holds: { kind: "read", lists: lists({ repoless: ["kept"] }) },
          ready: [ranked({ id: "x" })],
        }),
      },
    });
    expect(line.sentence).toBe("At least 1 board row kept from a seat: 1 no repo. 2 places not checked.");
    expect(textsOf({ line }).at(-1)).toEqual([
      "the board could not read other.md",
      "a doc the board could not read may park 2 other rows with no seat, so whether each is parked on nothing was not checked (w, x)",
    ]);
    expect(line.tone).toBe("attention");
  });

  it("names a held row whose standing did not read, never reads it as not started", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [] }),
      reconcile: {
        kind: "read",
        value: reconcileOf({ held: [{ ...ranked({ id: "x" }), standing: "future-status" }] }),
      },
    });
    expect(line.sentence).toBe("None of the board rows looked at is kept from a seat. 1 place not checked.");
    expect(line.groups.map((group) => group.items.map((item) => item.text))).toEqual([
      ["1 held row carries a standing that did not read, so whether each is started was not checked (x)"],
    ]);
    expect(line.tone).toBe("unread");
  });

  it("reads no floor at all when the only started run is one the gapped board did not show", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [], unreadable: ["x.md"] }),
      reconcile: { kind: "read", value: reconcileOf({ held: [{ ...ranked({ id: "x" }), standing: "in-flight" }] }) },
    });
    expect(line.sentence).toBe("None of the board rows looked at is kept from a seat. 2 places not checked.");
    expect(line.tone).toBe("unread");
  });

  it("names every row with no seat by id when no hold list or held row was read", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [boardRow({ slug: "y" })] }),
      reconcile: {
        kind: "read",
        value: reconcileOf({ held: undefined, holds: { kind: "absent" }, ready: [ranked({ id: "x" })] }),
      },
    });
    expect(line.sentence).toBe("None of the board rows looked at is kept from a seat. 2 places not checked.");
    expect(line.groups.at(-1)!.items.map((item) => item.text)).toEqual([
      "the reconcile reading predates its hold lists, so no hold was read (x, y)",
      "the reconcile reading predates its held rows, so started runs with no seat were not counted (x, y)",
    ]);
    expect(line.tone).toBe("unread");
  });

  it("names hold lists that did not read as not checked, with why and every id they still carried", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [boardRow({ slug: "y" })] }),
      reconcile: {
        kind: "read",
        value: reconcileOf({
          holds: {
            kind: "malformed",
            named: ["secret-row"],
            repos: ["acme/one"],
            why: "a hold list it carries will not read",
          },
          ready: [ranked({ id: "x" })],
        }),
      },
    });
    expect(line.sentence).toBe("None of the board rows looked at is kept from a seat. 1 place not checked.");
    // The verb's own reason for the malformed set is quoted apart from the words naming the gap (steer 7).
    expect(line.groups.at(-1)).toEqual({
      items: [
        {
          href: undefined,
          key: "the reconcile reading's hold lists did not read, so no hold was read (secret-row, x, y), nor any trunk check in acme/one",
          text: "the reconcile reading's hold lists did not read, so no hold was read (secret-row, x, y), nor any trunk check in acme/one",
          why: "a hold list it carries will not read",
        },
      ],
      label: "not checked",
    });
    expect(line.tone).toBe("unread");
  });

  it("names the held-rows gap beside absent hold lists, never only the first gap", () => {
    const line = unseatableLineOf({
      board: boardOf({ rows: [] }),
      reconcile: { kind: "read", value: reconcileOf({ held: undefined, holds: { kind: "absent" } }) },
    });
    expect(line.sentence).toBe("None of the board rows looked at is kept from a seat. 2 places not checked.");
    expect(line.groups.at(-1)).toEqual({
      items: [
        "the reconcile reading predates its hold lists, so no hold was read",
        "the reconcile reading predates its held rows, so started runs with no seat were not counted",
      ].map((text) => ({ href: undefined, key: text, text })),
      label: "not checked",
    });
    expect(line.tone).toBe("unread");
  });

  it("is not read when the board did not arrive", () => {
    const line = unseatableLineOf({
      board: { kind: "unread", why: "the board is loading" },
      reconcile: { kind: "read", value: reconcileOf() },
    });
    expect(line).toEqual({
      groups: [],
      key: "unseatable",
      notRead: { lead: "Board rows kept from a seat: not read.", reasons: ["the board is loading"] },
      quoted: [],
      sentence: "Board rows kept from a seat: not read (the board is loading).",
      tone: "unread",
    });
  });

  it("quotes a board that did not read beneath the line, never inside its sentence (steer 7)", () => {
    const why = '{"error":"internal","detail":"board sweep crashed"}';
    const line = unseatableLineOf({
      board: { kind: "unread", why: { lead: "The board did not read", why } },
      reconcile: { kind: "unread", why: "the board reconcile is still loading" },
    });
    expect([line.sentence, line.quoted]).toEqual([
      "Board rows kept from a seat: not read (the board reconcile is still loading).",
      [{ lead: "The board did not read", why }],
    ]);
  });
});
