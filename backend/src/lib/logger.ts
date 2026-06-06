/**
 * Zero-dependency structured logger.
 *
 * Emits one JSON object per line (newline-delimited JSON) so logs are ready for
 * shipping to Loki / Datadog / CloudWatch without a parser. Set LOG_PRETTY=true
 * for human-readable lines in local development. Level via LOG_LEVEL
 * (debug|info|warn|error), default info.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').trim().toLowerCase() as LogLevel;
  return LEVELS[raw] ?? LEVELS.info;
}

const MIN_LEVEL = configuredLevel();
const PRETTY = process.env.LOG_PRETTY === 'true';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

function emit(level: LogLevel, base: LogFields, msg: string, fields?: LogFields): void {
  if (LEVELS[level] < MIN_LEVEL) return;
  const record = { level, time: new Date().toISOString(), msg, ...base, ...fields };
  let line: string;
  if (PRETTY) {
    const extra = { ...base, ...fields };
    const tail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
    line = `${record.time} ${level.toUpperCase().padEnd(5)} ${msg}${tail}`;
  } else {
    line = JSON.stringify(record);
  }
  const stream = level === 'warn' || level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

function make(base: LogFields): Logger {
  return {
    debug: (msg, fields) => emit('debug', base, msg, fields),
    info: (msg, fields) => emit('info', base, msg, fields),
    warn: (msg, fields) => emit('warn', base, msg, fields),
    error: (msg, fields) => emit('error', base, msg, fields),
    child: (bindings) => make({ ...base, ...bindings }),
  };
}

export const logger: Logger = make({ service: 'qantara-backend' });
