import { BrowserStageId } from '../../../types/enums.js';
import type { Result } from '../../../types/result.js';
import { ok, err } from '../../../types/result.js';
import type { WorkflowContext } from '../../../types/workflow.js';
import type { DigitifyClient } from '../../../modules/digitify/digitifyClient.js';

export interface SessionStageOutput {
  email: string;
  sessionSource: 'storage' | 'fresh' | 'chrome';
}

export async function sessionStage(
  client: DigitifyClient,
  ctx: WorkflowContext,
): Promise<Result<SessionStageOutput, Error>> {
  const logger = ctx.logger.child({ stage: BrowserStageId.Session });
  logger.info({ action: 'session:start' });

  const result = await client.login();
  if (!result.ok) {
    logger.error({ action: 'session:failed', err: result.error.message });
    return err(result.error);
  }

  const { email = 'unknown', sessionLoadedFrom = 'fresh' } = result.value;
  logger.info({ action: 'session:complete', email, source: sessionLoadedFrom });
  return ok({ email, sessionSource: sessionLoadedFrom });
}
