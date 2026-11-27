-- Fase 4 · Migración 12 · Límite diario ATÓMICO de preguntas a Claude
--
-- Antes: «consultar cuántas lleva hoy» y «registrar al final» eran dos pasos separados, así que varias
-- peticiones en paralelo podían pasarse del límite. Ahora la pregunta RESERVA su sitio ANTES de llamar a
-- Claude: comprobar el límite e insertar la fila ocurren juntos, serializados por periodista.
--
-- Diseño (importante): NO hay «devolver» ni «liberar» la reserva. Esas funciones las puede llamar el propio
-- periodista con su sesión y servirían para saltarse el límite (reservar, liberar mientras Claude trabaja
-- y repetir en paralelo). Un fallo del servidor tras reservar consume una pregunta: es lo seguro.
--
-- Ciclo: reservar_consulta(pregunta) → llamar a Claude → completar_consulta(id, token, tokens, coste, citas).
-- Una reserva sin completar (el servidor murió) queda con modelo NULL y cuenta igualmente.
--
-- El TOKEN: reservar_consulta devuelve un uuid aleatorio que solo conoce quien reservó (el Worker). Sin él no se
-- puede completar la fila: como los ids son secuenciales, sin token un periodista podría adivinar el id de la
-- reserva que el Worker acaba de crear y rellenarla antes con coste 0 (falsear el registro de gasto).
--
-- registrar_consulta (migración 4) se ELIMINA: permitía a cualquier periodista insertar filas con modelo, tokens y
-- coste inventados. Todo el registro pasa ahora por reservar/completar.

-- Guarda (migración 24): si ya está aplicada, se para aquí en vez de deshacer cambios posteriores sin avisar.
do $$ begin
  if to_regclass('public.migraciones') is not null then
    if exists (select 1 from public.migraciones where nombre = '20261114140000_reservar_consulta') then
      raise exception 'La migración 20261114140000_reservar_consulta ya está aplicada: no la repitas';
    end if;
  end if;
end $$;

alter table public.consultas add column if not exists token uuid not null default gen_random_uuid();
drop function if exists public.registrar_consulta(text, text, int, int, int, int, numeric, text[], boolean);
drop function if exists public.reservar_consulta(text);
drop function if exists public.completar_consulta(bigint, uuid, text, int, int, int, int, numeric, text[], boolean);

create or replace function public.reservar_consulta(p_pregunta text)
  returns table (id bigint, token uuid, usadas int, limite int)
  language plpgsql volatile security definer
  set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_pregunta text := btrim(coalesce(p_pregunta, ''));
  v_limite int;
  v_usadas int;
  v_id bigint;
  v_token uuid;
begin
  perform public.exigir_periodista();

  if v_pregunta = '' or char_length(v_pregunta) > 4000 then
    raise exception 'pregunta vacía o demasiado larga' using errcode = '22023';
  end if;

  -- Serializa las reservas de la MISMA persona: dos peticiones simultáneas no pueden leer el mismo contador.
  perform pg_advisory_xact_lock(hashtextextended('consultas:' || v_email, 0));

  select p.limite_diario into v_limite from public.periodistas p where p.email = v_email;
  select count(*)::int into v_usadas
    from public.consultas c
   where c.usuario = v_email
     and c.creado_en >= (date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid');

  if v_usadas >= v_limite then
    -- 'PT429': PostgREST responde HTTP 429.
    raise exception 'has alcanzado el límite diario de % preguntas', v_limite using errcode = 'PT429';
  end if;

  insert into public.consultas (usuario, pregunta) values (v_email, v_pregunta) returning consultas.id, consultas.token into v_id, v_token;
  return query select v_id, v_token, v_usadas + 1, v_limite;
end;
$$;

-- Rellena la reserva con lo que pasó. Solo la propia, solo con su token y solo una vez (mientras `modelo` sea NULL).
create or replace function public.completar_consulta(
  p_id bigint,
  p_token uuid,
  p_modelo text,
  p_rondas int,
  p_tokens_entrada int,
  p_tokens_salida int,
  p_tokens_cache int,
  p_coste_usd numeric,
  p_citas text[],
  p_sin_resultados boolean
) returns boolean
  language plpgsql volatile security definer
  set search_path = public, extensions
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public.exigir_periodista();

  if p_modelo is null or btrim(p_modelo) = '' or char_length(p_modelo) > 100
     or p_rondas is null or p_rondas not between 0 and 20
     or p_tokens_entrada is null or p_tokens_entrada not between 0 and 10000000
     or p_tokens_salida is null or p_tokens_salida not between 0 and 10000000
     or p_tokens_cache is null or p_tokens_cache not between 0 and 10000000
     or p_coste_usd is null or p_coste_usd not between 0 and 100
     or (p_citas is not null and cardinality(p_citas) > 100) then
    raise exception 'datos de la consulta no válidos' using errcode = '22023';
  end if;

  update public.consultas c
     set modelo = p_modelo, rondas = p_rondas, tokens_entrada = p_tokens_entrada, tokens_salida = p_tokens_salida,
         tokens_cache = p_tokens_cache, coste_usd = p_coste_usd, citas = p_citas, sin_resultados = p_sin_resultados
   where c.id = p_id and c.token = p_token and c.usuario = v_email and c.modelo is null;
  return found;
end;
$$;

revoke all on function public.reservar_consulta(text) from public, anon;
revoke all on function public.completar_consulta(bigint, uuid, text, int, int, int, int, numeric, text[], boolean) from public, anon;
grant execute on function public.reservar_consulta(text) to authenticated;
grant execute on function public.completar_consulta(bigint, uuid, text, int, int, int, int, numeric, text[], boolean) to authenticated;

-- service_role no las necesita (las llama el Worker con la sesión del periodista).
revoke execute on function public.reservar_consulta(text) from service_role;
revoke execute on function public.completar_consulta(bigint, uuid, text, int, int, int, int, numeric, text[], boolean) from service_role;
