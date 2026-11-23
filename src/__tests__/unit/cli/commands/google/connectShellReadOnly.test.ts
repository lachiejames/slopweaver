/**
 * Unit: the shared Google `connect` shell refuses to STORE a grant carrying a write scope on a read-only door,
 * driven through the Google Admin door's real vocabulary and real parser.
 *
 * An admin consent riding the client that holds the Gmail writes lands a grant carrying them beside the
 * readonly administrator scopes. What Google merges onto a grant is outside this repository, so the fence is
 * at the store: a test
 * here goes red the day an admin grant carrying a write scope can reach disk.
 */
import { describe, expect, it } from "vitest";

import { parseGoogleAdminConnectArgs } from "../../../../../cli/commands/atlas/googleAdmin/connectCore.js";
import { GOOGLE_ADMIN_DOOR } from "../../../../../cli/commands/atlas/googleAdmin/connectRun.js";
import { type GoogleConnectDeps, runGoogleConnect } from "../../../../../cli/commands/google/connectShell.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { ok } from "../../../../../lib/result.js";
import type { GoogleAdminDoorError } from "../../../../../live/googleAdmin/errors.js";
import { GOOGLE_ADMIN_SCOPES } from "../../../../../live/googleAdmin/scopes.js";
import type { GoogleGrant } from "../../../../../secrets/googleGrant.js";

/** Write scopes a merged admin grant would carry, by their exact URIs. */
const GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send";
const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";

/** Every admin scope the default `--grant all` asks for, as Google would echo them back. */
const ADMIN_SCOPES = Object.values(GOOGLE_ADMIN_SCOPES).join(" ");

/** Fake seams over a consent that returns `grantedScope`, recording every grant that reached `persist`. */
function fakeDeps({ grantedScope }: { grantedScope: string }): {
  deps: GoogleConnectDeps<GoogleAdminDoorError>;
  persisted: GoogleGrant[];
  diagnostics: string[];
} {
  const persisted: GoogleGrant[] = [];
  const diagnostics: string[] = [];
  return {
    deps: {
      consent: async () =>
        ok({
          account: "admin@example.test",
          tokens: { accessToken: "ya29-at", expiresInSeconds: 3599, refreshToken: "1//rt", scope: grantedScope },
        }),
      nowIso: () => "2026-10-01T12:00:00.000Z",
      persist: ({ grant, home }) => {
        persisted.push(grant);
        return ok(`${home}/secrets/google-admin-oauth.json`);
      },
      revoke: async () => ok(undefined),
      status: () => ok(undefined),
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: () => undefined,
    },
    diagnostics,
    persisted,
  };
}

/** Run the shell the way `slopweaver atlas google-admin connect` does — same door, same parser. */
async function runAdminConnect({ deps }: { deps: GoogleConnectDeps<GoogleAdminDoorError> }): Promise<number> {
  return runGoogleConnect({
    deps,
    door: GOOGLE_ADMIN_DOOR,
    parse: (args) => parseGoogleAdminConnectArgs(args).mapErr((error) => [error.message, error.usage]),
    rest: ["--home", "/tmp/h"],
  });
}

describe("a read-only Google door's connect", () => {
  it("is what the Google Admin door declares itself", () => {
    expect(GOOGLE_ADMIN_DOOR.readOnly).toBe(true);
  });

  it("refuses to store an admin grant Google returned carrying Gmail write scopes, and names them", async () => {
    const captured = fakeDeps({ grantedScope: `${ADMIN_SCOPES} ${GMAIL_SEND} ${GMAIL_MODIFY}` });

    const code = await runAdminConnect({ deps: captured.deps });

    expect(code).toBe(EXIT_ERROR);
    expect(captured.persisted).toStrictEqual([]);
    expect(captured.diagnostics[0]).toContain(`Google returned ${GMAIL_SEND}, ${GMAIL_MODIFY}`);
  });

  it("stores an admin grant carrying only readonly scopes and the account binding", async () => {
    const captured = fakeDeps({ grantedScope: `openid ${ADMIN_SCOPES}` });

    const code = await runAdminConnect({ deps: captured.deps });

    expect(code).toBe(EXIT_OK);
    expect(captured.persisted.length).toBe(1);
    expect(captured.persisted[0]!.scopes).toContain(GOOGLE_ADMIN_SCOPES["directory-users"]);
    expect(captured.diagnostics).toStrictEqual([]);
  });
});
