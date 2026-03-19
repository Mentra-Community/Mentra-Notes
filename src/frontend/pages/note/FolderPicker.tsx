/**
 * FolderPicker - Dropdown to assign a note to a folder
 *
 * Collapsed: shows current folder name or "No folder"
 * Expanded: shows list of all folders with color dots
 */

import { useState } from "react";
import type { Folder, FolderColor } from "../../../shared/types";

const FOLDER_COLOR_MAP: Record<FolderColor, string> = {
  red: "#DC2626",
  gray: "#78716C",
  blue: "#2563EB",
};

interface FolderPickerProps {
  folders: Folder[];
  currentFolderId?: string | null;
  onSelect: (folderId: string | null) => void;
}

export function FolderPicker({ folders, currentFolderId, onSelect }: FolderPickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const currentFolder = folders.find((f) => f.id === currentFolderId);

  return (
    <div className="relative px-6 pb-4">
      {/* Collapsed bar */}
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="flex items-center justify-between w-full rounded-[10px] py-3 px-3.5 bg-[#F5F5F4] text-left"
      >
        <div className="flex items-center gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
              stroke={currentFolder ? FOLDER_COLOR_MAP[currentFolder.color] : "#78716C"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <span className="text-[14px] leading-[18px] text-[#1C1917] font-red-hat font-medium">
            {currentFolder?.name || "No folder"}
          </span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          style={{
            transform: `rotate(${isOpen ? 180 : 0}deg)`,
            transition: "transform 0.15s ease",
          }}
        >
          <polyline points="6,9 12,15 18,9" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute left-6 right-6 mt-1 rounded-xl bg-white border border-[#E7E5E4] shadow-[0px_4px_16px_rgba(0,0,0,0.08)] z-20 overflow-hidden">
          {/* No folder option */}
          <button
            onClick={() => { onSelect(null); setIsOpen(false); }}
            className={`flex items-center gap-2.5 w-full py-3 px-3.5 text-left ${
              !currentFolderId ? "bg-[#F5F5F4]" : ""
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <span className="text-[14px] leading-[18px] text-[#78716C] font-red-hat font-medium">
              No folder
            </span>
          </button>

          {/* Folder options */}
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => { onSelect(folder.id); setIsOpen(false); }}
              className={`flex items-center gap-2.5 w-full py-3 px-3.5 text-left border-t border-[#F5F5F4] ${
                currentFolderId === folder.id ? "bg-[#F5F5F4]" : ""
              }`}
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: FOLDER_COLOR_MAP[folder.color] }}
              />
              <span className="text-[14px] leading-[18px] text-[#1C1917] font-red-hat font-medium">
                {folder.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
