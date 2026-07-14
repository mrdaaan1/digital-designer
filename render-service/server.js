// Лёгкий HTTP-сервис для рендера PPTX -> PNG (по одному файлу на слайд).
// Используется только на этапе анализа шаблона (редкая операция), поэтому
// живёт отдельно от основного Next.js-приложения на Vercel — Vercel не может
// исполнять бинарь LibreOffice в serverless-функции.

const express = require('express');
const multer = require('multer');
const { execFile } = require('node:child_process');
const { promises: fs } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const AUTH_TOKEN = process.env.RENDER_SERVICE_TOKEN;

function requireAuth(req, res, next) {
  if (!AUTH_TOKEN) return next(); // локальная разработка без токена
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function execFileAsync(cmd, args, options) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Принимает .pptx, возвращает массив PNG (base64) — по одному на слайд.
app.post('/render', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'file is required (multipart field "file")' });
  }

  const jobId = crypto.randomUUID();
  const workDir = path.join(os.tmpdir(), `render-${jobId}`);
  await fs.mkdir(workDir, { recursive: true });
  const inputPath = path.join(workDir, 'input.pptx');

  try {
    await fs.writeFile(inputPath, req.file.buffer);

    // 1) pptx -> pdf (детерминированный, сохраняет постраничную раскладку)
    await execFileAsync(
      'soffice',
      ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', workDir, inputPath],
      { timeout: 120_000 },
    );
    const pdfPath = path.join(workDir, 'input.pdf');

    // 2) pdf -> png (по странице), используем pdftoppm из poppler-utils
    const pngPrefix = path.join(workDir, 'slide');
    await execFileAsync('pdftoppm', ['-png', '-r', '110', pdfPath, pngPrefix], { timeout: 120_000 });

    const files = (await fs.readdir(workDir))
      .filter((f) => f.startsWith('slide') && f.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const slides = [];
    for (const file of files) {
      const buffer = await fs.readFile(path.join(workDir, file));
      slides.push({ file, base64: buffer.toString('base64') });
    }

    res.json({ ok: true, slideCount: slides.length, slides });
  } catch (error) {
    console.error('render error', error);
    res.status(500).json({ error: 'render_failed', message: String(error?.message || error) });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`render-service listening on :${port}`);
});
