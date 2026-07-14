// Схема плана презентации: LLM распределяет контент пользователя по слайдам,
// выбирая для каждого один из паттернов дизайн-системы шаблона и заполняя
// роли плейсхолдеров текстом. Никаких координат — они уже заданы паттерном.

export const CONTENT_PLAN_JSON_SCHEMA = {
  name: 'presentation_content_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'slides'],
    properties: {
      title: { type: 'string', description: 'Название презентации' },
      slides: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['patternKey', 'content', 'notes'],
          properties: {
            patternKey: {
              type: 'string',
              description: 'Ключ паттерна из дизайн-системы шаблона (patternKey), который использовать для этого слайда',
            },
            content: {
              type: 'array',
              description: 'Заполненные роли плейсхолдеров этого паттерна',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['role', 'text'],
                properties: {
                  role: { type: 'string', description: 'Роль плейсхолдера из паттерна (heading, body, bulletList...)' },
                  text: {
                    type: 'string',
                    description: 'Текст. Для bulletList — пункты через перевод строки (\\n)',
                  },
                },
              },
            },
            notes: { type: 'string', description: 'Заметки докладчика для этого слайда (можно пустую строку)' },
          },
        },
      },
    },
  },
} as const;

export type ContentPlanSlideField = { role: string; text: string };
export type ContentPlanSlide = {
  patternKey: string;
  content: ContentPlanSlideField[];
  notes: string;
};
export type ContentPlan = {
  title: string;
  slides: ContentPlanSlide[];
};
