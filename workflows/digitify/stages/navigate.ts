import { BrowserStageId } from '../../../types/enums.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import type { WorkflowContext } from '../../../types/workflow.js';
import type { DigitifyClient } from '../../../modules/digitify/digitifyClient.js';

export async function navigateStage(
  client: DigitifyClient,
  ctx: WorkflowContext,
): Promise<Result<void, Error>> {
  const logger = ctx.logger.child({ stage: BrowserStageId.Navigate });
  logger.info({ action: 'navigate:start' });

  const navResult = await client.navigateToAdvance();
  if (!navResult.ok) {
    logger.error({ action: 'navigate:failed', err: navResult.error.message });
    return err(navResult.error);
  }

  const filterResult = await client.applyFilters({
    dateRangeDays: ctx.config.digitify.downloadDateRangeDays,
  });
  if (!filterResult.ok) {
    logger.warn({ action: 'navigate:filter-failed', err: filterResult.error.message });
    // Non-fatal — proceed without filter
  }

  logger.info({ action: 'navigate:complete' });
  return ok(undefined);
}
