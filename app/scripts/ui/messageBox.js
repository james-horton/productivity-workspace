let elements = null;
let pendingRequest = null;

function ensureMessageBox() {
  if (elements) return elements;

  const modal = document.createElement('div');
  modal.id = 'appMessageBox';
  modal.className = 'modal message-box-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="modal-backdrop" data-message-box-cancel="true"></div>
    <div class="modal-dialog message-box-dialog" role="dialog" aria-modal="true" aria-labelledby="messageBoxTitle" aria-describedby="messageBoxMessage">
      <div class="modal-head">
        <h2 id="messageBoxTitle"></h2>
      </div>
      <div class="message-box-body">
        <p id="messageBoxMessage" class="message-box-message"></p>
        <div class="message-box-input-group" hidden>
          <label id="messageBoxInputLabel" for="messageBoxInput"></label>
          <input id="messageBoxInput" class="message-box-input" type="text" autocomplete="off" />
        </div>
      </div>
      <div class="modal-actions message-box-actions">
        <button type="button" class="btn" data-message-box-cancel="true"></button>
        <button type="button" class="btn primary message-box-confirm" data-message-box-confirm="true"></button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  elements = {
    modal,
    title: modal.querySelector('#messageBoxTitle'),
    message: modal.querySelector('#messageBoxMessage'),
    inputGroup: modal.querySelector('.message-box-input-group'),
    inputLabel: modal.querySelector('#messageBoxInputLabel'),
    input: modal.querySelector('#messageBoxInput'),
    cancel: modal.querySelector('[data-message-box-cancel].btn'),
    confirm: modal.querySelector('[data-message-box-confirm]')
  };

  modal.addEventListener('click', event => {
    const target = event.target.closest('[data-message-box-confirm], [data-message-box-cancel]');
    if (!target || !modal.contains(target)) return;
    finish(target.dataset.messageBoxConfirm === 'true');
  });

  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
      return;
    }
    if (event.key === 'Enter' && event.target === elements.input && !elements.inputGroup.hidden) {
      event.preventDefault();
      finish(true);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [
      ...(elements.inputGroup.hidden ? [] : [elements.input]),
      elements.cancel,
      elements.confirm
    ].filter(control => !control.disabled);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return elements;
}

function finish(confirmed) {
  if (!pendingRequest) return;
  const { resolve, previouslyFocused, inputMode } = pendingRequest;
  const value = inputMode && confirmed ? elements.input.value : null;
  pendingRequest = null;
  elements.modal.setAttribute('aria-hidden', 'true');
  const visibleModal = document.querySelector('.modal[aria-hidden="false"]');
  document.body.classList.toggle('modal-open', Boolean(visibleModal));
  if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
  resolve(inputMode ? value : confirmed);
}

export function isMessageBoxOpen() {
  return Boolean(elements && elements.modal.getAttribute('aria-hidden') === 'false');
}

export function showMessageBox({
  title = 'Confirm action',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  inputValue,
  inputLabel = 'Value'
} = {}) {
  if (pendingRequest) return Promise.resolve(false);

  const messageBox = ensureMessageBox();
  const previouslyFocused = document.activeElement;
  const inputMode = inputValue !== undefined;
  messageBox.title.textContent = title;
  messageBox.message.textContent = message;
  messageBox.inputGroup.hidden = !inputMode;
  messageBox.inputLabel.textContent = inputLabel;
  messageBox.input.value = inputMode ? String(inputValue ?? '') : '';
  messageBox.cancel.textContent = cancelLabel;
  messageBox.confirm.textContent = confirmLabel;
  messageBox.modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');

  return new Promise(resolve => {
    pendingRequest = { resolve, previouslyFocused, inputMode };
    if (inputMode) {
      messageBox.input.focus();
      messageBox.input.select();
    } else {
      messageBox.cancel.focus();
    }
  });
}
