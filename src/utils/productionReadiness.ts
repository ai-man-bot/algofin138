type CheckStatus = 'pass' | 'warn' | 'fail';
type ReadinessStatus = 'ready' | 'warning' | 'blocked';

export interface ProductionReadinessCheck {
  name: string;
  status: CheckStatus;
  details?: string;
}

export interface ProductionReadinessInput {
  requiredEnvVars: string[];
  presentEnvVars: string[];
  requiredMigrations: string[];
  appliedMigrations: string[];
  requiredRoutes: string[];
  availableRoutes: string[];
  checks: ProductionReadinessCheck[];
}

export interface ProductionReadinessReport {
  status: ReadinessStatus;
  blockers: string[];
  warnings: string[];
  passed: string[];
}

function missing(required: string[], present: string[]) {
  const presentSet = new Set(present);
  return required.filter((item) => !presentSet.has(item));
}

export function evaluateProductionReadiness(input: ProductionReadinessInput): ProductionReadinessReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const passed: string[] = [];

  for (const envVar of missing(input.requiredEnvVars, input.presentEnvVars)) {
    blockers.push(`Missing required environment variable: ${envVar}`);
  }

  for (const migration of missing(input.requiredMigrations, input.appliedMigrations)) {
    blockers.push(`Missing required migration/table: ${migration}`);
  }

  for (const route of missing(input.requiredRoutes, input.availableRoutes)) {
    blockers.push(`Missing required route: ${route}`);
  }

  for (const check of input.checks) {
    if (check.status === 'fail') {
      blockers.push(`${check.name} failed${check.details ? `: ${check.details}` : ''}`);
    } else if (check.status === 'warn') {
      warnings.push(`${check.name} warning${check.details ? `: ${check.details}` : ''}`);
    } else {
      passed.push(check.name);
    }
  }

  return {
    status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready',
    blockers,
    warnings,
    passed,
  };
}

export function summarizeReadiness(report: ProductionReadinessReport) {
  return [
    `Production readiness: ${report.status}`,
    `blockers=${report.blockers.length}`,
    `warnings=${report.warnings.length}`,
    `passed=${report.passed.length}`,
  ].join('; ');
}
