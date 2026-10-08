import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "Personal AI Genie";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #1e1b4b 0%, #4c1d95 50%, #831843 100%)",
          color: "white",
          fontFamily: "sans-serif",
          padding: "40px",
          textAlign: "center",
        }}
      >
        {/* Glow Logo Badge */}
        <div
          style={{
            width: "140px",
            height: "140px",
            borderRadius: "40px",
            background: "linear-gradient(135deg, #7c3aed, #ec4899, #f59e0b)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
            marginBottom: "30px",
            fontSize: "70px",
          }}
        >
          ✨
        </div>

        <h1
          style={{
            fontSize: "64px",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            marginBottom: "16px",
            background: "linear-gradient(to right, #ffffff, #fbcfe8, #fed7aa)",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Personal AI Genie
        </h1>

        <p
          style={{
            fontSize: "28px",
            color: "#cbd5e1",
            maxWidth: "800px",
            lineHeight: 1.4,
          }}
        >
          Autonomous Collaborative Team Workspace & Gen AI Companion
        </p>
      </div>
    ),
    {
      ...size,
    }
  );
}