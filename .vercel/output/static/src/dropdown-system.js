(function(){
  'use strict';

  if(window.MCJ_DROPDOWN_SYSTEM_READY) return;
  window.MCJ_DROPDOWN_SYSTEM_READY = true;

  var STYLE_ID = 'mcj-dropdown-system-style';
  var ENHANCED = 'data-mcj-select-enhanced';
  var SELECTOR = 'select:not([' + ENHANCED + '])';
  var active = null;
  var panel = null;

  function injectStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      'select{background:#17141c!important;color:#fff4fa!important;border-color:rgba(255,183,216,.34)!important;color-scheme:dark!important;}',
      'select option{background:#17141c!important;color:#fff4fa!important;}',
      'select option:hover,select option:checked{background:#4a1834!important;color:#fff!important;}',
      '.mcj-select-wrap{position:relative;width:100%;min-width:0;display:block;box-sizing:border-box;}',
      '.mcj-select-native{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;opacity:0!important;pointer-events:none!important;}',
      '.mcj-select-button{width:100%;height:52px;min-height:42px;border:1px solid rgba(255,183,216,.34);border-radius:14px;background:linear-gradient(180deg,rgba(28,20,34,.96),rgba(12,9,16,.96));color:#fff4fa;padding:0 42px 0 16px;text-align:left;font:inherit;font-weight:900;box-sizing:border-box;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.07);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.mcj-select-button:after{content:"";position:absolute;right:16px;top:50%;width:9px;height:9px;border-right:2px solid #ffd6e7;border-bottom:2px solid #ffd6e7;transform:translateY(-65%) rotate(45deg);pointer-events:none;}',
      '.mcj-select-wrap.is-open .mcj-select-button,.mcj-select-button:focus{outline:0;border-color:rgba(255,126,190,.78);box-shadow:0 0 0 3px rgba(255,126,190,.12),0 0 18px rgba(255,126,190,.16),inset 0 1px 0 rgba(255,255,255,.08);}',
      '.mcj-select-panel{position:fixed;z-index:999999;display:none;box-sizing:border-box;border:1px solid rgba(255,183,216,.42);border-radius:14px;background:#17141c;box-shadow:0 18px 52px rgba(0,0,0,.58),0 0 24px rgba(255,105,180,.16);padding:6px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgba(255,143,194,.55) rgba(23,20,28,.95);}',
      '.mcj-select-panel.open{display:grid;gap:4px;}',
      '.mcj-select-panel::-webkit-scrollbar{width:8px}.mcj-select-panel::-webkit-scrollbar-track{background:#17141c}.mcj-select-panel::-webkit-scrollbar-thumb{background:rgba(255,143,194,.48);border-radius:999px;}',
      '.mcj-select-option{width:100%;min-height:40px;border:1px solid transparent;border-radius:10px;background:#17141c;color:#fff4fa;text-align:left;padding:0 12px;font:inherit;font-weight:900;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.mcj-select-option:hover,.mcj-select-option:focus{outline:0;border-color:rgba(255,183,216,.42);background:#311225;color:#fff;}',
      '.mcj-select-option[aria-selected="true"]{border-color:rgba(255,126,190,.66);background:linear-gradient(135deg,rgba(255,126,190,.24),rgba(70,22,50,.96));color:#fff;}',
      '.mcj-select-option[disabled]{opacity:.45;cursor:not-allowed;}',
      '@media(max-width:560px){.mcj-select-button{height:50px}.mcj-select-panel{border-radius:16px}.mcj-select-option{min-height:44px;font-size:15px;}}'
    ].join('');
    document.head.appendChild(style);
  }

  function textOf(option){
    return (option && (option.textContent || option.label || option.value) || '').trim();
  }

  function selectedText(select){
    var option = select.options[select.selectedIndex];
    var placeholder = select.getAttribute('placeholder') || select.dataset.placeholder || '请选择';
    return textOf(option) || placeholder;
  }

  function makePanel(){
    if(panel) return panel;
    panel = document.createElement('div');
    panel.className = 'mcj-select-panel';
    panel.setAttribute('role','listbox');
    document.body.appendChild(panel);
    panel.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
    return panel;
  }

  function closePanel(){
    if(active && active.wrap) active.wrap.classList.remove('is-open');
    if(panel){
      panel.classList.remove('open');
      panel.innerHTML = '';
    }
    active = null;
  }

  function setSelectValue(select, index){
    if(index < 0 || index >= select.options.length) return;
    var opt = select.options[index];
    if(opt.disabled) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('input', { bubbles:true }));
    select.dispatchEvent(new Event('change', { bubbles:true }));
    updateButton(select);
    closePanel();
  }

  function openPanel(select){
    var wrap = select.closest('.mcj-select-wrap');
    var button = wrap && wrap.querySelector('.mcj-select-button');
    if(!wrap || !button) return;
    if(active && active.select === select){ closePanel(); return; }
    closePanel();
    makePanel();
    active = { select:select, wrap:wrap, button:button };
    wrap.classList.add('is-open');

    var opts = Array.prototype.slice.call(select.options || []);
    var current = select.selectedIndex;
    panel.innerHTML = '';
    panel.style.width = button.getBoundingClientRect().width + 'px';
    panel.style.maxHeight = Math.min(300, Math.max(48, opts.length * 46 + 12)) + 'px';

    opts.forEach(function(opt, i){
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'mcj-select-option';
      item.textContent = textOf(opt) || '请选择';
      item.disabled = !!opt.disabled;
      item.setAttribute('role','option');
      item.setAttribute('aria-selected', i === current ? 'true' : 'false');
      item.addEventListener('click', function(){ setSelectValue(select, i); });
      panel.appendChild(item);
    });

    positionPanel();
    panel.classList.add('open');
    var chosen = panel.querySelector('[aria-selected="true"]');
    if(chosen) chosen.scrollIntoView({ block:'nearest' });
  }

  function positionPanel(){
    if(!active || !panel) return;
    var rect = active.button.getBoundingClientRect();
    var gap = 8;
    var h = panel.offsetHeight || Math.min(300, Math.max(48, active.select.options.length * 46 + 12));
    var below = window.innerHeight - rect.bottom - gap;
    var above = rect.top - gap;
    var top = below >= Math.min(h, 240) || below >= above ? rect.bottom + gap : Math.max(8, rect.top - h - gap);
    var left = Math.min(Math.max(8, rect.left), window.innerWidth - rect.width - 8);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.width = rect.width + 'px';
    panel.style.maxHeight = Math.max(88, Math.min(300, window.innerHeight - top - 8, active.select.options.length * 46 + 12)) + 'px';
  }

  function updateButton(select){
    var wrap = select.closest('.mcj-select-wrap');
    var button = wrap && wrap.querySelector('.mcj-select-button');
    if(button) button.textContent = selectedText(select);
  }

  function enhanceSelect(select){
    if(!select || select.hasAttribute(ENHANCED) || select.multiple) return;
    injectStyle();
    select.setAttribute(ENHANCED, '1');
    select.classList.add('mcj-select-native');
    var wrap = document.createElement('span');
    wrap.className = 'mcj-select-wrap';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'mcj-select-button';
    button.textContent = selectedText(select);
    button.setAttribute('aria-haspopup','listbox');
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    wrap.appendChild(button);
    button.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      openPanel(select);
    });
    button.addEventListener('keydown', function(e){
      if(e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown'){
        e.preventDefault();
        openPanel(select);
      }
      if(e.key === 'Escape') closePanel();
    });
    select.addEventListener('change', function(){ updateButton(select); });
    new MutationObserver(function(){
      updateButton(select);
      if(active && active.select === select) openPanel(select);
    }).observe(select, { childList:true, subtree:true, attributes:true, characterData:true });
  }

  function enhanceAll(root){
    Array.prototype.slice.call((root || document).querySelectorAll(SELECTOR)).forEach(enhanceSelect);
  }

  document.addEventListener('pointerdown', function(e){
    if(active && !e.target.closest('.mcj-select-wrap') && !e.target.closest('.mcj-select-panel')) closePanel();
  });
  window.addEventListener('resize', positionPanel);
  window.addEventListener('scroll', positionPanel, true);

  function boot(){
    injectStyle();
    enhanceAll(document);
    new MutationObserver(function(mutations){
      mutations.forEach(function(m){
        m.addedNodes && Array.prototype.forEach.call(m.addedNodes, function(node){
          if(node.nodeType !== 1) return;
          if(node.matches && node.matches(SELECTOR)) enhanceSelect(node);
          enhanceAll(node);
        });
      });
    }).observe(document.body, { childList:true, subtree:true });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
