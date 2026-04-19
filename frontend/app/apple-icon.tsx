import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          borderRadius: 36,
          overflow: "hidden",
          background: "linear-gradient(145deg, #1f3f30 0%, #6fc848 100%)",
          alignItems: "center",
          justifyContent: "center",
          color: "#f7fff0",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 22% 20%, rgba(255,255,255,0.26), transparent 44%)",
          }}
        />
        <div
          style={{
            zIndex: 2,
            display: "flex",
            fontWeight: 800,
            fontSize: 102,
            lineHeight: 1,
            letterSpacing: -2,
          }}
        >
          K
        </div>
      </div>
    ),
    size
  );
}
