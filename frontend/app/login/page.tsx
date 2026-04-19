"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { CrownSimple, Eye, EyeSlash, ShieldCheck, UserCircle } from "@phosphor-icons/react";
import Script from "next/script";

import { login } from "@/lib/api";
import { useFeedback } from "@/components/ui/feedback-center";

type AccountPreset = {
  id: "operator" | "admin" | "super_admin";
  label: string;
  username: string;
  password: string;
  note: string;
};

const presets: AccountPreset[] = [
  { id: "operator", label: "Operatör", username: "operator", password: "operator123", note: "Video yükleme akışı" },
  { id: "admin", label: "Yönetici", username: "admin", password: "admin123", note: "İnceleme ve SMS kararları" },
  { id: "super_admin", label: "Süper Admin", username: "superadmin", password: "superadmin123", note: "Operatör yönetimi ve analiz" },
];

export default function LoginPage() {
  const router = useRouter();
  const feedbackUi = useFeedback();
  const [username, setUsername] = useState("operator");
  const [password, setPassword] = useState("operator123");
  const [selectedPresetId, setSelectedPresetId] = useState<AccountPreset["id"] | null>("operator");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const sakuraRef = useRef<{ stop: (graceful?: boolean) => void } | null>(null);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [selectedPresetId]
  );
  const selectedPresetIndex = useMemo(() => presets.findIndex((preset) => preset.id === selectedPresetId), [selectedPresetId]);

  useEffect(() => {
    const matched = presets.find((preset) => preset.username === username && preset.password === password);
    setSelectedPresetId(matched?.id ?? null);
  }, [password, username]);

  const applyPreset = (preset: AccountPreset) => {
    setSelectedPresetId(preset.id);
    setUsername(preset.username);
    setPassword(preset.password);
    setError(null);
  };

  const initSakura = useCallback(() => {
    if (typeof window === "undefined") return;
    if (sakuraRef.current) return;
    const SakuraCtor = (window as Window & { Sakura?: new (selector: string, options?: unknown) => { stop: (graceful?: boolean) => void } }).Sakura;
    if (!SakuraCtor) return;

    sakuraRef.current = new SakuraCtor("[data-login-sakura='true']", {
      className: "sakura",
      fallSpeed: 1.25,
      minSize: 9,
      maxSize: 16,
      delay: 230,
      colors: [
        {
          gradientColorStart: "rgba(166, 210, 156, 0.9)",
          gradientColorEnd: "rgba(114, 176, 108, 0.9)",
          gradientColorDegree: 120,
        },
        {
          gradientColorStart: "rgba(132, 192, 121, 0.92)",
          gradientColorEnd: "rgba(83, 150, 88, 0.92)",
          gradientColorDegree: 140,
        },
        {
          gradientColorStart: "rgba(193, 227, 170, 0.88)",
          gradientColorEnd: "rgba(145, 196, 126, 0.88)",
          gradientColorDegree: 110,
        },
      ],
    });
  }, []);

  useEffect(() => {
    const cssId = "sakura-css";
    let ownedByThisPage = false;
    let link = document.getElementById(cssId) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "/vendor/sakura.css";
      document.head.appendChild(link);
      ownedByThisPage = true;
    }

    if ((window as Window & { Sakura?: unknown }).Sakura) {
      initSakura();
    }

    return () => {
      sakuraRef.current?.stop(true);
      sakuraRef.current = null;
      if (ownedByThisPage && link?.parentNode) {
        link.parentNode.removeChild(link);
      }
    };
  }, [initSakura]);

  const onRolePickerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (presets.length === 0) return;
    const activeIndex = selectedPresetIndex >= 0 ? selectedPresetIndex : 0;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = (activeIndex + 1) % presets.length;
      applyPreset(presets[next]);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const prev = (activeIndex - 1 + presets.length) % presets.length;
      applyPreset(presets[prev]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      applyPreset(presets[activeIndex]);
      return;
    }

    if (event.key === "1" || event.key === "2" || event.key === "3") {
      const idx = Number(event.key) - 1;
      if (idx >= 0 && idx < presets.length) {
        event.preventDefault();
        applyPreset(presets[idx]);
      }
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const role = await login(username, password);
      if (role === "operator") {
        router.push("/uploader");
      } else {
        router.push("/admin");
      }
    } catch {
      setError("Kullanıcı adı veya şifre hatalı.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!error) return;
    feedbackUi.notify({
      tone: "error",
      title: "Giriş Hatası",
      description: error,
    });
  }, [error, feedbackUi]);

  return (
    <main data-login-sakura="true" className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-[#F4F4F1] px-4 py-6">
      <Script src="/vendor/sakura.js" strategy="afterInteractive" onLoad={initSakura} />
      <section className="relative z-10 w-full max-w-[760px] rounded-[16px] border border-[#E2E4E0] bg-white p-8 shadow-[0_14px_34px_rgba(17,17,17,0.07)]">
        <div className="mb-7 flex justify-center">
          <Image src="/verenel.svg" alt="Verenel logo" width={220} height={84} className="h-16 w-auto object-contain" priority />
        </div>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="rounded-[10px] border border-[#E6E8E5] bg-[#F9F9F7] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[14px] font-semibold uppercase tracking-[0.08em] text-[#5A6063]">Rol Seçimi</p>
              {selectedPreset ? (
                <span className="saas-badge-info">Seçili: {selectedPreset.label}</span>
              ) : (
                <span className="saas-badge-warn">Preset dışı giriş</span>
              )}
            </div>
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
              tabIndex={0}
              role="listbox"
              aria-label="Rol seçimi"
              onKeyDown={onRolePickerKeyDown}
            >
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                role="option"
                aria-selected={selectedPresetId === preset.id}
                className={`transform-gpu rounded-[10px] border-2 px-3 py-3 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] ${
                  selectedPresetId === preset.id
                    ? "scale-[1.01] border-[#2E7D32] bg-[#F0F9F1] shadow-[0_0_0_3px_rgba(46,125,50,0.12)]"
                    : "border-[#DDE0DB] bg-[#FAFBF9] hover:border-[#BFC5C0] hover:bg-white"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <RoleIcon roleId={preset.id} selected={selectedPresetId === preset.id} />
                    <span className={`block text-[16px] font-semibold ${selectedPresetId === preset.id ? "text-[#1A6328]" : "text-[#202427]"}`}>{preset.label}</span>
                  </span>
                  {selectedPresetId === preset.id && (
                    <span className="rounded-full bg-[#2E7D32] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Seçili</span>
                  )}
                </span>
                <span className="mt-1 block text-[14px] font-medium text-[#676D70]">{preset.note}</span>
              </button>
            ))}
            </div>
            <p className="mt-2 rounded-[6px] bg-[#F5F5F3] px-2.5 py-1.5 text-[12px] font-medium text-[#5A6063]">
              ← → ile rol değiştir · 1 / 2 / 3 kısayolu · Enter ile seç
            </p>
          </div>

          <div>
            <label htmlFor="username" className="mb-1 block text-[16px] font-medium text-[#4F5458]">
              Kullanıcı Adı
            </label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="h-12 w-full rounded-[8px] border border-[#DFE2DE] bg-[#FAFBF9] px-3 text-[16px] outline-none focus:border-[#BFC5C0]"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-[16px] font-medium text-[#4F5458]">
              Şifre
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="h-12 w-full rounded-[8px] border border-[#DFE2DE] bg-[#FAFBF9] px-3 pr-11 text-[16px] outline-none focus:border-[#BFC5C0]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#787774] hover:text-[#4B4F52]"
                aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
              >
                {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 h-12 rounded-[10px] bg-[#111111] text-[16px] font-semibold text-white transition-colors hover:bg-[#2D3134] disabled:opacity-60"
          >
            {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>

          {error && (
            <p className="rounded-[8px] border border-[#F2DCDD] bg-[#FCEEEF] px-3 py-2 text-[16px] text-[#8B2E31]" role="alert">
              {error}
            </p>
          )}
        </form>
      </section>
    </main>
  );
}

function RoleIcon({ roleId, selected }: { roleId: AccountPreset["id"]; selected?: boolean }) {
  const color = selected ? "#2E7D32" : "#394045";
  if (roleId === "operator") return <UserCircle size={18} weight="duotone" className="" style={{ color }} />;
  if (roleId === "admin") return <ShieldCheck size={18} weight="duotone" className="" style={{ color }} />;
  return <CrownSimple size={18} weight="duotone" className="" style={{ color }} />;
}
