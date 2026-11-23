/**
 * The reader for `secrets status --json` — which store files exist, never what is in them.
 *
 * A sibling of `./read.ts`, and every rule that file's module doc states governs this one: refuse rather than
 * substitute, never drop a row. Read `read.ts` first; what follows states only what is different.
 *
 * **What is different is what it is for.** It is the durable half of a paste field's receipt: the press's own
 * response says `set <name>` once, and this is what still says it after a reload — stored, and when the file was last
 * written. The verb prints no value (`src/secrets/status.ts`), and this projection keeps only the fields a receipt
 * draws, so nothing the verb might one day add reaches the page by accident.
 */

import { isBag, str } from "../../lib/bag";

/**
 * The shape of every `CredentialState` word (`src/secrets/status.ts`): lowercase letters in hyphen-joined runs, such as
 * `ok` or `write-scope-on-read-only`. A state added there later still matches and reaches the catalog as a finding;
 * anything else refuses the reading. It is a SHAPE check, not the guarantee: a token that happens to be lowercase words
 * would pass it. The guarantee is the verb's, whose `CredentialState` is a closed union computed from a file's mode,
 * name and grant metadata and never from its bytes, so this reader only stops a malformed document reaching the page.
 */
const STATE_WORD = /^[a-z]+(?:-[a-z]+)*$/u;

/** One store file, as far as a receipt needs to know. */
export interface SecretStatusRow {
  readonly name: string;
  readonly stored: boolean;
  /**
   * The verb's own verdict on the file (`CredentialState`, `src/secrets/status.ts`): `ok`, `absent`, or a finding
   * such as `access-token-expired` or `loose-mode`. Kept as the verb's string, so a state added there later reaches
   * the Integrations catalog as a finding rather than refusing every receipt on the page.
   */
  readonly state: string;
  /** When the file was last written, absent when it is not stored. */
  readonly modifiedIso: string | undefined;
  /** What the credential is, in the register's words — the field's hint. */
  readonly what: string | undefined;
}

/**
 * Project `secrets status --json` into one row per store file.
 *
 * @param payload the parsed document
 * @returns the rows, or `undefined` when the payload is not the verb's shape
 */
export function readSecretStatus(payload: unknown): readonly SecretStatusRow[] | undefined {
  if (!isBag(payload) || !Array.isArray(payload["rows"])) {
    return undefined;
  }
  const out: SecretStatusRow[] = [];
  for (const entry of payload["rows"] as readonly unknown[]) {
    if (!isBag(entry)) {
      return undefined;
    }
    const name = str({ bag: entry, key: "name" });
    const stored = entry["stored"];
    const state = str({ bag: entry, key: "state" });
    if (name === undefined || typeof stored !== "boolean" || state === undefined || !STATE_WORD.test(state)) {
      return undefined;
    }
    out.push({
      modifiedIso: str({ bag: entry, key: "modifiedIso" }),
      name,
      state,
      stored,
      what: str({ bag: entry, key: "what" }),
    });
  }
  return out;
}

/** The three words the verb's `datadogSite` may be (`DatadogSiteState`, `src/datadog/config.ts`). */
const DATADOG_SITE_WORDS = ["set", "unset", "invalid"] as const;

/** One of {@link DATADOG_SITE_WORDS}. */
export type DatadogSiteWord = (typeof DATADOG_SITE_WORDS)[number];

/** Whether a string is one of the three site words, so any other string is refused rather than carried. */
function isDatadogSiteWord(value: string): value is DatadogSiteWord {
  return (DATADOG_SITE_WORDS as readonly string[]).includes(value);
}

/** The whole store as the Integrations catalog reads it: its rows, and whether a Datadog site is named. */
export interface SecretStoreReading {
  readonly rows: readonly SecretStatusRow[];
  /**
   * The verb's `datadogSite`: `set`, `unset` or `invalid`. Config, not a secret, so it sits beside the rows. Any
   * other string refuses the whole reading, so the page never carries bytes the verb did not mean as one of these.
   */
  readonly datadogSite: DatadogSiteWord;
}

/**
 * Project `secrets status --json` into its rows and its Datadog site verdict, refusing a document missing either.
 *
 * @param payload the parsed document
 * @returns the reading, or `undefined` when the payload is not the verb's shape
 */
export function readSecretStore(payload: unknown): SecretStoreReading | undefined {
  const rows = readSecretStatus(payload);
  if (rows === undefined || !isBag(payload)) {
    return undefined;
  }
  const datadogSite = str({ bag: payload, key: "datadogSite" });
  if (datadogSite === undefined || !isDatadogSiteWord(datadogSite)) {
    return undefined;
  }
  return { datadogSite, rows };
}
