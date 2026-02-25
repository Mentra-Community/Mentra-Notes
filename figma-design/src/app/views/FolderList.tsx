import React, { useState } from 'react';
import { format, isToday, isYesterday, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from 'date-fns';
import { Star, ChevronRight, Sparkles, ChevronDown, Check, FolderOpen, Trash2, Archive, Layers, X, Calendar as CalendarIcon, ChevronLeft, List as ListIcon, Mic, MoreHorizontal, Circle } from 'lucide-react';
import { clsx } from 'clsx';
import { DailyFolder, Note } from '@/app/lib/mockData';
import { Drawer } from 'vaul';
import { motion } from 'motion/react';

interface FolderListProps {
  folders: DailyFolder[];
  onFolderClick: (folderId: string) => void;
  onNoteClick: (folderId: string, noteId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onToggleStar: (folderId: string) => void;
  onGlobalChat: () => void;
}

const ShimmerText = ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <span 
        className={clsx("relative inline-block bg-gradient-to-r from-red-600 via-red-400 to-red-600 bg-[length:200%_auto] bg-clip-text text-transparent animate-shimmer", className)}
        style={{ animation: 'shimmer 2s linear infinite' }}
    >
        {children}
        <style>{`
            @keyframes shimmer {
                0% { background-position: -200% center; }
                100% { background-position: 200% center; }
            }
        `}</style>
    </span>
);

const FolderRow = ({
  folder,
  onClick,
}: {
  folder: DailyFolder;
  onClick: () => void;
}) => {
  let primaryLabel = format(folder.date, 'EEEE'); 
  let secondaryLabel = format(folder.date, 'MMM d');
  
  if (isToday(folder.date)) {
      primaryLabel = 'Today';
      secondaryLabel = `${format(folder.date, 'EEEE')}, ${format(folder.date, 'MMM d')}`;
  }
  if (isYesterday(folder.date)) {
      primaryLabel = 'Yesterday';
      secondaryLabel = `${format(folder.date, 'EEEE')}, ${format(folder.date, 'MMM d')}`;
  }

  const noteCount = folder.notes.length;
  const audioCount = folder.audio.length;
  
  // Calculate total duration in minutes
  const totalMinutes = folder.audio.reduce((acc, curr) => {
      // Handle both "15:20" (mm:ss) and "45m" (minutes) formats
      if (curr.duration.includes(':')) {
          const parts = curr.duration.split(':');
          if (parts.length === 2) {
              return acc + parseInt(parts[0]);
          }
      } else if (curr.duration.endsWith('m')) {
          return acc + parseInt(curr.duration.replace('m', ''));
      }
      return acc;
  }, 0);

  const formatDuration = (mins: number) => {
      if (mins < 60) return `${mins}m`;
      const hrs = Math.floor(mins / 60);
      const remainingMins = mins % 60;
      return `${hrs}h ${remainingMins}m`;
  };

  return (
    <div 
        onClick={onClick}
        className="group flex items-center justify-between h-[72px] border-b border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50/50 dark:hover:bg-zinc-800/50 transition-colors px-4 -mx-6 md:mx-0"
    >
        <div className="flex flex-col justify-center">
            <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-100 leading-tight">
                {primaryLabel}
            </h3>
            <span className="text-sm text-zinc-500 dark:text-zinc-500 leading-tight mt-0.5">
                {secondaryLabel}
            </span>
        </div>

        <div className="flex items-center gap-3">
            {folder.isTranscribing ? (
                <div className="flex items-center gap-1.5">
                    {/* Shadcn inspired svg spinner bars scale middle */}
                     <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className="text-red-500 fill-current w-5 h-5">
                        <rect x="1" y="6" width="2.8" height="12">
                            <animate attributeName="y" begin="0s" dur="1s" values="6;1;6" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" repeatCount="indefinite" />
                            <animate attributeName="height" begin="0s" dur="1s" values="12;22;12" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" repeatCount="indefinite" />
                        </rect>
                        <rect x="5.8" y="6" width="2.8" height="12">
                            <animate attributeName="y" begin="0.2s" dur="1s" values="6;1;6" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" repeatCount="indefinite" />
                            <animate attributeName="height" begin="0.2s" dur="1s" values="12;22;12" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" repeatCount="indefinite" />
                        </rect>
                        <rect x="10.6" y="6" width="2.8" height="12">
                            <animate attributeName="y" begin="0.4s" dur="1s" values="6;1;6" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" repeatCount="indefinite" />
                            <animate attributeName="height" begin="0.4s" dur="1s" values="12;22;12" calcMode="spline" keySplines="0.45 0 0.55 1;0.45 0 0.55 1" repeatCount="indefinite" />
                        </rect>
                    </svg>
                    <ShimmerText className="text-xs font-bold mt-0.5">
                        Transcribing...
                    </ShimmerText>
                </div>
            ) : (
                <div className="flex items-center gap-3">
                    {(noteCount > 0 || audioCount > 0) ? (
                        <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                             {noteCount > 0 && (
                                 <span className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/50 px-2 py-0.5 rounded-md text-zinc-600 dark:text-zinc-400">
                                     {noteCount} Note{noteCount !== 1 ? 's' : ''}
                                 </span>
                             )}
                             
                             {audioCount > 0 && (
                                 <span className="flex items-center gap-1">
                                    {noteCount > 0 && <span className="opacity-50">•</span>}
                                    <span className="flex items-center gap-1">
                                        <Mic size={10} strokeWidth={2.5} />
                                        {formatDuration(totalMinutes)}
                                    </span>
                                 </span>
                             )}
                        </div>
                    ) : (
                        <span className="text-xs text-zinc-300 dark:text-zinc-700 italic">Empty</span>
                    )}
                </div>
            )}

            <ChevronRight size={24} className="text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-400 dark:group-hover:text-zinc-500 transition-colors" />
        </div>
    </div>
  );
};

const NoteRow = ({
    note,
    folderDate,
    onClick
}: {
    note: Note;
    folderDate: Date;
    onClick: () => void;
}) => {
    return (
        <div 
            onClick={onClick}
            className="group flex items-center justify-between py-5 border-b border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50/50 dark:hover:bg-zinc-800/50 transition-colors px-6 -mx-6 md:mx-0"
        >
             <div className="flex-1 min-w-0 pr-4">
                 <div className="flex items-center gap-2 mb-1">
                     <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-100 truncate tracking-tight">{note.title}</h3>
                     {note.isPinned && <Star size={12} className="fill-zinc-400 text-zinc-400" />}
                 </div>
                 <div className="text-sm text-zinc-500 dark:text-zinc-400 font-normal flex items-center gap-2">
                     <span>{format(folderDate, 'MMM d')}</span>
                     <span>•</span>
                     <span className="truncate max-w-[200px]">{note.summary}</span>
                 </div>
             </div>
             <ChevronRight size={16} className="text-zinc-300 dark:text-zinc-600 group-hover:text-zinc-400 dark:group-hover:text-zinc-500 transition-colors" />
        </div>
    );
}

type FilterType = 'all' | 'archived' | 'trash' | 'all_notes' | 'favorites';

export const FolderList: React.FC<FolderListProps> = ({
  folders,
  onFolderClick,
  onNoteClick,
  onDeleteFolder,
  onToggleStar,
  onGlobalChat,
}) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Filter Logic
  const activeFolders = folders.filter(f => !f.isArchived && !f.isTrashed);
  const archivedFolders = folders.filter(f => f.isArchived && !f.isTrashed);
  const trashedFolders = folders.filter(f => f.isTrashed);

  const allNotesWithMeta = folders
    .filter(f => !f.isTrashed)
    .flatMap(f => (f.notes || []).map(n => ({ ...n, folderId: f.id, folderDate: f.date })));
  
  const getFilteredContent = () => {
      if (activeFilter === 'all') {
          return activeFolders; 
      }
      if (activeFilter === 'archived') {
          return archivedFolders;
      }
      if (activeFilter === 'trash') {
          return trashedFolders;
      }
      if (activeFilter === 'favorites') {
          return allNotesWithMeta.filter(n => n.isPinned);
      }
      if (activeFilter === 'all_notes') {
          return allNotesWithMeta;
      }
      return [];
  };

  const filteredData = getFilteredContent();
  const isFolderView = activeFilter === 'all' || activeFilter === 'archived' || activeFilter === 'trash';
  
  const pinnedCount = folders
    .filter(f => !f.isTrashed)
    .reduce((acc, f) => acc + (f.notes || []).filter(n => n.isPinned).length, 0);
    
  const noteCount = allNotesWithMeta.length;

  const FilterOption = ({ 
      id, 
      label, 
      icon: Icon, 
      count 
  }: { 
      id: FilterType, 
      label: string, 
      icon: React.ElementType, 
      count?: number 
  }) => (
      <button 
          onClick={() => { setActiveFilter(id); setIsFilterOpen(false); }}
          className="w-full flex items-center justify-between py-3 px-2 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg transition-colors"
      >
          <div className="flex items-center gap-3">
              <Icon size={20} className="text-zinc-500 dark:text-zinc-400" />
              <span className="text-base text-zinc-900 dark:text-zinc-100">{label}</span>
              {count !== undefined && <span className="text-zinc-400 dark:text-zinc-500 text-sm">({count})</span>}
          </div>
          {activeFilter === id && <Check size={18} className="text-zinc-900 dark:text-white" />}
      </button>
  );

  // Calendar Logic
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
  const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  // Month stats
  const currentMonthFolders = folders.filter(f => 
    isSameMonth(f.date, currentMonth) && !f.isTrashed && !f.isArchived
  );
  const monthNotesCount = currentMonthFolders.reduce((acc, f) => acc + f.notes.length, 0);
  const monthAudioCount = currentMonthFolders.reduce((acc, f) => acc + f.audio.length, 0);
  const monthTranscribedMinutes = currentMonthFolders.reduce((acc, f) => {
      return acc + f.audio.reduce((sum, a) => {
          const parts = a.duration.split(':');
          return sum + parseInt(parts[0]);
      }, 0);
  }, 0);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black transition-colors">
      
      {/* Header */}
      {/* Increased padding to accommodate global header */}
      <div className="px-6 pt-[60px] pb-4 sticky top-0 bg-white dark:bg-black z-10 border-b border-zinc-100 dark:border-zinc-800 transition-colors">
        
        {/* Controls grouped - Filter Left, Icons Right */}
        {viewMode === 'list' ? (
            <div className="flex items-center justify-between">
                <button 
                    onClick={() => setIsFilterOpen(true)}
                    className="flex items-center gap-1.5 group -ml-2 px-2 py-1 min-h-11 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                >
                    <h1 className="text-xl font-normal text-zinc-900 dark:text-white tracking-tight">
                        {activeFilter === 'all' ? 'All Files' : 
                        activeFilter === 'archived' ? 'Archived' :
                        activeFilter === 'trash' ? 'Trash' :
                        activeFilter === 'favorites' ? 'Favorites' : 'All Notes'}
                    </h1>
                    <ChevronDown size={20} className="text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors mt-0.5" />
                </button>
                
                <div className="flex items-center gap-1">
                    <button 
                        onClick={() => setViewMode(prev => prev === 'list' ? 'calendar' : 'list')}
                        className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                    >
                        {viewMode === 'list' ? <CalendarIcon size={20} strokeWidth={1.5} /> : <ListIcon size={20} strokeWidth={1.5} />}
                    </button>
                    
                    <button 
                        onClick={onGlobalChat}
                        className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                    >
                        <motion.div
                            animate={{ 
                                filter: [
                                    'drop-shadow(0px 0px 0px rgba(34, 197, 94, 0))', 
                                    'drop-shadow(0px 0px 6px rgba(34, 197, 94, 0.6))', 
                                    'drop-shadow(0px 0px 0px rgba(34, 197, 94, 0))'
                                ],
                                color: [
                                    '#71717a', // Zinc 500
                                    '#22c55e', // Green 500
                                    '#71717a'  // Zinc 500
                                ]
                            }}
                            transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                            className="text-current"
                        >
                            <Sparkles size={20} strokeWidth={1.5} />
                        </motion.div>
                    </button>
                </div>
            </div>
        ) : (
             <div className="flex items-center gap-4">
                 <button 
                    onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}
                    className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full text-zinc-500 dark:text-zinc-400 transition-colors"
                  >
                      <ChevronLeft size={24} strokeWidth={1.5} />
                  </button>
                  <h1 className="text-xl font-semibold text-zinc-900 dark:text-white tracking-tight min-w-[140px] text-center">
                      {format(currentMonth, 'MMMM yyyy')}
                  </h1>
                  <button 
                    onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}
                    className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full text-zinc-500 dark:text-zinc-400 transition-colors"
                  >
                      <ChevronRight size={24} strokeWidth={1.5} />
                  </button>
             </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'list' ? (
             <div className="px-6 pb-24">
                {filteredData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center mt-12 text-center">
                    <p className="text-zinc-900 dark:text-white font-medium mb-2">No items found</p>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm max-w-[200px]">
                      {activeFilter === 'trash' ? 'Trash is empty.' : 
                       activeFilter === 'archived' ? 'No archived folders.' :
                       'Try changing the filter or add new content.'}
                    </p>
                    {activeFilter !== 'all' && (
                        <button 
                            onClick={() => setActiveFilter('all')}
                            className="mt-4 text-blue-600 dark:text-blue-400 text-sm font-medium hover:underline"
                        >
                            Back to all folders
                        </button>
                    )}
                  </div>
                ) : (
                    isFolderView ? (
                         <div className="flex flex-col">
                            {(filteredData as DailyFolder[]).map((folder, index) => {
                                // Month Divider Logic
                                const showMonthDivider = index > 0 && !isSameMonth(folder.date, (filteredData as DailyFolder[])[index - 1].date);
                                
                                return (
                                  <div key={folder.id} className="flex flex-col">
                                    {showMonthDivider && (
                                        <div className="py-6 flex items-center">
                                            <div className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                                                {format(folder.date, 'MMMM yyyy')}
                                            </div>
                                            <div className="h-[1px] flex-1 bg-zinc-100 dark:bg-zinc-800 ml-4" />
                                        </div>
                                    )}
                                    <FolderRow
                                        folder={folder}
                                        onClick={() => onFolderClick(folder.id)}
                                    />
                                  </div>
                                );
                            })}
                         </div>
                    ) : (
                        <div className="flex flex-col">
                            {(filteredData as any[]).map((note) => (
                                <NoteRow 
                                    key={note.id}
                                    note={note}
                                    folderDate={note.folderDate}
                                    onClick={() => onNoteClick(note.folderId, note.id)}
                                />
                            ))}
                        </div>
                    )
                )}
             </div>
        ) : (
            <div className="flex flex-col min-h-full bg-white dark:bg-black">
                {/* Clean Month Summary - No cards, just clean text stats */}
                <div className="px-6 py-6 grid grid-cols-3 gap-0 border-b border-zinc-50 dark:border-zinc-900 text-center">
                     <div className="flex flex-col items-center">
                         <span className="text-3xl font-light text-zinc-900 dark:text-white">{monthNotesCount}</span>
                         <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-semibold mt-1">Notes</span>
                     </div>
                     <div className="flex flex-col items-center border-l border-zinc-100 dark:border-zinc-800">
                         <span className="text-3xl font-light text-zinc-900 dark:text-white">{monthAudioCount}</span>
                         <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-semibold mt-1">Recordings</span>
                     </div>
                     <div className="flex flex-col items-center border-l border-zinc-100 dark:border-zinc-800">
                         <span className="text-3xl font-light text-zinc-900 dark:text-white">{monthTranscribedMinutes}m</span>
                         <span className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-wider font-semibold mt-1">Duration</span>
                     </div>
                </div>

                {/* Calendar Grid */}
                <div className="flex-1 px-4 py-4">
                     <div className="grid grid-cols-7 mb-4">
                          {weekDays.map(day => (
                              <div key={day} className="h-10 flex items-center justify-center text-xs font-semibold text-zinc-300 dark:text-zinc-600 uppercase tracking-widest">
                                  {day}
                              </div>
                          ))}
                      </div>

                      <div className="grid grid-cols-7 gap-1 auto-rows-[minmax(80px,1fr)]">
                          {calendarDays.map((day) => {
                              const matchingFolder = folders.find(f => 
                                isSameDay(f.date, day) && !f.isTrashed && !f.isArchived
                              );
                              const isDisabled = !matchingFolder;
                              const isCurrentMonth = isSameMonth(day, currentMonth);
                              const isDayToday = isToday(day);
                              
                              const dayNoteCount = matchingFolder?.notes.length || 0;
                              const dayAudioCount = matchingFolder?.audio.length || 0;

                              return (
                                  <button
                                      key={day.toString()}
                                      onClick={() => matchingFolder && onFolderClick(matchingFolder.id)}
                                      disabled={isDisabled}
                                      className={clsx(
                                          "flex flex-col items-center pt-2 rounded-xl transition-all relative min-h-[64px]",
                                          isDisabled 
                                              ? "cursor-default text-zinc-200 dark:text-zinc-800" 
                                              : "hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-900 dark:text-white",
                                          !isCurrentMonth && "opacity-25"
                                      )}
                                  >
                                      <span className={clsx(
                                          "text-sm font-medium w-8 h-8 flex items-center justify-center rounded-full mb-1",
                                          isDayToday ? "bg-blue-600 text-white font-semibold shadow-sm" : ""
                                      )}>
                                          {format(day, 'd')}
                                      </span>
                                      
                                      {!isDisabled && (
                                          <div className="flex items-center gap-1 mt-0.5">
                                              {dayAudioCount > 0 && (
                                                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-sm" />
                                              )}
                                              {dayNoteCount > 0 && (
                                                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                                              )}
                                          </div>
                                      )}
                                  </button>
                              );
                          })}
                      </div>

                      {/* Legend */}
                      <div className="mt-8 flex items-center justify-center gap-6">
                           <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-red-500 shadow-sm" />
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Recording</span>
                           </div>
                           <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                                <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Note</span>
                           </div>
                      </div>
                </div>
            </div>
        )}
      </div>

      {/* Filter Bottom Sheet */}
      <Drawer.Root open={isFilterOpen} onOpenChange={setIsFilterOpen}>
        <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/40 z-50" />
            <Drawer.Content className="bg-white dark:bg-zinc-900 flex flex-col rounded-t-2xl mt-24 fixed bottom-0 left-0 right-0 z-50 max-w-[480px] mx-auto outline-none">
                <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex justify-between items-center">
                    <Drawer.Title className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Filter & sort</Drawer.Title>
                    <Drawer.Description className="sr-only">Filter and sort your notes</Drawer.Description>
                    <button onClick={() => setIsFilterOpen(false)} className="p-1 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800">
                        <X size={20} className="text-zinc-400" />
                    </button>
                </div>
                
                <div className="p-4 space-y-6 overflow-y-auto max-h-[70vh]">
                    <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400 text-sm px-2">
                        <span>Date created</span>
                        <ChevronDown size={14} />
                    </div>

                    <div className="space-y-1">
                        <FilterOption id="all" label="All files" icon={FolderOpen} count={activeFolders.length} />
                        <FilterOption id="archived" label="Archived" icon={Archive} count={archivedFolders.length} />
                        <FilterOption id="trash" label="Trash" icon={Trash2} count={trashedFolders.length} />
                    </div>

                    <div>
                        <div className="flex items-center justify-between px-2 mb-2">
                            <span className="text-zinc-900 dark:text-zinc-100 font-medium">Views</span>
                        </div>
                        <div className="space-y-1">
                             <FilterOption id="all_notes" label="All Notes" icon={Layers} count={noteCount} />
                             <FilterOption id="favorites" label="Favorites" icon={Star} count={pinnedCount} />
                        </div>
                    </div>
                </div>
                <div className="h-6" /> 
            </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
};
