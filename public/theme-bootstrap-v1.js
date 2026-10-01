(function () {
  var preference = 'system';
  var dark = false;
  try {
    var saved = window.localStorage.getItem('kasa-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch (_) {}
  try {
    dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (_) {}
  var theme = preference === 'system' ? (dark ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  var color = document.querySelector('meta[name="theme-color"]');
  if (color) color.setAttribute('content', theme === 'dark' ? '#14232c' : '#ffffff');
})();
