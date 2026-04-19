"use client";

import { useEffect, useMemo, useState } from "react";

import { createUploadCancelRequest, getMyUploadLogs } from "@/lib/api";
import { useFeedback } from "@/components/ui/feedback-center";
import type { OperatorLogsResponse, SubmissionStatus } from "@/lib/types";

const statusLabel: Record<SubmissionStatus, string> = {
  uploaded: "Yüklendi",
  processing: "İşleniyor",
  review_ready: "İncelemeye Hazır",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  failed: "Hata",
};

const adminActionLabel: Record<string, string> = {
  submission_reviewed: "İnceleme kararı",
  sms_dispatched: "Toplu SMS",
  sms_dispatched_single: "Tekli SMS",
  sms_dispatched_selected: "Seçili SMS",
  sms_retry_failed: "SMS retry",
  submission_change_request_resolved: "Talep çözümü",
  submission_risk_overridden: "Risk override",
};

export default function UploaderLogsPage() {
  const feedbackUi = useFeedback();
  const [data, setData] = useState<OperatorLogsResponse | null>(null);
  const [status, setStatus] = useState<"" | SubmissionStatus>("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await getMyUploadLogs({ limit: 80, status: status || undefined });
      setData(res);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Loglar alınamadı.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, [status]);

  useEffect(() => {
    if (!message) return;
    feedbackUi.notify({
      tone: message.includes("açıldı") ? "success" : "info",
      title: "Operatör Logları",
      description: message,
    });
  }, [feedbackUi, message]);

  const regionPairs = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.summary.by_region).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const onCreateRequest = async (submissionId: number, reason: "wrong_upload" | "duplicate_upload") => {
    const note = await feedbackUi.prompt({
      title: reason === "wrong_upload" ? "Yanlış Yükleme Talebi" : "Duble Yükleme Talebi",
      description: "Talep notu minimum 5 karakter olmalı.",
      minLength: 5,
      placeholder: "Talep nedeni",
      confirmText: "Talep Aç",
    });
    if (!note) {
      return;
    }
    try {
      await createUploadCancelRequest(submissionId, { reason_type: reason, note: note.trim() });
      setMessage(`Kayıt #${submissionId} için talep açıldı.`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Talep açılamadı.");
    }
  };

  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <section className="mx-auto w-full max-w-[1200px] space-y-4 py-4">
        <header className="rounded-[12px] border border-[#EAEAEA] bg-white p-4">
          <h1 className="text-[clamp(1.4rem,3vw,2rem)] font-semibold tracking-[-0.02em] text-[#111111]">Gönderim Loglarım</h1>
          <p className="mt-1 text-sm text-[#5D6164]">Gönderdiğiniz videoları, sürelerini ve durumlarını buradan takip edin.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | SubmissionStatus)}
              className="h-10 rounded-[8px] border border-[#EAEAEA] bg-white px-3 text-sm"
            >
              <option value="">Tüm durumlar</option>
              <option value="uploaded">Yüklendi</option>
              <option value="processing">İşleniyor</option>
              <option value="review_ready">İncelemeye Hazır</option>
              <option value="approved">Onaylandı</option>
              <option value="rejected">Reddedildi</option>
              <option value="failed">Hata</option>
            </select>
            <button
              type="button"
              onClick={() => load().catch(() => undefined)}
              className="h-10 rounded-[8px] border border-[#EAEAEA] bg-white px-3 text-sm font-medium text-[#2F3437]"
            >
              Yenile
            </button>
          </div>
        </header>

        {message && <div className="rounded-[8px] border border-[#EAEAEA] bg-[#F9F9F8] px-3 py-2 text-sm text-[#2F3437]">{message}</div>}

        {data && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric title="Toplam gönderim" value={String(data.summary.total_uploads)} />
            <Metric title="Ortalama süre" value={data.summary.avg_duration_seconds ? `${Math.round(data.summary.avg_duration_seconds)} sn` : "-"} />
            <Metric title="Onaylandı" value={String(data.summary.by_status.approved ?? 0)} />
            <Metric title="Hata" value={String(data.summary.by_status.failed ?? 0)} />
          </section>
        )}

        {regionPairs.length > 0 && (
          <section className="rounded-[12px] border border-[#EAEAEA] bg-white p-4">
            <h2 className="text-sm font-semibold text-[#111111]">Bölge dağılımı</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {regionPairs.map(([region, count]) => (
                <span key={region} className="rounded-full border border-[#EAEAEA] bg-[#F9F9F8] px-2.5 py-1 text-xs text-[#4B4F52]">
                  {region}: {count}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-[12px] border border-[#EAEAEA] bg-white p-4">
          <h2 className="text-sm font-semibold text-[#111111]">Kayıtlar</h2>
          {loading && <p className="mt-3 text-sm text-[#787774]">Yükleniyor...</p>}
          {!loading && data && data.items.length === 0 && <p className="mt-3 text-sm text-[#787774]">Kayıt bulunamadı.</p>}
          {!loading && data && data.items.length > 0 && (
            <div className="mt-3 space-y-2">
              {data.items.map((row) => {
                const requestOpen = row.latest_request_status === "open";
                return (
                  <article key={row.id} className="rounded-[10px] border border-[#EAEAEA] bg-[#FCFCFB] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[#111111]">#{row.id} · NO {row.no}</p>
                      <p className="text-xs text-[#6B7073]">
                        {row.country} / {row.city} / {row.region}
                      </p>
                    </div>
                    <span className="rounded-full border border-[#EAEAEA] bg-white px-2 py-0.5 text-xs text-[#4B4F52]">{statusLabel[row.status]}</span>
                  </div>
                  <div className="mt-2 text-xs text-[#5D6164]">
                    Süre: {row.duration_seconds ? `${Math.round(row.duration_seconds)} sn` : "-"} · Tarih: {new Date(row.created_at).toLocaleString("tr-TR")}
                  </div>
                  {row.failure_reason && (
                    <p className="mt-2 rounded-[6px] border border-[#F2D9DB] bg-[#FDF0F1] px-2 py-1 text-xs text-[#9D3438]">
                      {row.failure_reason === "upload_abandoned_timeout_30m"
                        ? "Yükleme 30 dakika içinde tamamlanmadığı için kayıt zaman aşımına düştü."
                        : `Hata nedeni: ${row.failure_reason}`}
                    </p>
                  )}
                  {row.risk_locked && (
                    <p className="mt-2 rounded-[6px] border border-[#F2D9DB] bg-[#FDF0F1] px-2 py-1 text-xs text-[#9D3438]">
                      Risk kilidi aktif{row.risk_codes.length ? ` (${row.risk_codes.join(", ")})` : ""}. {row.risk_lock_note ? `Not: ${row.risk_lock_note}` : ""}
                    </p>
                  )}
                  {row.latest_request_status && (
                    <div className="mt-1 rounded-[6px] border border-[#EAEAEA] bg-white px-2 py-1 text-xs text-[#5D6164]">
                      <p>
                        Son talep: <strong>{row.latest_request_reason_type ?? "-"}</strong> · Durum: <strong>{row.latest_request_status}</strong>
                      </p>
                      {row.latest_request_admin_note && <p>Admin notu: {row.latest_request_admin_note}</p>}
                      {row.latest_request_resolved_at && <p>Çözüm zamanı: {new Date(row.latest_request_resolved_at).toLocaleString("tr-TR")}</p>}
                    </div>
                  )}
                  {(row.last_admin_action || row.last_admin_actor_username) && (
                    <p className="mt-1 text-xs text-[#6B7073]">
                      Son admin işlemi: {row.last_admin_actor_username ?? "-"} ·{" "}
                      {row.last_admin_action ? adminActionLabel[row.last_admin_action] ?? row.last_admin_action : "-"}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onCreateRequest(row.id, "wrong_upload")}
                      disabled={requestOpen}
                      className="rounded-[6px] border border-[#EAEAEA] bg-white px-2.5 py-1 text-xs font-medium text-[#2F3437]"
                    >
                      Yanlış yükleme talebi
                    </button>
                    <button
                      type="button"
                      onClick={() => onCreateRequest(row.id, "duplicate_upload")}
                      disabled={requestOpen}
                      className="rounded-[6px] border border-[#EAEAEA] bg-white px-2.5 py-1 text-xs font-medium text-[#2F3437]"
                    >
                      Duble yükleme talebi
                    </button>
                  </div>
                  {requestOpen && <p className="mt-1 text-xs text-[#8B6700]">Bu kayıt için açık talep var; yeni talep açılamaz.</p>}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-[10px] border border-[#EAEAEA] bg-white p-3">
      <p className="text-xs uppercase tracking-[0.08em] text-[#787774]">{title}</p>
      <p className="mt-1 text-lg font-semibold text-[#111111]">{value}</p>
    </article>
  );
}
