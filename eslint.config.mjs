import nextConfig from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".next/**",
      ".next 2/**",
      ".worktrees/**",
      ".claude/**",
      ".agents/**",
      ".planning/**",
      "node_modules/**",
      "**/node_modules/**",
      ".cache/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "public/ffmpeg/**",
      "public/ffmpeg-mt/**",
      "create-agentic-app/**",
      "drizzle/**",
      "scripts/**",
    ],
  },
  ...nextConfig,
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
];

export default config;
