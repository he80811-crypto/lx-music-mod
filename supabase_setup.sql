-- ============================================================
-- lx-music 云同步 Supabase 初始化脚本
-- 用法：打开 Supabase Dashboard -> SQL Editor -> 粘贴执行
-- 重要：把第 52 行的 'YOUR_SYNC_SECRET_HERE' 改成你自己的同步密钥
--       （这个密钥就是客户端设置里要填的 sync-secret）
-- ============================================================

-- 设备表：每台运行 lx-music 的设备注册一条
create table if not exists public.lx_sync_devices (
  id         text primary key,          -- 客户端生成的 uuid
  name       text not null,             -- 设备名（如 PC-NAME）
  platform   text not null default 'desktop',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 快照表：每个数据类型一份全量数据（md5 用于冲突检测）
create table if not exists public.lx_sync_snapshots (
  data_type  text primary key,          -- 'list' | 'dislike'
  md5        text not null,
  data       jsonb not null,
  device_id  text not null,
  updated_at timestamptz not null default now()
);

-- 动作表：增量同步事件（所有设备共享一个递增队列）
create table if not exists public.lx_sync_actions (
  id         bigserial primary key,
  data_type  text not null,             -- 'list' | 'dislike'
  device_id  text not null,             -- 产生动作的设备
  action     jsonb not null,            -- LX.Sync.List.ActionList / Dislike.ActionList
  created_at timestamptz not null default now()
);
create index if not exists idx_lx_sync_actions_type_id
  on public.lx_sync_actions (data_type, id);

-- 消费游标：每设备每类型已消费到的最大动作 id
create table if not exists public.lx_sync_cursors (
  device_id       text not null,
  data_type       text not null,
  last_action_id  bigint not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (device_id, data_type)
);

-- 元数据表：存放同步密钥（所有客户端共用，RLS 校验依据）
create table if not exists public.lx_sync_meta (
  key   text primary key,
  value text not null
);

insert into public.lx_sync_meta (key, value)
values ('sync_secret', 'YOUR_SYNC_SECRET_HERE')
on conflict (key) do update set value = excluded.value;

-- ============================================================
-- RLS：客户端请求必须带 header x-sync-secret 且等于 meta 里存的密钥
-- ============================================================

create or replace function public.lx_sync_verify()
returns boolean
language sql stable security definer as $$
  select (current_setting('request.headers', true)::json ->> 'x-sync-secret')
         = (select value from public.lx_sync_meta where key = 'sync_secret')
$$;

alter table public.lx_sync_devices   enable row level security;
alter table public.lx_sync_snapshots enable row level security;
alter table public.lx_sync_actions   enable row level security;
alter table public.lx_sync_cursors   enable row level security;
alter table public.lx_sync_meta      enable row level security;

drop policy if exists lx_sync_devices_policy   on public.lx_sync_devices;
drop policy if exists lx_sync_snapshots_policy on public.lx_sync_snapshots;
drop policy if exists lx_sync_actions_policy   on public.lx_sync_actions;
drop policy if exists lx_sync_cursors_policy   on public.lx_sync_cursors;
drop policy if exists lx_sync_meta_policy      on public.lx_sync_meta;

create policy lx_sync_devices_policy   on public.lx_sync_devices   for all using (public.lx_sync_verify()) with check (public.lx_sync_verify());
create policy lx_sync_snapshots_policy on public.lx_sync_snapshots for all using (public.lx_sync_verify()) with check (public.lx_sync_verify());
create policy lx_sync_actions_policy   on public.lx_sync_actions   for all using (public.lx_sync_verify()) with check (public.lx_sync_verify());
create policy lx_sync_cursors_policy   on public.lx_sync_cursors   for all using (public.lx_sync_verify()) with check (public.lx_sync_verify());
create policy lx_sync_meta_policy      on public.lx_sync_meta      for all using (public.lx_sync_verify()) with check (public.lx_sync_verify());

-- 说明：secret 本身也是通过该表校验的，客户端只读不写；如需改密钥，直接 update 本表
-- update public.lx_sync_meta set value = '新密钥' where key = 'sync_secret';
