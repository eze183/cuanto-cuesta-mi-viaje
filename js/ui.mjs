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

// Search is explicit: the public Nominatim service is not an autocomplete API.
// Results still expose the keyboard interaction of an accessible combobox.
export function addressPicker(input, list, searchButton, search, onPick, onError) {
  let controller;
  let items = [];
  let active = -1;
  let revision = 0;
  let selected = null;
  const hide = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const cancel = () => { revision++; controller?.abort(); hide(); searchButton.disabled = false; input.removeAttribute('aria-busy'); };
  const pick = index => {
    const item = items[index];
    if (!item) return;
    input.value = item.label;
    selected = item;
    hide();
    onPick(item);
    input.focus();
  };
  const run = async () => {
    cancel();
    const query = input.value.trim();
    if (query.length < 3) { onError('Escribí al menos 3 caracteres para buscar una dirección.'); return; }
    const current = revision;
    controller = new AbortController();
    searchButton.disabled = true;
    input.setAttribute('aria-busy', 'true');
    onError('');
    try {
      items = await search(query, controller.signal);
      if (current !== revision) return;
      if (document.activeElement !== input && document.activeElement !== searchButton) return;
      list.replaceChildren();
      if (!items.length) { onError('No encontramos coincidencias. Agregá la ciudad y probá de nuevo.'); return; }
      items.forEach((item, i) => {
        const option = node('li', 'address-option', item.label);
        option.id = `${list.id}-${i}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.addEventListener('pointerdown', event => event.preventDefault());
        option.addEventListener('click', () => pick(i));
        list.append(option);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.focus();
      onError(`${items.length} direcciones encontradas. Usá las flechas y Enter para elegir.`, true);
    } catch (error) { if (current === revision && error.name !== 'AbortError') onError(error.message); }
    finally {
      // A cancelled request must not leave its search button disabled.
      if (current === revision || !controller || controller.signal.aborted) {
        searchButton.disabled = false;
        input.removeAttribute('aria-busy');
      }
    }
  };
  input.addEventListener('input', () => { selected = null; cancel(); searchButton.disabled = false; input.removeAttribute('aria-busy'); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { cancel(); return; }
    if (event.key === 'Enter') { event.preventDefault(); if (!list.hidden && active >= 0) pick(active); else run(); }
    if (!list.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      active = active < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1) : (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Tab') hide();
  });
  input.addEventListener('blur', hide);
  searchButton.addEventListener('click', run);
  return { get: () => selected, cancel, set(item) { cancel(); selected = item; input.value = item.label; } };
}
