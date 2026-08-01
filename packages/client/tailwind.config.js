/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f4f7f5",
          100: "#e4ebe6",
          200: "#c7d5cc",
          300: "#9fb5a8",
          400: "#739184",
          500: "#557568",
          600: "#425d52",
          700: "#364b43",
          800: "#2d3e38",
          900: "#263430",
          950: "#131c19",
        },
        accent: {
          50: "#f3faf7",
          100: "#d7f0e6",
          200: "#b0e0cd",
          300: "#7fc9af",
          400: "#52ab8e",
          500: "#368f73",
          600: "#28735c",
          700: "#225c4b",
          800: "#1e4a3e",
          900: "#1a3d34",
        },
        sand: {
          50: "#fbf8f3",
          100: "#f3ece1",
          200: "#e6d7c0",
        },
        danger: {
          500: "#b42318",
          600: "#912018",
        },
        warn: {
          500: "#b54708",
          600: "#93370d",
        },
      },
      fontFamily: {
        display: ["\"Source Serif 4\"", "Georgia", "serif"],
        sans: ["\"DM Sans\"", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["\"IBM Plex Mono\"", "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "0 10px 40px -20px rgba(19, 28, 25, 0.35)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(38,52,48,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(38,52,48,0.06) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};
