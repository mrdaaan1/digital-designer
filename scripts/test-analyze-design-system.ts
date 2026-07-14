import { readFile, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { parseTemplate } from '../src/lib/pptx/parse-template';
import { analyzeDesignSystem } from '../src/lib/llm/analyze-design-system';
import { renderPptxToPng } from '../src/lib/pipeline/render-client';

async function main() {
  const path = process.argv[2] ?? '/Users/daniil/Downloads/Sber_AI_Hack_Project_Proposal.pptx';
  const buffer = await readFile(path);

  console.log('parsing template...');
  const parsed = await parseTemplate(buffer);
  console.log('layouts:', parsed.layouts.length, 'slides:', parsed.slides.length);

  console.log('rendering slides via render-service...');
  const pngs = await renderPptxToPng(buffer);
  console.log('rendered', pngs.length, 'slides');

  console.log('calling LLM design-system analysis...');
  const analysis = await analyzeDesignSystem(parsed, pngs);

  await writeFile('/tmp/design-system-analysis.json', JSON.stringify(analysis, null, 2));
  console.log('saved to /tmp/design-system-analysis.json');
  console.log(JSON.stringify(analysis, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
