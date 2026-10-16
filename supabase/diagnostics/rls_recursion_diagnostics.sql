-- Read-only checks for WatchParty RLS recursion and migration state.
-- Run each section in the Supabase SQL Editor. This file contains no DDL/DML.

-- A. Public tables: RLS enabled / forced and ownership.
select
  n.nspname as schema_name,
  c.relname as table_name,
  pg_get_userbyid(c.relowner) as table_owner,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

-- B. Every public RLS policy and its predicates.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check as with_check_expression
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- C/D. Actual definitions, owners, security modes, function settings, and
-- effective EXECUTE ACL entries for the five relevant functions.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_userbyid(p.proowner) as function_owner,
  l.lanname as language,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_functiondef(p.oid) as function_definition,
  coalesce(
    (
      select jsonb_agg(jsonb_build_object(
        'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
        'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      ) order by acl.grantee, acl.privilege_type)
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
      where acl.privilege_type = 'EXECUTE'
    ),
    '[]'::jsonb
  ) as execute_privileges
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and p.proname in (
    'is_room_member',
    'is_room_host',
    'current_guest_identity',
    'create_room',
    'join_room'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- E. Realtime publication membership for the WatchParty tables.
select
  pub.pubname as publication_name,
  n.nspname as schema_name,
  c.relname as table_name
from pg_publication_tables pt
join pg_publication pub on pub.pubname = pt.pubname
join pg_class c on c.relname = pt.tablename
join pg_namespace n on n.oid = c.relnamespace and n.nspname = pt.schemaname
where pt.schemaname = 'public'
  and pt.tablename in (
    'rooms', 'room_members', 'room_presence', 'room_playback',
    'room_playlist_items', 'room_polls', 'poll_options', 'poll_votes',
    'room_chat_messages', 'room_activity'
  )
order by pub.pubname, c.relname;

-- F. Migration-history availability. If this returns a relation name, run the
-- history query immediately below; local file presence alone is not proof.
select to_regclass('supabase_migrations.schema_migrations') as migration_history_relation;

-- Run only if the relation above exists. SQL Editor migrations may not be
-- recorded there, so also compare function definitions in section C.
select version, name
from supabase_migrations.schema_migrations
where version::text like '20261015%'
   or name ilike '%bind_room_rpc_identity%'
   or name ilike '%rls%recursion%'
order by version;

-- G. Non-internal triggers on rooms / room_members, including trigger function
-- definitions, to identify indirect policy dependencies.
select
  n.nspname as table_schema,
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid) as trigger_definition,
  pn.nspname as function_schema,
  p.proname as trigger_function,
  pg_get_functiondef(p.oid) as trigger_function_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and c.relname in ('rooms', 'room_members')
order by c.relname, t.tgname;
