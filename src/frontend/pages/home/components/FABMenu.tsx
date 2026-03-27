/**
 * FABMenu - Single transcription mic toggle button with stop confirmation
 */

import { useState } from "react";
import { StopTranscriptionDialog } from "./StopTranscriptionDialog";

interface FABMenuProps {
  transcriptionPaused: boolean;
  onStopTranscribing: () => void;
  onResumeTranscribing: () => void;
}

export function FABMenu({
  transcriptionPaused,
  onStopTranscribing,
  onResumeTranscribing,
}: FABMenuProps) {
  const isActive = !transcriptionPaused;
  const [showStopDialog, setShowStopDialog] = useState(false);

  const handlePress = () => {
    if (isActive) {
      setShowStopDialog(true);
    } else {
      onResumeTranscribing();
    }
  };

  return (
    <>
      <div className="fixed bottom-[100px] right-6 z-50 flex items-center gap-2.5">
        <button
          onClick={handlePress}
          className={`flex items-center justify-center w-[52px] h-[52px] rounded-2xl active:scale-95 transition-transform ${
            isActive
              ? "bg-[#DC2626] [box-shadow:#DC262640_0px_4px_16px]"
              : "bg-[#1C1917] [box-shadow:#1C191740_0px_4px_16px]"
          }`}
        >
          {isActive ? (
            /* Mic on */
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#FFFFFF" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1="19" x2="12" y2="23" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            /* Mic off — with slash */
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
          )}
        </button>
      </div>

      <StopTranscriptionDialog
        open={showStopDialog}
        onCancel={() => setShowStopDialog(false)}
        onConfirm={() => {
          setShowStopDialog(false);
          onStopTranscribing();
        }}
      />
    </>
  );
}
