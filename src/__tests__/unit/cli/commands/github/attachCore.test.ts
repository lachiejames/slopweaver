import { describe, expect, it } from "vitest";

import {
  attachDoorRequest,
  attachStateHome,
  embedAltText,
  GITHUB_ATTACH_FLAG_NAMES,
  type GithubAttachUploadArgs,
  offlineStatusLines,
  orgGrantRefusal,
  parseGithubAttachArgs,
  statusOnlyLines,
} from "../../../../../cli/commands/github/attachCore.js";
import { githubVerbErrorLines } from "../../../../../cli/commands/github/errors.js";
import { GITHUB_ATTACH_USAGE } from "../../../../../cli/commands/github/prUsage.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { GithubSessionStatus } from "../../../../../outbound/github/chromeSession.js";

const UPLOAD_ARGV = [
  "upload",
  "--file",
  "shot.png",
  "--repo",
  "slopweaver/slopweaver",
  "--number",
  "485",
  "--proves",
  "the unit suite passes",
] as const;

/** The parsed upload args every door test starts from. */
function uploadArgs(): GithubAttachUploadArgs {
  const parsed = unwrap(parseGithubAttachArgs({ rest: [...UPLOAD_ARGV] }));
  if (parsed.kind !== "upload") {
    throw new Error("fixture parsed as the wrong sub-verb");
  }
  return parsed;
}

/** A browser session status, usable and fully named unless a case overrides a field. */
function sessionStatus(over: Partial<GithubSessionStatus> = {}): GithubSessionStatus {
  return {
    detail: undefined,
    expiresAtIso: "2026-10-01T00:00:00.000Z",
    login: "octo",
    present: true,
    sessionScoped: false,
    source: "Profile 1",
    usable: true,
    ...over,
  };
}

describe("embedAltText", () => {
  it("uses the uploaded file's own name when no --alt was given", () => {
    expect(embedAltText({ args: uploadArgs(), uploadName: "shot.png" })).toBe("shot.png");
  });

  it("keeps a given --alt, an empty one included, rather than the file name", () => {
    expect(embedAltText({ args: { ...uploadArgs(), alt: "the board" }, uploadName: "shot.png" })).toBe("the board");
    expect(embedAltText({ args: { ...uploadArgs(), alt: "" }, uploadName: "shot.png" })).toBe("");
  });
});

describe("offlineStatusLines", () => {
  it("names an unusable session's reason, and `unknown` when the read named none", () => {
    expect(offlineStatusLines({ status: sessionStatus({ detail: "no cookies", usable: false }) })).toEqual([
      "Profile 1 holds no usable github.com session: no cookies",
    ]);
    expect(offlineStatusLines({ status: sessionStatus({ present: false }) })).toEqual([
      "Profile 1 holds no usable github.com session: unknown",
    ]);
  });

  it("names the account and when its cookies expire", () => {
    expect(offlineStatusLines({ status: sessionStatus({ sessionScoped: true }) })).toEqual([
      "Profile 1 is signed in to github.com as octo",
      "its auth cookies expire 2026-10-01T00:00:00.000Z, and one is session-scoped, so it may lapse sooner",
    ]);
  });

  it("says the read named no account, and that the cookies carry no expiry, when neither was read", () => {
    expect(offlineStatusLines({ status: sessionStatus({ expiresAtIso: undefined, login: undefined }) })).toEqual([
      "Profile 1 is signed in to github.com as an account it does not name",
      "its auth cookies carry no expiry, so GitHub ends the session on its own schedule — it works until it does not",
    ]);
  });
});

describe("statusOnlyLines", () => {
  it("adds the org-grant caveat to a usable session and nothing to an unusable one", () => {
    expect(statusOnlyLines({ status: sessionStatus() })).toEqual([
      "Profile 1 is signed in to github.com as octo",
      "its auth cookies expire 2026-10-01T00:00:00.000Z",
      "reading the jar is not liveness, and it says NOTHING about a SAML org grant — pass --org <slug> to ask GitHub",
    ]);
    expect(statusOnlyLines({ status: sessionStatus({ detail: "expired", usable: false }) })).toEqual([
      "Profile 1 holds no usable github.com session: expired",
    ]);
  });
});

describe("orgGrantRefusal", () => {
  it("tells a dead session apart from a live one without the org's SAML grant", () => {
    expect(orgGrantRefusal({ org: "acme", verdict: "signed-out" })).toBe(
      "GitHub answered acme as an anonymous visitor — your browser's github.com cookies are dead",
    );
    expect(orgGrantRefusal({ org: "acme", verdict: "walled" })).toBe(
      "your browser is signed in but NOT SAML-authorised for acme, so every upload there is refused; press its " +
        "single sign-on prompt with `slopweaver browser sign-in --provider github --org acme`, or in your Chrome if that look finds it yours",
    );
  });
});

describe("parseGithubAttachArgs", () => {
  it("parses a complete upload invocation", () => {
    const result = parseGithubAttachArgs({ rest: [...UPLOAD_ARGV] });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).kind).toBe("upload");
    expect(uploadArgs().owner).toBe("slopweaver");
    expect(uploadArgs().repo).toBe("slopweaver");
    expect(uploadArgs().number).toBe(485);
    expect(uploadArgs().file).toBe("shot.png");
  });

  it("defaults dry-run and json to off", () => {
    expect(uploadArgs().dryRun).toBe(false);
    expect(uploadArgs().json).toBe(false);
  });

  it("carries --alt through", () => {
    const parsed = unwrap(parseGithubAttachArgs({ rest: [...UPLOAD_ARGV, "--alt", "before and after"] }));
    expect(parsed.kind === "upload" ? parsed.alt : undefined).toBe("before and after");
  });

  it("parses status with no repository address", () => {
    const result = parseGithubAttachArgs({ rest: ["status"] });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result).kind).toBe("status");
  });

  it("requires a sub-verb rather than defaulting to upload", () => {
    const result = parseGithubAttachArgs({ rest: [] });
    expect(result.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(result) })[0]).toBe("a sub-verb is required: upload or status");
  });

  it("refuses an unknown sub-verb by name", () => {
    const result = parseGithubAttachArgs({ rest: ["publish"] });
    expect(result.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(result) })[0]).toContain("unknown sub-verb publish");
  });

  it("refuses a second positional rather than ignoring it", () => {
    const result = parseGithubAttachArgs({ rest: ["upload", "extra"] });
    expect(result.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(result) })[0]).toContain("exactly one sub-verb");
  });

  it("refuses --file on status BY NAME rather than silently ignoring it", () => {
    const result = parseGithubAttachArgs({ rest: ["status", "--file", "shot.png"] });
    expect(result.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(result) })[0]).toContain("--file is only meaningful for");
  });

  it("collects every missing upload input at once, --proves included", () => {
    const result = parseGithubAttachArgs({ rest: ["upload"] });
    expect(result.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(result) }).length).toBe(4);
  });

  it("carries --proves through", () => {
    expect(uploadArgs().proves).toBe("the unit suite passes");
  });

  it("requires --proves even when everything else is there", () => {
    const result = parseGithubAttachArgs({ rest: UPLOAD_ARGV.slice(0, -2) });
    expect(githubVerbErrorLines({ error: unwrapErr(result) })).toEqual([
      '--proves "<one line: what the picture proves>" is required',
    ]);
  });

  it("refuses a --proves line that is more than one line", () => {
    const result = parseGithubAttachArgs({ rest: [...UPLOAD_ARGV.slice(0, -1), "it passes\nand more"] });
    expect(githubVerbErrorLines({ error: unwrapErr(result) })).toEqual([
      "--proves is one line; put anything longer in the description, not beside the picture",
    ]);
  });

  it("refuses --proves on status BY NAME", () => {
    const result = parseGithubAttachArgs({ rest: ["status", "--proves", "x"] });
    expect(githubVerbErrorLines({ error: unwrapErr(result) })[0]).toContain("--proves is only meaningful for");
  });

  it("refuses a repo slug that is not owner/name", () => {
    const result = parseGithubAttachArgs({ rest: ["upload", "--file", "a.png", "--repo", "nope", "--number", "1"] });
    expect(result.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(result) })[0]).toContain("--repo owner/name is required");
  });

  it("refuses a non-numeric number", () => {
    const result = parseGithubAttachArgs({
      rest: ["upload", "--file", "a.png", "--repo", "o/r", "--number", "abc"],
    });
    expect(result.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(result) })[0]).toContain("--number must be a positive whole number");
  });

  it("refuses a zero or negative number", () => {
    const result = parseGithubAttachArgs({ rest: ["upload", "--file", "a.png", "--repo", "o/r", "--number", "0"] });
    expect(result.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(result) })[0]).toContain("--number must be a positive whole number");
  });

  it("refuses the retired session sub-verbs by name, so a stale script fails loudly", () => {
    expect(githubVerbErrorLines({ error: unwrapErr(parseGithubAttachArgs({ rest: ["login"] })) })[0]).toContain(
      "expected upload or status",
    );
    expect(githubVerbErrorLines({ error: unwrapErr(parseGithubAttachArgs({ rest: ["import"] })) })[0]).toContain(
      "expected upload or status",
    );
  });

  it("refuses an unknown flag", () => {
    const result = parseGithubAttachArgs({ rest: ["upload", "--nope"] });
    expect(githubVerbErrorLines({ error: unwrapErr(result) })).toEqual(["unknown flag: --nope"]);
  });
});

describe("GITHUB_ATTACH_USAGE", () => {
  it("documents every flag the parser accepts", () => {
    const undocumented = GITHUB_ATTACH_FLAG_NAMES.filter((flag) => !GITHUB_ATTACH_USAGE.includes(flag));
    expect(undocumented).toEqual([]);
  });

  it("states both measured ceilings, so a reader never has to guess which applies", () => {
    expect(GITHUB_ATTACH_USAGE).toContain("10 MiB for an image, 100 MiB for a video");
  });
});

describe("attachDoorRequest", () => {
  it("declares an external write against the github noun, claiming no approval", () => {
    const request = attachDoorRequest({
      args: uploadArgs(),
      byteLength: 913213,
      contentType: "image/png",
      home: "/home",
    });
    expect(request.action).toEqual({ kind: "verb", noun: "github", verb: "attach" });
    expect(request.meta.effect).toBe("external-write");
    expect(request.meta.requiresApproval).toBe(false);
  });

  it("creates no work item — an uploaded asset is inert until somebody embeds it", () => {
    const request = attachDoorRequest({ args: uploadArgs(), byteLength: 1, contentType: "image/png", home: "/home" });
    expect(request.meta.createsWorkItem).toBe(false);
  });

  it("carries the credential kind in the artifact bag, where a gate can read it", () => {
    const request = attachDoorRequest({ args: uploadArgs(), byteLength: 1, contentType: "image/png", home: "/home" });
    expect(request.artifact["credential"]).toBe("web-session");
  });

  it("addresses the exact repository and number the token came from", () => {
    const request = attachDoorRequest({ args: uploadArgs(), byteLength: 1, contentType: "image/png", home: "/home" });
    expect(request.artifact["id"]).toBe("slopweaver/slopweaver#485");
  });

  it("records the exact byte count and content type being sent", () => {
    const request = attachDoorRequest({
      args: uploadArgs(),
      byteLength: 913213,
      contentType: "video/mp4",
      home: "/home",
    });
    expect(request.artifact["byteLength"]).toBe(913213);
    expect(request.artifact["contentType"]).toBe("video/mp4");
  });
});

describe("parseGithubAttachArgs — --org", () => {
  it("carries the organisation on status", () => {
    const parsed = parseGithubAttachArgs({ rest: ["status", "--org", "acme"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ home: undefined, json: false, kind: "status", org: "acme" });
  });

  it("leaves the organisation undefined when none is named", () => {
    const parsed = parseGithubAttachArgs({ rest: ["status"] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({ home: undefined, json: false, kind: "status", org: undefined });
  });

  it("refuses --org on upload BY NAME, where the org comes from --repo instead", () => {
    const parsed = parseGithubAttachArgs({
      rest: ["upload", "--file", "a.png", "--repo", "acme/widgets", "--number", "1", "--org", "acme"],
    });
    expect(parsed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "--org is only meaningful for `github attach status`",
    ]);
  });

  it("refuses --org on upload, which authorises nothing", () => {
    const parsed = parseGithubAttachArgs({ rest: ["upload", "--org", "acme"] });
    expect(parsed.isErr()).toBe(true);
    expect(githubVerbErrorLines({ error: unwrapErr(parsed) })).toEqual([
      "--org is only meaningful for `github attach status`",
    ]);
  });
});

describe("attachStateHome", () => {
  const resolveDefault = (): string => "/tmp/default-home";

  it("answers the named --home without resolving the default", () => {
    const args = unwrap(parseGithubAttachArgs({ rest: ["status", "--home", "/tmp/named-home"] }));
    expect(attachStateHome({ args, resolveDefault })).toBe("/tmp/named-home");
  });

  it("answers the resolved default when no --home is named", () => {
    const args = unwrap(parseGithubAttachArgs({ rest: ["status"] }));
    expect(attachStateHome({ args, resolveDefault })).toBe("/tmp/default-home");
  });
});
