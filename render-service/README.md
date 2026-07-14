# render-service

Отдельный вспомогательный сервис: конвертирует `.pptx` в набор PNG (по одному
на слайд) через LibreOffice headless + poppler. Нужен только для vision-этапа
анализа шаблона — основное приложение (Next.js на Vercel) не может запускать
LibreOffice в serverless-функции, поэтому это вынесено в отдельный контейнер
на Render.com.

## API

- `GET /health` — проверка живости.
- `POST /render` (multipart, поле `file` — .pptx) → `{ slides: [{ file, base64 }] }`.
- Если задана переменная `RENDER_SERVICE_TOKEN`, запросы должны нести
  `Authorization: Bearer <token>`.

## Локальный запуск

Требует установленных `libreoffice` и `poppler-utils` (poppler даёт `pdftoppm`).

```bash
npm install
npm start
```

## Деплой на Render.com

Render автоматически соберёт `Dockerfile` из этой папки (Root Directory:
`render-service`). Задать переменную окружения `RENDER_SERVICE_TOKEN` —
тот же токен указывается в основном приложении как `RENDER_SERVICE_URL`/`RENDER_SERVICE_TOKEN`.
