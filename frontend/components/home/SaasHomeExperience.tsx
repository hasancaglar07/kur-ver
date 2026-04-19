"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";

import { getMe, getOpsOverview } from "@/lib/api";
import type { MeResponse, OpsOverview, UserRole } from "@/lib/types";
import { clearRecentUserActions, listRecentUserActions, type UserActionItem } from "@/lib/userActions";

type RoleAction = {
  title: string;
  detail: string;
  href: string;
  cta: string;
};

type PrimaryNextStep = {
  title: string;
  detail: string;
  href: string;
  cta: string;
};

const workflowSteps = [
  {
    step: "01",
    title: "Video yükle",
    detail: "Operatör temel bilgileri girer ve MP4 kaydı sisteme bırakır.",
  },
  {
    step: "02",
    title: "İnceleme yap",
    detail: "Yönetim ekranında kalite, durum ve eşleşme sonuçları kontrol edilir.",
  },
  {
    step: "03",
    title: "Teslimatı takip et",
    detail: "SMS gönderim sonucu izlenir, hatalı kayıtlar retry ile tekrar çalıştırılır.",
  },
];

const roleActions: Record<UserRole, RoleAction[]> = {
  operator: [
    {
      title: "Yeni kayıt oluştur",
      detail: "NO ve video ile hızlı gönderim akışını başlat.",
      href: "/uploader",
      cta: "Yükleme ekranını aç",
    },
    {
      title: "Form doğruluğunu koru",
      detail: "Video süresi ve NO formatını kontrol ederek hatayı azalt.",
      href: "/uploader",
      cta: "Forma git",
    },
  ],
  admin: [
    {
      title: "İnceleme kuyruğunu aç",
      detail: "Önce önizleme, sonra detay ve SMS aksiyonunu uygula.",
      href: "/admin",
      cta: "Kuyruğa git",
    },
    {
      title: "Hata/SMS takibini yap",
      detail: "Hatalı veya bekleyen SMS kayıtlarını hızlıca temizle.",
      href: "/admin",
      cta: "Yönetim panelini aç",
    },
  ],
  super_admin: [
    {
      title: "İnceleme kuyruğunu yönet",
      detail: "Kritik kayıtları önceliklendir ve karar akışını hızlandır.",
      href: "/admin",
      cta: "Kuyruğa git",
    },
    {
      title: "Operatörleri yönet",
      detail: "Rol, şifre ve aktiflik durumlarını tek ekrandan güncelle.",
      href: "/admin?tab=operators",
      cta: "Operatör yönetimine git",
    },
  ],
};

function roleLabel(role: UserRole) {
  if (role === "operator") return "Operatör";
  if (role === "admin") return "Yönetici";
  return "Süperadmin";
}

function primaryNextStep(role: UserRole): PrimaryNextStep {
  if (role === "operator") {
    return {
      title: "Sıradaki adım: yeni kayıt oluştur",
      detail: "En hızlı akış için NO ve video ile doğrudan yeni kayda başla.",
      href: "/uploader",
      cta: "Yeni kayıt başlat",
    };
  }
  if (role === "admin") {
    return {
      title: "Sıradaki adım: inceleme bekleyenleri aç",
      detail: "Önce hazır kayıtları bitir, sonra SMS aksiyonlarını tamamla.",
      href: "/admin?status=review_ready",
      cta: "Bekleyen kayıtları aç",
    };
  }
  return {
    title: "Sıradaki adım: operasyon darboğazını aç",
    detail: "İnceleme kuyruğundaki birikmeyi ve hata kayıtlarını önce temizle.",
    href: "/admin?status=review_ready",
    cta: "Kritik kuyruğu aç",
  };
}

export function SaasHomeExperience() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [ops, setOps] = useState<OpsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentActions, setRecentActions] = useState<UserActionItem[]>([]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const meData = await getMe();
        if (!active) return;
        setMe(meData);

        if (meData.role !== "operator") {
          const overview = await getOpsOverview(10);
          if (!active) return;
          setOps(overview);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Kullanıcı bilgisi alınamadı.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setRecentActions(listRecentUserActions(5));
  }, [loading]);

  useEffect(() => {
    const refresh = () => setRecentActions(listRecentUserActions(5));
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const greeting = useMemo(() => {
    if (!me) return "KurbanOps";
    const fullName = [me.first_name, me.last_name].filter(Boolean).join(" ").trim();
    return fullName || me.username;
  }, [me]);

  const actions = me ? roleActions[me.role] : roleActions.operator;
  const nextStep = me ? primaryNextStep(me.role) : primaryNextStep("operator");

  return (
    <main className="w-full max-w-full overflow-x-hidden">
      <section className="mx-auto w-full max-w-[1200px] space-y-8 py-10">
        <header className="rounded-[12px] border border-[#EAEAEA] bg-white p-8">
          <p className="inline-flex rounded-full bg-[#FBF3DB] px-3 py-1 text-xs uppercase tracking-[0.08em] text-[#956400]">KurbanOps</p>
          <h1 className="mt-4 max-w-4xl text-[clamp(2rem,4vw,3.1rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-[#111111]">
            {loading ? "Çalışma alanın hazırlanıyor..." : `Merhaba ${greeting}, senin için doğru başlangıç hazır.`}
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-[#4B4F52]">
            {me
              ? `${roleLabel(me.role)} rolüne göre ilk aksiyonların aşağıda sıralandı. Zaman kaybını azaltmak için önce birinci karttan başla.`
              : "Rol bazlı başlangıç kartları yükleniyor."}
          </p>

          {loading && (
            <div className="mt-6 space-y-3">
              <div className="skeleton h-4 w-48 rounded" />
              <div className="skeleton h-4 w-64 rounded" />
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[0,1,2,3].map((i) => (
                  <div key={i} className="rounded-[10px] border border-[#EAEAEA] px-4 py-3">
                    <div className="skeleton h-3 w-20 rounded" />
                    <div className="skeleton mt-2 h-7 w-12 rounded" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-[8px] border border-[#FDEBEC] bg-[#FDEBEC] px-3 py-2 text-sm text-[#9F2F2D]">
              {error}
            </div>
          )}

          {!loading && me && me.role === "operator" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-[6px] border border-[#E5E7E4] bg-[#F9F9F8] px-3 py-1.5 text-xs font-medium text-[#4B4F52]">Rol: {roleLabel(me.role)}</span>
              {me.country && me.city && me.region && (
                <span className="rounded-[6px] border border-[#E5E7E4] bg-[#F9F9F8] px-3 py-1.5 text-xs font-medium text-[#4B4F52]">
                  {me.country} / {me.city} / {me.region}
                </span>
              )}
            </div>
          )}
          {!loading && me && me.role !== "operator" && ops && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Toplam Kayıt", value: ops.total_submissions, color: "text-[#111111]", bg: "bg-[#F9F9F8]" },
                { label: "Aktif Kuyruk", value: ops.processing_count, color: "text-[#1565C0]", bg: "bg-[#EEF4FF]" },
                { label: "Toplam Hata", value: ops.failed_total, color: ops.failed_total > 0 ? "text-[#B71C1C]" : "text-[#2E7D32]", bg: ops.failed_total > 0 ? "bg-[#FFF5F5]" : "bg-[#F0F9F1]" },
                { label: "Son 24s Hata", value: ops.failed_last_24h, color: ops.failed_last_24h > 0 ? "text-[#E65100]" : "text-[#2E7D32]", bg: ops.failed_last_24h > 0 ? "bg-[#FFF8F0]" : "bg-[#F0F9F1]" },
              ].map((stat) => (
                <div key={stat.label} className={`rounded-[10px] border border-[#EAEAEA] ${stat.bg} px-4 py-3`}>
                  <p className="text-[11px] uppercase tracking-[0.08em] text-[#787774]">{stat.label}</p>
                  <p className={`mt-1 text-[28px] font-bold leading-none ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>
          )}

          {!loading && me && (
            <article className="mt-6 rounded-[10px] border border-[#EAEAEA] bg-[#F9F9F8] p-4">
              <p className="text-xs uppercase tracking-[0.1em] text-[#787774]">Hemen şimdi</p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-[#111111]">{nextStep.title}</h2>
              <p className="mt-1 text-sm text-[#4B4F52]">{nextStep.detail}</p>
              <Link
                href={nextStep.href}
                className="mt-3 inline-flex items-center gap-1 rounded-[6px] bg-[#111111] px-4 py-2 text-sm font-medium text-white hover:bg-[#333333] active:scale-[0.98]"
              >
                {nextStep.cta}
                <ArrowRight size={14} />
              </Link>
            </article>
          )}
        </header>

        <section className="grid gap-3 md:grid-cols-2">
          {actions.map((item) => (
            <article key={item.title} className="rounded-[12px] border border-[#EAEAEA] bg-white p-5">
              <h2 className="text-lg font-semibold tracking-tight text-[#111111]">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#4B4F52]">{item.detail}</p>
              <Link href={item.href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#111111] underline decoration-[#D4D4D1] underline-offset-4">
                {item.cta}
                <ArrowRight size={14} />
              </Link>
            </article>
          ))}
        </section>

        <section className="rounded-[12px] border border-[#EAEAEA] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#111111]">Son 5 işlem</h2>
            {recentActions.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  clearRecentUserActions();
                  setRecentActions([]);
                }}
                className="rounded-[6px] border border-[#EAEAEA] bg-white px-2 py-1 text-xs text-[#4B4F52]"
              >
                Geçmişi temizle
              </button>
            )}
          </div>

          {recentActions.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 py-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F3F3F1] text-[#ACACAA]">
                <ArrowRight size={18} />
              </div>
              <p className="text-sm font-medium text-[#4B4F52]">Henüz işlem yok</p>
              <p className="text-xs text-[#787774]">İlk aksiyonu tamamladığında burada görünecek.</p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {recentActions.map((item) => {
                const isSuccess = item.type === "upload_success" || item.type === "sms_sent" || item.type === "bulk_approved";
                const isWarn = item.type === "sms_retry" || item.type === "bulk_sms_retry";
                const rowBg = isSuccess ? "bg-[#F0F9F1] border-[#C8E6C9]" : isWarn ? "bg-[#FFF8F0] border-[#FFE0B2]" : "bg-[#FFF5F5] border-[#FFCDD2]";
                const dotColor = isSuccess ? "bg-[#4CAF50]" : isWarn ? "bg-[#FF9800]" : "bg-[#F44336]";
                return (
                  <li key={item.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-[8px] border px-3 py-2 ${rowBg}`}>
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                      <div>
                        <p className="text-sm font-medium text-[#111111]">{item.label}</p>
                        <p className="text-xs text-[#787774]">{new Date(item.created_at).toLocaleString("tr-TR")}</p>
                      </div>
                    </div>
                    <Link href={item.href} className="inline-flex items-center gap-1 text-xs font-medium text-[#111111] underline underline-offset-4">
                      Aç
                      <ArrowRight size={12} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="grid gap-3 lg:grid-cols-3">
          {workflowSteps.map((item) => (
            <article key={item.title} className="rounded-[12px] border border-[#EAEAEA] bg-white p-5">
              <p className="text-xs uppercase tracking-[0.08em] text-[#787774]">Adım {item.step}</p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-[#111111]">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4B4F52]">{item.detail}</p>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
