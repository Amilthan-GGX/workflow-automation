import { BrowserStageId } from '../../../types/enums.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import type { WorkflowContext } from '../../../types/workflow.js';
import type { DigitifyClient } from '../../../modules/digitify/digitifyClient.js';

export interface DownloadStageOutput {
  localPath: string;
  originalFilename: string;
  sizeBytes: number;
}

export async function downloadStage(
  client: DigitifyClient,
  ctx: WorkflowContext,
): Promise<Result<DownloadStageOutput, Error>> {
  const logger = ctx.logger.child({ stage: BrowserStageId.Download });
  logger.info({ action: 'download:start', dateRangeDays: ctx.config.digitify.downloadDateRangeDays });

  const result = await client.downloadTrips({
    dateRangeDays: ctx.config.digitify.downloadDateRangeDays,
  });

  if (!result.ok) {
    logger.error({ action: 'download:failed', err: result.error.message });
    return err(result.error);
  }

  const { localPath, originalFilename, sizeBytes } = result.value;
  logger.info({ action: 'download:complete', localPath, originalFilename, sizeBytes });

  return ok({ localPath, originalFilename, sizeBytes });
}
