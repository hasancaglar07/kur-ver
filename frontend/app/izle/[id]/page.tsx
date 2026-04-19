import "./watch.css";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

type WatchPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: WatchPageProps): Promise<Metadata> {
  const { id } = await params;
  return {
    title: "Kurban Videonuz Hazır",
    description: "Kurban kesim videonuzu güvenli bağlantı üzerinden izleyin.",
    openGraph: {
      title: "Kurban Videonuz Hazır",
      description: "Kurban kesim videonuzu güvenli bağlantı üzerinden izleyin.",
      images: [`/izle/${id}/opengraph-image`],
      type: "video.other",
    },
    twitter: {
      card: "summary_large_image",
      title: "Kurban Videonuz Hazır",
      description: "Kurban kesim videonuzu güvenli bağlantı üzerinden izleyin.",
      images: [`/izle/${id}/opengraph-image`],
    },
  };
}

const leaves = [
  { left: "6%", size: "16px", drift: "-28px", delay: "0s", duration: "12s" },
  { left: "13%", size: "20px", drift: "22px", delay: "1.1s", duration: "13.5s" },
  { left: "21%", size: "15px", drift: "-18px", delay: "2.7s", duration: "11.8s" },
  { left: "31%", size: "22px", drift: "28px", delay: "3.2s", duration: "14.2s" },
  { left: "42%", size: "19px", drift: "-24px", delay: "0.9s", duration: "12.7s" },
  { left: "52%", size: "17px", drift: "20px", delay: "4.1s", duration: "13.8s" },
  { left: "63%", size: "23px", drift: "-22px", delay: "2.2s", duration: "15.1s" },
  { left: "73%", size: "16px", drift: "24px", delay: "5.3s", duration: "12.6s" },
  { left: "81%", size: "21px", drift: "-16px", delay: "1.8s", duration: "13.2s" },
  { left: "90%", size: "18px", drift: "20px", delay: "3.9s", duration: "14s" },
];

function apiRootFromEnv(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000/api";
  return apiBase.replace(/\/api\/?$/, "");
}

export default async function WatchPage({ params }: WatchPageProps) {
  const { id } = await params;
  const videoUrl = `${apiRootFromEnv()}/w/s/${encodeURIComponent(id)}`;

  return (
    <main className="watch-page">
      <div className="watch-leaf-layer" aria-hidden>
        {leaves.map((leaf, index) => (
          <span
            key={`leaf-${index}`}
            className="watch-leaf"
            style={
              {
                "--leaf-left": leaf.left,
                "--leaf-size": leaf.size,
                "--leaf-drift": leaf.drift,
                "--leaf-delay": leaf.delay,
                "--leaf-duration": leaf.duration,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <section className="relative z-[1] mx-auto flex w-full max-w-[1160px] flex-col px-3 py-5 sm:px-6 sm:py-8 md:py-10">
        <div className="watch-card overflow-hidden rounded-[20px] border border-white/55 bg-white/72 p-3 shadow-[0_28px_72px_rgba(41,32,12,0.18)] sm:p-5 md:rounded-[24px] md:p-7">
          <div className="watch-head mb-4 md:mb-5">
            <Image src="/verenel.svg" alt="Verenel logo" width={172} height={64} className="h-11 w-auto object-contain sm:h-12" priority />
            <h1 className="mt-2 text-[clamp(24px,3.4vw,40px)] font-semibold leading-[1.08] tracking-[-0.03em] text-[#181812]">
              Kurban Videonuz Hazır
            </h1>
            <p className="mt-1 text-[13px] text-[#4f513e] sm:text-[14px]">Tek dokunuşla izleyin.</p>
          </div>

          <video
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            className="watch-video w-full rounded-[14px] border border-[#d6d0bf] bg-black object-contain shadow-[0_20px_50px_rgba(0,0,0,0.34)]"
          />

          <div className="watch-app-cta mt-4 rounded-2xl border border-[#d8d2c1] bg-[#f7f4ec] p-3 sm:mt-5 sm:p-4">
            <p className="text-[13px] font-medium text-[#2f3127] sm:text-[14px]">Uygulamamızı indirerek kurban süreçlerinizi daha hızlı takip edebilirsiniz.</p>
            <Link
              href="https://www.verenel.com.tr/"
              target="_blank"
              rel="noopener noreferrer"
              className="watch-app-link mt-2 inline-flex items-center justify-center rounded-full px-4 py-2 text-[13px] font-semibold text-white sm:text-[14px]"
            >
              Uygulamaları Gör
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
