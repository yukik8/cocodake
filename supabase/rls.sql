-- Re-enable RLS
alter table places enable row level security;
alter table shared_lists enable row level security;

-- places: 自分のデータだけ読み書き可能
create policy "users manage own places" on places
  for all
  using (user_session = auth.uid()::text)
  with check (user_session = auth.uid()::text);

-- shared_lists: 誰でも読める（共有URL）、作成は認証ユーザーのみ
create policy "anyone can read shared_lists" on shared_lists
  for select using (true);

create policy "authenticated users can insert shared_lists" on shared_lists
  for insert with check (auth.role() = 'authenticated');
