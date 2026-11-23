/*
 * The console's write list, pinned argv by argv.
 *
 * It sits under `site/__tests__/unit/` because a file under `src/` may not import one outside it (TS6059,
 * the CI `compile` job) — the same reason `ownerAsks.test.ts` gives.
 *
 * ## Why an exact-argv test and not a shape test
 *
 * A row that shipped an argv the verb REFUSES is the failure this guards. Reproduce: `slopweaver
 * handover register --ask "a steer typed on the console" --priority p1 --home <tmp> --dir <tmp>` exits 2 on the
 * ask-shape gate and leaves the directory empty, so every press of the Queue page's steer control rendered a
 * refusal as verb output. Nothing caught it because nothing asserted what the row actually runs — the console has a
 * test for what it DISPLAYS and had none for what it EXECUTES.
 *
 * So each row is pinned as the whole argv a press produces, spelled out. A weaker assertion (that the argv
 * `toContain("--did")`, say) is true of an argv that also dropped `--ask`, and the class that bit here
 * is exactly a missing flag.
 *
 * What this lane CANNOT reach is whether the verb accepts that argv, which is the other half of the same
 * defect: `site/` is a separate Yarn project from `src/`, so no test here may import a CLI runner or spawn
 * `bin/slopweaver`. Closing that half means teaching the subprocess lane to read this list, and it is owed
 * rather than done.
 */

import { describe, expect, it } from "vitest";

import {
  ACT_VERBS,
  type ActVerb,
  actLineFor,
  actVerbFor,
  buildActArgv,
  HAND_DONE_WORDS,
  HAND_SNOOZE_BUTTONS,
} from "../../lib/actVerbs";

const rowFor = ({ slug }: { slug: string }): ActVerb => ACT_VERBS.find((verb) => verb.slug === slug)!;

const argvOf = ({ slug, slots }: { slug: string; slots: Record<string, unknown> }): readonly string[] => {
  const built = buildActArgv({ slots, verb: rowFor({ slug }) });
  expect(built.kind).toBe("argv");
  return (built as { readonly argv: readonly string[] }).argv;
};

describe("ACT_VERBS", () => {
  it("declares exactly the twenty-one acts the console may take, none taking words the owner typed", () => {
    expect(ACT_VERBS.map((verb) => verb.slug)).toEqual([
      "hand-done",
      "hand-snooze-1h",
      "hand-snooze-3h",
      "hand-snooze-tomorrow",
      "queue-defer",
      "queue-restore",
      "autonomy-steer",
      "gmail-draft-board-dry-run",
      "gmail-draft-board",
      "reviewer-approve",
      "workstream-react",
      "workstream-define-option",
      "workstream-loop-in",
      "workstream-same-as",
      "workstream-milestone-of",
      "workstream-outcome-of",
      "workstream-not-mine-covered",
      "workstream-accept-steer",
      "workstream-define-all",
      "workstream-define-all-first",
      "plans-raise-usage-limit",
      "plans-set-usage-limit",
      "plans-adopt",
      "plans-connect-codex",
      "plans-connect-cancel",
      "private-term-yes",
      "private-term-no",
    ]);
  });

  it("carries no slot whose value could be a verb, a flag or a path", () => {
    expect(ACT_VERBS.length).toBeGreaterThan(0);
    const slots = ACT_VERBS.flatMap((verb) => verb.argv.filter((part) => typeof part !== "string"));
    expect(slots.map((slot) => `${slot.slot}:${slot.shape}`)).toEqual([
      "id:id",
      "did:text",
      "id:id",
      "id:id",
      "id:id",
      "kind:id",
      "id:id",
      "kind:id",
      "id:id",
      "actionId:id",
      "steer:text",
      "slug:id",
      "digest:id",
      "slug:id",
      "digest:id",
      "repo:id",
      "number:count",
      "reviewer:id",
      "candidate:id",
      "reaction:id",
      "candidate:id",
      "option:id",
      "candidate:id",
      "person:id",
      "candidate:id",
      "target:id",
      "candidate:id",
      "target:id",
      "candidate:id",
      "target:id",
      "candidate:id",
      "target:id",
      "candidate:id",
      "steer:text",
      "candidate:id",
      "candidate:id",
      "option:id",
      "provider:id",
      "plan:id",
      "percent:count",
      "from:count",
      "provider:id",
      "plan:id",
      "percent:count",
      "from:count",
      "allowance:id",
      "id:id",
      "proposal:id",
      "proposal:id",
    ]);
  });

  it("prints the line a button shows off the same row the press runs", () => {
    expect(actLineFor({ slug: "hand-done" })).toBe(
      "slopweaver hand done <id> --did <did> --by-session work-console --json",
    );
    expect(actLineFor({ slug: "talk-relay" })).toBe("NO ACT ROW NAMED talk-relay");
    expect(actVerbFor({ slug: "talk-relay" })).toBe(undefined);
  });
});

describe("buildActArgv", () => {
  it("draws one Not now button per snooze choice the note offers, each naming a declared act — never a bare dismiss", () => {
    // Held equal to the note's own choices by `src/__tests__/unit/hand/snoozeChoicesMirror.test.ts`.
    expect(HAND_SNOOZE_BUTTONS.map((button) => button.slug)).toEqual([
      "hand-snooze-1h",
      "hand-snooze-3h",
      "hand-snooze-tomorrow",
    ]);
    expect(HAND_SNOOZE_BUTTONS.map((button) => rowFor({ slug: button.slug }).argv[4])).toEqual([
      "1h",
      "3h",
      "tomorrow",
    ]);
  });

  it("builds the three ledger acts", () => {
    expect(argvOf({ slots: { did: HAND_DONE_WORDS, id: "h-7" }, slug: "hand-done" })).toEqual([
      "hand",
      "done",
      "h-7",
      "--did",
      "done, marked on the console",
      "--by-session",
      "work-console",
      "--json",
    ]);
    expect(argvOf({ slots: { id: "h-7" }, slug: "hand-snooze-tomorrow" })).toEqual([
      "hand",
      "snooze",
      "h-7",
      "--for",
      "tomorrow",
      "--by-session",
      "work-console",
      "--json",
    ]);
    expect(argvOf({ slots: { actionId: "a-3", steer: "right call" }, slug: "autonomy-steer" })).toEqual([
      "autonomy",
      "steer",
      "a-3",
      "--steer",
      "right call",
      "--by-session",
      "work-console",
      "--json",
    ]);
  });

  it("builds Come back to it and its put-back from a card's register and id, re-reading the deferrals", () => {
    const tail = ["--by-session", "work-console", "--json"];
    expect([
      argvOf({ slots: { id: "policy-approvals", kind: "ask" }, slug: "queue-defer" }),
      argvOf({ slots: { id: "policy-approvals", kind: "ask" }, slug: "queue-restore" }),
      rowFor({ slug: "queue-defer" }).readsSlug,
      actLineFor({ slug: "queue-restore" }),
    ]).toEqual([
      ["queue", "defer", "--kind", "ask", "--id", "policy-approvals", ...tail],
      ["queue", "defer", "--kind", "ask", "--id", "policy-approvals", "--restore", ...tail],
      "queue-deferred",
      "slopweaver queue defer --kind <kind> --id <id> --restore --by-session work-console --json",
    ]);
  });

  it("builds the two mail acts from a slug and a digest, the dry run first and never a send", () => {
    const slots = { digest: "3f9a2c7e1b4d5006", slug: "iso-compliance-mail" };
    expect(argvOf({ slots, slug: "gmail-draft-board-dry-run" })).toEqual([
      "gmail",
      "draft",
      "--board",
      "iso-compliance-mail",
      "--expect",
      "3f9a2c7e1b4d5006",
      "--dry-run",
    ]);
    expect(argvOf({ slots, slug: "gmail-draft-board" })).toEqual([
      "gmail",
      "draft",
      "--board",
      "iso-compliance-mail",
      "--expect",
      "3f9a2c7e1b4d5006",
    ]);
  });

  it("builds the owner's one word on a mined candidate, marked as a console press, and re-reads the candidates", () => {
    expect(argvOf({ slots: { candidate: "c-012", reaction: "sort-of" }, slug: "workstream-react" })).toEqual([
      "workstreams",
      "react",
      "--candidate",
      "c-012",
      "--as",
      "sort-of",
      "--via",
      "console",
      "--by-session",
      "work-console",
      "--json",
    ]);
    expect(rowFor({ slug: "workstream-react" }).readsSlug).toBe("workstream-candidates");
    expect(
      buildActArgv({ slots: { candidate: "c-012", reaction: "--home" }, verb: rowFor({ slug: "workstream-react" }) }),
    ).toEqual({
      kind: "refused",
      why: "reaction is not an id a register prints: letters, digits, dot, underscore or hyphen, up to 120, never starting with a hyphen",
    });
  });

  it("builds a definition of done from an offered option, and a loop-in that carries no words", () => {
    expect(
      argvOf({ slots: { candidate: "c-012", option: "owned-and-read" }, slug: "workstream-define-option" }),
    ).toEqual([
      "workstreams",
      "define",
      "--candidate",
      "c-012",
      "--option",
      "owned-and-read",
      "--via",
      "console",
      "--by-session",
      "work-console",
      "--json",
    ]);
    expect(argvOf({ slots: { candidate: "c-012", person: "U0SYN123ABCD" }, slug: "workstream-loop-in" })).toEqual([
      "workstreams",
      "loop-in",
      "--candidate",
      "c-012",
      "--person",
      "U0SYN123ABCD",
      "--json",
    ]);
  });

  it("builds every tile reaction with its own flags and the console's tail, its title read off the same argv", () => {
    const tail = ["--via", "console", "--by-session", "work-console", "--json"];
    expect(argvOf({ slots: { candidate: "c-031", target: "pool-e2e" }, slug: "workstream-milestone-of" })).toEqual([
      "workstreams",
      "react",
      "--candidate",
      "c-031",
      "--as",
      "milestone-of",
      "--milestone-of",
      "pool-e2e",
      ...tail,
    ]);
    expect(
      argvOf({ slots: { candidate: "c-044", target: "merge-gate" }, slug: "workstream-not-mine-covered" }),
    ).toEqual(["workstreams", "react", "--candidate", "c-044", "--as", "no", "--covered-by", "merge-gate", ...tail]);
    expect(
      argvOf({ slots: { candidate: "c-002", option: "owned-and-read" }, slug: "workstream-define-all-first" }),
    ).toEqual(["workstreams", "define", "--candidate", "c-002", "--all", "--first", "owned-and-read", ...tail]);
    expect(actLineFor({ slug: "workstream-accept-steer" })).toBe(
      "slopweaver workstreams react --candidate <candidate> --as yes --steer <steer> --via console --by-session work-console --json",
    );
  });

  it("refuses a field the row did not declare rather than ignoring it", () => {
    const built = buildActArgv({
      slots: { actionId: "a-3", priority: "p3", steer: "right call" },
      verb: rowFor({ slug: "autonomy-steer" }),
    });
    expect(built).toEqual({ kind: "refused", why: "autonomy-steer takes no field named priority" });
  });

  it("refuses a missing slot, a non-string slot and an empty one", () => {
    const verb = rowFor({ slug: "autonomy-steer" });
    expect(buildActArgv({ slots: { actionId: "a-3" }, verb })).toEqual({
      kind: "refused",
      why: "autonomy-steer needs steer",
    });
    expect(buildActArgv({ slots: { actionId: "a-3", steer: 7 }, verb })).toEqual({
      kind: "refused",
      why: "steer must be a string",
    });
    expect(buildActArgv({ slots: { actionId: "a-3", steer: "   " }, verb })).toEqual({
      kind: "refused",
      why: "steer is empty; the verb records your words, so it needs some",
    });
  });

  it("refuses a value the verb would read as a flag", () => {
    expect(
      buildActArgv({ slots: { actionId: "a-3", steer: "--home /etc" }, verb: rowFor({ slug: "autonomy-steer" }) }),
    ).toEqual({
      kind: "refused",
      why: "steer starts with a hyphen, which the verb would read as a flag; start it with a word",
    });
    expect(buildActArgv({ slots: { id: "-rf" }, verb: rowFor({ slug: "hand-snooze-1h" }) })).toEqual({
      kind: "refused",
      why: "id is not an id a register prints: letters, digits, dot, underscore or hyphen, up to 120, never starting with a hyphen",
    });
  });

  it("refuses a control character and an over-long text slot", () => {
    const verb = rowFor({ slug: "autonomy-steer" });
    expect(buildActArgv({ slots: { actionId: "a-3", steer: "a steer\u0007" }, verb })).toEqual({
      kind: "refused",
      why: "steer carries a control character",
    });
    expect(buildActArgv({ slots: { actionId: "a-3", steer: "a".repeat(2001) }, verb })).toEqual({
      kind: "refused",
      why: "steer is 2001 characters; the console carries up to 2000",
    });
  });

  it("carries a newline through, because a prior steer a select offers may be several lines", () => {
    expect(
      argvOf({ slots: { candidate: "c-012", steer: "one line\nand another" }, slug: "workstream-accept-steer" })[7],
    ).toBe("one line\nand another");
  });
});
