-- Политики доступа к Storage-бакетам. Без них storage.objects (RLS включён
-- по умолчанию) запрещает любые операции даже аутентифицированным.
--
-- Соглашения о путях:
--   templates:      <user_id>/<template_id>/original.pptx
--   presentations:  <user_id>/<presentation_id>/content-source  (приложенный файл)
--                   <presentation_id>/result.pptx               (итог генерации)

-- templates: владелец работает только со своей папкой <user_id>/...
create policy "templates: users manage own folder"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'templates'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'templates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- presentations: первая папка — либо user_id владельца, либо id его презентации
create policy "presentations: users manage own files"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'presentations'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.presentations p
        where p.id::text = (storage.foldername(name))[1]
          and p.owner_id = auth.uid()
      )
    )
  )
  with check (
    bucket_id = 'presentations'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.presentations p
        where p.id::text = (storage.foldername(name))[1]
          and p.owner_id = auth.uid()
      )
    )
  );
