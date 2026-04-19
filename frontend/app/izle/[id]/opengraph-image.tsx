import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          fontFamily: "sans-serif",
          background:
            "linear-gradient(135deg, #1f3a2a 0%, #2c5a3a 34%, #6fc848 100%)",
          color: "#f9fff3",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 82% 20%, rgba(255,255,255,0.24), transparent 42%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -80,
            right: -90,
            width: 300,
            height: 300,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.25)",
          }}
        />

        <div
          style={{
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            padding: "64px 72px",
          }}
        >
          <div style={{ fontSize: 30, opacity: 0.95, fontWeight: 700 }}>Verenel Kurban</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 78, lineHeight: 1.02, fontWeight: 800, letterSpacing: -1.2 }}>
              Kurban Videonuz
            </div>
            <div style={{ fontSize: 78, lineHeight: 1.02, fontWeight: 800, letterSpacing: -1.2 }}>
              İzlemeye Hazır
            </div>
            <div style={{ fontSize: 31, lineHeight: 1.25, opacity: 0.92 }}>
              Linke tıklayın, videoyu güvenle açın.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              padding: "12px 18px",
              borderRadius: 999,
              width: "fit-content",
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.25)",
              fontSize: 24,
            }}
          >
            kurban.verenel.com.tr
          </div>
        </div>
      </div>
    ),
    size
  );
}
