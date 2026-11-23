/**
 * System Audio Recording's helper: where each build finds it, which of its answers are statuses, and the sentence each
 * failure shows under the guide's button.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { PermissionGuideErrors } from "../../src/errors";
import { helperPathOf, parseSystemAudioHelperResult } from "../../src/systemAudioPermission";

describe("helperPathOf", () => {
  it("finds the installed app's helper beside its executable, and a dev run's in its build directory", () => {
    expect(
      helperPathOf({
        appPath: "/Applications/Slopweaver.app/Contents/Resources/app.asar",
        packaged: true,
        resourcesPath: "/Applications/Slopweaver.app/Contents/Resources",
      }),
    ).toBe("/Applications/Slopweaver.app/Contents/MacOS/slopweaver-system-audio");
    expect(
      helperPathOf({
        appPath: "/c/slopweaver/desktop",
        packaged: false,
        resourcesPath: "/c/slopweaver/desktop/node_modules/electron/dist/Electron.app/Contents/Resources",
      }),
    ).toBe("/c/slopweaver/desktop/build/native/slopweaver-system-audio");
  });
});

describe("parseSystemAudioHelperResult", () => {
  it("reads each of the three answers", () => {
    expect(unwrap(parseSystemAudioHelperResult({ code: 0, stderr: "", stdout: "granted\n" }))).toBe("granted");
    expect(unwrap(parseSystemAudioHelperResult({ code: 0, stderr: "", stdout: "denied\n" }))).toBe("denied");
    expect(unwrap(parseSystemAudioHelperResult({ code: 0, stderr: "", stdout: "not-determined\n" }))).toBe(
      "not-determined",
    );
  });

  it("reads nothing else as an answer, granted least of all", () => {
    const malformed = [
      { stderr: "", stdout: "granted" },
      { stderr: "", stdout: " granted\n" },
      { stderr: "", stdout: "granted\ndenied\n" },
      { stderr: "", stdout: "allowed\n" },
      { stderr: "", stdout: "toString\n" },
      { stderr: "", stdout: "" },
      { stderr: "warning\n", stdout: "granted\n" },
    ];
    expect(
      malformed.map(({ stdout, stderr }) => unwrapErr(parseSystemAudioHelperResult({ code: 0, stderr, stdout })).code),
    ).toEqual(malformed.map(() => "SYSTEM_AUDIO_HELPER_MALFORMED"));
    expect(unwrapErr(parseSystemAudioHelperResult({ code: 0, stderr: "", stdout: "allowed\n" })).message).toBe(
      'System Audio Recording could not be read: the helper answered "allowed\\n", not granted, denied or not-determined',
    );
  });

  it("names what the helper reported, not its answer, when it wrote a problem beside a good answer", () => {
    const read = parseSystemAudioHelperResult({ code: 0, stderr: "TCC lookup warning\n", stdout: "granted\n" });
    expect(unwrapErr(read).message).toBe(
      'System Audio Recording could not be read: the helper reported "TCC lookup warning" beside its answer "granted\\n"',
    );
  });

  it("says a failed or stopped helper's own last line", () => {
    const failed = unwrapErr(
      parseSystemAudioHelperResult({ code: 3, stderr: "this macOS has no TCCAccessPreflight\n", stdout: "" }),
    );
    expect(failed).toEqual({
      code: "SYSTEM_AUDIO_HELPER_FAILED",
      exitCode: 3,
      message: "System Audio Recording could not be read (exit 3): this macOS has no TCCAccessPreflight",
      stderr: "this macOS has no TCCAccessPreflight\n",
    });
    expect(unwrapErr(parseSystemAudioHelperResult({ code: null, stderr: "", stdout: "granted\n" })).message).toBe(
      "System Audio Recording could not be read (the helper was stopped): no output",
    );
  });
});

describe("PermissionGuideErrors for the helper", () => {
  it("names a missing helper and the reinstall that puts it back", () => {
    expect(
      PermissionGuideErrors.helperMissing({ path: "/A/Slopweaver.app/Contents/MacOS/slopweaver-system-audio" }),
    ).toEqual({
      code: "SYSTEM_AUDIO_HELPER_MISSING",
      message:
        "System Audio Recording could not be read: /A/Slopweaver.app/Contents/MacOS/slopweaver-system-audio is missing. Reinstall Slopweaver with slopweaver desktop install",
      path: "/A/Slopweaver.app/Contents/MacOS/slopweaver-system-audio",
    });
  });

  it("tells a read that hung from a prompt nobody answered", () => {
    expect(PermissionGuideErrors.helperTimedOut({ timeoutMs: 3000, verb: "preflight" }).message).toBe(
      "System Audio Recording could not be read: the helper did not answer in 3s",
    );
    expect(PermissionGuideErrors.helperTimedOut({ timeoutMs: 300_000, verb: "request" }).message).toBe(
      "macOS's System Audio Recording prompt had no answer in 5 minutes; answer it if it is still up, or turn it on in System Settings",
    );
  });

  it("carries why the helper did not start", () => {
    expect(
      PermissionGuideErrors.helperStartFailed({ cause: new Error("EACCES"), path: "/h", verb: "request" }),
    ).toEqual({
      code: "SYSTEM_AUDIO_HELPER_START_FAILED",
      message: "System Audio Recording's helper did not start (request): EACCES",
      path: "/h",
      verb: "request",
    });
  });
});
