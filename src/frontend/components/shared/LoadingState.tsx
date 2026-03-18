/**
 * LoadingState - Reusable loading animation with fun messages
 *
 * Combines a random DotSpinner variant with a witty loading message.
 * Easy to drop in anywhere with simple props.
 *
 * @example
 * <LoadingState />                                    // Random spinner + random message
 * <LoadingState message="Searching..." />             // Custom message
 * <LoadingState size={120} />                         // Bigger spinner
 * <LoadingState messages={["Hold tight", "Almost"]} /> // Custom message pool
 * <LoadingState color="#3B82F6" />                     // Custom color
 * <LoadingState variant="burst" />                    // Force specific spinner
 */

import { useState, useEffect } from "react";
import {
  DotBurstSpinner,
  DotWaveSpinner,
  DotGridSpinner,
  DotSpiralSpinner,
} from "./DotBurstSpinner";


const SPINNERS = [DotBurstSpinner, DotWaveSpinner, DotGridSpinner, DotSpiralSpinner];
const SPINNER_KEYS = ["burst", "wave", "grid", "spiral"] as const;
type SpinnerVariant = (typeof SPINNER_KEYS)[number];

const DEFAULT_MESSAGES = [
  "Vibing with your data...",
  "Consulting the oracles...",
  "Rummaging through memories...",
  "Connecting the dots...",
  "Summoning the results...",
  "Thinking really hard...",
  "Unfolding the universe...",
  "Warming up the neurons...",
  "Asking the smart glasses...",
  "Dusting off the archives...",
  "Reading between the lines...",
  "Brewing something good...",
  "Doing the brain thing...",
  "Almost there, probably...",
  "Sifting through brilliance...",
  "Wrangling the data gnomes...",
  "Decoding your thoughts...",
  "Channeling big brain energy...",
  "Hold tight, magic in progress...",
  "Marinating on it...",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface LoadingStateProps {
  /** Fixed message. If omitted, picks a random fun message. */
  message?: string;
  /** Pool of messages to randomly pick from. Defaults to built-in fun messages. */
  messages?: string[];
  /** Spinner size in pixels. Defaults to 80. */
  size?: number;
  /** Dot color. Defaults to "#D94F3B". */
  color?: string;
  /** Force a specific spinner variant. If omitted, picks randomly. */
  variant?: SpinnerVariant;
  /** Additional CSS classes on the container. */
  className?: string;
  /** Whether to cycle the message every few seconds. Defaults to true. */
  cycleMessages?: boolean;
  /** How often to cycle messages (ms). Defaults to 3000. */
  cycleInterval?: number;
}

export function LoadingState({
  message,
  messages = DEFAULT_MESSAGES,
  size = 80,
  color = "#D94F3B",
  variant,
  className,
  cycleMessages = true,
  cycleInterval = 3000,
}: LoadingStateProps) {
  const [currentMessage, setCurrentMessage] = useState(
    message || pickRandom(messages),
  );
  const [spinnerIdx] = useState(() =>
    variant ? SPINNER_KEYS.indexOf(variant) : Math.floor(Math.random() * SPINNERS.length),
  );

  // Cycle through messages
  useEffect(() => {
    if (message || !cycleMessages) return; // Fixed message, don't cycle
    const id = setInterval(() => {
      setCurrentMessage(pickRandom(messages));
    }, cycleInterval);
    return () => clearInterval(id);
  }, [message, messages, cycleMessages, cycleInterval]);

  // Update if fixed message changes
  useEffect(() => {
    if (message) setCurrentMessage(message);
  }, [message]);

  const Spinner = SPINNERS[spinnerIdx];

  return (
    <div className={`flex flex-col items-center justify-center gap-4 ${className || ""}`}>
      <Spinner size={size} color={color} />
      <span className={`text-[13px] text-[#A8A29E] font-red-hat font-medium`}>
        {currentMessage}
      </span>
    </div>
  );
}
