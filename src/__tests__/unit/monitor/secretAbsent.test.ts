/**
 * `secret-absent` over the REAL credential register — the incident store, this install's measured store, and
 * each row the criterion leaves alone on purpose — plus the card every live settable row would post.
 */
import { describe, expect, it } from "vitest";

import { postingRefusal } from "../../../hand/posting.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../../../hand/step.js";
import { unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import { evaluateSecretAbsent } from "../../../monitor/secretAbsent.js";
import { CREDENTIALS, type CredentialSpec } from "../../../secrets/registry.js";

import { firing } from "./readings.js";

/** The register, widened to its declared element type so a fixture row can sit beside a real one. */
const REGISTER: readonly CredentialSpec[] = CREDENTIALS;

/** Every live row's file name — a store holding the whole of what this install reads. */
const LIVE_NAMES: readonly string[] = REGISTER.filter((spec) => spec.lifecycle === "live").map((spec) => spec.name);

/**
 * A store holding every live row except the ones named, plus any extra file names.
 *
 * @param without the live rows left out
 * @param extra names added beside them — a retired row, a stray
 * @returns the stored names
 */
function storeWithout({
  without,
  extra = [],
}: {
  without: readonly string[];
  extra?: readonly string[];
}): ReadonlySet<string> {
  return new Set([...LIVE_NAMES.filter((name) => !without.includes(name)), ...extra]);
}

/** Judge a store against the shipped register. */
function judge({ storedNames }: { storedNames: ReadonlySet<string> }) {
  return evaluateSecretAbsent({ specs: REGISTER, storedNames });
}

describe("evaluateSecretAbsent", () => {
  it("fires on the Google admin client pair a consent split added while the user-data pair stood stored", () => {
    const reading = firing({
      reading: judge({
        storedNames: storeWithout({ without: ["google-admin-client-id", "google-admin-client-secret"] }),
      }),
    });
    expect(reading.subjects.map((subject) => [subject.id, subject.key, subject.literal])).toEqual([
      ["google-admin-client-id", "google-admin-client-id", "slopweaver secrets set google-admin-client-id"],
      ["google-admin-client-secret", "google-admin-client-secret", "slopweaver secrets set google-admin-client-secret"],
    ]);
  });

  it("names what is stopped and which stored rows it goes with, in the subject's label", () => {
    const reading = firing({
      reading: judge({
        storedNames: storeWithout({ without: ["google-admin-client-id", "google-admin-client-secret"] }),
      }),
    });
    expect(reading.subjects[0]!.label).toBe(
      "slopweaver atlas google-admin * (stored beside it: google-client-id, google-client-secret) — Google: a Desktop-app OAuth client id, in the same Cloud project as `google-client-id`",
    );
  });

  it("fires on exactly backup-passphrase over this install's measured store, through its declared link", () => {
    const measured = storeWithout({
      extra: ["gmail-client-id", "gmail-client-secret", "openai-api-key", "chatgpt-request-paste.txt"],
      without: ["github-token", "hex-api-token", "graphql-hive-token", "backup-passphrase"],
    });
    const reading = firing({ reading: judge({ storedNames: measured }) });
    expect(reading.subjects.map((subject) => [subject.id, subject.label])).toEqual([
      [
        "backup-passphrase",
        "slopweaver store backup, slopweaver store rehearse (stored beside it: store-backup-directory) — the operator's password manager — slopweaver never reads it from there: the one master password that wraps the backup key and encrypts the backup's credentials leg",
      ],
    ]);
  });

  it("is clear on an empty store — a source never connected is not a gap", () => {
    expect(judge({ storedNames: new Set() })).toEqual({ monitorId: "secret-absent", state: "clear" });
  });

  it("is clear when every live row is stored", () => {
    expect(judge({ storedNames: storeWithout({ without: [] }) }).state).toBe("clear");
  });

  it("does not count a stored RETIRED row as evidence the platform is in use", () => {
    expect(judge({ storedNames: new Set(["gmail-client-id", "gmail-client-secret"]) }).state).toBe("clear");
  });

  it("leaves an optional row alone however much of its platform is stored", () => {
    expect(judge({ storedNames: new Set(["jumpcloud-api-key"]) }).state).toBe("clear");
  });

  it("never asks for a row that is not settable — a hand-installed file is not a paste", () => {
    // outlook-oauth.json is linked to this row and is a grant, so only settability keeps it off the card.
    expect(judge({ storedNames: new Set(["outlook-client-id"]) }).state).toBe("clear");
  });

  it("cards the shared Microsoft registration when either Outlook grant is stored without it", () => {
    const mailOnly = firing({ reading: judge({ storedNames: new Set(["outlook-oauth.json"]) }) });
    const calendarOnly = firing({ reading: judge({ storedNames: new Set(["outlook-calendar-oauth.json"]) }) });
    expect([mailOnly, calendarOnly].map((reading) => reading.subjects.map((subject) => subject.id))).toEqual([
      ["outlook-client-id"],
      ["outlook-client-id"],
    ]);
  });

  it("does not fold a per-door grant onto its base platform, so a door never connected stays silent", () => {
    const clientsOnly = new Set([
      "google-client-id",
      "google-client-secret",
      "google-admin-client-id",
      "google-admin-client-secret",
    ]);
    expect(judge({ storedNames: clientsOnly }).state).toBe("clear");
  });

  it("does not read the link backwards — a stored passphrase says nothing about a missing destination", () => {
    expect(judge({ storedNames: new Set(["backup-passphrase"]) }).state).toBe("clear");
  });

  it("does not count a stray file the register does not know", () => {
    expect(judge({ storedNames: new Set(["chatgpt-request-paste.txt"]) }).state).toBe("clear");
  });

  it("fires on one missing member of a three-row platform, naming both stored siblings", () => {
    const reading = firing({ reading: judge({ storedNames: new Set(["vanta-client-id", "vanta-client-secret"]) }) });
    expect(reading.subjects.map((subject) => subject.id)).toEqual(["vanta-tenant-slug"]);
    expect(reading.subjects[0]!.label).toContain("(stored beside it: vanta-client-id, vanta-client-secret)");
  });
});

describe("the secret-absent card, for every live settable row", () => {
  const definition = monitorDefinition({ monitorId: "secret-absent" });
  const settable = REGISTER.filter((spec) => spec.lifecycle === "live" && spec.settable && spec.optional !== true);

  it("covers at least one row, so the sweep below is true of something", () => {
    expect(settable.length).toBeGreaterThan(0);
  });

  it("posts its own sentence, inside every cap, and the posting form accepts it", () => {
    const failures = settable.flatMap((spec) => {
      // A stored sibling on the same platform: the real evaluator mints the real label and literal.
      const sibling: CredentialSpec = { ...spec, name: "a-stored-sibling-row-here" };
      const subject = firing({
        reading: evaluateSecretAbsent({ specs: [spec, sibling], storedNames: new Set([sibling.name]) }),
      }).subjects[0]!;
      const built = buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition,
        nowIso: "2026-09-29T08:00:00.000Z",
        postedBy: "workspace:29",
        subject,
      });
      return built.match(
        (step) =>
          [
            { failed: step.what !== definition.what({ subject }), problem: "fell back to plainWhat" },
            { failed: step.what.length > WHAT_CAP, problem: "what past the cap" },
            { failed: step.unblocks.length > UNBLOCKS_CAP, problem: "unblocks past the cap" },
            { failed: postingRefusal({ step }) !== undefined, problem: "refused by the posting form" },
            {
              failed: step.literal !== `slopweaver secrets set ${spec.name}`,
              problem: "literal is not the set command",
            },
          ]
            .filter((check) => check.failed)
            .map((check) => `${spec.name}: ${check.problem}`),
        (refusal) => [`${spec.name}: ${refusal.detail}`],
      );
    });
    expect(failures).toEqual([]);
  });

  it("opens its own queue item in the work context, pastes into the owner's terminal, and does not float", () => {
    const subject = firing({
      reading: judge({ storedNames: storeWithout({ without: ["google-admin-client-id"] }) }),
    }).subjects[0]!;
    const step = unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition,
        nowIso: "2026-09-29T08:00:00.000Z",
        postedBy: "workspace:29",
        subject,
      }),
    );
    expect([step.id, step.what, step.url, step.context, step.where, definition.floats, definition.perSubject]).toEqual([
      "mon-secret-google-admin-client-id",
      "Store the google-admin-client-id secret on this machine — it is missing beside ones already stored",
      "http://localhost:3000/queue?open=hand%3Amon-secret-google-admin-client-id&context=work",
      "work",
      "Your own terminal — it asks for the value without echoing it, and the card clears once the file is there",
      undefined,
      true,
    ]);
  });
});
