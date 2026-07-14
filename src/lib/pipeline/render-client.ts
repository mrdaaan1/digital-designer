// Клиент отдельного render-service (LibreOffice headless на Render.com),
// который конвертирует .pptx в PNG по слайдам — используется только на
// этапе анализа шаблона для vision-части LLM.

export async function renderPptxToPng(pptxBuffer: Buffer, maxSlides = 10): Promise<string[]> {
  const serviceUrl = process.env.RENDER_SERVICE_URL;
  if (!serviceUrl) {
    throw new Error('RENDER_SERVICE_URL не задан — сервис рендера недоступен');
  }

  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(pptxBuffer)]), 'template.pptx');

  const headers: Record<string, string> = {};
  const token = process.env.RENDER_SERVICE_TOKEN;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/render`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`render-service вернул ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  if (!data.ok) throw new Error(`render-service: ${data.error ?? 'unknown error'}`);

  const slides: { file: string; base64: string }[] = data.slides;
  return slides.slice(0, maxSlides).map((s) => s.base64);
}
