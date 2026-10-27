// Header account control: "Sign in" when signed out, an avatar with a small menu when signed in.

import { onUser, signIn, signOut, isDemo } from './auth.js';

const slot = document.querySelector('[data-account]');

const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const esc = (s = '') => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function closeMenu() {
  const btn = slot.querySelector('[data-account-toggle]');
  const menu = slot.querySelector('[data-account-menu]');
  if (!btn || !menu) return;
  btn.setAttribute('aria-expanded', 'false');
  menu.hidden = true;
}

function render(user, error) {
  if (!slot) return;
  if (!user) {
    slot.innerHTML = `<button class="account-signin" type="button" data-signin>Sign in</button>`;
    slot.querySelector('[data-signin]').addEventListener('click', () => signIn());
  } else {
    const avatar = user.photo
      ? `<img src="${esc(user.photo)}" alt="" referrerpolicy="no-referrer">`
      : `<span>${esc(initials(user.name))}</span>`;
    slot.innerHTML = `
      <button class="account-avatar" type="button" aria-haspopup="true" aria-expanded="false" data-account-toggle aria-label="Account: ${esc(user.name)}">${avatar}</button>
      <div class="account-menu" data-account-menu hidden>
        <p class="account-name">${esc(user.name)}</p>
        <p class="account-email">${esc(user.email)}${isDemo ? ' (demo)' : ''}</p>
        <a class="account-link" href="pickup.html">My pickups</a>
        <button class="account-link" type="button" data-signout>Sign out</button>
      </div>`;
    const btn = slot.querySelector('[data-account-toggle]');
    const menu = slot.querySelector('[data-account-menu]');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      menu.hidden = !open;
    });
    slot.querySelector('[data-signout]').addEventListener('click', () => { closeMenu(); signOut(); });
  }
  if (error) showToast(error);
}

let toastTimer;
export function showToast(message) {
  let toast = document.querySelector('[data-toast]');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.dataset.toast = '';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('is-shown');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-shown'), 4200);
}

document.addEventListener('click', (e) => { if (slot && !slot.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const btn = slot?.querySelector('[data-account-toggle]');
  if (btn?.getAttribute('aria-expanded') === 'true') { closeMenu(); btn.focus(); }
});

onUser(render);
