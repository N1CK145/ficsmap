import type { Locale } from '../../shared/i18n.js';

interface Strings {
  invalidTitle: string;
  invitedYou: (owner: string, world: string) => string;
  invitedYouToApp: (owner: string) => string;
  signUp: string;
  collected: (pct: number) => string;
  signIn: string;
  validUntil: (date: string) => string;
  noLongerValid: string;
  goToWorlds: string;
}

const STRINGS: Record<Locale, Strings> = {
  en: {
    invalidTitle: "This invite link isn't valid",
    invitedYou: (owner, world) => `${owner} invited you to ${world}`,
    invitedYouToApp: owner => `${owner} invited you to ficsmap`,
    signUp: 'Sign in with Discord to create your account',
    collected: pct => `Collected so far: ${pct} %`,
    signIn: 'Sign in with Discord to join',
    validUntil: date => `Invite valid until ${date}`,
    noLongerValid: 'This invite is no longer valid. Ask the owner for a new link.',
    goToWorlds: 'Go to my worlds',
  },
  de: {
    invalidTitle: 'Dieser Einladungslink ist ungültig',
    invitedYou: (owner, world) => `${owner} hat dich zu ${world} eingeladen`,
    invitedYouToApp: owner => `${owner} hat dich zu ficsmap eingeladen`,
    signUp: 'Mit Discord anmelden und Konto anlegen',
    collected: pct => `Bisher gesammelt: ${pct} %`,
    signIn: 'Mit Discord anmelden und beitreten',
    validUntil: date => `Einladung gültig bis ${date}`,
    noLongerValid: 'Diese Einladung ist nicht mehr gültig. Bitte den Besitzer um einen neuen Link.',
    goToWorlds: 'Zu meinen Welten',
  },
};

export type InvitePage =
  | { kind: 'invalid' }
  | { kind: 'no_longer_valid' }
  | { kind: 'landing'; owner: string; world: string; percent: number; expiresAt: number; token: string }
  /** A general invite of a server owner: creates an account, joins no world. */
  | { kind: 'signup'; owner: string; expiresAt: number; token: string };

/** Escapes text and double-quoted attribute values (the page never uses single-quoted attributes). */
export function escapeHtml(v: string): string {
  return v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#15171A;color:#E8E6E3;font:16px/1.5 system-ui,sans-serif}
main{width:100%;max-width:440px;background:#1E2125;border:1px solid #2E3238;border-radius:4px;padding:32px 24px;text-align:center}
h1{margin:0 0 12px;font:600 28px/1.2 'Barlow Condensed',system-ui,sans-serif;letter-spacing:.02em}
p{margin:0 0 16px}
.muted{color:#9BA1A8;font-size:14px}
a.btn{display:inline-block;margin:8px 0 16px;padding:12px 20px;background:#F28C28;color:#15171A;font-weight:600;text-decoration:none;border-radius:4px}
a.btn:focus-visible{outline:2px solid #E8E6E3;outline-offset:2px}
`;

export function renderInvitePage(page: InvitePage, locale: Locale): string {
  const t = STRINGS[locale];
  let body: string;
  if (page.kind === 'invalid') {
    body = `<h1>${escapeHtml(t.invalidTitle)}</h1>`;
  } else if (page.kind === 'no_longer_valid') {
    body = `<p>${escapeHtml(t.noLongerValid)}</p><a class="btn" href="/">${escapeHtml(t.goToWorlds)}</a>`;
  } else {
    const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(page.expiresAt));
    const href = `/auth/login?invite=${encodeURIComponent(page.token)}&returnTo=/`;
    const head = page.kind === 'landing'
      ? `<h1>${escapeHtml(t.invitedYou(page.owner, page.world))}</h1>
<p>${escapeHtml(t.collected(page.percent))}</p>`
      : `<h1>${escapeHtml(t.invitedYouToApp(page.owner))}</h1>`;
    body = `${head}
<a class="btn" href="${escapeHtml(href)}">${escapeHtml(page.kind === 'landing' ? t.signIn : t.signUp)}</a>
<p class="muted">${escapeHtml(t.validUntil(date))}</p>`;
  }
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>ficsmap</title>
<style>${CSS}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}
