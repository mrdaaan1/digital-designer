import type { ParsedTemplate } from '../pptx/types';
import { callOpenRouterJson, imagePart, textPart, ANALYSIS_VISION_MODEL, type ChatMessage } from './openrouter';
import { DESIGN_SYSTEM_JSON_SCHEMA, type DesignSystemAnalysis } from './design-system-schema';

const SYSTEM_PROMPT = `Ты — старший дизайнер презентаций. Тебе дают:
1) структурные данные шаблона .pptx, извлечённые парсером (тема, цвета, шрифты,
   плейсхолдеры или произвольные фигуры с координатами и цветами);
2) PNG-рендеры первых слайдов шаблона "как это выглядит на самом деле".

Твоя задача — восстановить дизайн-систему шаблона и описать типовые паттерны
слайдов, чтобы позже по ним можно было автоматически собрать НОВУЮ презентацию
на произвольную тему, полностью сохранив стиль оригинала.

Важно:
- Опирайся на рендеры как на источник истины о том, что визуально видно
  (тени, наложения, декоративные акценты, реальные цвета фона), а на XML-данные —
  как на точные числа (координаты EMU, HEX-коды, размеры шрифта в pt).
- Каждый паттерн должен быть переиспользуемым шаблоном компоновки, а не описанием
  одного конкретного слайда. Указывай sourceSlideIndex — слайд-образец, с которого
  этот паттерн лучше всего клонировать структуру XML.
- Выдели от 3 до 8 паттернов, покрывающих реально встретившиеся в шаблоне виды
  слайдов (титульный, раздел, текстовый, с двумя колонками, с цитатой, с числами/метриками,
  с диаграммой, финальный — только те, что реально присутствуют).
- placeholderRoles должны быть с точки зрения СОДЕРЖАНИЯ (heading, body, bulletList,
  quoteText, metricValue...), а не XML-имён.
- КРИТИЧНО для sourceSlideIndex: генератор клонирует XML именно этого слайда
  и заменяет текст строго по числу текстовых блоков (shape/placeholder с текстом)
  на этом слайде. Порядок сопоставления — визуальный порядок чтения: сначала
  колонка/группа слева, сверху вниз внутри неё, затем следующая колонка правее
  (НЕ порядок объявления фигур в XML — он может не совпадать с расположением).
  Поэтому:
  * Список placeholderRoles должен содержать РОВНО столько ролей, сколько
    отдельных текстовых блоков реально видно на рендере слайда sourceSlideIndex
    (не больше, не меньше) — включая мелкие подписи, лейблы, метрики под
    карточками, даже однословные. Пересчитай их по рендеру внимательно:
    типичная ошибка — забыть подпись/лейбл под каждой карточкой или колонкой.
  * Если слайды с нужной компоновкой отличаются числом текстовых блоков
    (например, один содержит 3 карточки, другой 5) — заведи для них РАЗНЫЕ
    patternKey (напр. "cards-3", "cards-5"), а не один общий паттерн.
  * Порядок ролей в placeholderRoles: для каждой колонки/карточки слева направо
    перечисли все её роли сверху вниз (heading колонки 1, body колонки 1,
    caption колонки 1, затем heading колонки 2, ...), а не "все heading, потом
    все body" — именно так генератор заполняет слоты по колонкам.
Отвечай ТОЛЬКО валидным JSON по заданной схеме.`;

function summarizeTemplateForPrompt(template: ParsedTemplate): string {
  const lines: string[] = [];
  lines.push(`Размер слайда: ${template.slideWidthEmu}x${template.slideHeightEmu} EMU`);
  lines.push(`Тема "${template.theme.name}":`);
  for (const color of template.theme.colors) lines.push(`  ${color.name} = ${color.rgb}`);
  for (const font of template.theme.fonts) lines.push(`  шрифт ${font.role}/${font.script} = ${font.typeface}`);

  if (template.layouts.some((l) => l.placeholders.length > 0)) {
    lines.push('\nLayouts (стандартные OOXML-плейсхолдеры):');
    for (const layout of template.layouts) {
      if (layout.placeholders.length === 0) continue;
      lines.push(`  Layout ${layout.index} "${layout.name}":`);
      for (const ph of layout.placeholders) {
        lines.push(`    idx=${ph.idx} type=${ph.type} rect=${JSON.stringify(ph.rect)} fontSize=${ph.fontSizePt}`);
      }
    }
  }

  lines.push('\nСлайды-образцы (реальное содержимое и фигуры):');
  const sampleSlides = template.slides.slice(0, 10);
  for (const slide of sampleSlides) {
    const textBlockCount =
      slide.placeholders.filter((p) => !!p.sampleText).length +
      slide.rawShapes.filter((s) => s.isTextBox && !!s.sampleText).length;
    lines.push(
      `  Слайд ${slide.index} (layout=${slide.layoutIndex}, bg=${slide.backgroundColor ?? 'н/д'}, ` +
        `текстовых блоков=${textBlockCount} — именно столько ролей должно быть у паттерна с этим sourceSlideIndex):`,
    );
    for (const ph of slide.placeholders) {
      lines.push(`    placeholder idx=${ph.idx} type=${ph.type} text="${ph.sampleText?.slice(0, 80) ?? ''}"`);
    }
    for (const shape of slide.rawShapes) {
      const kind = shape.isTextBox ? 'text' : 'decor';
      lines.push(
        `    shape[${kind}] geom=${shape.shapeType} rect=${JSON.stringify(shape.rect)} fill=${shape.fillColor ?? 'none'} ` +
          `fontSize=${shape.fontSizePt ?? '-'} text="${shape.sampleText?.slice(0, 80) ?? ''}"`,
      );
    }
  }

  return lines.join('\n');
}

export async function analyzeDesignSystem(
  template: ParsedTemplate,
  slidePngsBase64: string[],
): Promise<DesignSystemAnalysis> {
  const structuralSummary = summarizeTemplateForPrompt(template);

  const userContent: ChatMessage['content'] = [
    textPart(`Структурные данные шаблона:\n\n${structuralSummary}`),
    textPart('\nРендеры слайдов шаблона (в том же порядке, что и в данных выше):'),
    ...slidePngsBase64.slice(0, 10).map((b64) => imagePart(b64)),
  ];

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  // Ответ содержит до 8 паттернов по 10+ ролей каждый — заметно объёмнее
  // дефолтного лимита токенов, из-за чего JSON обрезался на середине.
  return callOpenRouterJson<DesignSystemAnalysis>(
    ANALYSIS_VISION_MODEL,
    messages,
    DESIGN_SYSTEM_JSON_SCHEMA,
    0.3,
    12000,
  );
}
