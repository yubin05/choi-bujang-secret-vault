-- 검토용 SQL입니다. Supabase SQL Editor의 postgres 역할로 실행합니다.
-- 변경 대상은 public.aleph_defense_notes의 권한뿐입니다.
-- 메모·기존 RLS 정책·다른 테이블·Auth·service_role 부여 권한은 변경하지 않습니다.
BEGIN;

-- 적용 전 직접 부여 내역. PUBLIC 확인을 위해 table_privileges도 조회합니다.
SELECT 'before' AS phase, grantor, grantee, privilege_type, is_grantable
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'aleph_defense_notes'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

SELECT 'before' AS phase, grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'aleph_defense_notes'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

SELECT 'before' AS phase, r.role_name, p.privilege,
  CASE WHEN p.privilege = 'MAINTAIN'
      AND current_setting('server_version_num')::integer < 170000 THEN NULL
    ELSE has_table_privilege(r.role_name, 'public.aleph_defense_notes', p.privilege)
  END AS allowed
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(privilege)
ORDER BY r.role_name, p.privilege;

REVOKE ALL ON TABLE public.aleph_defense_notes
FROM PUBLIC, anon, authenticated;

-- 테이블 권한과 별도로 남는 열 단위 권한도 이 표에 한해서 회수합니다.
DO $$
DECLARE
  column_record record;
BEGIN
  FOR column_record IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aleph_defense_notes'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%I) ON TABLE public.aleph_defense_notes FROM PUBLIC, anon, authenticated',
      column_record.column_name
    );
  END LOOP;
END $$;

-- 상속 등으로 실제 권한이 남거나 서버 권한이 없으면 전체 변경을 취소합니다.
DO $$
DECLARE
  r text;
  p text;
  privileges text[] := ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE',
    'TRUNCATE', 'REFERENCES', 'TRIGGER'];
BEGIN
  IF current_setting('server_version_num')::integer >= 170000 THEN
    privileges := array_append(privileges, 'MAINTAIN');
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH p IN ARRAY privileges LOOP
      IF has_table_privilege(r, 'public.aleph_defense_notes', p) THEN
        RAISE EXCEPTION '직접 테이블 권한이 남음: 역할 %, 권한 %. 변경을 취소합니다.', r, p;
      END IF;
    END LOOP;
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF has_any_column_privilege(r, 'public.aleph_defense_notes', p) THEN
        RAISE EXCEPTION '직접 열 권한이 남음: 역할 %, 권한 %. 변경을 취소합니다.', r, p;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.aleph_defense_notes', p) THEN
      RAISE EXCEPTION '서버용 service_role에 % 권한이 없습니다. 변경을 취소합니다.', p;
    END IF;
  END LOOP;
END $$;

SELECT 'after' AS phase, grantor, grantee, privilege_type, is_grantable
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'aleph_defense_notes'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

SELECT 'after' AS phase, grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'aleph_defense_notes'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

SELECT 'after' AS phase, r.role_name, p.privilege,
  CASE WHEN p.privilege = 'MAINTAIN'
      AND current_setting('server_version_num')::integer < 170000 THEN NULL
    ELSE has_table_privilege(r.role_name, 'public.aleph_defense_notes', p.privilege)
  END AS allowed
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(privilege)
ORDER BY r.role_name, p.privilege;

COMMIT;
