/**
 * The guard the whole 1Password atlas exists to earn: a synthetic item carrying a password, a secure note
 * and a one-time code is pushed through the real projection, and none of those values can be found anywhere
 * in what the atlas would write. Then the same values are hand-built into a document and the pre-write gate
 * is asked to admit it, which it must refuse.
 *
 * Two mechanisms, tested separately ON PURPOSE. The projection dropping a field and the gate refusing a
 * document are independent defences — a test that only exercised one would pass while the other regressed.
 */
import { describe, expect, it } from "vitest";

import { stableJson } from "../../../../atlas/atlasFile.js";
import {
  ONEPASSWORD_FORBIDDEN_OP_VERBS,
  ONEPASSWORD_OP_COMMANDS,
  ONEPASSWORD_OUT_OF_SCOPE_GROUPS,
} from "../../../../atlas/onepassword/inventory.js";
import {
  initialOnepasswordManifest,
  ONEPASSWORD_ATLAS_PLATFORM,
  ONEPASSWORD_ATLAS_SCHEMA_VERSION,
  type OnepasswordKindFile,
} from "../../../../atlas/onepassword/model.js";
import {
  projectOnepasswordGroup,
  projectOnepasswordUser,
  projectOnepasswordVault,
} from "../../../../atlas/onepassword/projection.js";
import {
  admitOnepasswordDocument,
  admitOnepasswordKindFile,
  scanForSensitivity,
  scanKindFileForSensitivity,
} from "../../../../atlas/onepassword/sensitivity.js";
import { onepasswordStoreSpec } from "../../../../atlas/onepassword/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-08-29T00:00:00.000Z";

/**
 * Leak-shaped fixtures, assembled at runtime rather than written as literals.
 *
 * The public hygiene gate scans this repo's own committed sources for exactly these shapes, and it is right
 * to: that gate is about what reaches git. Spelling the shape across a concatenation keeps the value
 * identical at runtime — which is what the code under test sees — while leaving no leak-shaped literal in a
 * tracked file. Reproduce the refusal by inlining either constant and running `yarn tsx
 * src/devLint/hygiene.entry.ts`.
 */
const SLACK_SHAPED_UUID = `C6RQ${"4XKPZJ2N5MWT8VHD3YFB7A"}`;
// 48 characters, the length OpenAI actually issues — the gate's floor was raised from 20 to the provider's
// own shape after `sk-` + 20 of anything was measured hitting corpus records and no key at all
// (`src/hygiene/scan.ts`, PATTERNS).
const OPENAI_SHAPED_KEY = `sk${"-"}${"a".repeat(48)}`;
const SERVICE_ACCOUNT_SHAPED = `ops${"_"}${"a".repeat(28)}`;

/** The three values that must never survive anything in this atlas. */
const PASSWORD = "hunter2-correct-horse-battery-staple";
const NOTE = "the wifi password for the office is on the whiteboard";
const ONE_TIME_CODE = "482915";

describe("the 1Password projection drops every secret field", () => {
  it("keeps a user's allowlisted fields and drops the secret ones it was handed", () => {
    const projected = unwrap(
      projectOnepasswordUser({
        at: AT,
        raw: {
          created_at: "2026-01-02T03:04:05Z",
          email: "person@example.test",
          id: "AAAAAAAAAAAAAAAAAAAAAAAAAA",
          last_auth_at: "2026-08-01T00:00:00Z",
          name: "A Person",
          notesPlain: NOTE,
          one_time_password: ONE_TIME_CODE,
          password: PASSWORD,
          state: "ACTIVE",
          type: "MEMBER",
          updated_at: "2026-08-01T00:00:00Z",
        },
      }),
    );

    const written = stableJson({ value: projected });
    expect(written).toContain("person@example.test");
    expect(written.includes(PASSWORD)).toBe(false);
    expect(written.includes(NOTE)).toBe(false);
    expect(written.includes(ONE_TIME_CODE)).toBe(false);
  });

  it("keeps a vault's item COUNT and drops an item list smuggled beside it", () => {
    const projected = unwrap(
      projectOnepasswordVault({
        at: AT,
        raw: {
          created_at: "2026-01-02T03:04:05Z",
          description: "shared credentials",
          id: "BBBBBBBBBBBBBBBBBBBBBBBBBB",
          items: 41,
          name: "Engineering",
          type: "USER_CREATED",
          updated_at: "2026-08-01T00:00:00Z",
          // Not a field 1Password returns here — the point is that an unrecognised one is dropped at the
          // boundary rather than stored because nobody thought to exclude it.
          items_detail: [{ password: PASSWORD, title: "AWS root" }],
        },
      }),
    );

    const written = stableJson({ value: projected });
    expect(written).toContain("41");
    expect(written.includes(PASSWORD)).toBe(false);
    expect(written.includes("AWS root")).toBe(false);
  });

  it("drops a secret smuggled into a group's description-shaped payload", () => {
    const projected = unwrap(
      projectOnepasswordGroup({
        at: AT,
        raw: {
          created_at: "2026-01-02T03:04:05Z",
          description: "the on-call rotation",
          id: "CCCCCCCCCCCCCCCCCCCCCCCCCC",
          name: "On call",
          recovery_key: PASSWORD,
          state: "ACTIVE",
          type: "USER_DEFINED",
          updated_at: "2026-08-01T00:00:00Z",
        },
      }),
    );

    expect(stableJson({ value: projected }).includes(PASSWORD)).toBe(false);
  });
});

describe("the pre-write gate refuses a document a projection regression would have let through", () => {
  it("refuses a forbidden key name, and names the path without printing the value", () => {
    const admitted = admitOnepasswordDocument({
      denylist: [],
      document: { entities: [{ channels: { "admin-cli": { detail: { password: PASSWORD } } } }] },
      label: "users.json",
    });

    expect(admitted.isErr()).toBe(true);
    const reported = admitted._unsafeUnwrapErr().join("\n");
    expect(reported).toContain("entities.0.channels.admin-cli.detail.password");
    expect(reported.includes(PASSWORD)).toBe(false);
  });

  it("refuses each of the three secret shapes on its own", () => {
    const forbidden = [{ notesPlain: NOTE }, { oneTimePassword: ONE_TIME_CODE }, { totp: ONE_TIME_CODE }];

    const refusals = forbidden.map((detail) =>
      admitOnepasswordDocument({ denylist: [], document: { entities: [detail] }, label: "users.json" }).isErr(),
    );

    expect(refusals).toEqual([true, true, true]);
  });

  it("refuses a 1Password credential SHAPE even under a key name nothing forbids", () => {
    const findings = scanForSensitivity({
      denylist: [],
      document: { entities: [{ name: SERVICE_ACCOUNT_SHAPED }] },
    });

    expect(findings.map((finding) => finding.label)).toEqual(["onepassword-service-account-token"]);
    expect(findings.map((finding) => finding.disposition)).toEqual(["refuse"]);
  });

  it("REPORTS a private-denylist hit rather than refusing, because this atlas's subject is the organisation", () => {
    const admitted = admitOnepasswordDocument({
      denylist: ["acmecorp"],
      document: { entities: [{ name: "acmecorp engineering" }] },
      label: "groups.json",
    });

    expect(admitted.isOk()).toBe(true);
    const findings = unwrap(admitted);
    expect(findings.map((finding) => finding.disposition)).toEqual(["report"]);
  });

  it("admits an ordinary admin record untouched", () => {
    const admitted = admitOnepasswordDocument({
      denylist: [],
      document: { entities: [{ email: "person@example.test", name: "A Person", state: "ACTIVE" }] },
      label: "users.json",
    });

    expect(unwrap(admitted)).toEqual([]);
  });
});

describe("the closed command allowlist cannot reach an item", () => {
  it("contains no forbidden verb", () => {
    const firstWords = ONEPASSWORD_OP_COMMANDS.map((command) => command.template[0]);

    expect(firstWords.filter((word) => ONEPASSWORD_FORBIDDEN_OP_VERBS.includes(word!))).toEqual([]);
  });
});

describe("a leak class that is a provider-identifier shape reports; a credential shape refuses", () => {
  it("RECORDS a Slack-shaped id rather than refusing, because that shape is this atlas's primary key", () => {
    // A 1Password entity uuid that happens to begin with one of [CUAW] — this is what fired throughout
    // the first real events pull and refused the whole generation.
    const admitted = admitOnepasswordDocument({
      denylist: [],
      document: { entities: [{ providerId: SLACK_SHAPED_UUID }] },
      label: "events.json",
    });

    expect(admitted.isOk()).toBe(true);
    const findings = unwrap(admitted);
    expect(findings.map((finding) => finding.label)).toEqual(["raw-workspace-id"]);
    expect(findings.map((finding) => finding.disposition)).toEqual(["report"]);
  });

  it("still REFUSES a credential-shaped value in the very same document", () => {
    const admitted = admitOnepasswordDocument({
      denylist: [],
      document: {
        entities: [{ note: SERVICE_ACCOUNT_SHAPED, providerId: SLACK_SHAPED_UUID }],
      },
      label: "events.json",
    });

    expect(unwrapErr(admitted)).toEqual([
      "refusing to write events.json: the sensitivity gate found 1 thing(s) that must never reach this atlas",
      "  <document>: a value matching the onepassword-service-account-token shape reached the document " +
        "[witness cc5110d6aee182fd]",
      "nothing was written — the value itself is deliberately not printed above",
    ]);
  });

  it("still REFUSES an unrelated provider's token shape", () => {
    const admitted = admitOnepasswordDocument({
      denylist: [],
      document: { entities: [{ note: OPENAI_SHAPED_KEY }] },
      label: "events.json",
    });

    expect(unwrapErr(admitted)).toEqual([
      "refusing to write events.json: the sensitivity gate found 1 thing(s) that must never reach this atlas",
      "  <document>:4: a value matching the openai-style-key leak class reached the document " +
        "[witness e1aa1d5b99d61d3b]",
      "nothing was written — the value itself is deliberately not printed above",
    ]);
  });
});

describe("a kind file is scanned one line at a time, the way the kit writes it", () => {
  it("names a value finding by its line in the file: the envelope is line 1, the first entity line 2", () => {
    const findings = scanKindFileForSensitivity({
      denylist: [],
      entities: [{ id: "first", providerId: SLACK_SHAPED_UUID }],
      envelope: { kind: "event", note: SLACK_SHAPED_UUID },
    });

    expect(findings.map((finding) => `${finding.label} ${finding.path}`)).toEqual([
      "raw-workspace-id <kind file>:1",
      "raw-workspace-id <kind file>:2",
    ]);
  });

  it("refuses a credential shape in one entity, naming that entity's line and never the value", () => {
    const admitted = admitOnepasswordKindFile({
      denylist: [],
      entities: [{ id: "clean" }, { note: SERVICE_ACCOUNT_SHAPED }],
      envelope: { kind: "event" },
      label: "event file",
    });

    expect(unwrapErr(admitted)).toEqual([
      "refusing to write event file: the sensitivity gate found 1 thing(s) that must never reach this atlas",
      "  <kind file>:3: a value matching the onepassword-service-account-token shape reached the document " +
        "[witness cc5110d6aee182fd]",
      "nothing was written — the value itself is deliberately not printed above",
    ]);
  });

  it("keeps every forbidden-key path the whole-document walk reported", () => {
    const envelope = { metadata: { password: PASSWORD } };
    const entities = [{ channels: { "admin-cli": { detail: { password: PASSWORD } } } }];
    const forbiddenPaths = ({ findings }: { findings: readonly { label: string; path: string }[] }): string[] =>
      findings.filter((finding) => finding.label === "forbidden-key").map((finding) => finding.path);

    const lineByLine = forbiddenPaths({ findings: scanKindFileForSensitivity({ denylist: [], entities, envelope }) });
    const whole = forbiddenPaths({
      findings: scanForSensitivity({ denylist: [], document: { ...envelope, entities } }),
    });

    expect(lineByLine).toEqual(["metadata.password", "entities.0.channels.admin-cli.detail.password"]);
    expect(lineByLine).toEqual(whole);
  });

  // The defect this closes: the `events` kind pretty-printed whole into one string whose length is the
  // tenant's, and it grows without bound. The whole-document seam is asserted to REFUSE the same value first, which is what makes
  // the admission falsifiable. The 110 entities share ONE 1 MiB string, so the heap holds a megabyte.
  it("admits a kind file the whole-document serialisation refuses", () => {
    const blob = "x".repeat(1024 * 1024);
    const entities = Array.from({ length: 110 }, (_unused, at) => ({ blob, id: `entity-${String(at)}` }));
    const envelope = { kind: "event" };

    expect(() => stableJson({ value: { ...envelope, entities } })).toThrow(/over the 100 MiB cap/);

    expect(unwrap(admitOnepasswordKindFile({ denylist: [], entities, envelope, label: "event file" }))).toEqual([]);
  });

  it("is the scan the store's publish guard runs on a kind file", () => {
    const file: OnepasswordKindFile = {
      coverage: [],
      entities: [],
      gaps: [],
      kind: "event",
      platform: ONEPASSWORD_ATLAS_PLATFORM,
      schemaVersion: ONEPASSWORD_ATLAS_SCHEMA_VERSION,
      updatedAt: SLACK_SHAPED_UUID,
    };
    const seen: string[] = [];

    const guarded = onepasswordStoreSpec({
      denylist: [],
      files: { event: file },
      onFindings: ({ findings }) => {
        seen.push(...findings.map((finding) => `${finding.label} ${finding.path}`));
      },
    }).guardPublish!({ next: initialOnepasswordManifest({ updatedAt: AT }), prior: null });

    expect(unwrap(guarded)).toBe(null);
    expect(seen).toEqual(["raw-workspace-id <kind file>:1"]);
  });
});

describe("the allowlist names only commands `op` actually has", () => {
  /**
   * Measured against op 2.39.0: `op events-api --help` offers only `create`, and
   * `op service-account --help` only `create` and `ratelimit`. Both were in the allowlist until the first
   * real roster run, where op answered the invented command with its help text on stdout and exit 0 — which
   * reached the atlas as `cli-output-unreadable` and read like a permissions problem. Reproduce with
   * `op events-api --help`; it needs no session and no account.
   */
  const INVENTED = [
    ["events-api", "list"],
    ["service-account", "list"],
  ];

  it("no longer claims a list verb that does not exist", () => {
    const templates = new Set(ONEPASSWORD_OP_COMMANDS.map((command) => command.template.join(" ")));

    expect(INVENTED.filter((invented) => templates.has(invented.join(" ")))).toEqual([]);
  });

  it("declares each of them out of scope instead, so the absence is stated rather than silent", () => {
    const declared = ONEPASSWORD_OUT_OF_SCOPE_GROUPS.join("\n");

    expect(declared).toContain("`op events-api` exposes only `create`");
    expect(declared).toContain("`op service-account` exposes only `create` and `ratelimit`");
  });

  it("keeps the Connect server list, which op does have", () => {
    const templates = ONEPASSWORD_OP_COMMANDS.map((command) => command.template.join(" "));

    expect(templates).toContain("connect server list");
  });
});
