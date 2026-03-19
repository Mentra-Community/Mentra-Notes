/**
 * useSwipeToReveal — Native touch-based swipe gesture hook
 *
 * Replaces Framer Motion drag for swipe-to-reveal action buttons.
 * Uses touch events directly to avoid conflicts between drag/animate/snapToOrigin.
 */

import { useMotionValue, animate as motionAnimate } from "motion/react";
import { useRef, useState, useEffect, useCallback } from "react";

interface UseSwipeToRevealOptions {
  openDistance?: number;
  threshold?: number;
  deadZone?: number;
  autoCloseDelay?: number;
}

type GesturePhase = "idle" | "deciding" | "tracking" | "settling";

export function useSwipeToReveal({
  openDistance = 146,
  threshold = 0.3,
  deadZone = 10,
  autoCloseDelay = 6000,
}: UseSwipeToRevealOptions = {}) {
  const x = useMotionValue(0);
  const [isSwiped, setIsSwiped] = useState(false);

  const phaseRef = useRef<GesturePhase>("idle");
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTranslateRef = useRef(0);
  const isDraggingRef = useRef(false);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoClose = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
  }, []);

  const startAutoClose = useCallback(() => {
    clearAutoClose();
    autoCloseTimerRef.current = setTimeout(() => {
      motionAnimate(x, 0, { type: "tween", duration: 0.2, ease: "easeOut" });
      setIsSwiped(false);
    }, autoCloseDelay);
  }, [clearAutoClose, autoCloseDelay, x]);

  useEffect(() => {
    return () => clearAutoClose();
  }, [clearAutoClose]);

  const close = useCallback(() => {
    clearAutoClose();
    motionAnimate(x, 0, { type: "tween", duration: 0.2, ease: "easeOut" });
    setIsSwiped(false);
  }, [clearAutoClose, x]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    startTranslateRef.current = x.get();
    phaseRef.current = "deciding";
    clearAutoClose();
  }, [x, clearAutoClose]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (phaseRef.current === "idle" || phaseRef.current === "settling") return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - startXRef.current;
    const deltaY = touch.clientY - startYRef.current;

    if (phaseRef.current === "deciding") {
      const totalMove = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (totalMove < deadZone) return;

      // Decide axis
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        // Vertical — abort, let scroll happen
        phaseRef.current = "idle";
        return;
      }

      // Horizontal — lock in
      phaseRef.current = "tracking";
      isDraggingRef.current = true;
    }

    if (phaseRef.current === "tracking") {
      e.preventDefault();
      const rawX = startTranslateRef.current + deltaX;
      const clamped = Math.max(-openDistance, Math.min(0, rawX));
      x.set(clamped);
    }
  }, [deadZone, openDistance, x]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (phaseRef.current === "idle" || phaseRef.current === "settling") {
      phaseRef.current = "idle";
      return;
    }

    if (phaseRef.current === "deciding") {
      // Never exceeded dead zone — this is a tap
      phaseRef.current = "idle";
      isDraggingRef.current = false;
      return;
    }

    // We were tracking
    phaseRef.current = "settling";

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - startXRef.current;
    const currentX = x.get();
    const thresholdPx = openDistance * threshold;

    // Calculate velocity from last movement
    const wasOpenBefore = startTranslateRef.current < -thresholdPx;

    let shouldOpen: boolean;

    if (wasOpenBefore) {
      // Was open — close if dragged right past threshold
      shouldOpen = currentX < -(openDistance - thresholdPx);
    } else {
      // Was closed — open if dragged left past threshold
      shouldOpen = currentX < -thresholdPx;
    }

    const target = shouldOpen ? -openDistance : 0;

    motionAnimate(x, target, {
      type: "tween",
      duration: 0.2,
      ease: "easeOut",
      onComplete: () => {
        phaseRef.current = "idle";
      },
    });

    setIsSwiped(shouldOpen);
    if (shouldOpen) {
      startAutoClose();
    }

    // Debounce isDragging flag so onClick doesn't fire
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 50);
  }, [x, openDistance, threshold, startAutoClose]);

  const handleClick = useCallback((onSelect: () => void) => {
    if (isDraggingRef.current) return;
    if (isSwiped) {
      close();
    } else {
      onSelect();
    }
  }, [isSwiped, close]);

  return {
    x,
    isSwiped,
    close,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    handleClick,
  };
}
