import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type {
  ParsedTemplate,
  ParsedTheme,
  ParsedLayout,
  ParsedSlide,
  ParsedPlaceholder,
  ParsedRawShape,
  PlaceholderType,
  ThemeColor,
  ThemeFont,
  EmuRect,
} from './types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

async function readXml(zip: JSZip, path: string) {
  const file = zip.file(path);
  if (!file) return null;
  const xml = await file.async('string');
  return { xml, parsed: xmlParser.parse(xml) };
}

function parseTheme(themeXml: any): ParsedTheme {
  const theme = themeXml['a:theme'];
  const colorScheme = theme['a:themeElements']['a:clrScheme'];
  const name = colorScheme['@_name'] ?? 'theme';

  const colorKeys = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const colors: ThemeColor[] = colorKeys.map((key) => {
    const node = colorScheme[`a:${key}`];
    const srgb = node?.['a:srgbClr']?.['@_val'];
    const sys = node?.['a:sysClr']?.['@_lastClr'];
    return { name: key, rgb: `#${(srgb ?? sys ?? '000000').toUpperCase()}` };
  });

  const fontScheme = theme['a:themeElements']['a:fontScheme'];
  const fonts: ThemeFont[] = [];
  for (const role of ['major', 'minor'] as const) {
    const fontNode = fontScheme[`a:${role}Font`];
    const latin = fontNode?.['a:latin']?.['@_typeface'];
    if (latin) fonts.push({ role, script: 'latin', typeface: latin });
    const ea = fontNode?.['a:ea']?.['@_typeface'];
    if (ea) fonts.push({ role, script: 'ea', typeface: ea });
    const cs = fontNode?.['a:cs']?.['@_typeface'];
    if (cs) fonts.push({ role, script: 'cs', typeface: cs });
  }

  return { name, colors, fonts };
}

function mapPlaceholderType(phType: string | undefined): PlaceholderType {
  switch (phType) {
    case 'title':
      return 'title';
    case 'ctrTitle':
      return 'ctrTitle';
    case 'subTitle':
      return 'subTitle';
    case 'body':
      return 'body';
    case 'pic':
      return 'pic';
    case 'chart':
      return 'chart';
    case 'tbl':
      return 'tbl';
    case 'dt':
      return 'dt';
    case 'ftr':
      return 'ftr';
    case 'sldNum':
      return 'sldNum';
    default:
      return phType ? 'other' : 'body';
  }
}

function extractRect(spPr: any): EmuRect | null {
  const xfrm = spPr?.['a:xfrm'];
  if (!xfrm) return null;
  const off = xfrm['a:off'];
  const ext = xfrm['a:ext'];
  if (!off || !ext) return null;
  return {
    x: Number(off['@_x'] ?? 0),
    y: Number(off['@_y'] ?? 0),
    w: Number(ext['@_cx'] ?? 0),
    h: Number(ext['@_cy'] ?? 0),
  };
}

function extractTextRunProps(txBody: any): {
  fontSizePt: number | null;
  fontColor: string | null;
  bold: boolean | null;
  align: string | null;
  sampleText: string | null;
} {
  if (!txBody) {
    return { fontSizePt: null, fontColor: null, bold: null, align: null, sampleText: null };
  }
  const paragraphs = asArray(txBody['a:p']);
  const firstParagraph = paragraphs[0];
  const pPr = firstParagraph?.['a:pPr'];
  const align = pPr?.['@_algn'] ?? null;

  const runs = asArray(firstParagraph?.['a:r']);
  const firstRun = runs[0];
  const rPr = firstRun?.['a:rPr'];

  const fontSizePt = rPr?.['@_sz'] ? Number(rPr['@_sz']) / 100 : null;
  const bold = rPr?.['@_b'] === '1' ? true : rPr?.['@_b'] === '0' ? false : null;
  const solidFill = rPr?.['a:solidFill']?.['a:srgbClr']?.['@_val'];
  const fontColor = solidFill ? `#${solidFill.toUpperCase()}` : null;

  const sampleText = paragraphs
    .flatMap((p: any) => asArray(p['a:r']).map((r: any) => r['a:t']))
    .filter((t: any) => typeof t === 'string' && t.length > 0)
    .join(' ') || null;

  return { fontSizePt, fontColor, bold, align, sampleText };
}

function parseShapePlaceholders(spTree: any): ParsedPlaceholder[] {
  if (!spTree) return [];
  const shapes = asArray(spTree['p:sp']);
  const placeholders: ParsedPlaceholder[] = [];

  for (const sp of shapes) {
    const nvSpPr = sp['p:nvSpPr'];
    const phNode = nvSpPr?.['p:nvPr']?.['p:ph'];
    if (!phNode) continue; // не placeholder — обычная фигура, пропускаем

    const rect = extractRect(sp['p:spPr']);
    const textProps = extractTextRunProps(sp['p:txBody']);

    placeholders.push({
      idx: phNode['@_idx'] !== undefined ? Number(phNode['@_idx']) : null,
      type: mapPlaceholderType(phNode['@_type']),
      rect,
      ...textProps,
    });
  }

  // графики/таблицы/картинки в graphicFrame тоже могут быть плейсхолдерами
  const frames = asArray(spTree['p:graphicFrame']);
  for (const frame of frames) {
    const phNode = frame['p:nvGraphicFramePr']?.['p:nvPr']?.['p:ph'];
    if (!phNode) continue;
    const xfrm = frame['p:xfrm'];
    const rect: EmuRect | null = xfrm
      ? {
          x: Number(xfrm['a:off']?.['@_x'] ?? 0),
          y: Number(xfrm['a:off']?.['@_y'] ?? 0),
          w: Number(xfrm['a:ext']?.['@_cx'] ?? 0),
          h: Number(xfrm['a:ext']?.['@_cy'] ?? 0),
        }
      : null;
    placeholders.push({
      idx: phNode['@_idx'] !== undefined ? Number(phNode['@_idx']) : null,
      type: mapPlaceholderType(phNode['@_type']),
      rect,
      fontSizePt: null,
      fontColor: null,
      bold: null,
      align: null,
      sampleText: null,
    });
  }

  return placeholders;
}

function extractSlideBackground(cSld: any): string | null {
  const bgPr = cSld?.['p:bg']?.['p:bgPr'];
  const srgb = bgPr?.['a:solidFill']?.['a:srgbClr']?.['@_val'];
  return srgb ? `#${srgb.toUpperCase()}` : null;
}

// Разбирает все p:sp слайда как "сырые" фигуры — без привязки к семантике
// плейсхолдера. Используется для шаблонов без p:ph (см. ParsedRawShape).
function parseRawShapes(spTree: any): ParsedRawShape[] {
  if (!spTree) return [];
  const shapes = asArray(spTree['p:sp']);
  const rawShapes: ParsedRawShape[] = [];

  for (const sp of shapes) {
    const spPr = sp['p:spPr'];
    const rect = extractRect(spPr);
    const shapeType = spPr?.['a:prstGeom']?.['@_prst'] ?? null;

    const fillNode = spPr?.['a:solidFill']?.['a:srgbClr'];
    const fillColor = fillNode?.['@_val'] ? `#${fillNode['@_val'].toUpperCase()}` : null;
    const alphaVal = fillNode?.['a:alpha']?.['@_val'];
    const fillAlphaPct = alphaVal ? Number(alphaVal) / 1000 : null;

    const txBody = sp['p:txBody'];
    const isTextBox = !!txBody && asArray(txBody['a:p']).some(
      (p: any) => asArray(p['a:r']).some((r: any) => typeof r['a:t'] === 'string' && r['a:t'].length > 0),
    );
    const textProps = extractTextRunProps(txBody);

    rawShapes.push({
      rect,
      shapeType,
      fillColor,
      fillAlphaPct,
      isTextBox,
      ...textProps,
    });
  }

  return rawShapes;
}

async function resolveSlideLayoutIndex(zip: JSZip, slideRelsPath: string): Promise<number | null> {
  const rels = await readXml(zip, slideRelsPath);
  if (!rels) return null;
  const relationships = asArray(rels.parsed['Relationships']?.['Relationship']);
  const layoutRel = relationships.find((r: any) =>
    String(r['@_Type']).endsWith('/slideLayout'),
  );
  if (!layoutRel) return null;
  const match = String(layoutRel['@_Target']).match(/slideLayout(\d+)\.xml/);
  return match ? Number(match[1]) : null;
}

export async function parseTemplate(buffer: Buffer): Promise<ParsedTemplate> {
  const zip = await JSZip.loadAsync(buffer);

  const presentation = await readXml(zip, 'ppt/presentation.xml');
  if (!presentation) throw new Error('Некорректный PPTX: отсутствует ppt/presentation.xml');
  const sldSz = presentation.parsed['p:presentation']?.['p:sldSz'];
  const slideWidthEmu = Number(sldSz?.['@_cx'] ?? 12192000);
  const slideHeightEmu = Number(sldSz?.['@_cy'] ?? 6858000);

  const themeFile = await readXml(zip, 'ppt/theme/theme1.xml');
  if (!themeFile) throw new Error('Некорректный PPTX: отсутствует тема ppt/theme/theme1.xml');
  const theme = parseTheme(themeFile.parsed);

  const layoutFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(path))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
      return na - nb;
    });

  const layouts: ParsedLayout[] = [];
  for (const filePath of layoutFiles) {
    const index = Number(filePath.match(/(\d+)/)?.[1] ?? 0);
    const layoutFile = await readXml(zip, filePath);
    if (!layoutFile) continue;
    const cSld = layoutFile.parsed['p:sldLayout']?.['p:cSld'];
    const name = cSld?.['@_name'] || layoutFile.parsed['p:sldLayout']?.['@_type'] || `layout-${index}`;
    const placeholders = parseShapePlaceholders(cSld?.['p:spTree']);
    layouts.push({ index, filePath, name, placeholders, rawXml: layoutFile.xml });
  }

  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/(\d+)/)?.[1] ?? 0);
      return na - nb;
    });

  const slides: ParsedSlide[] = [];
  for (const filePath of slideFiles) {
    const index = Number(filePath.match(/(\d+)/)?.[1] ?? 0);
    const slideFile = await readXml(zip, filePath);
    if (!slideFile) continue;
    const cSld = slideFile.parsed['p:sld']?.['p:cSld'];
    const placeholders = parseShapePlaceholders(cSld?.['p:spTree']);
    const backgroundColor = extractSlideBackground(cSld);
    // Шаблоны без p:ph (типично для экспорта из Google Slides/Canva) не дают
    // структуры через placeholders — разбираем все фигуры слайда как fallback.
    const rawShapes = placeholders.length === 0 ? parseRawShapes(cSld?.['p:spTree']) : [];

    const relsPath = `ppt/slides/_rels/slide${index}.xml.rels`;
    const layoutIndex = await resolveSlideLayoutIndex(zip, relsPath);

    slides.push({ index, filePath, layoutIndex, backgroundColor, placeholders, rawShapes, rawXml: slideFile.xml });
  }

  return { slideWidthEmu, slideHeightEmu, theme, layouts, slides };
}
