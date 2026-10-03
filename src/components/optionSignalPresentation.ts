import { optionPlanLabel, type OptionPlan } from '../utils/optionTicket';

export type ManagedOptionPlan = OptionPlan & {
  management?: { exit_filled_qty?: number; stop_price?: number | null; enabled?: boolean };
};

const managementLabels: Record<string, string> = {
  closed: 'Closed',
  protected: 'Remaining contracts protected by broker stop',
  managed: 'Managed — no active protective stop',
  management_pending: 'Exit or stop update pending',
};

export function managedPlanLabel(plan: ManagedOptionPlan) {
  return managementLabels[plan.status] || optionPlanLabel(plan);
}
