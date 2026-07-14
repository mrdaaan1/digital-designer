import { readFile, writeFile } from 'node:fs/promises';
import { parseTemplate } from '../src/lib/pptx/parse-template';
import { buildPresentation } from '../src/lib/pptx/generate-presentation';
import type { DesignSystemAnalysis } from '../src/lib/llm/design-system-schema';
import type { ContentPlan } from '../src/lib/llm/content-plan-schema';

// Пересобирает .pptx из уже сохранённых /tmp/design-system-analysis.json и
// /tmp/content-plan.json — без повторных LLM-вызовов, чтобы проверить фикс
// генератора (очистка лишних слотов) не тратя бюджет OpenRouter.

async function main() {
  const templatePath = process.argv[2] ?? '/Users/daniil/Downloads/Sber_AI_Hack_Project_Proposal.pptx';
  const outPath = process.argv[3] ?? '/tmp/full-pipeline-output-fixed.pptx';

  const analysis: DesignSystemAnalysis = JSON.parse(await readFile('/tmp/design-system-analysis.json', 'utf-8'));
  const plan: ContentPlan = JSON.parse(await readFile('/tmp/content-plan.json', 'utf-8'));

  const templateBuffer = await readFile(templatePath);
  const parsed = await parseTemplate(templateBuffer);

  const patternsByKey = new Map(analysis.slidePatterns.map((p) => [p.patternKey, p]));
  const slidesByIndex = new Map(parsed.slides.map((s) => [s.index, s]));

  const result = await buildPresentation({
    originalPptxBuffer: templateBuffer,
    contentPlan: plan,
    patternsByKey,
    slidesByIndex,
  });

  await writeFile(outPath, result);
  console.log('written to', outPath, 'size', result.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
