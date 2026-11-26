-- Migración 22 · Límites de lo que un periodista puede escribir al cerrar una pregunta (auditoría, 2.10)
--
-- completar_consulta y guardar_respuesta se pueden llamar directamente con la sesión del periodista (sin pasar por
-- el Worker): por diseño, porque es quien hace la pregunta. Pero sus límites eran muy amplios: citas sin tope de
-- longitud por elemento (se podía llenar la base, 500 MB en el plan gratuito, y dejarla en solo lectura), coste de
-- hasta 100 USD por fila (falseaba el gasto de Administración) y respuestas de 200 KB.
--
-- Ahora: citas, como mucho 30 y todas con forma de id del BOE; coste, como mucho 1 USD (una pregunta real cuesta
-- céntimos); tokens, como mucho 2 millones; respuesta guardada, como mucho 100 KB. Mismo comportamiento para el
-- Worker, que nunca se acerca a estos valores.

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
     or p_tokens_entrada is null or p_tokens_entrada not between 0 and 2000000
     or p_tokens_salida is null or p_tokens_salida not between 0 and 2000000
     or p_tokens_cache is null or p_tokens_cache not between 0 and 2000000
     or p_coste_usd is null or p_coste_usd not between 0 and 1
     or (p_citas is not null and (cardinality(p_citas) > 30
         or exists (select 1 from unnest(p_citas) c where c is null or c !~ '^BOE-[A-Z]-[0-9]{4}-[0-9]{1,7}$'))) then
    raise exception 'datos de la consulta no válidos' using errcode = '22023';
  end if;

  update public.consultas c
     set modelo = p_modelo, rondas = p_rondas, tokens_entrada = p_tokens_entrada, tokens_salida = p_tokens_salida,
         tokens_cache = p_tokens_cache, coste_usd = p_coste_usd, citas = p_citas, sin_resultados = p_sin_resultados
   where c.id = p_id and c.token = p_token and c.usuario = v_email and c.modelo is null;
  return found;
end;
$$;

create or replace function public.guardar_respuesta(p_id bigint, p_token uuid, p_respuesta jsonb) returns boolean
  language plpgsql volatile security definer
  set search_path = public, extensions
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public.exigir_periodista();

  if p_respuesta is null or jsonb_typeof(p_respuesta) <> 'object' or octet_length(p_respuesta::text) > 100000 then
    raise exception 'respuesta no válida' using errcode = '22023';
  end if;

  update public.consultas c
     set respuesta = p_respuesta
   where c.id = p_id and c.token = p_token and c.usuario = v_email
     and c.modelo is not null and c.respuesta is null;
  return found;
end;
$$;

-- Mismos permisos que antes (create or replace los conserva; se repiten por claridad).
revoke all on function public.completar_consulta(bigint, uuid, text, int, int, int, int, numeric, text[], boolean) from public, anon, service_role;
grant execute on function public.completar_consulta(bigint, uuid, text, int, int, int, int, numeric, text[], boolean) to authenticated;
revoke all on function public.guardar_respuesta(bigint, uuid, jsonb) from public, anon, service_role;
grant execute on function public.guardar_respuesta(bigint, uuid, jsonb) to authenticated;
