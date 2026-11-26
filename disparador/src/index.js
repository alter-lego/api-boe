// Disparador de la ingesta: un Worker de Cloudflare sin rutas que, con sus Cron Triggers, lanza los workflows
// de GitHub Actions por workflow_dispatch. El cron propio de GitHub llegaba con horas de retraso (auditoría del
// 26/11/2026: ninguna pasada por la mañana desde el 21/11); workflow_dispatch arranca en segundos.
// El cron de GitHub se mantiene como respaldo: las pasadas duplicadas terminan al instante (mismo hash).
//
// Secreto: GITHUB_TOKEN, token fine-grained con acceso SOLO a este repositorio y permiso
// «Actions: Read and write» (nada más). Lo pone la persona responsable con `npx wrangler secret put GITHUB_TOKEN`.

// Cron (tal como está en wrangler.toml) → workflow que lanza. Si cambia uno, cambiar el otro.
export const PROGRAMA = {
  '30 5-9 * * 1-6': 'ingesta.yml',   // 05:30–09:30 UTC de lunes a sábado, una cada hora
  '30 13 * * *': 'ingesta.yml',      // tarde, todos los días: extraordinarios
  '0 10 * * *': 'monitor-ingesta.yml', // después de las pasadas de la mañana
};

export async function disparar(cron, env, f = fetch) {
  const workflow = PROGRAMA[cron];
  if (!workflow) throw new Error(`cron sin workflow: ${cron}`);
  if (!env.GITHUB_TOKEN) throw new Error('falta el secreto GITHUB_TOKEN');
  const url = `https://api.github.com/repos/${env.REPOSITORIO}/actions/workflows/${workflow}/dispatches`;
  const r = await f(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'disparador-ingesta-boe',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: env.RAMA || 'main' }),
  });
  // 204 = aceptado. Cualquier otra cosa se lanza: queda en los logs del Worker como ejecución fallida.
  if (r.status !== 204) throw new Error(`GitHub respondió ${r.status} al lanzar ${workflow}: ${(await r.text()).slice(0, 300)}`);
  return workflow;
}

export default {
  async scheduled(evento, env) {
    const workflow = await disparar(evento.cron, env);
    console.log(`lanzado ${workflow} (${evento.cron})`);
  },
};
