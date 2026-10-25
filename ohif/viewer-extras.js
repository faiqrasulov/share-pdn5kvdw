/* mri-share: simple control bar for the OHIF viewer (Home, slice, zoom, brightness/contrast, invert,
   reset, wheel mode) and "open each series on its middle slice". Uses the globals OHIF exposes:
   window.services (viewportGridService, cornerstoneViewportService), window.cornerstone,
   window.cornerstoneTools. No patient data in this file. */
(function () {
  'use strict';
  var ROOT = window.MRI_SHARE_ROOT || '../';
  var seen = {};          // viewportId|firstImageId -> { lower, upper } default VOI of that stack
  var wheelZoom = false;
  var ui = {};
  var lastSet = null;     // VOI we applied ourselves (to avoid fighting OHIF's own W/L drag)

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { e.append(c); });
    return e;
  }

  function vp() {
    var s = window.services;
    if (!s || !s.viewportGridService || !s.cornerstoneViewportService) return null;
    var id = s.viewportGridService.getActiveViewportId();
    var v = id && s.cornerstoneViewportService.getCornerstoneViewport(id);
    return v && v.element ? v : null;
  }
  function nSlices(v) {
    if (typeof v.getNumberOfSlices === 'function') { var n = v.getNumberOfSlices(); if (n) return n; }
    return typeof v.getImageIds === 'function' ? (v.getImageIds() || []).length : 0;
  }
  function curIndex(v) {
    if (typeof v.getSliceIndex === 'function') return v.getSliceIndex();
    return typeof v.getCurrentImageIdIndex === 'function' ? v.getCurrentImageIdIndex() : 0;
  }
  function jump(v, i) {
    var n = nSlices(v); if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    var T = window.cornerstoneTools;
    if (T && T.utilities && T.utilities.jumpToSlice) T.utilities.jumpToSlice(v.element, { imageIndex: i });
    else if (typeof v.setImageIdIndex === 'function') v.setImageIdIndex(i);
  }
  function stackKey(v) {
    var ids = typeof v.getImageIds === 'function' ? v.getImageIds() : null;
    return v.id + '|' + (ids && ids.length ? ids[0] : '?');
  }
  function voi(v) { var p = v.getProperties && v.getProperties(); return p && p.voiRange ? p.voiRange : null; }

  // contrast c, brightness b in [-100, 100], relative to the stack's default window
  function applyBC(v, base, b, c) {
    var w0 = base.upper - base.lower, c0 = (base.upper + base.lower) / 2;
    var w = w0 * Math.pow(2, -c / 50), ctr = c0 - (b / 100) * w0;
    lastSet = { lower: ctr - w / 2, upper: ctr + w / 2 };
    v.setProperties({ voiRange: lastSet });
    v.render();
  }
  function bcFrom(base, cur) {
    var w0 = base.upper - base.lower, c0 = (base.upper + base.lower) / 2;
    var w = cur.upper - cur.lower, ctr = (cur.upper + cur.lower) / 2;
    return { b: Math.round((c0 - ctr) / w0 * 100), c: Math.round(-50 * Math.log2(w / w0)) };
  }
  function zoomBy(v, f, canvasPt) {
    if (typeof v.getZoom !== 'function') return;
    var z = Math.max(0.2, Math.min(20, v.getZoom() * f));
    if (canvasPt && v.canvasToWorld && v.getCamera) {
      var w1 = v.canvasToWorld(canvasPt);
      v.setZoom(z);
      var w2 = v.canvasToWorld(canvasPt), cam = v.getCamera(), d = [w1[0] - w2[0], w1[1] - w2[1], w1[2] - w2[2]];
      v.setCamera({ focalPoint: cam.focalPoint.map(function (x, k) { return x + d[k]; }),
                    position: cam.position.map(function (x, k) { return x + d[k]; }) });
    } else {
      v.setZoom(z);
    }
    v.render();
  }
  function fit(v) { if (v.resetCamera) v.resetCamera(); v.render(); }
  function resetAll(v) {
    var base = seen[stackKey(v)];
    if (v.resetCamera) v.resetCamera();
    if (base) { lastSet = base; v.setProperties({ voiRange: { lower: base.lower, upper: base.upper }, invert: false }); }
    else if (v.resetProperties) v.resetProperties();
    v.render();
  }

  function build() {
    var css = el('style', { text: [
      '#mri-bar{position:fixed;left:0;right:0;margin:0 auto;width:fit-content;bottom:10px;z-index:1000;display:flex;flex-wrap:wrap;',
      'align-items:center;gap:6px 10px;max-width:calc(100vw - 24px);padding:7px 10px;border-radius:10px;',
      'background:rgba(8,14,32,.88);border:1px solid #2b3d66;box-shadow:0 4px 18px rgba(0,0,0,.5);',
      'font:13px -apple-system,Helvetica,Arial,sans-serif;color:#d6e2ff;user-select:none}',
      '#mri-bar.collapsed>*:not(.mri-keep){display:none}',
      '#mri-bar button,#mri-bar a.mri-btn{background:#16264a;color:#e6eeff;border:1px solid #34508a;border-radius:7px;',
      'padding:5px 10px;font:inherit;cursor:pointer;text-decoration:none;line-height:1.2;white-space:nowrap}',
      '#mri-bar button:hover,#mri-bar a.mri-btn:hover{background:#21386b}',
      '#mri-bar button.on{background:#2c5fb5;border-color:#5b8be0}',
      '#mri-bar .grp{display:flex;align-items:center;gap:5px}',
      '#mri-bar .lbl{color:#9fb3dc}',
      '#mri-bar input[type=range]{width:110px;accent-color:#5b8be0}',
      '#mri-bar .num{min-width:58px;text-align:center;color:#fff;font-variant-numeric:tabular-nums}',
      '#mri-bar .sep{width:1px;height:22px;background:#2b3d66}',
      '.mri-home-logo{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:7px;',
      'background:#16264a;border:1px solid #34508a;color:#e6eeff!important;font:600 14px -apple-system,Helvetica,Arial,sans-serif;text-decoration:none}',
      '.mri-home-logo:hover{background:#21386b}',
      'body.mri-bar-open #viewerLayoutResizableViewportGridPanel>div{padding-bottom:58px;box-sizing:border-box}',
      '@media (max-width:900px){#mri-bar input[type=range]{width:80px}}'
    ].join('') });
    document.head.append(css);

    ui.slice = el('input', { type: 'range', min: '0', max: '0', value: '0', title: 'Slice', 'aria-label': 'Slice',
      oninput: function () { var v = vp(); if (v) jump(v, +ui.slice.value); } });
    ui.sliceNum = el('span', { class: 'num', text: '– / –' });
    ui.zoomNum = el('span', { class: 'num', text: '×1.0' });
    ui.bright = el('input', { type: 'range', min: '-100', max: '100', value: '0', title: 'Brightness', 'aria-label': 'Brightness',
      oninput: function () { bc(); } });
    ui.contrast = el('input', { type: 'range', min: '-100', max: '100', value: '0', title: 'Contrast', 'aria-label': 'Contrast',
      oninput: function () { bc(); } });
    function bc() { var v = vp(); if (!v) return; var base = seen[stackKey(v)]; if (base) applyBC(v, base, +ui.bright.value, +ui.contrast.value); }
    function step(d) { var v = vp(); if (v) jump(v, curIndex(v) + d); }

    ui.wheelBtn = el('button', { title: 'What the mouse wheel does over the image', text: 'Wheel: slices',
      onclick: function () { wheelZoom = !wheelZoom; ui.wheelBtn.textContent = wheelZoom ? 'Wheel: zoom' : 'Wheel: slices';
        ui.wheelBtn.classList.toggle('on', wheelZoom); } });
    ui.invertBtn = el('button', { title: 'Invert black and white', text: 'Invert', onclick: function () {
      var v = vp(); if (!v) return; var p = v.getProperties(); v.setProperties({ invert: !p.invert }); v.render(); } });
    ui.collapse = el('button', { class: 'mri-keep', title: 'Hide / show this bar', text: '▾',
      onclick: function () { var c = ui.bar.classList.toggle('collapsed'); ui.collapse.textContent = c ? '▴ Controls' : '▾';
        document.body.classList.toggle('mri-bar-open', !c);
        try { localStorage.setItem('mri-bar-collapsed', c ? '1' : '0'); } catch (e) {} } });

    ui.bar = el('div', { id: 'mri-bar', role: 'toolbar', 'aria-label': 'Image controls' }, [
      el('a', { class: 'mri-btn mri-keep', id: 'mri-home', href: ROOT, title: 'Back to the start page', text: '⌂ Home' }),
      el('span', { class: 'sep' }),
      el('div', { class: 'grp' }, [el('span', { class: 'lbl', text: 'Slice' }),
        el('button', { title: 'Previous slice', text: '◀', onclick: function () { step(-1); } }), ui.slice,
        el('button', { title: 'Next slice', text: '▶', onclick: function () { step(1); } }), ui.sliceNum,
        el('button', { title: 'Jump to the middle slice', text: 'Middle', onclick: function () {
          var v = vp(); if (v) jump(v, Math.floor(nSlices(v) / 2)); } })]),
      el('span', { class: 'sep' }),
      el('div', { class: 'grp' }, [el('span', { class: 'lbl', text: 'Zoom' }),
        el('button', { id: 'mri-zoom-out', title: 'Zoom out', text: '−', onclick: function () { var v = vp(); if (v) zoomBy(v, 1 / 1.25); } }),
        el('button', { id: 'mri-zoom-in', title: 'Zoom in', text: '+', onclick: function () { var v = vp(); if (v) zoomBy(v, 1.25); } }),
        el('button', { title: 'Fit image to the window', text: 'Fit', onclick: function () { var v = vp(); if (v) fit(v); } }), ui.zoomNum]),
      el('span', { class: 'sep' }),
      el('div', { class: 'grp' }, [el('span', { class: 'lbl', text: 'Brightness' }), ui.bright]),
      el('div', { class: 'grp' }, [el('span', { class: 'lbl', text: 'Contrast' }), ui.contrast]),
      ui.invertBtn,
      el('button', { title: 'Reset zoom, brightness and contrast', text: 'Reset', onclick: function () {
        var v = vp(); if (v) { resetAll(v); ui.bright.value = 0; ui.contrast.value = 0; } } }),
      el('span', { class: 'sep' }), ui.wheelBtn, ui.collapse
    ]);
    document.body.append(ui.bar);
    // remembered choice, else start folded on small screens (the bar would cover the image)
    var saved = null;
    try { saved = localStorage.getItem('mri-bar-collapsed'); } catch (e) {}
    if (saved === '1' || (saved === null && window.innerWidth < 1000)) {
      ui.bar.classList.add('collapsed'); ui.collapse.textContent = '▴ Controls';
    } else {
      document.body.classList.add('mri-bar-open');
    }

    // wheel: zoom (around the cursor) in zoom mode, or always for trackpad pinch (ctrlKey)
    document.addEventListener('wheel', function (e) {
      var v = vp(); if (!v || !v.element.contains(e.target)) return;
      if (!(wheelZoom || e.ctrlKey)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      var r = v.element.getBoundingClientRect();
      var dy = Math.max(-60, Math.min(60, e.deltaY));
      zoomBy(v, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.004)), [e.clientX - r.left, e.clientY - r.top]);
    }, { capture: true, passive: false });
  }

  function tick() {
    var v = vp();
    if (!v) return;
    var n = nSlices(v), i = curIndex(v), cur = voi(v);
    if (!n || !cur) return;                     // stack not rendered yet
    var key = stackKey(v);
    if (!seen[key]) {                           // a series appeared in this viewport for the first time
      seen[key] = { lower: cur.lower, upper: cur.upper, mid: Math.floor(n / 2), tries: 0, done: n <= 2 };
    }
    var st = seen[key];
    if (!st.done) {                             // open on the middle slice; OHIF may still reset to 0
      if (i === st.mid) {                       // while it finishes loading, so retry for ~5 s
        if (++st.tries > 3) { st.done = true; st.lower = cur.lower; st.upper = cur.upper; }
      } else if (i === 0 && st.tries < 16) {
        st.tries++; jump(v, st.mid); return;
      } else {
        st.done = true;                         // the user moved on their own
      }
    }
    ui.slice.max = String(n - 1);
    if (document.activeElement !== ui.slice) ui.slice.value = String(i);
    ui.sliceNum.textContent = (i + 1) + ' / ' + n;
    if (typeof v.getZoom === 'function') ui.zoomNum.textContent = '×' + v.getZoom().toFixed(1);
    var base = seen[key];
    if (document.activeElement !== ui.bright && document.activeElement !== ui.contrast) {
      var bc = bcFrom(base, cur);               // follow OHIF's own window/level drag too
      ui.bright.value = String(Math.max(-100, Math.min(100, bc.b)));
      ui.contrast.value = String(Math.max(-100, Math.min(100, bc.c)));
    }
    var p = v.getProperties();
    ui.invertBtn.classList.toggle('on', !!(p && p.invert));
  }

  function start() {
    if (!document.body) return setTimeout(start, 50);
    build();
    setInterval(function () { try { tick(); } catch (e) { /* viewer still initialising */ } }, 300);
  }
  start();
  window.mriExtras = { vp: vp, seen: seen, ui: ui };
})();
