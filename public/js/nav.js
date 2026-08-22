// Renders the shared left nav into <nav id="nav">, marking whichever item
// matches <body data-page="..."> as active. One small script instead of
// duplicating the nav markup (and its active-state bugs) across 5 pages.
(function () {
  const ITEMS = [
    { page: 'dashboard', href: '/index.html', label: 'Dashboard', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
    { page: 'match-prep', href: '/match-prep.html', label: 'Match Prep', icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="3.2"/>' },
    { page: 'digest', href: '/digest.html', label: 'Weekly Digest', icon: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h4"/>' },
    { page: 'settings', href: '/settings.html', label: 'Settings', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>' },
  ];

  const mount = document.getElementById('nav');
  if (!mount) return;
  const current = document.body.dataset.page;

  mount.innerHTML = `
    <a class="nav-brand" href="/index.html">
      <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 16 A14 14 0 0 1 16 2" fill="none" stroke="var(--sb-accent)" stroke-width="2.4" stroke-linecap="round"/></svg>
      <span>Coach's Office</span>
    </a>
    <div class="nav-group">
      ${ITEMS.map((item) => `
        <a class="nav-item${item.page === current ? ' active' : ''}" href="${item.href}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${item.icon}</svg>
          <span>${item.label}</span>
        </a>`).join('')}
    </div>
  `;
})();
