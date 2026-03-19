# Issue 12: Swipe-to-Action — Fix Janky Gesture Handling

## Problem

The swipe-to-reveal-actions gesture on ConversationRow and NoteRow is broken on mobile:

1. **Fast swipes cause jittering** — Quick left/right flicks make the row jump erratically between open/closed states
2. **Hold-and-release snaps back** — Dragging left past the threshold and releasing causes the row to snap back to closed instead of staying open
3. **Conflicts with vertical scroll** — `dragDirectionLock` isn't enough; small diagonal gestures still trigger horizontal drag
4. **Action buttons bleed through** — NoteRow wrapper is missing `overflow-hidden`, so delete button shows through at rest
5. **`dragSnapToOrigin` fights `animate`** — Both try to control the `x` position, causing the row to rubber-band back even when `isSwiped` is true

## Root Cause

The current approach uses Framer Motion's `drag="x"` with `dragSnapToOrigin`, `dragDirectionLock`, and `animate` all competing to control position. This creates conflicts:

- `dragSnapToOrigin` always wants to return to 0
- `animate` wants to go to `-146` when swiped
- These fight each other, causing the jitter on fast gestures
- `dragDirectionLock` doesn't have a dead zone, so tiny movements trigger drag

## Solution: Drop Framer Motion drag, use native touch events

Replace the Framer Motion drag system with manual `onTouchStart`/`onTouchMove`/`onTouchEnd` handlers. This gives full control over the gesture lifecycle with no conflicting animation systems.

### Architecture

Create a shared `useSwipeToReveal` hook used by both ConversationRow and NoteRow.

```
src/frontend/hooks/useSwipeToReveal.ts   ← new shared hook
```

### Hook API

```ts
const { containerRef, rowStyle, handlers } = useSwipeToReveal({
  openDistance: 146,       // how far to slide open (button widths)
  threshold: 0.3,          // 30% of openDistance to trigger
  deadZone: 10,            // px of movement before deciding axis
  onOpen?: () => void,
  onClose?: () => void,
});
```

### Implementation Steps

#### Step 1: Create `useSwipeToReveal` hook

The hook manages three phases of touch:

**Phase 1 — Dead zone (first 10px of movement)**
- Track `touchStart` x/y position
- Do NOT move the row yet
- Once total movement exceeds `deadZone` (10px), decide axis:
  - If `|deltaY| > |deltaX|` → vertical scroll, abort horizontal gesture entirely
  - If `|deltaX| > |deltaY|` → lock to horizontal, prevent scroll with `e.preventDefault()`

**Phase 2 — Tracking (finger is moving horizontally)**
- Update `translateX` via `useMotionValue` (for action button opacity transforms)
- Clamp between `-openDistance` and `0` (no overscroll, no rightward drag)
- No animation during this phase — raw 1:1 finger tracking

**Phase 3 — Release (touchend)**
- If `|totalDeltaX| > openDistance * threshold` → animate to `-openDistance` (open)
- Else → animate to `0` (closed)
- Use `animate(x, target, { type: "tween", duration: 0.2, ease: "easeOut" })` from Framer Motion's imperative API
- Start auto-close timer if opened

**States:**
- `idle` → not being touched, position is either 0 or -openDistance
- `tracking` → finger is down and we've locked to horizontal
- `settling` → finger released, animating to final position

#### Step 2: Update ConversationRow

- Remove: `drag`, `dragDirectionLock`, `dragSnapToOrigin`, `dragConstraints`, `dragElastic`, `onDragStart`, `onDragEnd`
- Keep: `motion.div` with `style={{ x }}` and action button opacity transforms
- Add: `onTouchStart`, `onTouchMove`, `onTouchEnd` from the hook
- Keep: `onTap` → replaced with `onClick` that checks `isDragging`
- Keep: `overflow-hidden` on wrapper

#### Step 3: Update NoteRow

- Same changes as ConversationRow
- Add `overflow-hidden` back to the wrapper div (currently missing)

#### Step 4: Handle edge cases

| Edge case | How to handle |
|---|---|
| Tap (no movement) | Dead zone never exceeded → fire `onSelect` |
| Fast flick | Use velocity check: if `velocity.x < -300` and direction is left, treat as open regardless of distance |
| Swipe right to close | If already open, allow rightward drag; if `deltaX > threshold` from open position → close |
| Multiple rows open | Optional: emit event so parent closes other open rows (not required for MVP) |
| Scroll while swiped open | Auto-close on scroll (attach scroll listener to parent) |

### Files to Modify

| File | Change |
|---|---|
| `src/frontend/hooks/useSwipeToReveal.ts` | **New** — shared hook |
| `src/frontend/pages/home/components/ConversationRow.tsx` | Replace drag props with hook |
| `src/frontend/pages/notes/NoteRow.tsx` | Replace drag props with hook, add `overflow-hidden` |

### Testing Checklist

- [ ] Slow drag left past 30% → opens smoothly, stays open
- [ ] Slow drag left under 30% → snaps back smoothly
- [ ] Fast flick left → opens
- [ ] Fast flick right on open row → closes
- [ ] Tap on closed row → navigates (no swipe triggered)
- [ ] Tap on open row → closes row
- [ ] Vertical scroll through list → no horizontal movement on any row
- [ ] Diagonal gesture → no jitter, picks one axis
- [ ] Action buttons not visible at rest
- [ ] Archive button works when revealed
- [ ] Delete button works when revealed
- [ ] Auto-close after 6 seconds
- [ ] No bounce/jitter on any gesture
