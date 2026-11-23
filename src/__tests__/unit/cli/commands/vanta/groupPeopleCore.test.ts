/**
 * The pure core of `write vanta group-people`: the repeated-flag reader that refuses rather than drops, the
 * option parse, and the three-state execution record the renderers and the exit code read.
 */
import { describe, expect, it } from "vitest";

import { resolveVantaWriteRequest } from "../../../../../atlas/vanta/writePreview.js";
import type { VantaGroupPeopleReport } from "../../../../../cli/commands/vanta/groupPeopleCore.js";
import {
  exitCodeForVantaGroupPeople,
  parseVantaGroupPeopleOptions,
  readDirectedIds,
  renderVantaGroupPeopleDryRun,
  renderVantaGroupPeopleOutcome,
  VANTA_GROUP_PEOPLE_FLAG_NAMES,
  VANTA_GROUP_PEOPLE_USAGE,
} from "../../../../../cli/commands/vanta/groupPeopleCore.js";
import { unwrap } from "../../../../../lib/result.js";

const parse = ({ rest }: { rest: readonly string[] }) =>
  parseVantaGroupPeopleOptions({ defaultHome: "/default-home", rest });

describe("readDirectedIds", () => {
  it("keeps every occurrence of a repeated flag, in the order written", () => {
    const read = readDirectedIds({ rest: ["--add", "p1", "--add", "p2", "--add", "p3"] });
    expect(read.add).toEqual(["p1", "p2", "p3"]);
    expect(read.problems).toEqual([]);
  });

  it("reads the equals spelling too, and mixes the two", () => {
    const read = readDirectedIds({ rest: ["--add=p1", "--add", "p2"] });
    expect(read.add).toEqual(["p1", "p2"]);
  });

  it("splits a comma-separated value, so a plan copied off a card means the same thing either way", () => {
    const read = readDirectedIds({ rest: ["--remove", "p1,p2 , p3"] });
    expect(read.remove).toEqual(["p1", "p2", "p3"]);
  });

  it("keeps the two directions apart while reading them in one interleaved walk", () => {
    const read = readDirectedIds({ rest: ["--add", "p1", "--remove", "p2", "--add=p3", "--remove", "p4"] });
    expect(read.add).toEqual(["p1", "p3"]);
    expect(read.remove).toEqual(["p2", "p4"]);
    expect(read.problems).toEqual([]);
  });

  it("hands back the rest of the tail with both directions' tokens removed", () => {
    const read = readDirectedIds({ rest: ["--group", "g1", "--add", "p1", "--remove", "p2", "--json"] });
    expect(read.rest).toEqual(["--group", "g1", "--json"]);
  });

  it("REFUSES a valueless occurrence rather than dropping the person it was meant to name", () => {
    const read = readDirectedIds({ rest: ["--add", "--json"] });
    expect(read.add).toEqual([]);
    expect(read.problems).toEqual(["--add was given with no value — every occurrence must name a person id"]);
  });

  it("refuses a valueless --remove whose next token is the OTHER direction's flag", () => {
    // The regression found on `no-silent-scope-change`: reading `--add` first and
    // feeding its leftover tail to `--remove` stripped `--add p1`, leaving `--remove p2` — a neighbour the
    // operator never wrote — so the verb planned to remove p2 and said nothing. One walk is what fixes it.
    const read = readDirectedIds({ rest: ["--group", "g1", "--remove", "--add", "p1", "p2"] });
    expect(read.remove).toEqual([]);
    expect(read.add).toEqual(["p1"]);
    expect(read.problems).toEqual(["--remove was given with no value — every occurrence must name a person id"]);
    expect(read.rest).toEqual(["--group", "g1", "p2"]);
  });

  it("refuses the mirror image, a valueless --add followed by --remove", () => {
    const read = readDirectedIds({ rest: ["--group", "g1", "--add", "--remove", "p1", "p2"] });
    expect(read.add).toEqual([]);
    expect(read.remove).toEqual(["p1"]);
    expect(read.problems).toEqual(["--add was given with no value — every occurrence must name a person id"]);
  });

  it("refuses a trailing occurrence with nothing after it at all", () => {
    const read = readDirectedIds({ rest: ["--add"] });
    expect(read.problems.length).toBe(1);
  });

  it("refuses an empty segment between two commas rather than silently sending one fewer person", () => {
    const read = readDirectedIds({ rest: ["--add", "p1,,p2"] });
    expect(read.add).toEqual([]);
    expect(read.problems[0]).toContain("which carries an empty id");
  });

  it("leaves a flag whose name merely starts the same alone", () => {
    const read = readDirectedIds({ rest: ["--address", "x"] });
    expect(read.add).toEqual([]);
    expect(read.rest).toEqual(["--address", "x"]);
  });

  it("finds nothing in a tail that names neither direction", () => {
    const read = readDirectedIds({ rest: ["--group", "g1"] });
    expect(read.add).toEqual([]);
    expect(read.remove).toEqual([]);
    expect(read.problems).toEqual([]);
  });
});

describe("parseVantaGroupPeopleOptions", () => {
  it("reads an add-only invocation", () => {
    const parsed = parse({ rest: ["--group", "g1", "--add", "p1", "--add", "p2"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).plan).toEqual({ add: [{ id: "p1" }, { id: "p2" }], groupId: "g1", remove: [] });
  });

  it("reads a remove-only invocation", () => {
    const parsed = parse({ rest: ["--group", "g1", "--remove", "p9"] });
    expect(unwrap(parsed).plan).toEqual({ add: [], groupId: "g1", remove: [{ id: "p9" }] });
  });

  it("reads both directions at once and keeps each side's order", () => {
    const parsed = parse({ rest: ["--group", "g1", "--add", "p1", "--remove", "p8", "--add", "p2"] });
    expect(unwrap(parsed).plan.add).toEqual([{ id: "p1" }, { id: "p2" }]);
    expect(unwrap(parsed).plan.remove).toEqual([{ id: "p8" }]);
  });

  it("defaults home, json, dry-run and approve when none is given", () => {
    const parsed = parse({ rest: ["--group", "g1", "--add", "p1"] });
    expect(unwrap(parsed).base).toEqual({
      approve: null,
      clientIdFile: null,
      clientSecretFile: null,
      dryRun: false,
      home: "/default-home",
      json: false,
    });
  });

  it("reads every flag it advertises", () => {
    const parsed = parse({
      rest: [
        "--group",
        "g1",
        "--add",
        "p1",
        "--remove",
        "p2",
        "--approve",
        "abcdef0123456789",
        "--dry-run",
        "--json",
        "--home",
        "/elsewhere",
        "--client-id-file",
        "/id",
        "--client-secret-file",
        "/secret",
      ],
    });
    expect(unwrap(parsed).base).toEqual({
      approve: "abcdef0123456789",
      clientIdFile: "/id",
      clientSecretFile: "/secret",
      dryRun: true,
      home: "/elsewhere",
      json: true,
    });
  });

  it("refuses an invocation naming no group", () => {
    const parsed = parse({ rest: ["--add", "p1"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--group is required — name the group by its Vanta id"]);
  });

  it("refuses a blank group rather than addressing `/v1/groups//add-people`", () => {
    const parsed = parse({ rest: ["--group", "  ", "--add", "p1"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("--group is required");
  });

  it("refuses an email address where a person id belongs, naming the read that maps one to the other", () => {
    const parsed = parse({ rest: ["--group", "g1", "--add", "someone@acme.com"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("which is an email address");
    expect(parsed._unsafeUnwrapErr()[0]).toContain("atlas vanta read --kind person");
  });

  it("refuses an email on the remove side too", () => {
    const parsed = parse({ rest: ["--group", "g1", "--remove", "someone@acme.com"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("--remove was given");
  });

  it("never lets one direction's flag become the other direction's value — the whole-verb witness", () => {
    // `--remove --add p1 p2` once parsed clean as add=[p1], remove=[p2]: p2 was a stray positional the
    // operator never pointed at anybody, and the verb planned to take that person OUT of the group.
    const parsed = parse({ rest: ["--group", "g1", "--remove", "--add", "p1", "p2"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed._unsafeUnwrapErr()).toEqual([
      "--remove was given with no value — every occurrence must name a person id",
      "unexpected argument: p2",
    ]);
  });

  it("refuses an unknown flag rather than ignoring it", () => {
    const parsed = parse({ rest: ["--group", "g1", "--add", "p1", "--force"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed._unsafeUnwrapErr().join(" ")).toContain("--force");
  });

  it("carries a valueless --add through to the caller as a refusal, not a smaller plan", () => {
    const parsed = parse({ rest: ["--group", "g1", "--add", "--json"] });
    expect(parsed.isOk()).toBe(false);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("--add was given with no value");
  });

  it("leaves the empty plan to the endpoint's own rule rather than duplicating it here", () => {
    const parsed = parse({ rest: ["--group", "g1"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed).plan).toEqual({ add: [], groupId: "g1", remove: [] });
  });
});

describe("VANTA_GROUP_PEOPLE_FLAG_NAMES", () => {
  it("names flags the real parser accepts", () => {
    expect(VANTA_GROUP_PEOPLE_FLAG_NAMES.length).toBeGreaterThan(0);
    const unusable = VANTA_GROUP_PEOPLE_FLAG_NAMES.filter(
      (flag) => !VANTA_GROUP_PEOPLE_USAGE.includes(flag.replace(/^--/, "")),
    );
    expect(unusable).toEqual([]);
  });
});

describe("renderVantaGroupPeopleDryRun", () => {
  const legs = [
    {
      direction: "add" as const,
      request: resolveVantaWriteRequest({
        input: { groupId: "g1", updates: [{ id: "p1" }, { id: "p2" }] },
        kind: "add-people-to-group",
      }),
      updates: [{ id: "p1" }, { id: "p2" }],
    },
  ];

  it("leads with what would change and that nothing was sent", () => {
    const lines = renderVantaGroupPeopleDryRun({ digest: "abcdef0123456789", groupId: "g1", legs });
    expect(lines[0]).toBe(
      "vanta group-people --dry-run: 2 membership change(s) to group g1 across 1 call(s), nothing was sent " +
        "(Vanta's own batch maximum is 100 per call)",
    );
  });

  it("prints the bytes the wire carries, not a description of them", () => {
    const lines = renderVantaGroupPeopleDryRun({ digest: "abcdef0123456789", groupId: "g1", legs });
    expect(lines).toContain("POST /v1/groups/g1/add-people");
    expect(lines).toContain('{"updates":[{"id":"p1"},{"id":"p2"}]}');
  });

  it("names every person it would move", () => {
    const lines = renderVantaGroupPeopleDryRun({ digest: "abcdef0123456789", groupId: "g1", legs });
    expect(lines).toContain("  p1");
    expect(lines).toContain("  p2");
  });

  it("ends with the approval that sends exactly this plan", () => {
    const lines = renderVantaGroupPeopleDryRun({ digest: "abcdef0123456789", groupId: "g1", legs });
    expect(lines).toContain("to send exactly this plan: --approve abcdef0123456789");
  });

  it("never prints a real bearer token", () => {
    const lines = renderVantaGroupPeopleDryRun({ digest: "abcdef0123456789", groupId: "g1", legs });
    expect(lines).toContain("  authorization: Bearer <token>");
  });
});

describe("renderVantaGroupPeopleOutcome", () => {
  it("counts both arms of a leg a 200 accepted but Vanta refused half of", () => {
    const report: VantaGroupPeopleReport = {
      groupId: "g1",
      outcomes: [
        {
          state: "completed",
          summary: {
            attempted: 2,
            direction: "add",
            failed: [{ id: "p2", message: "no such person" }],
            succeeded: ["p1"],
          },
        },
      ],
    };
    const lines = renderVantaGroupPeopleOutcome({ report });
    expect(lines[0]).toBe("vanta group-people: group g1");
    expect(lines).toContain("  INTO the group: 1/2");
    expect(lines).toContain("    ok p1");
    expect(lines).toContain("    REFUSED p2: no such person");
  });

  it("says UNKNOWN per person for a leg that was SENT and could not be read", () => {
    const report: VantaGroupPeopleReport = {
      groupId: "g1",
      outcomes: [
        {
          direction: "remove",
          problems: ["Vanta reported nothing about p3, which this call sent — its outcome is UNKNOWN"],
          requestedIds: ["p3"],
          state: "unconfirmed",
        },
      ],
    };
    const lines = renderVantaGroupPeopleOutcome({ report });
    expect(lines).toContain("  OUT OF the group: UNCONFIRMED (1 person(s))");
    expect(lines).toContain(
      "    the call was sent and its outcome could not be read — this is not the same as nothing happening",
    );
    expect(lines).toContain("    unknown p3");
  });

  it("says UNSENT per person for a leg an earlier failure stopped, and why", () => {
    const report: VantaGroupPeopleReport = {
      groupId: "g1",
      outcomes: [
        {
          because: "the add leg did not complete, so removing people would leave the group in a third state",
          direction: "remove",
          requestedIds: ["p3"],
          state: "not-attempted",
        },
      ],
    };
    const lines = renderVantaGroupPeopleOutcome({ report });
    expect(lines).toContain("  OUT OF the group: NOT ATTEMPTED (1 person(s))");
    expect(lines).toContain("    unsent p3");
    expect(lines).toContain(
      "    the add leg did not complete, so removing people would leave the group in a third state",
    );
  });
});

describe("exitCodeForVantaGroupPeople", () => {
  const code = ({ report }: { report: VantaGroupPeopleReport }): number =>
    exitCodeForVantaGroupPeople({ exitError: 1, exitOk: 0, report });

  it("is 0 only when every leg completed with every person landing", () => {
    expect(
      code({
        report: {
          groupId: "g1",
          outcomes: [
            { state: "completed", summary: { attempted: 2, direction: "add", failed: [], succeeded: ["p1", "p2"] } },
            { state: "completed", summary: { attempted: 1, direction: "remove", failed: [], succeeded: ["p3"] } },
          ],
        },
      }),
    ).toBe(0);
  });

  it("is non-zero when one person in one leg was refused", () => {
    expect(
      code({
        report: {
          groupId: "g1",
          outcomes: [
            {
              state: "completed",
              summary: { attempted: 2, direction: "add", failed: [{ id: "p2", message: "no" }], succeeded: ["p1"] },
            },
          ],
        },
      }),
    ).toBe(1);
  });

  it("is non-zero for an unconfirmed leg — not knowing is not success", () => {
    expect(
      code({
        report: {
          groupId: "g1",
          outcomes: [{ direction: "add", problems: ["unreadable"], requestedIds: ["p1"], state: "unconfirmed" }],
        },
      }),
    ).toBe(1);
  });

  it("is non-zero for a leg that never ran, even beside one that wholly succeeded", () => {
    expect(
      code({
        report: {
          groupId: "g1",
          outcomes: [
            { state: "completed", summary: { attempted: 1, direction: "add", failed: [], succeeded: ["p1"] } },
            { because: "the add leg failed", direction: "remove", requestedIds: ["p3"], state: "not-attempted" },
          ],
        },
      }),
    ).toBe(1);
  });
});
