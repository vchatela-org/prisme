export { loadConfig, loadConfigOrExit, ConfigError } from './load.js';
export type {
  Config,
  AuthConfig,
  SyncConfig,
  CapacityConfig,
  ConfigProblem,
  LoadConfigOptions,
} from './load.js';

export { SERVICES, VARIABLES, requiredFor } from './schema.js';
export type { Service, VariableName } from './schema.js';

export { collectEnv, parseEnvFile, ConfigSourceError } from './sources.js';
export type { RawEnv, SourceOptions } from './sources.js';
