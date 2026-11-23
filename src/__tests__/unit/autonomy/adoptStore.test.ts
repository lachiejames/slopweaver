import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyAutonomyAdoption, planAutonomyAdoption } from "../../../autonomy/adoptStore.js";
import { AutonomyErrors } from "../../../autonomy/errors.js";
import { readAutonomyRegisterFile } from "../../../autonomy/importRegister.js";
import { foldAutonomy } from "../../../autonomy/query.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

const NOW = "2026-09-13T05:45:38.326Z";

/** The store still awaits the register, as it does until an import lands. */
const PENDING = (): Promise<undefined> => Promise.resolve(undefined);

/** A throwaway state home this test may write into — never the ambient one. */
function home(): string {
  const root = mkdtempSync(join(tmpdir(), "sw-adopt-"));
  cleanups.push(() => {
    rmSync(root, { force: true, recursive: true });
  });
  mkdirSync(join(root, "ledgers"), { recursive: true });
  return root;
}

/** Write a register's exact bytes and answer its path. */
function register({ root, text }: { root: string; text: string }): string {
  const path = join(root, "ledgers", "autonomy.jsonl");
  writeFileSync(path, text, "utf8");
  return path;
}

/** One well-formed act as a single JSONL line. */
const GOOD_LINE =
  '{"actionId":"16644-enqueue","kind":"press-merge-when-ready",' +
  '"subject":"https://github.com/acme/acme-admin/pull/16644","doneIso":"2026-09-12T02:06:09Z",' +
  '"bySession":"workspace:123","why":"CI green, mergeable, no code-owner request outstanding",' +
  '"witness":"slopweaver github enqueue --pr 16644 -> queued at position 1",' +
  '"said":"I merged your pull request on the admin app once every check had passed."}';

/** One act with no witness, as a pre-verb session hand-appended it. */
const WITNESSLESS_LINE =
  '{"actionId":"h249-t0-rule-secret","kind":"handover.rule.finding",' +
  '"subject":"an-unregistered-secret-in-the-ambient-home-refuses-every-push-on-the-machine",' +
  '"doneIso":"2026-09-12T19:51:24Z","bySession":"fresh-supervisor-handoff-9249",' +
  '"why":"OWNER RULING 245-2: an unasked finding that is obviously wanted lands autonomously."}';

/** One act a session wrote with an indenting serialiser, so it spans nine physical lines. */
const PRETTY_LINES = [
  "{",
  '  "actionId": "weekend-dogfood-p16",',
  '  "kind": "slack.post.as-me",',
  '  "subject": "https://acme.slack.com/archives/D0SYN000001/p1789270915939139",',
  '  "doneIso": "2026-09-13T03:41:56Z",',
  '  "bySession": "c00dd5e5-5f17-459f-abe3-9a6cd714fd45",',
  '  "why": "weekend dogfood P16: org settings changed in the last month and whether any was risky.",',
  '  "witness": "ts=1789270915.939139; arm a0c64119 pid 71706"',
  "}",
].join("\n");

describe("planAutonomyAdoption", () => {
  it("counts objects rather than physical lines, so a pretty-printed row is one act", () => {
    const root = home();
    register({ root, text: `${GOOD_LINE}\n${PRETTY_LINES}\n` });

    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(planned.plan.objects).toBe(2);
    expect(planned.plan.physicalLines).toBe(10);
  });

  it("does not count the trailing newline as a line of its own", () => {
    const root = home();
    register({ root, text: `${GOOD_LINE}\n` });

    expect(unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] })).plan.physicalLines).toBe(1);
  });

  it("reports the witness patch a hand-written row needs and writes nothing", () => {
    const root = home();
    const path = register({ root, text: `${WITNESSLESS_LINE}\n` });
    const before = readFileSync(path, "utf8");

    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(planned.plan.changes).toEqual([
      { actionId: "h249-t0-rule-secret", compacted: false, fields: ["witness", "said"], firstLine: 1, lastLine: 1 },
    ]);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("names the backup it would write, and the state reference every patched witness quotes", () => {
    const root = home();
    register({ root, text: `${WITNESSLESS_LINE}\n` });

    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(planned.plan.backupReference).toBe("state:ledgers/autonomy.pre-adopt-2026-09-13T05-45-38-326Z.jsonl");
    expect(planned.plan.backupPath).toBe(join(root, "ledgers", "autonomy.pre-adopt-2026-09-13T05-45-38-326Z.jsonl"));
  });

  it("refuses a replacement naming an act the register does not carry", () => {
    const root = home();
    register({ root, text: `${GOOD_LINE}\n` });

    const error = unwrapErr(
      planAutonomyAdoption({
        home: root,
        nowIso: NOW,
        replacements: [{ actionId: "not-in-the-file", field: "subject", replacement: "state:notes.md" }],
      }),
    );

    expect(error.code).toBe("UNKNOWN_ACTION");
  });

  it("refuses a register that ends in the middle of an object", () => {
    const root = home();
    register({ root, text: '{\n  "actionId": "half-written",\n' });

    const error = unwrapErr(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("ends in the middle of");
  });

  it("refuses a register that is not there, rather than reporting it empty", () => {
    const root = home();

    const error = unwrapErr(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(error.code).toBe("STORE_UNREADABLE");
  });
});

describe("applyAutonomyAdoption", () => {
  it("installs a register the ordinary reader then reads, preserving the original beside it", async () => {
    const root = home();
    const path = register({ root, text: `${WITNESSLESS_LINE}\n${PRETTY_LINES}\n` });
    const original = readFileSync(path, "utf8");
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    const receipt = unwrap(
      await applyAutonomyAdoption({
        home: root,
        nowIso: NOW,
        plan: planned.plan,
        stillPending: PENDING,
        rows: planned.rows,
      }),
    );

    expect(receipt.applied).toBe(true);
    expect(readFileSync(planned.plan.backupPath, "utf8")).toBe(original);
    const records = unwrap(readAutonomyRegisterFile({ missing: "error", path })).records;
    expect(records.length).toBe(2);
    expect(unwrap(foldAutonomy({ records })).length).toBe(2);
  });

  it("writes the adopted register as one line per act", async () => {
    const root = home();
    const path = register({ root, text: `${WITNESSLESS_LINE}\n${PRETTY_LINES}\n` });
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    await applyAutonomyAdoption({
      home: root,
      nowIso: NOW,
      plan: planned.plan,
      stillPending: PENDING,
      rows: planned.rows,
    });

    expect(readFileSync(path, "utf8").trimEnd().split("\n").length).toBe(2);
  });

  it("narrows the adopted register to owner-only permissions", async () => {
    const root = home();
    const path = register({ root, text: `${WITNESSLESS_LINE}\n` });
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    await applyAutonomyAdoption({
      home: root,
      nowIso: NOW,
      plan: planned.plan,
      stillPending: PENDING,
      rows: planned.rows,
    });

    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("writes nothing when the register already needs no change", async () => {
    const root = home();
    const path = register({ root, text: `${GOOD_LINE}\n` });
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    const receipt = unwrap(
      await applyAutonomyAdoption({
        home: root,
        nowIso: NOW,
        plan: planned.plan,
        stillPending: PENDING,
        rows: planned.rows,
      }),
    );

    expect(receipt.applied).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(`${GOOD_LINE}\n`);
    expect(() => statSync(planned.plan.backupPath)).toThrow();
  });

  it("refuses when a session appended after the plan was read, and writes nothing", async () => {
    const root = home();
    const path = register({ root, text: `${WITNESSLESS_LINE}\n` });
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));
    writeFileSync(path, `${WITNESSLESS_LINE}\n${GOOD_LINE}\n`, "utf8");

    const error = unwrapErr(
      await applyAutonomyAdoption({
        home: root,
        nowIso: NOW,
        plan: planned.plan,
        stillPending: PENDING,
        rows: planned.rows,
      }),
    );

    expect(error.code).toBe("REGISTER_MOVED");
    expect(error.message).toContain("the register changed while the plan was being read");
    expect(readFileSync(path, "utf8")).toBe(`${WITNESSLESS_LINE}\n${GOOD_LINE}\n`);
  });

  it("refuses, under the lock, when an import landed after the plan, and writes nothing", async () => {
    const root = home();
    const path = register({ root, text: `${WITNESSLESS_LINE}\n` });
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));
    const imported = (): Promise<string> => Promise.resolve("the store is already this home's autonomy ledger");

    const error = unwrapErr(
      await applyAutonomyAdoption({
        home: root,
        nowIso: NOW,
        plan: planned.plan,
        rows: planned.rows,
        stillPending: imported,
      }),
    );

    expect(error).toEqual(
      AutonomyErrors.registerNotPending({ why: "the store is already this home's autonomy ledger" }),
    );
    expect(readFileSync(path, "utf8")).toBe(`${WITNESSLESS_LINE}\n`);
    expect(() => statSync(planned.plan.backupPath)).toThrow();
  });

  it("refuses to overwrite a preserved original that is already there", async () => {
    const root = home();
    register({ root, text: `${WITNESSLESS_LINE}\n` });
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));
    writeFileSync(planned.plan.backupPath, "an earlier adoption's original\n", "utf8");

    const error = unwrapErr(
      await applyAutonomyAdoption({
        home: root,
        nowIso: NOW,
        plan: planned.plan,
        stillPending: PENDING,
        rows: planned.rows,
      }),
    );

    expect(error.code).toBe("STORE_UNREADABLE");
    expect(readFileSync(planned.plan.backupPath, "utf8")).toBe("an earlier adoption's original\n");
  });

  it("carries a replaced subject and its original into the adopted row", async () => {
    const root = home();
    const prose =
      '{"actionId":"handoff-9251-close-parked-23-0110","kind":"cmux.close.parked",' +
      '"subject":"23 workspaces parked 10h on landed pages","doneIso":"2026-09-13T01:10:38Z",' +
      '"bySession":"1fd6de06","why":"owner turn 251-2: closing done chats."}';
    const path = register({ root, text: `${prose}\n` });
    const planned = unwrap(
      planAutonomyAdoption({
        home: root,
        nowIso: NOW,
        replacements: [
          {
            actionId: "handoff-9251-close-parked-23-0110",
            field: "subject",
            replacement: "state:supervisor-scratch/handoff-9251/close251-list.txt",
          },
        ],
      }),
    );

    await applyAutonomyAdoption({
      home: root,
      nowIso: NOW,
      plan: planned.plan,
      stillPending: PENDING,
      rows: planned.rows,
    });

    const adopted = readFileSync(path, "utf8");
    expect(adopted).toContain('"subject":"state:supervisor-scratch/handoff-9251/close251-list.txt"');
    expect(adopted).toContain('Original subject: \\"23 workspaces parked 10h on landed pages\\"');
  });
});

describe("a row that names one key twice", () => {
  it("refuses the whole plan rather than dropping what the session wrote first", () => {
    const root = home();
    const duplicated =
      '{"actionId":"a-one","kind":"press-merge-when-ready","subject":"https://example.com/pr/1",' +
      '"doneIso":"2026-09-12T02:06:09Z","bySession":"session-one","why":"CI failed; merge was refused",' +
      '"why":"CI green; merged","witness":"enqueue -> queued"}';
    const path = register({ root, text: `${duplicated}\n` });

    const error = unwrapErr(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain('names "why" twice');
    expect(readFileSync(path, "utf8")).toBe(`${duplicated}\n`);
  });
});

describe("a row whose doneIso no clock can parse", () => {
  /** The shape of the row that took the whole register off the page. */
  const BAD_INSTANT_LINE =
    '{"actionId":"257-1-dogfood-bugs-636-landed","kind":"github.pr-land",' +
    '"subject":"https://github.com/lachiejames/slopweaver/pull/636","doneIso":"2026-09-14T01:1xZ",' +
    '"bySession":"dc33d089-ac83-4d29-9afb-e47a4c6633c9","why":"The owner ranks these fixes second.",' +
    '"witness":"slopweaver github enqueue --number 636 -> queued into main at position 1"}';

  it("is skipped and named by the ordinary read before the repair, which is why adoption is what restores it", () => {
    const root = home();
    const path = register({ root, text: `${GOOD_LINE}\n${BAD_INSTANT_LINE}\n` });

    const read = unwrap(readAutonomyRegisterFile({ missing: "error", path }));

    expect(read.records.length).toBe(1);
    expect(read.unparsed.map((error) => [error.code, error.lineNumber])).toEqual([["CORRUPT_ROW", 2]]);
    expect(read.unparsed[0]!.message).toContain("2026-09-14T01:1xZ");
  });

  it("installs the caller's instant and quotes the placeholder in the row's own witness", async () => {
    const root = home();
    const path = register({ root, text: `${GOOD_LINE}\n${BAD_INSTANT_LINE}\n` });
    const planned = unwrap(
      planAutonomyAdoption({
        home: root,
        nowIso: NOW,
        replacements: [
          { actionId: "257-1-dogfood-bugs-636-landed", field: "doneIso", replacement: "2026-09-14T01:15:00Z" },
        ],
      }),
    );

    const receipt = unwrap(
      await applyAutonomyAdoption({
        home: root,
        nowIso: NOW,
        plan: planned.plan,
        stillPending: PENDING,
        rows: planned.rows,
      }),
    );

    expect(receipt.applied).toBe(true);
    const adopted = readFileSync(path, "utf8");
    expect(adopted).toContain('"doneIso":"2026-09-14T01:15:00Z"');
    expect(adopted).toContain('Original doneIso: \\"2026-09-14T01:1xZ\\".');
    const records = unwrap(readAutonomyRegisterFile({ missing: "error", path })).records;
    expect(unwrap(foldAutonomy({ records })).length).toBe(2);
  });

  it("refuses as incomplete, naming the line, when the register it installed does not read back whole", async () => {
    const root = home();
    register({ root, text: `${GOOD_LINE}\n${BAD_INSTANT_LINE}\n` });
    const planned = unwrap(
      planAutonomyAdoption({
        home: root,
        nowIso: NOW,
        replacements: [
          { actionId: "257-1-dogfood-bugs-636-landed", field: "doneIso", replacement: "2026-09-14T01:15:00Z" },
        ],
      }),
    );
    const rows = planned.rows.map((row, index) => (index === 1 ? { ...row, wire: "not json" } : row));

    const error = unwrapErr(
      await applyAutonomyAdoption({ home: root, nowIso: NOW, plan: planned.plan, stillPending: PENDING, rows }),
    );

    expect(error).toEqual(AutonomyErrors.registerIncomplete({ lineNumbers: [2] }));
  });

  it("refuses without touching the register when the plan names no replacement for it", () => {
    const root = home();
    const path = register({ root, text: `${BAD_INSTANT_LINE}\n` });

    const error = unwrapErr(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(error.code).toBe("CORRUPT_ROW");
    expect(readFileSync(path, "utf8")).toBe(`${BAD_INSTANT_LINE}\n`);
  });

  it("places that refusal on its line, names the act, and names the command that repairs it", () => {
    const root = home();
    register({ root, text: `${GOOD_LINE}\n${BAD_INSTANT_LINE}\n` });

    const error = unwrapErr(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(error.message).toContain("line 2");
    expect(error.message).toContain("the act 257-1-dogfood-bugs-636-landed");
    expect(error.message).toContain("slopweaver autonomy adopt 257-1-dogfood-bugs-636-landed=");
  });

  it("does not wrap a refusal that already carries its own line a second time", () => {
    const root = home();
    const twoKeys = '{"actionId":"twice","why":"first","why":"second","subject":"https://example.com/pr/1"}';
    register({ root, text: `${GOOD_LINE}\n${twoKeys}\n` });

    const error = unwrapErr(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("line 2");
    expect(error.message).not.toContain(
      "line 2 of the autonomy ledger is neither a complete action nor a complete steer: line 2",
    );
  });

  it("refuses a replacement naming an act the register carries twice, one of which already reads", () => {
    const root = home();
    const twin =
      '{"actionId":"257-1-dogfood-bugs-636-landed","kind":"github.pr-land",' +
      '"subject":"https://github.com/lachiejames/slopweaver/pull/636","doneIso":"2026-09-14T01:15:00Z",' +
      '"bySession":"dc33d089-ac83-4d29-9afb-e47a4c6633c9","why":"The owner ranks these fixes second.",' +
      '"witness":"slopweaver github enqueue --number 636 -> queued into main at position 1"}';
    const path = register({ root, text: `${twin}\n${BAD_INSTANT_LINE}\n` });

    const error = unwrapErr(
      planAutonomyAdoption({
        home: root,
        nowIso: NOW,
        replacements: [
          { actionId: "257-1-dogfood-bugs-636-landed", field: "doneIso", replacement: "2026-09-14T02:15:00Z" },
        ],
      }),
    );

    expect(error.message).toContain("already carries a doneIso a clock can parse");
    expect(readFileSync(path, "utf8")).toContain("2026-09-14T01:1xZ");
  });
});

describe("a whole-register rule adoption itself could break", () => {
  it("refuses a pass whose minted witnesses would conflict, having replaced nothing", async () => {
    // Two hand-appended rows under one id on different lines. Each is valid alone, and `witness` is an
    // identity field, so the provenance statement adoption mints — which names each row's own LINE — makes
    // them disagree. The fold that catches it runs BEFORE the write, so the register is untouched.
    const root = home();
    const path = register({ root, text: `${WITNESSLESS_LINE}\n${WITNESSLESS_LINE}\n` });
    const before = readFileSync(path, "utf8");
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    const error = unwrapErr(
      await applyAutonomyAdoption({
        home: root,
        nowIso: NOW,
        plan: planned.plan,
        stillPending: PENDING,
        rows: planned.rows,
      }),
    );

    expect(error.code).toBe("ACTION_ID_CONFLICT");
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("repairing an act the owner has already steered", () => {
  /** The same act, with the placeholder minute that made this repairable at all. */
  const ACT_LINE =
    '{"actionId":"257-1-dogfood-bugs-636-landed","kind":"github.pr-land",' +
    '"subject":"https://github.com/lachiejames/slopweaver/pull/636","doneIso":"2026-09-14T01:1xZ",' +
    '"bySession":"dc33d089-ac83-4d29-9afb-e47a4c6633c9","why":"The owner ranks these fixes second.",' +
    '"witness":"slopweaver github enqueue --number 636 -> queued into main at position 1"}';

  /** The owner's word about it, which carries the ACT's own id — that shared key is the whole defect. */
  const STEER_LINE =
    '{"actionId":"257-1-dogfood-bugs-636-landed","bySession":"fresh-supervisor-handoff-9257",' +
    '"steer":"yep, exactly right","steeredIso":"2026-09-14T02:00:00Z"}';

  const REPAIR = {
    actionId: "257-1-dogfood-bugs-636-landed",
    field: "doneIso",
    replacement: "2026-09-14T01:15:00Z",
  } as const;

  it("patches the act and leaves the owner's steer of it byte-identical", async () => {
    const root = home();
    const path = register({ root, text: `${ACT_LINE}\n${STEER_LINE}\n` });
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [REPAIR] }));

    const receipt = unwrap(
      await applyAutonomyAdoption({
        home: root,
        nowIso: NOW,
        plan: planned.plan,
        stillPending: PENDING,
        rows: planned.rows,
      }),
    );

    expect(receipt.applied).toBe(true);
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    expect(lines[1]).toBe(STEER_LINE);
    expect(lines[0]).toContain('"doneIso":"2026-09-14T01:15:00Z"');
  });

  it("reports one changed row rather than two, so the steer is not counted as repaired", () => {
    const root = home();
    register({ root, text: `${ACT_LINE}\n${STEER_LINE}\n` });

    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [REPAIR] }));

    expect(planned.plan.changes.filter((change) => change.fields.length > 0).length).toBe(1);
    expect(planned.plan.changes[0]!.fields).toEqual(["doneIso", "witness", "said"]);
    expect(planned.plan.changes[1]!.fields).toEqual([]);
  });

  it("still says an act is unknown when only a steer carries the id, rather than no-opping", () => {
    const root = home();
    const orphanSteer =
      '{"actionId":"never-recorded","bySession":"fresh-supervisor-handoff-9257",' +
      '"steer":"yep, exactly right","steeredIso":"2026-09-14T02:00:00Z"}';
    register({ root, text: `${GOOD_LINE}\n${orphanSteer}\n` });

    const error = unwrapErr(
      planAutonomyAdoption({
        home: root,
        nowIso: NOW,
        replacements: [{ actionId: "never-recorded", field: "doneIso", replacement: "2026-09-14T01:15:00Z" }],
      }),
    );

    expect(error.code).toBe("UNKNOWN_ACTION");
    expect(error.message).toContain("never-recorded");
  });

  it("keeps the whole register readable, which the id-alone match did not", async () => {
    const root = home();
    const path = register({ root, text: `${ACT_LINE}\n${STEER_LINE}\n` });
    const planned = unwrap(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [REPAIR] }));
    unwrap(
      await applyAutonomyAdoption({
        home: root,
        nowIso: NOW,
        plan: planned.plan,
        stillPending: PENDING,
        rows: planned.rows,
      }),
    );

    const folded = unwrap(
      foldAutonomy({ records: unwrap(readAutonomyRegisterFile({ missing: "error", path })).records }),
    );

    expect(folded.length).toBe(1);
    expect(folded[0]!.action.doneIso).toBe("2026-09-14T01:15:00Z");
    expect(folded[0]!.latestSteer!.steer).toBe("yep, exactly right");
  });
});

describe("a refusal that names the wrong fix", () => {
  it("offers the repair command only for a field the positional grammar reaches", () => {
    const root = home();
    const emptyWhy =
      '{"actionId":"blank-why","kind":"github.pr-land",' +
      '"subject":"https://github.com/lachiejames/slopweaver/pull/636","doneIso":"2026-09-14T01:15:00Z",' +
      '"bySession":"dc33d089-ac83-4d29-9afb-e47a4c6633c9","why":"   "}';
    register({ root, text: `${GOOD_LINE}\n${emptyWhy}\n` });

    const error = unwrapErr(planAutonomyAdoption({ home: root, nowIso: NOW, replacements: [] }));

    expect(error.message).toContain("line 2");
    expect(error.message).toContain("the act blank-why");
    // A `why` is not repairable by `<actionId>=<value>`, and a refusal that offered that route would send
    // a reader to try it, fail, and trust the next line less. The act and the line still arrive.
    expect(error.message).not.toContain("slopweaver autonomy adopt blank-why=");
  });
});
