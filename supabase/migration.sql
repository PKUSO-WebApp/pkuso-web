-- ============================================================
-- PKUSO 交响乐团管理系统 — 数据库初始化脚本
-- 在 Supabase SQL Editor 中完整运行此文件
-- ============================================================

-- 0. 扩展
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. 表定义
-- ============================================================

-- 1.1 profiles: 用户档案(扩展 auth.users)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  instrument text,
  status     text default 'pending' check (status in ('pending','approved','rejected')),
  role       text default 'member' check (role in ('admin','member')),
  college    text,
  join_date  text,
  created_at timestamptz default now()
);

-- 1.2 rehearsals: 排练日程
create table if not exists public.rehearsals (
  id             bigint generated always as identity primary key,
  title          text,
  date           text,
  time           text,  -- deprecated, 使用 start_time/end_time
  start_time     text,
  end_time       text,
  location       text,
  repertoire     text,
  type           text default 'full' check (type in ('full','section')),
  target_section text,
  sign_in_code   text,
  created_at     timestamptz default now()
);

-- 1.3 attendances: 考勤记录
create table if not exists public.attendances (
  id           bigint generated always as identity primary key,
  rehearsal_id bigint not null references public.rehearsals(id) on delete cascade,
  user_id      uuid   not null references auth.users(id) on delete cascade,
  status       text   default 'absent' check (status in ('present','leave','absent')),
  unique(rehearsal_id, user_id)
);

-- 1.4 announcements: 全团公告
create table if not exists public.announcements (
  id         uuid primary key default uuid_generate_v4(),
  content    text,
  created_at timestamptz default now()
);

-- 1.5 posts: 社区帖子(重奏/团建)
create table if not exists public.posts (
  id               uuid primary key default uuid_generate_v4(),
  title            text not null,
  type             text not null default 'ensemble' check (type in ('ensemble','gathering')),
  content          text,
  image_url        text,
  author_id        uuid not null references auth.users(id) on delete cascade,
  contact_info     text,
  current_sections text,
  missing_sections text,
  created_at       timestamptz default now()
);

-- ============================================================
-- 2. 视图: users(供 API 查询邮箱,包装 auth.users)
-- ============================================================
create or replace view public.users as
select id, email from auth.users;

-- ============================================================
-- 3. 索引
-- ============================================================
create index if not exists idx_profiles_status  on public.profiles(status);
create index if not exists idx_attendances_rid   on public.attendances(rehearsal_id);
create index if not exists idx_attendances_uid   on public.attendances(user_id);
create index if not exists idx_posts_author      on public.posts(author_id);
create index if not exists idx_posts_created     on public.posts(created_at desc);

-- ============================================================
-- 4. RLS 策略
-- ============================================================
alter table public.profiles      enable row level security;
alter table public.rehearsals    enable row level security;
alter table public.attendances   enable row level security;
alter table public.announcements enable row level security;
alter table public.posts         enable row level security;

-- 4.1 profiles
create policy "profiles: 所有人可读已通过用户"
  on public.profiles for select
  to authenticated
  using (status = 'approved' or auth.uid() = id);

create policy "profiles: 可插入自己的档案"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "profiles: 可更新自己的档案"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

create policy "profiles: 管理员可更新所有"
  on public.profiles for update
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 4.2 rehearsals: 所有人可读,管理员可写
create policy "rehearsals: 所有人可读"
  on public.rehearsals for select
  to authenticated
  using (true);

create policy "rehearsals: 管理员可插入"
  on public.rehearsals for insert
  to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "rehearsals: 管理员可更新"
  on public.rehearsals for update
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "rehearsals: 管理员可删除"
  on public.rehearsals for delete
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 4.3 attendances
create policy "attendances: 所有人可读"
  on public.attendances for select
  to authenticated
  using (true);

create policy "attendances: 所有人可插入自己的记录"
  on public.attendances for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "attendances: 可更新自己的记录"
  on public.attendances for update
  to authenticated
  using (auth.uid() = user_id);

create policy "attendances: 管理员可管理所有"
  on public.attendances for all
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 4.4 announcements
create policy "announcements: 所有人可读"
  on public.announcements for select
  to authenticated
  using (true);

create policy "announcements: 管理员可插入"
  on public.announcements for insert
  to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- 4.5 posts
create policy "posts: 所有人可读"
  on public.posts for select
  to authenticated
  using (true);

create policy "posts: 所有人可插入"
  on public.posts for insert
  to authenticated
  with check (auth.uid() = author_id);

create policy "posts: 作者或管理员可更新"
  on public.posts for update
  to authenticated
  using (auth.uid() = author_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "posts: 作者或管理员可删除"
  on public.posts for delete
  to authenticated
  using (auth.uid() = author_id or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- 5. 触发器: 新用户注册后自动创建 profiles 行
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, instrument, status, role, created_at)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'instrument',
    'pending',
    'member',
    now()
  );
  return new;
end;
$$;

-- 如果触发器已存在则替换
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
