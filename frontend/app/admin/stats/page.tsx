"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react";

import { getMe, getSuperadminStatsDashboard } from "@/lib/api";
import { useFeedback } from "@/components/ui/feedback-center";
import type { SuperadminStatsDashboard } from "@/lib/types";

const numberFmt = new Intl.NumberFormat("tr-TR");
type PeriodPreset = "today" | "7d" | "30d" | "custom";

function dt(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("tr-TR");
}

export default function AdminStatsPage() {
  const router = useRouter();
  const feedbackUi = useFeedback();
  const [data, setData] = useState<SuperadminStatsDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleChecked, setRoleChecked] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await getMe();
        if (!active) return;
        if (me.role !== "super_admin") {
          router.replace("/admin");
          return;
        }
        setIsSuperAdmin(true);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "İstatistik yüklenemedi.");
      } finally {
        if (active) setRoleChecked(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!roleChecked || !isSuperAdmin) return;
    let active = true;

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const dateIso = (value: Date) => value.toISOString();
    const daysAgoStart = (days: number) => {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - days);
      return d;
    };

    const customFromDate = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    const customToDate = customTo ? new Date(`${customTo}T23:59:59`) : null;

    let dateFrom: string | undefined;
    let dateTo: string | undefined;
    if (periodPreset === "today") {
      dateFrom = dateIso(startOfDay);
      dateTo = dateIso(endOfDay);
    } else if (periodPreset === "7d") {
      dateFrom = dateIso(daysAgoStart(6));
      dateTo = dateIso(endOfDay);
    } else if (periodPreset === "30d") {
      dateFrom = dateIso(daysAgoStart(29));
      dateTo = dateIso(endOfDay);
    } else if (periodPreset === "custom") {
      if (customFromDate && customToDate && customFromDate <= customToDate) {
        dateFrom = dateIso(customFromDate);
        dateTo = dateIso(customToDate);
      }
    }

    setLoading(true);
    getSuperadminStatsDashboard({
      onlineWindowMinutes: 15,
      dateFrom,
      dateTo,
    })
      .then((dashboard) => {
        if (!active) return;
        setData(dashboard);
        setError(null);
        setLastSyncAt(new Date().toISOString());
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "İstatistik yüklenemedi.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isSuperAdmin, roleChecked, periodPreset, customFrom, customTo, refreshNonce]);

  useEffect(() => {
    if (!roleChecked || !isSuperAdmin || !autoRefresh) return;
    const timer = window.setInterval(() => {
      setRefreshNonce((prev) => prev + 1);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, isSuperAdmin, roleChecked]);

  useEffect(() => {
    if (!error) return;
    feedbackUi.notify({
      tone: "error",
      title: "İstatistik Hatası",
      description: error,
    });
  }, [error, feedbackUi]);

  const topCards = useMemo(
    () => [
      { title: "Toplam Video/Kayıt", value: data ? `${numberFmt.format(data.total_videos)} / ${numberFmt.format(data.total_submissions)}` : "-" },
      { title: "Toplam SMS (Başarılı)", value: data ? numberFmt.format(data.total_sms_sent) : "-" },
      { title: "Toplam SMS (Başarısız)", value: data ? numberFmt.format(data.total_sms_failed) : "-" },
      { title: "Sorunlu Kayıt", value: data ? numberFmt.format(data.problematic_submissions) : "-" },
      { title: "Risk Kilitli", value: data ? numberFmt.format(data.risk_locked_submissions) : "-" },
      { title: "Online Operatör", value: data ? `${numberFmt.format(data.online_operators)} / ${numberFmt.format(data.total_operators)}` : "-" },
      { title: "Online Admin", value: data ? `${numberFmt.format(data.online_admins)} / ${numberFmt.format(data.total_admins)}` : "-" },
      {
        title: "AI Ortalama Skor",
        value: data?.ai_stats?.avg_quality_score != null ? data.ai_stats.avg_quality_score.toFixed(2) : "-",
      },
    ],
    [data]
  );

  const adminLoadRows = useMemo(() => {
    const rows = data?.admin_stats ?? [];
    const totalReviews = rows.reduce((acc, row) => acc + row.review_count, 0);
    return rows.map((row) => {
      const share = totalReviews > 0 ? (row.review_count / totalReviews) * 100 : 0;
      const overloaded = share >= 45 || row.active_claim_count >= 8;
      return {
        ...row,
        share,
        overloaded,
      };
    });
  }, [data]);

  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <section className="mx-auto w-full max-w-[1440px] space-y-6 py-4">
        {error && (
          <div className="inline-flex items-center gap-2 rounded-[10px] border border-[#F3D4D6] bg-[#FCEDEE] px-4 py-3 text-sm font-medium text-[#8F2B30]">
            <WarningCircle size={16} />
            {error}
          </div>
        )}

        <section className="rounded-[14px] border border-[#E5E7E4] bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPeriodPreset("today")}
              className={`rounded-[8px] border px-3 py-1.5 text-sm ${periodPreset === "today" ? "border-[#2E7D32] bg-[#F0F9F1] text-[#1A6328]" : "border-[#E5E7E4] bg-white text-[#4B4F52]"}`}
            >
              Bugün
            </button>
            <button
              type="button"
              onClick={() => setPeriodPreset("7d")}
              className={`rounded-[8px] border px-3 py-1.5 text-sm ${periodPreset === "7d" ? "border-[#2E7D32] bg-[#F0F9F1] text-[#1A6328]" : "border-[#E5E7E4] bg-white text-[#4B4F52]"}`}
            >
              Son 7 Gün
            </button>
            <button
              type="button"
              onClick={() => setPeriodPreset("30d")}
              className={`rounded-[8px] border px-3 py-1.5 text-sm ${periodPreset === "30d" ? "border-[#2E7D32] bg-[#F0F9F1] text-[#1A6328]" : "border-[#E5E7E4] bg-white text-[#4B4F52]"}`}
            >
              Son 30 Gün
            </button>
            <button
              type="button"
              onClick={() => setPeriodPreset("custom")}
              className={`rounded-[8px] border px-3 py-1.5 text-sm ${periodPreset === "custom" ? "border-[#2E7D32] bg-[#F0F9F1] text-[#1A6328]" : "border-[#E5E7E4] bg-white text-[#4B4F52]"}`}
            >
              Özel
            </button>
            {periodPreset === "custom" && (
              <>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-[8px] border border-[#E5E7E4] px-2 py-1.5 text-sm"
                />
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-[8px] border border-[#E5E7E4] px-2 py-1.5 text-sm"
                />
              </>
            )}
            <div className="ml-auto text-xs text-[#787774]">
              Dönem: {data?.date_from ? dt(data.date_from) : "-"} - {data?.date_to ? dt(data.date_to) : "-"} · Son sync: {dt(lastSyncAt)}
            </div>
            <button
              type="button"
              onClick={() => setRefreshNonce((prev) => prev + 1)}
              className="rounded-[8px] border border-[#E5E7E4] bg-white px-3 py-1.5 text-sm text-[#4B4F52]"
            >
              Yenile
            </button>
            <button
              type="button"
              onClick={() => setAutoRefresh((prev) => !prev)}
              className={`rounded-[8px] border px-3 py-1.5 text-sm ${autoRefresh ? "border-[#2E7D32] bg-[#F0F9F1] text-[#1A6328]" : "border-[#E5E7E4] bg-white text-[#4B4F52]"}`}
            >
              Auto {autoRefresh ? "Açık" : "Kapalı"}
            </button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-[12px] border border-[#E5E7E4] p-4">
                  <div className="skeleton h-3 w-24 rounded" />
                  <div className="skeleton mt-3 h-8 w-20 rounded" />
                </div>
              ))
            : topCards.map((item) => <MetricCard key={item.title} title={item.title} value={item.value} />)}
        </section>

        <section className="grid gap-4 xl:grid-cols-4">
          <Card title="Durum Dağılımı">
            <div className="grid gap-2 text-sm">
              <StatusRow label="Yüklendi" value={data?.status_counts?.uploaded} />
              <StatusRow label="İşleniyor" value={data?.status_counts?.processing} />
              <StatusRow label="İncelemeye Hazır" value={data?.status_counts?.review_ready} />
              <StatusRow label="Onaylandı" value={data?.status_counts?.approved} />
              <StatusRow label="Reddedildi" value={data?.status_counts?.rejected} />
              <StatusRow label="Hata" value={data?.status_counts?.failed} />
            </div>
          </Card>

          <Card title="AI Skor Kırılımı">
            <div className="grid gap-2 text-sm">
              <StatusRow label="Örnek Sayısı" value={data?.ai_stats?.sample_count} />
              <StatusRow label="Minimum" value={data?.ai_stats?.min_quality_score != null ? Number(data.ai_stats.min_quality_score.toFixed(2)) : undefined} />
              <StatusRow label="Maksimum" value={data?.ai_stats?.max_quality_score != null ? Number(data.ai_stats.max_quality_score.toFixed(2)) : undefined} />
              <StatusRow label="Düşük Skor (<60)" value={data?.ai_stats?.low_quality_count} />
              <StatusRow label="Yüksek Skor (>=85)" value={data?.ai_stats?.high_quality_count} />
            </div>
          </Card>

          <Card title={`Online Kullanıcılar (${data?.online_window_minutes ?? 15} dk)`}>
            <div className="grid gap-3 text-sm">
              <div>
                <p className="mb-1 font-semibold text-[#111111]">Admin</p>
                <p className="text-[#4B4F52]">{data?.online_admin_list?.map((row) => `${row.full_name} (${row.username})`).join(", ") || "-"}</p>
              </div>
              <div>
                <p className="mb-1 font-semibold text-[#111111]">Operatör</p>
                <p className="text-[#4B4F52]">{data?.online_operator_list?.map((row) => `${row.full_name} (${row.username})`).join(", ") || "-"}</p>
              </div>
            </div>
          </Card>

          <Card title="SLA Durumu">
            <div className="grid gap-2 text-sm">
              <StatusRow
                label="Yükleme -> Onay (dk)"
                value={data?.sla?.avg_upload_to_review_minutes != null ? Number(data.sla.avg_upload_to_review_minutes.toFixed(2)) : undefined}
              />
              <StatusRow
                label="Onay -> SMS (dk)"
                value={data?.sla?.avg_review_to_sms_minutes != null ? Number(data.sla.avg_review_to_sms_minutes.toFixed(2)) : undefined}
              />
              <StatusRow label="60dk+ Bekleyen İnceleme" value={data?.sla?.pending_review_over_60m} />
              <StatusRow label="30dk+ SMS Bekleyen Onaylı" value={data?.sla?.approved_without_sms_over_30m} />
            </div>
          </Card>
        </section>

        <Card title="Dönüşüm Hunisi">
          <div className="grid gap-3">
            <FunnelRow
              label="Yükleme"
              count={data?.funnel?.uploaded_count}
              percent={100}
            />
            <FunnelRow
              label="İncelenen"
              count={data?.funnel?.reviewed_count}
              percent={data?.funnel?.review_rate_percent}
            />
            <FunnelRow
              label="Onaylanan"
              count={data?.funnel?.approved_count}
              percent={data?.funnel?.approval_rate_percent}
            />
            <FunnelRow
              label="SMS Gönderilen Kayıt"
              count={data?.funnel?.sms_sent_submission_count}
              percent={data?.funnel?.sms_after_approval_rate_percent}
            />
          </div>
        </Card>

        <Card title="Sorun Nedenleri Dağılımı">
          <div className="mb-3 text-sm text-[#4B4F52]">
            Sorunlu kayıt sayısı: <span className="font-semibold text-[#111111]">{data?.issue_breakdown ? numberFmt.format(data.issue_breakdown.total_with_issue) : "-"}</span>
          </div>
          <TableWrap>
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-[#F8F9F7] text-xs uppercase tracking-[0.08em] text-[#787774]">
                <tr>
                  <th className="px-3 py-2">Kaynak</th>
                  <th className="px-3 py-2">Neden</th>
                  <th className="px-3 py-2">Adet</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-t border-[#E5E7E4]">
                      {Array.from({ length: 3 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="skeleton h-3 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (data?.issue_breakdown?.items ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-[#787774]">Sorun breakdown verisi yok.</td>
                  </tr>
                ) : (
                  data?.issue_breakdown?.items.map((item, idx) => (
                    <tr key={`${item.source}_${item.key}_${idx}`} className="border-t border-[#E5E7E4] hover:bg-[#FAFAF8]">
                      <td className="px-3 py-2">{issueSourceLabel(item.source)}</td>
                      <td className="px-3 py-2 text-[#111111]">{item.key}</td>
                      <td className="px-3 py-2 font-semibold">{numberFmt.format(item.count)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card title="Operatör Kalite Trendi (Son 7g vs Önceki 7g)">
          <TableWrap>
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-[#F8F9F7] text-xs uppercase tracking-[0.08em] text-[#787774]">
                <tr>
                  <th className="px-3 py-2">Operatör</th>
                  <th className="px-3 py-2">Son 7g Ort.</th>
                  <th className="px-3 py-2">Önceki 7g Ort.</th>
                  <th className="px-3 py-2">Delta</th>
                  <th className="px-3 py-2">Son 7g Yükleme</th>
                  <th className="px-3 py-2">Trend</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-t border-[#E5E7E4]">
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="skeleton h-3 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (data?.operator_quality_trends ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-[#787774]">Trend verisi yok.</td>
                  </tr>
                ) : (
                  data?.operator_quality_trends?.map((row) => (
                    <tr key={row.operator_id} className="border-t border-[#E5E7E4] hover:bg-[#FAFAF8]">
                      <td className="px-3 py-2 font-medium text-[#111111]">
                        <Link href={`/admin/operators/${row.operator_id}`} className="underline">{row.full_name}</Link>
                        <div className="text-xs text-[#787774]">@{row.username}</div>
                      </td>
                      <td className="px-3 py-2">{row.last_7d_avg_quality != null ? row.last_7d_avg_quality.toFixed(2) : "-"}</td>
                      <td className="px-3 py-2">{row.prev_7d_avg_quality != null ? row.prev_7d_avg_quality.toFixed(2) : "-"}</td>
                      <td className="px-3 py-2">{row.delta_quality != null ? row.delta_quality.toFixed(2) : "-"}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.last_7d_upload_count)}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-1 text-xs font-semibold ${trendClass(row.trend)}`}>{trendLabel(row.trend)}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card title="Operatör Performansı">
          <TableWrap>
            <table className="w-full min-w-[1280px] text-left text-sm">
              <thead className="bg-[#F8F9F7] text-xs uppercase tracking-[0.08em] text-[#787774]">
                <tr>
                  <th className="px-3 py-2">Operatör</th>
                  <th className="px-3 py-2">Lokasyon</th>
                  <th className="px-3 py-2">Yükleme</th>
                  <th className="px-3 py-2">Video</th>
                  <th className="px-3 py-2">Onay</th>
                  <th className="px-3 py-2">Red</th>
                  <th className="px-3 py-2">Hata</th>
                  <th className="px-3 py-2">Risk</th>
                  <th className="px-3 py-2">Sorunlu</th>
                  <th className="px-3 py-2">AI Ort.</th>
                  <th className="px-3 py-2">Düşük AI</th>
                  <th className="px-3 py-2">Son Yükleme</th>
                  <th className="px-3 py-2">Online</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-t border-[#E5E7E4]">
                      {Array.from({ length: 13 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="skeleton h-3 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (data?.operator_stats ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-3 py-6 text-center text-[#787774]">Operatör verisi yok.</td>
                  </tr>
                ) : (
                  data?.operator_stats?.map((row) => (
                    <tr key={row.operator_id} className="border-t border-[#E5E7E4] hover:bg-[#FAFAF8]">
                      <td className="px-3 py-2 font-medium text-[#111111]">
                        <Link href={`/admin/operators/${row.operator_id}`} className="underline">{row.full_name}</Link>
                        <div className="text-xs text-[#787774]">@{row.username}</div>
                      </td>
                      <td className="px-3 py-2">{[row.country, row.city, row.region].filter(Boolean).join(" / ") || "-"}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.upload_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.video_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.approved_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.rejected_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.failed_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.risk_locked_count)}</td>
                      <td className="px-3 py-2 font-semibold text-[#8F2B30]">{numberFmt.format(row.problematic_count)}</td>
                      <td className="px-3 py-2">{row.avg_ai_score != null ? row.avg_ai_score.toFixed(2) : "-"}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.low_ai_score_count)}</td>
                      <td className="px-3 py-2 text-[#787774]">{dt(row.last_upload_at)}</td>
                      <td className="px-3 py-2">{row.is_online ? "Evet" : "Hayır"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card title="Admin İş Yükü Dengesi">
          <TableWrap>
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-[#F8F9F7] text-xs uppercase tracking-[0.08em] text-[#787774]">
                <tr>
                  <th className="px-3 py-2">Admin</th>
                  <th className="px-3 py-2">Review Adedi</th>
                  <th className="px-3 py-2">Review Payı (%)</th>
                  <th className="px-3 py-2">Aktif Claim</th>
                  <th className="px-3 py-2">Durum</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-t border-[#E5E7E4]">
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="skeleton h-3 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : adminLoadRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[#787774]">İş yükü verisi yok.</td>
                  </tr>
                ) : (
                  adminLoadRows.map((row) => (
                    <tr key={`load_${row.admin_id}`} className="border-t border-[#E5E7E4] hover:bg-[#FAFAF8]">
                      <td className="px-3 py-2 font-medium text-[#111111]">{row.full_name}<div className="text-xs text-[#787774]">@{row.username}</div></td>
                      <td className="px-3 py-2">{numberFmt.format(row.review_count)}</td>
                      <td className="px-3 py-2">{row.share.toFixed(2)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.active_claim_count)}</td>
                      <td className="px-3 py-2">
                        {row.overloaded ? (
                          <span className="rounded bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">Yüksek</span>
                        ) : (
                          <span className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">Dengeli</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card title="Admin Performansı">
          <TableWrap>
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-[#F8F9F7] text-xs uppercase tracking-[0.08em] text-[#787774]">
                <tr>
                  <th className="px-3 py-2">Admin</th>
                  <th className="px-3 py-2">Rol</th>
                  <th className="px-3 py-2">Toplam İnceleme</th>
                  <th className="px-3 py-2">Onay</th>
                  <th className="px-3 py-2">Red</th>
                  <th className="px-3 py-2">SMS Aksiyon</th>
                  <th className="px-3 py-2">SMS Başarılı</th>
                  <th className="px-3 py-2">SMS Başarısız</th>
                  <th className="px-3 py-2">SMS Retry</th>
                  <th className="px-3 py-2">Aktif Claim</th>
                  <th className="px-3 py-2">Son Aktivite</th>
                  <th className="px-3 py-2">Online</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-t border-[#E5E7E4]">
                      {Array.from({ length: 12 }).map((__, j) => (
                        <td key={j} className="px-3 py-3">
                          <div className="skeleton h-3 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (data?.admin_stats ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-3 py-6 text-center text-[#787774]">Admin verisi yok.</td>
                  </tr>
                ) : (
                  data?.admin_stats?.map((row) => (
                    <tr key={row.admin_id} className="border-t border-[#E5E7E4] hover:bg-[#FAFAF8]">
                      <td className="px-3 py-2 font-medium text-[#111111]">{row.full_name}<div className="text-xs text-[#787774]">@{row.username}</div></td>
                      <td className="px-3 py-2">{row.role === "super_admin" ? "Super Admin" : "Admin"}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.review_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.approved_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.rejected_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.sms_action_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.sms_sent_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.sms_failed_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.sms_retry_count)}</td>
                      <td className="px-3 py-2">{numberFmt.format(row.active_claim_count)}</td>
                      <td className="px-3 py-2 text-[#787774]">{dt(row.last_activity_at)}</td>
                      <td className="px-3 py-2">{row.is_online ? "Evet" : "Hayır"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </section>
    </main>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[14px] border border-[#E5E7E4] bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-[0.11em] text-[#6F7376]">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MetricCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-[12px] border border-[#E5E7E4] bg-[#F8F9F7] p-4">
      <p className="text-xs uppercase tracking-[0.08em] text-[#6F7376]">{title}</p>
      <p className="mt-2 text-[clamp(1.2rem,2vw,1.8rem)] font-semibold tracking-[-0.02em] text-[#111111]">{value}</p>
    </article>
  );
}

function StatusRow({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center justify-between rounded-[8px] border border-[#E9EBE8] bg-[#FCFCFB] px-3 py-2">
      <span className="text-[#4B4F52]">{label}</span>
      <span className="font-semibold text-[#111111]">{value == null ? "-" : numberFmt.format(value)}</span>
    </div>
  );
}

function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-auto rounded-[10px] border border-[#E5E7E4]">{children}</div>;
}

function FunnelRow({ label, count, percent }: { label: string; count?: number; percent?: number }) {
  const safePercent = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <div className="rounded-[10px] border border-[#E9EBE8] bg-[#FCFCFB] p-3">
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-[#4B4F52]">{label}</span>
        <span className="font-semibold text-[#111111]">
          {count == null ? "-" : numberFmt.format(count)} · {safePercent.toFixed(2)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#E7ECE8]">
        <div className="h-full rounded-full bg-[#2E7D32]" style={{ width: `${safePercent}%` }} />
      </div>
    </div>
  );
}

function issueSourceLabel(source: string) {
  if (source === "failure_reason") return "Failure Reason";
  if (source === "risk_code") return "Risk Kodu";
  if (source === "risk_state") return "Risk Durumu";
  if (source === "status") return "Kayıt Durumu";
  return source;
}

function trendLabel(trend: string) {
  if (trend === "up") return "Yukarı";
  if (trend === "down") return "Aşağı";
  return "Sabit";
}

function trendClass(trend: string) {
  if (trend === "up") return "bg-emerald-100 text-emerald-700";
  if (trend === "down") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}
