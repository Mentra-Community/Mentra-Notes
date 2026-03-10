/**
 * Auto-Notes Services Index
 *
 * Re-exports all auto-notes pipeline components.
 */

export { AUTO_NOTES_CONFIG } from "./config";
export {
  DOMAIN_PROFILES,
  containsHighSignalKeyword,
  getDomainPromptContext,
  type DomainProfile,
  type DomainContext,
} from "./domain-config";
export { TriageClassifier, type TriageResult } from "./TriageClassifier";
export {
  ConversationTracker,
  type TrackerState,
  type TrackingDecision,
} from "./ConversationTracker";
export { NoteGenerator } from "./NoteGenerator";
