import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand emerald accent
        brand: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
        },
        // Neutral grey-green canvas
        canvas: "#f4f7f5",
        ink: {
          DEFAULT: "#0f1f1a",
          soft: "#3c4b45",
          muted: "#6b7a73",
        },
        risk: {
          low: "#059669",
          medium: "#d97706",
          high: "#dc2626",
          unknown: "#6b7280",
        },
      },
      fontFamily: {
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,31,26,0.04), 0 8px 24px -12px rgba(15,31,26,0.12)",
        "card-hover": "0 2px 4px rgba(15,31,26,0.06), 0 16px 40px -16px rgba(15,31,26,0.18)",
        "card-elevated": "0 2px 4px rgba(15,31,26,0.06), 0 24px 48px -12px rgba(15,31,26,0.18), 0 0 0 1px rgba(15,31,26,0.03)",
        "glow-brand": "0 0 0 3px rgba(5,150,105,0.15), 0 0 0 1px rgba(5,150,105,0.1)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
