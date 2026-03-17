/**
 * SplashScreen - Full-screen loading overlay with random dot animation + fun message
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LoadingState } from "./LoadingState";

interface SplashScreenProps {
  visible?: boolean;
  /** Text shown below the spinner. If omitted, picks a random fun message. */
  message?: string;
  /** Auto-dismiss after this many ms. If omitted, stays until `visible` becomes false. */
  duration?: number;
  /** Called when the splash finishes (either duration elapsed or visible set to false) */
  onDone?: () => void;
}

export function SplashScreen({
  visible = true,
  message,
  duration,
  onDone,
}: SplashScreenProps) {
  const [show, setShow] = useState(visible);

  // Sync with external visible prop
  useEffect(() => {
    setShow(visible);
  }, [visible]);

  // Auto-dismiss after duration
  useEffect(() => {
    if (!visible || duration == null) return;
    const timer = setTimeout(() => setShow(false), duration);
    return () => clearTimeout(timer);
  }, [visible, duration]);

  return (
    <AnimatePresence onExitComplete={onDone}>
      {show && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#FAFAF9]"
        >
          <LoadingState
            size={100}
            message={message}
            cycleMessages={!message}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
