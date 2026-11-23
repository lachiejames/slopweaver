/**
 * What `slopweaver profile`'s flags mean, and what each verb prints.
 *
 * The parse case worth having is `--id` together with `--name`: the register holds people whose display
 * names collide, so a caller passing both holds two different beliefs about who is meant and at most one
 * can be right. Silently preferring either would attach one person's judgement to another, which the
 * identity-uniqueness trigger cannot see because it is semantically wrong rather than structurally wrong.
 */
import { describe, expect, it } from "vitest";

import {
  ownerLines,
  parseProfilePersonArgs,
  parseProfileShowArgs,
  parseProfileWriteArgs,
  personLines,
  profileTail,
  voiceLines,
} from "../../../../../cli/commands/profile/core.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { OwnerProfile } from "../../../../../store/profile/client.js";
import { emptyPersonJudgement, statement } from "../../../../../store/profile/core.js";
import type { VoiceCohort } from "../../../../../store/profile/types.js";

describe("profileTail", () => {
  it("drops a spoken verb token", () => {
    expect(profileTail({ argv: ["node", "slopweaver", "profile", "person", "--name", "x"] })).toStrictEqual([
      "--name",
      "x",
    ]);
  });

  it("keeps a flag that follows the bare noun", () => {
    expect(profileTail({ argv: ["node", "slopweaver", "profile", "--json"] })).toStrictEqual(["--json"]);
  });
});

describe("parseProfileShowArgs", () => {
  it("defaults to the human report", () => {
    expect(unwrap(parseProfileShowArgs({ rest: [] })).json).toBe(false);
  });
});

describe("parseProfileWriteArgs", () => {
  it("requires the file rather than defaulting to one", () => {
    expect(unwrapErr(parseProfileWriteArgs({ rest: [] }))).toStrictEqual(["--file <path> is required"]);
  });

  it("names the flag the caller actually passes, so harvest can call it --manifest", () => {
    expect(unwrapErr(parseProfileWriteArgs({ flag: "manifest", rest: [] }))).toStrictEqual([
      "--manifest <path> is required",
    ]);
  });
});

describe("parseProfilePersonArgs", () => {
  it("refuses an invocation that names nobody", () => {
    expect(unwrapErr(parseProfilePersonArgs({ rest: [] }))).toStrictEqual([
      "name the person with --id <uuid> or --name <display name>",
    ]);
  });

  it("refuses --id and --name together rather than preferring one", () => {
    expect(unwrapErr(parseProfilePersonArgs({ rest: ["--id", "u", "--name", "n"] }))).toStrictEqual([
      "--id and --name name two different beliefs about who is meant; pass one",
    ]);
  });

  it("reads a write invocation", () => {
    const args = unwrap(parseProfilePersonArgs({ rest: ["--name", "Chris", "--file", "./j.json"] }));
    expect(args.name).toBe("Chris");
    expect(args.file).toBe("./j.json");
  });
});

describe("personLines", () => {
  it("says an uncurated column is not the same as no preferences", () => {
    expect(personLines({ displayName: "Chris", judgement: null })).toStrictEqual([
      "Chris: nothing curated — the judgement column is null, which is not the same as no preferences",
    ]);
  });

  it("leads with the revision and the curation date", () => {
    const judgement = {
      ...emptyPersonJudgement({ nowIso: "2026-09-12T00:00:00.000Z" }),
      facts: [statement({ observedAt: "2026-09-11T00:00:00.000Z", source: "s", text: "leads MX" })],
    };
    expect(personLines({ displayName: "Chris", judgement })).toStrictEqual([
      "Chris (revision 1, curated 2026-09-12)",
      "  facts: leads MX (observed 2026-09-11)",
    ]);
  });
});

describe("voiceLines", () => {
  it("says plainly that nothing has been measured, and names what measures it", () => {
    expect(voiceLines({ cohorts: [] })).toStrictEqual([
      "no length cohort has been measured — a Slack refresh measures their sent messages " +
        "(`slopweaver profile voice measure` by hand)",
    ]);
  });

  it("prints a cohort's residue under it rather than dropping it", () => {
    const cohort: VoiceCohort = {
      ceilingWords: null,
      cohort: "all-sent",
      measuredAt: "2026-08-23T00:00:00.000Z",
      medianWords: 14,
      p75Words: 29,
      p90Words: 54,
      qualification: "residual agent-authored messages in the sample",
      sampleCount: 4718,
      source: "file:communication-style.md",
      surface: "slack",
    };
    expect(voiceLines({ cohorts: [cohort] })).toStrictEqual([
      "1 measured cohort(s):",
      "  slack/all-sent: median 14, p75 29, p90 54, n=4718 (measured 2026-08-23)",
      "    does not cover: residual agent-authored messages in the sample",
    ]);
  });
});

describe("ownerLines", () => {
  it("says the owner is not yet placed rather than printing an empty person id", () => {
    const owner: OwnerProfile = {
      displayName: "Ada",
      personId: null,
      revision: 3,
      selfDescription: {
        alwaysLoaded: [statement({ observedAt: "2026-09-12T00:00:00.000Z", source: "turn:241-1", text: "one thing" })],
        facts: [],
        schemaVersion: 1,
        waysOfWorking: [],
      },
      updatedAt: new Date("2026-09-12T00:00:00.000Z"),
    };
    expect(ownerLines({ owner })).toStrictEqual([
      "owner: Ada (revision 3, updated 2026-09-12T00:00:00.000Z)",
      "person: not yet placed by identity resolution",
      "always loaded (1):",
      "  - one thing [turn:241-1]",
      "ways of working (0):",
      "other facts: 0, read with --json",
    ]);
  });
});
