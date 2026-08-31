import { z } from 'zod';

const freebuffRateLimitSchema = z.object({
  model: z.string(),
  limit: z.number().nonnegative(),
  period: z.enum(["pacific_day", "pacific_week"]),
  resetTimeZone: z.string(),
  resetAt: z.string().datetime(),
  windowHours: z.number().nonnegative().optional(),
  recentCount: z.number().nonnegative(),
});

const freebuffSessionResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("active"),
    instanceId: z.string().uuid(),
    model: z.string(),
    admittedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    remainingMs: z.number().nonnegative(),
    accessTier: z.enum(["full", "limited"]),
    countryCode: z.string().optional(),
    countryBlockReason: z.string().optional(),
    rateLimit: freebuffRateLimitSchema.optional(),
    rateLimitsByModel: z.record(z.string(), freebuffRateLimitSchema).optional(),
  }),
  z.object({
    status: z.literal("waiting"),
    position: z.number().int().positive(),
    estimatedWaitMs: z.number().nonnegative().optional(),
  }),
  z.object({
    status: z.literal("ended"),
  }),
]);

const sampleBody = {
  "status": "active",
  "accessTier": "limited",
  "instanceId": "3671b709-3fc9-4417-9068-a73eebcfa916",
  "model": "deepseek/deepseek-v4-flash",
  "admittedAt": "2026-07-13T17:10:02.087Z",
  "expiresAt": "2026-07-13T18:10:02.087Z",
  "remainingMs": 2412180,
  "countryCode": "US",
  "countryBlockReason": "anonymous_network",
  "ipPrivacySignals": [
    "hosting"
  ],
  "rateLimit": {
    "model": "deepseek/deepseek-v4-flash",
    "limit": 5,
    "period": "pacific_day",
    "resetTimeZone": "America/Los_Angeles",
    "resetAt": "2026-07-14T07:00:00.000Z",
    "windowHours": 24,
    "recentCount": 2
  },
  "rateLimitsByModel": {
    "deepseek/deepseek-v4-flash": {
      "model": "deepseek/deepseek-v4-flash",
      "limit": 5,
      "period": "pacific_day",
      "resetTimeZone": "America/Los_Angeles",
      "resetAt": "2026-07-14T07:00:00.000Z",
      "windowHours": 24,
      "recentCount": 2
    },
    "mimo/mimo-v2.5": {
      "model": "mimo/mimo-v2.5",
      "limit": 5,
      "period": "pacific_day",
      "resetTimeZone": "America/Los_Angeles",
      "resetAt": "2026-07-14T07:00:00.000Z",
      "windowHours": 24,
      "recentCount": 2
    }
  }
};

const res = freebuffSessionResponseSchema.safeParse(sampleBody);
if (!res.success) {
  console.log('FAIL:', JSON.stringify(res.error.format(), null, 2));
} else {
  console.log('SUCCESS:', res.data);
}
