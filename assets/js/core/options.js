(function (root) {
  const SK = (root.SK = root.SK || {});
  const { el } = SK.dom;

  function read(spec, input) {
    switch (spec.type) {
      case 'toggle':
        return input.checked;
      case 'seg':
        return coerce(spec, input.dataset.value);
      case 'number':
        return input.value === '' ? spec.value : Number(input.value);
      case 'tags':
        return input.value
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
      case 'text':
        return input.value;
      default:
        return coerce(spec, input.value);
    }
  }

  function coerce(spec, v) {
    const base = spec.value;
    if (typeof base === 'number') return Number(v);
    if (typeof base === 'boolean') return v === 'true';
    return v;
  }

  function createOption(spec, initial, onChange) {
    let input;
    let label = spec.label ? el('span', { class: 'opt-label', text: spec.label }) : null;
    const emit = () => onChange(read(spec, input), spec);

    if (spec.type === 'toggle') {
      const box = el('label', { class: 'opt-toggle' + (initial ? ' on' : ''), title: spec.title || '' });
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!initial;
      cb.addEventListener('change', () => {
        box.classList.toggle('on', cb.checked);
        emit();
      });
      box.appendChild(cb);
      box.appendChild(el('span', { text: spec.label || spec.id }));
      input = cb;
      label = null;
      return { spec, wrap: box, get: () => cb.checked, input: cb };
    }

    if (spec.type === 'seg') {
      const box = el('div', { class: 'opt-seg' });
      box.dataset.value = String(initial);
      (spec.choices || []).forEach((c) => {
        const v = typeof c === 'object' ? c.v : c;
        const t = typeof c === 'object' ? c.label : c;
        const b = el('button', {
          class: 'seg' + (String(v) === String(initial) ? ' on' : ''),
          text: t,
          title: spec.title || '',
          onClick: () => {
            box.querySelectorAll('.seg').forEach((x) => x.classList.remove('on'));
            b.classList.add('on');
            box.dataset.value = String(v);
            emit();
          },
        });
        box.appendChild(b);
      });
      input = box;
      return { spec, wrap: el('span', { class: 'opt opt-seg' }, [label, box]), get: () => read(spec, input), input: box };
    }

    if (spec.type === 'number') {
      input = el('input', { class: 'opt-num', type: 'number', value: initial, min: spec.min, max: spec.max, step: spec.step || 1, title: spec.title || '' });
      input.addEventListener('change', emit);
    } else if (spec.type === 'text' || spec.type === 'tags') {
      input = el('input', { class: 'opt-text' + (spec.type === 'tags' ? ' wide' : ''), type: 'text', value: initial === undefined ? '' : Array.isArray(initial) ? initial.join(', ') : initial, placeholder: spec.placeholder || '', title: spec.title || spec.placeholder || '' });
      input.addEventListener('change', emit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') emit();
      });
    } else {
      input = el('select', { class: 'opt-select', title: spec.title || '' });
      (spec.choices || []).forEach((c) => {
        const v = typeof c === 'object' ? c.v : c;
        const t = typeof c === 'object' ? c.label : c;
        input.appendChild(el('option', { value: String(v), text: String(t), selected: String(v) === String(initial) }));
      });
      input.addEventListener('change', emit);
    }
    return { spec, wrap: el('span', { class: 'opt opt-' + (spec.type || 'select') }, [label, input]), get: () => read(spec, input), input };
  }

  function bar(host, list, toolId, onChange) {
    const saved = SK.store.get('opt:' + toolId, {}) || {};
    const items = [];
    const box = el('div', { class: 'optbar' });
    (list || []).forEach((o) => {
      if (o.type === 'sep') {
        box.appendChild(el('span', { class: 'opt-sep' }));
        return;
      }
      const item = createOption(o, saved[o.id] !== undefined ? saved[o.id] : o.value, (v, spec) => {
        saved[o.id] = v;
        SK.store.set('opt:' + toolId, saved);
        if (onChange) onChange(values(), spec.id, v);
      });
      items.push(item);
      box.appendChild(item.wrap);
    });
    host.appendChild(box);
    function values() {
      const out = {};
      items.forEach((it) => {
        if (it.spec.hidden) return;
        out[it.spec.id] = it.get();
      });
      return out;
    }
    function set(id, v) {
      const it = items.find((x) => x.spec.id === id);
      if (!it) return;
      if (it.spec.type === 'toggle') it.input.checked = !!v;
      else if (it.spec.type === 'seg') {
        it.input.dataset.value = String(v);
        it.input.querySelectorAll('.seg').forEach((b) => b.classList.toggle('on', b.textContent === String(v)));
      } else it.input.value = v;
      SK.store.set('opt:' + toolId, Object.assign(saved, { [id]: v }));
    }
    function hide(ids) {
      items.forEach((it) => {
        if (ids.includes(it.spec.id)) {
          it.wrap.style.display = 'none';
          it.spec.hidden = true;
        }
      });
    }
    function show(ids) {
      items.forEach((it) => {
        if (ids.includes(it.spec.id)) {
          it.wrap.style.display = '';
          it.spec.hidden = false;
        }
      });
    }
    return { values, set, box, items, hide, show, el: box };
  }

  SK.options = { bar, createOption };
})(typeof window !== 'undefined' ? window : globalThis);
