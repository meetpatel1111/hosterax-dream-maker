import React, { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Info, HelpCircle } from "lucide-react";
import { appLogger } from "@/utils/app-logger";

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default" | "warning";
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

let globalConfirmFn: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

/**
 * Programmatic confirmation helper callable anywhere in client components.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (globalConfirmFn) {
    return globalConfirmFn(options);
  }
  // Fallback if provider is not mounted
  return Promise.resolve(true);
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({
    title: "",
    description: "",
    confirmLabel: "Confirm",
    cancelLabel: "Cancel",
    variant: "default",
  });
  const [resolver, setResolver] = useState<((val: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions({
      confirmLabel: opts.variant === "destructive" ? "Delete" : "Confirm",
      cancelLabel: "Cancel",
      variant: "default",
      ...opts,
    });
    setOpen(true);
    appLogger.logUi(
      `Dialog Open: ${opts.title}`,
      `Prompted user with confirmation popup: "${opts.title}"`,
      { variant: opts.variant || "default" },
    );

    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve);
    });
  }, []);

  globalConfirmFn = confirm;

  const handleConfirm = () => {
    setOpen(false);
    appLogger.logUi(
      `Dialog Confirm: ${options.title}`,
      `User confirmed dialog action: "${options.title}"`,
    );
    if (resolver) resolver(true);
  };

  const handleCancel = () => {
    setOpen(false);
    appLogger.logUi(
      `Dialog Cancel: ${options.title}`,
      `User dismissed dialog action: "${options.title}"`,
    );
    if (resolver) resolver(false);
  };

  const isDestructive = options.variant === "destructive";
  const isWarning = options.variant === "warning";

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {open && (
        <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
          <AlertDialogContent className="max-w-md border-border/80 bg-card p-6 shadow-2xl">
            <AlertDialogHeader className="space-y-3">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-full border ${
                    isDestructive
                      ? "bg-destructive/10 text-destructive border-destructive/20"
                      : isWarning
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        : "bg-primary/10 text-primary border-primary/20"
                  }`}
                >
                  {isDestructive ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : isWarning ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : (
                    <HelpCircle className="h-5 w-5" />
                  )}
                </div>
                <AlertDialogTitle className="text-base font-bold text-foreground">
                  {options.title}
                </AlertDialogTitle>
              </div>
              <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
                {options.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 pt-2">
              <AlertDialogCancel
                onClick={handleCancel}
                className="text-xs border-border/60 text-muted-foreground hover:bg-muted"
              >
                {options.cancelLabel || "Cancel"}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                className={`text-xs font-semibold ${
                  isDestructive
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : isWarning
                      ? "bg-amber-500 text-white hover:bg-amber-600"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {options.confirmLabel || "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    return { confirm: confirmAction };
  }
  return context;
}
