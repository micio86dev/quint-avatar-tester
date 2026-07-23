// Reusable modal primitive for the admin UI. Framework-free: it builds a styled
// overlay + panel, closes on Esc or backdrop click, focuses the first control, and
// cleans up after itself. Two helpers layer on top: confirmDialog() for destructive
// confirmations and openModal() for arbitrary content (e.g. the inline question form).

export interface ModalHandle {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

interface OpenOptions {
  title: string;
  // Fill the body element; wire your own controls/buttons inside.
  render: (body: HTMLElement) => void;
  // Called once when the modal is dismissed by any means (button, Esc, backdrop).
  onClose?: () => void;
}

export function openModal(opts: OpenOptions): ModalHandle {
  const root = document.createElement('div');
  root.className =
    'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className =
    'w-full max-w-md overflow-hidden rounded-lg border border-border bg-surface shadow-xl';

  const header = document.createElement('div');
  header.className = 'border-b border-border px-5 py-3.5';
  const heading = document.createElement('h2');
  heading.className = 'text-base font-semibold text-fg';
  heading.textContent = opts.title;
  header.appendChild(heading);

  const body = document.createElement('div');
  body.className = 'px-5 py-4';

  panel.append(header, body);
  root.appendChild(panel);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    root.remove();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  // Backdrop click (mousedown on the overlay itself, not the panel) dismisses.
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) close();
  });
  document.addEventListener('keydown', onKey);

  opts.render(body);
  document.body.appendChild(root);
  panel.querySelector<HTMLElement>('input, textarea, select, button')?.focus();

  return { root, body, close };
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'danger' | 'default';
}

// A styled replacement for window.confirm(). Resolves true when confirmed, false on
// any dismissal. Focus starts on Cancel so a stray Enter never confirms a deletion.
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      handle.close();
      resolve(value);
    };
    const handle = openModal({
      title: opts.title,
      onClose: () => finish(false),
      render: (body) => {
        const p = document.createElement('p');
        p.className = 'text-sm leading-relaxed text-muted';
        p.textContent = opts.message;

        const actions = document.createElement('div');
        actions.className = 'mt-5 flex justify-end gap-3';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-ghost';
        cancel.textContent = opts.cancelLabel;
        cancel.onclick = () => finish(false);

        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'btn ' + (opts.tone === 'danger' ? 'btn-danger-solid' : 'btn-primary');
        confirm.textContent = opts.confirmLabel;
        confirm.onclick = () => finish(true);

        actions.append(cancel, confirm);
        body.append(p, actions);
      },
    });
  });
}
