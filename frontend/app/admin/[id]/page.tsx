"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";

import {
  claimSubmission,
  getMe,
  getSubmission,
  overrideSubmissionMatches,
  overrideSubmissionRisk,
  releaseSubmissionClaim,
  reviewSubmission,
  sendSms,
  sendSmsToDonor,
  sendSmsToSelectedDonors,
  updateSubmissionNo,
} from "@/lib/api";
import { useFeedback } from "@/components/ui/feedback-center";
import type { SubmissionDetail, UserRole } from "@/lib/types";

type MatchFilter = "all" | "matched" | "unmatched";
type MessageTone = "info" | "success" | "error";

const statusLabels: Record<string, string> = {
  uploaded: "Yüklendi",
  processing: "İşleniyor",
  review_ready: "İncelemeye Hazır",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  failed: "Hata",
};

const matchFilterLabels: Record<MatchFilter, string> = {
  all: "Tümü",
  matched: "Eşleşen",
  unmatched: "Eşleşmeyen",
};

function normalizeConfidence(score: number | null): number | null {
  if (score === null || Number.isNaN(score)) return null;
  const v = Math.abs(score);
  return v <= 1 ? v * 100 : Math.min(v, 100);
}

/* ─── Loading Skeleton ────────────────────────────────────────────────────── */
function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-slate-100 before:absolute before:inset-0 before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent before:animate-[shimmer_1.6s_infinite] ${className}`} />
  );
}

function LoadingSkeleton() {
  return (
    <main className="min-h-screen bg-[#F7F8FA] px-5 py-7">
      <style>{`@keyframes shimmer{100%{transform:translateX(100%)}}`}</style>
      <div className="mx-auto max-w-[1560px] space-y-5">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-2.5">
              <Shimmer className="h-8 w-48" />
              <Shimmer className="h-4 w-72" />
            </div>
            <Shimmer className="h-7 w-28 rounded-full" />
          </div>
          <div className="mt-6 grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Shimmer key={i} className="h-[76px] rounded-xl" />)}
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <Shimmer className="h-[420px] rounded-2xl" />
            <Shimmer className="h-52 rounded-2xl" />
            <Shimmer className="h-72 rounded-2xl" />
          </div>
          <div className="space-y-5">
            <Shimmer className="h-64 rounded-2xl" />
            <Shimmer className="h-80 rounded-2xl" />
          </div>
        </div>
      </div>
    </main>
  );
}

/* ─── Main Page ───────────────────────────────────────────────────────────── */
export default function AdminDetailPage() {
  const feedbackUi = useFeedback();
  const params = useParams<{ id: string }>();
  const submissionId = Number(params.id);

  const [data, setData] = useState<SubmissionDetail | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: MessageTone; text: string } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [matchFilter, setMatchFilter] = useState<MatchFilter>("all");
  const [selectedDonorIds, setSelectedDonorIds] = useState<number[]>([]);
  const [busyDonorId, setBusyDonorId] = useState<number | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  const [selectedBulkSending, setSelectedBulkSending] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [noUpdateBusy, setNoUpdateBusy] = useState(false);
  const [riskOverrideBusy, setRiskOverrideBusy] = useState(false);
  const [overrideNote, setOverrideNote] = useState("");
  const [claimInfo, setClaimInfo] = useState<{ adminId: number; expiresAt: string } | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const refresh = async () => {
    const detail = await getSubmission(submissionId);
    setData(detail);
  };

  useEffect(() => { refresh().catch((e) => setMessage({ tone: "error", text: e.message })); }, [submissionId]);
  useEffect(() => { getMe().then((me) => setUserRole(me.role)).catch(() => setUserRole(null)); }, []);

  useEffect(() => {
    if (!message) return;
    feedbackUi.notify({
      tone: message.tone === "error" ? "error" : message.tone === "success" ? "success" : "info",
      title: message.tone === "error" ? "Hata" : message.tone === "success" ? "Başarılı" : "Bilgi",
      description: message.text,
    });
  }, [feedbackUi, message]);

  useEffect(() => {
    let active = true;
    claimSubmission(submissionId, "admin_detail_open")
      .then((r) => { if (active) setClaimInfo({ adminId: r.claimed_by_admin_id, expiresAt: r.claim_expires_at }); })
      .catch((e) => { if (active) setMessage({ tone: "error", text: e instanceof Error ? e.message : "Claim alınamadı." }); });

    const timer = window.setInterval(() => {
      claimSubmission(submissionId, "admin_detail_heartbeat")
        .then((r) => { if (active) setClaimInfo({ adminId: r.claimed_by_admin_id, expiresAt: r.claim_expires_at }); })
        .catch(() => undefined);
    }, 60000);

    return () => { active = false; window.clearInterval(timer); releaseSubmissionClaim(submissionId).catch(() => undefined); };
  }, [submissionId]);

  const filteredDonors = useMemo(() => {
    if (!data) return [];
    const q = searchText.trim().toLocaleUpperCase("tr-TR");
    const qc = q.replace(/\s+/g, "");
    return data.donors.filter((d) => {
      if (matchFilter === "matched" && !d.matched) return false;
      if (matchFilter === "unmatched" && d.matched) return false;
      if (!q) return true;
      return d.full_name.toLocaleUpperCase("tr-TR").includes(q) || d.phone.replace(/\s+/g, "").includes(qc);
    });
  }, [data, matchFilter, searchText]);

  const selectedIdSet = useMemo(() => new Set(selectedDonorIds), [selectedDonorIds]);
  const matchedCount = useMemo(() => data?.donors.filter((d) => d.matched).length ?? 0, [data]);

  const consistency = useMemo(() => {
    if (!data) return { score: 0, coverage: 0, avg: null as number | null, label: "—", color: "text-slate-400", bar: "bg-slate-300" };
    const total = data.donors.length;
    const matched = data.donors.filter((d) => d.matched);
    const coverage = total > 0 ? (matched.length / total) * 100 : 0;
    const confs = matched.map((d) => normalizeConfidence(d.score)).filter((s): s is number => s !== null);
    const avg = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
    const score = avg === null ? coverage : coverage * 0.6 + avg * 0.4;
    if (score >= 80) return { score, coverage, avg, label: "Güçlü Uyum", color: "text-emerald-700", bar: "bg-emerald-500" };
    if (score >= 55) return { score, coverage, avg, label: "Orta Uyum", color: "text-amber-600", bar: "bg-amber-400" };
    return { score, coverage, avg, label: "Düşük Uyum", color: "text-red-600", bar: "bg-red-500" };
  }, [data]);

  const filteredIds = useMemo(() => filteredDonors.map((d) => d.donor_record_id), [filteredDonors]);
  const filteredMatchedIds = useMemo(() => filteredDonors.filter((d) => d.matched).map((d) => d.donor_record_id), [filteredDonors]);

  const hasNoMismatch = useMemo(() => Boolean(data?.extracted_no && data?.no && data.extracted_no !== data.no), [data]);
  const canSendSms = useMemo(() => Boolean(data && data.status === "approved" && !data.risk_locked && data.processed_object_key), [data]);
  const smsGuardReason = useMemo(() => {
    if (!data) return "Kayıt yükleniyor.";
    if (data.status !== "approved") return "SMS yalnızca onaylı kayıtta gönderilebilir.";
    if (data.risk_locked) return "Risk kilidi aktif.";
    if (!data.processed_object_key) return "İşlenmiş video yok.";
    return null;
  }, [data]);

  useEffect(() => {
    if (!data) { setSelectedDonorIds([]); return; }
    const valid = new Set(data.donors.map((d) => d.donor_record_id));
    setSelectedDonorIds((p) => p.filter((id) => valid.has(id)));
  }, [data]);

  const toggle = (id: number) => setSelectedDonorIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  const selectAll = () => setSelectedDonorIds((p) => Array.from(new Set([...p, ...filteredIds])));
  const selectMatched = () => setSelectedDonorIds((p) => Array.from(new Set([...p, ...filteredMatchedIds])));
  const clearSel = () => setSelectedDonorIds([]);

  const onReview = async (decision: "approved" | "rejected") => {
    if (decision === "approved" && hasNoMismatch) { setMessage({ tone: "error", text: "NO uyuşmazlığı düzeltilmeden onay verilemez." }); return; }
    if (decision === "rejected" && !note.trim()) { setMessage({ tone: "error", text: "Red nedeni zorunlu." }); return; }
    setReviewBusy(true);
    try {
      await reviewSubmission(submissionId, decision, note || undefined);
      setMessage({ tone: "success", text: decision === "approved" ? "Kayıt onaylandı." : "Kayıt reddedildi." });
      await refresh();
    } catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "İşlem başarısız." }); }
    finally { setReviewBusy(false); }
  };

  const onUpdateNo = async () => {
    if (!data) return;
    const input = window.prompt("Yeni NO:", data.extracted_no ?? data.no ?? "");
    if (!input?.trim()) return;
    setNoUpdateBusy(true);
    try { const r = await updateSubmissionNo(submissionId, input.trim(), "admin_manual_no_update"); setMessage({ tone: "success", text: `NO: ${r.no}` }); await refresh(); }
    catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "NO güncellenemedi." }); }
    finally { setNoUpdateBusy(false); }
  };

  const onSms = async () => {
    if (!canSendSms) { setMessage({ tone: "error", text: smsGuardReason ?? "SMS uygun değil." }); return; }
    setBulkSending(true);
    try { const r = await sendSms(submissionId); setMessage({ tone: "success", text: `SMS: ${r.sent_count} başarılı, ${r.failed_count} başarısız` }); }
    catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "SMS başarısız." }); }
    finally { setBulkSending(false); }
  };

  const onSingleSms = async (donorId: number, phone: string) => {
    if (!canSendSms) { setMessage({ tone: "error", text: smsGuardReason ?? "SMS uygun değil." }); return; }
    setBusyDonorId(donorId);
    try { const r = await sendSmsToDonor(submissionId, donorId); setMessage({ tone: "info", text: `${phone}: ${r.status}` }); }
    catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "SMS başarısız." }); }
    finally { setBusyDonorId(null); }
  };

  const onSelectedSms = async () => {
    if (!canSendSms) { setMessage({ tone: "error", text: smsGuardReason ?? "SMS uygun değil." }); return; }
    if (!selectedDonorIds.length) { setMessage({ tone: "error", text: "Kişi seçin." }); return; }
    setSelectedBulkSending(true);
    try { const r = await sendSmsToSelectedDonors(submissionId, selectedDonorIds); setSelectedDonorIds([]); setMessage({ tone: "success", text: `Seçili SMS: ${r.sent_count} başarılı, ${r.failed_count} başarısız` }); }
    catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "SMS başarısız." }); }
    finally { setSelectedBulkSending(false); }
  };

  const onOverride = async () => {
    if (!selectedDonorIds.length) { setMessage({ tone: "error", text: "Kişi seçin." }); return; }
    setOverrideBusy(true);
    try { const r = await overrideSubmissionMatches(submissionId, selectedDonorIds, overrideNote || undefined); setMessage({ tone: "success", text: `Manuel eşleşme: ${r.matched_count}` }); await refresh(); }
    catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "Eşleşme başarısız." }); }
    finally { setOverrideBusy(false); }
  };

  const onRiskOverride = async () => {
    const ok = await feedbackUi.confirm({ title: "Risk Override", description: "Risk kilidini kaldır ve bypass uygula?", confirmText: "Evet", cancelText: "Vazgeç", tone: "warn" });
    if (!ok) return;
    const n = await feedbackUi.prompt({ title: "Override Notu", description: "Min 10 karakter", minLength: 10, placeholder: "Not…", confirmText: "Kaldır" });
    if (!n) return;
    setRiskOverrideBusy(true);
    try { await overrideSubmissionRisk(submissionId, n.trim()); setMessage({ tone: "success", text: "Risk kilidi kaldırıldı." }); await refresh(); }
    catch (e) { setMessage({ tone: "error", text: e instanceof Error ? e.message : "Başarısız." }); }
    finally { setRiskOverrideBusy(false); }
  };

  const jumpTo = (s: number) => {
    const v = videoRef.current; if (!v) return;
    const dur = Number.isFinite(v.duration) ? v.duration : null;
    v.currentTime = dur ? Math.min(s, Math.max(0, dur - 1)) : Math.max(0, s);
    void v.play().catch(() => undefined);
  };

  const goFullscreen = async () => {
    const v = videoRef.current; if (!v) return;
    try {
      if (v.requestFullscreen) { await v.requestFullscreen(); return; }
      const mv = v as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
      mv.webkitEnterFullscreen?.();
    } catch { /* noop */ }
  };

  if (!data) return <LoadingSkeleton />;

  const isReviewReady = data.status === "review_ready";

  /* status chip */
  const statusChip: Record<string, string> = {
    approved: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    rejected: "bg-red-50 text-red-700 ring-1 ring-red-200",
    review_ready: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    processing: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    uploaded: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    failed: "bg-red-50 text-red-700 ring-1 ring-red-200",
  };

  return (
    <main className="min-h-screen bg-[#F7F8FA]">
      <style>{`
        @keyframes slideDown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .anim-slide-down{animation:slideDown .35s cubic-bezier(.32,.72,0,1) both}
        .anim-fade-up{animation:fadeUp .4s cubic-bezier(.32,.72,0,1) both}
        .btn-decision{transition:all .25s cubic-bezier(.32,.72,0,1)}
        .btn-decision:active:not(:disabled){transform:scale(.97)}
        .btn-decision:hover:not(:disabled){filter:brightness(1.06)}
      `}</style>

      <div className="mx-auto max-w-[1560px] space-y-4 px-4 py-6 md:px-6">

        {/* ── CRITICAL ALERTS ─────────────────────────────────── */}
        {hasNoMismatch && (
          <div className="anim-slide-down flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14.5 13H1.5L8 2Z" stroke="#dc2626" strokeWidth="1.5" strokeLinejoin="round"/><path d="M8 7v3M8 11.5v.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </div>
              <div>
                <p className="text-[14px] font-semibold text-red-800">KRİTİK — NO UYUŞMAZLIĞI</p>
                <p className="mt-0.5 text-[13px] text-red-700">
                  Operatör NO: <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono font-bold">{data.no}</code>
                  {" "}≠ AI NO: <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono font-bold">{data.extracted_no}</code>
                  {" "}— Onay vermeden önce düzeltilmeli
                </p>
              </div>
            </div>
            <button onClick={onUpdateNo} disabled={noUpdateBusy}
              className="shrink-0 rounded-xl bg-red-600 px-4 py-2 text-[13px] font-semibold text-white transition-all duration-200 hover:bg-red-700 active:scale-95 disabled:opacity-50">
              {noUpdateBusy ? "…" : "NO Düzelt"}
            </button>
          </div>
        )}

        {data.risk_locked && (
          <div className="anim-slide-down flex items-center justify-between gap-4 rounded-2xl border border-orange-200 bg-orange-50 px-5 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="8" rx="2" stroke="#c2410c" strokeWidth="1.5"/><path d="M5 7V5a3 3 0 116 0v2" stroke="#c2410c" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </div>
              <div>
                <p className="text-[14px] font-semibold text-orange-800">
                  RİSK KİLİDİ{data.risk_codes.length ? ` — ${data.risk_codes.join(", ")}` : ""}
                </p>
                <p className="mt-0.5 text-[13px] text-orange-700">{data.risk_lock_note ?? "Risk açıklaması yok"}</p>
              </div>
            </div>
            {userRole === "super_admin" ? (
              <button onClick={onRiskOverride} disabled={riskOverrideBusy}
                className="shrink-0 rounded-xl bg-orange-600 px-4 py-2 text-[13px] font-semibold text-white transition-all duration-200 hover:bg-orange-700 active:scale-95 disabled:opacity-50">
                {riskOverrideBusy ? "…" : "Kilidi Kaldır"}
              </button>
            ) : (
              <span className="shrink-0 text-[12px] text-orange-600">Sadece superadmin</span>
            )}
          </div>
        )}

        {/* ── HEADER CARD ──────────────────────────────────────── */}
        <header className="anim-fade-up rounded-2xl border border-slate-200/80 bg-white shadow-sm" style={{ animationDelay: "0ms" }}>
          {/* Top row */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-[26px] font-bold tracking-tight text-slate-900">Kayıt #{data.id}</h1>
                <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${statusChip[data.status] ?? "bg-slate-100 text-slate-600"}`}>
                  {statusLabels[data.status] ?? data.status}
                </span>
              </div>
              <p className="mt-1 text-[14px] text-slate-500">
                <span>NO: <strong className="text-slate-700">{data.no}</strong></span>
                {data.region && <span> · Bölge: <strong className="text-slate-700">{data.region}</strong></span>}
                {claimInfo && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500">Admin #{claimInfo.adminId} · {new Date(claimInfo.expiresAt).toLocaleTimeString("tr-TR")}</span>}
              </p>
            </div>
          </div>

          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-4">
            {[
              { label: "AI-DB Uyum", value: consistency.score.toFixed(1), unit: "/100", sub: consistency.label, valueClass: consistency.color },
              { label: "Eşleşen Aday", value: String(matchedCount), unit: `/${data.donors.length}`, sub: "kişi", valueClass: "text-slate-800" },
              { label: "AI Kalite", value: data.quality_score !== null ? data.quality_score.toFixed(1) : "—", unit: data.quality_score !== null ? "/100" : "", sub: "puan", valueClass: "text-slate-800" },
              { label: "Video Süresi", value: data.duration_seconds ? String(Math.round(data.duration_seconds)) : "—", unit: data.duration_seconds ? "sn" : "", sub: "süre", valueClass: "text-slate-800" },
            ].map((m) => (
              <div key={m.label} className="flex flex-col gap-0.5 bg-white px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{m.label}</p>
                <div className="flex items-baseline gap-1">
                  <span className={`text-[22px] font-bold leading-tight ${m.valueClass}`}>{m.value}</span>
                  {m.unit && <span className="text-[13px] text-slate-400">{m.unit}</span>}
                </div>
                <p className="text-[11px] text-slate-400">{m.sub}</p>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between text-[12px] text-slate-500 mb-1.5">
              <span>AI ↔ DB Tutarlılık</span>
              <span className={`font-semibold ${consistency.color}`}>{consistency.label} · {consistency.score.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-all duration-700 ease-[cubic-bezier(.32,.72,0,1)] ${consistency.bar}`} style={{ width: `${Math.max(0, Math.min(100, consistency.score))}%` }} />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Kapsama {consistency.coverage.toFixed(1)}% · Ort. güven {consistency.avg !== null ? `${consistency.avg.toFixed(1)}%` : "—"}
            </p>
          </div>
        </header>

        {/* ── 2-COL LAYOUT ─────────────────────────────────────── */}
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">

          {/* LEFT ─────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Video */}
            <Section title="Video Önizleme" action={
              <button onClick={goFullscreen} disabled={!data.preview_watch_url}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40">
                ⛶ Tam Ekran
              </button>
            }>
              {data.preview_watch_url ? (
                <video ref={videoRef} src={data.preview_watch_url} controls playsInline
                  className="aspect-video w-full rounded-xl border border-slate-100 bg-black object-contain" />
              ) : (
                <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-[14px] text-slate-400">
                  <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="2" y="6" width="28" height="20" rx="4" stroke="#cbd5e1" strokeWidth="1.5"/><path d="M12 11l10 5-10 5V11z" fill="#cbd5e1"/></svg>
                  Video henüz hazır değil
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {[10, 30, 60, 90].map((s) => (
                  <button key={s} type="button" onClick={() => jumpTo(s)} disabled={!data.preview_watch_url}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40">
                    {String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </Section>

            {/* Checklist */}
            <Section title="Karar Öncesi Kontrol">
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { label: "Video izlenebilir", ok: Boolean(data.preview_watch_url) },
                  { label: "AI kalite ≥ 60", ok: (data.quality_score ?? 0) >= 60 },
                  { label: "AI-DB uyum ≥ 55", ok: consistency.score >= 55 },
                  { label: "En az 1 eşleşen donor", ok: matchedCount > 0 },
                ].map(({ label, ok }) => (
                  <div key={label} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-[13px] font-medium transition-colors ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${ok ? "bg-emerald-600 text-white" : "bg-red-500 text-white"}`}>
                      {ok ? "✓" : "✗"}
                    </span>
                    {label}
                  </div>
                ))}
              </div>
            </Section>

            {/* Decision Panel */}
            <div className="rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
              {/* header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
                <h2 className="text-[16px] font-bold text-slate-900">Karar Paneli</h2>
                {!isReviewReady && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
                    Mevcut: {statusLabels[data.status] ?? data.status}
                  </span>
                )}
              </div>

              <div className="p-6 space-y-5">
                {/* Note textarea */}
                <div>
                  <label className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700">
                    Karar Notu
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">RED İÇİN ZORUNLU</span>
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="İnceleme notunuzu buraya yazın…"
                    className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[14px] text-slate-800 placeholder:text-slate-400 transition-colors focus:border-slate-400 focus:bg-white focus:outline-none"
                  />
                  {data.review_note && (
                    <p className="mt-2 text-[12px] text-slate-500">Son rapor: <span className="text-slate-700">{data.review_note}</span></p>
                  )}
                </div>

                {/* BIG DECISION BUTTONS */}
                <div className="grid grid-cols-2 gap-3">
                  {/* APPROVE */}
                  <button type="button" onClick={() => onReview("approved")} disabled={reviewBusy || !isReviewReady}
                    className="btn-decision group relative overflow-hidden rounded-2xl bg-emerald-600 px-6 py-5 text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50 hover:shadow-emerald-200/70 hover:shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="relative flex flex-col items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4 8-8" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </div>
                      <span className="text-[18px] font-black tracking-wide">ONAYLA</span>
                      <span className="text-[11px] text-emerald-200">Onaylı statüsüne geç</span>
                    </div>
                  </button>

                  {/* REJECT */}
                  <button type="button" onClick={() => onReview("rejected")} disabled={reviewBusy || !isReviewReady}
                    className="btn-decision group relative overflow-hidden rounded-2xl bg-red-600 px-6 py-5 text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50 hover:shadow-red-200/70 hover:shadow-xl">
                    <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    <div className="relative flex flex-col items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>
                      </div>
                      <span className="text-[18px] font-black tracking-wide">REDDET</span>
                      <span className="text-[11px] text-red-200">Not zorunlu</span>
                    </div>
                  </button>
                </div>

                {reviewBusy && (
                  <div className="flex items-center justify-center gap-2 py-1 text-[13px] text-slate-500">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                    İşleniyor…
                  </div>
                )}

                {!isReviewReady && (
                  <p className="text-center text-[12px] text-slate-400">Karar yalnızca <strong>İncelemeye Hazır</strong> durumunda verilebilir</p>
                )}

                {/* Bulk SMS */}
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-700">Toplu SMS</p>
                    <p className="text-[11px] text-slate-400">Tüm uygun kişilere gönder</p>
                  </div>
                  <button onClick={onSms} disabled={bulkSending || !canSendSms} title={smsGuardReason ?? undefined}
                    className="rounded-xl bg-slate-800 px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-slate-900 active:scale-95 disabled:opacity-40">
                    {bulkSending ? "…" : "SMS Gönder"}
                  </button>
                </div>
                {!canSendSms && smsGuardReason && <p className="text-[11px] text-slate-400">{smsGuardReason}</p>}
              </div>
            </div>

          </div>

          {/* RIGHT ────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* AI Output */}
            <Section title="AI Çıktısı">
              {data.extracted_no && data.extracted_no !== data.no && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
                  <strong>{data.no}</strong> ≠ <strong>{data.extracted_no}</strong>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <InfoPill label="Çıkarılan NO" value={data.extracted_no ?? "—"} />
                <InfoPill label="Analiz Modu" value={data.analysis_mode ?? "—"} />
              </div>

              <div className="mt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">İsim Adayları</p>
                <div className="flex flex-wrap gap-2">
                  {data.extracted_names.length === 0 ? (
                    <span className="text-[13px] text-slate-400">AI isim çıkaramadı</span>
                  ) : data.extracted_names.map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[12px] shadow-sm">
                      <strong className="text-slate-800">{r.full_name}</strong>
                      <span className="text-slate-400">{(r.confidence * 100).toFixed(0)}%</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {[{ label: "Transcript", val: data.transcript_text }, { label: "OCR", val: data.ocr_text }].map(({ label, val }) => (
                  <div key={label}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>
                    <pre className="max-h-[140px] overflow-auto rounded-xl border border-slate-100 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-600 whitespace-pre-wrap">
                      {val ?? "—"}
                    </pre>
                  </div>
                ))}
              </div>
            </Section>

            {/* SMS Preview */}
            <Section title="SMS Önizleme">
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-[13px] leading-relaxed text-slate-700 break-words">{data.sms_preview_text ?? "—"}</p>
              </div>
              {data.sms_preview_text && (
                <button
                  onClick={() => { navigator.clipboard.writeText(data.sms_preview_text ?? "").catch(() => undefined); setMessage({ tone: "success", text: "SMS kopyalandı." }); }}
                  className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50">
                  Kopyala
                </button>
              )}
            </Section>

          </div>
        </div>

        {/* ── DONOR TABLE ──────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-3">
              <h2 className="text-[16px] font-bold text-slate-900">DB Adayları</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[12px] font-semibold text-slate-600">{data.donors.length}</span>
            </div>
          </div>

          {/* Filters & controls */}
          <div className="space-y-3 px-6 py-4">
            <div className="flex flex-wrap gap-2">
              <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="İsim veya telefon ara…"
                className="h-9 w-60 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] placeholder:text-slate-400 transition-colors focus:border-slate-400 focus:bg-white focus:outline-none" />
              <div className="flex gap-1">
                {(["all", "matched", "unmatched"] as MatchFilter[]).map((f) => (
                  <button key={f} onClick={() => setMatchFilter(f)}
                    className={`rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-colors ${matchFilter === f ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                    {matchFilterLabels[f]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-4 py-2.5">
              <span className="text-[13px] text-slate-500">
                <strong className="text-slate-800">{filteredDonors.length}</strong> gösteriliyor ·{" "}
                <strong className="text-slate-800">{selectedDonorIds.length}</strong> seçili
              </span>
              <div className="ml-auto flex flex-wrap gap-1.5">
                {[
                  { label: "Filtredekileri Seç", fn: selectAll },
                  { label: "Sadece Eşleşenleri", fn: selectMatched },
                  { label: "Temizle", fn: clearSel },
                ].map(({ label, fn }) => (
                  <button key={label} onClick={fn}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50">
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={onSelectedSms} disabled={!selectedDonorIds.length || selectedBulkSending || !canSendSms}
                title={smsGuardReason ?? undefined}
                className="rounded-xl bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white transition-all hover:bg-slate-800 active:scale-95 disabled:opacity-40">
                {selectedBulkSending ? "Gönderiliyor…" : `SMS Gönder (${selectedDonorIds.length})`}
              </button>
              <button onClick={onOverride} disabled={!selectedDonorIds.length || overrideBusy}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-40">
                {overrideBusy ? "Kaydediliyor…" : "Manuel Eşleşme Kaydet"}
              </button>
              <input value={overrideNote} onChange={(e) => setOverrideNote(e.target.value)} placeholder="Eşleşme notu…"
                className="h-9 flex-1 min-w-[180px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] placeholder:text-slate-400 transition-colors focus:border-slate-400 focus:bg-white focus:outline-none" />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-auto border-t border-slate-100">
            <table className="min-w-[860px] w-full text-left">
              <thead>
                <tr className="bg-slate-50">
                  {["", "Kişi", "Telefon", "Eşleşme", "Güven Skoru", "Kanıt", ""].map((h, i) => (
                    <th key={i} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDonors.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center text-[14px] text-slate-400">Sonuç bulunamadı.</td></tr>
                ) : filteredDonors.map((donor) => {
                  const conf = normalizeConfidence(donor.score);
                  const isSel = selectedIdSet.has(donor.donor_record_id);
                  return (
                    <tr key={donor.donor_record_id}
                      className={`transition-colors ${donor.matched ? isSel ? "bg-emerald-50" : "bg-emerald-50/30 hover:bg-emerald-50/60" : isSel ? "bg-amber-50/50" : "hover:bg-slate-50/60"}`}>
                      <td className="w-10 px-4 py-3">
                        <input type="checkbox" checked={isSel} onChange={() => toggle(donor.donor_record_id)}
                          className="h-4 w-4 cursor-pointer rounded accent-slate-900" />
                      </td>
                      <td className="px-4 py-3 text-[14px] font-semibold text-slate-800">{donor.full_name}</td>
                      <td className="px-4 py-3 font-mono text-[12px] text-slate-500">{donor.phone}</td>
                      <td className="px-4 py-3">
                        {donor.matched ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />Eşleşti
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />Eşleşmedi
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 w-44">
                        {conf !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                              <div className={`h-full rounded-full transition-all ${conf >= 70 ? "bg-emerald-500" : conf >= 40 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${conf}%` }} />
                            </div>
                            <span className="text-[12px] tabular-nums text-slate-600">{conf.toFixed(0)}%</span>
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[12px] text-slate-500 max-w-[120px] truncate" title={donor.evidence_source ?? undefined}>{donor.evidence_source ?? "—"}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => onSingleSms(donor.donor_record_id, donor.phone)}
                          disabled={busyDonorId === donor.donor_record_id || selectedBulkSending || !canSendSms}
                          title={smsGuardReason ?? undefined}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition-all hover:bg-slate-50 active:scale-95 disabled:opacity-40">
                          {busyDonorId === donor.donor_record_id ? "…" : "SMS"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </main>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="text-[15px] font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 text-[14px] font-semibold text-slate-800">{value}</p>
    </div>
  );
}
