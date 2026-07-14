-- Общие ("витринные") шаблоны: доступны всем пользователям для генерации,
-- даже если у пользователя нет своего .pptx. Загружаются администратором
-- сервиса (owner_id может быть NULL — системный шаблон) и помечаются
-- is_public = true.

alter table templates add column if not exists is_public boolean not null default false;

create index if not exists idx_templates_is_public on templates(is_public) where is_public;

-- Публичные шаблоны читает кто угодно (в т.ч. неаутентифицированный anon —
-- достаточно для отображения витрины стилей на главной странице).
create policy "anyone reads public templates"
  on templates for select
  using (is_public = true);

-- design system и patterns публичных шаблонов тоже должны быть читаемы всем,
-- иначе пользователь увидит шаблон, но не паттерны для генерации.
create policy "anyone reads design system of public templates"
  on template_design_systems for select
  using (
    exists (select 1 from templates t where t.id = template_id and t.is_public = true)
  );

create policy "anyone reads patterns of public templates"
  on slide_patterns for select
  using (
    exists (select 1 from templates t where t.id = template_id and t.is_public = true)
  );
