-- Цифровой дизайнер презентаций: базовая схема.
-- Шаблон разбирается один раз — дизайн-система кэшируется и переиспользуется
-- для любого количества генераций контента.

create extension if not exists "pgcrypto";

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  original_filename text not null,
  storage_path text not null,           -- путь к исходному .pptx в Storage
  status text not null default 'uploaded'
    check (status in ('uploaded', 'analyzing', 'ready', 'failed')),
  error_message text,
  slide_width_emu bigint,
  slide_height_emu bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Извлечённая дизайн-система шаблона: палитра, типографика, паттерны слайдов.
-- Одна запись на шаблон (1:1), но вынесена отдельно, т.к. это дорогой LLM-артефакт.
create table if not exists template_design_systems (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade unique,
  theme jsonb not null,                 -- цвета, шрифты темы (theme1.xml)
  typography jsonb not null,            -- роли текста -> размеры/начертания
  color_roles jsonb not null,           -- семантические роли цвета (accent, bg, text...)
  spacing jsonb,                        -- сетки/отступы, если удалось выявить
  raw_analysis jsonb,                   -- полный ответ LLM-анализа для отладки
  created_at timestamptz not null default now()
);

-- Типовые паттерны слайдов, найденные в шаблоне (title, agenda, two-column, quote...)
-- Каждый паттерн хранит XML-скелет layout/slide для последующего клонирования.
create table if not exists slide_patterns (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references templates(id) on delete cascade,
  pattern_key text not null,            -- напр. 'title', 'section', 'two-column', 'chart'
  label text not null,                  -- человекочитаемое описание для LLM/UI
  description text,
  source_slide_index int,               -- индекс слайда-образца в исходном pptx
  layout_xml_path text,                 -- путь к slideLayoutN.xml внутри архива
  placeholders jsonb not null,          -- описание плейсхолдеров: тип, роль, координаты, ограничения
  preview_image_path text,              -- PNG-рендер образца (Storage)
  created_at timestamptz not null default now(),
  unique (template_id, pattern_key)
);

create table if not exists presentations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  template_id uuid not null references templates(id) on delete restrict,
  title text not null,
  content_brief text not null,          -- исходный текст/бриф пользователя
  content_file_storage_path text,       -- опциональный приложенный файл
  status text not null default 'pending'
    check (status in ('pending', 'planning', 'generating', 'rendering', 'ready', 'failed')),
  error_message text,
  result_storage_path text,             -- готовый .pptx
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists presentation_slides (
  id uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references presentations(id) on delete cascade,
  position int not null,
  pattern_id uuid references slide_patterns(id),
  content jsonb not null,               -- итоговое текстовое наполнение по ролям плейсхолдеров
  notes text,
  created_at timestamptz not null default now(),
  unique (presentation_id, position)
);

-- Универсальный лог фоновых этапов пайплайна (анализ шаблона / генерация презентации)
create table if not exists pipeline_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('template_analysis', 'presentation_generation')),
  template_id uuid references templates(id) on delete cascade,
  presentation_id uuid references presentations(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  step text,                            -- текущий шаг для прогресс-бара UI
  progress int not null default 0 check (progress between 0 and 100),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_slide_patterns_template on slide_patterns(template_id);
create index if not exists idx_presentation_slides_presentation on presentation_slides(presentation_id);
create index if not exists idx_pipeline_jobs_template on pipeline_jobs(template_id);
create index if not exists idx_pipeline_jobs_presentation on pipeline_jobs(presentation_id);

alter table templates enable row level security;
alter table template_design_systems enable row level security;
alter table slide_patterns enable row level security;
alter table presentations enable row level security;
alter table presentation_slides enable row level security;
alter table pipeline_jobs enable row level security;

create policy "owners manage their templates" on templates
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "read design system of own template" on template_design_systems
  for select using (
    exists (select 1 from templates t where t.id = template_id and t.owner_id = auth.uid())
  );
create policy "service writes design system" on template_design_systems
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "read patterns of own template" on slide_patterns
  for select using (
    exists (select 1 from templates t where t.id = template_id and t.owner_id = auth.uid())
  );
create policy "service writes patterns" on slide_patterns
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "owners manage their presentations" on presentations
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "read slides of own presentation" on presentation_slides
  for select using (
    exists (select 1 from presentations p where p.id = presentation_id and p.owner_id = auth.uid())
  );
create policy "service writes slides" on presentation_slides
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create policy "read own jobs" on pipeline_jobs
  for select using (
    exists (select 1 from templates t where t.id = template_id and t.owner_id = auth.uid())
    or exists (select 1 from presentations p where p.id = presentation_id and p.owner_id = auth.uid())
  );
create policy "service writes jobs" on pipeline_jobs
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
