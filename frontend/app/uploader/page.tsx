"use client";

import Link from "next/link";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle, UploadSimple, WarningCircle } from "@phosphor-icons/react";

import { completeUpload, getMe, initUpload, uploadFile } from "@/lib/api";
import { useFeedback } from "@/components/ui/feedback-center";
import { pushUserAction } from "@/lib/userActions";

type UploadState = "idle" | "submitting" | "success" | "error";

const NO_PATTERN = /^[0-9A-Za-z./-]+$/;

export default function UploaderPage() {
  const feedbackUi = useFeedback();
  const noInputRef = useRef<HTMLInputElement | null>(null);
  const [country, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [no, setNo] = useState("99");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const [lastSubmissionId, setLastSubmissionId] = useState<number | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    getMe()
      .then((me) => {
        setCountry(me.country ?? "");
        setCity(me.city ?? "");
        setRegion(me.region ?? "");
      })
      .catch(() => {
        setCountry("");
        setCity("");
        setRegion("");
      });
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => noInputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!toast) return;
    feedbackUi.notify({
      tone: "success",
      title: "Yükleme Başarılı",
      description: toast,
    });
  }, [feedbackUi, toast]);

  useEffect(() => {
    if (!message || uploadState !== "error") return;
    feedbackUi.notify({
      tone: "error",
      title: "Yükleme Hatası",
      description: message,
    });
  }, [feedbackUi, message, uploadState]);

  useEffect(() => {
    if (!file) {
      setDurationSeconds(null);
      return;
    }

    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    video.preload = "metadata";
    video.src = objectUrl;

    const onLoadedMetadata = () => {
      setDurationSeconds(Number.isFinite(video.duration) ? Math.round(video.duration) : null);
      URL.revokeObjectURL(objectUrl);
    };

    const onError = () => {
      setDurationSeconds(null);
      URL.revokeObjectURL(objectUrl);
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const isFormReady = useMemo(() => Boolean(no.trim() && file), [file, no]);
  const isDurationValid = durationSeconds === null || (durationSeconds >= 10 && durationSeconds <= 180);
  const isNoValid = no.trim().length > 0 && NO_PATTERN.test(no.trim());
  const hasProfileRegion = Boolean(country.trim() && city.trim() && region.trim());
  const canSubmit = uploadState !== "submitting" && isFormReady && isNoValid && isDurationValid && hasProfileRegion;

  const submitBlockReason = useMemo(() => {
    if (uploadState === "submitting") return null;
    if (!hasProfileRegion) return "Hesap bölge bilgisi eksik";
    if (!no.trim()) return "NO alanı zorunlu";
    if (!isNoValid) return "NO formatı geçersiz";
    if (!file) return "Video seçilmedi";
    if (!isDurationValid) return "Video süresi 10 sn - 3 dk aralığında olmalı";
    return null;
  }, [uploadState, hasProfileRegion, no, isNoValid, file, isDurationValid]);

  const errorSuggestion = useMemo(() => {
    if (uploadState !== "error") return null;
    const m = message.toLocaleLowerCase("tr-TR");
    if (m.includes("mp4")) return "Çözüm: Dosya türünü MP4 seçip tekrar deneyin.";
    if (m.includes("10 saniye") || m.includes("1-3 dakika")) return "Çözüm: Videoyu 10-180 saniye aralığına getirip yeniden yükleyin.";
    if (m.includes("no")) return "Çözüm: NO alanında sadece harf/rakam/nokta/tire veya / kullanın.";
    if (m.includes("oturum") || m.includes("401")) return "Çözüm: Oturumu yenileyip tekrar giriş yapın.";
    return "Çözüm: Alanları kontrol edip tekrar deneyin. Sorun sürerse yönetime bildirin.";
  }, [message, uploadState]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage("");

    if (!file) {
      setUploadState("error");
      setMessage("MP4 video seçmelisiniz.");
      return;
    }

    if (!country.trim() || !city.trim() || !region.trim()) {
      setUploadState("error");
      setMessage("Hesap bölge bilgisi eksik. Süper admin ile iletişime geçin.");
      return;
    }

    if (!isNoValid) {
      setUploadState("error");
      setMessage("NO alanı yalnızca harf, rakam, nokta, tire veya / içerebilir.");
      return;
    }

    if (!isDurationValid) {
      setUploadState("error");
      setMessage("Video süresi 10 saniye - 3 dakika aralığında olmalı.");
      return;
    }

    setUploadState("submitting");

    try {
      const init = await initUpload({
        country,
        city,
        region,
        no,
        original_filename: file.name,
        title: title || undefined,
        note: note || undefined,
      });

      await uploadFile(init.submission_id, file);
      await completeUpload(init.submission_id);
      setUploadState("success");
      setLastSubmissionId(init.submission_id);
      setFile(null);
      setDurationSeconds(null);
      setTitle("");
      setNote("");
      setNo("");
      setMessage("");
      setToast(`Kayıt #${init.submission_id} kuyruğa alındı. Yeni kayıt için hazır.`);
      setUploadState("idle");
      requestAnimationFrame(() => noInputRef.current?.focus());
      pushUserAction({
        type: "upload_success",
        label: `Kayıt #${init.submission_id} yüklendi`,
        href: "/uploader/logs",
      });
    } catch (err) {
      setUploadState("error");
      setMessage(err instanceof Error ? err.message : "Yükleme sırasında hata oluştu.");
    }
  };

  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <section className="mx-auto w-full max-w-[860px] space-y-4 px-3 py-4 pb-28 md:px-0 md:pb-6">
        {toast && (
          <div className="fixed left-1/2 top-3 z-30 w-[calc(100%-24px)] max-w-[520px] -translate-x-1/2 rounded-[10px] border border-[#BFD9C2] bg-[#EDF3EC] px-3 py-2 text-[14px] font-medium text-[#2E5E33] shadow-sm">
            {toast}
          </div>
        )}

        <header className="rounded-[12px] border border-[#EAEAEA] bg-white p-4 md:p-5">
          <h1 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold tracking-[-0.02em] text-[#111111]">Hızlı Video Yükleme</h1>
          <p className="mt-1 text-[15px] text-[#5D6164]">Akış: NO gir, video seç, gönder.</p>

          <div className="mt-4 flex items-center gap-0">
            {[
              { n: "01", label: "NO Gir", done: no.trim().length > 0 && isNoValid },
              { n: "02", label: "Video Seç", done: !!file && isDurationValid },
              { n: "03", label: "Gönder", done: uploadState === "success" },
            ].map((step, i) => (
              <div key={step.n} className="flex items-center">
                <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${step.done ? "bg-[#E8F5E9] text-[#2E7D32]" : "bg-[#F3F3F1] text-[#787774]"}`}>
                  {step.done ? <CheckCircle size={13} weight="fill" /> : <span className="font-mono">{step.n}</span>}
                  {step.label}
                </div>
                {i < 2 && <div className="mx-1 h-px w-5 bg-[#E0E0DE]" />}
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-[8px] border border-[#EAEAEA] bg-[#F9F9F8] p-3">
            <p className="text-[12px] uppercase tracking-[0.08em] text-[#787774]">Atanmış Lokasyon (Salt Okunur)</p>
            <p className="mt-1 text-[15px] text-[#2F3437]">
              Ülke: <strong>{country || "-"}</strong> · Şehir: <strong>{city || "-"}</strong> · Bölge: <strong>{region || "-"}</strong>
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
            <span className="rounded-full border border-[#E5E7E4] bg-[#F8F9F7] px-2.5 py-1 text-[#4B4F52]">Zorunlu: NO</span>
            <span className="rounded-full border border-[#E5E7E4] bg-[#F8F9F7] px-2.5 py-1 text-[#4B4F52]">Zorunlu: MP4 video</span>
            <span className="rounded-full border border-[#E5E7E4] bg-[#F8F9F7] px-2.5 py-1 text-[#4B4F52]">Süre: 10 sn - 3 dk</span>
          </div>
        </header>

        <section className="rounded-[12px] border border-[#EAEAEA] bg-white p-4 md:p-5">
          <form id="uploader-form" className="grid gap-4" onSubmit={onSubmit} noValidate>
            {!hasProfileRegion && (
              <p className="inline-flex items-center gap-1 rounded-[8px] border border-[#FDEBEC] bg-[#FDEBEC] px-3 py-2 text-[15px] text-[#9F2F2D]">
                <WarningCircle size={15} /> Hesap bölge bilgisi eksik. Süper admin ile iletişime geçin.
              </p>
            )}

            <section className="rounded-[10px] border border-[#ECEDEA] bg-[#FBFCFB] p-3">
              <SectionHeading index="01" title="Kayıt Anahtarı (NO)" help="Bu alan zorunludur." />
              <Input value={no} onChange={setNo} inputRef={noInputRef} />
            </section>
            {no.trim().length > 0 && !isNoValid && (
              <p className="inline-flex items-center gap-1 rounded-[8px] border border-[#FDEBEC] bg-[#FDEBEC] px-3 py-2 text-[15px] text-[#9F2F2D]">
                <WarningCircle size={15} /> NO formatı geçersiz.
              </p>
            )}

            <section className="rounded-[10px] border border-[#ECEDEA] bg-[#FBFCFB] p-3">
              <SectionHeading index="02" title="Video Seçimi" help="MP4 formatı, 10 saniye - 3 dakika." />
              <div
                onDragOver={(e: DragEvent) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  setDragOver(false);
                  const dropped = e.dataTransfer.files[0];
                  if (dropped?.type === "video/mp4") setFile(dropped);
                }}
                className={`mt-2 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed py-6 text-center transition-colors ${dragOver ? "border-[#2E7D32] bg-[#F0F9F1]" : "border-[#DCDCDA] bg-white hover:border-[#BCBCBA] hover:bg-[#FAFAF8]"}`}
                onClick={() => document.getElementById("file-input")?.click()}
              >
                <UploadSimple size={24} className={dragOver ? "text-[#2E7D32]" : "text-[#ACACAA]"} />
                <p className="text-[14px] font-medium text-[#5D6164]">
                  {file ? file.name : "MP4 sürükle veya tıkla"}
                </p>
                {file && (
                  <p className="text-[13px] text-[#7A7E81]">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB · {durationSeconds ? `${durationSeconds} sn` : "süre hesaplanıyor"}
                  </p>
                )}
              </div>
              <input
                id="file-input"
                type="file"
                accept="video/mp4"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </section>

            <details className="rounded-[10px] border border-[#ECEDEA] bg-[#FBFCFB] p-3">
              <summary className="cursor-pointer text-[15px] font-semibold text-[#2F3437]">Opsiyonel alanlar (başlık / not)</summary>
              <div className="mt-3 grid gap-3">
                <Field label="Başlık" help="Opsiyonel.">
                  <Input value={title} onChange={setTitle} placeholder="Örn: Çad 1. Bölge - Grup 99" />
                </Field>
                <Field label="Not" help="Opsiyonel.">
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    className="w-full rounded-[8px] border border-[#EAEAEA] bg-white px-3 py-2 text-[15px] outline-none focus:border-[#D0D0CF]"
                  />
                </Field>
              </div>
            </details>

            {!isDurationValid && (
              <p className="inline-flex items-center gap-1 rounded-[8px] border border-[#FDEBEC] bg-[#FDEBEC] px-3 py-2 text-[15px] text-[#9F2F2D]">
                <WarningCircle size={15} /> Video süresi 10 saniye - 3 dakika aralığında olmalı.
              </p>
            )}
          </form>

          {message && (
            <div
              className={`mt-4 rounded-[8px] border px-3 py-2 text-[15px] ${
                uploadState === "error" ? "border-[#FDEBEC] bg-[#FDEBEC] text-[#9F2F2D]" : "border-[#EDF3EC] bg-[#EDF3EC] text-[#346538]"
              }`}
            >
              {message}
              {uploadState === "success" && (
                <>
                  <p className="mt-2 text-[15px] text-[#346538]">
                    Yeni kayıt için yalnızca <strong>NO</strong> ve <strong>video</strong> seçmeniz yeterli.
                    {lastSubmissionId ? ` Son başarılı kayıt: #${lastSubmissionId}.` : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setUploadState("idle");
                        setMessage("");
                        requestAnimationFrame(() => noInputRef.current?.focus());
                      }}
                      className="inline-flex items-center rounded-[6px] border border-[#BFD9C2] bg-white px-2.5 py-1.5 text-[16px] font-medium text-[#2E5E33]"
                    >
                      Yeni kayıt aç
                    </button>
                    {lastSubmissionId && (
                      <Link
                        href="/uploader/logs"
                        className="inline-flex items-center rounded-[6px] border border-[#BFD9C2] bg-white px-2.5 py-1.5 text-[16px] font-medium text-[#2E5E33]"
                      >
                        Loglarda görüntüle
                      </Link>
                    )}
                  </div>
                </>
              )}
              {errorSuggestion && <p className="mt-2 text-[15px] font-medium text-[#9F2F2D]">{errorSuggestion}</p>}
            </div>
          )}
        </section>

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#E5E7E4] bg-white/95 p-3 backdrop-blur md:static md:rounded-[12px] md:border md:bg-white md:p-4">
          <div className="mx-auto w-full max-w-[860px]">
            <button
              form="uploader-form"
              className="inline-flex h-12 w-full items-center justify-center rounded-[8px] bg-[#111111] px-4 text-[16px] font-semibold text-white hover:bg-[#333333] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
              type="submit"
              disabled={!canSubmit}
            >
              {uploadState === "submitting" ? "Yükleniyor..." : "Gönder ve Kuyruğa Al"}
            </button>
            {!canSubmit && submitBlockReason && (
              <p className="mt-2 text-center text-[12px] font-medium text-[#E57373]">Neden gönderilemez: {submitBlockReason}</p>
            )}
            {canSubmit && (
              <p className="mt-2 text-center text-[13px] text-[#6B7073]">Gönderince kayıt otomatik inceleme kuyruğuna düşer.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionHeading({
  index,
  title,
  help,
}: {
  index: string;
  title: string;
  help: string;
}) {
  return (
    <div>
      <p className="text-[13px] uppercase tracking-[0.08em] text-[#7A7E81]">Adım {index}</p>
      <p className="mt-1 text-[16px] font-semibold text-[#111111]">{title}</p>
      <p className="text-[14px] text-[#6B7073]">{help}</p>
    </div>
  );
}

function Field({ label, help, className, children }: { label: string; help: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-[15px] font-medium text-[#2F3437]">{label}</label>
      {children}
      <p className="mt-1 text-[14px] text-[#6B7073]">{help}</p>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder = "",
  disabled = false,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="h-12 w-full rounded-[8px] border border-[#EAEAEA] bg-white px-3 text-[15px] outline-none focus:border-[#D0D0CF] disabled:opacity-70"
    />
  );
}
