import PostHog from 'posthog-js'
import { useState, useEffect } from 'react'

PostHog.init('dont-worry-shhh', {
  api_host: 'https://us.posthog.com'
})

/**
 * React hook that returns whether a feature flag is enabled.
 * Re-renders when PostHog feature flags are loaded.
 */
export function useFeatureFlag(flag: string): boolean {
  const [enabled, setEnabled] = useState(() => PostHog.isFeatureEnabled(flag) ?? false)

  useEffect(() => {
    // Called when feature flags are loaded/updated
    return PostHog.onFeatureFlags(() => {
      setEnabled(PostHog.isFeatureEnabled(flag) ?? false)
    })
  }, [flag])

  return enabled
}

export default PostHog