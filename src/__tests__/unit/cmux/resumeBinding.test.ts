/**
 * `parseResumeBinding`: the Claude session cmux saved for a surface, read from the hook's live record first and the
 * restore record second — and nothing for a cleared binding, another agent's, or a tab that never ran Claude.
 */
import { describe, expect, it } from "vitest";

import { parseResumeBinding } from "../../../cmux/resumeBinding.js";

const SESSION = "a0000096-0000-4000-8000-000000000103";
const OLDER = "a0000049-0000-4000-8000-000000000052";

/** One saved record in the shape `surface.resume.get` answers with. */
function saved({ id, extra = {} }: { id: string; extra?: Record<string, unknown> }): Record<string, unknown> {
  return {
    checkpoint_id: id,
    cwd: "/wt/seat",
    kind: "claude",
    launch_command: { arguments: ["claude", "--model", "opus", "--resume", id] },
    ...extra,
  };
}

describe("parseResumeBinding", () => {
  it("reads the hook's live binding: id, cwd and the original argv joined", () => {
    expect(parseResumeBinding({ value: { resume_binding: saved({ id: SESSION }), restore_record: null } })).toEqual({
      argv: `claude --model opus --resume ${SESSION}`,
      checkpointId: SESSION,
      cwd: "/wt/seat",
      source: "resume_binding",
    });
  });

  it("prefers the live binding over the restore record when both are present", () => {
    const value = { restore_record: saved({ id: OLDER }), resume_binding: saved({ id: SESSION }) };

    expect(parseResumeBinding({ value })!.checkpointId).toBe(SESSION);
  });

  it("falls back to the restore record, reading working_directory when cwd is absent", () => {
    const record = saved({ extra: { cwd: undefined, working_directory: "/wt/other" }, id: OLDER });

    expect(parseResumeBinding({ value: { restore_record: record, resume_binding: null } })).toEqual({
      argv: `claude --model opus --resume ${OLDER}`,
      checkpointId: OLDER,
      cwd: "/wt/other",
      source: "restore_record",
    });
  });

  it("carries no argv when an argument is not a string", () => {
    const record = saved({ extra: { launch_command: { arguments: ["claude", 7] } }, id: SESSION });

    expect(parseResumeBinding({ value: { resume_binding: record } })!.argv).toBe(undefined);
  });

  it("reads nothing for a cleared binding, another agent's, an empty id, or an idle tab", () => {
    expect(parseResumeBinding({ value: { cleared: true, resume_binding: saved({ id: SESSION }) } })).toBe(undefined);
    expect(parseResumeBinding({ value: { resume_binding: saved({ extra: { kind: "codex" }, id: SESSION }) } })).toBe(
      undefined,
    );
    expect(parseResumeBinding({ value: { resume_binding: saved({ id: "" }) } })).toBe(undefined);
    expect(parseResumeBinding({ value: { restore_record: null, resume_binding: null } })).toBe(undefined);
    expect(parseResumeBinding({ value: "not a record" })).toBe(undefined);
  });
});
