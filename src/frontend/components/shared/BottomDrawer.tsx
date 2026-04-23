/**
 * BottomDrawer - Universal bottom sheet component
 *
 * Renders children inside a vaul drawer with:
 * - Blurred backdrop overlay
 * - Rounded top corners with drag handle
 * - Smooth open/close animation
 * - Matches warm stone design system
 */

import { Drawer } from "vaul";
import type { ReactNode } from "react";

interface BottomDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Optional snap points for drawer height */
  snapPoints?: (string | number)[];
}

export function BottomDrawer({
  isOpen,
  onClose,
  children,
  snapPoints,
}: BottomDrawerProps) {
  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      snapPoints={snapPoints}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-[6px] z-50" />
        <Drawer.Content className="flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-50 bg-[#FAFAF9] outline-none">
          {/* Drag handle */}
          <div className="flex items-center justify-center pt-2.5 pb-2">
            <div className="w-9 h-1 rounded-sm bg-[#D6D3D1] shrink-0" />
          </div>

          {/* Accessibility */}
          <Drawer.Title className="sr-only">Menu</Drawer.Title>
          <Drawer.Description className="sr-only">Drawer menu</Drawer.Description>

          {/* Content */}
          <div className="px-6 pt-4 pb-8 ">
            {children}
          </div>

          {/* Safe area for home indicator */}
          <div className="h-safe-area-bottom" />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
