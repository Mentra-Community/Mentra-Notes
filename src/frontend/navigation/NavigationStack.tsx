/**
 * Per-tab navigation stack.
 *
 * Model: four tab roots are ground floor. Switching tabs is lateral (no push).
 * Detail pages push onto the *current* tab's stack — which stays the owner even
 * if the destination route maps to a different tab (cross-tab pushes).
 *
 * Back pops the current tab. At the tab's root it's a no-op. Browser/OS back
 * is routed through the same `back()` via a popstate sentinel.
 *
 * **Conditional sentinel**: the MentraOS mobile host checks `webView.canGoBack`
 * on the hardware back press — if the webview has any history, it consumes one
 * press to navigate back inside the webview, otherwise it dismisses the webview.
 * An unconditional sentinel would inflate `canGoBack` even at the tab root and
 * force two hardware presses to exit the mini-app. So we only pin the sentinel
 * when we actually want to intercept the next back: i.e. when the active tab's
 * stack has depth >1, OR a drawer is open. Otherwise history is clean and one
 * hardware press exits.
 *
 * Known trade-off: while the sentinel is pinned, browser forward is disabled
 * (acceptable for a mobile-first app). Deep-link refresh seeds the current tab
 * as [root, L]; any intermediate routes are not reconstructible and collapse
 * to the root.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";

export type TabId = "transcripts" | "search" | "notes" | "settings";

export const TAB_ROOT: Record<TabId, string> = {
  transcripts: "/",
  search: "/search",
  notes: "/notes",
  settings: "/settings",
};

const TAB_ORDER: TabId[] = ["transcripts", "search", "notes", "settings"];

function stripHash(path: string): string {
  const i = path.indexOf("#");
  return i === -1 ? path : path.slice(0, i);
}

export function routeToTab(path: string): TabId {
  const p = stripHash(path);
  if (p === "/") return "transcripts";
  if (p.startsWith("/transcript/") || p.startsWith("/conversation/")) return "transcripts";
  if (p.startsWith("/search")) return "search";
  if (
    p.startsWith("/notes") ||
    p.startsWith("/note/") ||
    p.startsWith("/collections") ||
    p.startsWith("/folder/")
  )
    return "notes";
  if (p.startsWith("/settings")) return "settings";
  if (p.startsWith("/onboarding")) return "transcripts"; // outside tab model; safe default
  if (import.meta.env.DEV) {
    console.warn(`[nav] unknown route, defaulting to transcripts: ${path}`);
  }
  return "transcripts";
}

interface NavContextValue {
  activeTab: TabId;
  push: (path: string) => void;
  replace: (path: string) => void;
  back: () => void;
  switchTab: (tab: TabId) => void;
  popToRoot: (tab: TabId) => void;
  registerDrawer: (close: () => void) => () => void;
}

const NavigationContext = createContext<NavContextValue | null>(null);

export function useNavigation(): NavContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error("useNavigation must be used inside <NavigationStackProvider>");
  }
  return ctx;
}

interface ProviderProps {
  children: ReactNode;
}

export function NavigationStackProvider({ children }: ProviderProps) {
  const [location, setLocation] = useLocation();

  // Initial seed — runs once from the URL the user landed on.
  const initialTab = useMemo(() => routeToTab(location), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [stacks, setStacks] = useState<Record<TabId, string[]>>(() => {
    const seed: Record<TabId, string[]> = {
      transcripts: [TAB_ROOT.transcripts],
      search: [TAB_ROOT.search],
      notes: [TAB_ROOT.notes],
      settings: [TAB_ROOT.settings],
    };
    const t = initialTab;
    const normalized = stripHash(location);
    if (normalized !== TAB_ROOT[t] && !normalized.startsWith("/onboarding")) {
      seed[t] = [TAB_ROOT[t], location];
    }
    return seed;
  });

  // Ref mirror — so event handlers (popstate) see fresh values without re-binding.
  const stacksRef = useRef(stacks);
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    stacksRef.current = stacks;
  }, [stacks]);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Drawer registry (LIFO). Top element is called first on back().
  const drawersRef = useRef<Array<() => void>>([]);

  // Sentinel bookkeeping — see syncSentinel() for the rules.
  const sentinelPinnedRef = useRef(false);
  const shouldIntercept = useCallback(() => {
    return (
      stacksRef.current[activeTabRef.current].length > 1 ||
      drawersRef.current.length > 0
    );
  }, []);
  const syncSentinel = useCallback(() => {
    if (typeof window === "undefined") return;
    if (shouldIntercept() && !sentinelPinnedRef.current) {
      try {
        window.history.pushState({ __navSentinel: true }, "");
        sentinelPinnedRef.current = true;
      } catch {
        /* no-op if history is not available */
      }
    }
    // If we no longer need to intercept but the sentinel is still pinned, we
    // cannot safely remove a history entry (there's no pop-without-event API).
    // It gets consumed naturally on the next OS back press and the popstate
    // handler below will leave `sentinelPinnedRef = false`.
  }, [shouldIntercept]);

  const registerDrawer = useCallback(
    (close: () => void) => {
      drawersRef.current.push(close);
      syncSentinel();
      return () => {
        drawersRef.current = drawersRef.current.filter((c) => c !== close);
        // Intentionally not re-syncing on unregister: if the sentinel is
        // already pinned, let it sit — it'll be consumed by the next back.
      };
    },
    [syncSentinel],
  );

  const push = useCallback(
    (path: string) => {
      if (stripHash(location).startsWith("/onboarding")) {
        // Inside onboarding the tab model doesn't apply — let the caller navigate raw.
        setLocation(path, { replace: true });
        return;
      }
      const tab = activeTabRef.current;
      const nextStack = [...stacksRef.current[tab], path];
      stacksRef.current = { ...stacksRef.current, [tab]: nextStack };
      setStacks((prev) => ({ ...prev, [tab]: nextStack }));
      // All in-app navigation uses replace so the browser history stays at a
      // single entry. Our `stacks` state is the logical history; the sentinel
      // is the only extra browser entry we ever add (and only when we need to
      // intercept the next back). Without this, OS back would walk through
      // prior pushes left over in browser history after tab switches.
      setLocation(path, { replace: true });
    },
    [location, setLocation],
  );

  const replace = useCallback(
    (path: string) => {
      if (stripHash(location).startsWith("/onboarding")) {
        setLocation(path, { replace: true });
        return;
      }
      const tab = activeTabRef.current;
      const current = stacksRef.current[tab];
      const nextStack = current.length > 0 ? [...current.slice(0, -1), path] : [path];
      stacksRef.current = { ...stacksRef.current, [tab]: nextStack };
      setStacks((prev) => ({ ...prev, [tab]: nextStack }));
      setLocation(path, { replace: true });
    },
    [location, setLocation],
  );

  const back = useCallback(() => {
    // Drawer-first: topmost open drawer claims back.
    if (drawersRef.current.length > 0) {
      const close = drawersRef.current[drawersRef.current.length - 1];
      close();
      return;
    }
    const tab = activeTabRef.current;
    const stack = stacksRef.current[tab];
    if (stack.length <= 1) {
      // At the root — no-op.
      return;
    }
    const nextStack = stack.slice(0, -1);
    const target = nextStack[nextStack.length - 1];
    // Mutate the ref synchronously so any syncSentinel() call that runs before
    // the setStacks effect commits sees the post-pop depth.
    stacksRef.current = { ...stacksRef.current, [tab]: nextStack };
    setStacks((prev) => ({ ...prev, [tab]: nextStack }));
    setLocation(target, { replace: true });
  }, [setLocation]);

  const switchTab = useCallback(
    (tab: TabId) => {
      if (tab === activeTabRef.current) return;
      const target = stacksRef.current[tab].at(-1) ?? TAB_ROOT[tab];
      activeTabRef.current = tab;
      setActiveTab(tab);
      setLocation(target, { replace: true });
    },
    [setLocation],
  );

  const popToRoot = useCallback(
    (tab: TabId) => {
      stacksRef.current = { ...stacksRef.current, [tab]: [TAB_ROOT[tab]] };
      activeTabRef.current = tab;
      setStacks((prev) => ({ ...prev, [tab]: [TAB_ROOT[tab]] }));
      setActiveTab(tab);
      setLocation(TAB_ROOT[tab], { replace: true });
    },
    [setLocation],
  );

  // Popstate interception. When OS/browser back fires, our sentinel gets
  // consumed — route it through back() and re-sync (which re-pins only if
  // we still need to intercept further presses).
  useEffect(() => {
    const onPop = () => {
      sentinelPinnedRef.current = false;
      back();
      // back() has already mutated stacks/drawers; re-sync against the new state.
      syncSentinel();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [back, syncSentinel]);

  // Wouter's setLocation calls history.pushState / replaceState, which
  // displaces any sentinel we pinned. Re-sync after every location change.
  useEffect(() => {
    // A pushState from Wouter overrides our sentinel entry entirely.
    sentinelPinnedRef.current = false;
    syncSentinel();
  }, [location, syncSentinel]);

  const value = useMemo<NavContextValue>(
    () => ({ activeTab, push, replace, back, switchTab, popToRoot, registerDrawer }),
    [activeTab, push, replace, back, switchTab, popToRoot, registerDrawer],
  );

  // Silence unused-state lint — `stacks` is read via ref but `setStacks` is what
  // drives behavior. Keeping `stacks` in state lets future consumers subscribe.
  void stacks;

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
