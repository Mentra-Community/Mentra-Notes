/**
 * CreateFolderSheet - Bottom sheet for creating a new folder
 *
 * Text input for name + 3 color swatches (red, gray, blue) + Create button.
 */

import { useState } from "react";
import type { FolderColor } from "../../../shared/types";

const COLORS: { value: FolderColor; hex: string }[] = [
  { value: "red", hex: "#DC2626" },
  { value: "gray", hex: "#78716C" },
  { value: "blue", hex: "#2563EB" },
];

interface CreateFolderSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, color: FolderColor) => void;
}

export function CreateFolderSheet({ isOpen, onClose, onCreate }: CreateFolderSheetProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<FolderColor>("gray");

  if (!isOpen) return null;

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, color);
    setName("");
    setColor("gray");
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: "rgba(0,0,0,0.2)",
          transition: "opacity 0.15s ease",
        }}
      />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#FAFAF9] rounded-t-2xl p-6 pb-10 shadow-[0px_-4px_24px_rgba(0,0,0,0.1)]">
        <div className="flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="text-[18px] leading-6 text-[#1C1917] font-red-hat font-bold">
              New Folder
            </div>
            <button onClick={onClose} className="text-[14px] leading-[18px] text-[#A8A29E] font-red-hat font-medium">
              Cancel
            </button>
          </div>

          {/* Name input */}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Folder name"
            autoFocus
            className="w-full rounded-xl py-3 px-4 bg-[#F5F5F4] text-[15px] leading-5 text-[#1C1917] font-red-hat font-medium placeholder:text-[#A8A29E] outline-none focus:ring-2 focus:ring-[#DC2626]/20"
          />

          {/* Color picker */}
          <div className="flex flex-col gap-2">
            <div className="text-[13px] leading-4 text-[#78716C] font-red-hat font-medium">
              Color
            </div>
            <div className="flex items-center gap-3">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  className="flex items-center justify-center w-10 h-10 rounded-xl"
                  style={{
                    backgroundColor: c.hex,
                    boxShadow: color === c.value ? `0 0 0 3px ${c.hex}33, 0 0 0 1.5px ${c.hex}` : "none",
                  }}
                >
                  {color === c.value && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Create button */}
          <button
            onClick={handleCreate}
            disabled={!name.trim()}
            className={`w-full py-3.5 rounded-xl text-[15px] leading-5 font-red-hat font-bold transition-opacity ${
              name.trim()
                ? "bg-[#DC2626] text-white"
                : "bg-[#F5F5F4] text-[#A8A29E]"
            }`}
          >
            Create Folder
          </button>
        </div>
      </div>
    </>
  );
}
