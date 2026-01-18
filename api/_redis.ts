import { Redis } from "@upstash/redis";

/**
 * Supports both:
 * - KV_* (Vercel KV classic)
 * - STORAGE_* (your current Upstash connection with custom prefix STORAGE)
 */
export function getRedis() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.STORAGE_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_URL;

  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.STORAGE_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Missing Redis env. Expected KV_REST_API_URL/TOKEN or STORAGE_REST_API_URL/TOKEN (or UPSTASH_REDIS_REST_URL/TOKEN)."
    );
  }

  return new Redis({ url, token });
}
