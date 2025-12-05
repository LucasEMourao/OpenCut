import { betterAuth, RateLimit } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@opencut/db";
import { keys } from "./keys";
import { Redis } from "@upstash/redis";

const {
  NEXT_PUBLIC_BETTER_AUTH_URL,
  BETTER_AUTH_SECRET,
  UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN,
} = keys();

const baseURL = NEXT_PUBLIC_BETTER_AUTH_URL ?? "http://localhost:3000";
const secret = BETTER_AUTH_SECRET ?? "dev-secret";

const redis =
  UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: UPSTASH_REDIS_REST_URL,
        token: UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
  }),
  user: {
    deleteUser: {
      enabled: true,
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  rateLimit: {
    storage: "secondary-storage",
    customStorage: {
      get: async (key) => {
        if (!redis) return undefined;

        const value = await redis.get(key);
        return value as RateLimit | undefined;
      },
      set: async (key, value) => {
        if (!redis) return;

        await redis.set(key, value);
      },
    },
  },
  baseURL,
  appName: "OpenCut",
  trustedOrigins: ["http://localhost:3000"],
  secret,
});

export type Auth = typeof auth;
