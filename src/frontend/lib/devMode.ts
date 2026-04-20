/**
 * Development Mode Utilities
 *
 * Helpers for testing frontend without backend.
 * Allows fallback to mock data when API calls fail.
 *
 * Enable mock data mode:
 *   localStorage.setItem('sega:forceMockData', 'true')
 *   localStorage.removeItem('sega:forceMockData') // to disable
 */

/**
 * Check if we're in development mode
 *
 * Bun replaces `process.env.NODE_ENV` at bundle time for HTML routes.
 */
export const isDevelopmentMode = process.env.NODE_ENV !== "production";

/**
 * Get current mock data mode setting
 * Toggle with: localStorage.setItem('sega:forceMockData', 'true/false')
 */
export const getForceMockDataMode = (): boolean => {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("sega:forceMockData") === "true";
};

/**
 * Toggle mock data mode
 */
export const toggleForceMockDataMode = (): boolean => {
  if (typeof window === "undefined") return false;
  const current = getForceMockDataMode();
  const newValue = !current;
  if (newValue) {
    localStorage.setItem("sega:forceMockData", "true");
  } else {
    localStorage.removeItem("sega:forceMockData");
  }
  console.log(`[DEV] Mock data mode: ${newValue}`);
  window.dispatchEvent(
    new CustomEvent("mockModeChanged", { detail: { enabled: newValue } }),
  );
  return newValue;
};

/**
 * Safely call API with mock data fallback
 *
 * @param apiFn - Function that calls the API
 * @param mockData - Data to use as fallback if API fails or mock mode is enabled
 * @param errorMessage - Message to log if API fails
 * @returns Object with data and isMock flag
 */
export async function fetchWithFallback<T>(
  apiFn: () => Promise<T>,
  mockData: T,
  errorMessage: string = "Failed to fetch data",
): Promise<{ data: T; isMock: boolean }> {
  // If mock mode is forced, use mock data immediately
  if (getForceMockDataMode()) {
    console.log(`[DEV] Using forced mock data: ${errorMessage}`);
    return { data: mockData, isMock: true };
  }

  try {
    console.log(`[API] Fetching: ${errorMessage.replace("Failed to ", "")}`);
    const data = await apiFn();
    console.log(`[API] ✅ Success:`, data);
    return { data, isMock: false };
  } catch (error) {
    // Log detailed error information for debugging
    const err = error as Error & { status?: number; statusText?: string };
    console.group(`[API] ❌ ${errorMessage}`);
    console.error("Error:", err.message || err);
    if (err.status) {
      console.error(`Status: ${err.status} ${err.statusText || ""}`);
    }
    if (error instanceof Response) {
      console.error(`Response status: ${error.status} ${error.statusText}`);
    }
    console.log("Falling back to mock data");
    console.groupEnd();
    return { data: mockData, isMock: true };
  }
}

/**
 * Retry API call with exponential backoff
 *
 * @param apiFn - Function that calls the API
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param baseDelay - Initial delay in ms (default: 1000)
 */
export async function retryWithBackoff<T>(
  apiFn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await apiFn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(
          `[RETRY] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
          error,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("All retries failed");
}

/**
 * Track API call performance
 */
let callStats = new Map<string, { count: number; totalMs: number }>();

export async function trackApiCall<T>(
  name: string,
  apiFn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await apiFn();
    const duration = performance.now() - start;

    // Update stats
    const current = callStats.get(name) || { count: 0, totalMs: 0 };
    callStats.set(name, {
      count: current.count + 1,
      totalMs: current.totalMs + duration,
    });

    if (isDevelopmentMode) {
      console.log(`[API] ${name}: ${duration.toFixed(2)}ms`);
    }

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.error(`[API] ${name}: ${duration.toFixed(2)}ms (error)`, error);
    throw error;
  }
}

/**
 * Get API performance stats
 */
export function getApiStats() {
  const stats: Record<
    string,
    { count: number; avgMs: number; totalMs: number }
  > = {};

  for (const [name, { count, totalMs }] of callStats.entries()) {
    stats[name] = {
      count,
      totalMs,
      avgMs: totalMs / count,
    };
  }

  return stats;
}

/**
 * Reset API stats
 */
export function resetApiStats() {
  callStats = new Map();
}

/**
 * Get current dev mode status
 */
export function getDevModeStatus() {
  return {
    isDevelopmentMode,
    mockDataMode: getForceMockDataMode(),
    apiStats: getApiStats(),
  };
}

/**
 * Setup dev mode keyboard shortcuts
 * Cmd+Shift+D: Toggle mock data mode
 * Cmd+Shift+S: Show dev stats
 */
export function setupDevModeShortcuts() {
  if (!isDevelopmentMode) return;

  document.addEventListener("keydown", (e) => {
    // Cmd+Shift+D: Toggle mock data mode
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyD") {
      e.preventDefault();
      const enabled = toggleForceMockDataMode();
      console.log(`Mock data mode: ${enabled ? "ON" : "OFF"}`);
    }

    // Cmd+Shift+S: Show dev stats
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyS") {
      e.preventDefault();
      console.table(getDevModeStatus());
    }
  });
}
