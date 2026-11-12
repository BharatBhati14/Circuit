import { env } from "@circuit/config";

export const redisConnection = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
};
