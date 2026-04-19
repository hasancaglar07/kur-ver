"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { getOperatorAnalyticsDetail } from "@/lib/api";
import { useFeedback } from "@/components/ui/feedback-center";
import type { OperatorAnalyticsDetail } from "@/lib/types";

const statusLabels: Record<string, string> = {
  uploaded: "Yüklendi",
  processing: "İşleniyor",
  review_ready: "İncelemeye Hazır",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  failed: "Hata",
};

export default function OperatorAnalyticsDetailPage() {
  const feedbackUi = useFeedback();
  const params = useParams<{ id: string }>();
  const operatorId = Number(params.id);

  const [data, setData] = useState<OperatorAnalyticsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOperatorAnalyticsDetail(operatorId)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Yüklenemedi"));
  }, [operatorId]);

  useEffect(() => {
    if (!error) return;
    feedbackUi.notify({
      tone: "error",
      title: "Operatör Analitik Hatası",
      description: error,
    });
  }, [error, feedbackUi]);

  if (error) {
    return <main className="mx-auto w-full max-w-[1200px] rounded-[12px] border border-[#EAEAEA] bg-white p-6 text-sm text-[#9F2F2D]">{error}</main>;
  }

  if (!data) {
    return <main className="mx-auto w-full max-w-[1200px] rounded-[12px] border border-[#EAEAEA] bg-white p-6 text-sm text-[#787774]">Yükleniyor...</main>;
  }

  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <section className="mx-auto w-full max-w-[1200px] space-y-5 py-4">
        <header className="rounded-[12px] border border-[#EAEAEA] bg-white p-6">
          <p className="text-xs uppercase tracking-[0.12em] text-[#787774]"><Link href="/admin" className="underline">Admin</Link></p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-[#111111]">Operatör Analitik</h1>
          <p className="mt-1 text-sm text-[#4B4F52]">
            {data.full_name} ({data.username}) · {data.assigned_country ?? "-"} / {data.assigned_city ?? "-"} / {data.assigned_region ?? "-"}
          </p>
          <p className="mt-2 text-xs text-[#787774]">Son 14 günlük eğilim ve son kayıt detayları aşağıda listelenir.</p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric title="Upload" value={String(data.total_uploads)} />
          <Metric title="AI Başarı" value={`${data.ai_success_rate_percent}%`} />
          <Metric title="AI Hata" value={`${data.ai_failed_rate_percent}%`} />
          <Metric title="Ort. Kalite" value={data.avg_quality_score?.toString() ?? "-"} />
          <Metric title="Ort. Süre" value={data.avg_duration_seconds?.toString() ?? "-"} />
        </section>

        <section className="rounded-[12px] border border-[#EAEAEA] bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#787774]">14 Gün Trend</h2>
          <div className="mt-3 overflow-auto rounded-[8px] border border-[#EAEAEA]">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-[#F9F9F8] text-xs uppercase tracking-[0.08em] text-[#787774]">
                <tr><th className="px-3 py-2">Tarih</th><th className="px-3 py-2">Upload</th><th className="px-3 py-2">Ort. Kalite</th></tr>
              </thead>
              <tbody>
                {data.daily_metrics.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-sm text-[#787774]">
                      Trend verisi bulunamadı.
                    </td>
                  </tr>
                ) : (
                  data.daily_metrics.map((item) => (
                    <tr key={item.day} className="border-t border-[#EAEAEA]">
                      <td className="px-3 py-2">{item.day}</td>
                      <td className="px-3 py-2">{item.upload_count}</td>
                      <td className="px-3 py-2">{item.avg_quality_score ?? "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[12px] border border-[#EAEAEA] bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#787774]">Son Upload Kayıtları</h2>
          <div className="mt-3 overflow-auto rounded-[8px] border border-[#EAEAEA]">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-[#F9F9F8] text-xs uppercase tracking-[0.08em] text-[#787774]">
                <tr><th className="px-3 py-2">ID</th><th className="px-3 py-2">NO</th><th className="px-3 py-2">Başlık</th><th className="px-3 py-2">Durum</th><th className="px-3 py-2">Kalite</th><th className="px-3 py-2">Süre</th><th className="px-3 py-2">Tarih</th><th className="px-3 py-2">Detay</th></tr>
              </thead>
              <tbody>
                {data.recent_submissions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-[#787774]">
                      Son kayıt bulunamadı.
                    </td>
                  </tr>
                ) : (
                  data.recent_submissions.map((row) => (
                    <tr key={row.submission_id} className="border-t border-[#EAEAEA]">
                      <td className="px-3 py-2">{row.submission_id}</td>
                      <td className="px-3 py-2">{row.no}</td>
                      <td className="px-3 py-2">{row.title ?? "-"}</td>
                      <td className="px-3 py-2">{statusLabels[row.status] ?? row.status}</td>
                      <td className="px-3 py-2">{row.quality_score ?? "-"}</td>
                      <td className="px-3 py-2">{row.duration_seconds ?? "-"}</td>
                      <td className="px-3 py-2">{new Date(row.created_at).toLocaleString("tr-TR")}</td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/${row.submission_id}`} className="underline">
                          Aç
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-[8px] border border-[#EAEAEA] bg-white p-3">
      <p className="text-xs uppercase tracking-[0.08em] text-[#787774]">{title}</p>
      <p className="mt-1 text-lg font-semibold text-[#111111]">{value}</p>
    </article>
  );
}
