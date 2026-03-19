/**
 * FoldersManager
 *
 * Manages user folders for organizing notes.
 * Seeds default folders (Personal, Work) on first hydration.
 */

import { SyncedManager, synced, rpc } from "../../../lib/sync";
import {
  createFolder,
  getFolders,
  updateFolder,
  deleteFolder,
  seedDefaultFolders,
  unassignNotesFromFolder,
  type FolderColor,
} from "../../models";

// =============================================================================
// Types
// =============================================================================

export interface FolderData {
  id: string;
  name: string;
  color: FolderColor;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Manager
// =============================================================================

export class FoldersManager extends SyncedManager {
  @synced folders = synced<FolderData[]>([]);

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async hydrate(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    try {
      // Seed defaults if no folders exist, then load all
      const dbFolders = await seedDefaultFolders(userId);
      const mapped = dbFolders.map((f) => ({
        id: f._id?.toString() || f.id,
        name: f.name,
        color: f.color,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));
      this.folders.set(mapped);
    } catch (error) {
      console.error("[FoldersManager] Failed to hydrate folders:", error);
    }
  }

  // ===========================================================================
  // RPC Methods
  // ===========================================================================

  @rpc
  async createFolder(name: string, color: FolderColor): Promise<FolderData> {
    const userId = this._session?.userId;
    if (!userId) throw new Error("No user session");

    const dbFolder = await createFolder(userId, { name, color });
    const folder: FolderData = {
      id: dbFolder._id?.toString() || dbFolder.id,
      name: dbFolder.name,
      color: dbFolder.color,
      createdAt: dbFolder.createdAt,
      updatedAt: dbFolder.updatedAt,
    };

    this.folders.mutate((f) => f.push(folder));
    return folder;
  }

  @rpc
  async updateFolder(
    folderId: string,
    updates: { name?: string; color?: FolderColor },
  ): Promise<FolderData> {
    const userId = this._session?.userId;
    if (!userId) throw new Error("No user session");

    const dbFolder = await updateFolder(userId, folderId, updates);
    if (!dbFolder) throw new Error(`Folder not found: ${folderId}`);

    let updatedFolder: FolderData | null = null;
    this.folders.mutate((folders) => {
      const index = folders.findIndex((f) => f.id === folderId);
      if (index !== -1) {
        folders[index] = {
          ...folders[index],
          ...updates,
          updatedAt: new Date(),
        };
        updatedFolder = folders[index];
      }
    });

    return updatedFolder || {
      id: dbFolder._id?.toString() || dbFolder.id,
      name: dbFolder.name,
      color: dbFolder.color,
      createdAt: dbFolder.createdAt,
      updatedAt: dbFolder.updatedAt,
    };
  }

  @rpc
  async deleteFolder(folderId: string): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) throw new Error("No user session");

    // Unassign all notes from this folder
    await unassignNotesFromFolder(userId, folderId);

    // Delete the folder
    await deleteFolder(userId, folderId);

    // Update local state
    this.folders.set(this.folders.filter((f) => f.id !== folderId));

    // Update notes in the notes manager to clear folderId references
    const notesManager = (this._session as any)?.notes;
    if (notesManager?.notes) {
      notesManager.notes.mutate((notes: any[]) => {
        for (const note of notes) {
          if (note.folderId === folderId) {
            note.folderId = null;
          }
        }
      });
    }
  }
}
