/**
 * SelectionHeader — Replaces page header during multi-select mode
 *
 * Shows Cancel (red) | {n} selected (bold center) | Select All (right)
 * Matches the warm stone design system.
 */

interface SelectionHeaderProps {
  count: number;
  onCancel: () => void;
  onSelectAll: () => void;
}

export function SelectionHeader({ count, onCancel, onSelectAll }: SelectionHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 pt-2 pb-4 pr-30">
      <button onClick={onCancel} className="text-[16px] leading-5 text-[#DC2626] font-red-hat font-bold">
        Cancel
      </button>
      <span className="text-[10px] leading-5 text-[#949494] font-red-hat font-bold">
        {count} selected
      </span>
      <button onClick={onSelectAll} className="text-[16px] leading-5 text-[#1C1917] font-red-hat font-semibold">
        Select All
      </button>
    </div>
  );
}
