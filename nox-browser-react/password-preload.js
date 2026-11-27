const { ipcRenderer } = require('electron');

function getFormFields(formOrRoot) {
  const scope = formOrRoot || document;
  const passwordInputs = Array.from(scope.querySelectorAll('input[type="password"]')).filter(
    el => !el.disabled && el.offsetParent !== null
  );
  if (passwordInputs.length === 0) return null;

  const passInput = passwordInputs[0];
  const container = passInput.closest('form') || document.body;

  const userCandidates = Array.from(
    container.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])'
    )
  ).filter(el => {
    if (el.disabled || el.readOnly || el.type === 'hidden') return false;
    const nameHint = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '')).toLowerCase();
    return !nameHint.includes('search') && !nameHint.includes('cauta') && !nameHint.includes('căut');
  });

  // Caută ultimul câmp de tip utilizator/email aflat înaintea câmpului de parolă
  let userInput = null;
  for (const inp of userCandidates) {
    if (inp.compareDocumentPosition(passInput) & Node.DOCUMENT_POSITION_FOLLOWING) {
      userInput = inp;
    }
  }
  if (!userInput && userCandidates.length > 0) {
    userInput = userCandidates[0];
  }

  return { passInput, userInput };
}

function setNativeValue(input, value) {
  if (!input || value === undefined || value === null) return;
  const proto = Object.getPrototypeOf(input);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function captureCredentials(scope) {
  const fields = getFormFields(scope);
  if (!fields || !fields.passInput || !fields.passInput.value) return;

  const domain = window.location.hostname || window.location.href;
  const username = fields.userInput ? fields.userInput.value.trim() : '';
  const password = fields.passInput.value;

  if (!domain || !password) return;

  ipcRenderer.sendToHost('captured-password', {
    domain,
    url: window.location.href,
    username,
    password
  });
}

function applyAutofill(credentialsList) {
  if (!Array.isArray(credentialsList) || credentialsList.length === 0) return;
  const entry = credentialsList[0];
  const fields = getFormFields(document);
  if (!fields) return;

  if (fields.userInput && entry.username && !fields.userInput.value) {
    setNativeValue(fields.userInput, entry.username);
  }
  if (fields.passInput && entry.password && !fields.passInput.value) {
    setNativeValue(fields.passInput, entry.password);
  }
}

document.addEventListener('submit', (e) => {
  captureCredentials(e.target);
}, true);

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[type="submit"], input[type="submit"], button');
  if (!btn) return;
  const form = btn.closest('form') || document.body;
  const fields = getFormFields(form);
  if (fields && fields.passInput && fields.passInput.value) {
    captureCredentials(form);
  }
}, true);

ipcRenderer.on('autofill-credentials', (event, list) => {
  applyAutofill(list);
  setTimeout(() => applyAutofill(list), 600);
});