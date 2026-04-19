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
          background:
            "radial-gradient(circle at 15% 18%, #f3ffe9 0, #eef9df 24%, #dde9c7 46%, #c8d6b3 70%, #b6c5a1 100%)",
          fontFamily: "sans-serif",
          color: "#1f2c1b",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(128deg, rgba(255,255,255,0.58), rgba(255,255,255,0.04) 62%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -90,
            right: -120,
            width: 420,
            height: 420,
            borderRadius: "50%",
            background: "rgba(111, 200, 72, 0.25)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -120,
            left: -80,
            width: 360,
            height: 360,
            borderRadius: "50%",
            background: "rgba(28, 79, 73, 0.20)",
          }}
        />

        <div
          style={{
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            width: "100%",
            padding: "64px 72px",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                background: "#6fc848",
              }}
            />
            <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.4 }}>Verenel Kurban</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 76, lineHeight: 1.02, fontWeight: 800, letterSpacing: -1.4 }}>
              Kurbanınız Hazır
            </div>
            <div style={{ fontSize: 34, lineHeight: 1.25, opacity: 0.9, maxWidth: 920 }}>
              Kesim videonuzu güvenle izleyin, paylaşın.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            {["Şeffaf", "Güvenli", "Anında İzleme"].map((item) => (
              <div
                key={item}
                style={{
                  display: "flex",
                  padding: "10px 18px",
                  borderRadius: 999,
                  fontSize: 23,
                  fontWeight: 600,
                  color: "#234d1f",
                  background: "rgba(255,255,255,0.74)",
                  border: "1px solid rgba(255,255,255,0.85)",
                }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
