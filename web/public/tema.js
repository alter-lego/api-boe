// Aplica el tema (claro u oscuro) antes de pintar, para evitar un parpadeo. Archivo propio por la CSP (script-src 'self').
(function () {
  var t = null;
  try { t = localStorage.getItem('tema'); } catch (e) { /* sin almacenamiento: se usa el tema del sistema */ }
  if (t !== 'claro' && t !== 'oscuro') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  document.documentElement.setAttribute('data-tema', t);
})();
