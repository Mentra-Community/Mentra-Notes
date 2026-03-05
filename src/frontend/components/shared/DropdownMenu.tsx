/**
 * DropdownMenu - Reusable dropdown menu component
 *
 * A dynamic dropdown menu that can be used throughout the app.
 * Supports icons, labels, descriptions, dividers, and danger states.
 */

import { useState, useRef, useEffect, type ReactNode } from "react";
import { clsx } from "clsx";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

export interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  description?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface DropdownMenuDivider {
  type: "divider";
}

export type DropdownMenuOption = DropdownMenuItem | DropdownMenuDivider;

interface DropdownMenuProps {
  options: DropdownMenuOption[];
  /** Custom trigger element. If not provided, uses a MoreHorizontal icon button */
  trigger?: ReactNode;
  /** Alignment of the dropdown relative to trigger */
  align?: "left" | "right";
  /** Size of the default trigger icon */
  iconSize?: number;
  /** Additional class names for the trigger button */
  triggerClassName?: string;
}

function isDivider(option: DropdownMenuOption): option is DropdownMenuDivider {
  return "type" in option && option.type === "divider";
}

export function DropdownMenu({
  options,
  trigger,
  align = "right",
  iconSize = 20,
  triggerClassName,
}: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const handleOptionClick = (option: DropdownMenuItem) => {
    if (option.disabled) return;
    option.onClick();
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger */}
      {trigger ? (
        <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
      ) : (
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={clsx(
            "p-2 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors",
            triggerClassName,
          )}
        >
          <MoreHorizontal size={iconSize} />
        </button>
      )}

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={menuRef}
          className={clsx(
            "absolute top-full mt-1 z-50 min-w-[240px] py-1",
            "bg-white dark:bg-zinc-900 rounded-xl shadow-lg",
            "border border-zinc-200 dark:border-zinc-800",
            "animate-in fade-in-0 zoom-in-95 duration-100",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {options.map((option, index) => {
            if (isDivider(option)) {
              return (
                <div
                  key={`divider-${index}`}
                  className="my-1 border-t border-zinc-200 dark:border-zinc-800"
                />
              );
            }

            const Icon = option.icon;

            return (
              <button
                key={option.id}
                onClick={() => handleOptionClick(option)}
                disabled={option.disabled}
                className={clsx(
                  "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
                  option.disabled
                    ? "opacity-50 cursor-not-allowed"
                    : option.danger
                      ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                      : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                )}
              >
                {Icon && (
                  <Icon
                    size={18}
                    className={clsx(
                      option.danger
                        ? "text-red-500"
                        : "text-zinc-400 dark:text-zinc-500",
                    )}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-medium">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {option.description}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
