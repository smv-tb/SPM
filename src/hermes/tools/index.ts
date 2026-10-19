import { registerGeneralTools } from "./general";
import { registerTaskTools } from "./tasks";
import { registerMilestoneTools } from "./milestones";
import { registerUserTools } from "./users";
import { registerProjectTools } from "./projects";
import { registerPhaseTools } from "./phases";
import { registerResourceTools } from "./resources";
import { registerFundingTools } from "./funding";
import { registerFundingTrancheTools } from "./funding-tranche";
import { registerLivingLabTools } from "./living-labs";
import { registerTagTools } from "./tags";
import { registerCostCategoryTools } from "./cost-categories";
import { registerCustomFieldTools } from "./custom-fields";
import { registerAssignmentTools } from "./assignments";
import { registerReconciliationTools } from "./reconciliation";

export function registerAllTools(
  handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>
): void {
  registerGeneralTools(handlers);
  registerTaskTools(handlers);
  registerMilestoneTools(handlers);
  registerUserTools(handlers);
  registerProjectTools(handlers);
  registerPhaseTools(handlers);
  registerResourceTools(handlers);
  registerFundingTools(handlers);
  registerFundingTrancheTools(handlers);
  registerLivingLabTools(handlers);
  registerTagTools(handlers);
  registerCostCategoryTools(handlers);
  registerCustomFieldTools(handlers);
  registerAssignmentTools(handlers);
  registerReconciliationTools(handlers);
}
