/**
 * TR-DB-003: the active engine and profile are selected by configuration alone.
 * Nothing below is compiled in, so one build artifact serves both profiles.
 */

export type DbEngine = 'sqlite' | 'postgres';
export type AppProfile = 'local-preview' | 'deployed';

export interface Config {
  readonly profile: AppProfile;
  readonly engine: DbEngine;
  readonly sqliteFile: string;
  readonly databaseUrl: string | undefined;
  readonly port: number;
  readonly host: string;
  readonly sessionSecret: string;
  readonly corsOrigin: string;
  /** TR-DB-008: surfaced through the API so the UI can say what it is. */
  readonly isPreview: boolean;
}

/** Used only by the local preview profile, which never holds real data (§8.4.3). */
const PREVIEW_SESSION_SECRET = 'local-preview-only-not-a-secret-0000000000000000';

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const profile = (env.APP_PROFILE ?? 'local-preview') as AppProfile;
  if (profile !== 'local-preview' && profile !== 'deployed') {
    throw new ConfigError(`APP_PROFILE must be 'local-preview' or 'deployed', got '${profile}'`);
  }

  const engine = (env.DB_ENGINE ?? (profile === 'deployed' ? 'postgres' : 'sqlite')) as DbEngine;
  if (engine !== 'sqlite' && engine !== 'postgres') {
    throw new ConfigError(`DB_ENGINE must be 'sqlite' or 'postgres', got '${engine}'`);
  }

  if (engine === 'postgres' && !env.DATABASE_URL) {
    throw new ConfigError('DATABASE_URL is required when DB_ENGINE=postgres');
  }

  // §8.4.3 draws the line: the preview profile is exempt from the deployed
  // profile's obligations precisely because it must never hold real data.
  let sessionSecret = env.SESSION_SECRET ?? '';
  if (profile === 'deployed') {
    if (sessionSecret.length < 32) {
      throw new ConfigError(
        'SESSION_SECRET of at least 32 characters is required under APP_PROFILE=deployed',
      );
    }
  } else if (sessionSecret.length === 0) {
    sessionSecret = PREVIEW_SESSION_SECRET;
  }

  return {
    profile,
    engine,
    sqliteFile: env.SQLITE_FILE ?? './data/sddfreak.db',
    databaseUrl: env.DATABASE_URL,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    sessionSecret,
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
    isPreview: profile === 'local-preview',
  };
}
