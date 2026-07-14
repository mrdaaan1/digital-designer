// Внутреннее представление разобранного PPTX-архива.
// EMU (English Metric Units) — родная единица координат OOXML: 914400 EMU = 1 дюйм.

export type EmuRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ThemeColor = {
  name: string; // напр. 'accent1', 'dk1', 'lt1'
  rgb: string;  // '#RRGGBB'
};

export type ThemeFont = {
  role: 'major' | 'minor'; // major = заголовки, minor = основной текст
  script: string;          // 'latin' | 'ea' | 'cs'
  typeface: string;
};

export type ParsedTheme = {
  name: string;
  colors: ThemeColor[];
  fonts: ThemeFont[];
};

export type PlaceholderType =
  | 'title'
  | 'subTitle'
  | 'body'
  | 'ctrTitle'
  | 'pic'
  | 'chart'
  | 'tbl'
  | 'dt'
  | 'ftr'
  | 'sldNum'
  | 'other';

export type ParsedPlaceholder = {
  idx: number | null;
  type: PlaceholderType;
  rect: EmuRect | null;   // может наследоваться от layout/master, если null
  fontSizePt: number | null;
  fontColor: string | null;
  bold: boolean | null;
  align: string | null;
  sampleText: string | null; // текст-образец из слайда, если разбирали конкретный слайд
};

export type ParsedLayout = {
  index: number;
  filePath: string;         // ppt/slideLayouts/slideLayoutN.xml
  name: string;             // атрибут type или name из cSld
  placeholders: ParsedPlaceholder[];
  rawXml: string;           // сохраняем для клонирования при генерации
};

// Произвольная фигура слайда, не являющаяся стандартным OOXML-плейсхолдером.
// Нужна для шаблонов "экспорт из Google Slides/Canva", где вся вёрстка
// сделана свободными text box'ами и декоративными rect/shape без p:ph —
// такие шаблоны не имеют структуры плейсхолдеров вообще (см. parse-template.ts).
export type ParsedRawShape = {
  rect: EmuRect | null;
  shapeType: string | null;    // prstGeom prst, напр. 'rect', 'roundRect', 'ellipse'
  fillColor: string | null;
  fillAlphaPct: number | null; // 0-100, если задана прозрачность
  isTextBox: boolean;
  fontSizePt: number | null;
  fontColor: string | null;
  bold: boolean | null;
  align: string | null;
  sampleText: string | null;
};

export type ParsedSlide = {
  index: number;
  filePath: string;
  layoutIndex: number | null;
  backgroundColor: string | null;
  placeholders: ParsedPlaceholder[];
  rawShapes: ParsedRawShape[];  // заполняется, когда placeholders пуст или неполон
  rawXml: string;
};

export type ParsedTemplate = {
  slideWidthEmu: number;
  slideHeightEmu: number;
  theme: ParsedTheme;
  layouts: ParsedLayout[];
  slides: ParsedSlide[];
};
