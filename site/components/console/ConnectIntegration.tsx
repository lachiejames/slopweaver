"use client";

/*
 * The one affordance every console surface draws where a read needs an integration this install has not connected —
 * in the warning triangle's place, never beside it. It reads (as `../../lib/integrations.ts` says too), in place of an error,
 * "Slack not connected, connect Slack", for every integration and every page at once, because leaving one
 * unconnected is a normal choice. So it is calm rather than amber, says what the connection would let
 * this place read, and connects only when pressed: the press opens the integration's own paste fields (`SecretFields`,
 * the console's one credential write) and, for a consent door, the verb that opens the provider's consent page.
 */

import { Plug } from "lucide-react";
import { type ReactElement, useContext, useState } from "react";

import { type Integration, notConnectedOf } from "../../lib/integrations";
import { cn } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { BUTTON, CHIP } from "./controls";
import { SecretFields } from "./SecretFields";
import { InsideControl } from "./WarningMark";

/**
 * What the line says: the integration is not connected, and what that leaves unread here.
 *
 * @returns the sentence
 */
function sentenceOf({ integration, subjects }: { integration: Integration; subjects: readonly string[] }): string {
  if (subjects.length === 0) {
    return `${integration.label} isn't connected.`;
  }
  const named = subjects.map((subject) => subject.charAt(0).toLowerCase() + subject.slice(1));
  return `${integration.label} isn't connected, so ${named.join(", ")} can't be read here.`;
}

/**
 * The consent verb a grant door connects by, with a copy button, under its paste fields.
 *
 * @param verb the verb that opens the provider's consent page
 * @param label the integration's name
 * @returns the verb and its copy button
 */
export function ConsentVerb({ verb, label }: { verb: string; label: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <p className="m-0 text-[0.78rem] text-muted-foreground">
        Then this opens {label}&apos;s consent page in your browser. Say it in the call, or run it:
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md border border-solid border-border px-2 py-1 font-mono text-[0.78rem]">{verb}</code>
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            const copy = async (): Promise<void> => {
              await navigator.clipboard.writeText(verb);
              setCopied(true);
            };
            void copy();
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  );
}

/**
 * "Slack isn't connected" with a Connect button, in the place a read that needed it would have drawn.
 *
 * @param integration the integration the read needed
 * @param subjects what could not be read without it, in the page's own words
 * @param block draw it in a box of its own, where the data would be
 * @param className spacing the page gives it
 * @returns the affordance
 */
export function ConnectIntegration({
  integration,
  subjects,
  block = false,
  className,
}: {
  integration: Integration;
  subjects: readonly string[];
  block?: boolean;
  className?: string;
}): ReactElement {
  const nested = useContext(InsideControl);
  const [open, setOpen] = useState(false);
  const sentence = sentenceOf({ integration, subjects });
  if (nested) {
    // A Queue row is one whole <button>: no control inside it, so the row names the state and the card connects.
    return (
      <span className={cn(CHIP, className)} title={sentence} role="note" aria-label={sentence}>
        <Plug className="size-[0.8rem]" aria-hidden="true" />
        {integration.label} not connected
      </span>
    );
  }
  if (!block) {
    // Inline it sits beside a heading or a stamp, so the fields open in a popover rather than reflowing the line.
    return (
      <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
        <span className={CHIP} title={sentence}>
          <Plug className="size-[0.8rem]" aria-hidden="true" />
          {integration.label} not connected
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-[0.78rem] text-primary underline-offset-2 hover:underline"
            >
              Connect {integration.label}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[26rem] max-w-[90vw]" align="start">
            <p className="mt-0 mb-2 text-[0.82rem]">{sentence}</p>
            <ConnectPanel integration={integration} />
          </PopoverContent>
        </Popover>
      </span>
    );
  }
  return (
    <section
      aria-label={sentence}
      className={cn("grid justify-items-center gap-2 rounded-[10px] px-3 py-[1rem] text-center", className)}
    >
      <p className="m-0 inline-flex items-center gap-2 text-[0.86rem] text-muted-foreground">
        <Plug className="size-[1rem]" aria-hidden="true" />
        {sentence}
      </p>
      {open ? (
        <div className="w-full text-left">
          <ConnectPanel integration={integration} />
        </div>
      ) : (
        <button
          type="button"
          className={BUTTON}
          onClick={() => {
            setOpen(true);
          }}
        >
          Connect {integration.label}
        </button>
      )}
    </section>
  );
}

/** A failure that names nothing it could not read: one stable reference, so a default never re-renders. */
const NO_SUBJECTS: readonly string[] = [];

/**
 * A failure printed as words rather than a mark — a press refused, a lookup that could not run — drawn as the
 * connect affordance when its reason is a not-connected integration (`notConnectedOf`), else exactly as the surface
 * drew it. For a CURRENT failure only: an outcome whose effect is unknown, or a record of the past, keeps its words.
 *
 * @param why the failure's reason
 * @param fallback what the surface draws for any other reason
 * @param subjects what could not be done without the integration, in the page's own words
 * @param block draw it in a box of its own
 * @returns the affordance, or the fallback
 */
export function IntegrationFailure({
  why,
  fallback,
  subjects = NO_SUBJECTS,
  block = false,
}: {
  why: string;
  fallback: ReactElement;
  subjects?: readonly string[];
  block?: boolean;
}): ReactElement {
  const integration = notConnectedOf({ why });
  if (integration === undefined) {
    return fallback;
  }
  return <ConnectIntegration integration={integration} subjects={subjects} block={block} />;
}

/** What a Connect press opens: the integration's paste fields, then its consent verb when it has one. */
function ConnectPanel({ integration }: { integration: Integration }): ReactElement {
  return (
    <div className="grid w-full gap-2">
      {integration.pasteEither && (
        <p className="m-0 text-[0.78rem] text-muted-foreground">Either one connects it; both is fine too.</p>
      )}
      <SecretFields names={integration.paste} />
      {integration.consentVerb !== undefined && (
        <ConsentVerb verb={integration.consentVerb} label={integration.label} />
      )}
      <p className="m-0 text-[0.74rem] text-muted-foreground">
        Optional: leaving {integration.label} unconnected is fine; everything that doesn&apos;t need it still works.
      </p>
    </div>
  );
}
