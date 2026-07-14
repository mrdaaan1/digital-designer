import { readFile, writeFile } from 'node:fs/promises';
import { parseTemplate } from '../src/lib/pptx/parse-template';
import { buildPresentation } from '../src/lib/pptx/generate-presentation';
import type { SlidePatternAnalysis } from '../src/lib/llm/design-system-schema';
import type { ContentPlan } from '../src/lib/llm/content-plan-schema';

// Тест генератора БЕЗ вызова LLM: вручную описываем один паттерн на основе
// layout "TITLE_AND_BODY" реального шаблона и генерируем 2 слайда с новым текстом,
// чтобы проверить, что итоговый .pptx открывается и текст подменился корректно.

async function main() {
  const path = process.argv[2] ?? '/Users/daniil/Downloads/Sber_AI_Hack_Project_Proposal.pptx';
  const outPath = process.argv[3] ?? '/tmp/test-output.pptx';

  const buffer = await readFile(path);
  const template = await parseTemplate(buffer);

  const titleLayout = template.layouts.find((l) => l.name === 'TITLE');
  const bodyLayout = template.layouts.find((l) => l.name === 'TITLE_AND_BODY');
  if (!titleLayout || !bodyLayout) {
    throw new Error('Ожидались layouts TITLE и TITLE_AND_BODY в тестовом файле');
  }

  // Находим реальные слайды, использующие эти layouts, как источники клонирования.
  const titleSlide = template.slides.find((s) => s.layoutIndex === titleLayout.index) ?? template.slides[0];
  const bodySlide = template.slides.find((s) => s.layoutIndex === bodyLayout.index) ?? template.slides[1];

  console.log('titleSlide index', titleSlide?.index, 'bodySlide index', bodySlide?.index);

  const patterns: SlidePatternAnalysis[] = [
    {
      patternKey: 'title',
      label: 'Титульный слайд',
      description: 'Крупный заголовок по центру и подзаголовок',
      sourceSlideIndex: titleSlide.index,
      usageHint: 'Первый слайд презентации',
      placeholderRoles: [
        { role: 'heading', maxChars: 80, description: 'Заголовок' },
        { role: 'subheading', maxChars: 120, description: 'Подзаголовок' },
      ],
    },
    {
      patternKey: 'text',
      label: 'Текстовый слайд',
      description: 'Заголовок и один текстовый блок',
      sourceSlideIndex: bodySlide.index,
      usageHint: 'Обычный содержательный слайд',
      placeholderRoles: [
        { role: 'heading', maxChars: 60, description: 'Заголовок' },
        { role: 'body', maxChars: 400, description: 'Текст' },
      ],
    },
  ];

  const plan: ContentPlan = {
    title: 'Тестовая презентация',
    slides: [
      {
        patternKey: 'title',
        content: [
          { role: 'heading', text: 'Цифровой дизайнер презентаций' },
          { role: 'subheading', text: 'AI-сервис для автоматической генерации слайдов в стиле шаблона' },
        ],
        notes: '',
      },
      {
        patternKey: 'text',
        content: [
          { role: 'heading', text: 'Проблема' },
          {
            role: 'body',
            text: 'Создание презентаций в фирменном стиле компании требует ручной работы дизайнеров.\nAI хорошо генерирует текст, но не умеет воспроизводить структуру и дизайн шаблона.',
          },
        ],
        notes: '',
      },
    ],
  };

  const patternsByKey = new Map(patterns.map((p) => [p.patternKey, p]));
  const slidesByIndex = new Map(template.slides.map((s) => [s.index, s]));

  const result = await buildPresentation({
    originalPptxBuffer: buffer,
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
