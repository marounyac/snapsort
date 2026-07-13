-- SnapSort social layer — full schema + Row Level Security.
-- Paste this whole file into the Supabase dashboard: SQL Editor → New query → Run.
-- Safe to run once on a fresh project.

-- ---------- profiles (public identity: user id <-> username) ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);
create unique index profiles_username_key on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "signed-in users can look up profiles"
  on public.profiles for select to authenticated using (true);

-- A profile row is created automatically when an account signs up;
-- the username travels in the signup metadata.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'username', 'user_' || left(new.id::text, 8)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- friendships ----------

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  unique (requester, addressee),
  check (requester <> addressee)
);

alter table public.friendships enable row level security;

create policy "participants can see their friendships"
  on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));

create policy "anyone signed in can send a request"
  on public.friendships for insert to authenticated
  with check (auth.uid() = requester and status = 'pending');

create policy "the addressee answers the request"
  on public.friendships for update to authenticated
  using (auth.uid() = addressee)
  with check (status in ('accepted', 'blocked'));

create policy "either side can remove the friendship"
  on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));

-- ---------- shared categories + membership ----------

create table public.shared_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  description text check (char_length(description) <= 80),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.shared_category_members (
  category_id uuid not null references public.shared_categories (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (category_id, user_id)
);

-- security definer so policies can check membership without recursing
-- through the members table's own RLS
create function public.is_member(cat uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from shared_category_members
    where category_id = cat and user_id = auth.uid()
  );
$$;

alter table public.shared_categories enable row level security;
alter table public.shared_category_members enable row level security;

create policy "members can see the category"
  on public.shared_categories for select to authenticated
  using (public.is_member(id) or owner_id = auth.uid());

create policy "anyone signed in can create a category they own"
  on public.shared_categories for insert to authenticated
  with check (owner_id = auth.uid());

create policy "members can rename or edit the category"
  on public.shared_categories for update to authenticated
  using (public.is_member(id))
  with check (owner_id is not null);

create policy "only the owner deletes the category"
  on public.shared_categories for delete to authenticated
  using (owner_id = auth.uid());

create policy "members can see the member list"
  on public.shared_category_members for select to authenticated
  using (public.is_member(category_id));

create policy "the category owner adds members"
  on public.shared_category_members for insert to authenticated
  with check (exists (
    select 1 from public.shared_categories c
    where c.id = category_id and c.owner_id = auth.uid()
  ));

create policy "leave, or be removed by the owner"
  on public.shared_category_members for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.shared_categories c
      where c.id = category_id and c.owner_id = auth.uid()
    )
  );

-- ---------- shared photos (metadata; files live in the storage bucket) ----------

create table public.shared_photos (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.shared_categories (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  thumb_path text,
  name text,
  created_at timestamptz not null default now()
);

alter table public.shared_photos enable row level security;

create policy "members can see shared photos"
  on public.shared_photos for select to authenticated
  using (public.is_member(category_id));

create policy "members upload their own photos"
  on public.shared_photos for insert to authenticated
  with check (public.is_member(category_id) and uploader_id = auth.uid());

create policy "uploader or category owner deletes a photo"
  on public.shared_photos for delete to authenticated
  using (
    uploader_id = auth.uid()
    or exists (
      select 1 from public.shared_categories c
      where c.id = category_id and c.owner_id = auth.uid()
    )
  );

-- ---------- messages (per friendship OR per shared category) ----------

create function public.is_friend_participant(f uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from friendships
    where id = f and status = 'accepted' and auth.uid() in (requester, addressee)
  );
$$;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  friendship_id uuid references public.friendships (id) on delete cascade,
  category_id uuid references public.shared_categories (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  type text not null default 'text' check (type in ('text', 'image', 'gif')),
  content text not null check (char_length(content) <= 4000),
  created_at timestamptz not null default now(),
  check ((friendship_id is null) <> (category_id is null))
);

alter table public.messages enable row level security;

create policy "participants and members can read messages"
  on public.messages for select to authenticated
  using (
    (friendship_id is not null and public.is_friend_participant(friendship_id))
    or (category_id is not null and public.is_member(category_id))
  );

create policy "senders write their own messages where they belong"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and (
      (friendship_id is not null and public.is_friend_participant(friendship_id))
      or (category_id is not null and public.is_member(category_id))
    )
  );

create policy "senders can delete their own messages"
  on public.messages for delete to authenticated
  using (sender_id = auth.uid());

-- ---------- realtime (friend requests + chat) ----------

alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.messages;

-- ---------- storage: private bucket for shared photos ----------
-- Files are stored as <category_id>/<file>, so the first folder names the
-- category the file belongs to.

insert into storage.buckets (id, name, public) values ('shared', 'shared', false);

create policy "members read shared files"
  on storage.objects for select to authenticated
  using (bucket_id = 'shared' and public.is_member(((storage.foldername(name))[1])::uuid));

create policy "members upload shared files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shared'
    and public.is_member(((storage.foldername(name))[1])::uuid)
    and owner = auth.uid()
  );

create policy "uploader or category owner deletes shared files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'shared'
    and (
      owner = auth.uid()
      or exists (
        select 1 from public.shared_categories c
        where c.id = ((storage.foldername(name))[1])::uuid and c.owner_id = auth.uid()
      )
    )
  );
