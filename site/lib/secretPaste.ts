/**
 * A secret pasted into the console, checked before anything is launched — and the one rule every line here keeps:
 * **the value is never written into any string this module returns except the one handed to the child's stdin.**
 *
 * Onboarding has the owner paste secrets into the UI instead of working out which commands to run. The secret field
 * shows a receipt naming the key, never the value.
 *
 * So the route (`app/api/secret/route.ts`) does no writing of its own. It runs the same `slopweaver secrets set
 * <name> --stdin --json` a terminal would, with the value on the child's stdin rather than its argv — an argv is
 * readable by every process on the machine through `ps` for as long as the child lives — and the verb's own allowlist
 * (`src/secrets/names.ts`, settable rows only) decides whether the name may be written. The shape check here is a
 * defence that keeps a path or a flag out of the argv; it is not the allowlist, which `site/` cannot import.
 *
 * Pure: no I/O.
 */
import { isBag } from "./bag";

/** A store file name's shape — lowercase parts joined by `-`, `.` or `_`, which every registry row is. */
const NAME_SHAPE = /^[a-z0-9]+(?:[-._][a-z0-9]+)*$/u;

/** The longest name the shape check passes; the longest registry row is well under it. */
const NAME_MAX = 80;

/**
 * The longest value the field carries, in characters.
 *
 * A token is one line: the longest a registry row holds today is a Google OAuth client secret or a service-role JWT,
 * both well under this. A whole JSON key file is not a `line` row and `secrets set` refuses it as multi-line anyway.
 */
export const SECRET_VALUE_MAX = 8 * 1024;

/** A paste that may be launched, or the sentence that refuses it — which never holds the value. */
export type SecretPasteRequest =
  | { readonly kind: "ok"; readonly name: string; readonly value: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * Check a parsed body as a paste: exactly `name` and `value`, a name of a store file's shape, a non-empty value
 * under the cap.
 *
 * Every refusal names a field and a rule, and none of them interpolates the value — a refusal is shown on the page and
 * may be logged by whoever reads the response, so a value in one would be the leak this module exists to prevent.
 *
 * @param body the JSON the press carried, already parsed
 * @returns the name and value to launch with, or why not
 */
export function secretPasteRequest({ body }: { body: unknown }): SecretPasteRequest {
  if (!isBag(body)) {
    return { kind: "refused", why: "the body is not an object carrying a name and a value" };
  }
  const bag = body;
  const extra = Object.keys(bag).filter((key) => key !== "name" && key !== "value");
  if (extra.length > 0) {
    return { kind: "refused", why: `the body carries ${extra.join(", ")}; a paste carries only a name and a value` };
  }
  const name = bag["name"];
  if (typeof name !== "string" || name.length > NAME_MAX || !NAME_SHAPE.test(name)) {
    return { kind: "refused", why: "the name is not a secret's name: lowercase words joined by -, . or _" };
  }
  const value = bag["value"];
  if (typeof value !== "string") {
    return { kind: "refused", why: `no value was pasted for ${name}` };
  }
  if (value.trim().length === 0) {
    return { kind: "refused", why: `the value pasted for ${name} is blank` };
  }
  if (value.length > SECRET_VALUE_MAX) {
    return {
      kind: "refused",
      why: `the value pasted for ${name} is ${String(value.length)} characters; a secret here is one line of at most ${String(SECRET_VALUE_MAX)}`,
    };
  }
  return { kind: "ok", name, value };
}

/**
 * The argv the paste runs — the name and nothing else of the request, because the value goes on stdin.
 *
 * @param name a name {@link secretPasteRequest} passed
 * @returns the verb's arguments after `slopweaver`
 */
export function secretSetArgv({ name }: { name: string }): readonly string[] {
  return ["secrets", "set", name, "--stdin", "--json"];
}

/**
 * What the child's stdin carries: the value, with the one trailing newline a pipe would add — which
 * `normaliseSecretInput` strips, so a value pasted with or without one lands byte-for-byte the same.
 *
 * @param value a value {@link secretPasteRequest} passed
 * @returns the stdin payload
 */
export function secretStdin({ value }: { value: string }): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

/** What a paste field says under itself: the receipt, in one of three states, none of which can hold the value. */
export type SecretFieldReceipt =
  | { readonly kind: "set"; readonly name: string; readonly atIso: string }
  | { readonly kind: "stored"; readonly name: string; readonly modifiedIso: string | undefined }
  | { readonly kind: "unset"; readonly name: string }
  | { readonly kind: "unread"; readonly name: string };

/**
 * The receipt a field draws: this page's own press first, then what the store says, then that it is not set.
 *
 * A press answers once; the store reading is what still says "set" after a reload or on another page. So a press
 * outranks a reading taken before it, and a stored file outranks nothing. A store that could not be read is said as
 * such — never drawn as "not set", which would send the owner to paste a value that is already there.
 *
 * @param name the secret the field writes
 * @param pressedIso when this page's own paste was stored, if it was
 * @param status the store's rows, or `undefined` while they have not been read
 * @returns the receipt
 */
export function secretFieldReceipt({
  name,
  pressedIso,
  status,
}: {
  name: string;
  pressedIso: string | undefined;
  status:
    | readonly { readonly name: string; readonly stored: boolean; readonly modifiedIso: string | undefined }[]
    | undefined;
}): SecretFieldReceipt {
  if (pressedIso !== undefined) {
    return { atIso: pressedIso, kind: "set", name };
  }
  if (status === undefined) {
    return { kind: "unread", name };
  }
  const row = status.find((one) => one.name === name);
  if (row === undefined || !row.stored) {
    return { kind: "unset", name };
  }
  return { kind: "stored", modifiedIso: row.modifiedIso, name };
}

/** The receipt a set paste answers with — the name and where it landed, never the value. */
export interface SecretReceipt {
  readonly name: string;
  readonly path: string;
}

/**
 * Read `secrets set --json`'s one line into the receipt, or `undefined` when it printed something else.
 *
 * A verb that exited 0 without the line has still written — the route reports that as set with no path rather than
 * as a failure — so `undefined` here means "the receipt is unreadable", never "the write failed".
 *
 * @param out the verb's stdout
 * @param name the name the paste asked for, which the receipt must match
 * @returns the receipt, or `undefined`
 */
export function secretReceipt({ out, name }: { out: string; name: string }): SecretReceipt | undefined {
  const line = out
    .split("\n")
    .map((each) => each.trim())
    .find((each) => each.startsWith("{"));
  if (line === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isBag(parsed)) {
    return undefined;
  }
  const bag = parsed;
  if (bag["ok"] !== true || bag["name"] !== name || typeof bag["path"] !== "string") {
    return undefined;
  }
  return { name, path: bag["path"] };
}
