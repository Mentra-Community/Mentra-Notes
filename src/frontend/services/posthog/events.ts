/**
 * PostHog event tracking
 *
 * Centralized event tracking functions for analytics.
 */

import PostHog from "./client";

// -- Onboarding Events --

export function trackOnboardingStarted() {
  PostHog.capture("onboarding_started");
}

export function trackOnboardingStepViewed(step: number, stepName: string) {
  PostHog.capture("onboarding_step_viewed", { step, step_name: stepName });
}

export function trackOnboardingCompleted() {
  PostHog.capture("onboarding_completed");
}

export function trackOnboardingSkipped(atStep: number) {
  PostHog.capture("onboarding_skipped", { skipped_at_step: atStep });
}

export function trackOnboardingProfileFilled(fields: {
  hasName: boolean;
  hasRole: boolean;
  hasCompany: boolean;
  linkedLinkedIn: boolean;
}) {
  PostHog.capture("onboarding_profile_filled", fields);
}

export function trackOnboardingPrioritiesSelected(priorities: string[]) {
  PostHog.capture("onboarding_priorities_selected", {
    priorities,
    count: priorities.length,
  });
}

export function trackOnboardingContactsAdded(count: number) {
  PostHog.capture("onboarding_contacts_added", { count });
}

export function trackOnboardingTopicsAdded(topics: string[]) {
  PostHog.capture("onboarding_topics_added", {
    topics,
    count: topics.length,
  });
}
