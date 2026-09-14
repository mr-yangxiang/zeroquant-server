import type { Migration } from './types.js'

/** Lossless, forward-only reconciliation. No UUID regeneration or timezone guesses. */
export const migration008: Migration = {
  version: '008', name: 'legacy_schema_compatibility_preserve_values',
  async up(client) {
    await client.query(`
      SET LOCAL search_path = public, pg_catalog;
      DO $repair$
      DECLARE t text; typ text; seq text; item record; too_long bigint;
      BEGIN
        -- Never silently truncate a wider legacy field during normalization.
        FOR item IN SELECT * FROM (VALUES
          ('stock_day_predictions','direction',40),
          ('stock_rolling_predictions','target_time',10),
          ('stock_l2_orders','time_str',10)) AS limits(t,c,n)
        LOOP
          EXECUTE format('SELECT count(*) FROM public.%I WHERE length(%I) > %s', item.t,item.c,item.n) INTO too_long;
          IF too_long > 0 THEN RAISE EXCEPTION 'Field %.% contains oversized values; explicit review required',item.t,item.c; END IF;
        END LOOP;
        -- Preserve both legacy UUID strings and old integer IDs as text.
        FOREACH t IN ARRAY ARRAY['users','stock_price_histories','stock_t_analyses'] LOOP
          SELECT data_type INTO typ FROM information_schema.columns
            WHERE table_schema='public' AND table_name=t AND column_name='id';
          IF typ NOT IN ('integer','bigint','text','uuid') OR typ IS NULL THEN
            RAISE EXCEPTION 'Unsupported ID type for %: %', t, typ;
          END IF;
          IF typ <> 'text' THEN
            IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid=format('public.%I',t)::regclass) THEN
              RAISE EXCEPTION 'External foreign key requires explicit ID migration for %', t;
            END IF;
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id DROP DEFAULT',t);
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id TYPE text USING id::text',t);
          END IF;
          EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()::text',t);
        END LOOP;
        -- Text widening never truncates existing identifiers or descriptions.
        FOR item IN SELECT * FROM (VALUES
          ('users','username'),('users','phone'),('users','password'),
          ('stocks','code'),('stocks','full_code'),('stocks','name'),
          ('stock_price_histories','stock_code'),('stock_t_analyses','stock_code'),
          ('stock_l2_orders','type')) AS fields(t,c)
        LOOP
          SELECT data_type INTO typ FROM information_schema.columns
            WHERE table_schema='public' AND table_name=item.t AND column_name=item.c;
          IF typ NOT IN ('text','character varying') OR typ IS NULL THEN
            RAISE EXCEPTION 'Unsupported text type for %.%', item.t,item.c;
          END IF;
          IF typ <> 'text' THEN
            EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE text',item.t,item.c);
          END IF;
        END LOOP;
        -- Widen counters without changing any stored ID value.
        FOREACH t IN ARRAY ARRAY['stock_day_predictions','stock_rolling_predictions','stock_l2_orders'] LOOP
          SELECT data_type INTO typ FROM information_schema.columns
            WHERE table_schema='public' AND table_name=t AND column_name='id';
          IF typ NOT IN ('integer','bigint') OR typ IS NULL THEN RAISE EXCEPTION 'Unsupported counter for %',t; END IF;
          IF typ <> 'bigint' THEN EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id TYPE bigint',t); END IF;
          seq := pg_get_serial_sequence(format('public.%I',t),'id');
          IF seq IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE %s AS bigint',seq); END IF;
        END LOOP;
      END $repair$;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
      ALTER TABLE users ALTER COLUMN created_at DROP NOT NULL,
        ALTER COLUMN updated_at DROP NOT NULL, ALTER COLUMN updated_at SET DEFAULT NOW();
      ALTER TABLE stock_price_histories ADD COLUMN IF NOT EXISTS trade_date DATE;
      ALTER TABLE stock_t_analyses ADD COLUMN IF NOT EXISTS do_reasons TEXT,
        ADD COLUMN IF NOT EXISTS dont_reasons TEXT, ADD COLUMN IF NOT EXISTS realtime_advice TEXT;

      ALTER TABLE stocks ALTER COLUMN current_price DROP NOT NULL,
        ALTER COLUMN yesterday_price DROP NOT NULL, ALTER COLUMN high_price DROP NOT NULL,
        ALTER COLUMN low_price DROP NOT NULL, ALTER COLUMN pct DROP NOT NULL,
        ALTER COLUMN predicted_high DROP NOT NULL, ALTER COLUMN predicted_low DROP NOT NULL,
        ALTER COLUMN win_rate DROP NOT NULL, ALTER COLUMN is_hot DROP NOT NULL,
        ALTER COLUMN updated_at DROP NOT NULL, ALTER COLUMN updated_at SET DEFAULT NOW();
      ALTER TABLE stock_price_histories ALTER COLUMN stock_code DROP NOT NULL,
        ALTER COLUMN timestamp DROP NOT NULL, ALTER COLUMN deviation_pct DROP NOT NULL;
      ALTER TABLE stock_t_analyses ALTER COLUMN stock_code DROP NOT NULL,
        ALTER COLUMN updated_at DROP NOT NULL, ALTER COLUMN updated_at SET DEFAULT NOW();

      -- Required-column failures roll back the migration; no invented null fills.
      ALTER TABLE stock_day_predictions ALTER COLUMN stock_code SET NOT NULL,
        ALTER COLUMN is_base SET NOT NULL, ALTER COLUMN is_base SET DEFAULT FALSE,
        ALTER COLUMN time_points SET DEFAULT '[]'::jsonb,
        ALTER COLUMN direction TYPE VARCHAR(40), ALTER COLUMN direction DROP DEFAULT,
        ALTER COLUMN target_pct DROP DEFAULT, ALTER COLUMN created_at DROP NOT NULL;
      ALTER TABLE stock_rolling_predictions ALTER COLUMN stock_code SET NOT NULL,
        ALTER COLUMN target_time TYPE VARCHAR(10), ALTER COLUMN created_at DROP NOT NULL;
      ALTER TABLE stock_l2_orders ALTER COLUMN stock_code SET NOT NULL,
        ALTER COLUMN time_str TYPE VARCHAR(10), ALTER COLUMN volume_lots TYPE DOUBLE PRECISION,
        ALTER COLUMN note DROP NOT NULL;
      -- created_at in the two legacy forecast tables is intentionally NOT cast.
    `)
  },
  async down() { throw new Error('兼容迁移保留旧标识，不支持自动反向收窄；须使用已审核的恢复方案。') },
}
