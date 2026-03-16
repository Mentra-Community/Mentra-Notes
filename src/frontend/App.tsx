/**
 * Notes App - All-day transcription and AI-powered note generation
 *
 * Uses file-based routing with Wouter and responsive Shell layout.
 * Supports both mobile and desktop views.
 */

import { useState, useEffect, createContext, useContext } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { Toaster } from "sonner";
import { clsx } from "clsx";
import { Router } from "./router";
import { Shell } from "./components/layout/Shell";
import { useFeatureFlag, FLAGS } from "./services/posthog";
// import { SplashScreen } from "./components/shared/SplashScreen";

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
  const { isLoading, error } = useMentraAuth();
  const [, navigate] = useLocation();

  // Redirect to onboarding on app open (controlled by feature flag)
  const { enabled: showOnboarding, loaded: flagsLoaded } = useFeatureFlag(FLAGS.FRONTEND_ONBOARD, true);
  const [onboardingResolved, setOnboardingResolved] = useState(false);
  useEffect(() => {
    if (!flagsLoaded) return;
    if (showOnboarding) {
      navigate("/onboarding");
    }
    setOnboardingResolved(true);
  }, [showOnboarding, flagsLoaded]);

  // // Splash screen: show for 3s, then fade out
  // const [splashVisible, setSplashVisible] = useState(true);
  // useEffect(() => {
  //   const timer = setTimeout(() => setSplashVisible(false), 3000);
  //   return () => clearTimeout(timer);
  // }, []);

  // Theme state
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      if (saved === "dark" || saved === "light") return saved;
    }
    return "light";
  });

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

  // Don't render until onboarding check resolves to prevent home screen flash
  if (!onboardingResolved) {
    return (
      <div className={clsx("h-screen w-screen bg-[#FAFAF9] dark:bg-black", theme)} />
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
        {/* <SplashScreen visible={splashVisible} /> */}
      </div>
    </ThemeContext.Provider>
  );
}
