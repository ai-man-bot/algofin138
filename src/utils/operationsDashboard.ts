import {
  evaluateProductionReadiness,
  type ProductionReadinessReport,
} from './productionReadiness.ts';

export type OperationsPanelId =
  | 'risk'
  | 'oms'
  | 'options'
  | 'automation'
  | 'readiness';

export interface OperationsPanelDefinition {
  id: OperationsPanelId;
  label: string;
  title: string;
  description: string;
}

export const operationsPanels: OperationsPanelDefinition[] = [
  {
    id: 'risk',
    label: 'Risk',
    title: 'Risk Settings and Audit Review',
    description: 'Configure account-level controls and review recent risk decisions.',
  },
  {
    id: 'oms',
    label: 'OMS',
    title: 'OMS Order Lifecycle',
    description: 'Track lifecycle status, fills, and reconciliation events.',
  },
  {
    id: 'options',
    label: 'Options',
    title: 'Options Order Review',
    description: 'Stage single-leg and vertical-spread orders before routing.',
  },
  {
    id: 'automation',
    label: 'Automation',
    title: 'Strategy Automation',
    description: 'Control signal schedules, confidence thresholds, and run limits.',
  },
  {
    id: 'readiness',
    label: 'Readiness',
    title: 'Production Readiness',
    description: 'Check deployment, database, route, and verification status.',
  },
];

export interface RiskAuditPreview {
  id: string;
  source: string;
  status: 'allow' | 'warn' | 'block';
  summary: string;
  symbol: string;
  createdAt: string;
}

export interface OmsOrderPreview {
  id: string;
  symbol: string;
  source: string;
  status: 'accepted' | 'partially_filled' | 'filled' | 'rejected';
  filledQuantity: number;
  quantity: number;
  updatedAt: string;
}

export interface AutomationPreview {
  strategyId: string;
  enabled: boolean;
  intervalMinutes: number;
  minConfidence: number;
  maxSignalsPerRun: number;
  allowedSymbols: string[];
}

export function buildSampleRiskAudits(): RiskAuditPreview[] {
  return [
    {
      id: 'audit-1007',
      source: 'python-strategy-runner',
      status: 'allow',
      summary: 'allow',
      symbol: 'MSFT',
      createdAt: '2026-05-06T15:03:00Z',
    },
    {
      id: 'audit-1006',
      source: 'webhook',
      status: 'block',
      summary: 'unsupported_asset_class',
      symbol: 'AAPL260619C00200000',
      createdAt: '2026-05-06T14:01:00Z',
    },
    {
      id: 'audit-1005',
      source: 'trade_assistant',
      status: 'warn',
      summary: 'duplicate_order, max_position_size',
      symbol: 'TSLA',
      createdAt: '2026-05-06T13:42:00Z',
    },
  ];
}

export function buildSampleOmsOrders(): OmsOrderPreview[] {
  return [
    {
      id: 'oms-2041',
      symbol: 'MSFT',
      source: 'python-strategy-runner',
      status: 'accepted',
      filledQuantity: 0,
      quantity: 10,
      updatedAt: '2026-05-06T15:03:00Z',
    },
    {
      id: 'oms-2038',
      symbol: 'AAPL260619C00200000',
      source: 'manual',
      status: 'partially_filled',
      filledQuantity: 1,
      quantity: 2,
      updatedAt: '2026-05-06T12:01:01Z',
    },
    {
      id: 'oms-2035',
      symbol: 'TSLA',
      source: 'trade_assistant',
      status: 'rejected',
      filledQuantity: 0,
      quantity: 5,
      updatedAt: '2026-05-06T10:30:00Z',
    },
  ];
}

export function buildDefaultAutomationPreview(): AutomationPreview {
  return {
    strategyId: 'strategy-momentum-core',
    enabled: true,
    intervalMinutes: 15,
    minConfidence: 0.7,
    maxSignalsPerRun: 2,
    allowedSymbols: ['AAPL', 'MSFT', 'NVDA'],
  };
}

export function buildOperationsReadinessReport(input?: {
  presentEnvVars?: string[];
  availableRoutes?: string[];
  checksPassing?: boolean;
}): ProductionReadinessReport {
  return evaluateProductionReadiness({
    requiredEnvVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ALPACA_API_KEY'],
    presentEnvVars: input?.presentEnvVars || ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    requiredMigrations: [
      'risk_settings',
      'risk_audit_records',
      'oms_orders',
      'oms_executions',
      'strategy_automation_schedules',
      'strategy_automation_runs',
    ],
    appliedMigrations: [
      'risk_settings',
      'risk_audit_records',
      'oms_orders',
      'oms_executions',
      'strategy_automation_schedules',
      'strategy_automation_runs',
    ],
    requiredRoutes: [
      '/platform-orders/route',
      '/platform-orders/:id/reconcile',
      '/strategy-automation/schedules',
      '/strategy-automation/run',
    ],
    availableRoutes: input?.availableRoutes || [],
    checks: [
      { name: 'npm test', status: input?.checksPassing === false ? 'fail' : 'pass' },
      { name: 'npm run build', status: input?.checksPassing === false ? 'fail' : 'pass' },
    ],
  });
}

export function getOperationsPanel(id: OperationsPanelId) {
  return operationsPanels.find((panel) => panel.id === id) || operationsPanels[0];
}
