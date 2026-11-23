import { beforeEach, describe, expect, it } from "vitest";

import type { AutonomyLedgerPort } from "../../../autonomy/port.js";
import type { AutonomyActionRow } from "../../../autonomy/types.js";
import {
  AUTONOMY_LIST_FLAG_NAMES,
  AUTONOMY_RECORD_FLAG_NAMES,
  AUTONOMY_STEER_FLAG_NAMES,
} from "../../../cli/commands/autonomy/core.js";
import { type AutonomyListDeps, runAutonomyList } from "../../../cli/commands/autonomy/list.js";
import { type AutonomyRecordDeps, runAutonomyRecord } from "../../../cli/commands/autonomy/record.js";
import { type AutonomySteerDeps, runAutonomySteer } from "../../../cli/commands/autonomy/steer.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { heldAutonomyRecords, memoryAutonomyLedgerPort } from "../../autonomyLedgerFixture.js";

/** The home every verb here names; the in-memory store stands in for it, so nothing touches disk. */
const root = "/fixture-home";

/** The store every verb in one test reads and writes, fresh per test. */
let ledger: AutonomyLedgerPort;

beforeEach(() => {
  ledger = memoryAutonomyLedgerPort();
});

/** What one verb run wrote to each channel, and what it exited with. */
interface Recorded {
  readonly exit: number;
  readonly out: readonly string[];
  readonly diagnostics: readonly string[];
}

/** The clock every verb in this file runs against. */
const NOW = "2026-09-12T03:00:00.000Z";

/** Every record the test's store holds. */
function held(): Promise<readonly unknown[]> {
  return heldAutonomyRecords({ port: ledger });
}

/** Run `autonomy record` with recording seams. */
async function record({ rest }: { rest: readonly string[] }): Promise<Recorded> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: AutonomyRecordDeps = {
    ledger,
    now: () => NOW,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: await runAutonomyRecord({ deps, rest }), out };
}

/** Run `autonomy list` with recording seams. */
async function list({ rest }: { rest: readonly string[] }): Promise<Recorded> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: AutonomyListDeps = {
    ledger,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: await runAutonomyList({ deps, rest }), out };
}

/** Run `autonomy steer` with recording seams. */
async function steer({ rest }: { rest: readonly string[] }): Promise<Recorded> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const deps: AutonomySteerDeps = {
    ledger,
    now: () => NOW,
    writeDiagnostic: (line) => diagnostics.push(line),
    writeOut: (line) => out.push(line),
  };
  return { diagnostics, exit: await runAutonomySteer({ deps, rest }), out };
}

/** The argv for one complete `autonomy record`, varying only what a test cares about. */
function recordArgs({
  actionId = "16644-enqueue",
  kind = "press-merge-when-ready",
  subject = "https://github.com/acme/acme-admin/pull/16644",
  why = "CI green, mergeable, no code-owner request outstanding",
  said = "I merged your pull request on the admin app once every check had passed.",
}: {
  actionId?: string;
  kind?: string;
  subject?: string;
  why?: string;
  said?: string;
} = {}): readonly string[] {
  return [
    "--home",
    root,
    "--action-id",
    actionId,
    "--kind",
    kind,
    "--subject",
    subject,
    "--by-session",
    "workspace:126 demo",
    "--why",
    why,
    "--said",
    said,
    "--witness",
    "slopweaver github enqueue --pr 16644 -> queued at position 1",
    "--done-iso",
    "2026-09-12T02:06:09Z",
  ];
}

describe("autonomy record", () => {
  it("judges an inline --steer with no act's links, once, since the fold shows it on other acts too", async () => {
    const run = await record({ rest: [...recordArgs(), "--steer", "fine, after #16640"] });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics).toHaveLength(1);
    expect(run.diagnostics[0]).toContain('"#16640"');
    expect(await held()).toEqual([]);
  });

  it("writes the act and names where it landed", async () => {
    const run = await record({ rest: recordArgs() });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toContain("16644-enqueue recorded");
    expect((await held()).length).toBe(1);
  });

  it("says which required flags are missing, and writes nothing", async () => {
    const run = await record({ rest: ["--home", root, "--kind", "press-merge-when-ready"] });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toContain("--action-id, --kind, --subject, --by-session, --why, --said and --witness");
    expect((await held()).length).toBe(0);
  });

  it("refuses a subject it could not open, and writes nothing", async () => {
    const run = await record({ rest: recordArgs({ subject: "acme-admin#16644" }) });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain("is not a checkable id");
    expect((await held()).length).toBe(0);
  });

  // The incident: a why citing a five-digit bare reference on an act about a four-digit pull request. The
  // subject attests a four-digit number, so the page leaves a five-digit bare one as text and refuses it.
  const INCIDENT = {
    subject: "https://github.com/acme/acme-admin/pull/9876",
    why: "Core checks died on an Nx Cloud 401; Nx Cloud was re-enabled at 01:11Z (#18273) and the diff is yarn.lock only",
  } as const;

  it("refuses a bare reference the briefing would leave as text, and writes nothing", async () => {
    const run = await record({ rest: recordArgs({ ...INCIDENT }) });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics.length).toBe(1);
    expect(run.diagnostics[0]).toContain("autonomy record: the act would carry a reference onto the briefing");
    expect(run.diagnostics[0]).toContain('"#18273"');
    expect(run.diagnostics[0]).toContain("Write it as owner/repo#<number> or as the full URL");
    expect((await held()).length).toBe(0);
  });

  it("reports each reference the render leaves, in said and in why", async () => {
    const said = "I re-ran the failed checks once the outage behind #18274 was over.";
    const run = await record({ rest: recordArgs({ ...INCIDENT, said }) });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics.map((line) => line.match(/"#\d+"/)![0])).toEqual(['"#18274"', '"#18273"']);
  });

  it("refuses a reference that only appears once a neighbouring link is removed, as the page reads it", async () => {
    const run = await record({ rest: recordArgs({ subject: INCIDENT.subject, why: "follows #9871#18273" }) });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain('"#18273"');
  });

  it("refuses a reference only another field's link resolves, which a page linking two repositories would not", async () => {
    const said = "I merged it after acme/acme-admin#18000 landed.";
    const run = await record({ rest: recordArgs({ said, subject: INCIDENT.subject, why: "follows #18273" }) });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain(
      '"#18273" renders as plain text: this act\'s own links would resolve it, but the briefing links more',
    );
  });

  it("accepts the reference once it names its repository, and the page then links it", async () => {
    const why = INCIDENT.why.replace("(#18273)", "(acme/acme-admin#18273)");
    const run = await record({ rest: recordArgs({ subject: INCIDENT.subject, why }) });
    expect(run.exit).toBe(EXIT_OK);
    expect((await held()).length).toBe(1);
  });

  it("accepts a bare reference the subject's repository resolves, and a # inside a URL", async () => {
    const why = "follows #9871, see https://github.com/acme/acme-admin/pull/9876#issuecomment-1";
    const run = await record({ rest: recordArgs({ subject: INCIDENT.subject, why }) });
    expect(run.diagnostics).toEqual([]);
    expect(run.exit).toBe(EXIT_OK);
  });

  it("reports an identical retry as already recorded", async () => {
    await record({ rest: recordArgs() });
    const second = await record({ rest: recordArgs() });
    expect(second.exit).toBe(EXIT_OK);
    expect(second.out[0]).toContain("already recorded, nothing written");
    expect((await held()).length).toBe(1);
  });

  it("refuses a second, different act under one id", async () => {
    await record({ rest: recordArgs() });
    const second = await record({ rest: recordArgs({ why: "a different reason entirely" }) });
    expect(second.exit).toBe(EXIT_ERROR);
    expect(second.diagnostics[0]).toContain("already carries a DIFFERENT act");
  });

  it("accepts the dotted kinds the fleet already writes", async () => {
    const run = await record({
      rest: recordArgs({
        kind: "slack.post.as-me.one-card",
        subject: "https://acme.slack.com/archives/D0SYN000010/p1789179479130929",
      }),
    });
    expect(run.exit).toBe(EXIT_OK);
  });

  it("prints its usage on --help without writing anything", async () => {
    const run = await record({ rest: ["--home", root, "--help"] });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toContain("usage: slopweaver autonomy record");
    expect((await held()).length).toBe(0);
  });

  it("stores the plain-words line on the act, so the card the owner reads has one", async () => {
    await record({ rest: recordArgs() });
    const stored = (await held())[0]!;
    expect((stored as AutonomyActionRow).said).toBe(
      "I merged your pull request on the admin app once every check had passed.",
    );
  });

  it("says --said is missing by name rather than refusing the whole flag set vaguely", async () => {
    const rest = recordArgs().filter((arg, index, all) => arg !== "--said" && all[index - 1] !== "--said");
    const run = await record({ rest });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toContain("--said");
    expect((await held()).length).toBe(0);
  });

  it("refuses a said written for the fleet, naming the phrase, and writes nothing", async () => {
    const run = await record({ rest: recordArgs({ said: "Rule 10 made this mine, so I enqueued it." }) });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain('said carries "Rule 10", which is a rule-number');
    expect((await held()).length).toBe(0);
  });
});

describe("autonomy steer", () => {
  it("records the owner's word against an act the register carries", async () => {
    await record({ rest: recordArgs() });
    const run = await steer({
      rest: ["16644-enqueue", "--home", root, "--steer", "yep, exactly right", "--by-session", "supervisor"],
    });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toContain("recorded their word on 16644-enqueue");
    expect((await held()).length).toBe(2);
  });

  it("refuses an act id nothing recorded, and writes nothing", async () => {
    await record({ rest: recordArgs() });
    const run = await steer({ rest: ["a-missing", "--home", root, "--steer", "x", "--by-session", "supervisor"] });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain("no act in the ledger carries the id a-missing");
    expect((await held()).length).toBe(1);
  });

  it("refuses a word the act's line would carry as a bare reference, and writes nothing", async () => {
    await record({ rest: recordArgs() });
    const run = await steer({
      rest: ["16644-enqueue", "--home", root, "--steer", "fine, but wait for #166440", "--by-session", "supervisor"],
    });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain("autonomy steer: the act would carry a reference onto the briefing");
    expect(run.diagnostics[0]).toContain('"#166440"');
    expect((await held()).length).toBe(1);
  });

  it("refuses a reference even this act's subject would resolve: the word shows on other acts' rows too", async () => {
    await record({ rest: recordArgs() });
    const run = await steer({
      rest: ["16644-enqueue", "--home", root, "--steer", "fine, after #16640", "--by-session", "supervisor"],
    });
    expect(run.exit).toBe(EXIT_ERROR);
    expect(run.diagnostics[0]).toContain('"#16640"');
    expect((await held()).length).toBe(1);
  });

  it("records a word that writes its reference in full", async () => {
    await record({ rest: recordArgs() });
    const run = await steer({
      rest: ["16644-enqueue", "--home", root, "--steer", "fine, after acme/acme-admin#16640", "--by-session", "s"],
    });
    expect(run.diagnostics).toEqual([]);
    expect(run.exit).toBe(EXIT_OK);
  });

  it("needs the act id, the owner's words and the recording session", async () => {
    const run = await steer({ rest: ["--home", root, "--steer", "x"] });
    expect(run.exit).toBe(EXIT_USAGE);
    expect(run.diagnostics[0]).toContain("the act's id, --steer and --by-session are all required");
  });
});

describe("autonomy list", () => {
  it("says so plainly when nothing has been done autonomously", async () => {
    const run = await list({ rest: ["--home", root] });
    expect(run.exit).toBe(EXIT_OK);
    expect(run.out[0]).toContain("no acts recorded under graduated autonomy match");
  });

  it("shows the act, its reason and the owner's word once they have given one", async () => {
    await record({ rest: recordArgs() });
    await steer({
      rest: ["16644-enqueue", "--home", root, "--steer", "yep, exactly right", "--by-session", "supervisor"],
    });
    const run = await list({ rest: ["--home", root] });
    expect(run.out[0]).toContain("press merge when ready on acme/acme-admin#16644");
    expect(run.out[1]).toContain("why: CI green");
    expect(run.out[2]).toContain("their steer: yep, exactly right");
  });

  it("emits one JSON object per line rather than one array", async () => {
    await record({ rest: recordArgs({ actionId: "a-one" }) });
    await record({ rest: recordArgs({ actionId: "a-two", why: "a second act with its own reason" }) });
    const run = await list({ rest: ["--home", root, "--json"] });
    expect(run.out.length).toBe(2);
    expect(run.out.every((line) => line.startsWith("{"))).toBe(true);
  });

  it("keeps only the acts the owner has not spoken about under --unsteered", async () => {
    await record({ rest: recordArgs({ actionId: "a-one" }) });
    // Another pull request and another sentence: an act of the same pattern would be settled by the same word.
    await record({
      rest: recordArgs({
        actionId: "a-two",
        said: "I merged your other pull request once its checks passed.",
        subject: "https://github.com/acme/acme-admin/pull/16645",
        why: "a second act with its own reason",
      }),
    });
    await steer({ rest: ["a-one", "--home", root, "--steer", "fine", "--by-session", "supervisor"] });
    const run = await list({ rest: ["--home", root, "--json", "--unsteered"] });
    expect(run.out.length).toBe(1);
    expect(run.out[0]).toContain("a-two");
  });

  it("refuses an unknown flag rather than ignoring it", async () => {
    const run = await list({ rest: ["--home", root, "--nope"] });
    expect(run.exit).toBe(EXIT_USAGE);
  });
});

describe("the flag lists the help-truth ratchet reads", () => {
  it("names every record flag, with its dashes, sorted", () => {
    expect(AUTONOMY_RECORD_FLAG_NAMES).toEqual([
      "--action-id",
      "--by-session",
      "--done-iso",
      "--home",
      "--json",
      "--kind",
      "--run",
      "--said",
      "--steer",
      "--subject",
      "--why",
      "--witness",
    ]);
  });

  it("names every list flag", () => {
    expect(AUTONOMY_LIST_FLAG_NAMES).toEqual(["--by-session", "--home", "--json", "--kind", "--since", "--unsteered"]);
  });

  it("names every steer flag", () => {
    expect(AUTONOMY_STEER_FLAG_NAMES).toEqual(["--by-session", "--home", "--json", "--steer"]);
  });
});
