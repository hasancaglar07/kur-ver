"use client";

import { CheckCircle, Info, Warning, WarningCircle, X } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ToastTone = "info" | "success" | "warn" | "error";

type NotifyInput = {
  title?: string;
  description: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ConfirmInput = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ToastTone;
};

type PromptInput = {
  title: string;
  description?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  minLength?: number;
  initialValue?: string;
};

type FeedbackContextValue = {
  notify: (input: NotifyInput) => void;
  confirm: (input: ConfirmInput) => Promise<boolean>;
  prompt: (input: PromptInput) => Promise<string | null>;
};

type ToastItem = NotifyInput & {
  id: number;
  tone: ToastTone;
  durationMs: number;
};

type ConfirmState = ConfirmInput & {
  open: boolean;
  resolve: (value: boolean) => void;
};

type PromptState = PromptInput & {
  open: boolean;
  resolve: (value: string | null) => void;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const toneStyles: Record<ToastTone, { card: string; icon: string; button: string }> = {
  info: {
    card: "border-[#CFE0F2] bg-[#F4F9FF] text-[#1F4F7E]",
    icon: "text-[#2D72B8]",
    button: "text-[#2D72B8]",
  },
  success: {
    card: "border-[#CFE6D2] bg-[#F2FCF4] text-[#245E2B]",
    icon: "text-[#2E8B3D]",
    button: "text-[#2E8B3D]",
  },
  warn: {
    card: "border-[#F1DEB2] bg-[#FFF9EB] text-[#795300]",
    icon: "text-[#A77900]",
    button: "text-[#A77900]",
  },
  error: {
    card: "border-[#EFCFD3] bg-[#FFF4F5] text-[#7A1F2A]",
    icon: "text-[#B03144]",
    button: "text-[#B03144]",
  },
};

function ToneIcon({ tone }: { tone: ToastTone }) {
  if (tone === "success") return <CheckCircle size={18} weight="fill" />;
  if (tone === "warn") return <Warning size={18} weight="fill" />;
  if (tone === "error") return <WarningCircle size={18} weight="fill" />;
  return <Info size={18} weight="fill" />;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [mounted, setMounted] = useState(false);
  const idRef = useRef(1);

  useEffect(() => {
    setMounted(true);
  }, []);

  const closeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback((input: NotifyInput) => {
    const next: ToastItem = {
      id: idRef.current++,
      tone: input.tone ?? "info",
      durationMs: input.durationMs ?? 3200,
      title: input.title,
      description: input.description,
    };
    setToasts((prev) => [next, ...prev].slice(0, 4));
  }, []);

  const confirm = useCallback((input: ConfirmInput) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState((prev) => {
        prev?.resolve(false);
        return { ...input, open: true, resolve };
      });
    });
  }, []);

  const prompt = useCallback((input: PromptInput) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(input.initialValue ?? "");
      setPromptState((prev) => {
        prev?.resolve(null);
        return { ...input, open: true, resolve };
      });
    });
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) => window.setTimeout(() => closeToast(toast.id), toast.durationMs));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [closeToast, toasts]);

  const value = useMemo<FeedbackContextValue>(() => ({ notify, confirm, prompt }), [confirm, notify, prompt]);

  const promptMinLength = promptState?.minLength ?? 0;
  const promptCanSubmit = promptValue.trim().length >= promptMinLength;

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <>
            <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] mx-auto mt-3 w-full max-w-[640px] space-y-2 px-3 sm:right-3 sm:left-auto sm:mx-0 sm:mt-4 sm:max-w-[420px] sm:px-0">
              {toasts.map((toast) => {
                const style = toneStyles[toast.tone];
                return (
                  <article
                    key={toast.id}
                    className={`pointer-events-auto rounded-[14px] border px-3 py-3 shadow-[0_18px_40px_rgba(17,17,17,0.14)] backdrop-blur-sm ${style.card}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`${style.icon} mt-0.5`}>
                        <ToneIcon tone={toast.tone} />
                      </span>
                      <div className="min-w-0 flex-1">
                        {toast.title ? <p className="text-[14px] font-semibold leading-5">{toast.title}</p> : null}
                        <p className="text-[14px] leading-5">{toast.description}</p>
                      </div>
                      <button type="button" onClick={() => closeToast(toast.id)} className={`rounded p-1 ${style.button}`} aria-label="Kapat">
                        <X size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>

            {confirmState?.open ? (
              <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 px-3">
                <div className="w-full max-w-[520px] rounded-[16px] border border-[#E6E8E5] bg-white p-5 shadow-[0_24px_56px_rgba(17,17,17,0.22)]">
                  <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-[#111111]">{confirmState.title}</h3>
                  {confirmState.description ? <p className="mt-2 text-[15px] leading-relaxed text-[#4B4F52]">{confirmState.description}</p> : null}
                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        confirmState.resolve(false);
                        setConfirmState(null);
                      }}
                      className="h-10 rounded-[8px] border border-[#EAEAEA] bg-white px-3 text-[15px] font-medium text-[#2F3437]"
                    >
                      {confirmState.cancelText ?? "İptal"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        confirmState.resolve(true);
                        setConfirmState(null);
                      }}
                      className="h-10 rounded-[8px] bg-[#111111] px-3 text-[15px] font-medium text-white"
                    >
                      {confirmState.confirmText ?? "Onayla"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {promptState?.open ? (
              <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40 px-3">
                <div className="w-full max-w-[560px] rounded-[16px] border border-[#E6E8E5] bg-white p-5 shadow-[0_24px_56px_rgba(17,17,17,0.22)]">
                  <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-[#111111]">{promptState.title}</h3>
                  {promptState.description ? <p className="mt-2 text-[15px] leading-relaxed text-[#4B4F52]">{promptState.description}</p> : null}
                  <input
                    autoFocus
                    value={promptValue}
                    onChange={(event) => setPromptValue(event.target.value)}
                    placeholder={promptState.placeholder ?? "Not girin"}
                    className="mt-4 h-11 w-full rounded-[10px] border border-[#EAEAEA] bg-[#FAFBF9] px-3 text-[15px] outline-none focus:border-[#D0D0CF]"
                  />
                  {promptMinLength > 0 && !promptCanSubmit ? (
                    <p className="mt-2 text-[13px] text-[#8E2F33]">En az {promptMinLength} karakter girin.</p>
                  ) : null}
                  <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        promptState.resolve(null);
                        setPromptState(null);
                        setPromptValue("");
                      }}
                      className="h-10 rounded-[8px] border border-[#EAEAEA] bg-white px-3 text-[15px] font-medium text-[#2F3437]"
                    >
                      {promptState.cancelText ?? "İptal"}
                    </button>
                    <button
                      type="button"
                      disabled={!promptCanSubmit}
                      onClick={() => {
                        promptState.resolve(promptValue.trim());
                        setPromptState(null);
                        setPromptValue("");
                      }}
                      className="h-10 rounded-[8px] bg-[#111111] px-3 text-[15px] font-medium text-white disabled:opacity-50"
                    >
                      {promptState.confirmText ?? "Kaydet"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>,
          document.body
        )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) {
    throw new Error("useFeedback must be used within FeedbackProvider");
  }
  return context;
}

