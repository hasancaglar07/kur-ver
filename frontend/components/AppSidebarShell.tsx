"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { ChartLineUp, Gauge, House, List, SignOut, UploadSimple, UsersThree, X } from "@phosphor-icons/react";

import { getMe, hasAuthToken, logout } from "@/lib/api";
import type { UserRole } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" }>;
  exact?: boolean;
  tab?: string;
};

const navItems: NavItem[] = [
  { href: "/", label: "Ana Akış", description: "Süreç özeti", icon: House, exact: true },
  { href: "/uploader", label: "Video Yükleme", description: "Operatör formu", icon: UploadSimple },
  { href: "/uploader/logs", label: "Gönderim Logları", description: "Kendi kayıt geçmişin", icon: List },
  { href: "/admin", label: "İnceleme", description: "Yönetim kuyruğu", icon: Gauge },
  { href: "/admin/logs", label: "Admin Logları", description: "Kendi onay/SMS kayıtların", icon: List },
  { href: "/admin/stats", label: "İstatistik", description: "Hata, log ve audit", icon: ChartLineUp },
  { href: "/admin?tab=operators", label: "Operatör Yönetimi", description: "Hesap ve rol yönetimi", icon: UsersThree, tab: "operators" },
];

const primaryNavHrefs = new Set([
  "/admin",
  "/admin/[id]",
  "/admin/logs",
  "/admin?tab=operators",
  "/admin/stats",
  "/uploader",
  "/uploader/logs",
]);

function isActivePath(pathname: string, href: string, exact?: boolean, activeTab?: string, tab?: string) {
  if (tab) return pathname === "/admin" && activeTab === tab;
  if (href === "/admin") {
    const isAdminRoot = pathname === "/admin" && activeTab !== "operators";
    const isAdminDetail = /^\/admin\/\d+$/.test(pathname);
    return isAdminRoot || isAdminDetail;
  }
  if (exact) return pathname === href;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebarShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sessionText, setSessionText] = useState("Oturum kontrol ediliyor...");
  const [meRole, setMeRole] = useState<UserRole | null>(null);
  const [monogram, setMonogram] = useState("");
  const activeTab = searchParams.get("tab") ?? "";
  const isPublicRoute = pathname === "/login" || pathname.startsWith("/izle/");
  const visibleNavItems = useMemo(() => {
    if (meRole === "operator") {
      return navItems.filter((item) => item.href === "/uploader" || item.href === "/uploader/logs");
    }
    if (meRole === "admin") {
      return navItems.filter((item) => item.href === "/admin" || item.href === "/admin/logs");
    }
    return navItems;
  }, [meRole]);
  const currentLabel = useMemo(() => {
    const found = visibleNavItems.find((item) => isActivePath(pathname, item.href, item.exact, activeTab, item.tab));
    return found?.label ?? "Panel";
  }, [activeTab, pathname, visibleNavItems]);

  useEffect(() => {
    if (isPublicRoute) return;
    if (!hasAuthToken()) {
      router.replace("/login");
      return;
    }

    let active = true;
    getMe()
      .then((me) => {
        if (!active) return;
        setMeRole(me.role);
        const displayName = [me.first_name, me.last_name].filter(Boolean).join(" ").trim() || me.username;
        const roleLabel = me.role === "operator" ? "Operatör" : me.role === "admin" ? "Yönetici" : "Süperadmin";
        setSessionText(`${displayName} · ${roleLabel}`);
        const initials = displayName
          .split(" ")
          .map((w: string) => w[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();
        setMonogram(initials || displayName.slice(0, 2).toUpperCase());
        if (me.role === "operator") {
          const allowed = pathname === "/uploader" || pathname === "/uploader/logs";
          if (!allowed) {
            router.replace("/uploader");
            return;
          }
        }
        if (me.role === "admin") {
          const forbidden =
            pathname === "/uploader" ||
            pathname.startsWith("/uploader/") ||
            pathname === "/admin/stats" ||
            (pathname === "/admin" && activeTab === "operators");
          if (forbidden) {
            router.replace("/admin");
            return;
          }
        }
      })
      .catch(() => {
        logout();
        router.replace("/login");
      });

    return () => {
      active = false;
    };
  }, [activeTab, isPublicRoute, pathname, router]);

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-[#FBFBFA] text-[#2F3437]">
      <div className="flex min-h-[100dvh]">
        <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 border-r border-[#EAEAEA] bg-white p-5 lg:flex lg:flex-col">
          <Link href="/" className="rounded-[12px] border border-[#E6E6E3] bg-[#FAFAF8] px-4 py-5 shadow-[0_8px_24px_rgba(17,17,17,0.06)]">
            <div className="flex min-h-[96px] items-center justify-center overflow-hidden rounded-[10px] border border-[#DFDFDC] bg-white px-2">
              <Image src="/verenel.svg" alt="Verenel logo" width={200} height={72} className="h-20 w-auto object-contain" priority />
            </div>
          </Link>

          <nav aria-label="Sidebar" className="mt-6 grid gap-1.5">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#787774]">Öncelikli</p>
            {visibleNavItems.map((item) => {
              const isPrimary = primaryNavHrefs.has(item.href);
              if (!isPrimary) return null;
              const active = isActivePath(pathname, item.href, item.exact, activeTab, item.tab);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-2 rounded-[8px] border px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-[#D4EDD8] bg-[#F0F9F1] text-[#1A6328] before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[#2E7D32]"
                      : "border-transparent text-[#4B4F52] hover:border-[#EAEAEA] hover:bg-[#F9F9F8]"
                  )}
                >
                  <Icon size={16} weight={active ? "fill" : "regular"} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{item.label}</p>
                    <p className="truncate text-xs text-[#787774]">{item.description}</p>
                  </div>
                </Link>
              );
            })}

            <p className="mt-2 px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#787774]">Diğer</p>
            {visibleNavItems.map((item) => {
              const isPrimary = primaryNavHrefs.has(item.href);
              if (isPrimary) return null;
              const active = isActivePath(pathname, item.href, item.exact, activeTab, item.tab);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative flex items-center gap-2 rounded-[8px] border px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-[#D4EDD8] bg-[#F0F9F1] text-[#1A6328] before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[#2E7D32]"
                      : "border-transparent text-[#4B4F52] hover:border-[#EAEAEA] hover:bg-[#F9F9F8]"
                  )}
                >
                  <Icon size={16} weight={active ? "fill" : "regular"} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.label}</p>
                    <p className="truncate text-xs text-[#787774]">{item.description}</p>
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-[#EAEAEA] pt-4 text-xs text-[#787774]">Kurumsal sürüm</div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-[#EAEAEA] bg-white px-4 py-3 md:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileOpen((prev) => !prev)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#EAEAEA] bg-white text-[#4B4F52] lg:hidden"
                  aria-label="Menüyü aç"
                >
                  {mobileOpen ? <X size={16} /> : <List size={16} />}
                </button>
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-[#787774]">Çalışma Alanı</p>
                  <p className="text-sm font-semibold text-[#111111]">{currentLabel}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-2 md:flex">
                  {monogram && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E8F5E9] text-[11px] font-bold text-[#2E7D32]">
                      {monogram}
                    </div>
                  )}
                  <span className="rounded-[999px] border border-[#EAEAEA] bg-[#F9F9F8] px-3 py-1.5 text-xs font-medium text-[#4B4F52]">
                    {sessionText}
                  </span>
                </div>
                <button
                  className="inline-flex items-center gap-1 rounded-[6px] border border-[#EAEAEA] bg-white px-3 py-2 text-sm font-medium text-[#4B4F52] transition-colors hover:border-[#D0D0CF] hover:bg-[#F5F5F4] active:scale-[0.98]"
                  onClick={() => {
                    logout();
                    router.push("/login");
                  }}
                >
                  <SignOut size={14} />
                  <span className="hidden sm:inline">Çıkış</span>
                </button>
              </div>
            </div>

            {mobileOpen && (
              <nav className="mt-3 grid gap-1 overflow-hidden rounded-[8px] border border-[#EAEAEA] bg-white p-2 lg:hidden animate-in slide-in-from-top-2 duration-200">
                {visibleNavItems.map((item) => {
                  const active = isActivePath(pathname, item.href, item.exact, activeTab, item.tab);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={`m-${item.href}`}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "relative flex items-center gap-2 rounded-[6px] px-3 py-2 text-sm",
                        active ? "bg-[#F0F9F1] text-[#1A6328] before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[#2E7D32]" : "text-[#4B4F52]"
                      )}
                    >
                      <Icon size={15} weight={active ? "fill" : "regular"} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            )}
          </header>

          <div className="flex-1 px-4 pb-8 pt-5 md:px-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
