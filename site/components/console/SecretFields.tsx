"use client";

/**
 * The secure paste field — one per secret a hand step has the owner store, so the value goes from the provider's page
 * into the console and never through a terminal.
 *
 * Onboarding has the owner paste secrets into the UI rather than work out which commands to run. This field and the
 * one conversation field are the console's two inputs, and this one shows a receipt naming the key, never the value.
 *
 * What keeps the value in one place: it lives in this component's state only until the press returns, cleared whether
 * the press stored it or not; it is posted to `/api/secret`, which hands it to `slopweaver secrets set --stdin` and
 * answers with the name alone; and no rendered text, title or label carries it. A password manager may still offer to
 * save what was typed — the `data-*-ignore` attributes ask the common ones not to, and that is all a page can do.
 */
import { type FormEvent, type ReactElement, useState } from "react";

import { ageOf } from "../../lib/ageOf";
import { type SecretFieldReceipt, secretFieldReceipt } from "../../lib/secretPaste";
import { readSecretStatus, type SecretStatusRow } from "../live/readSecrets";
import { type LiveState, readyValueOf, refreshLive, useLive } from "../live/useLive";
import { BUTTON_PRIMARY } from "./controls";
import { PlainWhy } from "./RawFold";
import { ReadingIndicator } from "./ReadingIndicator";
import { WarningMark } from "./WarningMark";

/** The one field: a password input sized to sit beside its Save button. */
const SECRET_FIELD =
  "sw-glass-control min-w-0 flex-[1_1_18rem] rounded-lg border border-solid px-[0.6rem] py-[0.45rem] text-[0.84rem] text-foreground";

/** The live slug the receipt reads (`site/lib/liveVerbs.ts`). */
const STATUS_SLUG = "secrets";

/** What one paste came to, as the field shows it — no arm holds the value. */
type PastePhase =
  | { readonly phase: "idle" }
  | { readonly phase: "sending" }
  | { readonly phase: "set"; readonly atIso: string }
  | { readonly phase: "refused"; readonly why: string }
  | { readonly phase: "unknown"; readonly why: string };

/**
 * One POST to the secret route, read into what the field shows. Never throws: a failed fetch is `unknown`, because
 * the file may have been written.
 *
 * @returns what the paste came to
 */
async function pasteOnce({ name, value }: { name: string; value: string }): Promise<PastePhase> {
  try {
    const response = await fetch("/api/secret", {
      body: JSON.stringify({ name, value }),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body: unknown = await response.json();
    const held = (typeof body === "object" && body !== null ? body : {}) as Partial<{
      outcome: string;
      atIso: string;
      why: string;
    }>;
    if (held.outcome === "set" && typeof held.atIso === "string") {
      return { atIso: held.atIso, phase: "set" };
    }
    if (held.outcome === "unknown") {
      return { phase: "unknown", why: typeof held.why === "string" ? held.why : "no answer" };
    }
    return { phase: "refused", why: typeof held.why === "string" ? held.why : "refused without a reason" };
  } catch (cause) {
    return { phase: "unknown", why: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * The mark beside a status reading the receipt was taken from: a spinner while a re-read is on its way, the warning
 * glyph when the latest read failed over it. `../live/LiveMarks.tsx`'s `ReadMark` draws the same, through
 * `StaleMark` — which draws this field inside its connect affordance, so this one draws the glyph directly.
 *
 * @returns the mark, or nothing for a current reading
 */
function StatusMark({
  state,
  subject,
}: {
  state: Extract<LiveState<readonly SecretStatusRow[]>, { phase: "ready" }>;
  subject: string;
}): ReactElement | null {
  if (state.stale !== undefined) {
    return <WarningMark facts={[{ observedAtIso: state.observedAtIso, subject, why: state.stale.why }]} />;
  }
  if (state.refreshing === true) {
    return <ReadingIndicator label={`Re-reading ${subject}`} />;
  }
  return null;
}

/**
 * The line under a field: the receipt, by name, and never the value. With the store's status not in hand, the
 * status read's spinner or staleness mark stands in its place; over a kept status, its mark sits beside the words.
 *
 * @param statusState the store's status read, which the receipt is taken from
 * @returns the line
 */
function ReceiptLine({
  receipt,
  statusState,
}: {
  receipt: SecretFieldReceipt;
  statusState: LiveState<readonly SecretStatusRow[]>;
}): ReactElement {
  const subject = `whether ${receipt.name} is already stored`;
  if (receipt.kind === "unread") {
    // The receipt is unread exactly while the status read has no reading, so a ready one here has nothing to mark.
    if (statusState.phase === "ready") {
      return <StatusMark state={statusState} subject={subject} />;
    }
    if (statusState.phase === "loading") {
      return <ReadingIndicator label={`Reading ${subject}`} />;
    }
    return <WarningMark facts={[{ subject, why: statusState.why }]} />;
  }
  let text: string;
  let tone = "text-muted-foreground";
  if (receipt.kind === "set") {
    text = `set ${receipt.name} · ${ageOf({ iso: receipt.atIso })} · 0600 in your secrets store`;
    tone = "text-success";
  } else if (receipt.kind === "stored") {
    const when = receipt.modifiedIso === undefined ? "" : ` · written ${ageOf({ iso: receipt.modifiedIso })}`;
    text = `${receipt.name} is stored${when}; paste again only to replace it`;
  } else {
    text = `${receipt.name} is not set yet`;
  }
  return (
    <p className={`m-0 text-[0.78rem] ${tone}`}>
      {text} {statusState.phase === "ready" && <StatusMark state={statusState} subject={subject} />}
    </p>
  );
}

/**
 * One secure paste field: a password input, a Set button, and the receipt.
 *
 * @returns the field
 */
function SecretField({
  name,
  hint,
  statusState,
}: {
  name: string;
  hint: string | undefined;
  statusState: LiveState<readonly SecretStatusRow[]>;
}): ReactElement {
  const status = readyValueOf({ state: statusState });
  const [value, setValue] = useState("");
  const [paste, setPaste] = useState<PastePhase>({ phase: "idle" });
  const sending = paste.phase === "sending";
  let pressedIso: string | undefined;
  if (paste.phase === "set") {
    pressedIso = paste.atIso;
  }
  const receipt = secretFieldReceipt({ name, pressedIso, status });
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (value.trim().length === 0 || sending) {
      return;
    }
    const pasted = value;
    setPaste({ phase: "sending" });
    const settle = async (): Promise<void> => {
      const outcome = await pasteOnce({ name, value: pasted });
      // Cleared on every outcome: a refused value is still a secret, and the field must not keep holding it.
      setValue("");
      setPaste(outcome);
      refreshLive({ slug: STATUS_SLUG });
    };
    void settle();
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-1" autoComplete="off">
      <label className="text-[0.8rem] font-medium" htmlFor={`secret-paste-${name}`}>
        {name}
        {hint !== undefined && <span className="font-normal text-muted-foreground">: {hint}</span>}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`secret-paste-${name}`}
          type="password"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          className={SECRET_FIELD}
          placeholder="paste it here; it is stored, never shown"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          data-form-type="other"
          disabled={sending}
        />
        <button type="submit" className={BUTTON_PRIMARY} disabled={sending || value.trim().length === 0}>
          {sending ? "Storing…" : "Set"}
        </button>
      </div>
      <ReceiptLine receipt={receipt} statusState={statusState} />
      {paste.phase === "refused" && (
        <div className="m-0 text-[0.78rem] text-danger">
          Not stored: <PlainWhy why={paste.why} />
        </div>
      )}
      {paste.phase === "unknown" && (
        <div className="m-0 text-[0.78rem] text-warning">
          No answer, so it may or may not be stored: <PlainWhy why={paste.why} />
        </div>
      )}
    </form>
  );
}

/**
 * Every secret a hand step has the owner store, one secure field each, over one read of the store's status.
 *
 * No state of the step locks them: the route's `secrets set` allowlist gates the name, and a step settled or taken
 * off the owner's Queue while they are typing still wants the rest of its keys, so the text boxes stay usable.
 *
 * @param names the step's settable secret names (`hand list --json`'s `secrets`)
 * @returns the fields, or nothing when the step stores no secret
 */
export function SecretFields({ names }: { names: readonly string[] }): ReactElement | null {
  const status = useLive<readonly SecretStatusRow[]>({ read: readSecretStatus, slug: STATUS_SLUG });
  const rows = readyValueOf({ state: status });
  if (names.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="paste the secrets this step needs"
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      {names.map((name) => (
        <SecretField key={name} name={name} hint={rows?.find((row) => row.name === name)?.what} statusState={status} />
      ))}
    </section>
  );
}
