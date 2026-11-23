/**
 * The press partition: every row of the owner's and every bump in one pass, three per repository of anybody else's.
 *
 * The case worth reading first is the seven bumps: that once took the chair three
 * invocations under the old global cap, and it is what this module exists to press in one.
 */
import { describe, expect, it } from "vitest";

import { dependencyBotActors } from "../../../organisation/dependencyBots.js";
import type { LandingRow } from "../../../review/landing.js";
import { isOwnerToPress, partitionPressableRows } from "../../../review/landingPressSelection.js";
import { landingRowFake } from "../../landingRowFake.js";

/** An install with no organisation of its own: the generic Renovate and Dependabot alone. */
const GENERIC = dependencyBotActors({ dependencyBots: [] });

/** An install whose organisation names its own self-hosted Renovate App, `acme-renovate`. */
const CONFIGURED = dependencyBotActors({ dependencyBots: ["acme-renovate"] });

/** A colleague's ordinary green row — neither the owner's read nor a bump. */
const theirs = ({ repoSlug = "acme/widgets", number }: { repoSlug?: string; number: number }): LandingRow =>
  landingRowFake({
    authorLogin: "a-colleague",
    headRefName: `feature/${String(number)}`,
    number,
    repoSlug,
    title: "a change",
    url: `https://github.com/${repoSlug}/pull/${String(number)}`,
  });

/** A bot-authored renovate bump. */
const bump = ({ repoSlug = "acme/widgets", number }: { repoSlug?: string; number: number }): LandingRow =>
  landingRowFake({
    authorIsBot: true,
    authorLogin: "acme-renovate",
    headRefName: `renovate/dep-${String(number)}`,
    number,
    repoSlug,
    title: `Update dependency dep-${String(number)} to v2`,
    url: `https://github.com/${repoSlug}/pull/${String(number)}`,
  });

/** `owner/name#number` for each row, the exact shape every assertion below compares. */
const keys = ({ rows }: { rows: readonly LandingRow[] }): string[] =>
  rows.map((row) => `${row.repoSlug}#${String(row.number)}`);

describe("partitionPressableRows", () => {
  it("presses all seven ready bumps in ONE pass — the case that once took three", () => {
    const numbers = [17522, 17524, 17531, 17535, 17553, 17554, 17653];
    const partition = partitionPressableRows({
      bots: GENERIC,
      authoredByOwner: false,
      nonOwnerCapPerRepo: 3,
      rows: numbers.map((number) => bump({ number, repoSlug: "acme/acme-admin" })),
    });
    expect(keys({ rows: partition.toPress })).toEqual(numbers.map((number) => `acme/acme-admin#${String(number)}`));
    expect(partition.capped).toEqual([]);
  });

  it("presses every row of an --author @me read, however many", () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((number) => theirs({ number }));
    const partition = partitionPressableRows({ bots: GENERIC, authoredByOwner: true, nonOwnerCapPerRepo: 3, rows });
    expect(keys({ rows: partition.toPress })).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `acme/widgets#${String(n)}`));
    expect(partition.capped).toEqual([]);
  });

  it("caps anybody else's rows per REPOSITORY, not per invocation", () => {
    const rows = [
      ...[1, 2, 3, 4].map((number) => theirs({ number, repoSlug: "acme/one" })),
      ...[1, 2, 3, 4].map((number) => theirs({ number, repoSlug: "acme/two" })),
    ];
    const partition = partitionPressableRows({ bots: GENERIC, authoredByOwner: false, nonOwnerCapPerRepo: 3, rows });
    expect(keys({ rows: partition.toPress })).toEqual([
      "acme/one#1",
      "acme/one#2",
      "acme/one#3",
      "acme/two#1",
      "acme/two#2",
      "acme/two#3",
    ]);
    expect(keys({ rows: partition.capped })).toEqual(["acme/one#4", "acme/two#4"]);
  });

  it("counts one repository once however the read cased it — a counterexample", () => {
    const rows = [
      ...[1, 2, 3].map((number) => theirs({ number, repoSlug: "Acme/Widgets" })),
      ...[4, 5, 6].map((number) => theirs({ number, repoSlug: "acme/widgets" })),
    ];
    const partition = partitionPressableRows({ bots: GENERIC, authoredByOwner: false, nonOwnerCapPerRepo: 3, rows });
    expect(partition.toPress.length).toBe(3);
    expect(partition.capped.length).toBe(3);
  });

  it("presses the Renovate App's bump past three colleagues — a second counterexample", () => {
    const app = landingRowFake({
      authorIsBot: true,
      authorLogin: "renovate",
      headRefName: "deps/lodash",
      number: 4,
      repoSlug: "acme/widgets",
      title: "deps: lodash 4.17.22",
      url: "https://github.com/acme/widgets/pull/4",
    });
    const rows = [...[1, 2, 3].map((number) => theirs({ number })), app];
    const partition = partitionPressableRows({ bots: GENERIC, authoredByOwner: false, nonOwnerCapPerRepo: 3, rows });
    expect(keys({ rows: partition.toPress })).toEqual([
      "acme/widgets#1",
      "acme/widgets#2",
      "acme/widgets#3",
      "acme/widgets#4",
    ]);
    expect(partition.capped).toEqual([]);
  });

  it("presses the organisation's own Renovate App's bump uncapped only where the organisation names it", () => {
    const own = landingRowFake({
      authorIsBot: true,
      authorLogin: "acme-renovate",
      headRefName: "deps/lodash",
      number: 4,
      repoSlug: "acme/widgets",
      title: "deps: lodash 4.17.22",
      url: "https://github.com/acme/widgets/pull/4",
    });
    const rows = [...[1, 2, 3].map((number) => theirs({ number })), own];
    const configured = partitionPressableRows({
      authoredByOwner: false,
      bots: CONFIGURED,
      nonOwnerCapPerRepo: 3,
      rows,
    });
    const generic = partitionPressableRows({ authoredByOwner: false, bots: GENERIC, nonOwnerCapPerRepo: 3, rows });
    expect([keys({ rows: configured.capped }), keys({ rows: generic.capped })]).toEqual([[], ["acme/widgets#4"]]);
  });

  it("never lets a bump spend a colleague's allowance", () => {
    const rows = [
      bump({ number: 1 }),
      theirs({ number: 2 }),
      bump({ number: 3 }),
      ...[4, 5, 6].map((n) => theirs({ number: n })),
    ];
    const partition = partitionPressableRows({ bots: GENERIC, authoredByOwner: false, nonOwnerCapPerRepo: 3, rows });
    expect(keys({ rows: partition.toPress })).toEqual([
      "acme/widgets#1",
      "acme/widgets#2",
      "acme/widgets#3",
      "acme/widgets#4",
      "acme/widgets#5",
    ]);
    expect(keys({ rows: partition.capped })).toEqual(["acme/widgets#6"]);
  });

  it("presses the owner's and bumps even at a cap of zero, and holds every other row", () => {
    const rows = [bump({ number: 1 }), theirs({ number: 2 })];
    const partition = partitionPressableRows({ bots: GENERIC, authoredByOwner: false, nonOwnerCapPerRepo: 0, rows });
    expect(keys({ rows: partition.toPress })).toEqual(["acme/widgets#1"]);
    expect(keys({ rows: partition.capped })).toEqual(["acme/widgets#2"]);
  });

  it("selects only from pressable(): a red row reaches neither side", () => {
    const red = landingRowFake({ action: "spawn-ci", authorLogin: "acme-renovate", number: 9, ready: false });
    const partition = partitionPressableRows({
      bots: GENERIC,
      authoredByOwner: true,
      nonOwnerCapPerRepo: 3,
      rows: [red, bump({ number: 1 })],
    });
    expect(keys({ rows: partition.toPress })).toEqual(["acme/widgets#1"]);
    expect(partition.capped).toEqual([]);
  });

  it("keeps pressable()'s repository-then-number order", () => {
    const rows = [bump({ number: 5, repoSlug: "acme/two" }), bump({ number: 9 }), bump({ number: 2 })];
    const partition = partitionPressableRows({ bots: GENERIC, authoredByOwner: false, nonOwnerCapPerRepo: 3, rows });
    expect(keys({ rows: partition.toPress })).toEqual(["acme/two#5", "acme/widgets#2", "acme/widgets#9"]);
  });
});

describe("isOwnerToPress", () => {
  it("counts every bump signal, the title one included", () => {
    const byTitle = landingRowFake({
      authorLogin: "a-colleague",
      headRefName: "chore/x",
      title: "chore(deps): bump x",
    });
    const byBranch = landingRowFake({ authorLogin: "a-colleague", headRefName: "dependabot/npm/x", title: "x" });
    const byAuthor = landingRowFake({ authorLogin: "dependabot[bot]", headRefName: "x", title: "x" });
    expect(
      [byTitle, byBranch, byAuthor].map((row) => isOwnerToPress({ authoredByOwner: false, bots: GENERIC, row })),
    ).toEqual([true, true, true]);
  });

  it("does not call a title that only MENTIONS a version a bump", () => {
    const row = landingRowFake({
      authorLogin: "a-colleague",
      headRefName: "feature/x",
      title: "fix: bump x from 1 to 2",
    });
    expect(isOwnerToPress({ authoredByOwner: false, bots: GENERIC, row })).toBe(false);
  });
});
