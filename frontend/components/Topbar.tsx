"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { logout } from "@/lib/api";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Ana Sayfa" },
  { href: "/uploader", label: "Operatör" },
  { href: "/admin", label: "Yönetim" },
];

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="topbar">
      <div>
        <div className="logo">Kurban Video Merkezi</div>
        <p className="logo-sub">Yükleme, doğrulama ve teslim süreçleri</p>
      </div>
      <nav className="topbar-nav" aria-label="Ana gezinme">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link key={item.href} className={cn("nav-link", isActive && "nav-link-active")} href={item.href}>
              {item.label}
            </Link>
          );
        })}
        {pathname !== "/login" && (
          <button
            className="ghost"
            onClick={() => {
              logout();
              router.push("/login");
            }}
          >
            Çıkış Yap
          </button>
        )}
      </nav>
    </header>
  );
}
