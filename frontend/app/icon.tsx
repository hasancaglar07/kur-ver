import { ImageResponse } from "next/og";

export const size = {
  width: 64,
  height: 64,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          borderRadius: 14,
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
            display: "flex",
            zIndex: 2,
            fontWeight: 800,
            fontSize: 38,
            lineHeight: 1,
            letterSpacing: -1,
          }}
        >
          K
        </div>
      </div>
    ),
    size
  );
}
