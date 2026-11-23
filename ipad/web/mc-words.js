// Texts for the plain page scripts (mc-fetch.js, mc-notify.js): the iPad dictionaries live in locales/<lang>/ipad.json
// and the build copies them to /locales/<lang>.json. Loaded before the other two scripts, as a classic script.
(function () {
  const cache = {};

  function lang() {
    const cookie = document.cookie.split('; ').find((c) => c.startsWith('mc_lang='))?.split('=')[1];
    const tag = cookie || document.documentElement.lang || navigator.language || 'ru';
    return tag.toLowerCase().startsWith('en') ? 'en' : 'ru';
  }

  /** The dictionary for the current interface language; {} when it cannot be read (keys then show as-is). */
  function load() {
    const l = lang();
    if (!cache[l]) cache[l] = fetch(`/locales/${l}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    return cache[l];
  }

  /** «Mark the dose: {name}» with { name: '…' } → the text. Unknown placeholders stay empty. */
  function fmt(template, args) {
    return String(template ?? '').replace(/\{(\w+)\}/g, (_, k) => (args && args[k] != null ? String(args[k]) : ''));
  }

  window.mcWords = { lang, load, fmt };
})();
