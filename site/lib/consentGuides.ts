/**
 * The guides for the integrations that connect by browser consent rather than a pasted key: the three Google doors
 * and the two Microsoft ones. Each product consents on its own, while the doors of one provider share one app
 * registration made once. Pure data, spread into `INTEGRATION_GUIDES` (`./integrationGuides.ts`) in the registry's
 * order.
 */
import type { GuideStep, IntegrationGuide } from "./guideShape";

/** The Google client the three Google doors share, made once. */
const GOOGLE_CLIENT: GuideStep = {
  detail:
    "In Google Cloud: pick or create a project, then Credentials → Create credentials → OAuth client ID → Desktop app. It must be a Desktop app: a Web application client fails consent with redirect_uri_mismatch. The secret is shown once, so save it before closing that dialog. Gmail, Drive and Calendar share this one client: paste it once.",
  link: { href: "https://console.cloud.google.com/apis/credentials", label: "Open Google Cloud credentials" },
  paste: ["google-client-id", "google-client-secret"],
  title: "Make a Google OAuth client, once",
};

/** The Microsoft app registration Outlook mail and Outlook Calendar share, made once; each still consents on its own. */
const OUTLOOK_CLIENT: GuideStep = {
  detail:
    "entra.microsoft.com → App registrations → New registration; personal accounts (or work and personal); redirect Public client/native, http://localhost; no client secret. Reusing one? It needs the Mobile and desktop applications platform with that redirect. The Application (client) ID is not a secret. Outlook mail and Outlook Calendar share this one registration: paste it once.",
  link: { href: "https://entra.microsoft.com", label: "Open Microsoft Entra" },
  paste: ["outlook-client-id"],
  title: "Register the app, once",
};

/** The browser-consent guides, in the registry's order. */
export const CONSENT_GUIDES: readonly IntegrationGuide[] = [
  {
    disconnect: "Delete the grant here, or remove the app from your Google account's third-party access.",
    id: "gmail",
    overview: "Your mail and the meeting notes it links, read into the corpus; drafts and sends only on your approval.",
    pitch: "Mail and meeting notes",
    reach: "The grant you pick: read (the default), manage (labels, archive, read state) or full (drafts and sending).",
    steps: [
      GOOGLE_CLIENT,
      {
        detail: "On the same project, enable the Gmail API and the Google Docs API.",
        title: "Enable the APIs",
      },
      {
        detail:
          "Opens Google's consent in your browser and keeps the one redirect. It also asks to read Google Docs so it can follow meeting notes; saying no is fine.",
        title: "Approve the consent",
        verb: "slopweaver gmail connect",
      },
    ],
    storedAs: "The grant, an owner-only file on this machine. The client is two more.",
    usedBy: "Gmail reads, mail cards and the Gmail corpus.",
  },
  {
    disconnect: "Delete the grant here, or remove the app from your Google account's third-party access.",
    id: "drive",
    overview: "Docs and files, by name and details unless you grant their contents.",
    pitch: "Docs and files",
    reach:
      "Metadata (the default: names and details, not contents), read (contents too) or write. No verb writes today.",
    steps: [
      GOOGLE_CLIENT,
      { detail: "On the same project, enable the Google Drive API.", title: "Enable the API" },
      {
        detail: "Opens Google's consent in your browser.",
        title: "Approve the consent",
        verb: "slopweaver drive connect",
      },
    ],
    storedAs: "The grant, an owner-only file on this machine.",
    usedBy: "Drive reads.",
  },
  {
    disconnect: "Delete the grant here, or remove the app from your Google account's third-party access.",
    id: "calendar",
    overview: "Meetings to prep for and your free time.",
    pitch: "Meetings to prep for",
    reach: "Read (the default, which also answers free time), events, or meetings on calendars you own.",
    steps: [
      GOOGLE_CLIENT,
      {
        detail:
          "On the same project, enable the Google Calendar API. Skip it and the first read fails with a 403 naming the API.",
        title: "Enable the API",
      },
      {
        detail: "Opens Google's consent in your browser.",
        title: "Approve the consent",
        verb: "slopweaver calendar connect",
      },
    ],
    storedAs: "The grant, an owner-only file on this machine.",
    usedBy: "Meeting prep and calendar reads.",
  },
  {
    disconnect: "Delete the grant here, or remove the app under your Microsoft account's permissions.",
    id: "outlook",
    overview: "Your Outlook mail, read and organised the way Gmail is.",
    pitch: "Mail",
    reach: "Read, manage or full, with manage the default.",
    steps: [
      OUTLOOK_CLIENT,
      {
        detail: "Opens Microsoft's consent in your browser for mail permissions only, and keeps the one redirect.",
        title: "Approve the consent",
        verb: "slopweaver outlook connect",
      },
    ],
    storedAs: "The grant, an owner-only file on this machine.",
    usedBy: "Outlook reads.",
  },
  {
    disconnect: "Delete the grant here, or remove the app under your Microsoft account's permissions.",
    id: "outlook-calendar",
    overview: "Your Outlook calendar, read the way Google Calendar is.",
    pitch: "Meetings on Outlook",
    reach: "Read only: your calendars, what is on in a window, and one event in full.",
    steps: [
      OUTLOOK_CLIENT,
      {
        detail:
          "Opens Microsoft's consent in your browser for calendar read only, nothing of the mailbox. A mail grant connected before the split that already carries a calendar permission keeps reading the calendar until this one is stored, but this row reads only its own grant.",
        title: "Approve the consent",
        verb: "slopweaver outlook-calendar connect",
      },
    ],
    storedAs: "The grant, an owner-only file on this machine, separate from the mail grant.",
    usedBy: "Outlook calendar reads and the diary refresh.",
  },
];
