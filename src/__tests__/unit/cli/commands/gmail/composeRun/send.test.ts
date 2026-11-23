/*
 * `runGmailSend`: it REFUSES with no approval or one for different content and never reaches the send seam, prints
 * the full preview and the exact approval command while refusing, names the door as the refuser, SENDS on a
 * matching approval, and reports an API failure, an unreadable draft and a `--json` refusal. The assertions that
 * matter most are about what did NOT happen: a gate that refuses in its output while performing the effect anyway
 * is the exact failure this file exists to make impossible.
 */
import { describe, expect, it } from "vitest";

import { runGmailSend } from "../../../../../../cli/commands/gmail/composeRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { DIGEST, depsFor, recorder, withHome } from "./harness.js";

describe("runGmailSend", () => {
  it("hands the plan and the send the home it resolved once, never leaving a seam to look one up", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailSend({
          args: { approve: DIGEST, draftId: "d-1", home: undefined, json: false },
          deps: depsFor({ home, recorded }),
        });
        expect(code).toBe(EXIT_OK);
        expect(recorded.homes).toEqual([home, home]);
      },
    });
  });

  it("REFUSES with no approval, and never reaches the send seam", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailSend({
          args: { approve: undefined, draftId: "d-1", home, json: false },
          deps: depsFor({ home, recorded }),
        });
        expect(code).toBe(EXIT_ERROR);
        expect(recorded.sent).toEqual([]);
      },
    });
  });

  it("prints the full preview even while refusing — that IS the refusal's purpose", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        await runGmailSend({
          args: { approve: undefined, draftId: "d-1", home, json: false },
          deps: depsFor({ home, recorded }),
        });
        const printed = recorded.out.join("\n");
        expect(printed).toContain("to: someone@example.com");
        expect(printed).toContain("subject: a subject");
        expect(printed).toContain("the body");
      },
    });
  });

  it("prints the exact approval command in the preview", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        await runGmailSend({
          args: { approve: undefined, draftId: "d-1", home, json: false },
          deps: depsFor({ home, recorded }),
        });
        expect(recorded.out.join("\n")).toContain(`slopweaver gmail send d-1 --approve ${DIGEST}`);
      },
    });
  });

  it("REFUSES an approval for different content, and never reaches the send seam", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailSend({
          args: { approve: "0000000000000000", draftId: "d-1", home, json: false },
          deps: depsFor({ home, recorded }),
        });
        expect(code).toBe(EXIT_ERROR);
        expect(recorded.sent).toEqual([]);
      },
    });
  });

  it("names the door as the refuser, so the reason is not mistaken for an API failure", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        await runGmailSend({
          args: { approve: undefined, draftId: "d-1", home, json: false },
          deps: depsFor({ home, recorded }),
        });
        expect(recorded.diagnostics.join("\n")).toContain("the door did not admit this (hold)");
      },
    });
  });

  it("SENDS when the approval matches the draft", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailSend({
          args: { approve: DIGEST, draftId: "d-1", home, json: false },
          deps: depsFor({ home, recorded }),
        });
        expect(code).toBe(EXIT_OK);
        expect(recorded.sent.length).toBe(1);
      },
    });
  });

  it("reports the sent message id", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        await runGmailSend({
          args: { approve: DIGEST, draftId: "d-1", home, json: false },
          deps: depsFor({ home, recorded }),
        });
        expect(recorded.out.join("\n")).toContain("SENT: m-sent");
      },
    });
  });

  it("reports a send that was admitted and then failed at the API as an error", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailSend({
          args: { approve: DIGEST, draftId: "d-1", home, json: false },
          deps: depsFor({ home, recorded, sendFails: true }),
        });
        expect(code).toBe(EXIT_ERROR);
        expect(recorded.diagnostics.join("\n")).toContain("the send was refused");
      },
    });
  });

  it("reports an unreadable draft without reaching the door at all", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        const code = await runGmailSend({
          args: { approve: DIGEST, draftId: "d-1", home, json: false },
          deps: depsFor({ home, planSendFails: true, recorded }),
        });
        expect(code).toBe(EXIT_ERROR);
        expect(recorded.sent).toEqual([]);
      },
    });
  });

  it("emits one JSON document carrying the decision when refused with --json", async () => {
    await withHome({
      run: async ({ home }) => {
        const recorded = recorder();
        await runGmailSend({
          args: { approve: undefined, draftId: "d-1", home, json: true },
          deps: depsFor({ home, recorded }),
        });
        const parsed: unknown = JSON.parse(recorded.out.join("\n"));
        expect((parsed as { sent: boolean }).sent).toBe(false);
      },
    });
  });
});
