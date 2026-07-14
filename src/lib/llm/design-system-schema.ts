// JSON Schema для строго структурированного результата анализа шаблона.
// Строгий schema-режим (response_format: json_schema, strict) заставляет
// модель вернуть валидный объект без дополнительного парсинга markdown.

export const DESIGN_SYSTEM_JSON_SCHEMA = {
  name: 'design_system_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['paletteRoles', 'typography', 'spacingScale', 'slidePatterns'],
    properties: {
      paletteRoles: {
        type: 'object',
        additionalProperties: false,
        required: ['background', 'surface', 'textPrimary', 'textSecondary', 'accentPrimary', 'accentSecondary'],
        properties: {
          background: { type: 'string', description: 'Основной цвет фона слайдов, HEX' },
          surface: { type: 'string', description: 'Цвет карточек/поверхностей поверх фона, HEX' },
          textPrimary: { type: 'string', description: 'Основной цвет текста, HEX' },
          textSecondary: { type: 'string', description: 'Второстепенный/приглушённый цвет текста, HEX' },
          accentPrimary: { type: 'string', description: 'Главный акцентный цвет бренда, HEX' },
          accentSecondary: { type: 'string', description: 'Дополнительный акцентный цвет, HEX' },
        },
      },
      typography: {
        type: 'object',
        additionalProperties: false,
        required: ['headingFont', 'bodyFont', 'scale'],
        properties: {
          headingFont: { type: 'string' },
          bodyFont: { type: 'string' },
          scale: {
            type: 'object',
            additionalProperties: false,
            required: ['h1Pt', 'h2Pt', 'bodyPt', 'captionPt'],
            properties: {
              h1Pt: { type: 'number' },
              h2Pt: { type: 'number' },
              bodyPt: { type: 'number' },
              captionPt: { type: 'number' },
            },
          },
        },
      },
      spacingScale: {
        type: 'object',
        additionalProperties: false,
        required: ['marginEmu', 'gutterEmu'],
        properties: {
          marginEmu: { type: 'number', description: 'Типичный внешний отступ от края слайда, EMU' },
          gutterEmu: { type: 'number', description: 'Типичный промежуток между блоками, EMU' },
        },
      },
      slidePatterns: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['patternKey', 'label', 'description', 'sourceSlideIndex', 'usageHint', 'placeholderRoles'],
          properties: {
            patternKey: {
              type: 'string',
              description: 'машиночитаемый идентификатор, напр. title, agenda, two-column, quote, section, big-number, chart, closing',
            },
            label: { type: 'string', description: 'Человекочитаемое название паттерна на русском' },
            description: {
              type: 'string',
              description: 'Визуальное и структурное описание паттерна: расположение блоков, акценты, декоративные элементы',
            },
            sourceSlideIndex: { type: 'number', description: 'Индекс слайда-образца в исходном шаблоне (1-based)' },
            usageHint: {
              type: 'string',
              description: 'Когда использовать этот паттерн при генерации новой презентации',
            },
            placeholderRoles: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['role', 'maxChars', 'description'],
                properties: {
                  role: {
                    type: 'string',
                    description: 'напр. heading, subheading, body, bulletList, quoteText, quoteAuthor, metricValue, metricLabel',
                  },
                  maxChars: { type: 'number', description: 'Рекомендуемая максимальная длина текста для этой роли' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type PaletteRoles = {
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  accentPrimary: string;
  accentSecondary: string;
};

export type TypographyScale = {
  h1Pt: number;
  h2Pt: number;
  bodyPt: number;
  captionPt: number;
};

export type Typography = {
  headingFont: string;
  bodyFont: string;
  scale: TypographyScale;
};

export type SpacingScale = {
  marginEmu: number;
  gutterEmu: number;
};

export type PlaceholderRole = {
  role: string;
  maxChars: number;
  description: string;
};

export type SlidePatternAnalysis = {
  patternKey: string;
  label: string;
  description: string;
  sourceSlideIndex: number;
  usageHint: string;
  placeholderRoles: PlaceholderRole[];
};

export type DesignSystemAnalysis = {
  paletteRoles: PaletteRoles;
  typography: Typography;
  spacingScale: SpacingScale;
  slidePatterns: SlidePatternAnalysis[];
};
