/**
 * Notes App - All-day transcription and AI-powered note generation
 *
 * Uses file-based routing with Wouter and responsive Shell layout.
 * Supports both mobile and desktop views.
 */

import { useState, useEffect, useRef, createContext, useContext } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { Toaster } from "sonner";
import { clsx } from "clsx";
import { Router } from "./router";
import { Shell } from "./components/layout/Shell";
import { useFeatureFlag, FLAGS } from "./services/posthog";
import { SplashScreen } from "./components/shared/SplashScreen";
import { useSynced } from "./hooks/useSynced";
import type { SessionI } from "../shared/types";

// =============================================================================
// Theme Context
// =============================================================================

interface ThemeContextValue {
  theme: "light" | "dark";
  isDarkMode: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  isDarkMode: false,
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

// =============================================================================
// App Component
// =============================================================================

export function App() {
  const { isLoading, error, userId } = useMentraAuth();
  const [, navigate] = useLocation();
  const { session } = useSynced<SessionI>(userId || "");

  // Redirect to onboarding on app open (controlled by feature flag + onboardingCompleted)
  const { enabled: showOnboarding, loaded: flagsLoaded } = useFeatureFlag(FLAGS.FRONTEND_ONBOARD, true);
  const [onboardingResolved, setOnboardingResolved] = useState(false);
  const onboardingResolvedRef = useRef(false);
  useEffect(() => {
    // Once resolved, never re-check (prevents re-trigger on reconnect)
    if (onboardingResolvedRef.current) return;
    if (!flagsLoaded) return;
    if (session?.settings?.onboardingCompleted === undefined) return;
    const alreadyCompleted = session.settings.onboardingCompleted === true;
    if (showOnboarding && !alreadyCompleted) {
      navigate("/onboarding");
    }
    onboardingResolvedRef.current = true;
    setOnboardingResolved(true);
  }, [showOnboarding, flagsLoaded, session?.settings?.onboardingCompleted]);

  // Post-onboarding transition splash — survives the route change from /onboarding → /
  const [postOnboardingSplash, setPostOnboardingSplash] = useState(false);
  useEffect(() => {
    const flag = sessionStorage.getItem("onboarding-complete-splash");
    if (flag) {
      sessionStorage.removeItem("onboarding-complete-splash");
      setPostOnboardingSplash(true);
    }
  });


  // Theme state — forced to light mode (dark mode disabled)
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Toggle Theme Function
  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem("theme", next);
      return next;
    });
  };

  // Apply theme class to document
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Keyboard shortcuts
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Toggle dark mode with Cmd+Shift+D
      if (e.key === "d" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
        e.preventDefault();
        toggleTheme();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Error state
  if (error) {
    return (
      <div
        className={clsx(
          "min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-black",
          theme,
        )}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center p-8 max-w-md"
        >
          <div className="w-16 h-16 rounded-2xl bg-red-500 mx-auto mb-4 flex items-center justify-center">
            <span className="text-white text-2xl">!</span>
          </div>
          <h2 className="text-xl font-semibold text-red-500 mb-2">
            Authentication Error
          </h2>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">{error}</p>
          <p className="text-zinc-400 dark:text-zinc-500 text-xs mt-2">
            Open this page from the MentraOS app.
          </p>
        </motion.div>
      </div>
    );
  }

  const themeValue: ThemeContextValue = {
    theme,
    isDarkMode: theme === "dark",
    toggleTheme,
  };

  // Don't render app until onboarding check resolves — show splash instead
  if (!onboardingResolved) {
    return (
      <div className={clsx(theme)}>
        <SplashScreen visible message="Loading" />
      </div>
    );
  }

  return (
    <ThemeContext.Provider value={themeValue}>
      <div
        className={clsx(
          "font-sans bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 selection:bg-zinc-200 dark:selection:bg-zinc-800",
          theme,
        )}
      >
        <Toaster position="top-center" theme={theme} />
        <Shell>
          <Router />
        </Shell>
        <SplashScreen
          visible={postOnboardingSplash}
          message="Getting you set up"
          duration={1200}
          onDone={() => setPostOnboardingSplash(false)}
        />
      </div>
    </ThemeContext.Provider>
  );
}
