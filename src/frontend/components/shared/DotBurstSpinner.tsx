/**
 * Dot-based loading animations
 *
 * All variants share the same low-FPS stepped aesthetic,
 * scale to any size via SVG viewBox, and accept the same props.
 *
 * Variants:
 * - DotBurstSpinner:  Concentric rings collapse inward (original)
 * - DotWaveSpinner:   Horizontal dots ripple in a sine wave
 * - DotGridSpinner:   Grid of dots pulse outward from center
 * - DotSpiralSpinner: Dots spiral inward along a logarithmic path
 *
 * @example
 * <DotBurstSpinner size={80} />
 * <DotWaveSpinner size={48} color="#3B82F6" />
 * <DotGridSpinner size={120} />
 * <DotSpiralSpinner size={64} color="#22C55E" />
 */

import { useEffect, useState } from "react";

// =============================================================================
// Shared types & constants
// =============================================================================

const FPS = 9;
const FRAME_MS = 1000 / FPS;
const CX = 50;
const CY = 50;

interface SpinnerProps {
  /** Size in pixels (width & height). Defaults to 100. */
  size?: number;
  /** Dot color. Defaults to "#D94F3B". */
  color?: string;
  /** Additional CSS classes on the SVG element. */
  className?: string;
}

function useFrameCounter() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(id);
  }, []);
  return frame;
}

// =============================================================================
// 1. DotBurstSpinner — Concentric rings collapse inward (original)
// =============================================================================

const BURST_RINGS = [
  { outerR: 38, count: 14, dotR: 3.0, speed: 10, phase: 0 },
  { outerR: 30, count: 12, dotR: 3.2, speed: 9, phase: 2 },
  { outerR: 22, count: 10, dotR: 3.4, speed: 8, phase: 4 },
  { outerR: 14, count: 8, dotR: 3.6, speed: 7, phase: 3 },
  { outerR: 7, count: 6, dotR: 3.8, speed: 6, phase: 1 },
];

const CENTER_OPACITIES = [0.82, 0.88, 0.94, 1, 0.94, 0.88, 0.82, 0.76];

export function DotBurstSpinner({ size = 100, color = "#D94F3B", className }: SpinnerProps) {
  const frame = useFrameCounter();

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className}>
      {BURST_RINGS.map((ring, ri) => {
        const t = ((frame + ring.phase) % ring.speed) / ring.speed;
        const currentR = ring.outerR * (1 - t);
        const opacity = 0.1 + t * 0.7;
        const dotR = ring.dotR * (0.7 + t * 0.3);

        return Array.from({ length: ring.count }).map((_, di) => {
          const angleOffset = (ri % 2 === 0 ? 1 : -1) * frame * 0.04;
          const angle = (2 * Math.PI * di) / ring.count + angleOffset;
          const cx = CX + currentR * Math.cos(angle);
          const cy = CY + currentR * Math.sin(angle);

          return (
            <circle key={`${ri}-${di}`} cx={cx} cy={cy} r={dotR} fill={color} opacity={opacity} />
          );
        });
      })}
      <circle cx={CX} cy={CY} r={4.5} fill={color} opacity={CENTER_OPACITIES[frame % CENTER_OPACITIES.length]} />
    </svg>
  );
}

// =============================================================================
// 2. DotWaveSpinner — Horizontal dots ripple in a sine wave
// =============================================================================

const WAVE_DOTS = 9;
const WAVE_ROWS = 5;
const WAVE_SPEED = 12;

export function DotWaveSpinner({ size = 100, color = "#D94F3B", className }: SpinnerProps) {
  const frame = useFrameCounter();

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className}>
      {Array.from({ length: WAVE_ROWS }).map((_, row) =>
        Array.from({ length: WAVE_DOTS }).map((_, col) => {
          const baseX = 10 + col * 10;
          const baseY = 30 + row * 10;

          // Each dot gets a phase offset based on its position
          const phase = (col * 1.3 + row * 0.7);
          const t = ((frame + phase) % WAVE_SPEED) / WAVE_SPEED;

          // Sine wave displacement on Y axis
          const yOffset = Math.sin(t * Math.PI * 2) * 8;

          // Opacity pulses with the wave
          const opacity = 0.2 + Math.abs(Math.sin(t * Math.PI)) * 0.7;

          // Dot size breathes
          const dotR = 2.2 + Math.abs(Math.sin(t * Math.PI)) * 1.4;

          return (
            <circle
              key={`${row}-${col}`}
              cx={baseX}
              cy={baseY + yOffset}
              r={dotR}
              fill={color}
              opacity={opacity}
            />
          );
        })
      )}
    </svg>
  );
}

// =============================================================================
// 3. DotGridSpinner — Grid of dots pulse outward from center
// =============================================================================

const GRID_SIZE = 7;
const GRID_SPEED = 14;

export function DotGridSpinner({ size = 100, color = "#D94F3B", className }: SpinnerProps) {
  const frame = useFrameCounter();

  const spacing = 80 / (GRID_SIZE - 1);
  const startOffset = 10;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className}>
      {Array.from({ length: GRID_SIZE }).map((_, row) =>
        Array.from({ length: GRID_SIZE }).map((_, col) => {
          const x = startOffset + col * spacing;
          const y = startOffset + row * spacing;

          // Distance from center (0 to 1)
          const dx = (col - (GRID_SIZE - 1) / 2) / ((GRID_SIZE - 1) / 2);
          const dy = (row - (GRID_SIZE - 1) / 2) / ((GRID_SIZE - 1) / 2);
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Ripple: phase offset based on distance from center
          const phase = dist * 6;
          const t = ((frame + phase) % GRID_SPEED) / GRID_SPEED;

          // Pulse: dots grow and brighten as the ripple passes
          const pulse = Math.max(0, Math.sin(t * Math.PI * 2));
          const dotR = 1.5 + pulse * 2.8;
          const opacity = 0.15 + pulse * 0.75;

          return (
            <circle key={`${row}-${col}`} cx={x} cy={y} r={dotR} fill={color} opacity={opacity} />
          );
        })
      )}
    </svg>
  );
}

// =============================================================================
// 4. DotSpiralSpinner — Dots spiral inward along a logarithmic path
// =============================================================================

const SPIRAL_DOTS = 40;
const SPIRAL_SPEED = 16;
const SPIRAL_TURNS = 3;

export function DotSpiralSpinner({ size = 100, color = "#D94F3B", className }: SpinnerProps) {
  const frame = useFrameCounter();

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className}>
      {Array.from({ length: SPIRAL_DOTS }).map((_, i) => {
        // Animate: dots flow inward over time
        const t = ((frame * 0.8 + i * (SPIRAL_SPEED / SPIRAL_DOTS)) % SPIRAL_SPEED) / SPIRAL_SPEED;

        // Radius shrinks from outer to center
        const r = 40 * (1 - t);

        // Angle increases with turns + slow rotation
        const angle = t * Math.PI * 2 * SPIRAL_TURNS + frame * 0.06;

        const cx = CX + r * Math.cos(angle);
        const cy = CY + r * Math.sin(angle);

        // Dots get brighter and larger toward center
        const opacity = 0.1 + t * 0.8;
        const dotR = 1.8 + t * 2.5;

        return (
          <circle key={i} cx={cx} cy={cy} r={dotR} fill={color} opacity={opacity} />
        );
      })}

      {/* Center dot */}
      <circle
        cx={CX}
        cy={CY}
        r={4}
        fill={color}
        opacity={CENTER_OPACITIES[frame % CENTER_OPACITIES.length]}
      />
    </svg>
  );
}
