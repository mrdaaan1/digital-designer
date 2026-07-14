import JSZip from 'jszip';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { ParsedSlide } from './types';
import type { ContentPlan, ContentPlanSlide } from '../llm/content-plan-schema';
import type { SlidePatternAnalysis } from '../llm/design-system-schema';

// Генератор итогового .pptx: не рендерит слайды с нуля, а клонирует реальный
// XML слайда-образца (source_slide_index паттерна) и точечно подменяет текст
// внутри существующих <a:t> узлов — так сохраняются все шрифты, тема, эффекты
// и анимации оригинала без внешних бинарей (LibreOffice тут не нужен).

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  preserveOrder: false,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  suppressEmptyNode: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Экранирует спецсимволы XML при вставке пользовательского текста в <a:t>.
function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

type TextSlotRef = {
  paragraphs: any[]; // ссылка на массив a:p данного shape — мутируем на месте
};

// Собирает все текстовые "слоты" слайда в порядке обхода XML: каждый плейсхолдер
// или текстовый shape с непустым содержимым — один слот. Множественные
// параграфы внутри одного shape/плейсхолдера схлопываются в один слот, чтобы
// многострочный bulletList можно было вставить построчно.
function collectTextSlots(spTree: any): { key: string; slot: TextSlotRef }[] {
  const slots: { key: string; slot: TextSlotRef }[] = [];

  const shapes = asArray(spTree?.['p:sp']);
  for (let i = 0; i < shapes.length; i++) {
    const sp = shapes[i];
    const txBody = sp['p:txBody'];
    if (!txBody) continue;
    const paragraphs = asArray(txBody['a:p']);
    const hasText = paragraphs.some((p: any) =>
      asArray(p['a:r']).some((r: any) => typeof r['a:t'] === 'string' && r['a:t'].length > 0),
    );
    if (!hasText) continue;

    const phNode = sp['p:nvSpPr']?.['p:nvPr']?.['p:ph'];
    const key = phNode
      ? `ph:${phNode['@_type'] ?? 'body'}:${phNode['@_idx'] ?? 0}`
      : `shape:${i}`;

    slots.push({ key, slot: { paragraphs } });
  }

  return slots;
}

// Заменяет текст внутри слота. Если newText содержит переводы строк, каждая
// строка становится отдельным параграфом (клонированным по стилю первого
// параграфа-образца) — так bulletList превращается в реальный список.
function applyTextToSlot(slot: TextSlotRef, newText: string) {
  const templateParagraph = slot.paragraphs[0];
  if (!templateParagraph) return;

  const lines = newText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return;

  const templateRun = asArray(templateParagraph['a:r'])[0];

  function buildParagraph(line: string) {
    const cloned = JSON.parse(JSON.stringify(templateParagraph));
    const runs = asArray(cloned['a:r']);
    if (runs.length === 0) {
      cloned['a:r'] = templateRun ? { ...JSON.parse(JSON.stringify(templateRun)), 'a:t': line } : { 'a:t': line };
    } else {
      // весь текст параграфа переносим в первый run, остальные run'ы (если были) убираем,
      // чтобы не дублировать текст-образец при неполном совпадении структуры.
      runs[0]['a:t'] = line;
      cloned['a:r'] = runs.length === 1 ? runs[0] : runs[0];
    }
    return cloned;
  }

  const newParagraphs = lines.map(buildParagraph);
  slot.paragraphs.length = 0;
  slot.paragraphs.push(...newParagraphs);
}

// Мутирует объект txBody так, чтобы XMLBuilder сериализовал обновлённый массив
// параграфов (мы заменяли slot.paragraphs "на месте" через length=0+push, но
// исходный txBody['a:p'] мог быть не-массивом — приводим к массиву заранее).
function normalizeParagraphContainers(spTree: any) {
  const shapes = asArray(spTree?.['p:sp']);
  for (const sp of shapes) {
    const txBody = sp['p:txBody'];
    if (!txBody) continue;
    if (!Array.isArray(txBody['a:p'])) {
      txBody['a:p'] = asArray(txBody['a:p']);
    }
  }
}

export type SlideRenderInput = {
  plannedSlide: ContentPlanSlide;
  pattern: SlidePatternAnalysis;
  sourceSlide: ParsedSlide;
};

// Строит XML нового слайда на основе XML слайда-образца пат­терна.
export function buildSlideXmlFromPattern(input: SlideRenderInput): string {
  const parsed = parser.parse(input.sourceSlide.rawXml);
  const cSld = parsed['p:sld']?.['p:cSld'];
  const spTree = cSld?.['p:spTree'];
  if (!spTree) {
    throw new Error(`Слайд-образец ${input.sourceSlide.index} не содержит p:spTree`);
  }

  normalizeParagraphContainers(spTree);
  const slots = collectTextSlots(spTree);

  // Сопоставляем роли контента со слотами по порядку появления в XML.
  // Эвристика: заголовочные роли (heading/title) — в первый слот, остальные —
  // по порядку. Это соответствует тому, что LLM-анализ paттернов формировал
  // placeholderRoles в визуальном порядке (сверху вниз), а collectTextSlots
  // обходит shapes в порядке их объявления в XML (обычно тот же порядок).
  const fields = [...input.plannedSlide.content];

  if (fields.length > slots.length) {
    // Дизайн-система переоценила число заполняемых ролей для этого паттерна —
    // избыточные поля контента будут потеряны. Не бросаем исключение (слайд
    // всё ещё соберётся корректно), но это сигнал пересмотреть placeholderRoles
    // паттерна в template_design_systems.
    console.warn(
      `[generate-presentation] паттерн "${input.pattern.patternKey}": ролей контента (${fields.length}) больше, чем текстовых слотов слайда-образца (${slots.length}). Лишние поля будут отброшены.`,
    );
  }

  for (let i = 0; i < slots.length && fields.length > 0; i++) {
    const field = fields.shift();
    if (!field) break;
    applyTextToSlot(slots[i].slot, field.text);
  }

  const rebuilt = builder.build(parsed);
  return typeof rebuilt === 'string' ? rebuilt : String(rebuilt);
}

export type BuildPresentationInput = {
  originalPptxBuffer: Buffer;
  contentPlan: ContentPlan;
  patternsByKey: Map<string, SlidePatternAnalysis>;
  slidesByIndex: Map<number, ParsedSlide>;
};

// Собирает итоговый .pptx: берёт оригинальный архив как основу (тема, media,
// masters, layouts остаются нетронутыми), затем заменяет содержимое
// ppt/slides/*.xml на сгенерированные слайды и обновляет presentation.xml
// + [Content_Types].xml + rels, чтобробраз оставался валидным OOXML-пакетом.
export async function buildPresentation(input: BuildPresentationInput): Promise<Buffer> {
  const zip = await JSZip.loadAsync(input.originalPptxBuffer);

  const newSlideXmls: string[] = [];
  for (const plannedSlide of input.contentPlan.slides) {
    const pattern = input.patternsByKey.get(plannedSlide.patternKey);
    if (!pattern) throw new Error(`Неизвестный паттерн: ${plannedSlide.patternKey}`);
    const sourceSlide = input.slidesByIndex.get(pattern.sourceSlideIndex);
    if (!sourceSlide) {
      throw new Error(`Слайд-образец ${pattern.sourceSlideIndex} для паттерна ${pattern.patternKey} не найден`);
    }
    newSlideXmls.push(buildSlideXmlFromPattern({ plannedSlide, pattern, sourceSlide }));
  }

  // Удаляем все существующие ppt/slides/slideN.xml и их rels — заменяем на новый набор.
  const existingSlidePaths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  const existingSlideRelsPaths = Object.keys(zip.files).filter((p) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(p));

  // Запоминаем rels исходного слайда-образца, чтобы новый слайд с тем же layout
  // сохранил связь ppt/slides/_relsN.xml.rels -> slideLayoutM.xml.
  const sourceRelsCache = new Map<number, string>();
  for (const plannedSlide of input.contentPlan.slides) {
    const pattern = input.patternsByKey.get(plannedSlide.patternKey)!;
    const sourceIndex = pattern.sourceSlideIndex;
    if (sourceRelsCache.has(sourceIndex)) continue;
    const relsFile = zip.file(`ppt/slides/_rels/slide${sourceIndex}.xml.rels`);
    if (relsFile) sourceRelsCache.set(sourceIndex, await relsFile.async('string'));
  }

  for (const path of [...existingSlidePaths, ...existingSlideRelsPaths]) {
    zip.remove(path);
  }

  const slideRIds: string[] = [];
  for (let i = 0; i < newSlideXmls.length; i++) {
    const slideNumber = i + 1;
    zip.file(`ppt/slides/slide${slideNumber}.xml`, newSlideXmls[i]);

    const plannedSlide = input.contentPlan.slides[i];
    const pattern = input.patternsByKey.get(plannedSlide.patternKey)!;
    const relsXml = sourceRelsCache.get(pattern.sourceSlideIndex);
    if (relsXml) {
      zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, relsXml);
    }
    slideRIds.push(`slide${slideNumber}`);
  }

  await rewritePresentationXml(zip, slideRIds.length);
  await rewritePresentationRels(zip, slideRIds.length);
  await rewriteContentTypes(zip, slideRIds.length);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return buffer;
}

async function rewritePresentationXml(zip: JSZip, slideCount: number) {
  const file = zip.file('ppt/presentation.xml');
  if (!file) throw new Error('ppt/presentation.xml отсутствует');
  const xml = await file.async('string');
  const parsed = parser.parse(xml);
  const presentation = parsed['p:presentation'];

  // sldIdLst содержит r:id ссылки на slide-rels; пересобираем список 1:1 с новыми слайдами.
  // r:id должны совпадать с теми, что мы пропишем в presentation.xml.rels ниже.
  const sldIdLst: any[] = [];
  for (let i = 0; i < slideCount; i++) {
    sldIdLst.push({ '@_id': String(256 + i), '@_r:id': `rIdSlide${i + 1}` });
  }
  presentation['p:sldIdLst'] = { 'p:sldId': sldIdLst };

  const rebuilt = builder.build(parsed);
  zip.file('ppt/presentation.xml', typeof rebuilt === 'string' ? rebuilt : String(rebuilt));
}

async function rewritePresentationRels(zip: JSZip, slideCount: number) {
  const path = 'ppt/_rels/presentation.xml.rels';
  const file = zip.file(path);
  if (!file) throw new Error(`${path} отсутствует`);
  const xml = await file.async('string');
  const parsed = parser.parse(xml);
  const relationships = asArray(parsed['Relationships']?.['Relationship']);

  // Оставляем все связи, кроме старых slide-связей, и добавляем новые с
  // предсказуемыми Id (rIdSlideN), совпадающими с r:id в presentation.xml.
  const nonSlideRels = relationships.filter(
    (r: any) => !String(r['@_Type']).endsWith('/slide'),
  );

  const newSlideRels = Array.from({ length: slideCount }, (_, i) => ({
    '@_Id': `rIdSlide${i + 1}`,
    '@_Type': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
    '@_Target': `slides/slide${i + 1}.xml`,
  }));

  parsed['Relationships']['Relationship'] = [...nonSlideRels, ...newSlideRels];
  const rebuilt = builder.build(parsed);
  zip.file(path, typeof rebuilt === 'string' ? rebuilt : String(rebuilt));
}

async function rewriteContentTypes(zip: JSZip, slideCount: number) {
  const path = '[Content_Types].xml';
  const file = zip.file(path);
  if (!file) throw new Error(`${path} отсутствует`);
  const xml = await file.async('string');
  const parsed = parser.parse(xml);
  const types = parsed['Types'];
  const overrides = asArray(types['Override']);

  const nonSlideOverrides = overrides.filter(
    (o: any) => !/\/ppt\/slides\/slide\d+\.xml$/.test(String(o['@_PartName'])),
  );
  const newSlideOverrides = Array.from({ length: slideCount }, (_, i) => ({
    '@_PartName': `/ppt/slides/slide${i + 1}.xml`,
    '@_ContentType': 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  }));

  types['Override'] = [...nonSlideOverrides, ...newSlideOverrides];
  const rebuilt = builder.build(parsed);
  zip.file(path, typeof rebuilt === 'string' ? rebuilt : String(rebuilt));
}
