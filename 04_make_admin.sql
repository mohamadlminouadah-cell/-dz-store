-- الملف 4: اجعل حسابك مديراً (بعد إنشاء المستخدم من Authentication > Users)
-- غيّر البريد أدناه إلى بريدك ثم اضغط Run
insert into public.admin_users (user_id)
select id from auth.users where email = 'ضع_بريدك_هنا@gmail.com'
on conflict do nothing;

-- للتأكد: يجب أن يظهر صف واحد
select u.email, a.created_at from public.admin_users a join auth.users u on u.id = a.user_id;
