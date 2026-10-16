-- Read-only WatchParty deployment and RPC preflight.
-- Run in the Supabase SQL Editor. This script contains catalog SELECTs and one
-- DO block that dynamically performs SELECTs against a migration ledger only
-- if a recognized ledger relation exists. It does not change database state.
--
-- Identity-detection columns are indicators, not a security verdict. Read the
-- complete function/helper definitions and verify that mismatches are rejected
-- before allowing any caller-supplied identity to reach a write.

-- A. Full room RPC definitions, owners, SECURITY DEFINER flags, and settings.
with requested(function_name, expected_argument_names) as (
  values
    ('create_room', array['p_code', 'p_display_name', 'p_created_by_user_id', 'p_created_by_guest_id', 'p_metadata']::text[]),
    ('join_room', array['p_code', 'p_display_name', 'p_user_id', 'p_guest_id']::text[])
)
select
  'public.' || r.function_name as requested_function,
  case when p.oid is null then 'MISSING' else 'PRESENT' end as function_status,
  p.oid as function_oid,
  pg_get_function_identity_arguments(p.oid) as actual_identity_arguments,
  p.proargnames as actual_argument_names,
  r.expected_argument_names,
  p.proargnames[1:p.pronargs] = r.expected_argument_names as argument_names_match_expected,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_functiondef(p.oid) as complete_definition
from requested r
left join pg_namespace n on n.nspname = 'public'
left join pg_proc p on p.pronamespace = n.oid and p.proname = r.function_name
order by r.function_name, actual_identity_arguments nulls first, p.oid;

-- B. Effective EXECUTE privileges and identity-source comparison indicators.
-- The comparison indicators only find likely comparisons in the function
-- source; they do not establish correct control flow or rejection behavior.
with requested(function_name, expected_argument_names, user_argument_position, guest_argument_position) as (
  values
    ('create_room', array['p_code', 'p_display_name', 'p_created_by_user_id', 'p_created_by_guest_id', 'p_metadata']::text[], 3, 4),
    ('join_room', array['p_code', 'p_display_name', 'p_user_id', 'p_guest_id']::text[], 3, 4)
), function_rows as (
  select r.*, p.oid, p.prosrc, p.proargnames, p.pronargs,
         p.proargnames[r.user_argument_position] as user_argument,
         p.proargnames[r.guest_argument_position] as guest_argument,
         regexp_replace(coalesce(p.prosrc, ''), '[[:space:]]+', '', 'g') as compact_body
  from requested r
  left join pg_namespace n on n.nspname = 'public'
  left join pg_proc p on p.pronamespace = n.oid and p.proname = r.function_name
)
select
  'public.' || f.function_name as requested_function,
  case when f.oid is null then 'MISSING' else 'PRESENT' end as function_status,
  f.oid as function_oid,
  pg_get_function_identity_arguments(f.oid) as actual_identity_arguments,
  f.proargnames as actual_argument_names,
  f.expected_argument_names,
  f.proargnames[1:f.pronargs] = f.expected_argument_names as argument_names_match_expected,
  f.user_argument as user_argument_name,
  f.guest_argument as guest_argument_name,
  case when f.oid is null then null else has_function_privilege('anon', f.oid, 'EXECUTE') end as anon_effective_execute,
  case when f.oid is null then null else has_function_privilege('authenticated', f.oid, 'EXECUTE') end as authenticated_effective_execute,
  case when f.oid is null then null else exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) end as public_direct_execute,
  case when f.oid is null then null else
    position(f.user_argument in f.prosrc) > 0
  end as supplied_user_argument_referenced,
  case when f.oid is null then null else
    f.compact_body ~* (f.user_argument || '.{0,120}(auth[.]uid|auth[.]jwt|current_participant_identity|request[.]jwt[.]claim[.]sub)')
    or f.compact_body ~* ('(auth[.]uid|auth[.]jwt|current_participant_identity|request[.]jwt[.]claim[.]sub).{0,120}' || f.user_argument)
  end as user_to_trusted_identity_comparison_candidate,
  case when f.oid is null then null else
    position(f.guest_argument in f.prosrc) > 0
  end as supplied_guest_argument_referenced,
  case when f.oid is null then null else
    f.compact_body ~* (f.guest_argument || '.{0,120}(current_guest_identity|auth[.]jwt|request[.]jwt[.]claims)')
    or f.compact_body ~* ('(current_guest_identity|auth[.]jwt|request[.]jwt[.]claims).{0,120}' || f.guest_argument)
  end as guest_to_trusted_identity_comparison_candidate,
  f.prosrc as function_body_for_identity_review
from function_rows f
left join pg_proc p on p.oid = f.oid
order by f.function_name, actual_identity_arguments nulls first, f.oid;

-- C. Definitions of the identity helpers referenced by room RPCs.
-- Verify any helper used by an RPC derives its identity from verified JWT
-- claims and does not accept caller-controlled identity input.
select
  n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function_signature,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_functiondef(p.oid) as complete_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_guest_identity', 'current_participant_identity')
order by p.proname;

-- D. Host-transfer and poll-creation RPC presence, security, settings, and ACLs.
with requested(function_name, expected_argument_names) as (
  values
    ('transfer_room_host', array['p_room_id', 'p_target_user_id']::text[]),
    ('create_room_poll', array['p_room_id', 'p_question', 'p_options']::text[])
)
select
  'public.' || r.function_name as requested_function,
  case when p.oid is null then 'MISSING' else 'PRESENT' end as function_status,
  p.oid as function_oid,
  pg_get_function_identity_arguments(p.oid) as actual_identity_arguments,
  p.proargnames as actual_argument_names,
  r.expected_argument_names,
  p.proargnames[1:p.pronargs] = r.expected_argument_names as argument_names_match_expected,
  pg_get_userbyid(p.proowner) as owner,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  case when p.oid is null then null else has_function_privilege('anon', p.oid, 'EXECUTE') end as anon_effective_execute,
  case when p.oid is null then null else has_function_privilege('authenticated', p.oid, 'EXECUTE') end as authenticated_effective_execute,
  case when p.oid is null then null else exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) end as public_direct_execute,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'grantee', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      'privilege', a.privilege_type,
      'grantable', a.is_grantable
    ) order by a.grantee, a.privilege_type)
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where a.privilege_type = 'EXECUTE'
  ), '[]'::jsonb) as execute_acl,
  pg_get_functiondef(p.oid) as complete_definition
from requested r
left join pg_namespace n on n.nspname = 'public'
left join pg_proc p on p.pronamespace = n.oid and p.proname = r.function_name
order by r.function_name, actual_identity_arguments nulls first, p.oid;

-- E. Current table UPDATE privileges relevant to transfer_room_host.sql.
-- The transfer migration revokes UPDATE from authenticated on both tables.
select
  'public.rooms' as table_name,
  has_table_privilege('authenticated', 'public.rooms', 'UPDATE') as authenticated_can_update,
  has_table_privilege('postgres', 'public.rooms', 'UPDATE') as postgres_can_update
union all
select
  'public.room_members',
  has_table_privilege('authenticated', 'public.room_members', 'UPDATE'),
  has_table_privilege('postgres', 'public.room_members', 'UPDATE');

-- F. Migration-ledger evidence, if a recognized ledger relation exists.
-- An absent ledger, missing row, or empty result is NOT evidence that a
-- migration's schema changes are absent: SQL Editor changes may not be logged.
do $$
declare
  ledger record;
  ledger_found boolean := false;
  matching_rows jsonb;
begin
  for ledger in
    select c.oid::regclass as relation_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relname = 'schema_migrations'
      and n.nspname in ('supabase_migrations', 'public')
      and c.relkind in ('r', 'p', 'v', 'm')
  loop
    ledger_found := true;
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(m)), ''[]''::jsonb) from %s m where to_jsonb(m)::text ilike any ($1)',
      ledger.relation_name
    ) into matching_rows
    using array[
      '%20261015%',
      '%room_chat_reactions%',
      '%room_playlist_host_delete%',
      '%transfer_room_host%',
      '%room_realtime_presence%',
      '%room_polls%'
    ];

    raise notice 'Migration ledger %: matching metadata rows: %. Empty or absent rows do not prove schema changes are absent.',
      ledger.relation_name, matching_rows;
  end loop;

  if not ledger_found then
    raise notice 'No recognized migration ledger found. This does not prove that migrations are absent.';
  end if;
end;
$$;
