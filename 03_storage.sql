-- الملف 3: مخزن صور المنتجات (شغّله بعد الملف 1 و 2)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop', 'shop', true, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 3145728,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists shop_read   on storage.objects;
drop policy if exists shop_insert on storage.objects;
drop policy if exists shop_update on storage.objects;
drop policy if exists shop_delete on storage.objects;
create policy shop_read   on storage.objects for select using (bucket_id = 'shop');
create policy shop_insert on storage.objects for insert to authenticated with check (bucket_id = 'shop' and public.is_admin());
create policy shop_update on storage.objects for update to authenticated using (bucket_id = 'shop' and public.is_admin());
create policy shop_delete on storage.objects for delete to authenticated using (bucket_id = 'shop' and public.is_admin());
