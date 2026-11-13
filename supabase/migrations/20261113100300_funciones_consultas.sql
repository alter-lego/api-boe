-- Fase 1 · Migración 4/4 · Registro de consultas, límite diario y borrado a 90 días

-- El usuario sale SIEMPRE del JWT, nunca de un parámetro: nadie registra consultas a nombre de otro.
-- Limitación conocida y aceptada en el piloto: un periodista con sesión podría falsear sus
-- propios tokens o costes llamando a la función directamente. No gana acceso a nada.
create or replace function public.registrar_consulta(
  p_pregunta text,
  p_modelo text,
  p_rondas int,
  p_tokens_entrada int,
  p_tokens_salida int,
  p_tokens_cache int,
  p_coste_usd numeric,
  p_citas text[],
  p_sin_resultados boolean
) returns bigint
  language plpgsql volatile security definer
  set search_path = public, extensions
as $$
declare
  v_id bigint;
begin
  perform public.exigir_periodista();

  insert into public.consultas (
    usuario, pregunta, modelo, rondas, tokens_entrada, tokens_salida, tokens_cache,
    coste_usd, citas, sin_resultados
  ) values (
    lower(auth.jwt() ->> 'email'), p_pregunta, p_modelo, p_rondas, p_tokens_entrada,
    p_tokens_salida, p_tokens_cache, p_coste_usd, p_citas, p_sin_resultados
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Preguntas del periodista de la sesión desde las 00:00 de hoy (hora de Madrid) y su límite.
create or replace function public.consultas_de_hoy()
  returns table (usadas bigint, limite int)
  language plpgsql stable security definer
  set search_path = public, extensions
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
begin
  perform public.exigir_periodista();

  return query
  select
    (select count(*) from public.consultas c
      where c.usuario = v_email
        and c.creado_en >= (date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid')),
    (select p.limite_diario from public.periodistas p where p.email = v_email);
end;
$$;

-- Borrado de consultas con más de 90 días. Solo service_role: se lanza desde una tarea
-- programada (GitHub Actions semanal, fase 6) con `select public.purgar_consultas();`
create or replace function public.purgar_consultas() returns bigint
  language plpgsql volatile security definer
  set search_path = public, extensions
as $$
declare
  v_n bigint;
begin
  delete from public.consultas where creado_en < now() - interval '90 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.registrar_consulta(text, text, int, int, int, int, numeric, text[], boolean) from public, anon;
revoke all on function public.consultas_de_hoy() from public, anon;
revoke all on function public.purgar_consultas() from public, anon, authenticated;

grant execute on function public.registrar_consulta(text, text, int, int, int, int, numeric, text[], boolean) to authenticated;
grant execute on function public.consultas_de_hoy() to authenticated;
grant execute on function public.purgar_consultas() to service_role;
