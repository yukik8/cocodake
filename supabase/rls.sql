-- Re-enable RLS
alter table places enable row level security;
alter table shared_lists enable row level security;
alter table place_photos enable row level security;   -- ポリシーなし。サーバー（service role）だけ

-- places: 自分のデータだけ読み書き可能
create policy "users manage own places" on places
  for all
  using (user_session = auth.uid()::text)
  with check (user_session = auth.uid()::text);

-- shared_lists: ポリシーなし。読み書きはサーバー（service role）だけ。
-- 共有ページはサーバー側で1件ずつ読み、期限も確かめる。以前の「誰でも読める」ポリシーでは、
-- 公開されている anon キーで全件（期限切れも、持ち主の ID も）一覧できた
