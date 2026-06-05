import { Command } from 'commander';

import { buildProcessDigitifyCommand } from './commands/processDigitify.js';

const program = new Command();

program
  .name('digitify')
  .description('Digitify automation platform')
  .version('1.0.0');

program.addCommand(buildProcessDigitifyCommand());

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
