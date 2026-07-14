import { readFile, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
config({ path: '.env.local' });

import { parseTemplate } from '../src/lib/pptx/parse-template';
import { generateContentPlan } from '../src/lib/llm/generate-content-plan';
import { buildPresentation } from '../src/lib/pptx/generate-presentation';
import type { DesignSystemAnalysis } from '../src/lib/llm/design-system-schema';

// Полный тест генерации презентации по уже сохранённому анализу дизайн-системы
// (из /tmp/design-system-analysis.json) — без повторного анализа шаблона,
// чтобы не тратить LLM-бюджет на vision-вызов.

async function main() {
  const templatePath = process.argv[2] ?? '/Users/daniil/Downloads/Sber_AI_Hack_Project_Proposal.pptx';
  const outPath = process.argv[3] ?? '/tmp/full-pipeline-output.pptx';

  const analysis: DesignSystemAnalysis = JSON.parse(
    await readFile('/tmp/design-system-analysis.json', 'utf-8'),
  );

  const templateBuffer = await readFile(templatePath);
  const parsed = await parseTemplate(templateBuffer);

  const contentBrief = `
Продукт: "Цифровой дизайнер презентаций" — AI-сервис, который анализирует шаблон
презентации в фирменном стиле компании и автоматически собирает новую презентацию
по текстовому брифу, полностью сохраняя дизайн шаблона.

Проблема: подготовка презентаций в фирменном стиле требует часов работы дизайнеров.
Существующие AI-инструменты хорошо генерируют текст, но не умеют воспроизводить
структуру и визуальные паттерны шаблона.

Решение: сервис разбирает шаблон (парсинг OOXML + vision-анализ рендеров),
восстанавливает дизайн-систему и паттерны слайдов, затем LLM раскладывает
контент пользователя по этим паттернам, а генератор клонирует реальный XML
слайдов-образцов с новым текстом — без LibreOffice, сохраняя шрифты и тему.

Метрики: время подготовки презентации сокращается с часов до минут. Единый
стандарт оформления независимо от автора документа.

Команда: студенты и ML-инженеры хакатона Sber AI Hack 2026.
`;

  console.log('generating content plan via LLM...');
  const plan = await generateContentPlan(analysis.slidePatterns, contentBrief);
  console.log('plan title:', plan.title);
  console.log('slides:', plan.slides.length);
  for (const s of plan.slides) {
    console.log(' -', s.patternKey, '| fields:', s.content.map((f) => f.role).join(', '));
  }

  await writeFile('/tmp/content-plan.json', JSON.stringify(plan, null, 2));

  const patternsByKey = new Map(analysis.slidePatterns.map((p) => [p.patternKey, p]));
  const slidesByIndex = new Map(parsed.slides.map((s) => [s.index, s]));

  console.log('building final .pptx...');
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
