(() => {
  'use strict';
  const form = document.getElementById('guest-order-lookup');
  if (!form) return;
  const byId = id => document.getElementById(id);
  const status = byId('guest-lookup-feedback');
  const fields = byId('guest-lookup-fields');
  const orderId = byId('lookup-order-id');
  const email = byId('lookup-email');
  const submit = byId('guest-lookup-submit');
  const submitLabel = submit.querySelector('[data-submit-label]');
  const resultTitle = byId('guest-lookup-result-title');
  const edit = byId('guest-lookup-edit');
  let busy = false;
  let completed = false;

  const normalize = () => {
    orderId.value = orderId.value.trim().replace(/^#\s*/, '').toLowerCase();
    email.value = email.value.trim().toLowerCase();
  };
  function fieldError(field) {
    if (field.validity.valid) return '';
    return field === orderId
      ? 'Enter the full 36-character order ID, including dashes.'
      : 'Enter a valid checkout email, such as you@example.com.';
  }
  function showFieldError(field) {
    field.setAttribute('aria-invalid', String(!field.validity.valid));
    byId(field.id + '-error').textContent = fieldError(field);
  }
  function feedback(message, state = 'error') {
    status.dataset.state = state;
    status.textContent = message;
    resultTitle.hidden = state !== 'success';
  }
  function setBusy(value) {
    busy = value;
    fields.disabled = value;
    submit.disabled = value;
    submit.setAttribute('aria-busy', String(value));
    submitLabel.textContent = value ? 'Sending request…' : 'Email my order link';
  }

  fields.disabled = false;
  submit.disabled = false;
  form.addEventListener('invalid', event => showFieldError(event.target), true);
  form.addEventListener('input', event => {
    const field = event.target;
    if (field === orderId || field === email) {
      if (field.hasAttribute('aria-invalid')) showFieldError(field);
      if (!completed && !busy) feedback('');
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || completed) return;
    normalize();
    [orderId,email].forEach(field => {
      if (field.hasAttribute('aria-invalid')) showFieldError(field);
    });
    if (!form.reportValidity()) {
      feedback('Check the highlighted details before requesting your link.', 'validation');
      return;
    }
    setBusy(true);
    feedback('Requesting your private order link…', 'loading');
    try {
      const response = await fetch('/api/guest/order-link', {
        method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({order_id:orderId.value,email:email.value}),
      });
      if (response.status === 429) {
        feedback('Too many requests. Please try again later, or contact TrueMerit for help.');
        return;
      }
      if (response.status === 403) {
        feedback('Please refresh this page and try again. If the problem continues, contact TrueMerit.');
        return;
      }
      if (!response.ok) throw Error('Request failed');
      const result = await response.json();
      if (!result || typeof result.message !== 'string') throw Error('Invalid response');
      completed = true;
      orderId.readOnly = true;
      email.readOnly = true;
      submit.hidden = true;
      edit.hidden = false;
      // The same acknowledgement applies whether or not an order matches.
      feedback('If the order ID and checkout email match a paid guest order, a private link will be sent to that address. Check your inbox and spam or junk folder.', 'success');
      resultTitle.focus();
    } catch {
      feedback('We couldn’t request your order link. Please try again, or contact TrueMerit for help.');
    } finally {
      setBusy(false);
    }
  });

  edit.addEventListener('click', () => {
    completed = false;
    orderId.readOnly = false;
    email.readOnly = false;
    submit.hidden = false;
    edit.hidden = true;
    feedback('');
    orderId.focus();
  });
})();
