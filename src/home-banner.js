(function(){
  'use strict';

  if (window.MCJHomeBanner) return;

  var STORE_KEY = 'mcjPlatformData.v1';
  var FALLBACK_IMAGE = /\/admin\//.test(location.pathname) ? '../assets/hero-banner-latest.png' : 'assets/hero-banner-latest.png';
  var timers = new WeakMap();

  function readStore(){
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; }
    catch(e){ return {}; }
  }

  function clamp(value, min, max, fallback){
    var number = Number(value);
    if (!Number.isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, number));
  }

  function inSchedule(item){
    var now = Date.now();
    var start = item.startAt ? Date.parse(item.startAt) : 0;
    var end = item.endAt ? Date.parse(item.endAt) : 0;
    return (!start || now >= start) && (!end || now <= end);
  }

  function activeBanners(){
    var db = readStore();
    var list = (((db.contents || {}).banners) || []).filter(function(item){
      return item && item.enabled !== false && item.published === true && inSchedule(item);
    });
    list.sort(function(a, b){ return Number(a.sort || 99) - Number(b.sort || 99); });
    return list;
  }

  function publishedBanner(){
    return activeBanners()[0] || null;
  }

  function getAnnouncements(){
    var db = readStore();
    var list = (((db.contents || {}).notices) || []).filter(function(item){
      return item && item.enabled !== false && inSchedule(item);
    });
    list.sort(function(a, b){
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return Number(a.sort || 99) - Number(b.sort || 99);
    });
    return list.map(function(item){ return item.text || item.title || ''; }).filter(Boolean);
  }

  function defaults(config){
    config = config || {};
    return {
      id: config.id || '',
      name: config.name || '首页 Banner',
      image: config.desktopImage || config.image || FALLBACK_IMAGE,
      desktopImage: config.desktopImage || config.image || FALLBACK_IMAGE,
      mobileImage: config.mobileImage || '',
      alt: config.alt || '妙脆角电竞 Banner',
      fitMode: config.fitMode === 'contain' ? 'contain' : 'cover',
      objectPosition: config.objectPosition || '50% 50%',
      desktopHeight: clamp(config.desktopHeight, 360, 620, 520),
      mobileHeight: clamp(config.mobileHeight, 180, 320, 260),
      maxWidth: clamp(config.maxWidth, 960, 1440, 1440),
      radius: clamp(config.radius, 18, 28, 24),
      marginTop: clamp(config.marginTop, 0, 48, 16),
      marginBottom: clamp(config.marginBottom, 0, 48, 18),
      imageScale: clamp(config.imageScale, .72, 1.65, 1),
      link: config.link || config.href || '',
      linkTarget: config.linkTarget || '_self'
    };
  }

  function sourceFor(data, device){
    return device === 'mobile' && data.mobileImage ? data.mobileImage : (data.desktopImage || data.image || FALLBACK_IMAGE);
  }

  function applyVars(root, data, device){
    root.style.setProperty('--hero-h', data.desktopHeight + 'px');
    root.style.setProperty('--hero-mobile-h', data.mobileHeight + 'px');
    root.style.setProperty('--hero-radius', data.radius + 'px');
    root.style.setProperty('--hero-fit', data.fitMode === 'cover' ? 'cover' : 'contain');
    root.style.setProperty('--hero-position', data.objectPosition || '50% 50%');
    root.style.setProperty('--hero-image-scale', data.imageScale);
    root.style.maxWidth = data.maxWidth + 'px';
    root.style.marginTop = data.marginTop + 'px';
    root.style.marginBottom = data.marginBottom + 'px';
    root.dataset.bannerId = data.id || '';
    root.dataset.bannerDevice = device || '';
  }

  function heroHtml(data, source, announcements, index, total){
    var dots = '';
    for (var i = 0; i < total; i += 1) {
      dots += '<button type="button" class="' + (i === index ? 'active' : '') + '" data-hero-dot="' + i + '" aria-label="切换 Banner"></button>';
    }
    return '<a class="mcj-hero-image-link" href="' + safeAttr(data.link || '#') + '" target="' + safeAttr(data.linkTarget || '_self') + '" aria-label="' + safeAttr(data.name || '首页 Banner') + '">' +
        '<img class="mcj-hero-image" src="' + safeAttr(source) + '" alt="' + safeAttr(data.alt || '妙脆角电竞 Banner') + '">' +
      '</a>' +
      (total > 1 ? '<button class="mcj-hero-arrow prev" type="button" data-hero-prev aria-label="上一张">‹</button><button class="mcj-hero-arrow next" type="button" data-hero-next aria-label="下一张">›</button><div class="mcj-hero-dots">' + dots + '</div>' : '') +
      '';
  }

  function safeText(value){
    return String(value || '').replace(/[&<>"']/g, function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }

  function safeAttr(value){
    return safeText(value).replace(/`/g, '&#96;');
  }

  function render(target, config, options){
    var root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) return null;

    var device = (options && options.device) || (window.matchMedia && window.matchMedia('(max-width: 640px)').matches ? 'mobile' : 'desktop');
    var banners = Array.isArray(config) ? config : (config ? [config] : activeBanners());
    if (!banners.length) banners = [{}];
    var current = Number(root.dataset.heroIndex || 0);
    if (options && Number.isFinite(Number(options.index))) current = Number(options.index);
    current = Math.max(0, Math.min(banners.length - 1, current));

    var data = defaults(banners[current]);
    root.dataset.heroIndex = String(current);
    applyVars(root, data, device);

    if (!root.classList.contains('mcj-home-hero')) {
      root.classList.add('mcj-home-hero');
    }
    root.innerHTML = heroHtml(data, sourceFor(data, device), getAnnouncements(), current, banners.length);
    bindHero(root, banners, device);
    ensureBelowHero(root, getAnnouncements());
    return data;
  }

  function ensureBelowHero(root, announcements){
    if (root.hasAttribute('data-admin-preview-banner')) return;
    var actions = root.nextElementSibling;
    if (!actions || !actions.classList || !actions.classList.contains('mcj-hero-below-actions')) {
      actions = document.createElement('div');
      actions.className = 'mcj-hero-below-actions';
      actions.innerHTML = '<a class="mcj-hero-btn primary" href="companion-center.html">立即找陪玩</a><a class="mcj-hero-btn secondary" href="companion-apply.html">申请成为陪玩</a>';
      root.insertAdjacentElement('afterend', actions);
    }
    var notice = actions.nextElementSibling;
    if (!notice || !notice.classList || !notice.classList.contains('mcj-hero-notice')) {
      notice = document.createElement('div');
      notice.className = 'mcj-hero-notice';
      notice.innerHTML = '<b>官方公告</b><div><span></span></div>';
      actions.insertAdjacentElement('afterend', notice);
    }
    var text = announcements.join('　｜　') || '暂无公告';
    var span = notice.querySelector('span');
    if (span) span.textContent = text;
  }

  function bindHero(root, banners, device){
    var oldTimer = timers.get(root);
    if (oldTimer) clearInterval(oldTimer);

    root.onmousemove = function(e){
      var rect = root.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / rect.width - .5) * 10;
      var y = ((e.clientY - rect.top) / rect.height - .5) * 8;
      root.style.setProperty('--mx', x.toFixed(2) + 'px');
      root.style.setProperty('--my', y.toFixed(2) + 'px');
    };
    root.onmouseleave = function(){
      root.style.setProperty('--mx', '0px');
      root.style.setProperty('--my', '0px');
      if (banners.length > 1) start();
    };
    root.onmouseenter = function(){
      var timer = timers.get(root);
      if (timer) clearInterval(timer);
    };
    root.onclick = function(e){
      var prev = e.target.closest('[data-hero-prev]');
      var next = e.target.closest('[data-hero-next]');
      var dot = e.target.closest('[data-hero-dot]');
      if (!prev && !next && !dot) return;
      e.preventDefault();
      var index = Number(root.dataset.heroIndex || 0);
      if (prev) index -= 1;
      if (next) index += 1;
      if (dot) index = Number(dot.dataset.heroDot);
      if (index < 0) index = banners.length - 1;
      if (index >= banners.length) index = 0;
      render(root, banners, { device: device, index: index });
    };

    function start(){
      if (banners.length <= 1) return;
      var timer = setInterval(function(){
        var index = Number(root.dataset.heroIndex || 0) + 1;
        if (index >= banners.length) index = 0;
        render(root, banners, { device: device, index: index });
      }, 5000);
      timers.set(root, timer);
    }
    start();
  }

  function applyHome(){
    var root = document.querySelector('[data-mcj-home-hero]') || document.querySelector('.mcj-home-hero') || document.querySelector('.banner');
    if (root) render(root);
  }

  window.MCJHomeBanner = {
    readStore: readStore,
    publishedBanner: publishedBanner,
    activeBanners: activeBanners,
    defaults: defaults,
    render: render,
    applyHome: applyHome
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyHome);
  } else {
    applyHome();
  }
  window.addEventListener('mcj:platform-data-updated', applyHome);
})();
