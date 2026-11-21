(() => {
  'use strict';
  const root = document.getElementById('order-details');
  if (!root) return;
  root.querySelectorAll('[data-copy-target]').forEach(button => {
    const target = document.getElementById(button.dataset.copyTarget);
    const status = document.getElementById(button.dataset.copyFeedback);
    if (!target || !status) return;
    const label = button.dataset.copyLabel;
    const original = button.textContent;
    button.hidden = false;
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Copying…';
      status.textContent = '';
      try {
        if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
        await navigator.clipboard.writeText(target.textContent.trim());
        status.dataset.state = 'success';
        status.textContent = label + ' copied.';
      } catch {
        status.dataset.state = 'error';
        status.textContent = 'Couldn’t copy. Select the ' + label.toLowerCase() + ' above and copy it manually.';
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  });
})();
