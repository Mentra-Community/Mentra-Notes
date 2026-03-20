/**
 * CollectionsPage - Folder/collection manager for notes
 *
 * Shows system collections (Favorites, Archives, Trash, Action Items)
 * and user-created folders in a grid layout.
 * Accessible via grid toggle on NotesPage or "Create folder" from FAB.
 */

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI, FolderColor } from "../../../shared/types";
import { NotesFABMenu } from "./NotesFABMenu";
import { CreateFolderSheet } from "./CreateFolderSheet";

type CollectionFilter = "all" | "folders";

const FOLDER_COLOR_MAP: Record<FolderColor, string> = {
  red: "#DC2626",
  gray: "#78716C",
  blue: "#2563EB",
};

export function CollectionsPage() {
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState<CollectionFilter>("all");
  const [showCreateFolder, setShowCreateFolder] = useState(false);

  const notes = session?.notes?.notes ?? [];
  const folders = session?.folders?.folders ?? [];
  const transcriptionPaused = session?.settings?.transcriptionPaused ?? false;
  const isMicActive = !transcriptionPaused;

  // Count notes per folder
  const folderNoteCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const note of notes) {
      if (note.folderId) {
        counts[note.folderId] = (counts[note.folderId] || 0) + 1;
      }
    }
    return counts;
  }, [notes]);

  // Counts for system collections
  const favoritesCount = useMemo(() => notes.filter((n) => n.isFavourite && !n.isTrashed && !n.isArchived).length, [notes]);
  const archivesCount = useMemo(() => notes.filter((n) => n.isArchived).length, [notes]);
  const trashCount = useMemo(() => notes.filter((n) => n.isTrashed).length, [notes]);

  const handleAddNote = async () => {
    if (!session?.notes?.createManualNote) return;
    const note = await session.notes.createManualNote("", "");
    if (note?.id) {
      setLocation(`/note/${note.id}`);
    }
  };

  const handleCreateFolder = async (name: string, color: FolderColor) => {
    if (!session?.folders?.createFolder) return;
    await session.folders.createFolder(name, color);
  };

  const filters: { key: CollectionFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "folders", label: "Folders" },
  ];

  const systemCollections = [
    {
      id: "favourites",
      label: "Favorites",
      count: favoritesCount,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
    },
    {
      id: "archived",
      label: "Archives",
      count: archivesCount,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M21 8V21H3V8" />
          <rect x="1" y="3" width="22" height="5" rx="1" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
      ),
    },
    {
      id: "trash",
      label: "Trash",
      count: trashCount,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      ),
    },
  ];

  // Build folder grid with "New Folder" button at the end
  const folderItems = [...folders];

  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-2 px-6 shrink-0">
        <div className="flex items-center gap-2">
          <div className="text-[11px] tracking-widest uppercase leading-3.5 text-[#DC2626] font-red-hat font-bold">
            Mentra Notes
          </div>
          <div className={`flex items-center gap-1 h-full px-1 rounded ${isMicActive ? 'bg-[#FEF2F2]' : 'bg-[#F5F5F4]'}`}>
            <div className={`shrink-0 rounded-full size-1.75 ${isMicActive ? 'bg-[#DC2626] animate-pulse' : 'bg-[#A8A29E]'}`} />
            {isMicActive ? (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </div>
        </div>
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-0.5">
            <div className="text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] font-red-hat font-extrabold">
              Notes
            </div>
            <div className="text-[14px] leading-[18px] text-[#A8A29E] font-red-hat">
              Collections
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* List/Grid toggle */}
            <div className="flex items-center rounded-[10px] py-[3px] px-[3px] bg-[#F5F5F4]">
              <button
                onClick={() => setLocation("/notes")}
                className="flex items-center justify-center w-8.5 h-7.5 rounded-lg shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="3" y1="6" x2="21" y2="6" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                  <line x1="3" y1="12" x2="21" y2="12" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                  <line x1="3" y1="18" x2="21" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <div className="flex items-center justify-center w-8.5 h-7.5 rounded-lg bg-[#1C1917] shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="#FAFAF9" strokeWidth="2" />
                  <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="#FAFAF9" strokeWidth="2" />
                  <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="#FAFAF9" strokeWidth="2" />
                  <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="#FAFAF9" strokeWidth="2" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center pt-2 gap-2 px-6 shrink-0">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={`flex items-center rounded-[20px] py-[7px] px-3.5 shrink-0 ${
              activeFilter === f.key ? "bg-[#1C1917]" : "bg-[#F5F5F4]"
            }`}
          >
            <span
              className={`text-[13px] leading-4 font-red-hat ${
                activeFilter === f.key ? "text-[#FAFAF9] font-semibold" : "text-[#78716C] font-medium"
              }`}
            >
              {f.label}
            </span>
          </button>
        ))}
      </div>

      {/* Scrollable content */}
      <div className="flex flex-col flex-1 overflow-y-auto pb-32">
        {/* System collections */}
        {activeFilter === "all" && (
          <div className="flex flex-col pt-5 px-6">
            {systemCollections.map((collection, i) => {
              const isLast = i === systemCollections.length - 1;
              return (
                <button
                  key={collection.id}
                  onClick={() => setLocation(`/notes?filter=${collection.id}`)}
                  className={`flex items-center py-3.5 text-left ${
                    !isLast ? "border-b border-b-[#E7E5E4]" : ""
                  }`}
                >
                  {collection.icon}
                  <div className="pl-3.5 grow shrink basis-0 text-[15px] leading-5 text-[#1C1917] font-red-hat font-medium">
                    {collection.label}
                  </div>
                  <div className="text-[14px] leading-[18px] text-[#A8A29E] font-red-hat">
                    {collection.count}
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 ml-2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              );
            })}
          </div>
        )}

        {/* Folders */}
        <div className="flex flex-col pt-6 gap-3 px-6">
          <div className="flex items-center justify-between">
            <div className="text-[11px] tracking-widest uppercase leading-3.5 text-[#DC2626] font-red-hat font-bold">
              Folders
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: Math.ceil((folderItems.length + 1) / 2) }, (_, rowIdx) => {
              const startIdx = rowIdx * 2;
              const items: React.ReactNode[] = [];

              for (let col = 0; col < 2; col++) {
                const idx = startIdx + col;
                const folder = folderItems[idx];

                if (folder) {
                  items.push(
                    <button
                      key={folder.id}
                      onClick={() => setLocation(`/folder/${folder.id}`)}
                      className="flex flex-col grow shrink basis-0 rounded-xl overflow-hidden bg-[#FAFAF9] border border-[#E7E5E4] text-left"
                    >
                      <div className="h-1 shrink-0" style={{ backgroundColor: FOLDER_COLOR_MAP[folder.color] }} />
                      <div className="flex flex-col py-3 px-3.5 gap-0.5">
                        <div className="text-[14px] leading-[18px] text-[#1C1917] font-red-hat font-semibold">
                          {folder.name}
                        </div>
                        <div className="text-[12px] leading-4 text-[#A8A29E] font-red-hat">
                          {folderNoteCounts[folder.id] || 0} notes
                        </div>
                      </div>
                    </button>
                  );
                } else if (idx === folderItems.length) {
                  // "New Folder" button — only rendered once, right after the last folder
                  items.push(
                    <button
                      key="new-folder"
                      onClick={() => setShowCreateFolder(true)}
                      className="flex grow shrink basis-0 items-center justify-center rounded-xl py-3 px-3.5 gap-1.5 bg-[#FAFAF9] border border-dashed border-[#D6D3D1]"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span className="text-[13px] leading-4 text-[#A8A29E] font-red-hat font-medium">
                        New Folder
                      </span>
                    </button>
                  );
                } else {
                  // Empty spacer for alignment
                  items.push(<div key="spacer" className="grow shrink basis-0" />);
                }
              }

              return (
                <div key={rowIdx} className="flex gap-2.5">
                  {items}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* FAB Menu */}
      <NotesFABMenu
        onAddNote={handleAddNote}
        onAskAI={() => setLocation("/")}
        onCreateFolder={() => setShowCreateFolder(true)}
      />

      {/* Create Folder Sheet */}
      <CreateFolderSheet
        isOpen={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onCreate={handleCreateFolder}
        existingNames={folders.map((f) => f.name)}
      />
    </div>
  );
}
