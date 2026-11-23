/**
 * Entry point for the outbound-privacy-closure gate. Kept separate from the analyser so the module stays importable
 * by a test without reading the tree (the repo's entry-point convention — no `isDirectInvocation` guard).
 */
import { runGateEntry } from "./gateEntry.js";
import { runOutboundPrivacyClosure } from "./outboundPrivacyClosure.js";

await runGateEntry({ run: runOutboundPrivacyClosure });
