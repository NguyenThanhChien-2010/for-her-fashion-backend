import * as Joi from 'joi';

export const appConfigValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  DATABASE_URL: Joi.string().required(),

  JWT_SECRET: Joi.string().min(16).optional(),
  JWT_ACCESS_SECRET: Joi.string().min(16).optional(),
  JWT_REFRESH_SECRET: Joi.string().min(16).optional(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REMEMBER_ME_EXPIRES_IN: Joi.string().default('30d'),

  MAX_FILE_SIZE_MB: Joi.number().positive().default(5),
  UPLOAD_DEST: Joi.string().default('./uploads'),
  THROTTLE_TTL_SECONDS: Joi.number().positive().default(60),
  THROTTLE_LIMIT: Joi.number().positive().default(100),
  ALLOWED_ORIGINS: Joi.string().allow('').default(''),
}).or('JWT_SECRET', 'JWT_ACCESS_SECRET');
