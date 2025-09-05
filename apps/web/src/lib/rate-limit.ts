// lib/rate-limit.ts
// Implementação "falsa" para contornar a dependência do Redis

console.log("⚠️ O limitador de requisições (Redis) está desativado.");

export const baseRateLimit = {
  limit: async (identifier: string) => {
    return {
      success: true,
      limit: 100,
      remaining: 100,
      reset: Date.now() + 60000,
    };
  },
};