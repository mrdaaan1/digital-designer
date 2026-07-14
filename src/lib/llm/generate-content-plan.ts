import type { SlidePatternAnalysis } from './design-system-schema';
import { callOpenRouterJson, textPart, CONTENT_MODEL, type ChatMessage } from './openrouter';
import { CONTENT_PLAN_JSON_SCHEMA, type ContentPlan } from './content-plan-schema';

const SYSTEM_PROMPT = `Ты — контент-стратег, который готовит презентации для реального бизнеса.
Тебе дают набор доступных паттернов слайдов (из дизайн-системы шаблона) и
текстовый бриф пользователя (описание продукта, тезисы, данные).

Задача: разложить бриф на последовательность слайдов, для каждого выбрав
подходящий patternKey из списка доступных, и заполнить его роли содержанием.

Правила:
- Используй только patternKey из предоставленного списка.
- Не превышай рекомендованный maxChars для каждой роли — переписывай длинные
  мысли короче, а не обрезай текст на середине слова.
- Открывай презентацию титульным паттерном (если есть), закрывай — заключительным
  (если есть). Используй паттерн с двумя колонками/сравнением, если в брифе есть
  сравнение или два связанных блока. Используй паттерн с метриками/числами, если
  в брифе есть конкретные цифры.
- Число слайдов — соразмерно объёму брифа (обычно 6-14), не растягивай и не сжимай
  искусственно.
- Пиши на русском языке, деловым, но не сухим тоном.
Отвечай ТОЛЬКО валидным JSON по заданной схеме.`;

function formatPatternsForPrompt(patterns: SlidePatternAnalysis[]): string {
  return patterns
    .map((p) => {
      const roles = p.placeholderRoles
        .map((r) => `      - ${r.role} (макс. ${r.maxChars} симв.): ${r.description}`)
        .join('\n');
      return `  patternKey="${p.patternKey}" (${p.label})\n    Когда использовать: ${p.usageHint}\n    Описание: ${p.description}\n    Роли:\n${roles}`;
    })
    .join('\n\n');
}

export async function generateContentPlan(
  patterns: SlidePatternAnalysis[],
  contentBrief: string,
): Promise<ContentPlan> {
  const patternsBlock = formatPatternsForPrompt(patterns);

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        textPart(`Доступные паттерны слайдов:\n\n${patternsBlock}`),
        textPart(`\nБриф пользователя (контент новой презентации):\n\n${contentBrief}`),
      ],
    },
  ];

  // Полный план (обычно 6-14 слайдов, часть паттернов — по 10+ текстовых
  // ролей) заметно объёмнее дефолтного лимита токенов.
  const plan = await callOpenRouterJson<ContentPlan>(
    CONTENT_MODEL,
    messages,
    CONTENT_PLAN_JSON_SCHEMA,
    0.6,
    12000,
  );

  const validKeys = new Set(patterns.map((p) => p.patternKey));
  const invalidSlide = plan.slides.find((s) => !validKeys.has(s.patternKey));
  if (invalidSlide) {
    throw new Error(`Модель использовала неизвестный patternKey: "${invalidSlide.patternKey}"`);
  }

  return plan;
}
