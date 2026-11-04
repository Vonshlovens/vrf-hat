import { defineEnvVars } from "@sveltejs/kit/env";

const optional = (value: string | undefined) => value || undefined;

export const variables = defineEnvVars({
  DATABASE_URL: { description: "Neon Postgres connection string (pooled)." },
  ORIGIN: { description: "The app origin, e.g. `http://localhost:5173`." },
  BETTER_AUTH_SECRET: { description: "Secret used to sign sessions. 32+ random bytes." },

  GITHUB_CLIENT_ID: { schema: optional, description: "Enables GitHub sign-in when set." },
  GITHUB_CLIENT_SECRET: { schema: optional },
  GOOGLE_CLIENT_ID: { schema: optional, description: "Enables Google sign-in when set." },
  GOOGLE_CLIENT_SECRET: { schema: optional },
  DISCORD_CLIENT_ID: { schema: optional, description: "Enables Discord sign-in when set." },
  DISCORD_CLIENT_SECRET: { schema: optional },

  RESEND_API_KEY: {
    schema: optional,
    description:
      "Sends magic-link emails through Resend. Without it, links are logged to the server console.",
  },
  EMAIL_FROM: {
    schema: optional,
    description: 'Sender for magic links, e.g. `"VRF Hat <hat@example.com>"`.',
  },

  DRAWER_PRIVATE_KEY: {
    schema: (value) => {
      if (value && !/^0x[0-9a-fA-F]{64}$/.test(value))
        throw new Error("expected a 0x-prefixed 32-byte hex key");
      return value as `0x${string}` | undefined;
    },
    description:
      "Key that owns RaffleDraw and pays gas for draw requests. Without it, draws are disabled.",
  },
  RPC_URL: {
    schema: optional,
    description: "Server RPC endpoint. Defaults to the chain's public RPC.",
  },

  PUBLIC_CHAIN_ID: {
    public: true,
    schema: (value) => Number(value || 84532),
    description: "31337 (local Hardhat), 84532 (Base Sepolia) or 8453 (Base).",
  },
  PUBLIC_RAFFLE_CONTRACT: {
    public: true,
    schema: (value) => (value || undefined) as `0x${string}` | undefined,
    description: "Deployed RaffleDraw address.",
  },
  PUBLIC_RPC_URL: {
    public: true,
    schema: optional,
    description: "RPC the browser uses to verify draws. Defaults to the chain's public RPC.",
  },
});
