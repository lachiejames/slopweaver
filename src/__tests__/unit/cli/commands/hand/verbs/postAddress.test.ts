/**
 * `hand post` and where a step happens: `--url`, `--opened`, `--literal` or `--no-address`, and the sign-in and
 * go-ahead shapes it refuses before anything is written or drawn.
 */
import { rmSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSignInProbe } from "../../../../../../browser/signInProbeStore.js";
import { runHandList } from "../../../../../../cli/commands/hand/list.js";
import { runHandPost } from "../../../../../../cli/commands/hand/post.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import type { NoteCommand } from "../../../../../../hand/note/raise.js";
import { unwrap } from "../../../../../../lib/result.js";
import { freshHand, handHarness } from "./harness.js";

let home = "";
let out: string[] = [];
let diagnostics: string[] = [];
let commands: NoteCommand[] = [];
let looked: string[] = [];

const { deps } = handHarness({ state: () => ({ commands, diagnostics, home, looked, out }) });

beforeEach(() => {
  ({ commands, diagnostics, home, looked, out } = freshHand());
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("hand post", () => {
  describe("where a step happens", () => {
    /** The four required flags and nothing that says where, posted --standalone — the argv the address rule exists for. */
    function bare({ what, tail = [] }: { what: string; tail?: readonly string[] }): readonly string[] {
      return [
        "--home",
        home,
        "--id",
        "bare-step",
        "--what",
        what,
        "--unblocks",
        "the backup",
        "--witness",
        "slopweaver hand done bare-step",
        "--standalone",
        "--blocks",
        ...tail,
      ];
    }

    /** What `hand list --json` publishes, one parsed step per line. */
    function listed(): readonly Record<string, unknown>[] {
      out = [];
      expect(runHandList({ deps: deps(), rest: ["--home", home, "--json"] })).toBe(EXIT_OK);
      return out.map((line) => JSON.parse(line) as Record<string, unknown>);
    }

    it("carries --no-address through the real verb into what `hand list --json` publishes", async () => {
      const tail = ["--quiet", "--no-address", "it is a word the owner says on the call"];
      const rest = bare({ tail, what: "Tell Sadie the cutover moved to Monday, so she can plan" });
      expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_OK);
      expect(listed().map((step) => step["unaddressed"])).toEqual(["it is a word the owner says on the call"]);
    });

    it("refuses a step with no --url, --literal or --no-address, before anything is written or drawn", async () => {
      expect(
        await runHandPost({
          deps: deps(),
          rest: bare({ what: "Tell Sadie the cutover moved to Monday, so she can plan" }),
        }),
      ).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toBe(
        'hand post: url is missing, and so are --literal and --no-address — say where it happens: --url (or --open <kind>:<id>), --literal, or --no-address "<why there is none>", which the card draws so the owner sees the reason',
      );
      expect(commands.length).toBe(0);
      expect(listed()).toEqual([]);
    });

    it("refuses --no-address beside an address, since the record would contradict itself", async () => {
      const tail = ["--url", "https://example.org/", "--no-address", "there is no page"];
      const rest = bare({ tail, what: "Tell Sadie the cutover moved to Monday, so she can plan" });
      expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toContain(
        "hand post: unaddressed says the step has no address, and it carries a --url, --opened or --literal",
      );
      expect(listed()).toEqual([]);
    });

    it("refuses a Datadog sign-in no look stands behind — the fleet presses that wall itself", async () => {
      const rest = bare({
        tail: ["--opened", "https://app.datadoghq.com/account/login", "--where", "the work Chrome"],
        what: "Sign in to Datadog in the browser window that just opened, so the read can go on",
      });
      expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_USAGE);
      expect(diagnostics.join("\n")).toContain(
        "Datadog: no look stands behind it — run `slopweaver browser sign-in --provider datadog` first",
      );
      expect(listed()).toEqual([]);
    });

    it("refuses a Datadog sign-in ask carried in a field other than what and where — every drawn field counts", async () => {
      const tail = [
        "--quiet",
        "--no-address",
        "it is a word the owner says on the call",
        "--if-ignored",
        "the PR stack waits until you sign in to Datadog in the work Chrome",
      ];
      const rest = bare({ tail, what: "Tell Sadie the cutover moved to Monday, so she can plan" });
      expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_USAGE);
      expect(diagnostics.join("\n")).toContain("Datadog: no look stands behind it");
      expect(listed()).toEqual([]);
    });

    it("records a sign-in in the window the fleet opened, carrying the page and nothing to paste", async () => {
      // A fresh look reached a step that is the owner's: the one shape a Datadog sign-in card may take.
      unwrap(
        appendSignInProbe({
          home,
          row: {
            atIso: "2026-09-19T04:56:07.803Z",
            page: "https://app.datadoghq.com/account/login",
            provider: "datadog",
            verdict: "owner-hands",
            why: "app.datadoghq.com asks for a password, passkey or second factor",
          },
        }),
      );
      const tail = [
        "--opened",
        "https://app.datadoghq.com/account/login",
        "--where",
        "the Datadog sign-in window that opened over your screen",
      ];
      const rest = bare({
        tail,
        what: "Sign in to Datadog in the browser window that just opened, so the read can go on",
      });
      expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_OK);
      expect(listed().map((step) => [step["opened"], step["literal"]])).toEqual([
        ["https://app.datadoghq.com/account/login", undefined],
      ]);
    });

    it("refuses the incident's command literal, so the seat runs it and the owner only signs in", async () => {
      const tail = [
        "--literal",
        "yarn nx run @acme/cloud-datadog:backtest-shot -- --login --profile /tmp/profile",
        "--where",
        "any terminal",
      ];
      const rest = bare({ tail, what: "Sign in to Datadog in the window this command opens" });
      expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toContain("hand post: literal is a command the fleet can run itself");
      expect(listed()).toEqual([]);
    });

    it("refuses a sign-in excused by --no-address, naming --url", async () => {
      const tail = ["--no-address", "the page moves around"];
      const rest = bare({ tail, what: "Sign in to Typeform in the work Chrome profile" });
      expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toContain(
        "hand post: url is missing and the step is a sign-in — pass --url with its sign-in page",
      );
      expect(listed()).toEqual([]);
    });

    it("refuses the Typeform sign-in exactly as it was posted, with no link", async () => {
      const rest = bare({
        tail: ["--where", "the work Chrome profile"],
        what: "Sign in to Typeform in the work Chrome profile",
      });
      expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toContain("--no-address never excuses a sign-in");
      expect(listed()).toEqual([]);
    });

    it("posts a sign-in whose literal opens the consent page itself, with where it opens", async () => {
      const tail = [
        "--quiet",
        "--literal",
        "gcloud auth application-default login",
        "--where",
        "any terminal; the consent page opens in the browser",
      ];
      const rest = bare({ tail, what: "Run the gcloud login, so the deploy can go on" });
      expect(await runHandPost({ deps: deps(), rest })).toBe(EXIT_OK);
      expect(listed().map((step) => step["literal"])).toEqual(["gcloud auth application-default login"]);
    });

    it("refuses the store-backup go-ahead, which carried nothing to weigh, and records nothing", async () => {
      const tail = ["--no-address", "it is a lease on this machine", "--where", "the supervisor chat"];
      const what = "Say the word if you want the stale store-backup lease cleared before load drops";
      expect(await runHandPost({ deps: deps(), rest: bare({ tail, what }) })).toBe(EXIT_ERROR);
      expect(diagnostics[0]).toContain(
        'hand post: what asks the owner for a go-ahead ("Say the word") and carries nothing to weigh',
      );
      expect(diagnostics[0]).toContain("slopweaver autonomy record");
      expect(listed()).toEqual([]);
    });

    it("lets a go-ahead naming its Slack draft reach the draft check, which then refuses an id not held", async () => {
      const tail = ["--no-address", "the draft is on the card"];
      const what = "Say yes to sending your reply to Rosa (sd-a0615cb5) as you, so Rosa's thread is answered";
      expect(await runHandPost({ deps: deps(), rest: bare({ tail, what }) })).toBe(EXIT_USAGE);
      expect(diagnostics[0]).toContain("slopweaver hand post blocked because the card names a parked Slack draft");
    });
  });
});
