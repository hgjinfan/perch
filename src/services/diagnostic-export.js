import packageJson from '../../package.json' with { type: 'json' };
import { healthAdvice } from './config-health.js';

// Explicit allowlists only. Names, IDs, URLs, variable names and arbitrary messages are excluded.
const numeric = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
export function createDiagnosticExport(config, diagnostics, health, runtime = {}) {
  const kinds = ['service', 'feed', 'widget', 'weather'];
  return {
    format: 'perch-diagnostics',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    application: {
      version: packageJson.version,
      nodeMajor: Number(process.versions.node.split('.')[0]),
    },
    scope: 'saved-config-and-current-process-observations',
    note: '未主动请求上游；未检查不表示健康。报告不包含名称、标识、地址、密钥、变量名或原始响应。',
    counts: {
      connections: (config.connections || []).length,
      widgets: config.widgets.length,
      services: config.services.length,
      feeds: config.feeds.length,
    },
    health: {
      summary: Object.fromEntries(
        ['errors', 'warnings', 'information', 'unchecked'].map((key) => [
          key,
          numeric(health.summary[key]),
        ]),
      ),
      truncated: health.truncated === true,
      findings: health.findings
        .filter((f) => Object.hasOwn(healthAdvice, f.code))
        .map((f) => ({
          scope: oneOf(f.scope, [...kinds, 'connection'], 'unknown'),
          severity: oneOf(f.severity, ['error', 'warning', 'info'], 'info'),
          code: f.code,
          title: healthAdvice[f.code][0],
          advice: healthAdvice[f.code][1],
        })),
    },
    sources: diagnostics.sources.map((source, index) => ({
      reference: `source-${index + 1}`,
      kind: oneOf(source.kind, kinds, 'unknown'),
      enabled: source.enabled === true,
      configured: source.configured === true,
      state: oneOf(source.state, ['ready', 'error', 'stale', 'idle'], 'idle'),
      checking: source.checking === true,
      cacheState: oneOf(source.cacheState, ['fresh', 'backoff', 'expired', 'empty'], 'empty'),
      failures: numeric(source.failures),
      durationMs: numeric(source.durationMs),
      lastAttemptAt: numeric(source.lastAttemptAt),
      lastSuccessAt: numeric(source.lastSuccessAt),
      lastFailureAt: numeric(source.lastFailureAt),
      expiresAt: numeric(source.expiresAt),
      httpStatus:
        Number.isInteger(source.httpStatus) && source.httpStatus >= 100 && source.httpStatus <= 599
          ? source.httpStatus
          : null,
      lastErrorCode: Object.hasOwn(healthAdvice, source.error?.code || '')
        ? source.error.code
        : null,
    })),
    runtime: Object.fromEntries(
      [
        'active',
        'concurrency',
        'queued',
        'maxQueue',
        'backgroundActive',
        'cooling',
        'completed',
        'failed',
        'rejected',
      ].map((key) => [key, numeric(runtime[key])]),
    ),
  };
}
