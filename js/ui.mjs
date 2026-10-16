export const $ = id => document.getElementById(id);

export function node(tag, className = '', text = '') {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

export function message(id, text = '') {
  const el = $(id);
  el.textContent = text;
  el.hidden = !text;
}

export function openDialog(id) {
  const dialog = $(id);
  dialog.returnFocus = document.activeElement;
  dialog.showModal();
  document.body.classList.add('dialog-open');
}

export function closeDialog(id) { $(id).close(); }

export function initDialogs() {
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('close', () => {
      document.body.classList.toggle('dialog-open', Boolean(document.querySelector('dialog[open]')));
      // Native close restores focus synchronously. Its later close event must
      // not steal focus if the user has already moved to another control.
      const active = document.activeElement;
      if (active && active !== document.body && !dialog.contains(active)) return;
      const target = dialog.returnFocus;
      if (target?.isConnected && !target.closest('[hidden]') && !target.disabled) target.focus();
      else $('btn-settings').focus();
    });
    // Native dialogs provide Escape, inert background and keyboard focus containment.
    dialog.addEventListener('cancel', event => {
      if (dialog.beforeClose && !dialog.beforeClose()) event.preventDefault();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]')]
        .filter(el => el.getClientRects().length && !el.closest('[hidden]'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
      if (!dialog.beforeClose || dialog.beforeClose()) dialog.close();
    }));
  });
}

// A debounced, keyboard/touch accessible place picker. Requests and delayed
// suggestions are invalidated on edits, blur, mode changes and parent aborts.
export function addressPicker(input, list, searchButton, search, onPick, onError) {
  let controller;
  let timer;
  let composing = false;
  let items = [];
  let active = -1;
  let revision = 0;
  let selected = null;
  const key = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim().replace(/\s+/g, ' ');
  const hide = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const cancel = () => {
    revision++; clearTimeout(timer); controller?.abort(); hide();
    searchButton.disabled = false; input.removeAttribute('aria-busy');
  };
  const pick = (index, { notify = true, focus = true } = {}) => {
    const item = items[index];
    if (!item) return null;
    clearTimeout(timer);
    input.value = item.label; selected = item; hide();
    onError('');
    if (notify) onPick(item);
    if (focus) input.focus();
    return item;
  };
  function showResults() {
    list.replaceChildren();
    items.forEach((item, i) => {
      const option = node('li', 'address-option');
      option.id = `${list.id}-${i}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.setAttribute('aria-label', item.label);
      option.append(node('span', 'place-name', item.name || item.label));
      const context = [item.kind, item.detail].filter(Boolean).join(' · ');
      if (context) option.append(node('span', 'place-context', context));
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => pick(i));
      list.append(option);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  const run = async ({ resolve = false, signal } = {}) => {
    cancel();
    const query = input.value.trim();
    if (query.length < 3) {
      if (resolve) { onError('Ingresá una ciudad, lugar o dirección de al menos 3 caracteres.'); input.focus(); }
      return null;
    }
    const current = revision;
    const request = new AbortController(); controller = request;
    const abort = () => { if (current === revision) cancel(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); signal.removeEventListener('abort', abort); return null; }
    searchButton.disabled = true; input.setAttribute('aria-busy', 'true');
    onError('Buscando lugares…', true);
    try {
      const results = await search(query, request.signal);
      if (current !== revision || request.signal.aborted) return null;
      if (!resolve && document.activeElement !== input && document.activeElement !== searchButton) return null;
      items = results;
      if (!items.length) { onError('No encontramos lugares. Probá agregar la provincia, la ciudad o la calle.'); if (resolve) input.focus(); return null; }
      if (resolve) {
        const exactLabels = items.filter(item => key(item.label) === key(query));
        const exactNames = items.filter(item => key(item.name || item.label) === key(query));
        const cities = exactNames.filter(item => item.kind === 'Ciudad / localidad');
        const matches = exactLabels.length ? exactLabels : cities.length ? cities : exactNames;
        const result = matches.length === 1 ? matches[0] : items.length === 1 ? items[0] : null;
        if (result) return pick(items.indexOf(result), { notify: false, focus: false });
      }
      showResults();
      if (resolve || document.activeElement === searchButton) input.focus();
      onError(resolve ? `Hay varias coincidencias para «${query}». Elegí un lugar de la lista.` : `${items.length === 1 ? '1 lugar encontrado' : `${items.length} lugares encontrados`}. Elegí con un toque o con flechas y Enter.`, true);
      return null;
    } catch (error) {
      if (current === revision && error.name !== 'AbortError') onError(error.message);
      return null;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (current === revision) { searchButton.disabled = false; input.removeAttribute('aria-busy'); }
    }
  };
  const schedule = () => {
    selected = null; cancel(); onError('');
    if (!composing && input.value.trim().length >= 3) timer = setTimeout(() => run(), 450);
  };
  input.addEventListener('compositionstart', () => { composing = true; cancel(); });
  input.addEventListener('compositionend', () => { composing = false; schedule(); });
  input.addEventListener('input', schedule);
  input.addEventListener('keydown', event => {
    if (event.isComposing || composing) return;
    if (event.key === 'Escape') { event.preventDefault(); cancel(); onError(''); return; }
    if (event.key === 'Enter') { event.preventDefault(); if (!list.hidden && items.length) pick(active >= 0 ? active : 0); else run({ resolve: true }); }
    if (!list.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      active = active < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Tab') cancel();
  });
  input.addEventListener('blur', cancel);
  searchButton.addEventListener('click', () => run());
  return {
    get: () => selected,
    cancel,
    resolve: signal => selected ? Promise.resolve(selected) : run({ resolve: true, signal }),
    set(item) { cancel(); selected = item; input.value = item.label; },
  };
}
