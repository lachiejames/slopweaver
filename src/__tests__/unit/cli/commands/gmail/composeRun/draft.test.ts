/*
 * `runGmailDraft` given a form: it reads stdin only for the `-` sentinel, stores the draft and reports its id,
 * stores NOTHING on a dry run and says so, and reports a refused form as an error with nothing stored.
 */
import { describe, expect, it } from "vitest";

import { runGmailDraft } from "../../../../../../cli/commands/gmail/composeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { depsFor, recorder, withHome } from "./harness.js";

describe("runGmailDraft", () => {
  it("hands the plan and the write the home it resolved once, never leaving a seam to look one up", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailDraft({
          args: {
            board: undefined,
            dryRun: false,
            formSource: '{"to":["a@b.com"]}',
            home: undefined,
            json: false,
            replyToId: undefined,
          },
          deps: depsFor({ home, recorded }),
        });
        expect(code).toBe(EXIT_OK);
        expect(recorded.homes).toEqual([home, home]);
      },
    });
  });

  it("reads the form from stdin when --form is the sentinel", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        await runGmailDraft({
          args: { board: undefined, dryRun: false, formSource: "-", home, json: false, replyToId: undefined },
          deps: depsFor({ home, recorded }),
        });
        expect(recorded.stdinReads.length).toBe(1);
      },
    });
  });

  it("does NOT read stdin when the form was given inline", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        await runGmailDraft({
          args: {
            board: undefined,
            dryRun: false,
            formSource: '{"to":["a@b.com"]}',
            home,
            json: false,
            replyToId: undefined,
          },
          deps: depsFor({ home, recorded }),
        });
        expect(recorded.stdinReads).toEqual([]);
      },
    });
  });

  it("stores the draft and reports its id", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailDraft({
          args: { board: undefined, dryRun: false, formSource: "-", home, json: false, replyToId: undefined },
          deps: depsFor({ home, recorded }),
        });
        expect(code).toBe(EXIT_OK);
        expect(recorded.out.join("\n")).toContain("drafted: d-created");
      },
    });
  });

  it("stores NOTHING on a dry run", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailDraft({
          args: { board: undefined, dryRun: true, formSource: "-", home, json: false, replyToId: undefined },
          deps: depsFor({ home, recorded }),
        });
        expect(code).toBe(EXIT_OK);
        expect(recorded.stored).toEqual([]);
      },
    });
  });

  it("says so, on a dry run, rather than leaving it to be inferred", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        await runGmailDraft({
          args: { board: undefined, dryRun: true, formSource: "-", home, json: false, replyToId: undefined },
          deps: depsFor({ home, recorded }),
        });
        expect(recorded.out.join("\n")).toContain("DRY RUN — nothing was stored and nothing was sent.");
      },
    });
  });

  it("reports a refused form as an error and stores nothing", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailDraft({
          args: { board: undefined, dryRun: false, formSource: "-", home, json: false, replyToId: undefined },
          deps: depsFor({ home, planDraftFails: true, recorded }),
        });
        expect(code).toBe(EXIT_ERROR);
        expect(recorded.stored).toEqual([]);
      },
    });
  });
});
