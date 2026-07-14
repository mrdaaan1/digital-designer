import { readFile } from 'node:fs/promises';
import { parseTemplate } from '../src/lib/pptx/parse-template';

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Использование: tsx scripts/test-parse-template.ts <path-to.pptx>');
    process.exit(1);
  }
  const buffer = await readFile(path);
  const result = await parseTemplate(buffer);

  console.log('slide size (emu):', result.slideWidthEmu, result.slideHeightEmu);
  console.log('theme:', result.theme.name);
  console.log('theme colors:', result.theme.colors);
  console.log('theme fonts:', result.theme.fonts);
  console.log('layouts count:', result.layouts.length);
  for (const layout of result.layouts) {
    console.log(`  layout ${layout.index} "${layout.name}" — placeholders: ${layout.placeholders.length}`);
    for (const ph of layout.placeholders) {
      console.log(`    idx=${ph.idx} type=${ph.type} rect=${JSON.stringify(ph.rect)}`);
    }
  }
  console.log('slides count:', result.slides.length);
  for (const slide of result.slides.slice(0, 3)) {
    console.log(`  slide ${slide.index} layoutIndex=${slide.layoutIndex} bg=${slide.backgroundColor} placeholders=${slide.placeholders.length} rawShapes=${slide.rawShapes.length}`);
    for (const ph of slide.placeholders) {
      console.log(`    ph idx=${ph.idx} type=${ph.type} sample="${ph.sampleText?.slice(0, 40)}"`);
    }
    for (const rs of slide.rawShapes) {
      console.log(`    shape type=${rs.shapeType} textBox=${rs.isTextBox} fill=${rs.fillColor} sample="${rs.sampleText?.slice(0, 40)}"`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
