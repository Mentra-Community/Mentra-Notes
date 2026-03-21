/**
 * useMultiSelect — Long-press to enter selection mode, toggle items, batch actions
 *
 * Manages multi-select state for notes, conversations, and transcripts lists.
 * Long-press (500ms hold) on a row enters selection mode and selects that item.
 * Once in selection mode, tapping toggles selection. Auto-exits when selection is empty.
 */

import { useCallback, useRef, useState } from "react";

const LONG_PRESS_MS = 500;

export interface UseMultiSelectReturn {
  /** Whether selection mode is active */
  isSelecting: boolean;
  /** Set of selected item IDs */
  selectedIds: Set<string>;
  /** Number of selected items */
  count: number;
  /** Enter selection mode and select the first item */
  startSelecting: (id: string) => void;
  /** Toggle an item's selection state */
  toggleItem: (id: string) => void;
  /** Select all items from a given list */
  selectAll: (allIds: string[]) => void;
  /** Exit selection mode and clear selection */
  cancel: () => void;
  /** Long-press handler factory — returns touch props for a row */
  longPressProps: (id: string, disabled?: boolean) => {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchMove: () => void;
  };
}

export function useMultiSelect(): UseMultiSelectReturn {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startSelecting = useCallback((id: string) => {
    setIsSelecting(true);
    setSelectedIds(new Set([id]));
  }, []);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      // Auto-exit if nothing selected
      if (next.size === 0) {
        setIsSelecting(false);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((allIds: string[]) => {
    setSelectedIds(new Set(allIds));
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, [clearTimer]);

  const longPressProps = useCallback(
    (id: string, disabled = false) => ({
      onTouchStart: (e: React.TouchEvent) => {
        if (disabled) return;
        clearTimer();
        timerRef.current = setTimeout(() => {
          // Haptic feedback if available
          if (navigator.vibrate) navigator.vibrate(20);
          startSelecting(id);
        }, LONG_PRESS_MS);
      },
      onTouchEnd: () => {
        clearTimer();
      },
      onTouchMove: () => {
        // Cancel long-press if finger moves (scrolling)
        clearTimer();
      },
    }),
    [clearTimer, startSelecting],
  );

  return {
    isSelecting,
    selectedIds,
    count: selectedIds.size,
    startSelecting,
    toggleItem,
    selectAll,
    cancel,
    longPressProps,
  };
}
