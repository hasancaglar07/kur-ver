"use client";

import { useEffect, useState } from "react";

import { getMyAdminLogs } from "@/lib/api";
import { useFeedback } from "@/components/ui/feedback-center";
import type { AdminActionLogItem } from "@/lib/types";

const actionLabel: Record<string, string> = {
  submission_reviewed: "İnceleme kararı",
  sms_dispatched: "Toplu SMS",
  sms_dispatched_single: "Tekli SMS",
  sms_dispatched_selected: "Seçili SMS",
  sms_retry_failed: "SMS retry",
  submission_change_request_resolved: "Talep çözüm",
  submission_risk_overridden: "Risk override",
};

export default function AdminLogsPage() {
  const feedbackUi = useFeedback();
  const [items, setItems] = useState<AdminActionLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getMyAdminLogs({ limit: 200, action: action || undefined });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin logları alınamadı.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, [action]);

  useEffect(() => {
    if (!error) return;
    feedbackUi.notify({
      tone: "error",
      title: "Admin Log Hatası",
      description: error,
    });
  }, [error, feedbackUi]);

  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <section className="mx-auto w-full max-w-[1280px] space-y-4 py-4">
        <header className="rounded-[12px] border border-[#EAEAEA] bg-white p-5">
          <h1 className="text-[clamp(1.6rem,3.2vw,2.3rem)] font-semibold tracking-[-0.02em] text-[#111111]">Kendi Admin Loglarım</h1>
          <p className="mt-1 text-sm text-[#4B4F52]">Onay, red ve SMS aksiyonlarınız burada listelenir.</p>
          <div className="mt-3 flex items-center gap-2">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="h-10 rounded-[8px] border border-[#EAEAEA] bg-white px-3 text-sm"
            >
              <option value="">Tüm aksiyonlar</option>
              <option value="submission_reviewed">İnceleme kararı</option>
              <option value="sms_dispatched">Toplu SMS</option>
              <option value="sms_dispatched_single">Tekli SMS</option>
              <option value="sms_dispatched_selected">Seçili SMS</option>
              <option value="sms_retry_failed">SMS retry</option>
              <option value="submission_change_request_resolved">Talep çözüm</option>
              <option value="submission_risk_overridden">Risk override</option>
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

        {error && <div className="rounded-[8px] border border-[#F5D5D8] bg-[#FFF5F6] px-3 py-2 text-sm text-[#9F2F2D]">{error}</div>}

        <section className="rounded-[12px] border border-[#EAEAEA] bg-white p-4">
          {loading ? (
            <p className="text-sm text-[#787774]">Yükleniyor...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-[#787774]">Kayıt bulunamadı.</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <article key={item.id} className="rounded-[10px] border border-[#EAEAEA] bg-[#FCFCFB] p-3">
                  <p className="text-sm font-semibold text-[#111111]">{actionLabel[item.action] ?? item.action}</p>
                  <p className="mt-1 text-xs text-[#5D6164]">
                    {new Date(item.created_at).toLocaleString("tr-TR")}
                    {item.submission_id ? ` · Kayıt #${item.submission_id}` : ""}
                    {item.submission_no ? ` · NO ${item.submission_no}` : ""}
                    {item.submission_region ? ` · Bölge ${item.submission_region}` : ""}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
