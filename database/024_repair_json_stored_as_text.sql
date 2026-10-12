-- Older versions of the app saved JSON (salary rules, pay structures, monthly attendance summaries, history) as a
-- text string inside the jsonb column instead of as an object. That made the monthly attendance lock record 0 staff
-- and made every salary rule unreadable. This unwraps such values in place; the content is unchanged.
-- Tables that refuse updates (audit trail, ledgers) are left alone: the app reads them correctly anyway.
CREATE FUNCTION pg_temp.try_jsonb(value text) RETURNS jsonb AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  target record;
  layer integer;
BEGIN
  FOR target IN
    SELECT c.table_name AS table_name, c.column_name AS column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.data_type = 'jsonb'
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger g
        WHERE g.tgrelid = format('public.%I', c.table_name)::regclass AND NOT g.tgisinternal AND g.tgname LIKE '%no_update%'
      )
  LOOP
    FOR layer IN 1..3 LOOP
      EXECUTE format(
        'UPDATE public.%1$I SET %2$I = pg_temp.try_jsonb(%2$I #>> ''{}'') WHERE jsonb_typeof(%2$I) = ''string'' AND (jsonb_typeof(pg_temp.try_jsonb(%2$I #>> ''{}'')) IN (''object'',''array'') OR (jsonb_typeof(pg_temp.try_jsonb(%2$I #>> ''{}'')) = ''string'' AND (pg_temp.try_jsonb(%2$I #>> ''{}'') #>> ''{}'') ~ ''^\s*[\{\["]''))',
        target.table_name, target.column_name
      );
    END LOOP;
  END LOOP;
END
$$;

-- A salary rule that is a plain amount (for example 5) was saved as the text "5".
UPDATE payroll_rules SET formula = (formula #>> '{}')::jsonb
WHERE jsonb_typeof(formula) = 'string' AND (formula #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$';
