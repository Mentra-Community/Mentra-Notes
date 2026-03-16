/**
 * PostHog service barrel export
 */

export { default as PostHog } from "./client";
export { useFeatureFlag, FLAGS } from "./features";
export {
  trackOnboardingStarted,
  trackOnboardingStepViewed,
  trackOnboardingCompleted,
  trackOnboardingSkipped,
  trackOnboardingProfileFilled,
  trackOnboardingPrioritiesSelected,
  trackOnboardingContactsAdded,
  trackOnboardingTopicsAdded,
} from "./events";
