/**
 * WaveIndicator - Three-bar sound wave animation for live transcription.
 *
 * Runs at 9 FPS via setInterval (matching DotBurstSpinner's low-fps aesthetic).
 * Middle bar is tallest. Bars animate up/down in a staggered wave pattern.
 *
 * @example
 * <WaveIndicator />
 * <WaveIndicator color="#EF4444" height={12} />
 */

import { useEffect, useState } from "react";

const FPS = 7;
const FRAME_MS = 1000 / FPS;
// 8-step wave cycle per bar: scaleY values (0→1 range)
const WAVE = [0.35, 0.45, 0.6, 0.8, 1.0, 0.8, 0.6, 0.45, 0.45];

interface WaveIndicatorProps {
  /** Color of the bars. Defaults to "#EF4444". */
  color?: string;
  /** Max height of the tallest bar in px. Defaults to 10. */
  height?: number;
  /** Bar width in px. Defaults to 2. */
  barWidth?: number;
  /** Gap between bars in px. Defaults to 1. */
  gap?: number;
}

export function WaveIndicator({
  color = "#EF4444",
  height = 10,
  barWidth = 2,
  gap = 1,
}: WaveIndicatorProps) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % WAVE.length), FRAME_MS);

    return () => clearInterval(id);
  }, []);

  // Each bar is offset by a different phase in the wave cycle
  const offsets = [0, 3, 6]; // short / tall / medium phase offsets
  // Outer bars capped at 70% of middle
  const maxHeights = [height * 0.7, height, height * 0.7];

  return (
    <div
      className="flex items-center shrink-0"
      style={{ gap, height }}
    >
      {offsets.map((offset, i) => {
        const scale = WAVE[(frame + offset) % WAVE.length];
        return (
          <div
            key={i}
            style={{
              width: barWidth,
              height: maxHeights[i],
              backgroundColor: color,
              borderRadius: barWidth,
              transform: `scaleY(${scale})`,
              transformOrigin: "center",
            }}
          />
        );
      })}
    </div>
  );
}
