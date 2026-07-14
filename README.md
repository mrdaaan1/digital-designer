# Цифровой дизайнер презентаций

AI-сервис, который анализирует произвольный шаблон презентации (.pptx),
восстанавливает его дизайн-систему (палитру, типографику, паттерны слайдов)
и по текстовому брифу автоматически собирает новую презентацию в этом же
стиле — без ручного редактирования.

Хакатон-кейс: «Цифровой дизайнер презентаций».

## Архитектура

```
                     ┌────────────────────┐
                     │   Next.js (Vercel)  │  UI + API routes
                     └─────────┬───────────┘
                               │
        ┌──────────────────────┼───────────────────────┐
        │                      │                        │
 ┌──────▼──────┐      ┌────────▼────────┐      ┌────────▼────────┐
 │ pptx parser │      │  render-service  │      │    OpenRouter    │
 │ (JSZip+XML) │      │ (Render.com,     │      │  (LLM: vision +  │
 │             │      │  LibreOffice     │      │   text/JSON)     │
 │             │      │  headless→PNG)   │      │                  │
 └──────┬──────┘      └────────┬────────┘      └────────┬────────┘
        │                      │                        │
        └──────────────────────┴────────────────────────┘
                               │
                        ┌──────▼──────┐
                        │  Supabase   │  Postgres (templates, design systems,
                        │ (Postgres + │  slide patterns, presentations, jobs)
                        │  Storage +  │  + Storage (.pptx файлы)
                        │  Auth)      │
                        └─────────────┘
```

### Пайплайн анализа шаблона (один раз на шаблон)

1. Пользователь загружает `.pptx` → сохраняется в Supabase Storage.
2. **Парсер** (`src/lib/pptx/parse-template.ts`) распаковывает архив (JSZip) и
   разбирает XML: тему (цвета/шрифты), slideLayouts/slideMasters, реальные
   слайды. Если шаблон не использует стандартные OOXML-плейсхолдеры (типично
   для экспорта из Google Slides/Canva — только свободные текстовые блоки и
   декоративные фигуры), парсер переключается на fallback-разбор всех фигур
   слайда (`rawShapes`).
3. **render-service** (отдельный контейнер на Render.com с LibreOffice
   headless + poppler) конвертирует первые слайды шаблона в PNG — Vercel не
   может запускать LibreOffice в serverless-функции, поэтому это вынесено
   в отдельный сервис.
4. **LLM-анализ дизайн-системы** (`src/lib/llm/analyze-design-system.ts`):
   модели с vision передаются структурные XML-данные + PNG-рендеры. Модель
   восстанавливает палитру ролей, типографику и от 3 до 8 переиспользуемых
   паттернов слайдов (title, agenda, two-column, quote, metrics...), каждый —
   со ссылкой на конкретный слайд-образец в оригинале, который генератор
   позже клонирует.
5. Результат сохраняется в `template_design_systems` и `slide_patterns`.

### Пайплайн генерации презентации (на каждый бриф)

1. Пользователь выбирает готовый шаблон и пишет текстовый бриф (+опционально
   прикладывает файл).
2. **LLM раскладывает контент по слайдам** (`src/lib/llm/generate-content-plan.ts`):
   для каждого смыслового блока брифа выбирает подходящий `patternKey` из
   дизайн-системы и заполняет его роли текстом.
3. **Генератор** (`src/lib/pptx/generate-presentation.ts`) не рендерит слайды
   с нуля: клонирует реальный XML слайда-образца паттерна и точечно подменяет
   текст внутри существующих `<a:t>` — так итоговый файл сохраняет все
   шрифты, тему, эффекты и анимации оригинала. Работает чистым Node.js без
   LibreOffice — детерминированно и быстро.
4. Итоговый `.pptx` сохраняется в Storage, пользователь скачивает готовый файл.

Прогресс обоих пайплайнов пишется в `pipeline_jobs` и опрашивается UI (polling).

## Стек

- **Next.js 16** (App Router, TypeScript, Tailwind) — на Vercel.
- **Supabase** — Postgres (RLS), Auth (email/password), Storage.
- **OpenRouter** — LLM-инференс (vision-модель для анализа шаблона,
  текстовая модель для планирования контента).
- **render-service** — отдельный Node.js + Express сервис с LibreOffice
  headless в Docker-контейнере, задеплоенный на Render.com.
- **jszip** + **fast-xml-parser** — работа с OOXML напрямую, без внешних
  библиотек генерации презентаций.

## Структура репозитория

```
src/
  app/
    page.tsx                    — список шаблонов + загрузка нового
    login/                      — вход (email/password)
    templates/[id]/             — статус анализа + запуск генерации
    presentations/[id]/         — прогресс генерации + скачивание
    api/
      templates/upload          — загрузка .pptx, запуск анализа
      templates/[id]/status     — статус анализа + найденные паттерны
      presentations             — создание презентации по брифу
      presentations/[id]/status — статус генерации
      presentations/[id]/download — скачивание готового .pptx
  lib/
    pptx/
      parse-template.ts         — парсер OOXML (тема, layouts, слайды, fallback)
      generate-presentation.ts  — сборка итогового .pptx клонированием XML
      types.ts
    llm/
      openrouter.ts             — клиент OpenRouter (текст + vision + JSON schema)
      design-system-schema.ts   — JSON Schema результата анализа шаблона
      analyze-design-system.ts  — промпт + вызов анализа дизайн-системы
      content-plan-schema.ts    — JSON Schema плана презентации
      generate-content-plan.ts  — промпт + вызов планирования слайдов
    pipeline/
      analyze-template-job.ts   — оркестрация анализа шаблона с прогрессом
      generate-presentation-job.ts — оркестрация генерации с прогрессом
      render-client.ts          — клиент render-service
    supabase/                   — browser/server/admin клиенты, middleware
    storage/buckets.ts          — имена Storage-бакетов

render-service/                 — отдельный сервис LibreOffice→PNG (Render.com)
supabase/migrations/            — SQL-схема БД
scripts/                        — вспомогательные скрипты для локального теста
  test-parse-template.ts        — проверка парсера на реальном .pptx
  test-generate-presentation.ts — проверка генератора без вызова LLM
```

## Локальный запуск

1. Скопировать `.env.local.example` → `.env.local`, заполнить ключи Supabase
   и OpenRouter (`RENDER_SERVICE_URL`/`_TOKEN` нужны только для анализа
   шаблонов — без них генерация по уже готовым дизайн-системам работает).
2. Применить миграцию `supabase/migrations/0001_init.sql` в Supabase SQL Editor.
3. Создать в Supabase Storage два публичных/приватных бакета: `templates`,
   `presentations` (см. `src/lib/storage/buckets.ts`).
4. `npm install && npm run dev`.

### render-service

```bash
cd render-service
npm install
npm start   # требует локально установленных libreoffice + poppler-utils
```

Деплой — Render.com, Root Directory `render-service`, сборка по `Dockerfile`.

### Проверка парсера/генератора без запуска сервера

```bash
npx tsx scripts/test-parse-template.ts path/to/template.pptx
npx tsx scripts/test-generate-presentation.ts path/to/template.pptx /tmp/out.pptx
```
