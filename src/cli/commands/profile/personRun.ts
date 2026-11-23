/**
 * `slopweaver profile person` — read or curate one person's judgement column on the identity register.
 *
 * A thin effectful shell over {@link ../../../store/profile/client}; the parsers and rendered lines are
 * {@link ./core}, and the shared refusal, store-open, emit and file-read helpers are {@link ./verbShell}.
 */
import { logger } from "../../../lib/logger.js";
import { isRecord } from "../../../lib/parsers.js";
import type { StoreClient } from "../../../store/client.js";
import { resolvePeople } from "../../../store/person.js";
import { readPersonJudgement, writePersonJudgement } from "../../../store/profile/client.js";
import { parsePersonJudgement } from "../../../store/profile/core.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

import { parseProfilePersonArgs, personLines, profileTail } from "./core.js";
import { emit, openOrRefuse, readJsonFile, refuse } from "./verbShell.js";

const PERSON_USAGE =
  "usage: slopweaver profile person (--id <uuid> | --name <display name>) [--file <judgement.json>] [--json]";

/**
 * Read or curate one person's judgement column on the identity register.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runProfilePerson(argv: readonly string[]): Promise<number> {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PERSON_USAGE });
    return EXIT_OK;
  }
  const args = parseProfilePersonArgs({ rest });
  if (args.isErr()) {
    return refuse({ lines: args.error, usage: PERSON_USAGE });
  }
  const opened = openOrRefuse();
  if ("code" in opened) {
    return opened.code;
  }
  try {
    const subject = await resolveSubject({ client: opened.client, id: args.value.id, name: args.value.name });
    if ("errors" in subject) {
      return refuse({ lines: subject.errors, usage: PERSON_USAGE });
    }
    const payloadFile = args.value.file;
    if (payloadFile === undefined) {
      return await reportPerson({ client: opened.client, json: args.value.json, subject });
    }
    return await curatePerson({ client: opened.client, file: payloadFile, json: args.value.json, subject });
  } finally {
    await opened.client.close();
  }
}

/** Who a `--id`/`--name` invocation actually names. */
interface PersonSubject {
  readonly id: string;
  readonly displayName: string;
}

/** Resolve `--id` or `--name` to exactly one person, refusing an ambiguous name rather than picking. */
async function resolveSubject({
  client,
  id,
  name,
}: {
  client: StoreClient;
  id: string | undefined;
  name: string | undefined;
}): Promise<PersonSubject | { errors: readonly string[] }> {
  if (id !== undefined) {
    return { displayName: id, id };
  }
  if (name === undefined) {
    return { errors: ["name the person with --id or --name"] };
  }
  const matched = await resolvePeople({ client, name });
  if (matched.isErr()) {
    return { errors: [matched.error.message] };
  }
  const people = matched.value;
  if (people.length > 1) {
    return {
      errors: [
        `"${name}" reaches ${String(people.length)} people — pass --id to say which:`,
        ...people.map((match) => `  ${match.person.id}  ${match.person.displayName}`),
      ],
    };
  }
  const only = people[0];
  if (only === undefined) {
    return { errors: [`"${name}" reaches nobody`] };
  }
  return { displayName: only.person.displayName, id: only.person.id };
}

/** Print one person's judgement, or say plainly that nothing is curated. */
async function reportPerson({
  client,
  json,
  subject,
}: {
  client: StoreClient;
  json: boolean;
  subject: PersonSubject;
}): Promise<number> {
  const judgement = await readPersonJudgement({ client, personId: subject.id });
  if (judgement.isErr()) {
    if (judgement.error.code === "PROFILE_ABSENT") {
      emit({
        json,
        lines: personLines({ displayName: subject.displayName, judgement: null }),
        payload: { judgement: null, person: subject },
      });
      return EXIT_OK;
    }
    logger.error({ msg: judgement.error.message });
    return EXIT_ERROR;
  }
  emit({
    json,
    lines: personLines({ displayName: subject.displayName, judgement: judgement.value }),
    payload: { judgement: judgement.value, person: subject },
  });
  return EXIT_OK;
}

/** Write one person's judgement from a file, bumping the revision the store currently holds. */
async function curatePerson({
  client,
  file,
  json,
  subject,
}: {
  client: StoreClient;
  file: string;
  json: boolean;
  subject: PersonSubject;
}): Promise<number> {
  const read = readJsonFile({ path: file });
  if ("errors" in read) {
    return refuse({ lines: read.errors, usage: PERSON_USAGE });
  }
  if (!isRecord(read.value)) {
    return refuse({ lines: [`${file} must hold a JSON object`], usage: PERSON_USAGE });
  }
  const current = await readPersonJudgement({ client, personId: subject.id });
  const expectedRevision = current.isOk() ? current.value.revision : 0;
  // The revision is taken from the STORE, never from the file: a stale export that named its own number
  // could otherwise overwrite a newer row by claiming it, which is what the pin exists to stop.
  const candidate = parsePersonJudgement({ value: { ...read.value, revision: expectedRevision + 1 } });
  if (candidate.isErr()) {
    return refuse({ lines: [candidate.error.message], usage: PERSON_USAGE });
  }
  const written = await writePersonJudgement({
    client,
    expectedRevision,
    judgement: candidate.value,
    personId: subject.id,
  });
  if (written.isErr()) {
    logger.error({ msg: written.error.message });
    return EXIT_ERROR;
  }
  emit({
    json,
    lines: [`profile person: ${subject.displayName} now at judgement revision ${String(written.value)}`],
    payload: { person: subject, revision: written.value },
  });
  return EXIT_OK;
}
