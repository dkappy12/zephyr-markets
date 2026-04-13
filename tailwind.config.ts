import type { Config } from "tailwindcss";

export default {
  theme: {
    extend: {
      colors: {
        ivory: "#F5F0E8",
        "ivory-dark": "#EDE7D9",
        "ivory-border": "#D9D2C4",
        card: "#FDFBF7",
        ink: "#2C2A26",
        "ink-dark": "#2C2A26",
        "ink-mid": "#6B6760",
        "ink-light": "#9E9890",
        bull: "#1D6B4E",
        bear: "#9B3D20",
        watch: "#8C5A0E",
        gold: "#8C6D1F",
      },
      fontFamily: {
        sans: [
          "var(--font-dm-sans)",
          "DM Sans",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        serif: [
          "var(--font-cormorant)",
          "Cormorant Garamond",
          "ui-serif",
          "Georgia",
          "serif",
        ],
      },
    },
  },
} satisfies Config;
