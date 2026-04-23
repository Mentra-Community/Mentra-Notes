import { toast as sonnerToast } from "sonner";

export const toast = {
  success: (message: string) => sonnerToast.success(message, { duration: 3000 }),
  error: (message: string) => sonnerToast.error(message, { duration: 5000 }),
};
