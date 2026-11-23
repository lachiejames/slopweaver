"use client";

/**
 * Settings → Models: the plans Slopweaver runs on, and the way to connect one without a terminal.
 *
 * Setting up a plan never touches a terminal: the modal opens on Integrations with Models beside it, and Models is
 * where a plan is connected, with no setup sequence to pass through. So the section is two provider
 * cards while no plan is connected, the connected rows with their usage limits once one is, and a Connect press that
 * opens the provider's own sign-in page in the browser.
 *
 * The live row follows one attempt from the press to its end: its step while it waits on the owner, Cancel, the page
 * again if it was closed, and the outcome in plain words (`../../lib/planConnect.ts`). It polls only while an attempt is in
 * flight, and re-reads the plan list once when one connects.
 *
 * Claude's Connect is drawn and not yet pressable: its sign-in from here is the next change, and saying so is the
 * honest state — never a command to run instead.
 */
import { type ReactElement, useEffect, useState } from "react";

import { CONNECTION_POLL_MS, connectionActiveOf, connectionLineOf, connectionMarkOf } from "../../lib/planConnect";
import { type PlanConnectionsView, type PlanConnectionView, readPlanConnections } from "../live/readPlanConnections";
import { type PlanLimitsView, readPlanLimits } from "../live/readPlanLimits";
import { readyValueOf, refreshLive, useLive } from "../live/useLive";
import { Button } from "../ui/button";
import { PlanLimits } from "./PlanLimits";
import { Outcome, type PressState, usePress } from "./press";

/** The plan list's reading. */
const PLANS_SLUG = "plans";

/** The attempts' reading, which every press here re-reads. */
const CONNECTIONS_SLUG = "plan-connections";

/** The two acts the tab presses (`../../lib/actVerbs.ts`). */
const CONNECT_CODEX = "plans-connect-codex";
const CONNECT_CANCEL = "plans-connect-cancel";

/** A provider card's frame. */
const CARD = "grid content-start gap-2 rounded-xl border border-solid border-border p-4";

/**
 * The live sign-in row: the step or the outcome, Cancel while it waits, the sign-in page again, and Try again once it
 * failed.
 *
 * @param connection the attempt
 * @param busy whether a Connect or Cancel press is still under way
 * @param connect presses Connect again
 * @param cancel presses Cancel on this attempt
 * @returns the row
 */
function ConnectionRow({
  busy,
  cancel,
  connect,
  connection,
}: {
  busy: boolean;
  cancel: () => void;
  connect: () => void;
  connection: PlanConnectionView;
}): ReactElement {
  const active = connectionActiveOf({ connection });
  let tone = "border-border";
  if (connection.phase === "failed") {
    tone = "border-danger/50";
  } else if (connection.phase === "connected") {
    tone = "border-success/50";
  }
  return (
    <div
      className={`grid gap-2 rounded-xl border border-solid p-4 text-[0.86rem] ${tone}`}
      data-connection-phase={connection.phase}
      aria-live="polite"
    >
      <p className="m-0 font-medium">{connectionLineOf({ connection })}</p>
      {connection.detail !== undefined && (
        <p className="m-0 text-[0.8rem] text-muted-foreground">Codex said: {connection.detail}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {active && connection.signInUrl !== undefined && (
          <a href={connection.signInUrl} target="_blank" rel="noreferrer" className="underline">
            Open the sign-in page again
          </a>
        )}
        {active && (
          <Button size="sm" variant="outline" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
        )}
        {connection.phase === "failed" && (
          <Button size="sm" disabled={busy} onClick={connect}>
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * One provider's card while no plan is connected: what it does, what it takes, and its Connect.
 *
 * @param does what the provider's plan does in Slopweaver
 * @param takes the plan it takes, and where sign-in happens
 * @param connect presses Connect, or `undefined` while this provider's Connect is not built yet
 * @returns the card
 */
function ProviderCard({
  busy,
  connect,
  does,
  host,
  label,
  takes,
}: {
  busy: boolean;
  connect: (() => void) | undefined;
  does: string;
  host: "claude" | "codex";
  label: string;
  takes: string;
}): ReactElement {
  return (
    <div className={CARD} data-host-card={host}>
      <p className="m-0 text-[0.92rem] font-semibold">{label}</p>
      <p className="m-0 text-[0.85rem]">{does}</p>
      <p className="m-0 text-[0.8rem] text-muted-foreground">{takes}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={busy || connect === undefined} onClick={connect}>
          Connect a {label} plan
        </Button>
        {connect === undefined && (
          <span className="text-[0.8rem] text-muted-foreground">Signing in from here comes next.</span>
        )}
      </div>
    </div>
  );
}

/**
 * Settings → Models.
 *
 * @returns the section
 */
export function ModelsSettings(): ReactElement {
  const plans = useLive<PlanLimitsView>({ read: readPlanLimits, slug: PLANS_SLUG });
  const [polling, setPolling] = useState(false);
  const connections = useLive<PlanConnectionsView>({
    read: readPlanConnections,
    slug: CONNECTIONS_SLUG,
    ...(polling ? { everyMs: CONNECTION_POLL_MS } : {}),
  });
  const attempt = readyValueOf({ state: connections })?.codex;
  const active = connectionActiveOf({ connection: attempt });
  // The interval follows the reading it polls: it starts once an attempt is in flight and stops once it ended.
  if (active !== polling) {
    setPolling(active);
  }
  // An attempt seen in flight on this tab stays drawn after it ends, so its outcome is reported; one that ended before
  // the tab opened is history and is not.
  const [watched, setWatched] = useState<string | undefined>(undefined);
  if (active && attempt !== undefined && watched !== attempt.id) {
    setWatched(attempt.id);
  }
  // Keyed on the attempt and its phase, so each attempt that connects re-reads the list once.
  const connectedMark = attempt?.phase === "connected" ? connectionMarkOf({ connection: attempt }) : "";
  useEffect(() => {
    if (connectedMark !== "") {
      refreshLive({ slug: PLANS_SLUG });
    }
  }, [connectedMark]);
  const { press, state } = usePress();
  // A Connect pressed here draws its attempt whatever it came to, including one that failed before a poll saw it run.
  const [pressedHere, setPressedHere] = useState(false);
  const busy = state.phase === "sending";
  const connect = (): void => {
    setPressedHere(true);
    void press({ readsSlug: CONNECTIONS_SLUG, slots: {}, slug: CONNECT_CODEX });
  };
  const shown = attempt !== undefined && (active || pressedHere || attempt.id === watched) ? attempt : undefined;
  const cancel = (): void => {
    if (shown !== undefined) {
      void press({ readsSlug: CONNECTIONS_SLUG, slots: { id: shown.id }, slug: CONNECT_CANCEL });
    }
  };
  const held = busy || active;
  let body: ReactElement;
  if (plans.phase === "ready" && plans.value.plans.length === 0) {
    body = (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-3" data-plans-empty="true">
        <ProviderCard
          busy={held}
          connect={undefined}
          does="Runs the sessions that do the work."
          host="claude"
          label="Claude"
          takes="A Claude Pro or Max plan. Sign-in opens in your browser."
        />
        <ProviderCard
          busy={held}
          connect={connect}
          does="Plans and reviews the work, and runs the Messenger and voice calls."
          host="codex"
          label="Codex"
          takes="A ChatGPT plan with Codex. Sign-in opens in your browser."
        />
      </div>
    );
  } else {
    body = (
      <>
        <PlanLimits />
        {plans.phase === "ready" && (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled>
              + Claude plan
            </Button>
            <Button size="sm" variant="outline" disabled={held} onClick={connect}>
              + Codex plan
            </Button>
            <span className="text-[0.8rem] text-muted-foreground">Adding a Claude plan from here comes next.</span>
          </div>
        )}
      </>
    );
  }
  return (
    <section aria-label="models" className="grid gap-4">
      <div className="grid gap-1 pr-10">
        <h2 className="m-0 text-[1rem] font-[650]">Models</h2>
        <p className="m-0 text-[0.85rem] text-muted-foreground">
          Slopweaver runs on your own AI plans. It never buys one or bills you. Connect at least one and you can start
          working; add more any time.
        </p>
      </div>
      {shown !== undefined && <ConnectionRow busy={busy} cancel={cancel} connect={connect} connection={shown} />}
      {body}
      <PressOutcome state={state} />
    </section>
  );
}

/**
 * A press's outcome, drawn only when it did not land: a done press is answered by the live row moving, so a second
 * "Done." under it would say the same thing twice.
 *
 * @returns the outcome line, or nothing
 */
function PressOutcome({ state }: { state: PressState }): ReactElement | null {
  if (state.phase === "refused" || state.phase === "unknown") {
    return <Outcome state={state} />;
  }
  return null;
}
