-- Migración 13 · Caché de respuestas (por periodista) y gasto mensual para admins
--
-- 1) CACHÉ. Si el MISMO periodista repite la misma pregunta el mismo día y no ha entrado ninguna ingesta nueva,
--    se le devuelve su respuesta guardada sin llamar a Claude y sin gastar cupo.
--    Por qué solo la suya y no la de cualquiera: el Worker escribe con la sesión del propio periodista, así que
--    cualquiera podría llamar a guardar_respuesta con un texto inventado. Si la caché fuera compartida, ese texto
--    se serviría a otros compañeros (envenenamiento). Con caché por persona, lo único que puede falsear es lo que
--    se le muestra a sí mismo. Y no revela a nadie qué preguntan los demás.
--    El texto de las respuestas se guarda en `consultas` y se borra con ellas a los 90 días (purgar_consultas).
-- 2) GASTO. admin_gasto() devuelve agregados por mes (preguntas, tokens, coste): solo admins, sin preguntas ni
--    correos ajenos. Solo cuenta preguntas a Claude (el gasto de la ingesta no se registra aquí).

alter table public.consultas add column if not exists respuesta jsonb;

-- Texto normalizado de una pregunta: minúsculas, sin tildes, espacios colapsados, sin ¿?¡! de los extremos.
create or replace function public._normalizar_pregunta(p text) returns text
  language sql immutable parallel safe
  set search_path = public, extensions
as $$
  select btrim(regexp_replace(lower(public.f_unaccent(coalesce(p, ''))), '[\s¿?¡!]+', ' ', 'g'));
$$;

drop function if exists public.respuesta_guardada(text);
create or replace function public.respuesta_guardada(p_pregunta text)
  returns table (respuesta jsonb, usadas int, limite int)
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inicio timestamptz := (date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid');
  v_fin timestamptz;
  v_resp jsonb;
  v_usadas int;
  v_limite int;
begin
  perform public.exigir_periodista();

  select max(i.fin) into v_fin from public.ingestas i where i.estado in ('ok', 'sin_boletin');

  -- La más reciente de hoy, de este periodista, posterior a la última ingesta, con respuesta guardada.
  select c.respuesta into v_resp
    from public.consultas c
   where c.usuario = v_email
     and c.creado_en >= v_inicio
     and c.creado_en >= coalesce(v_fin, '-infinity'::timestamptz)
     and c.respuesta is not null
     and public._normalizar_pregunta(c.pregunta) = public._normalizar_pregunta(p_pregunta)
   order by c.creado_en desc
   limit 1;

  if v_resp is null then
    return;
  end if;

  select count(*)::int into v_usadas from public.consultas c where c.usuario = v_email and c.creado_en >= v_inicio;
  select p.limite_diario into v_limite from public.periodistas p where p.email = v_email;
  return query select v_resp, v_usadas, v_limite;
end;
$$;

-- Guarda la respuesta final en la reserva ya completada. Solo la propia, con su token, una sola vez.
drop function if exists public.guardar_respuesta(bigint, uuid, jsonb);
create or replace function public.guardar_respuesta(p_id bigint, p_token uuid, p_respuesta jsonb) returns boolean
  language plpgsql volatile security definer
  set search_path = public, extensions
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public.exigir_periodista();

  if p_respuesta is null or jsonb_typeof(p_respuesta) <> 'object' or octet_length(p_respuesta::text) > 200000 then
    raise exception 'respuesta no válida' using errcode = '22023';
  end if;

  update public.consultas c
     set respuesta = p_respuesta
   where c.id = p_id and c.token = p_token and c.usuario = v_email
     and c.modelo is not null and c.respuesta is null;
  return found;
end;
$$;

-- Gasto por mes (últimos p_meses, 1 a 24). Solo admins (con sesión vigente: exigir_admin).
drop function if exists public.admin_gasto(int);
create or replace function public.admin_gasto(p_meses int default 3)
  returns table (mes date, preguntas bigint, usuarios bigint, tokens_entrada bigint, tokens_salida bigint, tokens_cache bigint, coste_usd numeric)
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
begin
  perform public.exigir_admin();
  if p_meses is null or p_meses not between 1 and 24 then
    raise exception 'meses no válidos' using errcode = '22023';
  end if;
  return query
  select date_trunc('month', c.creado_en at time zone 'Europe/Madrid')::date,
         count(*), count(distinct c.usuario),
         coalesce(sum(c.tokens_entrada), 0)::bigint, coalesce(sum(c.tokens_salida), 0)::bigint, coalesce(sum(c.tokens_cache), 0)::bigint,
         coalesce(sum(c.coste_usd), 0)::numeric
    from public.consultas c
   where c.creado_en >= (date_trunc('month', now() at time zone 'Europe/Madrid') - make_interval(months => p_meses - 1)) at time zone 'Europe/Madrid'
   group by 1
   order by 1 desc;
end;
$$;

revoke all on function public._normalizar_pregunta(text) from public, anon, authenticated, service_role;
revoke all on function public.respuesta_guardada(text) from public, anon, service_role;
revoke all on function public.guardar_respuesta(bigint, uuid, jsonb) from public, anon, service_role;
revoke all on function public.admin_gasto(int) from public, anon, service_role;
grant execute on function public.respuesta_guardada(text) to authenticated;
grant execute on function public.guardar_respuesta(bigint, uuid, jsonb) to authenticated;
grant execute on function public.admin_gasto(int) to authenticated;
