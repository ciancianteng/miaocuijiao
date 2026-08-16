(function(){
  /**
   * Legacy admin-suite collection short-names (old defaultDb tables).
   * Generic read()/write() must never treat these as live business data.
   */
  var LOCAL_BUSINESS_COLLECTION_KEYS=[
    'users','bosses','clubs','players','orders','wallets','wallet_transactions',
    'recharge_requests','withdraw_requests','invite_rebates','customer_tickets',
    'reviews','games','banners','announcements','admin_logs','role_permissions',
    'companionLevels','refunds'
  ];
  /**
   * Exact localStorage/sessionStorage keys allowed to be purged on admin boot.
   * Whitelist ONLY — never fuzzy-match / never delete all mcj_*.
   * Source: former defaultDb mock/demo business collections (+ refunds alias).
   * Intentionally EXCLUDES mcj_companionLevels / mcj_player_levels (still used by
   * MCJCompanionLevels as local level-cache, not mock table rows).
   */
  var STALE_MOCK_BUSINESS_STORAGE_KEYS=[
    'mcj_users',
    'mcj_bosses',
    'mcj_clubs',
    'mcj_players',
    'mcj_orders',
    'mcj_wallets',
    'mcj_wallet_transactions',
    'mcj_recharge_requests',
    'mcj_withdraw_requests',
    'mcj_invite_rebates',
    'mcj_customer_tickets',
    'mcj_reviews',
    'mcj_games',
    'mcj_banners',
    'mcj_announcements',
    'mcj_admin_logs',
    'mcj_role_permissions',
    'mcj_refunds'
  ];
  /**
   * Hard deny-list: purge must never remove these even if mistakenly listed above.
   * Covers login session, remember-login / auth, portal role, theme / UI prefs.
   */
  var PURGE_NEVER_TOUCH_KEYS=[
    // Admin / shared auth session
    'adminAuthToken','adminUser',
    'mcjAdminAccessToken','mcjAdminRefreshToken','mcjAdminExpiresAt','mcjAdminLoginNotice',
    'mcjAuthAccessToken','mcjAuthRefreshToken','mcjAuthExpiresAt',
    'mcjRole','mcjCurrentUser','mcjActivePortal','mcjAfterLoginRedirect',
    // Other portal auth / remember-login
    'mcjCompanionSession','companionAuthToken','companionUser',
    'mcjServiceSession','customerServiceAuthToken','customerServiceUser',
    'customerUser','customerUser','bossAuthToken','bossUser',
    // Theme / language / UI prefs / site chrome (not mock business tables)
    'mcjTheme','mcjLang','mcjLocale','mcj_siteSettings',
    // Companion level local cache (real config helper — not defaultDb mock rows)
    'mcj_companionLevels','mcj_player_levels',
    // Banner / platform-content tooling keys (not defaultDb mock tables)
    'mcj_local_banner_assets_v1','mcj_banner_published_at',
    // Legacy V1 account helper stores (not defaultDb mock tables)
    'mcj_v1_accounts','mcj_v1_profiles'
  ];
  // Removed defaultDb mock payload (fake users/orders/wallets/chat/ranking seeds).
  // Formal admin only accepts REAL API / Supabase — empty DB → 0 / 暂无数据.
  var defaultDb=null;
  var DB_KEYS=LOCAL_BUSINESS_COLLECTION_KEYS;
  function isLocalBusinessKey(key){
    return LOCAL_BUSINESS_COLLECTION_KEYS.indexOf(String(key||''))>-1;
  }
  function isPurgeNeverTouchKey(fullKey){
    var k=String(fullKey||'');
    if(PURGE_NEVER_TOUCH_KEYS.indexOf(k)>-1)return true;
    // Extra safety: never wipe auth/session/remember markers by prefix accident.
    if(/^(adminAuth|adminUser|mcjAdmin|mcjAuth|mcjRole|mcjCurrentUser|mcjActivePortal|mcjCompanion|mcjService|companionAuth|companionUser|customerService|bossAuth|bossUser|customerUser|playerUser)/i.test(k))return true;
    if(/^(mcjTheme|mcjLang|mcjLocale|mcj_siteSettings)/i.test(k))return true;
    return false;
  }
  function purgeStaleLocalBusinessData(){
    // Explicit whitelist delete only. Does NOT scan / clear all mcj_* keys.
    STALE_MOCK_BUSINESS_STORAGE_KEYS.forEach(function(fullKey){
      if(isPurgeNeverTouchKey(fullKey))return;
      try{localStorage.removeItem(fullKey);}catch(e){}
      try{sessionStorage.removeItem(fullKey);}catch(e2){}
    });
  }
  // Expose audit helpers for acceptance (read-only).
  try{
    window.MCJAdminLocalDataPurge={
      deletedKeys:STALE_MOCK_BUSINESS_STORAGE_KEYS.slice(),
      neverTouchKeys:PURGE_NEVER_TOUCH_KEYS.slice(),
      mode:'exact-whitelist'
    };
  }catch(eAudit){}
  function read(key){
    // Hard block: never surface mcj_* business arrays (stale demos / defaultDb leftovers).
    if(isLocalBusinessKey(key))return [];
    try{var v=JSON.parse(localStorage.getItem('mcj_'+key)||'null');if(Array.isArray(v))return v;}catch(e){}
    return [];
  }
  function write(key,val){
    // Refuse writing business collections to localStorage (no mock seed / no fake CRUD).
    if(isLocalBusinessKey(key))return;
    localStorage.setItem('mcj_'+key,JSON.stringify(val));
  }
  function log(action){
    // Operational note only — do not persist fake activity feeds into mcj_admin_logs.
    try{if(window.console&&console.info)console.info('[admin]',action);}catch(e){}
  }
  function readStorageItem(key){return localStorage.getItem(key)||sessionStorage.getItem(key)||''}
  function readJsonKey(key){try{return JSON.parse(readStorageItem(key)||'{}')||{}}catch(e){return {}}}
  function isAdminRoleName(role){role=String(role||'');return role==='admin'||role==='super_admin'||role==='finance_admin'}
  function adminPermissionRole(){
    var token=readStorageItem('adminAuthToken');
    var user=readJsonKey('adminUser');
    var perms=Array.isArray(user.permissions)?user.permissions:[];
    var role=String(user.adminRole||user.role||'');
    var softOk=String(token).indexOf('admin_session_')===0;
    var jwtOk=!!authAccessToken();
    // Soft session alone NEVER grants admin — require live JWT.
    if(!softOk||!jwtOk)return '';
    if(role==='super_admin'||perms.indexOf('super_admin')>-1)return 'super_admin';
    if(role==='finance_admin'||perms.indexOf('finance_admin')>-1)return 'finance_admin';
    if(role==='admin'||perms.indexOf('admin')>-1)return 'admin';
    // Soft+JWT present but adminUser stale: provisional until /me confirms.
    return 'admin';
  }
  function getRole(){var adminRole=adminPermissionRole();if(adminRole)return adminRole;var role=readStorageItem('mcjRole')||'user';if(role==='super_admin'||role==='admin')return role;return role}
  function authAccessToken(){return window.MCJAdminAuthFetch?window.MCJAdminAuthFetch.getAccessToken():readStorageItem('mcjAuthAccessToken')}
  function adminFetch(url,init){return window.MCJAdminAuthFetch?window.MCJAdminAuthFetch.fetch(url,init||{}):fetch(url,init||{})}
  function adminApiHeaders(extra){
    if(window.MCJAdminAuthFetch)return window.MCJAdminAuthFetch.getAuthHeaders(Object.assign({'x-mcj-admin-role':getRole()},extra||{}));
    var headers=Object.assign({'x-mcj-admin-role':getRole(),Accept:'application/json'},extra||{});
    var token=authAccessToken();
    if(token){headers.Authorization='Bearer '+token;headers['x-mcj-access-token']=token}
    return headers;
  }
  function routeByRole(role){var map={super_admin:'admin.html',admin:'admin.html',customer:'index.html',boss:'mine.html',user:'index.html',companion:'companion/index.html',player:'companion/index.html',customer_service:'customer-service/index.html',service:'customer-service/index.html',club_owner:'index.html'};location.replace(map[role]||'index.html')}
  function hasAdminPermissionFor(required){var role=adminPermissionRole();if(!role)return false;if(required==='admin')return role==='admin'||role==='super_admin';if(required==='super_admin')return role==='super_admin'||role==='admin';return role===required||role==='super_admin'}
  function isLocalAdminPreview(){return location.hostname==='localhost'||location.hostname==='127.0.0.1'||location.hostname==='::1'}
  function ensureLocalAdminPreviewSession(){return hasAdminPermissionFor('admin')}
  function renderAdminAuthLoading(){
    if(!document.querySelector('link[data-mcj-auth-shell]')){
      var link=document.createElement('link');
      link.rel='stylesheet';
      link.href='/src/auth-shell.css';
      link.setAttribute('data-mcj-auth-shell','true');
      document.head.appendChild(link);
    }
    var host=document.createElement('div');
    host.id='adminAuthLoading';
    host.innerHTML=
      '<main class="mcj-auth-page" style="position:fixed;inset:0;z-index:9999">'+
      '<section class="mcj-auth-card" style="text-align:center">'+
      '<h1 class="mcj-auth-title">正在验证管理员身份…</h1>'+
      '<p class="mcj-auth-desc">请稍候，正在读取登录状态。</p>'+
      '</section></main>';
    document.body.appendChild(host);
  }
  function clearAdminAuthLoading(){
    var host=document.getElementById('adminAuthLoading');
    if(host&&host.parentNode)host.parentNode.removeChild(host);
  }
  function renderAdminAccessDenied(){
    clearAdminAuthLoading();
    if(!document.querySelector('link[data-mcj-auth-shell]')){
      var link=document.createElement('link');
      link.rel='stylesheet';
      link.href='/src/auth-shell.css';
      link.setAttribute('data-mcj-auth-shell','true');
      document.head.appendChild(link);
    }
    document.body.innerHTML=
      '<main class="mcj-auth-page">'+
      '<section class="mcj-auth-card" style="text-align:center">'+
      '<h1 class="mcj-auth-title">无权访问后台中心</h1>'+
      '<p class="mcj-auth-desc">请使用拥有管理员权限的账号登录后再进入超级管理中心。</p>'+
      '<a class="mcj-auth-btn primary" href="/admin/login" style="display:inline-grid;place-items:center;text-decoration:none;width:100%">返回登录</a>'+
      '</section></main>';
  }
  function enforceRole(){
    var allowed=(document.body.dataset.allowedRoles||'').split(',').filter(Boolean);
    if(!allowed.length)return true;
    var adminOnly=allowed.indexOf('super_admin')>-1||allowed.indexOf('admin')>-1;
    if(adminOnly){
      renderAdminAuthLoading();
      var gate=window.MCJRoleGate;
      var Auth=window.MCJAdminAuthFetch;
      var jwt=Auth&&Auth.getAccessToken?Auth.getAccessToken():authAccessToken();
      var logged=gate?gate.isLogged('admin'):false;
      // Unauthenticated / soft-only → login (never flash shell or "无权限")
      if(!jwt||!logged){
        if(gate&&gate.logout)gate.logout('admin');
        location.replace((gate&&gate.routes&&gate.routes.admin&&gate.routes.admin.login)||'/admin/login/');
        return false;
      }
      if(hasAdminPermissionFor('admin')){
        clearAdminAuthLoading();
        revealAdminShell();
        return true;
      }
      // Authenticated session exists but role is not admin/super_admin
      renderAdminAccessDenied();
      return false;
    }
    var current=getRole();
    if(allowed.indexOf(current)<0){routeByRole(current);return false;}
    return true;
  }
  function revealAdminShell(){
    try{
      document.documentElement.removeAttribute('data-mcj-auth-gate');
      document.documentElement.style.visibility='';
      var shell=document.querySelector('[data-admin-shell], .admin-shell');
      if(shell)shell.hidden=false;
    }catch(e){}
  }
  function denyAdminToLogin(message){
    try{
      if(message)sessionStorage.setItem('mcjAdminLoginNotice',String(message));
    }catch(e){}
    if(window.MCJRoleGate&&window.MCJRoleGate.logout)window.MCJRoleGate.logout('admin');
    [
      'adminAuthToken','adminUser','mcjAdminAccessToken','mcjAdminRefreshToken','mcjAdminExpiresAt',
      'mcjAuthAccessToken','mcjAuthRefreshToken','mcjAuthExpiresAt','mcjRole','mcjCurrentUser'
    ].forEach(function(k){try{localStorage.removeItem(k);sessionStorage.removeItem(k)}catch(e){}});
    location.replace('/admin/login/');
  }
  function statusChip(text){var t=String(text||'');var cls=/通过|完成|成功|在线|正常|开启|显示/.test(t)?'ok':/拒绝|冻结|异常|取消|离线|关闭|隐藏/.test(t)?'bad':'wait';return '<span class="chip '+cls+'">'+esc(t)+'</span>'}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function table(headers,rows){
    var body='';
    if(Array.isArray(rows)) body=rows.length?rows.join(''):'';
    else body=String(rows||'');
    return '<div class="table-wrap"><table><thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead><tbody>'+(body||('<tr><td colspan="'+headers.length+'"><div class="empty">暂无数据</div></td></tr>'))+'</tbody></table></div>';
  }
  function actionButtons(id){return '<div class="row"><button class="btn small" data-action="view" data-id="'+id+'">查看</button><button class="btn small primary" data-action="approve" data-id="'+id+'">通过</button><button class="btn small danger" data-action="reject" data-id="'+id+'">拒绝</button></div>'}
  function renderGenericTable(key,target,columns,rowsOverride){var data=Array.isArray(rowsOverride)?rowsOverride:read(key);var rows=data.map(function(item){return '<tr>'+columns.map(function(c){var v=item[c.key];if(c.type==='avatar')return '<td><img class="avatar" src="'+esc(v||'assets/meow-cuijiao-brand.jpg')+'"></td>';if(c.type==='status')return '<td>'+statusChip(v)+'</td>';if(c.type==='actions')return '<td>'+actionButtons(item.id||item.name||item.owner)+'</td>';return '<td>'+esc(v)+'</td>';}).join('')+'</tr>'});target.innerHTML=table(columns.map(function(c){return c.label}),rows.length?rows:['<tr><td colspan="'+columns.length+'"><div class="empty">暂无数据</div></td></tr>'])}
  function statCards(target,stats){target.innerHTML='<div class="metric-grid">'+stats.map(function(s){return '<div class="metric-card"><span>'+esc(s.label)+'</span><strong>'+esc(s.value)+'</strong>'+(s.sub?'<small>'+esc(s.sub)+'</small>':'')+'</div>'}).join('')+'</div>'}
  function renderCrud(key,target){var data=read(key);target.innerHTML='<div class="crud-list">'+data.map(function(item,i){return '<div class="mini-card"><img src="'+esc(item.image||item.avatar||'assets/meow-cuijiao-brand.jpg')+'"><h4>'+esc(item.title||item.name||item.id||'未命名')+'</h4><p>'+esc(item.sub||item.content||item.description||item.game||item.status||'可编辑内容')+'</p><div class="row"><button class="btn small" data-edit="'+key+'" data-index="'+i+'">编辑</button><button class="btn small danger" data-delete="'+key+'" data-index="'+i+'">删除</button></div></div>'}).join('')+'</div>'}
  function emptyPanel(id, text){
    var target=document.getElementById(id);
    if(target&&!target.innerHTML.trim())target.innerHTML='<div class="empty">'+esc(text||'暂无数据')+'</div>';
  }
  function levelApi(){return window.MCJCompanionLevels}
  function getLevels(){return levelApi()?levelApi().read():[]}
  function levelLabel(value){return levelApi()?levelApi().label(value):String(value||'')}
  function levelRange(value){return levelApi()?levelApi().formatRange(value):''}
  function playerLevelCount(level){return read('players').filter(function(player){var item=levelApi()?levelApi().find(player.levelId||player.level||player.level_name):null;return item&&item.id===level.id}).length}
  function renderCompanionLevels(){
    if(window.MCJAdminCompanionLevels)return;
    var target=document.getElementById('companionLevelSettings');
    if(!target||!levelApi())return;
    var levels=getLevels();
    target.innerHTML='<div class="table-wrap"><table class="level-settings-table"><thead><tr><th>排序</th><th>等级</th><th>价格范围</th><th>说明</th><th>升级条件</th><th>开放申请</th><th>状态</th><th>操作</th></tr></thead><tbody>'+levels.map(function(level){
      return '<tr data-level-row="'+esc(level.id)+'">'+
        '<td><input data-level-field="sort" value="'+esc(level.sort)+'" inputmode="numeric"></td>'+
        '<td><div class="grid-2"><input data-level-field="icon" value="'+esc(level.icon)+'"><input data-level-field="name" value="'+esc(level.name)+'"></div><small>'+esc(level.code)+'</small></td>'+
        '<td><div class="grid-2"><input data-level-field="min" value="'+esc(level.min)+'" inputmode="numeric"><input data-level-field="max" value="'+esc(level.max)+'" inputmode="numeric"></div><small>'+esc(levelRange(level))+'</small></td>'+
        '<td><textarea data-level-field="description">'+esc(level.description)+'</textarea></td>'+
        '<td><textarea data-level-field="upgradeCondition">'+esc(level.upgradeCondition)+'</textarea></td>'+
        '<td><select data-level-field="open"><option value="true" '+(level.open?'selected':'')+'>开放</option><option value="false" '+(!level.open?'selected':'')+'>关闭</option></select></td>'+
        '<td><select data-level-field="enabled"><option value="true" '+(level.enabled?'selected':'')+'>启用</option><option value="false" '+(!level.enabled?'selected':'')+'>停用</option></select></td>'+
        '<td><button class="btn small danger" data-delete-companion-level="'+esc(level.id)+'" type="button">删除</button><small>'+playerLevelCount(level)+' 位陪玩</small></td>'+
      '</tr>';
    }).join('')+'</tbody></table></div><div class="notice">陪玩不能自行修改等级；等级只能由后台管理员调整，或达到升级条件后进入后台审核。</div>';
  }
  function collectCompanionLevels(){
    if(!levelApi())return [];
    return [].slice.call(document.querySelectorAll('[data-level-row]')).map(function(row,index){
      var id=row.dataset.levelRow;
      var base=levelApi().find(id);
      function field(name){var el=row.querySelector('[data-level-field="'+name+'"]');return el?el.value:''}
      return Object.assign({},base,{id:id,level:base.level,code:base.code,icon:field('icon'),name:field('name'),min:Number(field('min')),max:Number(field('max')),description:field('description'),upgradeCondition:field('upgradeCondition'),sort:Number(field('sort')||index+1),open:field('open')==='true',enabled:field('enabled')==='true'});
    });
  }
  function playerValue(player,keys,fallback){
    for(var i=0;i<keys.length;i++){var value=player[keys[i]];if(value!==undefined&&value!==null&&value!=='')return value;}
    return fallback||'-';
  }
  function maskPhone(value){
    var text=String(value||'').replace(/\s+/g,'');
    return text.length>6?text.slice(0,3)+'****'+text.slice(-3):(text||'-');
  }
  function maskEmail(value){
    var text=String(value||'');
    var parts=text.split('@');
    if(parts.length!==2)return text||'-';
    return parts[0].slice(0,2)+'***@'+parts[1];
  }
  function bossValue(boss,keys,fallback){
    for(var i=0;i<keys.length;i++){var value=boss[keys[i]];if(value!==undefined&&value!==null&&value!=='')return value;}
    return fallback||'-';
  }
  var bossAdminState={page:1,pageSize:20,rows:[],loaded:false,error:'',activeBossId:'',activeBossTab:'profile'};
  var bossMorePopover={el:null,anchor:null,bossId:'',onScroll:null,bound:false};
  function closeBossMoreMenu(){
    if(bossMorePopover.el){
      bossMorePopover.el.remove();
      bossMorePopover.el=null;
    }
    bossMorePopover.anchor=null;
    bossMorePopover.bossId='';
    if(bossMorePopover.onScroll){
      document.querySelectorAll('.boss-table-wrap').forEach(function(scroller){
        scroller.removeEventListener('scroll',bossMorePopover.onScroll);
      });
      window.removeEventListener('scroll',bossMorePopover.onScroll,true);
      window.removeEventListener('resize',bossMorePopover.onScroll);
      bossMorePopover.onScroll=null;
    }
  }
  function positionBossMoreMenu(){
    var menu=bossMorePopover.el;
    var anchor=bossMorePopover.anchor;
    if(!menu||!anchor||!document.body.contains(anchor)){closeBossMoreMenu();return;}
    var rect=anchor.getBoundingClientRect();
    var menuWidth=Math.max(176,menu.offsetWidth||176);
    var menuHeight=menu.offsetHeight||280;
    var gap=6;
    var left=Math.min(Math.max(8,rect.right-menuWidth),window.innerWidth-menuWidth-8);
    var top=rect.bottom+gap;
    if(top+menuHeight>window.innerHeight-8 && rect.top-gap-menuHeight>8){
      top=rect.top-gap-menuHeight;
    }
    top=Math.max(8,Math.min(top,window.innerHeight-menuHeight-8));
    menu.style.left=Math.round(left)+'px';
    menu.style.top=Math.round(top)+'px';
  }
  function openBossMoreMenu(anchorBtn){
    var bossId=String(anchorBtn.getAttribute('data-boss-id')||'').trim();
    if(!bossId)return;
    if(bossMorePopover.el&&bossMorePopover.bossId===bossId){closeBossMoreMenu();return;}
    closeBossMoreMenu();
    var items=[
      ['view','查看资料'],
      ['orders','订单记录'],
      ['recharge','充值记录'],
      ['consume','消费记录'],
      ['refunds','退款记录'],
      ['vip','VIP设置'],
      ['coupon','优惠券'],
      ['remark','备注']
    ];
    var menu=document.createElement('div');
    menu.className='boss-more-popover';
    menu.setAttribute('role','menu');
    menu.setAttribute('data-boss-more-popover','1');
    menu.innerHTML=items.map(function(item){
      return '<button type="button" role="menuitem" data-boss-action="'+esc(item[0])+'" data-boss-id="'+esc(bossId)+'">'+esc(item[1])+'</button>';
    }).join('');
    document.body.appendChild(menu);
    bossMorePopover.el=menu;
    bossMorePopover.anchor=anchorBtn;
    bossMorePopover.bossId=bossId;
    positionBossMoreMenu();
    bossMorePopover.onScroll=function(){closeBossMoreMenu();};
    document.querySelectorAll('.boss-table-wrap').forEach(function(scroller){
      scroller.addEventListener('scroll',bossMorePopover.onScroll,{passive:true});
    });
    window.addEventListener('scroll',bossMorePopover.onScroll,true);
    window.addEventListener('resize',bossMorePopover.onScroll);
  }
  function ensureBossMorePopoverBound(){
    if(bossMorePopover.bound)return;
    bossMorePopover.bound=true;
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape')closeBossMoreMenu();
    });
  }
  ensureBossMorePopoverBound();
  function closeAdminModal(){
    closeBossMoreMenu();
    var modal=document.getElementById('adminModal');
    var body=document.getElementById('modalBody');
    if(body)body.innerHTML='';
    if(modal){
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden','true');
    }
    bossAdminState.activeBossId='';
  }
  function openAdminModal(){
    var modal=document.getElementById('adminModal');
    if(!modal)return;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
  }
  function renderBossManagement(){
    var target=document.getElementById('bossManagement');
    if(!target)return;
    target.innerHTML='<div class="boss-admin-page compact">'+
      '<div class="admin-section-head compact"><div><h3>老板列表</h3><p>搜索老板账号，查看基础资料、资金、订单、充值与退款记录。</p></div><span class="admin-count-pill" data-boss-count>0 条</span></div>'+
      '<div class="boss-filter-bar" data-boss-filter-bar>'+
        '<select class="boss-filter-field" data-boss-filter="vip" aria-label="VIP等级"><option value="">VIP等级</option><option>VIP0</option><option>VIP1</option><option>VIP2</option><option>VIP3</option><option>VIP4</option><option>VIP5</option></select>'+
        '<select class="boss-filter-field" data-boss-filter="status" aria-label="账号状态"><option value="">账号状态</option><option>正常</option><option>限制下单</option><option>限制充值</option><option>冻结</option><option>已注销</option><option>黑名单</option></select>'+
        '<input class="boss-filter-field" type="date" data-boss-filter="registered" aria-label="注册日期">'+
        '<input class="boss-filter-field boss-filter-search" data-boss-search placeholder="老板 UID / 昵称 / 手机号 / 邮箱" aria-label="搜索">'+
        '<button class="mini-btn primary-lite boss-filter-action" type="button" data-boss-search-button>搜索</button>'+
        '<button class="mini-btn boss-filter-action" type="button" data-boss-clear>重置</button>'+
        '<button class="mini-btn boss-filter-action" type="button" data-boss-export>导出</button>'+
      '</div>'+
      '<div id="bossManagementTable" class="boss-table-shell compact"></div>'+
    '</div>';
    loadBossAdminRows();
  }
  function loadBossAdminRows(){
    adminFetch('/api/admin/bosses',{headers:{'x-mcj-admin-role':getRole(),Accept:'application/json'}}).then(function(res){
      var ct=res.headers.get('content-type')||'';
      if(ct.indexOf('application/json')<0)return {ok:true,bosses:[]};
      return res.json();
    }).then(function(result){
      if(result&&!result.ok)throw new Error(result.message||'老板数据读取失败');
      bossAdminState.rows=(result.bosses||result.data||result.items||[]);
      bossAdminState.loaded=true;
      bossAdminState.error='';
      renderBossTableRows();
    }).catch(function(err){
      bossAdminState.rows=[];
      bossAdminState.loaded=true;
      bossAdminState.error=err.message||String(err);
      renderBossTableRows();
    });
  }
  function normalizeBossAdmin(boss){
    boss=boss||{};
    var internalId=bossValue(boss,['id','user_id','userId'],'');
    var bossUid=bossValue(boss,['boss_uid','bossUid','publicUid','public_uid'],'');
    // Prefer sequential public UID; never show raw UUID as the main UID when boss_uid exists.
    var uid=bossUid&&!/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(bossUid))?bossUid:bossValue(boss,['uid','systemUid','system_uid'],bossUid||internalId||'-');
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(uid))&&bossUid)uid=bossUid;
    var bossId=bossUid||bossValue(boss,['bossId','boss_id','publicId','public_id'],'未设置');
    var name=bossValue(boss,['nickname','name','displayName'],'-');
    var status=bossValue(boss,['accountStatus','account_status','status'],'正常');
    var registered=bossValue(boss,['registered_at','registeredAt','created_at','createdAt'],'-');
    var lastLogin=bossValue(boss,['lastLoginAt','last_login_at','lastLogin','last_login'],'-');
    var search=[uid,bossId,internalId,name,boss.phone,boss.email,status,boss.vip,boss.vipLevel].join(' ').toLowerCase();
    return {raw:boss,id:internalId||uid,internalId:internalId||'',uid:uid,bossUid:bossUid||uid,bossId:bossId,name:name,phone:bossValue(boss,['phone','mobile'],'-'),email:bossValue(boss,['email'],'-'),avatar:boss.avatar||boss.avatar_url||'assets/meow-cuijiao-brand.jpg',vip:bossValue(boss,['vip','vipLevel'],'VIP0'),balance:bossValue(boss,['balance','walletBalance','wallet_balance'],'0猫粮'),paidBalance:bossValue(boss,['paidBalance','paid_balance'],'0'),bonusBalance:bossValue(boss,['bonusBalance','bonus_balance'],'0'),totalRecharge:bossValue(boss,['totalRecharge','total_recharge','rechargeTotal'],'RM0'),totalSpent:bossValue(boss,['total_spent','totalSpent','totalConsume','total_consume'],'0猫粮'),totalCompensation:bossValue(boss,['totalCompensation','total_compensation'],'0'),totalOrders:bossValue(boss,['totalOrders','total_orders','orderCount'],'0'),refundAmount:bossValue(boss,['refundAmount','refund_amount','totalRefund'],'RM0'),registered:registered,lastLogin:lastLogin,status:status,remark:bossValue(boss,['remark','note','adminRemark'],''),search:search};
  }
  function visibleBossRows(){
    var keyword=((document.querySelector('[data-boss-search]')||{}).value||'').trim().toLowerCase();
    var filters={};document.querySelectorAll('[data-boss-filter]').forEach(function(input){filters[input.dataset.bossFilter]=input.value||'';});
    return (bossAdminState.rows||[]).map(normalizeBossAdmin).filter(function(item){
      var ok=!keyword||item.search.indexOf(keyword)>-1;
      if(ok&&filters.vip)ok=item.vip===filters.vip;
      if(ok&&filters.status)ok=item.status.indexOf(filters.status)>-1;
      if(ok&&filters.registered)ok=String(item.registered).indexOf(filters.registered)>-1;
      return ok;
    });
  }
  function bossCell(label,value,extra){return '<td data-label="'+esc(label)+'" title="'+esc(value)+'" '+(extra||'')+'>'+value+'</td>'}
  function renderBossTableRows(){
    closeBossMoreMenu();
    var box=document.getElementById('bossManagementTable');if(!box)return;
    var rows=visibleBossRows();
    var count=document.querySelector('[data-boss-count]');if(count)count.textContent=rows.length+' 条';
    var total=rows.length;
    var pages=Math.max(1,Math.ceil(total/bossAdminState.pageSize));
    bossAdminState.page=Math.min(Math.max(1,bossAdminState.page),pages);
    var start=(bossAdminState.page-1)*bossAdminState.pageSize;
    var pageRows=rows.slice(start,start+bossAdminState.pageSize);
    var headers=['UID','头像','昵称','VIP','余额','累计充值','累计消费','订单数量','状态','操作'];
    var body=pageRows.map(function(item){return '<tr class="boss-list-row" data-boss-open="'+esc(item.id)+'">'+
      '<td data-label="UID" title="'+esc(item.uid)+'"><button class="boss-id-link" type="button" data-boss-action="view" data-boss-id="'+esc(item.id)+'">'+esc(item.uid)+'</button></td>'+ 
      '<td data-label="头像"><img class="boss-avatar" src="'+esc(item.avatar)+'" alt=""></td>'+ 
      '<td data-label="昵称" title="'+esc(item.name)+'"><button class="boss-name-link" type="button" data-boss-action="view" data-boss-id="'+esc(item.id)+'">'+esc(item.name)+'</button></td>'+ 
      bossCell('VIP',esc(item.vip))+bossCell('余额',esc(item.balance))+bossCell('累计充值',esc(item.totalRecharge))+bossCell('累计消费',esc(item.totalSpent))+bossCell('订单数量',esc(item.totalOrders))+
      '<td data-label="状态">'+statusChip(item.status)+'</td>'+ 
      '<td data-label="操作" class="boss-action-cell"><button class="mini-btn" type="button" data-boss-action="view" data-boss-id="'+esc(item.id)+'">查看</button></td>'+ 
    '</tr>';}).join('');
    if(!body)body='<tr><td colspan="'+headers.length+'"><div class="boss-table-empty"><strong>'+(bossAdminState.error?'老板数据读取失败':'暂无老板数据')+'</strong>'+(bossAdminState.error?'<span>'+esc(bossAdminState.error)+'</span>':'')+'</div></td></tr>';
    box.innerHTML='<div class="table-wrap boss-table-wrap"><table class="boss-data-table"><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>'}).join('')+'</tr></thead><tbody>'+body+'</tbody></table></div><div class="boss-pagination compact"><span>共 '+total+' 条 · 第 '+bossAdminState.page+' / '+pages+' 页</span><div><select data-boss-page-size><option value="20" '+(bossAdminState.pageSize===20?'selected':'')+'>20 条/页</option><option value="50" '+(bossAdminState.pageSize===50?'selected':'')+'>50 条/页</option><option value="100" '+(bossAdminState.pageSize===100?'selected':'')+'>100 条/页</option></select><button class="mini-btn" type="button" data-boss-page="prev" '+(bossAdminState.page<=1?'disabled':'')+'>上一页</button><input data-boss-page-jump value="'+bossAdminState.page+'" inputmode="numeric" aria-label="页码"><button class="mini-btn" type="button" data-boss-page-go>跳转</button><button class="mini-btn" type="button" data-boss-page="next" '+(bossAdminState.page>=pages?'disabled':'')+'>下一页</button></div></div>'+(bossAdminState.error?'<div class="admin-sync-note">老板接口读取失败：'+esc(bossAdminState.error)+'。当前页面没有使用本地假数据。</div>':'');
    updateBossBulkState();
  }
  function filterBossManagement(){bossAdminState.page=1;renderBossTableRows();}
  function selectedBossIds(){return [].slice.call(document.querySelectorAll('[data-boss-check]:checked')).map(function(input){return input.dataset.bossCheck})}
  function updateBossBulkState(){var btn=document.querySelector('[data-boss-bulk-toggle]');if(btn)btn.disabled=!selectedBossIds().length;}
  function exportBossRows(rows){
    rows=rows||visibleBossRows();
    var headers=['UID','昵称','VIP','余额','累计充值','累计消费','订单数量','状态'];
    var lines=[headers].concat(rows.map(function(item){return [item.uid,item.name,item.vip,item.balance,item.totalRecharge,item.totalSpent,item.totalOrders,item.status]}));
    var csv=lines.map(function(line){return line.map(function(cell){return '"'+String(cell==null?'':cell).replace(/"/g,'""')+'"'}).join(',')}).join('\n');
    var blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='bosses.csv';a.click();URL.revokeObjectURL(url);
  }
  function emptyRowsTable(headers){return '<div class="boss-record-empty">暂无数据</div>'}
  function bossRecordTable(headers,rowsHtml){
    return '<div class="table-wrap boss-detail-table"><table><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>'}).join('')+'</tr></thead><tbody>'+(rowsHtml||'<tr><td colspan="'+headers.length+'"><div class="boss-record-empty">暂无数据</div></td></tr>')+'</tbody></table></div>';
  }
  function bossTabKey(focus){
    var map={view:'profile',profile:'profile',orders:'orders',recharge:'recharge',consume:'consume',refunds:'refunds',chat:'chat',coupon:'coupon',vip:'vip',invite:'invite',login:'login',ban:'ban',freeze:'ban',blacklist:'ban',remark:'profile'};
    return map[focus]||'profile';
  }
  function openBossDetail(bossId,focus){
    closeAdminModal();
    var boss=(bossAdminState.rows||[]).find(function(item){
      return String(item.id)===String(bossId)
        || String(item.uid||item.boss_uid||item.bossUid||'')===String(bossId)
        || String(item.systemUid||'')===String(bossId);
    });
    var modal=document.getElementById('adminModal'),body=document.getElementById('modalBody');
    if(!modal||!body)return;
    var item=normalizeBossAdmin(boss||{id:bossId,uid:bossId});
    var activeTab=bossTabKey(focus);
    bossAdminState.activeBossId=String(item.id||item.uid||'');
    bossAdminState.activeBossTab=activeTab;
    var tabs=[
      ['profile','基本资料'],
      ['orders','订单记录'],
      ['recharge','充值记录'],
      ['consume','消费记录'],
      ['refunds','退款记录'],
      ['chat','客服聊天记录'],
      ['coupon','优惠券'],
      ['vip','VIP'],
      ['invite','邀请记录'],
      ['login','登录记录'],
      ['ban','封禁账号']
    ];
    body.innerHTML='<div class="boss-detail-modern" data-boss-detail="'+esc(item.id)+'">'+
      '<div class="boss-detail-hero"><img class="boss-avatar" src="'+esc(item.avatar)+'" alt=""><div><h2>'+esc(item.name)+'</h2><p>'+esc(item.uid)+' · '+esc(item.phone)+' · '+esc(item.email)+'</p></div>'+statusChip(item.status)+'</div>'+
      '<div class="boss-detail-tabs compact" role="tablist">'+tabs.map(function(t){return '<button type="button" class="boss-detail-tab'+(t[0]===activeTab?' active':'')+'" data-boss-tab="'+t[0]+'" data-boss-id="'+esc(item.id)+'">'+t[1]+'</button>'}).join('')+'</div>'+
      '<div class="boss-detail-panels">'+
        '<section class="boss-detail-panel'+(activeTab==='profile'?' active':'')+'" data-boss-panel="profile">'+
          '<div class="boss-detail-grid"><section><h3>基本资料</h3><div class="detail-list" data-boss-profile-list>'+
            '<div><span>昵称</span><strong>'+esc(item.name)+'</strong></div>'+
            '<div><span>老板 UID</span><strong>'+esc(item.uid)+'</strong></div>'+
            '<div><span>手机号</span><strong>'+esc(item.phone)+'</strong></div>'+
            '<div><span>邮箱</span><strong>'+esc(item.email)+'</strong></div>'+
            '<div><span>邮箱验证状态</span><strong data-boss-email-verified>'+esc(item.emailVerifiedLabel||item.email_verified_label||((item.emailVerified===false||item.email_verified===false)?'❌ 未验证':'✅ 已验证'))+'</strong></div>'+
            '<div><span>注册时间</span><strong>'+esc(item.registered)+'</strong></div>'+
            '<div><span>最后登录</span><strong data-boss-last-login>'+esc(item.lastLogin)+'</strong></div>'+
            '<div><span>是否已设置密码</span><strong data-boss-has-password>'+esc(item.hasPassword?'是':'否')+'</strong></div>'+
            '<div><span>最近密码重置</span><strong data-boss-password-set>'+esc(item.passwordSetAt||'-')+'</strong></div>'+
            '<div><span>账号状态</span><strong data-boss-status-text>'+esc(item.status)+'</strong></div>'+
            '<div><span>VIP</span><strong data-boss-vip-text>'+esc(item.vip)+'</strong></div>'+
            '<div><span>备注</span><strong data-boss-remark-text>'+esc(item.remark||'-')+'</strong></div>'+
          '</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="mini-btn" type="button" data-boss-action="remark" data-boss-id="'+esc(item.id)+'">编辑备注</button><button class="mini-btn" type="button" data-boss-action="send_password_reset" data-boss-id="'+esc(item.id)+'">发送密码重置邮件</button><button class="mini-btn" type="button" data-boss-action="force_change_password" data-boss-id="'+esc(item.id)+'">强制下次改密</button><button class="mini-btn" type="button" data-boss-action="revoke_sessions" data-boss-id="'+esc(item.id)+'">注销全部会话</button><button class="mini-btn" type="button" data-boss-action="unbind" data-boss-id="'+esc(item.id)+'">解绑手机</button></div></section>'+
          '<section><h3>资金信息</h3><div class="detail-list" data-boss-wallet-list>'+
            '<div><span>总猫粮</span><strong>'+esc(item.balance)+'</strong></div>'+
            '<div><span>充值猫粮</span><strong>'+esc(item.paidBalance)+'</strong></div>'+
            '<div><span>赠送猫粮</span><strong>'+esc(item.bonusBalance)+'</strong></div>'+
            '<div><span>累计充值 RM</span><strong>'+esc(item.totalRecharge)+'</strong></div>'+
            '<div><span>累计消费</span><strong>'+esc(item.totalSpent)+'</strong></div>'+
            '<div><span>累计补偿</span><strong>'+esc(item.totalCompensation)+'</strong></div>'+
          '</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="mini-btn primary-lite" type="button" data-boss-wallet-grant="'+esc(item.id)+'">发放猫粮</button><button class="mini-btn" type="button" data-boss-wallet-deduct="'+esc(item.id)+'">扣减猫粮</button><button class="mini-btn" type="button" data-boss-wallet-ledger="'+esc(item.id)+'">查看流水</button></div></section></div>'+
        '</section>'+
        '<section class="boss-detail-panel'+(activeTab==='orders'?' active':'')+'" data-boss-panel="orders"><h3>订单记录</h3><div data-boss-panel-body="orders"><div class="boss-record-empty">加载中...</div></div></section>'+
        '<section class="boss-detail-panel'+(activeTab==='recharge'?' active':'')+'" data-boss-panel="recharge"><h3>充值记录</h3><div data-boss-panel-body="recharge"><div class="boss-record-empty">加载中...</div></div></section>'+
        '<section class="boss-detail-panel'+(activeTab==='consume'?' active':'')+'" data-boss-panel="consume"><h3>消费记录</h3><div data-boss-panel-body="consume"><div class="boss-record-empty">加载中...</div></div></section>'+
        '<section class="boss-detail-panel'+(activeTab==='refunds'?' active':'')+'" data-boss-panel="refunds"><h3>退款记录</h3><div data-boss-panel-body="refunds"><div class="boss-record-empty">加载中...</div></div></section>'+
        '<section class="boss-detail-panel'+(activeTab==='chat'?' active':'')+'" data-boss-panel="chat"><h3>客服聊天记录</h3><div data-boss-panel-body="chat"><div class="boss-record-empty">加载中...</div></div></section>'+
        '<section class="boss-detail-panel'+(activeTab==='coupon'?' active':'')+'" data-boss-panel="coupon"><h3>优惠券使用</h3><div data-boss-panel-body="coupon"><div class="boss-record-empty">加载中...</div></div></section>'+
        '<section class="boss-detail-panel'+(activeTab==='vip'?' active':'')+'" data-boss-panel="vip"><h3>VIP等级</h3><div data-boss-panel-body="vip"><div class="boss-record-empty">加载中...</div></div></section>'+
        '<section class="boss-detail-panel'+(activeTab==='invite'?' active':'')+'" data-boss-panel="invite"><h3>邀请记录</h3><div data-boss-panel-body="invite"><div class="boss-record-empty">加载中...</div></div></section>'+
        '<section class="boss-detail-panel'+(activeTab==='login'?' active':'')+'" data-boss-panel="login"><h3>登录记录</h3><div data-boss-panel-body="login"><div class="boss-record-empty">加载中...</div></div></section>'+
        '<section class="boss-detail-panel'+(activeTab==='ban'?' active':'')+'" data-boss-panel="ban"><h3>封禁账号</h3><div data-boss-panel-body="ban">'+
          '<div class="boss-ban-card"><p>当前状态：<strong data-boss-status-text>'+esc(item.status)+'</strong></p><p class="muted">冻结会停用账号并冻结钱包；黑名单用于严重违规；解封后恢复正常。</p>'+
          '<div class="boss-ban-actions"><button class="mini-btn danger" type="button" data-boss-action="freeze" data-boss-id="'+esc(item.id)+'">冻结</button>'+
          '<button class="mini-btn danger" type="button" data-boss-action="ban" data-boss-id="'+esc(item.id)+'">封禁</button>'+
          '<button class="mini-btn danger" type="button" data-boss-action="blacklist" data-boss-id="'+esc(item.id)+'">加入黑名单</button>'+
          '<button class="mini-btn primary-lite" type="button" data-boss-action="unban" data-boss-id="'+esc(item.id)+'">解封</button></div></div>'+
        '</div></section>'+
      '</div></div>';
    openAdminModal();
    loadBossDetailData(item.id);
  }
  function switchBossDetailTab(tab){
    var detail=document.querySelector('[data-boss-detail]');
    if(!detail)return;
    bossAdminState.activeBossTab=tab;
    detail.querySelectorAll('[data-boss-tab]').forEach(function(btn){btn.classList.toggle('active',btn.dataset.bossTab===tab)});
    detail.querySelectorAll('[data-boss-panel]').forEach(function(panel){panel.classList.toggle('active',panel.dataset.bossPanel===tab)});
  }
  function fillBossDetailPanels(detail,data){
    if(!detail||!data)return;
    var boss=data.boss||{};
    var wallet=data.wallet;
    if(wallet){
      var list=detail.querySelector('[data-boss-wallet-list]');
      if(list){
        list.innerHTML='<div><span>总猫粮</span><strong>'+esc(wallet.totalBalance)+'</strong></div><div><span>充值猫粮</span><strong>'+esc(wallet.paidBalance)+'</strong></div><div><span>赠送猫粮</span><strong>'+esc(wallet.bonusBalance)+'</strong></div><div><span>累计充值 RM</span><strong>RM'+esc(Number(wallet.totalRechargeRm||0).toFixed(2))+'</strong></div><div><span>累计消费</span><strong>'+esc(wallet.totalSpent)+'</strong></div><div><span>累计补偿</span><strong>'+esc(wallet.totalCompensation)+'</strong></div>';
      }
    }
    detail.querySelectorAll('[data-boss-status-text]').forEach(function(el){el.textContent=boss.status||boss.accountStatus||'-'});
    detail.querySelectorAll('[data-boss-vip-text]').forEach(function(el){el.textContent=boss.vip||boss.vipLevel||'VIP0'});
    detail.querySelectorAll('[data-boss-remark-text]').forEach(function(el){el.textContent=boss.remark||'-'});
    var lastLogin=detail.querySelector('[data-boss-last-login]');
    if(lastLogin)lastLogin.textContent=boss.lastLoginAt||boss.last_login_at||'-';
    var hasPwdEl=detail.querySelector('[data-boss-has-password]');
    if(hasPwdEl)hasPwdEl.textContent=boss.hasPassword||boss.has_password?'是':'否';
    var emailVerEl=detail.querySelector('[data-boss-email-verified]');
    if(emailVerEl)emailVerEl.textContent=boss.emailVerifiedLabel||boss.email_verified_label||((boss.emailVerified===false||boss.email_verified===false)?'❌ 未验证':'✅ 已验证');
    var pwdSetEl=detail.querySelector('[data-boss-password-set]');
    if(pwdSetEl)pwdSetEl.textContent=boss.passwordSetAt||boss.password_set_at||'-';

    var orders=data.orders||[];
    var orderBody=detail.querySelector('[data-boss-panel-body="orders"]');
    if(orderBody)orderBody.innerHTML=bossRecordTable(['订单号','游戏','陪玩','金额','状态','下单时间'],orders.map(function(o){return '<tr><td>'+esc(o.orderNo)+'</td><td>'+esc(o.game||'-')+'</td><td>'+esc(o.companionName)+'</td><td>'+esc(moneyText(o.amount||0))+'</td><td>'+esc(o.statusText)+'</td><td>'+esc(o.createdAt||'-')+'</td></tr>'}).join(''));

    var recharges=data.recharges||[];
    var rechargeBody=detail.querySelector('[data-boss-panel-body="recharge"]');
    if(rechargeBody)rechargeBody.innerHTML=bossRecordTable(['充值单号','金额','猫粮','支付方式','状态','时间'],recharges.map(function(r){return '<tr><td>'+esc(r.paymentNo)+'</td><td>'+esc(rmText(r.amount||0))+'</td><td>'+esc(r.catFood)+(r.bonus?' (+'+esc(r.bonus)+')':'')+'</td><td>'+esc(r.method)+'</td><td>'+esc(r.status)+'</td><td>'+esc(r.createdAt||'-')+'</td></tr>'}).join(''));

    var spends=data.spends||[];
    var spendBody=detail.querySelector('[data-boss-panel-body="consume"]');
    if(spendBody)spendBody.innerHTML=bossRecordTable(['类型','扣除猫粮','余额类型','原因','时间'],spends.map(function(s){return '<tr><td>'+esc(s.typeText)+'</td><td>-'+esc(s.amount)+'</td><td>'+esc(s.balanceTypeText)+'</td><td>'+esc(s.reason)+'</td><td>'+esc(s.createdAt||'-')+'</td></tr>'}).join(''));

    var refunds=data.refunds||[];
    var refundBody=detail.querySelector('[data-boss-panel-body="refunds"]');
    if(refundBody)refundBody.innerHTML=bossRecordTable(['订单号','金额','状态','说明','时间'],refunds.map(function(o){return '<tr><td>'+esc(o.orderNo)+'</td><td>'+esc(moneyText(o.amount||0))+'</td><td>'+esc(o.statusText)+'</td><td>'+esc(o.description||'-')+'</td><td>'+esc(o.createdAt||'-')+'</td></tr>'}).join(''));

    var chats=data.chats||[];
    var chatBody=detail.querySelector('[data-boss-panel-body="chat"]');
    if(chatBody)chatBody.innerHTML=bossRecordTable(['会话编号','客服','最后消息','状态','时间'],chats.map(function(c){return '<tr><td>'+esc(c.id)+'</td><td>'+esc(c.serviceName)+'</td><td title="'+esc(c.lastMessage)+'">'+esc(c.lastMessage)+'</td><td>'+esc(c.status)+'</td><td>'+esc(c.updatedAt||'-')+'</td></tr>'}).join(''));

    var coupons=data.coupons||[];
    var couponBody=detail.querySelector('[data-boss-panel-body="coupon"]');
    if(couponBody)couponBody.innerHTML=bossRecordTable(['优惠券','优惠内容','使用订单','状态','时间'],coupons.map(function(c){return '<tr><td>'+esc(c.name)+'</td><td>'+esc(c.benefit)+'</td><td>'+esc(c.orderNo)+'</td><td>'+esc(c.status)+'</td><td>'+esc(c.usedAt||'-')+'</td></tr>'}).join(''));

    var vip=data.vip||{};
    var vipBody=detail.querySelector('[data-boss-panel-body="vip"]');
    if(vipBody){
      vipBody.innerHTML='<div class="boss-vip-card"><div class="detail-list">'+
        '<div><span>当前等级</span><strong>'+esc(vip.currentName||vip.current||'VIP0')+'</strong></div>'+
        '<div><span>累计消费</span><strong>'+esc(vip.progressSpent==null?'-':vip.progressSpent)+' 猫粮</strong></div>'+
        '<div><span>当前门槛</span><strong>'+esc(vip.threshold==null?'-':vip.threshold)+'</strong></div>'+
        '<div><span>下一等级</span><strong>'+esc(vip.nextCode||'已达最高')+(vip.nextThreshold!=null?'（需 '+esc(vip.nextThreshold)+'）':'')+'</strong></div>'+
        '<div><span>权益</span><strong>'+esc(vip.benefits||'-')+'</strong></div>'+
        '<div><span>优惠券权益</span><strong>'+esc(vip.couponBenefits||'-')+'</strong></div>'+
        '<div><span>客服优先级</span><strong>'+esc(vip.servicePriority||'-')+'</strong></div>'+
        '<div><span>说明</span><strong>'+esc(vip.description||'-')+'</strong></div>'+
      '</div></div>';
    }

    var invites=data.invites||[];
    var inviteBody=detail.querySelector('[data-boss-panel-body="invite"]');
    if(inviteBody){
      inviteBody.innerHTML=invites.length
        ? bossRecordTable(['邀请人','被邀请人','关系','返利','状态','时间'],invites.map(function(r){return '<tr><td>'+esc(r.inviter)+'</td><td>'+esc(r.invitee)+'</td><td>'+esc(r.relation)+'</td><td>'+esc(r.rebate)+'</td><td>'+esc(r.status)+'</td><td>'+esc(r.createdAt||'-')+'</td></tr>'}).join(''))
        : '<div class="boss-record-empty">暂无邀请记录</div>';
    }

    var logins=data.logins||[];
    var loginBody=detail.querySelector('[data-boss-panel-body="login"]');
    if(loginBody){
      if(logins.length){
        loginBody.innerHTML=bossRecordTable(['时间','IP','设备','结果'],logins.map(function(l){return '<tr><td>'+esc(l.createdAt||'-')+'</td><td>'+esc(l.ip)+'</td><td>'+esc(l.device)+'</td><td>'+esc(l.result)+'</td></tr>'}).join(''));
      }else{
        loginBody.innerHTML='<div class="boss-record-empty">暂无登录流水表数据'+(boss.lastLoginAt||boss.last_login_at?'，最近登录：'+esc(boss.lastLoginAt||boss.last_login_at):'')+'</div>';
      }
    }
  }
  function loadBossDetailData(bossId){
    adminFetch('/api/admin/bosses?id='+encodeURIComponent(bossId),{headers:{'x-mcj-admin-role':getRole(),Accept:'application/json'}}).then(function(res){return res.json().catch(function(){return {}})}).then(function(result){
      var detail=document.querySelector('[data-boss-detail="'+String(bossId).replace(/"/g,'')+'"]');
      if(!detail)return;
      if(!result||!result.ok){
        ['orders','recharge','consume','refunds','chat','coupon','vip','invite','login'].forEach(function(key){
          var box=detail.querySelector('[data-boss-panel-body="'+key+'"]');
          if(box)box.innerHTML='<div class="boss-record-empty">'+(result&&result.message?esc(result.message):'详情加载失败')+'</div>';
        });
        return;
      }
      fillBossDetailPanels(detail,result);
    }).catch(function(err){
      var detail=document.querySelector('[data-boss-detail="'+String(bossId).replace(/"/g,'')+'"]');
      if(!detail)return;
      ['orders','recharge','consume','refunds','chat','coupon','vip','login'].forEach(function(key){
        var box=detail.querySelector('[data-boss-panel-body="'+key+'"]');
        if(box)box.innerHTML='<div class="boss-record-empty">'+esc(err.message||'详情加载失败')+'</div>';
      });
    });
  }
  function loadBossWalletIntoDetail(bossId){
    loadBossDetailData(bossId);
  }
  function submitBossWalletAction(action,bossId){
    if(action==='ledger'){switchBossDetailTab('consume');loadBossDetailData(bossId);return;}
    var amount=prompt(action==='grant'?'发放数量（猫粮）':'扣减数量（猫粮）','');
    if(amount==null)return;
    var n=Number(amount);
    if(!(n>0)){alert('数量必须大于 0');return;}
    var reason=prompt('请填写原因（必填）','');
    if(!reason||!String(reason).trim()){alert('必须填写原因');return;}
    if(!confirm('确认对老板执行'+(action==='grant'?'发放':'扣减')+' '+n+' 猫粮？'))return;
    var payload={action:action==='grant'?'grant':'deduct',bossId:bossId,amount:n,reason:String(reason).trim(),grantType:action==='grant'?'manual':'',balanceType:'bonus',notifyBoss:true};
    if(action==='grant'){
      var grantType=prompt('发放类型：after_sale / bad_review / activity / invite / manual / other','bad_review')||'manual';
      payload.grantType=grantType;
      if(grantType==='bad_review')payload.balanceType='bonus';
    }
    adminFetch('/api/admin/wallet',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify(payload)}).then(function(res){return res.json().catch(function(){return {ok:false,message:'钱包接口异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'操作失败');alert(result.message||'已完成');loadBossDetailData(bossId);loadBossAdminRows();}).catch(function(err){alert(err.message||'操作失败');});
  }
  function submitBossSecure(action,id,payload){
    adminFetch('/api/admin/bosses',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,id:id,payload:payload||{}})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'老板管理接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'保存失败');alert(result.message||'已提交到真实数据库');loadBossAdminRows();if(document.querySelector('[data-boss-detail="'+String(id).replace(/"/g,'')+'"]'))loadBossDetailData(id);}).catch(function(err){alert('保存失败：'+err.message+'。未写入本地假数据。');});
  }
  var orderState={orders:[],summary:null,loaded:false,error:''};
  var orderTypes=['普通陪玩订单','更多玩法固定单','自定义订单','护航订单','跑刀订单','代肝订单','趣味订单','客服创建订单'];
  var orderStatuses=['待付款','等待陪玩确认','待开始','进行中','待老板确认','已完成','售后','退款','已取消'];
  var paymentStatuses=['未支付','支付中','已支付','支付失败','部分退款','已退款'];
  var orderSources=['平台直营','合作俱乐部','推广渠道','客服创建','老板自助下单'];
  function orderValue(order,keys,fallback){
    for(var i=0;i<keys.length;i++){var value=order&&order[keys[i]];if(value!==undefined&&value!==null&&value!=='')return value;}
    return fallback||'-';
  }
  function moneyNumber(value){
    var n=Number(String(value==null?'':value).replace(/[^\d.-]/g,''));
    return Number.isFinite(n)?n:0;
  }
  function moneyText(value){
    if(window.MCJCurrency)return window.MCJCurrency.formatAmount(value);
    return '🐱 '+moneyNumber(value).toFixed(2).replace(/\.00$/,'')+' 猫粮';
  }
  function rmText(value){return 'RM'+moneyNumber(value).toFixed(2)}
  function orderPaymentAmount(order){return moneyNumber(orderValue(order,['actualPaidAmount','actual_paid_amount','paidAmount','paid_amount','amount'],0))}
  function orderPlayerIncome(order){var explicit=orderValue(order,['playerIncome','player_income'],'');if(explicit!=='')return moneyNumber(explicit);var commission=Number(String(orderValue(order,['playerCommissionRate','player_commission_rate'],'80')).replace(/[^\d.]/g,''));return orderPaymentAmount(order)*(Number.isFinite(commission)?commission:80)/100}
  function orderPlatformProfit(order){var explicit=orderValue(order,['platformProfit','platform_profit'],'');if(explicit!=='')return moneyNumber(explicit);return Math.max(0,orderPaymentAmount(order)-orderPlayerIncome(order)-moneyNumber(orderValue(order,['directRebate','direct_rebate'],0))-moneyNumber(orderValue(order,['refundAmount','refund_amount'],0)))}
  function orderStatusChip(text){var t=String(text||'');var cls=/完成|已支付|平台直营|老板自助/.test(t)?'ok':/退款|售后|待|支付中|接单|确认|开始/.test(t)?'wait':/取消|异常|失败/.test(t)?'bad':'info';return '<span class="status '+cls+'">'+esc(t||'-')+'</span>'}
  function normalizeOrder(order){
    order=order||{};
    var statusText=orderValue(order,['orderStatus','order_status','statusText','status_text'],'');
    var rawStatus=orderValue(order,['status'],'');
    var STATUS_CN={awaiting_payment:'待付款',pending:'等待陪玩抢单',claimed:'等待陪玩确认',waiting_boss_confirm:'等待老板选择',confirmed:'进行中',in_progress:'进行中',completed:'已完成',cancelled:'已取消',refund_requested:'售后',refunded:'已退款',after_sale:'售后',reviewed:'已评价'};
    if(!statusText||STATUS_CN[statusText])statusText=STATUS_CN[rawStatus]||STATUS_CN[statusText]||statusText||rawStatus||'待付款';
    return Object.assign({},order,{
      id:orderValue(order,['orderNo','order_no','id'],'-'),
      type:orderValue(order,['orderType','order_type','type'],'普通陪玩订单'),
      bossName:orderValue(order,['bossName','boss_name','boss'],'-'),
      bossUid:orderValue(order,['bossUid','boss_uid','customerUid','customer_uid'],'-'),
      bossId:orderValue(order,['bossId','boss_id'],'-'),
      playerName:orderValue(order,['playerName','player_name','companionName','companion_name','player'],'待分配'),
      playerUid:orderValue(order,['playerUid','player_uid'],'-'),
      game:orderValue(order,['game'],'-'),
      serviceContent:orderValue(order,['serviceContent','service_content','service','gameplay'],'-'),
      serviceStaff:orderValue(order,['serviceStaff','currentService','current_service','support','customerService','serviceName'],'-'),
      amount:orderPaymentAmount(order)||moneyNumber(orderValue(order,['totalAmount','total_amount','amount'],0)),
      playerIncome:orderPlayerIncome(order),
      platformProfit:orderPlatformProfit(order),
      paymentStatus:orderValue(order,['paymentStatus','payment_status'],'未支付'),
      orderStatus:statusText,
      createdAt:orderValue(order,['createdAt','created_at','time'],'-'),
      serviceTime:orderValue(order,['serviceTime','service_time','appointmentTime','appointment_time'],'-'),
      source:orderValue(order,['orderSource','order_source','source'],'平台直营')
    });
  }
  function renderOrderManagement(){
    // Prefer admin-final-v1 order table to avoid dual-render races on #orderManagement.
    if(document.querySelector('script[src*="admin-final-v1"]'))return;
    var target=document.getElementById('orderManagement');
    if(!target)return;
    target.innerHTML='<div class="content-loading">正在读取真实订单数据库...</div>';
    adminFetch('/api/admin/orders',{headers:adminApiHeaders()}).then(function(res){var ct=res.headers.get('content-type')||'';if(ct.indexOf('application/json')<0)return {ok:true,configured:false,orders:[],summary:null,message:'本地静态预览未启用订单接口'};return res.json();}).then(function(result){
      if(!result.ok)throw new Error(result.message||'订单读取失败');
      orderState.orders=(result.orders||[]).map(normalizeOrder);
      orderState.summary=result.summary||null;
      orderState.loaded=true;
      target.innerHTML=orderManagementHtml(orderState.orders,orderState.summary,result.configured);
    }).catch(function(err){
      orderState.orders=[];
      orderState.error=err.message||String(err);
      target.innerHTML=orderManagementHtml([],null,false)+'<div class="admin-sync-note">读取失败：'+esc(orderState.error)+'。未读取 localStorage 假订单。</div>';
    });
  }
  function orderSummary(orders,apiSummary){
    if(apiSummary)return apiSummary;
    return {
      total:orders.length,
      todayOrders:0,
      pendingPayment:orders.filter(function(x){return x.orderStatus==='待支付'}).length,
      pendingAccept:orders.filter(function(x){return x.orderStatus==='待接单'}).length,
      inProgress:orders.filter(function(x){return x.orderStatus==='进行中'}).length,
      completed:orders.filter(function(x){return x.orderStatus==='已完成'}).length,
      afterSale:orders.filter(function(x){return /售后/.test(x.orderStatus)}).length,
      revenue:orders.reduce(function(n,x){return n+x.amount},0),
      profit:orders.reduce(function(n,x){return n+x.platformProfit},0)
    };
  }
  function orderManagementHtml(orders,summary,configured){
    var s=orderSummary(orders,summary);
    var metric=[['今日订单',s.todayOrders||0],['待支付',s.pendingPayment||0],['待接单',s.pendingAccept||0],['进行中',s.inProgress||0],['已完成',s.completed||0],['售后处理中',s.afterSale||0],['今日营业额',moneyText(s.revenue||0)],['平台利润',moneyText(s.profit||0)]];
    var statusTabs=['全部','待接单','待确认','进行中','已完成','已取消','退款中','已退款','售后中'];
    var rows=orders.map(function(o){return '<tr data-order-row data-order-status="'+esc(o.orderStatus)+'" data-order-type="'+esc(o.type)+'" data-payment-status="'+esc(o.paymentStatus)+'" data-game="'+esc(o.game)+'" data-service="'+esc(o.serviceStaff)+'" data-player="'+esc(o.playerName+' '+o.playerUid)+'" data-source="'+esc(o.source)+'" data-amount="'+esc(o.amount)+'" data-created-at="'+esc(o.createdAt)+'" data-search="'+esc([o.id,o.type,o.bossName,o.bossUid,o.bossId,o.playerName,o.playerUid,o.serviceStaff,o.game,o.paymentOrderNo].join(' '))+'">'+
      '<td><strong>'+esc(o.id)+'</strong></td><td>'+orderStatusChip(o.type)+'</td><td>'+esc(o.bossName)+'</td><td>'+esc(o.bossUid)+'</td><td>'+esc(o.playerName)+'</td><td>'+esc(o.playerUid)+'</td><td>'+esc(o.game)+'</td><td>'+esc(o.serviceContent)+'</td><td>'+esc(o.serviceStaff)+'</td><td>'+moneyText(o.amount)+'</td><td>'+moneyText(o.playerIncome)+'</td><td>'+moneyText(o.platformProfit)+'</td><td>'+orderStatusChip(o.paymentStatus)+'</td><td>'+orderStatusChip(o.orderStatus)+'</td><td>'+esc(o.createdAt)+'</td><td>'+esc(o.serviceTime)+'</td><td><div class="order-row-actions">'+orderActions(o).map(function(a){return '<button class="mini-btn '+(a.danger?'danger-btn':'')+'" data-order-action="'+esc(a.key)+'" data-order-id="'+esc(o.id)+'" type="button">'+esc(a.label)+'</button>'}).join('')+'</div></td></tr>'}).join('');
    return '<div class="order-admin">'+
      '<div class="order-metrics">'+metric.map(function(item){return '<div><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>'}).join('')+'</div>'+
      '<div class="order-status-tabs">'+statusTabs.map(function(x,i){return '<button class="mini-btn '+(i===0?'active':'')+'" type="button" data-order-status-tab="'+esc(x)+'">'+esc(x)+'</button>'}).join('')+'</div>'+
      '<div class="order-toolbar"><input data-order-search placeholder="搜索订单号 / 老板 / 陪玩 / UID"><input type="date" data-order-filter="dateStart"><input type="date" data-order-filter="dateEnd"><select data-order-filter="type"><option value="">全部订单类型</option>'+orderTypes.map(function(x){return '<option>'+esc(x)+'</option>'}).join('')+'</select><select data-order-filter="orderStatus"><option value="">全部订单状态</option>'+orderStatuses.map(function(x){return '<option>'+esc(x)+'</option>'}).join('')+'</select><select data-order-filter="paymentStatus"><option value="">全部支付状态</option>'+paymentStatuses.map(function(x){return '<option>'+esc(x)+'</option>'}).join('')+'</select><input data-order-filter="game" placeholder="游戏"><input data-order-filter="service" placeholder="客服"><input data-order-filter="player" placeholder="陪玩"><input data-order-filter="amount" placeholder="金额范围，如 20-100"><select data-order-filter="afterSale"><option value="">是否售后</option><option>是</option><option>否</option></select><select data-order-filter="refund"><option value="">是否退款</option><option>是</option><option>否</option></select><select data-order-filter="source"><option value="">订单来源</option>'+orderSources.map(function(x){return '<option>'+esc(x)+'</option>'}).join('')+'</select><button class="btn" data-order-export type="button">导出</button><button class="btn primary" data-order-create-service type="button">客服创建订单</button></div>'+
      '<div id="orderManagementTable">'+table(['订单号','订单类型','老板昵称','老板 UID','陪玩昵称','陪玩 UID','游戏','服务内容','客服','下单金额','陪玩收入','平台利润','支付状态','订单状态','创建时间','服务时间','操作'],rows)+'</div>'+
      (!orders.length?'<div class="order-empty"><strong>暂无订单</strong><span>真实数据库没有订单时不生成虚假订单。开发环境可接入“创建测试订单”，正式环境禁用。</span><button class="btn" data-order-dev-test type="button">创建测试订单（仅开发环境）</button><button class="btn primary" data-order-create-service type="button">客服创建订单</button></div>':'')+
      '<div class="table-footer"><span>总订单数：'+esc(s.total||orders.length)+'</span><span>每页 20 条 · 第 1 / 1 页</span></div>'+
      '<div class="admin-sync-note">默认不显示“俱乐部”。订单来源统一为平台直营、合作俱乐部、推广渠道、客服创建、老板自助下单；只有多俱乐部模式启用且管理员主动显示时才展示来源俱乐部名称。</div>'+
    '</div>';
  }
  function orderActions(order){
    var map={
      '待支付':[['view-payment','查看支付'],['cancel','取消订单',true]],
      '待接单':[['assign-player','指派陪玩'],['cancel','取消订单',true],['push-hall','发送到抢单大厅']],
      '待老板确认陪玩':[['change-player','更换陪玩'],['resend-player-card','重新发送陪玩卡片'],['cancel','取消订单',true]],
      '待开始':[['confirm-start','确认开始'],['delay-start','延迟开始'],['change-player','更换陪玩']],
      '进行中':[['timer','查看计时'],['early-end','提前结束',true],['extend','延长服务'],['after-sale','发起售后']],
      '待确认完成':[['confirm-complete','确认完成'],['return-service','退回继续服务'],['after-sale','发起售后']],
      '已完成':[['review','查看评价'],['settlement','查看结算'],['after-sale','发起售后']],
      '售后处理中':[['after-sale-view','查看售后'],['refund-approve','确认退款猫粮',true],['refund-reject','拒绝退款',true],['partial-refund','部分退款猫粮',true],['change-player','更换陪玩'],['compensate','补偿余额',true]]
    };
    var base=[['view','查看'],['remark','编辑备注'],['chat','查看聊天'],['payment','查看支付'],['settlement','查看结算'],['assign-service','分配客服']];
    return base.concat(map[order.orderStatus]||[['cancel','取消订单',true]]).map(function(x){return {key:x[0],label:x[1],danger:!!x[2]}});
  }
  function openOrderDetail(orderId){
    adminFetch('/api/admin/orders?id='+encodeURIComponent(orderId),{headers:{'x-mcj-admin-role':getRole(),Accept:'application/json'}}).then(function(res){var ct=res.headers.get('content-type')||'';if(ct.indexOf('application/json')<0)return {ok:true,order:orderState.orders.find(function(x){return x.id===orderId})};return res.json();}).then(function(result){if(!result.ok)throw new Error(result.message||'读取详情失败');var ord=normalizeOrder(result.order||orderState.orders.find(function(x){return x.id===orderId})||{});if(result.reviews)ord.reviews=result.reviews;if(result.order&&result.order.review)ord.review=result.order.review;if(result.order&&result.order.reviewRating!=null)ord.reviewRating=result.order.reviewRating;if(result.order&&result.order.reviewContent!=null)ord.reviewContent=result.order.reviewContent;if(result.order&&result.order.reviewed!=null)ord.reviewed=result.order.reviewed;renderOrderDetail(ord);}).catch(function(err){alert('读取订单详情失败：'+err.message);});
  }
  function renderOrderDetail(order){
    var modal=document.getElementById('adminModal'),body=document.getElementById('modalBody');if(!modal||!body)return;
    var tabs=['订单概况','老板资料','陪玩资料','服务内容','支付与结算','聊天记录','时间记录','售后与退款','操作日志'];
    var review=order.review||(Array.isArray(order.reviews)&&order.reviews[0])||null;
    var reviewRating=order.reviewRating!=null?order.reviewRating:(review&&review.rating);
    var reviewContent=order.reviewContent||(review&&review.content)||'';
    var reviewLine=order.reviewed||review
      ?('评分 '+(reviewRating!=null&&reviewRating!==''?reviewRating+' 星':'已评价')+' · '+(reviewContent||'无文字评价'))
      :'暂无评价';
    var detail=[
      ['订单号',order.id],['订单类型',order.type],['当前状态',order.orderStatus],['支付状态',order.paymentStatus],['游戏',order.game],['区服',orderValue(order,['server','region'],'-')],['游戏 ID',orderValue(order,['gameId','game_id'],'-')],['服务项目',order.serviceContent],['服务时长',orderValue(order,['duration','serviceDuration'],'-')],['预约时间',order.serviceTime],['实际开始时间',orderValue(order,['startedAt','started_at'],'-')],['实际结束时间',orderValue(order,['endedAt','ended_at'],'-')],['创建时间',order.createdAt],['订单来源',order.source],['负责客服',order.serviceStaff],
      ['老板昵称',order.bossName],['老板 UID',order.bossUid],
      ['订单评价',reviewLine],
      ['老板支付金额',moneyText(orderValue(order,['originalAmount','original_amount','amount'],order.amount))],['优惠金额',moneyText(orderValue(order,['discountAmount','discount_amount'],0))],['实际支付金额',moneyText(order.amount)],['陪玩佣金比例',orderValue(order,['playerCommissionRate','player_commission_rate'],'-')],['陪玩应得收入',moneyText(order.playerIncome)],['平台抽成',moneyText(orderValue(order,['platformFee','platform_fee'],order.amount-order.playerIncome))],['直属返点',moneyText(orderValue(order,['directRebate','direct_rebate'],0))],['退款金额',moneyText(orderValue(order,['refundAmount','refund_amount'],0))],['最终平台利润',moneyText(order.platformProfit)],['结算状态',orderValue(order,['settlementStatus','settlement_status'],'待结算')]
    ];
    var timing='<div class="order-timer"><div><span>计划时长</span><strong>'+esc(orderValue(order,['duration','serviceDuration'],'-'))+'</strong></div><div><span>已进行时间</span><strong>'+esc(orderValue(order,['elapsed','elapsedTime'],'-'))+'</strong></div><div><span>剩余时间</span><strong>'+esc(orderValue(order,['remaining','remainingTime'],'-'))+'</strong></div><div><span>预计结束时间</span><strong>'+esc(orderValue(order,['expectedEndAt','expected_end_at'],'-'))+'</strong></div></div>';
    body.innerHTML='<h2>订单详情</h2><p class="muted">'+esc(order.id)+' · '+esc(order.type)+' · '+esc(order.orderStatus)+'</p><div class="order-detail-tabs">'+tabs.map(function(tab){return '<span>'+esc(tab)+'</span>'}).join('')+'</div>'+timing+'<div class="detail-list">'+detail.map(function(item){return '<div><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>'}).join('')+'</div><div class="admin-sync-note">聊天记录、售后记录、支付流水和操作日志均应通过订单 ID 关联统一数据库；当前详情页不会生成模拟上下文。</div>';
    openAdminModal();
  }
  function submitOrderAction(action,id,payload){
    adminFetch('/api/admin/orders',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,id:id,payload:payload||{}})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'订单接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'操作失败');alert(result.message||'已提交到真实订单数据库');renderOrderManagement();}).catch(function(err){alert('操作失败：'+err.message+'。未写入 localStorage 假订单。');});
  }
  function filterOrders(){
    var keyword=(document.querySelector('[data-order-search]')||{}).value||'';
    keyword=keyword.trim().toLowerCase();
    var activeTab=document.querySelector('[data-order-status-tab].active');
    var tab=activeTab?activeTab.dataset.orderStatusTab:'全部';
    var filters={};
    document.querySelectorAll('[data-order-filter]').forEach(function(input){filters[input.dataset.orderFilter]=(input.value||'').trim().toLowerCase();});
    function statusMatched(status,label){
      if(!label||label==='全部')return true;
      if(label==='待确认')return /确认/.test(status);
      if(label==='退款中')return /退款中|退款处理/.test(status);
      if(label==='售后中')return /售后/.test(status);
      return status.indexOf(label)>-1;
    }
    document.querySelectorAll('[data-order-row]').forEach(function(row){
      var text=(row.dataset.search||'').toLowerCase();
      var status=row.dataset.orderStatus||'';
      var amount=Number(String(row.dataset.amount||'').replace(/[^\d.-]/g,''))||0;
      var amountOk=true;
      if(filters.amount){var parts=filters.amount.split('-');var min=Number(parts[0])||0;var max=Number(parts[1])||Infinity;amountOk=amount>=min&&amount<=max;}
      var matchedKeyword=!keyword||text.indexOf(keyword)>-1;
      var matchedTab=statusMatched(status,tab);
      var matchedFilters=(!filters.type||String(row.dataset.orderType||'').toLowerCase()===filters.type)&&
        (!filters.orderStatus||String(status).toLowerCase()===filters.orderStatus)&&
        (!filters.paymentStatus||String(row.dataset.paymentStatus||'').toLowerCase()===filters.paymentStatus)&&
        (!filters.game||String(row.dataset.game||'').toLowerCase().indexOf(filters.game)>-1)&&
        (!filters.service||String(row.dataset.service||'').toLowerCase().indexOf(filters.service)>-1)&&
        (!filters.player||String(row.dataset.player||'').toLowerCase().indexOf(filters.player)>-1)&&
        (!filters.source||String(row.dataset.source||'').toLowerCase()===filters.source)&&
        (!filters.afterSale||((filters.afterSale==='是')===/售后/.test(status)))&&
        (!filters.refund||((filters.refund==='是')===/退款/.test(status)))&&amountOk;
      row.style.display=matchedKeyword&&matchedTab&&matchedFilters?'':'none';
    });
  }
  var playerAdminState={page:1,pageSize:20,rows:[],loaded:false,error:'',configured:true};
  function renderPlayerManagement(){
    var target=document.getElementById('playerManagement');
    if(!target)return;
    target.innerHTML='<div class="player-admin-page">'+
      '<div class="admin-section-head compact"><div><h3>陪玩列表</h3><p>集中查看陪玩资料、认证、押金、抽成、返点、收入与账号状态。</p></div><span class="admin-count-pill" data-player-count>0 条</span></div>'+
      '<div class="player-filter-panel">'+
        '<div class="player-filter-row player-filter-main">'+
          '<input class="player-keyword" data-player-search placeholder="搜索陪玩名字或ID">'+
          '<select data-player-filter="game"><option value="">游戏筛选</option></select>'+
          '<select data-player-filter="level"><option value="">等级筛选</option></select>'+
          '<select data-player-filter="identity"><option value="">实名状态</option><option>已认证</option><option>已上传</option><option>审核中</option><option>未认证</option><option>待补充</option></select>'+
          '<select data-player-filter="audit"><option value="">审核状态</option><option>未审核</option><option>待审核</option><option>审核中</option><option>已通过</option><option>已拒绝</option><option>已停用</option></select>'+
          '<select data-player-filter="deposit"><option value="">押金状态</option><option>已缴纳</option><option>已到账</option><option>待审核</option><option>未缴纳</option><option>已退回</option></select>'+
          '<button class="mini-btn primary-lite" type="button" data-player-search-button>搜索</button>'+
          '<button class="mini-btn" type="button" data-player-clear>重置</button>'+
        '</div>'+
      '</div>'+
      '<div id="playerManagementTable" class="player-table-shell"><div class="player-empty-state"><strong>正在加载陪玩列表…</strong></div></div>'+
      '<aside id="playerDetailDrawer" class="player-detail-drawer" hidden></aside>'+
    '</div>';
    loadPlayerAdminRows();
  }
  function loadPlayerAdminRows(){
    adminFetch('/api/admin/players',{headers:{'x-mcj-admin-role':getRole(),Accept:'application/json'}}).then(function(res){
      var ct=res.headers.get('content-type')||'';
      if(ct.indexOf('application/json')<0)throw new Error('数据库尚未连接，暂时无法加载陪玩列表。');
      return res.json();
    }).then(function(result){
      if(result&&result.ok===false)throw new Error(result.message||'陪玩数据读取失败');
      if(result&&result.configured===false){
        playerAdminState.rows=[];
        playerAdminState.loaded=true;
        playerAdminState.configured=false;
        playerAdminState.error=result.message||'数据库尚未连接，暂时无法加载陪玩列表。';
        renderPlayerFilterOptions();
        renderPlayerTableRows();
        return;
      }
      playerAdminState.rows=(result.players||result.data||result.items||[]);
      playerAdminState.loaded=true;
      playerAdminState.configured=true;
      playerAdminState.error='';
      renderPlayerFilterOptions();
      renderPlayerTableRows();
    }).catch(function(err){
      playerAdminState.rows=[];
      playerAdminState.loaded=true;
      playerAdminState.configured=false;
      playerAdminState.error=err.message||'数据库尚未连接，暂时无法加载陪玩列表。';
      renderPlayerFilterOptions();
      renderPlayerTableRows();
    });
  }
  function playerArrayValue(value){
    if(Array.isArray(value))return value.filter(Boolean);
    if(value&&typeof value==='object')return Object.keys(value).map(function(key){return value[key]}).filter(Boolean);
    return String(value||'').split(/[,，、\s]+/).map(function(x){return x.trim()}).filter(Boolean);
  }
  function normalizePercent(value,fallback){var text=String(value==null||value===''?fallback:value);return text.indexOf('%')>-1?text:text+'%'}
  function normalizeBool(value){return value===true||value==='true'||value==='1'||value==='是'||value==='显示'||value==='开启'}
  function playerLevelOptions(selected){
    selected=String(selected||'');
    var levels=getLevels();
    var html='<option value="">未设置</option>';
    var has=false;
    levels.forEach(function(level){var value=level.id||level.code||level.name;var label=(level.code?level.code+' ':'')+(level.name||value);if(String(value)===selected||String(level.code)===selected||String(level.name)===selected)has=true;html+='<option value="'+esc(value)+'" '+((String(value)===selected||String(level.code)===selected||String(level.name)===selected)?'selected':'')+'>'+esc(label)+'</option>';});
    if(selected&&!has)html+='<option value="'+esc(selected)+'" selected>'+esc(selected)+'</option>';
    return html;
  }
  function playerAccountOptions(selected){
    selected=String(selected||'正常');
    return ['正常','暂停接单','封禁','冻结','停用','启用'].map(function(item){return '<option '+(item===selected?'selected':'')+'>'+esc(item)+'</option>'}).join('');
  }
  function normalizePlayerAdmin(player){
    player=player||{};
    var level=levelApi()?levelApi().find(player.levelId||player.level_id||player.level||player.level_name):null;
    var id=player.id||player.uid||player.playerId||player.player_id||player.name||player.nickname;
    var playerId=playerValue(player,['playerId','player_id','uid','id'],id||'-');
    var levelRaw=String(player.levelId||player.level_id||player.level||player.level_name||'');
    var levelText=level?level.code+' '+level.name:playerValue(player,['levelName','level_name','level','levelId','level_id'],'-');
    var mainGame=playerValue(player,['mainGame','main_game','game','gameName'],'-');
    var gameId=playerValue(player,['gameId','game_id','mainGameId','game_uid'],'-');
    var audit=playerValue(player,['audit','auditStatus','audit_status','reviewStatus'],'未审核');
    var identity=playerValue(player,['identityStatus','identity_status','id_card','realNameStatus'],'未认证');
    var deposit=playerValue(player,['depositStatus','deposit_status','deposit'],'未缴纳');
    var account=playerValue(player,['accountStatus','account_status','status'],'正常');
    var online=playerValue(player,['onlineStatus','online_status','order_status','workStatus'],'离线');
    var registered=playerValue(player,['registered_at','registeredAt','created_at','createdAt'],'-');
    var lastLogin=playerValue(player,['lastLogin','last_login','last_online','lastOnline'],'-');
    var updated=playerValue(player,['updated_at','updatedAt','lastUpdated','last_online','lastOnline'],lastLogin);
    var name=playerValue(player,['name','nickname','displayName'],'-');
    var tags=playerArrayValue(player.tags||player.serviceTags||player.labels||'');
    var search=[id,playerId,player.uid,name,player.phone,player.email,mainGame,gameId,levelText,audit,identity,deposit,account,tags.join(' ')].join(' ').toLowerCase();
    return {raw:player,id:id,uid:player.uid||playerId,playerId:playerId,name:name,phone:player.phone||player.contact_phone||'-',email:player.email||'-',avatar:player.avatar||player.avatar_url||'assets/meow-cuijiao-brand.jpg',mainGame:mainGame,gameId:gameId,levelRaw:levelRaw,levelText:levelText,audit:audit,identity:identity,deposit:deposit,account:account,online:online,updated:updated,price:playerValue(player,['price','current_price','defaultPrice'],'-'),commission:normalizePercent(playerValue(player,['orderCommissionRate','order_commission_rate','commission','commissionRate'],'-'),'-'),giftCommission:normalizePercent(playerValue(player,['giftCommissionRate','gift_commission_rate'],'-'),'-'),directRebate:normalizePercent(playerValue(player,['directRebateRate','direct_rebate_rate','directRebate','direct_rebate','rebateRate'],'-'),'-'),totalOrders:playerValue(player,['totalOrders','total_orders','orders'],'0'),todayOrders:playerValue(player,['todayOrders','today_orders'],'0'),refundOrders:playerValue(player,['refundOrders','refund_orders'],'0'),totalIncome:playerValue(player,['total_income','totalIncome','income'],'RM0'),platformShare:playerValue(player,['platformShare','platform_share','platformCommission'],'RM0'),withdrawable:playerValue(player,['withdrawable','withdrawableAmount','withdrawable_amount'],'RM0'),withdrawn:playerValue(player,['totalWithdraw','total_withdraw','withdrawnAmount','withdrawn_amount'],'RM0'),withdrawStatus:playerValue(player,['withdrawStatus','withdraw_status','payoutStatus','settlementStatus','settlement_status'],'无提现'),registered:registered,lastLogin:lastLogin,tags:tags,featured:normalizeBool(player.featured||player.isFeatured||player.homeRecommended),pinned:normalizeBool(player.pinned||player.isPinned),bank:playerValue(player,['bank','bankAccount','bank_account','settlementAccount'],'-'),search:search};
  }
  function renderPlayerFilterOptions(){
    var gameSelect=document.querySelector('[data-player-filter="game"]');
    var levelSelect=document.querySelector('[data-player-filter="level"]');
    if(gameSelect){var current=gameSelect.value;var games=[];(playerAdminState.rows||[]).map(normalizePlayerAdmin).forEach(function(item){if(item.mainGame&&item.mainGame!=='-'&&games.indexOf(item.mainGame)<0)games.push(item.mainGame);});gameSelect.innerHTML='<option value="">游戏筛选</option>'+games.sort().map(function(game){return '<option '+(game===current?'selected':'')+'>'+esc(game)+'</option>'}).join('');}
    if(levelSelect){var currentLevel=levelSelect.value;levelSelect.innerHTML='<option value="">等级筛选</option>'+getLevels().map(function(level){var value=level.id||level.code||level.name;var label=(level.code?level.code+' ':'')+(level.name||value);return '<option value="'+esc(value)+'" '+(String(value)===currentLevel?'selected':'')+'>'+esc(label)+'</option>';}).join('');}
  }
  function visiblePlayerRows(){
    var keyword=((document.querySelector('[data-player-search]')||{}).value||'').trim().toLowerCase();
    var filters={};document.querySelectorAll('[data-player-filter]').forEach(function(select){filters[select.dataset.playerFilter]=select.value||'';});
    return (playerAdminState.rows||[]).map(normalizePlayerAdmin).filter(function(item){
      var ok=!keyword||item.search.indexOf(keyword)>-1;
      if(ok&&filters.game)ok=item.mainGame===filters.game;
      if(ok&&filters.level)ok=(item.levelRaw===filters.level||item.levelText.indexOf(filters.level)>-1);
      if(ok&&filters.audit)ok=item.audit.indexOf(filters.audit)>-1;
      if(ok&&filters.identity)ok=item.identity.indexOf(filters.identity)>-1;
      if(ok&&filters.deposit)ok=item.deposit.indexOf(filters.deposit)>-1;
      if(ok&&filters.account)ok=item.account.indexOf(filters.account)>-1;
      return ok;
    });
  }
  function playerTableCell(label,value,extra){return '<td data-label="'+esc(label)+'" title="'+esc(value)+'" '+(extra||'')+'>'+value+'</td>'}
  function playerAvatarSrc(item){
    var src=String(item&&item.avatar||'').trim();
    if(!src||src==='-'||src==='null'||src==='undefined')return '/assets/meow-cuijiao-brand.jpg';
    return src;
  }
  function playerContactLine(item){
    var contact=item.email&&item.email!=='-'?item.email:(item.phone&&item.phone!=='-'?item.phone:'');
    var idLine='ID '+esc(item.playerId||'-');
    if(contact)return esc(contact)+' · '+idLine;
    return idLine;
  }
  function renderPlayerTableRows(){
    closePlayerMoreMenu();
    var box=document.getElementById('playerManagementTable');if(!box)return;
    if(!playerAdminState.loaded){
      box.innerHTML='<div class="player-empty-state"><strong>正在加载陪玩列表…</strong></div>';
      return;
    }
    if(playerAdminState.error||playerAdminState.configured===false){
      var countErr=document.querySelector('[data-player-count]');if(countErr)countErr.textContent='0 条';
      box.innerHTML='<div class="player-empty-state"><strong>数据库尚未连接，暂时无法加载陪玩列表。</strong><span>'+esc(playerAdminState.error||'请检查 Supabase 配置后重试。')+'</span></div>';
      return;
    }
    var rows=visiblePlayerRows();
    var count=document.querySelector('[data-player-count]');if(count)count.textContent=rows.length+' 条';
    var total=rows.length;
    var pages=Math.max(1,Math.ceil(total/playerAdminState.pageSize));
    playerAdminState.page=Math.min(Math.max(1,playerAdminState.page),pages);
    var start=(playerAdminState.page-1)*playerAdminState.pageSize;
    var pageRows=rows.slice(start,start+playerAdminState.pageSize);
    var headers=['头像','昵称','陪玩ID','主接游戏','等级','实名状态','押金状态','抽成比例','直属陪返点','账号状态','注册时间','操作'];
    var body=pageRows.map(function(item){return '<tr class="player-list-row" data-player-open="'+esc(item.id)+'">'+
      '<td data-label="头像" class="avatar-cell"><button class="player-avatar-btn" type="button" data-player-action="view" data-player-id="'+esc(item.id)+'"><img class="avatar player-avatar" src="'+esc(playerAvatarSrc(item))+'" alt="" onerror="this.onerror=null;this.src=\'/assets/meow-cuijiao-brand.jpg\'"></button></td>'+
      '<td data-label="昵称" class="player-name-cell" title="'+esc(item.name)+'"><button class="player-name-link" type="button" data-player-action="view" data-player-id="'+esc(item.id)+'">'+esc(item.name)+'</button><span class="player-name-meta">'+playerContactLine(item)+'</span></td>'+
      playerTableCell('陪玩ID',esc(item.playerId))+
      playerTableCell('主接游戏',esc(item.mainGame))+
      playerTableCell('等级',esc(item.levelText))+
      '<td data-label="实名状态">'+statusChip(item.identity)+'</td>'+
      '<td data-label="押金状态">'+statusChip(item.deposit)+'</td>'+
      playerTableCell('抽成比例',esc(item.commission))+
      playerTableCell('直属陪返点',esc(item.directRebate))+
      '<td data-label="账号状态">'+statusChip(item.account)+'</td>'+
      playerTableCell('注册时间',esc(item.registered))+
      '<td data-label="操作" class="player-action-cell"><div class="player-ops"><button class="mini-btn" type="button" data-player-action="view" data-player-id="'+esc(item.id)+'">查看</button><button class="mini-btn primary-lite" type="button" data-player-action="edit" data-player-id="'+esc(item.id)+'">编辑</button><span class="player-more-wrap"><button class="mini-btn" type="button" data-player-more>更多</button><span class="player-more-menu" hidden><button type="button" data-player-action="edit" data-player-section="split" data-player-id="'+esc(item.id)+'">设置等级</button><button type="button" data-player-action="edit" data-player-section="split" data-player-id="'+esc(item.id)+'">设置抽成</button><button type="button" data-player-action="view" data-player-section="income" data-player-id="'+esc(item.id)+'">查看流水</button></span></span></div></td>'+
    '</tr>';}).join('');
    if(!body)body='<tr><td colspan="'+headers.length+'"><div class="player-table-empty"><strong>暂无陪玩数据</strong><span>当前没有符合条件的陪玩记录。</span></div></td></tr>';
    box.innerHTML='<div class="table-wrap player-table-wrap"><table class="player-data-table"><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>'}).join('')+'</tr></thead><tbody>'+body+'</tbody></table></div><div class="player-pagination compact"><span>共 '+total+' 条 · 第 '+playerAdminState.page+' / '+pages+' 页</span><div><select data-player-page-size><option value="20" '+(playerAdminState.pageSize===20?'selected':'')+'>20 条/页</option><option value="50" '+(playerAdminState.pageSize===50?'selected':'')+'>50 条/页</option><option value="100" '+(playerAdminState.pageSize===100?'selected':'')+'>100 条/页</option></select><button class="mini-btn" type="button" data-player-page="prev" '+(playerAdminState.page<=1?'disabled':'')+'>上一页</button><input data-player-page-jump value="'+playerAdminState.page+'" inputmode="numeric" aria-label="页码"><button class="mini-btn" type="button" data-player-page-go>跳转</button><button class="mini-btn" type="button" data-player-page="next" '+(playerAdminState.page>=pages?'disabled':'')+'>下一页</button></div></div>';
  }
  function filterPlayerManagement(){playerAdminState.page=1;renderPlayerTableRows();}
  function exportPlayerRows(){
    var rows=visiblePlayerRows();
    var headers=['头像','陪玩名字','陪玩ID','主接游戏','等级','资料审核状态','实名状态','押金状态','当前抽成','直属陪返点','总收入','可提现余额','账号状态'];
    var lines=[headers].concat(rows.map(function(item){return [item.avatar,item.name,item.playerId,item.mainGame,item.levelText,item.audit,item.identity,item.deposit,item.commission,item.directRebate,item.totalIncome,item.withdrawable,item.account]}));
    var csv=lines.map(function(line){return line.map(function(cell){return '"'+String(cell==null?'':cell).replace(/"/g,'""')+'"'}).join(',')}).join('\n');
    var blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download='players.csv';a.click();URL.revokeObjectURL(url);
  }
  function playerDetailRows(rows){return '<div class="detail-list player-detail-list">'+rows.map(function(row){return '<div><span>'+esc(row[0])+'</span><strong>'+esc(row[1]==null||row[1]===''?'-':row[1])+'</strong></div>'}).join('')+'</div>'}
  function playerRecordTable(headers,rows,emptyText){return '<div class="table-wrap player-drawer-table"><table><thead><tr>'+headers.map(function(h){return '<th>'+esc(h)+'</th>'}).join('')+'</tr></thead><tbody>'+(rows&&rows.length?rows.join(''):'<tr><td colspan="'+headers.length+'"><div class="boss-record-empty">'+esc(emptyText||'暂无真实数据')+'</div></td></tr>')+'</tbody></table></div>'}
  function playerFormField(label,name,value,type){return '<label><span>'+esc(label)+'</span><input name="'+esc(name)+'" type="'+esc(type||'text')+'" value="'+esc(value||'')+'"></label>'}
  function playerSelectField(label,name,html){return '<label><span>'+esc(label)+'</span><select name="'+esc(name)+'">'+html+'</select></label>'}
  function playerDetailSection(key,title,html){return '<section class="player-detail-section" data-player-detail-section="'+esc(key)+'"><h3>'+esc(title)+'</h3>'+html+'</section>'}
  function playerOrdersRows(item){var rows=playerArrayValue(item.raw.orders||item.raw.orderRecords||item.raw.historyOrders).map(function(order){return '<tr><td>'+esc(order.id||order.order_id||'-')+'</td><td>'+esc(order.service||order.game||'-')+'</td><td>'+esc(order.amount||'-')+'</td><td>'+esc(order.status||'-')+'</td><td>'+esc(order.time||order.created_at||'-')+'</td></tr>'});return rows;}
  function playerWithdrawRows(item){var rows=playerArrayValue(item.raw.withdraws||item.raw.withdrawRequests||item.raw.withdraw_records).map(function(row){return '<tr><td>'+esc(row.id||row.withdraw_id||'-')+'</td><td>'+esc(row.account||row.bank||item.bank||'-')+'</td><td>'+esc(row.amount||'-')+'</td><td>'+esc(row.status||'-')+'</td><td>'+esc(row.reason||row.rejectReason||'-')+'</td></tr>'});return rows;}
  function playerIncomeRows(item){var rows=playerArrayValue(item.raw.incomeRows||item.raw.income_records||item.raw.walletTransactions).map(function(row){return '<tr><td>'+esc(row.id||'-')+'</td><td>'+esc(row.type||'-')+'</td><td>'+esc(row.amount||'-')+'</td><td>'+esc(row.status||'-')+'</td><td>'+esc(row.time||row.created_at||'-')+'</td></tr>'});return rows;}
  function playerDetailHtml(item,mode,focus){
    var raw=item.raw||{};
    var edit=mode==='edit';
    var basic=playerDetailRows([['头像',item.avatar],['昵称',item.name],['ID',item.playerId],['联系方式',item.phone],['邮箱',item.email],['注册时间',item.registered],['主接游戏',item.mainGame+' / '+item.gameId],['陪玩标签',item.tags.join('、')||'-']]);
    var verify=playerDetailRows([['陪玩申请资料',playerValue(raw,['applicationNo','application_no','applicationStatus'],'-')],['身份证认证',item.identity],['结款账户',item.bank],['头像 / 相册 / 语音',playerValue(raw,['mediaStatus','galleryStatus','voiceStatus'],'-')],['审核状态',item.audit],['驳回原因',playerValue(raw,['rejectReason','reject_reason','reviewRemark'],'-')]])+
      (edit?'<div class="player-edit-grid">'+playerSelectField('资料审核状态','auditStatus','<option '+(item.audit==='未审核'?'selected':'')+'>未审核</option><option '+(item.audit==='待审核'?'selected':'')+'>待审核</option><option '+(item.audit==='已通过'?'selected':'')+'>已通过</option><option '+(item.audit==='已拒绝'?'selected':'')+'>已拒绝</option>')+playerSelectField('实名状态','identityStatus','<option '+(item.identity==='未认证'?'selected':'')+'>未认证</option><option '+(item.identity==='审核中'?'selected':'')+'>审核中</option><option '+(item.identity==='已认证'?'selected':'')+'>已认证</option><option '+(item.identity==='待补充'?'selected':'')+'>待补充</option>')+playerFormField('驳回原因','rejectReason',playerValue(raw,['rejectReason','reject_reason'],''))+'</div>':'');
    var split='<div class="player-edit-grid">'+playerSelectField('当前等级','levelId',playerLevelOptions(item.levelRaw))+playerFormField('订单抽成比例','orderCommissionRate',item.commission)+playerFormField('礼物抽成比例','giftCommissionRate',item.giftCommission)+playerFormField('直属陪返点比例','directRebateRate',item.directRebate)+playerSelectField('是否首页推荐','featured','<option value="false" '+(!item.featured?'selected':'')+'>否</option><option value="true" '+(item.featured?'selected':'')+'>是</option>')+playerSelectField('是否置顶','pinned','<option value="false" '+(!item.pinned?'selected':'')+'>否</option><option value="true" '+(item.pinned?'selected':'')+'>是</option>')+'</div>';
    var deposit=playerDetailRows([['应缴押金',playerValue(raw,['depositDue','deposit_due'],'RM100')],['已缴金额',playerValue(raw,['depositPaid','deposit_paid'],'RM0')],['缴纳时间',playerValue(raw,['depositTime','deposit_time'],'-')],['当前状态',item.deposit],['退款记录',playerValue(raw,['depositRefund','deposit_refund'],'暂无')]])+(edit?'<div class="player-edit-grid">'+playerSelectField('押金状态','depositStatus','<option '+(item.deposit==='未缴纳'?'selected':'')+'>未缴纳</option><option '+(item.deposit==='待审核'?'selected':'')+'>待审核</option><option '+(item.deposit==='已到账'?'selected':'')+'>已到账</option><option '+(item.deposit==='已缴纳'?'selected':'')+'>已缴纳</option><option '+(item.deposit==='已退回'?'selected':'')+'>已退回</option>')+playerFormField('手动确认到账备注','depositConfirmRemark','')+'</div>':'');
    var income=playerDetailRows([['完成订单数',item.totalOrders],['退款订单',item.refundOrders],['总收入',item.totalIncome],['平台抽成',item.platformShare],['可提现余额',item.withdrawable],['已提现金额',item.withdrawn]])+playerRecordTable(['订单号','服务','金额','状态','时间'],playerOrdersRows(item),'暂无真实历史订单')+playerRecordTable(['流水号','类型','金额','状态','时间'],playerIncomeRows(item),'暂无真实收入流水');
    var withdraw=playerDetailRows([['收款账户',item.bank],['最近提现状态',item.withdrawStatus],['可提现余额',item.withdrawable]])+playerRecordTable(['提现单号','收款账户','申请金额','审核状态','拒绝原因'],playerWithdrawRows(item),'暂无真实提现申请')+(edit?'<div class="player-edit-grid">'+playerSelectField('提现审核状态','withdrawStatus','<option '+(item.withdrawStatus==='无提现'?'selected':'')+'>无提现</option><option '+(item.withdrawStatus==='待审核'?'selected':'')+'>待审核</option><option '+(item.withdrawStatus==='已通过'?'selected':'')+'>已通过</option><option '+(item.withdrawStatus==='已拒绝'?'selected':'')+'>已拒绝</option>')+playerFormField('拒绝原因','withdrawRejectReason','')+'</div>':'');
    var complaints=playerDetailRows([['退款记录',playerValue(raw,['refundCount','refund_count','refundOrders'],item.refundOrders||'0')],['投诉记录',playerValue(raw,['complaintCount','complaint_count','complaints'],'暂无')]]);
    var account=playerDetailRows([['当前在线状态',item.online],['账号状态',item.account],['是否已设置密码',(item.raw&&(item.raw.hasPassword||item.raw.has_password))?'是':'否'],['注册邮箱',item.email||'-'],['邮箱验证状态',(item.raw&&(item.raw.emailVerifiedLabel||item.raw.email_verified_label))||((item.raw&&(item.raw.emailVerified===false||item.raw.email_verified===false))?'❌ 未验证':'✅ 已验证')],['最近密码重置',(item.raw&&(item.raw.passwordSetAt||item.raw.password_set_at))||'-']])+(edit?'<div class="player-edit-grid">'+playerSelectField('账号状态','accountStatus',playerAccountOptions(item.account))+'</div>':'')+'<div class="player-edit-grid" style="margin-top:10px"><button class="mini-btn" type="button" data-player-sec="send_password_reset" data-player-id="'+esc(item.id)+'">发送密码重置邮件</button><button class="mini-btn" type="button" data-player-sec="force_change_password" data-player-id="'+esc(item.id)+'">强制下次改密</button><button class="mini-btn" type="button" data-player-sec="revoke_sessions" data-player-id="'+esc(item.id)+'">注销全部会话</button><button class="mini-btn" type="button" data-player-sec="enable" data-player-id="'+esc(item.id)+'">解封账号</button></div><div class="admin-sync-note">后台不可查看真实密码或哈希；重置仅发送邮箱验证码由用户自行设置。邮箱验证状态来自注册验证码流程。</div>';
    return '<div class="player-drawer-head"><div><h2>'+esc(edit?'编辑陪玩':'陪玩详情')+'</h2><p>'+esc(item.name)+' · '+esc(item.playerId)+'</p></div><button class="mini-btn" type="button" data-player-drawer-close>关闭</button></div><form data-player-detail-form data-player-id="'+esc(item.id)+'"><div class="player-detail-hero"><img src="'+esc(playerAvatarSrc(item))+'" alt="" onerror="this.onerror=null;this.src=\'/assets/meow-cuijiao-brand.jpg\'"><div><strong>'+esc(item.name)+'</strong><span>'+esc(item.levelText)+' · '+esc(item.mainGame)+'</span></div>'+statusChip(item.account)+'</div>'+playerDetailSection('basic','基本资料',basic)+playerDetailSection('verify','资料与认证',verify)+playerDetailSection('split','等级与分成',split)+playerDetailSection('deposit','押金',deposit)+playerDetailSection('income','订单与收入',income)+playerDetailSection('withdraw','提现',withdraw)+playerDetailSection('complaints','退款和投诉',complaints)+playerDetailSection('account','账号管理',account)+'<div class="player-drawer-actions"><button class="btn primary" type="button" data-player-action="save-detail" data-player-id="'+esc(item.id)+'">保存修改</button><button class="btn" type="button" data-player-drawer-close>取消</button></div></form>';
  }
  function openPlayerDetail(playerId,mode,focus){
    var drawer=document.getElementById('playerDetailDrawer');
    if(!drawer)return;
    drawer.hidden=false;
    drawer.classList.add('open');
    drawer.innerHTML='<div class="player-drawer-head"><div><h2>陪玩详情</h2><p>正在读取真实资料…</p></div><button class="mini-btn" type="button" data-player-drawer-close>关闭</button></div><div class="admin-sync-note">资料加载中，请稍候。</div>';
    var Detail=window.MCJAdminPlayerDetail;
    var finish=function(detail,err){
      if(err){
        drawer.innerHTML='<div class="player-drawer-head"><div><h2>陪玩详情</h2><p>资料加载失败</p></div><button class="mini-btn" type="button" data-player-drawer-close>关闭</button></div><div class="admin-sync-note">资料加载失败，请重试：'+esc(err.message||err)+'</div><div class="player-drawer-actions"><button class="btn" type="button" data-player-action="view" data-player-id="'+esc(playerId)+'">重试</button><button class="btn" type="button" data-player-drawer-close>关闭</button></div>';
        return;
      }
      if(Detail&&Detail.render){
        drawer.innerHTML=Detail.render(detail,mode||'view',focus||'');
      }else{
        var item=normalizePlayerAdmin(detail);
        drawer.innerHTML=playerDetailHtml(item,mode||'view',focus||'');
      }
      if(focus){var section=drawer.querySelector('[data-player-detail-section="'+focus+'"]');if(section)section.scrollIntoView({block:'start'});}
    };
    if(Detail&&Detail.fetchDetail){
      Detail.fetchDetail(playerId).then(function(res){
        var detail=res.detail||res.player||res;
        // refresh list row cache
        var idx=(playerAdminState.rows||[]).findIndex(function(item){return String(item.id)===String(playerId)});
        if(idx>=0)playerAdminState.rows[idx]=Object.assign({},playerAdminState.rows[idx],detail);
        else if(detail&&detail.id)playerAdminState.rows.push(detail);
        finish(detail);
      }).catch(function(err){finish(null,err)});
      return;
    }
    var player=(playerAdminState.rows||[]).find(function(item){return String(item.id||item.uid||item.playerId||item.player_id||item.name||item.nickname)===String(playerId)});
    finish(normalizePlayerAdmin(player||{id:playerId}));
  }
  window.MCJAdminPlayerBridge={
    reloadDetail:function(id,mode){openPlayerDetail(id,mode||'view');},
    reloadList:function(){loadPlayerAdminRows();}
  };
  function closePlayerDrawer(){var drawer=document.getElementById('playerDetailDrawer');if(drawer){drawer.hidden=true;drawer.classList.remove('open');drawer.innerHTML='';}}
  var playerMorePopover={el:null,anchor:null,home:null,onScroll:null,bound:false};
  function clearPlayerMoreMenuInlineStyles(menu){
    if(!menu||!menu.style)return;
    menu.style.position='';
    menu.style.top='';
    menu.style.left='';
    menu.style.right='';
    menu.style.bottom='';
    menu.style.zIndex='';
    menu.style.minWidth='';
  }
  function closePlayerMoreMenu(){
    var menu=playerMorePopover.el;
    if(menu){
      menu.hidden=true;
      menu.classList.remove('is-portal-open');
      clearPlayerMoreMenuInlineStyles(menu);
      if(playerMorePopover.home&&document.body.contains(playerMorePopover.home)){
        playerMorePopover.home.appendChild(menu);
      }else if(menu.parentNode===document.body){
        menu.remove();
      }
    }
    playerMorePopover.el=null;
    playerMorePopover.anchor=null;
    playerMorePopover.home=null;
    if(playerMorePopover.onScroll){
      document.querySelectorAll('.player-table-wrap').forEach(function(scroller){
        scroller.removeEventListener('scroll',playerMorePopover.onScroll);
      });
      window.removeEventListener('scroll',playerMorePopover.onScroll,true);
      window.removeEventListener('resize',playerMorePopover.onScroll);
      playerMorePopover.onScroll=null;
    }
  }
  function positionPlayerMoreMenu(){
    var menu=playerMorePopover.el;
    var anchor=playerMorePopover.anchor;
    if(!menu||!anchor||!document.body.contains(anchor)){closePlayerMoreMenu();return;}
    var rect=anchor.getBoundingClientRect();
    var gap=4;
    var pad=8;
    var menuWidth=Math.max(148,menu.offsetWidth||148);
    var menuHeight=Math.max(menu.offsetHeight||1,1);
    var left=rect.right-menuWidth;
    if(left<pad)left=pad;
    if(left+menuWidth>window.innerWidth-pad)left=Math.max(pad,window.innerWidth-menuWidth-pad);
    var top=rect.bottom+gap;
    var spaceBelow=window.innerHeight-rect.bottom-pad;
    var spaceAbove=rect.top-pad;
    if(top+menuHeight>window.innerHeight-pad && spaceAbove>=menuHeight+gap){
      top=rect.top-gap-menuHeight;
    }else if(top+menuHeight>window.innerHeight-pad){
      top=Math.max(pad,window.innerHeight-menuHeight-pad);
    }
    top=Math.max(pad,Math.min(top,window.innerHeight-menuHeight-pad));
    menu.style.position='fixed';
    menu.style.zIndex='10050';
    menu.style.right='auto';
    menu.style.bottom='auto';
    menu.style.left=Math.round(left)+'px';
    menu.style.top=Math.round(top)+'px';
    menu.style.minWidth=menuWidth+'px';
  }
  function openPlayerMoreMenu(anchorBtn){
    var wrap=anchorBtn.closest('.player-more-wrap')||anchorBtn.parentElement;
    var menu=wrap&&wrap.querySelector('.player-more-menu');
    if(!menu)return;
    if(playerMorePopover.el===menu&&!menu.hidden){closePlayerMoreMenu();return;}
    closePlayerMoreMenu();
    playerMorePopover.home=wrap;
    playerMorePopover.anchor=anchorBtn;
    playerMorePopover.el=menu;
    document.body.appendChild(menu);
    menu.hidden=false;
    menu.classList.add('is-portal-open');
    positionPlayerMoreMenu();
    requestAnimationFrame(function(){positionPlayerMoreMenu();});
    playerMorePopover.onScroll=function(){closePlayerMoreMenu();};
    document.querySelectorAll('.player-table-wrap').forEach(function(scroller){
      scroller.addEventListener('scroll',playerMorePopover.onScroll,{passive:true});
    });
    window.addEventListener('scroll',playerMorePopover.onScroll,true);
    window.addEventListener('resize',playerMorePopover.onScroll);
  }
  function ensurePlayerMorePopoverBound(){
    if(playerMorePopover.bound)return;
    playerMorePopover.bound=true;
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape')closePlayerMoreMenu();
    });
  }
  ensurePlayerMorePopoverBound();
  function collectPlayerEditForm(form){var data={};if(!form)return data;new FormData(form).forEach(function(value,key){data[key]=value});return data;}
  function updatePlayerRowInMemory(id,payload){
    (playerAdminState.rows||[]).forEach(function(row){var rid=String(row.id||row.uid||row.playerId||row.player_id||row.name||row.nickname);if(rid!==String(id))return;Object.keys(payload||{}).forEach(function(key){var value=payload[key];if(key==='orderCommissionRate')row.orderCommissionRate=value;if(key==='directRebateRate')row.directRebateRate=value;if(key==='giftCommissionRate')row.giftCommissionRate=value;if(key==='accountStatus')row.accountStatus=value;if(key==='auditStatus')row.auditStatus=value;if(key==='identityStatus')row.identityStatus=value;if(key==='depositStatus')row.depositStatus=value;if(key==='withdrawStatus')row.withdrawStatus=value;if(key==='levelId')row.levelId=value;if(key==='featured')row.featured=value==='true'||value===true;if(key==='pinned')row.pinned=value==='true'||value===true;if(key==='workStatus')row.workStatus=value;if(key==='rejectReason')row.rejectReason=value;if(key==='depositConfirmRemark')row.depositConfirmRemark=value;if(key==='withdrawRejectReason')row.withdrawRejectReason=value;});row.updatedAt=new Date().toISOString();});
  }
  function savePlayerAdminChanges(action,id,payload,done){
    var Detail=window.MCJAdminPlayerDetail;
    if(Detail&&Detail.setSaving)Detail.setSaving(true);
    var saveBtn=document.querySelector('[data-player-action="save-detail"][data-player-id="'+id+'"]');
    if(saveBtn){saveBtn.disabled=true;saveBtn.textContent='保存中…';}
    var body={action:action,id:id,payload:payload||{}};
    if(action==='edit'||action==='save'||action==='quick-edit'){
      // keep default edit path
    }
    adminFetch('/api/admin/players',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify(body)}).then(function(res){return res.json().catch(function(){return {ok:false,message:'陪玩管理接口返回异常'}})}).then(function(result){
      if(!result.ok)throw new Error(result.message||'保存失败');
      if(result.player){
        var idx=(playerAdminState.rows||[]).findIndex(function(row){return String(row.id)===String(id)});
        if(idx>=0)playerAdminState.rows[idx]=Object.assign({},playerAdminState.rows[idx],result.player);
        else playerAdminState.rows.push(result.player);
      }else{
        updatePlayerRowInMemory(id,payload||{});
      }
      renderPlayerFilterOptions();
      renderPlayerTableRows();
      if(Detail&&Detail.setSaving)Detail.setSaving(false);
      if(done)done(result);
      else alert(result.message||'修改已保存');
    }).catch(function(err){
      if(Detail&&Detail.setSaving)Detail.setSaving(false);
      if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='保存修改';}
      console.error('[陪玩管理] 保存失败',{action:action,id:id,payload:payload,error:err});
      alert('保存失败：'+err.message+'。未写入本地假数据。');
    });
  }
  function submitPlayerSecure(action,id,payload){savePlayerAdminChanges(action,id,payload||{});}
  var adminMessageState={conversations:[],messages:[],profiles:{},activeId:'',loaded:false,error:''};
  var serviceRecordState={rows:[],loaded:false,error:'',keyword:'',status:'',date:'',page:1,pageSize:20};
  var chatTypeLabels={boss:'老板',customer:'老板',player:'陪玩',companion:'陪玩',service:'客服',support:'客服',system:'系统通知'};
  function avatarInitial(name){return esc(String(name||'喵').trim().slice(0,1).toUpperCase()||'喵')}
  function chatProfileField(label,value){return '<div><span>'+esc(label)+'</span><strong>'+esc(value==null||value===''?'-':value)+'</strong></div>'}
  function normalizeAdminConversation(item){
    item=item||{};
    return {
      id:String(item.id||item.conversationId||item.conversation_id||''),
      type:String(item.type||item.targetType||item.target_type||'boss'),
      name:item.name||item.nickname||item.title||'未命名会话',
      uid:item.bossUid||item.boss_uid||item.uid||item.userUid||item.user_uid||item.targetUid||item.target_uid||'-',
      phone:item.phone||item.mobile||'',
      externalId:item.bossUid||item.boss_uid||item.bossId||item.boss_id||item.playerId||item.player_id||item.externalId||'',
      avatar:item.avatar||item.photo||'',
      lastMessage:item.lastMessage||item.last_message||'暂无消息',
      lastTime:item.lastTime||item.last_time||item.updatedAt||item.updated_at||'',
      unread:Number(item.unread||item.unreadCount||item.unread_count||0),
      onlineStatus:item.onlineStatus||item.online_status||item.status||'离线',
      assignedService:item.assignedService||item.assigned_service||item.serviceName||item.service_name||'未分配客服'
    };
  }
  function normalizeAdminMessage(item){
    item=item||{};
    return {
      id:String(item.id||item.messageId||item.message_id||Date.now()),
      conversationId:String(item.conversationId||item.conversation_id||''),
      direction:item.direction||item.side||(/admin|service|support/.test(String(item.senderRole||item.sender_role||''))?'outgoing':'incoming'),
      senderName:item.senderName||item.sender_name||'',
      type:item.type||item.messageType||item.message_type||'text',
      content:item.content||item.text||item.body||'',
      url:item.url||item.fileUrl||item.file_url||'',
      title:item.title||item.cardTitle||item.card_title||'',
      subtitle:item.subtitle||item.cardSubtitle||item.card_subtitle||'',
      time:item.time||item.createdAt||item.created_at||'',
      read:item.read||item.isRead||item.is_read||false,
      quoted:item.quoted||item.quote||''
    };
  }
  function adminChatAvatar(convo){
    if(convo&&convo.avatar)return '<img src="'+esc(convo.avatar)+'" alt="">';
    return '<span>'+avatarInitial(convo&&convo.name)+'</span>';
  }
  function renderAdminMessageCenter(){
    var target=document.getElementById('adminMessageCenter');
    if(!target)return;
    target.innerHTML=renderAdminMessageWorkbench();
    if(!adminMessageState.loaded)loadAdminMessages();
  }
  function loadAdminMessages(){
    adminFetch('/api/admin/messages',{headers:{'x-mcj-admin-role':getRole()}}).then(function(res){var type=res.headers.get('content-type')||'';if(type.indexOf('application/json')<0)return {ok:true,conversations:[],messages:[],profiles:{},message:'本地静态预览未启用服务端消息接口'};return res.json().catch(function(){return {ok:false,message:'消息接口返回异常'}})}).then(function(result){
      if(!result.ok)throw new Error(result.message||'消息接口读取失败');
      adminMessageState.conversations=(result.conversations||[]).map(normalizeAdminConversation).filter(function(item){return item.id});
      adminMessageState.messages=(result.messages||[]).map(normalizeAdminMessage);
      adminMessageState.profiles=result.profiles||{};
      adminMessageState.activeId=adminMessageState.activeId||((adminMessageState.conversations[0]||{}).id||'');
      adminMessageState.loaded=true;
      adminMessageState.error='';
      var target=document.getElementById('adminMessageCenter');
      if(target)target.innerHTML=renderAdminMessageWorkbench();
    }).catch(function(err){
      adminMessageState.loaded=true;
      adminMessageState.error=err.message||'消息接口读取失败';
      var target=document.getElementById('adminMessageCenter');
      if(target)target.innerHTML=renderAdminMessageWorkbench();
    });
  }
  function currentAdminConversation(){
    return adminMessageState.conversations.find(function(item){return item.id===adminMessageState.activeId})||null;
  }
  function currentAdminMessages(){
    return adminMessageState.messages.filter(function(item){return item.conversationId===adminMessageState.activeId});
  }
  function renderAdminMessageWorkbench(){
    var active=currentAdminConversation();
    return '<div class="admin-chat-workbench">'+renderAdminChatList(active)+renderAdminChatMain(active)+renderAdminChatProfile(active)+'</div><div class="admin-sync-note">客服工作台只读取统一聊天数据库。没有真实会话时显示空状态；发送、接管、转交、拉黑、删除和导出操作必须通过后端接口落库，不写入本地假数据。</div>';
  }
  function renderAdminChatList(active){
    var groups=['全部','老板','陪玩','客服','系统通知'];
    var list=adminMessageState.conversations.map(function(item){
      var type=chatTypeLabels[item.type]||item.type;
      return '<button class="admin-chat-item '+(active&&active.id===item.id?'active':'')+'" type="button" data-admin-chat-id="'+esc(item.id)+'" data-chat-type="'+esc(type)+'" data-search="'+esc([item.name,item.uid,item.phone,item.externalId,item.lastMessage,type].join(' '))+'">'+
        '<span class="admin-chat-avatar">'+adminChatAvatar(item)+'<i class="'+(/在线|online/i.test(item.onlineStatus)?'online':'')+'"></i></span>'+
        '<span class="admin-chat-meta"><strong>'+esc(item.name)+'</strong><small>'+esc(item.lastMessage)+'</small></span>'+
        '<span class="admin-chat-side"><time>'+esc(item.lastTime||'-')+'</time>'+(item.unread?'<b>'+esc(item.unread)+'</b>':'')+'</span>'+
      '</button>';
    }).join('');
    return '<aside class="admin-chat-sidebar"><div class="admin-chat-search"><input type="search" data-admin-chat-search placeholder="搜索昵称 / UID / 手机号 / 老板ID / 陪玩ID"></div><div class="admin-chat-tabs">'+groups.map(function(group,i){return '<button class="'+(i===0?'active':'')+'" type="button" data-admin-chat-filter="'+esc(group)+'">'+esc(group)+'</button>'}).join('')+'</div><div class="admin-chat-list">'+(list||'<div class="chat-empty-state"><strong>暂无会话</strong><span>真实聊天接入后，这里会显示老板、陪玩、客服与系统通知。</span></div>')+'</div></aside>';
  }
  function renderMessageBody(message){
    if(message.type==='image')return message.url?'<img class="chat-image" src="'+esc(message.url)+'" alt="图片消息">':'[图片]';
    if(message.type==='voice')return '<span class="voice-pill">语音消息 '+esc(message.content||'')+'</span>';
    if(message.type==='file')return '<span class="file-pill">文件：'+esc(message.title||message.content||'未命名文件')+'</span>';
    if(/order|companion|player|recharge|refund/.test(message.type))return '<div class="message-card"><strong>'+esc(message.title||messageTypeLabel(message.type))+'</strong><span>'+esc(message.subtitle||message.content||'-')+'</span></div>';
    return esc(message.content);
  }
  function messageTypeLabel(type){
    var map={order_card:'订单卡片',companion_card:'陪玩卡片',player_card:'陪玩卡片',recharge_card:'充值卡片',refund_card:'退款卡片'};
    return map[type]||'消息卡片';
  }
  function renderAdminChatMain(active){
    var messages=currentAdminMessages();
    var body=messages.map(function(message){
      if(message.type==='time')return '<div class="chat-time-line">'+esc(message.time||message.content)+'</div>';
      if(message.type==='system')return '<div class="chat-system-line">'+esc(message.content)+'</div>';
      var outgoing=message.direction==='outgoing';
      return '<div class="wechat-message '+(outgoing?'outgoing':'incoming')+'" data-message-id="'+esc(message.id)+'">'+
        '<div class="wechat-bubble">'+(message.quoted?'<blockquote>'+esc(message.quoted)+'</blockquote>':'')+renderMessageBody(message)+'</div>'+
        '<div class="message-tools"><button data-chat-message-action="recall" type="button">撤回</button><button data-chat-message-action="copy" type="button">复制</button><button data-chat-message-action="forward" type="button">转发</button><button data-chat-message-action="delete" type="button">删除</button><button data-chat-message-action="reply" type="button">回复</button><span>'+esc(message.time||'')+(outgoing?' · '+(message.read?'已读':'未读'):'')+'</span></div>'+
      '</div>';
    }).join('');
    return '<main class="admin-chat-main"><header class="admin-chat-header">'+(active?'<div class="admin-chat-title"><span class="admin-chat-avatar large">'+adminChatAvatar(active)+'<i class="'+(/在线|online/i.test(active.onlineStatus)?'online':'')+'"></i></span><div><strong>'+esc(active.name)+'</strong><small>UID '+esc(active.uid)+' · '+esc(active.onlineStatus)+' · 当前负责客服：'+esc(active.assignedService)+'</small></div></div>':'<div class="admin-chat-title"><span class="admin-chat-avatar large"><span>喵</span></span><div><strong>请选择会话</strong><small>左侧选择真实聊天后查看记录</small></div></div>')+
      '<div class="admin-chat-actions"><button data-chat-action="view-profile" type="button">查看资料</button><button data-chat-action="orders" type="button">查看订单</button><button data-chat-action="refund" type="button">发起退款</button><button data-chat-action="create-order" type="button">创建订单</button><button data-chat-action="recharge" type="button">查看充值</button><button class="danger-btn" data-chat-action="blacklist" type="button">加入黑名单</button></div></header>'+
      '<section class="admin-chat-messages">'+(active?(body||'<div class="chat-empty-state"><strong>暂无消息记录</strong><span>该会话还没有真实数据库消息。</span></div>'):'<div class="chat-empty-state"><strong>暂无会话</strong><span>请选择左侧聊天对象。</span></div>')+'</section>'+
      '<footer class="admin-chat-composer"><div class="composer-toolbar"><button data-chat-tool="image" type="button">图片</button><button data-chat-tool="voice" type="button">语音</button><button data-chat-tool="emoji" type="button">表情</button><button data-chat-tool="quick" type="button">快捷回复</button><button data-chat-action="take-over" type="button">接管</button><button data-chat-action="transfer" type="button">转交客服</button><button data-chat-action="export" type="button">导出记录</button></div><textarea data-chat-input placeholder="输入消息，Enter 发送，Shift + Enter 换行"></textarea><div class="composer-submit"><span>支持文字、图片、语音、文件、订单卡片、陪玩卡片、充值卡片和退款卡片</span><button data-chat-send type="button">发送</button></div></footer></main>';
  }
  function renderAdminChatProfile(active){
    var profile=active?(adminMessageState.profiles[active.id]||{}):{};
    var type=active?(chatTypeLabels[active.type]||active.type):'';
    var base=active?[
      ['身份',type],
      ['昵称',active.name],
      ['UID',active.uid],
      ['在线状态',active.onlineStatus],
      ['当前客服',active.assignedService]
    ]:[];
    if(active&&/老板/.test(type)){
      base=base.concat([['老板 ID',profile.bossId||active.externalId||'未设置'],['手机号',maskPhone(profile.phone||active.phone)],['VIP 等级',profile.vip||'-'],['余额',profile.balance||'RM0'],['最近订单',profile.recentOrder||'-'],['累计消费',profile.totalSpent||'RM0'],['累计充值',profile.totalRecharge||'RM0'],['邀请关系',profile.invite||'-'],['常玩游戏',profile.games||'-'],['游戏 ID',profile.gameId||'-'],['备注',profile.remark||'-']]);
    }else if(active&&/陪玩/.test(type)){
      base=base.concat([['等级',profile.level||'-'],['当前单价',profile.price||'-'],['佣金',profile.commission||'-'],['返点',profile.rebate||'-'],['所属俱乐部',profile.club||'-'],['最近收入',profile.recentIncome||'RM0']]);
    }else if(active&&/客服/.test(type)){
      base=base.concat([['工号',profile.employeeId||'-'],['今日接单',profile.todayOrders||'0'],['工资',profile.salary||'RM0']]);
    }
    return '<aside class="admin-chat-profile"><h3>资料栏</h3>'+(active?'<div class="profile-hero"><span class="admin-chat-avatar large">'+adminChatAvatar(active)+'</span><strong>'+esc(active.name)+'</strong><small>'+esc(type)+'</small></div><div class="detail-list">'+base.map(function(item){return chatProfileField(item[0],item[1])}).join('')+'</div><div class="profile-admin-actions"><button data-chat-action="view-profile" type="button">查看资料</button><button data-chat-action="orders" type="button">查看订单</button><button data-chat-action="recharge" type="button">查看充值</button><button data-chat-action="create-order" type="button">创建订单</button><button data-chat-action="refund" type="button">查看退款</button><button data-chat-action="take-over" type="button">接管聊天</button><button data-chat-action="transfer" type="button">转交客服</button><button data-chat-action="export" type="button">导出聊天记录</button><button class="danger-btn" data-chat-action="blacklist" type="button">加入黑名单</button></div>':'<div class="chat-empty-state"><strong>请选择会话</strong><span>资料栏会根据老板、陪玩或客服自动切换字段。</span></div>')+'</aside>';
  }
  function submitAdminChatAction(action,conversationId,payload){
    if(!conversationId){alert('请先选择一个真实会话');return;}
    adminFetch('/api/admin/messages',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,conversationId:conversationId,payload:payload||{}})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'消息接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'操作失败');alert('已提交到统一聊天数据库');loadAdminMessages();}).catch(function(err){alert('操作失败：'+err.message+'。未写入本地假数据。');});
  }
  function submitCompanionLevelsSecure(){
    if(window.MCJAdminCompanionLevels){window.MCJAdminCompanionLevels.reload();return;}
    adminFetch('/api/admin/companion-levels',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:'save_all',levels:collectCompanionLevelAdmin()})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'陪玩等级接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'保存失败');if(levelApi()&&result.levels)levelApi().hydrateFromList(result.levels);alert('已保存陪玩等级，全站将同步读取');}).catch(function(err){alert('保存失败：'+err.message);});
  }
  function renderCompanionLevelAdmin(){
    if(window.MCJAdminCompanionLevels)return;
    var target=document.getElementById('companionLevelSettings');
    if(!target||!levelApi())return;
    var levels=getLevels();
    target.innerHTML='<div class="table-wrap"><table class="level-settings-table"><thead><tr><th>排序</th><th>等级名称</th><th>等级图标</th><th>最低价格</th><th>最高价格</th><th>等级颜色</th><th>升级条件</th><th>是否开放申请</th><th>等级说明</th><th>状态</th><th>操作</th></tr></thead><tbody>'+levels.map(function(level){
      return '<tr data-level-admin-row="'+esc(level.id)+'">'+
        '<td><input data-level-admin-field="sort" value="'+esc(level.sort)+'" inputmode="numeric"></td>'+
        '<td><input data-level-admin-field="name" value="'+esc(level.name)+'"><small>'+esc(level.code)+'</small></td>'+
        '<td><input data-level-admin-field="icon" value="'+esc(level.icon)+'"></td>'+
        '<td><input data-level-admin-field="min" value="'+esc(level.min)+'" inputmode="numeric"></td>'+
        '<td><input data-level-admin-field="max" value="'+esc(level.max)+'" inputmode="numeric"></td>'+
        '<td><input data-level-admin-field="color" value="'+esc(level.color||level.levelColor||'#ff9ac9')+'"></td>'+
        '<td><textarea data-level-admin-field="upgradeCondition">'+esc(level.upgradeCondition||'')+'</textarea></td>'+
        '<td><select data-level-admin-field="open"><option value="true" '+(level.open?'selected':'')+'>开放</option><option value="false" '+(!level.open?'selected':'')+'>关闭</option></select></td>'+
        '<td><textarea data-level-admin-field="description">'+esc(level.description||'')+'</textarea></td>'+
        '<td><select data-level-admin-field="enabled"><option value="true" '+(level.enabled?'selected':'')+'>启用</option><option value="false" '+(!level.enabled?'selected':'')+'>停用</option></select></td>'+
        '<td><button class="btn small danger" data-delete-companion-level="'+esc(level.id)+'" type="button">删除</button><small>'+playerLevelCount(level)+' 位陪玩</small></td>'+
      '</tr>';
    }).join('')+'</tbody></table></div><div class="notice">陪玩不能自行修改等级；等级、价格范围、升级条件、开放申请和等级颜色只允许后台控制。保存会提交真实数据库接口，不写入本地假数据。</div>';
  }
  function collectCompanionLevelAdmin(){
    if(!levelApi())return [];
    return [].slice.call(document.querySelectorAll('[data-level-admin-row]')).map(function(row,index){
      var id=row.dataset.levelAdminRow;
      var base=levelApi().find(id);
      function field(name){var el=row.querySelector('[data-level-admin-field="'+name+'"]');return el?el.value:''}
      return Object.assign({},base,{id:id,level:base.level,code:base.code,name:field('name'),icon:field('icon'),min:Number(field('min')),max:Number(field('max')),color:field('color'),upgradeCondition:field('upgradeCondition'),description:field('description'),sort:Number(field('sort')||index+1),open:field('open')==='true',enabled:field('enabled')==='true'});
    });
  }
  var paymentTabs=[['channels','支付渠道'],['manual','手动收款'],['banks','银行账户'],['rates','汇率设置'],['webhooks','Webhook'],['records','支付记录']];
  var paymentStatuses=['未创建','待支付','支付处理中','支付成功','支付失败','已取消','退款处理中','已退款','部分退款','异常待处理'];
  var paymentEvents=['充值创建','支付成功','支付失败','充值到账','订单支付成功','退款成功','退款失败','提现审核通过','提现审核拒绝'];
  var paymentTemplates=[
    {id:'tng',name:"Touch 'n Go",icon:'TNG',currencies:'MYR',type:'手动收款',api:[]},
    {id:'duitnow',name:'DuitNow QR',icon:'QR',currencies:'MYR',type:'手动收款',api:[]},
    {id:'bank-my',name:'马来西亚银行转账',icon:'BANK',currencies:'MYR',type:'银行转账',api:[]},
    {id:'alipay',name:'支付宝',icon:'ALI',currencies:'CNY, MYR',type:'API / 手动收款',api:[['appId','App ID'],['merchantId','Merchant ID'],['privateKey','应用私钥'],['publicKey','支付宝公钥'],['apiEndpoint','网关地址'],['webhookUrl','回调地址']]},
    {id:'wechat',name:'微信支付',icon:'WX',currencies:'CNY, MYR',type:'API / 手动收款',api:[['appId','App ID'],['merchantId','Merchant ID'],['apiKey','API Key'],['apiSecret','API Secret'],['privateKey','Private Key'],['publicKey','Public Key'],['webhookUrl','Webhook URL']]},
    {id:'stripe',name:'Stripe',icon:'STR',currencies:'MYR, CNY, USD',type:'API 支付',api:[['publishableKey','Publishable Key'],['secretKey','Secret Key'],['webhookSecret','Webhook Secret'],['webhookUrl','Webhook URL']]},
    {id:'xendit',name:'Xendit',icon:'XEN',currencies:'MYR, PHP, IDR, USD',type:'API 支付',api:[['publicApiKey','Public API Key'],['secretApiKey','Secret API Key'],['callbackToken','Callback Token'],['webhookUrl','Webhook URL']]},
    {id:'hitpay',name:'HitPay',icon:'HIT',currencies:'MYR, SGD, USD',type:'API 支付',api:[['apiKey','API Key'],['salt','Salt'],['webhookUrl','Webhook URL']]}
  ];
  function paymentChannel(id){
    var tpl=paymentTemplates.find(function(item){return item.id===id})||paymentTemplates[0];
    return Object.assign({adminLabel:tpl.name,publicLabel:tpl.name,minAmount:'10',maxAmount:'5000',feeType:'none',fixedFee:'0',percentFee:'0',visible:false,enabled:false,configured:false,mode:'test',updatedAt:'-',credentialMasks:{},manual:{}},tpl);
  }
  function paymentStatusChip(text){
    var cls=/成功|已退款|已配置|已启用|启用/.test(text)?'ok':/失败|取消|异常|停用/.test(text)?'bad':/处理中|待支付|未创建|未配置/.test(text)?'wait':'info';
    return '<span class="status '+cls+'">'+esc(text)+'</span>';
  }
  function maskAccount(value){var text=String(value||'').replace(/\s+/g,'');return text?'**** '+text.slice(-4):'-'}
  function paymentTabsHtml(active){return '<div class="payment-tabs">'+paymentTabs.map(function(tab){return '<button type="button" class="'+(tab[0]===active?'active':'')+'" data-payment-tab="'+tab[0]+'">'+tab[1]+'</button>'}).join('')+'</div>'}
  function renderPaymentSettings(active,editId){
    var target=document.getElementById('paymentSettings');
    if(!target)return;
    if(window.MCJAdminPaymentSettings&&window.MCJAdminPaymentSettings.mount){
      window.MCJAdminPaymentSettings.mount();
      return;
    }
    // Never render local mock paymentTemplates as "已启用" — that lied to operators.
    target.innerHTML='<div class="payment-module-head"><h2>支付设置</h2><p class="admin-sync-note" style="color:#ff8aa0">真实支付模块未加载（admin-payment-settings.js）。禁止使用本地假模板启停。请刷新页面或检查脚本是否加载失败。</p></div>';
  }
  function paymentBody(active,editId){
    if(active==='manual')return renderPaymentManual();
    if(active==='banks')return renderPaymentBanks();
    if(active==='rates')return renderPaymentRates();
    if(active==='webhooks')return renderPaymentWebhooks();
    if(active==='records')return renderPaymentRecords();
    return renderPaymentChannels(editId);
  }
  function renderPaymentChannels(editId){
    var cards=paymentTemplates.map(function(tpl){var item=paymentChannel(tpl.id);return '<article class="payment-channel-card"><div class="payment-channel-icon">'+esc(item.icon)+'</div><div class="payment-channel-main"><h3>'+esc(item.name)+'</h3><p>'+esc(item.type)+' · '+esc(item.currencies)+'</p></div><div class="payment-card-meta">'+paymentStatusChip('未配置')+paymentStatusChip('已停用')+'<small>测试模式 · '+esc(item.updatedAt)+'</small></div><div class="payment-card-actions"><button class="mini-btn" type="button" data-payment-edit="'+esc(item.id)+'">编辑</button><button class="mini-btn" type="button" data-payment-toggle="'+esc(item.id)+'">启用</button></div></article>'}).join('');
    return '<div class="payment-channel-grid">'+cards+'</div>'+(editId?renderPaymentEditor(paymentChannel(editId)):'')+'<section class="panel payment-note"><h2>支付成功回调处理规则</h2><div class="payment-checks"><span>验证支付平台签名</span><span>验证订单编号</span><span>验证付款金额</span><span>验证币种</span><span>防止重复回调</span><span>更新充值记录</span><span>增加老板余额</span><span>更新累计消费与 VIP 进度</span><span>生成财务流水</span><span>记录第三方交易号</span><span>发送到账通知</span></div></section>';
  }
  function renderPaymentEditor(item){
    var api=item.api.length?'<section class="panel"><h2>API 配置</h2><div class="payment-field-grid">'+item.api.map(function(field){return '<label><span>'+esc(field[1])+'</span><div class="payment-secret-row"><input type="password" autocomplete="new-password" data-secret-field="'+esc(field[0])+'" placeholder="留空保持当前配置"><button type="button" class="mini-btn" data-payment-secret-toggle>显示</button></div><small>当前：未配置</small></label>'}).join('')+'</div><p class="payment-safe-copy">密钥只允许提交到服务器安全接口；前端不会保存完整密钥。</p></section>':'';
    return '<form class="payment-editor" data-payment-form="'+esc(item.id)+'"><section class="panel"><h2>基础设置</h2><div class="payment-field-grid"><label><span>支付方式名称</span><input name="name" value="'+esc(item.name)+'"></label><label><span>后台显示名称</span><input name="adminLabel" value="'+esc(item.name)+'"></label><label><span>前台显示名称</span><input name="publicLabel" value="'+esc(item.name)+'"></label><label><span>支持币种</span><input name="currencies" value="'+esc(item.currencies)+'"></label><label><span>最低充值金额</span><input name="minAmount" inputmode="decimal" value="10"></label><label><span>最高充值金额</span><input name="maxAmount" inputmode="decimal" value="5000"></label><label><span>手续费类型</span><select name="feeType"><option value="none">无手续费</option><option value="fixed">固定手续费</option><option value="percent">百分比手续费</option><option value="mixed">固定 + 百分比</option></select></label><label><span>固定手续费</span><input name="fixedFee" inputmode="decimal" value="0"></label><label><span>百分比手续费</span><input name="percentFee" inputmode="decimal" value="0"></label><label><span>是否前台显示</span><select name="visible"><option value="false">隐藏</option><option value="true">显示</option></select></label><label><span>是否启用</span><select name="enabled"><option value="false">停用</option><option value="true">启用</option></select></label><label class="wide"><span>支付说明</span><textarea name="instructions"></textarea></label></div></section><section class="panel"><h2>运行模式</h2><div class="payment-field-grid"><label><span>当前使用模式</span><select name="mode"><option value="test">测试模式</option><option value="live">正式模式</option></select></label><label><span>测试环境地址</span><input name="testEndpoint"></label><label><span>正式环境地址</span><input name="liveEndpoint"></label></div></section>'+api+'<section class="panel"><h2>手动收款配置</h2><div class="payment-field-grid"><label><span>收款方式名称</span><input name="manualName" value="'+esc(item.name)+'"></label><label><span>收款人姓名</span><input name="receiverName"></label><label><span>企业名称</span><input name="enterpriseName"></label><label><span>银行名称</span><input name="bankName"></label><label><span>银行账号</span><input name="bankAccount"></label><label><span>TNG 手机号</span><input name="tngPhone"></label><label><span>DuitNow ID</span><input name="duitNowId"></label><label><span>支付宝账号</span><input name="alipayAccount"></label><label><span>微信收款账号</span><input name="wechatAccount"></label><label><span>显示顺序</span><input name="sort" inputmode="numeric" value="0"></label><label class="wide"><span>收款二维码上传</span><input type="file" accept="image/*" name="qrImage"></label><label class="wide"><span>收款说明</span><textarea name="manualInstructions"></textarea></label></div></section><div class="form-actions"><button class="primary-btn" type="submit">保存配置</button><button class="ghost-btn" type="button" data-payment-cancel>取消</button><button class="ghost-btn" type="button" data-payment-test="'+esc(item.id)+'">测试配置</button></div></form>';
  }
  function renderPaymentManual(){
    var rows=paymentTemplates.filter(function(item){return /手动|银行|QR|转账/.test(item.type)}).map(function(item){return '<tr><td>'+esc(item.name)+'</td><td>未填写</td><td>-</td><td>-</td><td>未上传</td><td>'+paymentStatusChip('停用')+'</td><td><button class="mini-btn" type="button" data-payment-edit="'+esc(item.id)+'">编辑</button></td></tr>'}).join('');
    return table(['收款方式','收款人 / 企业','银行','账号','二维码','状态','操作'],rows);
  }
  function renderPaymentBanks(){
    return '<section class="panel"><h2>银行账户</h2><form class="payment-field-grid" data-payment-secure-form="bank"><label><span>银行名称</span><input name="bankName" required></label><label><span>户名</span><input name="accountName" required></label><label><span>企业名称</span><input name="enterpriseName"></label><label><span>银行账号</span><input name="accountNumber" required></label><label><span>SWIFT Code</span><input name="swift"></label><label><span>分行名称</span><input name="branch"></label><label><span>账户币种</span><input name="currency" value="MYR"></label><label><span>收款用途</span><input name="usage" value="充值收款"></label><label><span>是否默认账户</span><select name="isDefault"><option value="false">否</option><option value="true">是</option></select></label><label><span>是否启用</span><select name="enabled"><option value="false">停用</option><option value="true">启用</option></select></label><div class="form-actions wide"><button class="primary-btn" type="submit">保存银行账户</button></div></form></section>'+table(['银行','户名','企业','账号','币种','默认','状态','操作'],[]);
  }
  function renderPaymentRates(){
    return '<section class="panel"><h2>MYR / CNY</h2><form class="payment-field-grid" data-payment-secure-form="rate"><label><span>基础币种</span><input name="base" value="MYR"></label><label><span>目标币种</span><input name="target" value="CNY"></label><label><span>当前接口汇率</span><input name="apiRate" inputmode="decimal"></label><label><span>自动更新</span><select name="auto"><option value="false">关闭</option><option value="true">开启</option></select></label><label><span>手动汇率</span><input name="manualRate" inputmode="decimal"></label><label><span>汇率浮动加成 %</span><input name="markup" inputmode="decimal" value="0"></label><label><span>汇率更新时间</span><input name="updatedAt" value="-"></label><label><span>前台最终使用汇率</span><input readonly value="-"></label><div class="form-actions wide"><button class="primary-btn" type="submit">保存汇率</button></div></form></section>';
  }
  function renderPaymentWebhooks(){
    var rows=paymentEvents.map(function(event){return '<tr><td>'+esc(event)+'</td><td><input class="inline-input" data-webhook-url="'+esc(event)+'"></td><td><input class="inline-input" type="password" data-webhook-secret="'+esc(event)+'" placeholder="未配置"></td><td>'+paymentStatusChip('停用')+'</td><td>-</td><td>-</td><td>-</td><td><button class="mini-btn" data-webhook-save="'+esc(event)+'" type="button">保存</button><button class="mini-btn" data-webhook-test="'+esc(event)+'" type="button">测试</button></td></tr>'}).join('');
    return '<section class="panel"><h2>Webhook 管理</h2>'+table(['事件名称','Webhook URL','Secret','状态','最近调用','最近状态','状态码','操作'],rows)+'</section>'+table(['时间','事件','URL','状态','状态码'],[]);
  }
  function renderPaymentRecords(){
    return '<div class="toolbar"><input placeholder="UID / 平台订单号 / 第三方交易号"><select>'+paymentStatuses.map(function(s){return '<option>'+s+'</option>'}).join('')+'</select><select><option>全部渠道</option>'+paymentTemplates.map(function(c){return '<option>'+esc(c.name)+'</option>'}).join('')+'</select><select><option>全部币种</option><option>MYR</option><option>CNY</option><option>USD</option></select></div>'+table(['平台订单号','第三方交易号','老板 UID','支付方式','币种','金额','手续费','实际到账','状态','支付时间','创建时间','回调状态','操作'],[]);
  }
  function submitSecurePayment(form){
    var endpoint='/api/admin/payment-settings';
    var data={type:form.dataset.paymentForm?'channel':form.dataset.paymentSecureForm||'unknown',channelId:form.dataset.paymentForm||'',fields:{}};
    new FormData(form).forEach(function(value,key){data.fields[key]=value instanceof File?{name:value.name,size:value.size,type:value.type}:value});
    fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}).then(function(res){return res.json().catch(function(){return {ok:false,message:'支付安全接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'保存失败');alert('已提交到支付安全接口');renderPaymentSettings(form.closest('#paymentSettings').dataset.currentPaymentTab||'channels');}).catch(function(err){alert('保存失败：'+err.message+'。配置没有写入浏览器本地数据。');});
  }
  var couponState={items:[],configured:false,error:'',filter:'',keyword:''};
  function couponDraft(item){return contentDraft(item)}
  function couponStatus(item){var draft=couponDraft(item);var end=draft.endAt||draft.endDate||'';if(end&&new Date(end+'T23:59:59').getTime()<Date.now())return '已过期';if(item.enabled===false||item.status==='disabled'||item.status==='unpublished')return '已停用';return '启用'}
  function couponTypeLabel(type){return type==='fixed'?'固定金额减免':type==='discount'?'折扣券':type==='cat_food'?'赠送猫粮':(type||'-')}
  function couponValueText(draft){if(draft.type==='fixed')return '减免 '+esc(draft.value||0)+' 猫粮';if(draft.type==='discount')return esc(draft.value||0)+' 折';if(draft.type==='cat_food')return '赠送 '+esc(draft.value||0)+' 猫粮';return '-'}
  function couponThresholdText(value){var v=String(value||'0').trim();return !v||v==='0'?'无门槛':'满 '+esc(v)+' 猫粮 可用'}
  function couponPeriodText(draft){return (draft.startAt||'-')+' 至 '+(draft.endAt||'-')}
  function couponVisibleItems(){var keyword=(couponState.keyword||'').toLowerCase();return couponState.items.filter(function(item){var draft=couponDraft(item);var status=couponStatus(item);var text=[item.title,draft.name,draft.code,draft.type].join(' ').toLowerCase();return (!couponState.filter||status===couponState.filter)&&(!keyword||text.indexOf(keyword)>-1);});}
  function renderCouponManagement(){var target=document.getElementById('couponManagement');if(!target)return;target.innerHTML='<div class="content-loading">正在读取真实优惠券数据...</div>';adminFetch('/api/admin/platform-content?type=marketing_coupons',{headers:adminApiHeaders()}).then(function(res){var ct=res.headers.get('content-type')||'';if(ct.indexOf('application/json')<0)return {ok:true,configured:false,items:[],message:'本地 API 未启用'};return res.json();}).then(function(result){if(result&&result.ok===false)throw new Error(result.message||'优惠券读取失败');couponState.items=result.items||[];couponState.configured=result.configured!==false;couponState.error=result.configured===false?(result.message||'未配置真实持久化数据源'):'';target.innerHTML=couponPageHtml();}).catch(function(err){couponState.items=[];couponState.configured=false;couponState.error=err.message||String(err);target.innerHTML=couponPageHtml();});}
  function couponPageHtml(){var items=couponVisibleItems();var rows=items.map(function(item){var draft=couponDraft(item);var status=couponStatus(item);return '<tr><td><strong>'+esc(draft.name||item.title||'-')+'</strong><small>'+esc(draft.code||'-')+'</small></td><td>'+esc(couponTypeLabel(draft.type))+'</td><td>'+couponValueText(draft)+'</td><td>'+couponThresholdText(draft.threshold)+'</td><td>'+esc(couponPeriodText(draft))+'</td><td>'+esc(draft.totalLimit||'不限量')+'</td><td>'+esc(draft.claimedCount||0)+'</td><td>'+esc(draft.usedCount||0)+'</td><td>'+statusChip(status)+'</td><td><div class="coupon-actions"><button class="mini-btn" type="button" data-coupon-edit="'+esc(item.id)+'">编辑</button><button class="mini-btn '+(status==='启用'?'danger-btn':'primary-lite')+'" type="button" data-coupon-toggle="'+esc(item.id)+'" data-coupon-enabled="'+(status==='启用'?'false':'true')+'">'+(status==='启用'?'停用':'启用')+'</button></div></td></tr>';}).join('');return '<div class="coupon-admin"><div class="coupon-admin-head"><div><h2>优惠券管理</h2><p>创建、启用和管理用户可领取或由后台发放的优惠券。</p></div><button class="btn primary" type="button" data-coupon-new>新建优惠券</button></div><div class="coupon-toolbar"><select data-coupon-filter><option value="">全部状态</option><option value="启用" '+(couponState.filter==='启用'?'selected':'')+'>启用</option><option value="已停用" '+(couponState.filter==='已停用'?'selected':'')+'>已停用</option><option value="已过期" '+(couponState.filter==='已过期'?'selected':'')+'>已过期</option></select><input data-coupon-search placeholder="搜索优惠券名称或优惠码" value="'+esc(couponState.keyword||'')+'"></div><div class="coupon-editor" data-coupon-editor hidden></div><div class="coupon-table-wrap"><table><thead><tr><th>优惠券名称</th><th>优惠类型</th><th>优惠内容</th><th>使用门槛</th><th>有效期</th><th>发放总量</th><th>已领取</th><th>已使用</th><th>状态</th><th>操作</th></tr></thead><tbody>'+(rows||'<tr><td colspan="10"><div class="coupon-empty"><strong>暂无优惠券</strong><span>创建后会保存到真实持久化数据源。</span></div></td></tr>')+'</tbody></table></div>'+(couponState.error?'<div class="admin-sync-note">'+esc(couponState.error)+'。当前页面不会写入 localStorage。</div>':'')+'</div>';}
  function couponCodeExists(code,id){code=String(code||'').trim().toLowerCase();if(!code)return false;return couponState.items.some(function(item){var draft=couponDraft(item);return String(draft.code||'').trim().toLowerCase()===code&&String(item.id||'')!==String(id||'');});}
  function couponById(id){return couponState.items.find(function(item){return String(item.id)===String(id)})||null}
  function openCouponEditor(id){var target=document.querySelector('[data-coupon-editor]');if(!target)return;var item=id?couponById(id):null;var draft=item?couponDraft(item):{};var code=draft.code||('MCJ'+Date.now().toString().slice(-8));target.hidden=false;target.innerHTML='<form class="coupon-form" data-coupon-form data-coupon-id="'+esc(item&&item.id||'')+'"><div class="coupon-editor-head"><div><h3>'+(item?'编辑优惠券':'新建优惠券')+'</h3><p>保存后写入真实持久化数据源。</p></div><button class="btn" type="button" data-coupon-cancel>关闭</button></div><div class="coupon-form-grid"><label><span>优惠券名称</span><input name="name" required value="'+esc(draft.name||item&&item.title||'')+'" placeholder="新人 RM10 猫粮券"></label><label><span>优惠码</span><input name="code" required value="'+esc(code)+'"></label><label><span>优惠类型</span><select name="type"><option value="fixed" '+(draft.type==='fixed'?'selected':'')+'>固定金额减免</option><option value="discount" '+(draft.type==='discount'?'selected':'')+'>折扣券</option><option value="cat_food" '+(draft.type==='cat_food'?'selected':'')+'>赠送猫粮</option></select></label><label><span>优惠内容</span><input name="value" required inputmode="decimal" value="'+esc(draft.value||'')+'" placeholder="金额 / 折扣 / 猫粮数量"></label><label><span>最低使用门槛</span><input name="threshold" inputmode="decimal" value="'+esc(draft.threshold||0)+'" placeholder="0 表示无门槛"></label><label><span>使用范围</span><select name="scope"><option value="cat_food_recharge" '+(draft.scope==='cat_food_recharge'?'selected':'')+'>猫粮充值</option><option value="all" '+(draft.scope==='all'?'selected':'')+'>全平台</option></select></label><label><span>开始日期</span><input name="startAt" type="date" required value="'+esc(draft.startAt||'')+'"></label><label><span>结束日期</span><input name="endAt" type="date" required value="'+esc(draft.endAt||'')+'"></label><label><span>发放总量</span><input name="totalLimit" inputmode="numeric" value="'+esc(draft.totalLimit||'')+'" placeholder="留空为不限量"></label><label><span>每位用户领取上限</span><input name="claimLimitPerUser" inputmode="numeric" value="'+esc(draft.claimLimitPerUser||1)+'"></label><label><span>每位用户使用上限</span><input name="useLimitPerUser" inputmode="numeric" value="'+esc(draft.useLimitPerUser||1)+'"></label><label><span>领取方式</span><select name="claimMethod"><option value="public" '+(draft.claimMethod==='public'?'selected':'')+'>用户公开领取</option><option value="manual" '+(draft.claimMethod==='manual'?'selected':'')+'>后台手动发放</option></select></label><label><span>显示状态</span><select name="enabled"><option value="true" '+(item&&item.enabled===false?'':'selected')+'>启用</option><option value="false" '+(item&&item.enabled===false?'selected':'')+'>停用</option></select></label></div><div class="form-actions"><button class="btn primary" type="submit">保存优惠券</button><button class="btn" type="button" data-coupon-cancel>取消</button></div></form>';}
  function collectCouponForm(form){var draft={};new FormData(form).forEach(function(value,key){draft[key]=value;});draft.code=String(draft.code||'').trim();draft.name=String(draft.name||'').trim();draft.claimedCount=Number(draft.claimedCount||0);draft.usedCount=Number(draft.usedCount||0);return {title:draft.name,status:draft.enabled==='false'?'disabled':'published',enabled:draft.enabled!=='false',sort:100,draft:draft};}
  function submitCouponForm(form){var id=form.dataset.couponId||'';var payload=collectCouponForm(form);if(!payload.draft.name){alert('请填写优惠券名称');return;}if(!payload.draft.code){alert('请填写优惠码');return;}if(couponCodeExists(payload.draft.code,id)){alert('优惠码不能重复');return;}if(!payload.draft.startAt||!payload.draft.endAt){alert('请选择有效期');return;}adminFetch('/api/admin/platform-content',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:id?'save':'create',type:'marketing_coupons',id:id,payload:payload})}).then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(e){throw new Error('优惠券接口返回非 JSON：HTTP '+res.status)}if(!res.ok||body.ok===false)throw new Error(body.message||('HTTP '+res.status));return body;})}).then(function(){alert('优惠券已保存');renderCouponManagement();}).catch(function(err){console.error('[优惠券管理] 保存失败',{error:err});alert('保存失败：'+err.message+'。未写入 localStorage。');});}
  function toggleCoupon(id,enabled){var item=couponById(id);if(!item)return;var draft=Object.assign({},couponDraft(item));var payload={title:draft.name||item.title,status:enabled?'published':'disabled',enabled:enabled,sort:item.sort||100,draft:draft};adminFetch('/api/admin/platform-content',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:'save',type:'marketing_coupons',id:id,payload:payload})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'优惠券接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'操作失败');renderCouponManagement();}).catch(function(err){console.error('[优惠券管理] 启停失败',{error:err});alert('操作失败：'+err.message+'。未写入 localStorage。');});}
  var platformContentModules={
    games:{target:'gameManagement',title:'服务管理',type:'games',desc:'已迁移至服务管理模块（无图片字段）。',fields:['name','category','showOnHome','allowApply','allowOrder','sort'],disabled:true},
    'service-types':{target:'serviceTypeManagement',title:'服务类型管理',type:'service_types',desc:'新增、编辑、删除、排序、启用/停用服务类型；保存后同步陪玩大厅筛选、申请陪玩、老板下单、客服建单、固定单和抢单大厅。',fields:['name','game','allGames','description','icon','fixedPrice','minPrice','maxPrice','unit','allowCustomOrder','allowGrab','showInHallFilter','sort']},
    'companion-tags':{target:'companionTagManagement',title:'陪玩标签管理',type:'companion_tags',desc:'已迁移至专用陪玩标签管理模块。',fields:['name','group','selfSelectable','requiresAudit','showInHall','supportsFilter','sort'],disabled:true},
    'companion-levels':{target:'companionLevelSettings',title:'陪玩等级管理',type:'companion_levels',desc:'已迁移至专用陪玩等级管理模块。',fields:['code','name','minPrice','maxPrice','icon','cardStyle','description','commissionRate','sort'],disabled:true},
    'featured-players':{target:'featuredPlayerManagement',title:'推荐陪玩管理',type:'featured_players',desc:'选择首页展示的推荐陪玩，控制排序、推荐理由和显示状态。',fields:['companionUid','nickname','reason','showOnHome','sort']},
    'hot-games':{target:'hotGameManagement',title:'热门游戏管理',type:'hot_games',desc:'管理首页热门游戏入口，支持新增、编辑、删除、排序和启用/停用。',fields:['name','game','icon','cover','description','showOnHome','sort']},
    banners:{target:'crud-banners',title:'Banner 管理',type:'banners',desc:'已迁移至专用 Banner 上传管理模块。',fields:['title','desktopImage','mobileImage','link','linkTarget','sort','startAt','endAt','autoPlay','intervalSeconds'],disabled:true},
    announcements:{target:'table-announcements',title:'公告管理',type:'announcements',desc:'对应首页 Banner 下方公告，前台按后台排序和时间播放。',fields:['content','link','sort','startAt','endAt','displayMode']},
    ads:{target:'crud-ads',title:'广告位管理',type:'ad_slots',desc:'同步首页、陪玩大厅、组队大厅、充值中心等广告位。',fields:['title','subtitle','image','link','position','sort','startAt','endAt','carousel','official']},
    'team-lobby-links':{target:'teamLobbySettings',title:'组队大厅管理',type:'team_lobby_channels',desc:'已迁移至组队大厅管理（启用/跳转链接）。',fields:['image','name','description','discordUrl','sort'],disabled:true},
    'meow-butler':{target:'table-meow_butler',title:'喵管家管理',type:'customer_service_widget',desc:'控制首页和老板端右下角客服浮窗。',fields:['displayName','icon','welcomeText','onlineStatus','businessHours','offlineText','clickBehavior','defaultChannel','showRedDot','globalVisible']},
    'sync-center':{target:'table-sync_center',title:'全端功能同步',type:'system_content_versions',desc:'查看各内容模块后台版本、前台版本、发布时间和同步状态。',fields:['moduleName','backendVersion','frontendVersion','syncStatus','publishedBy','publishedAt']},
    'price-table':{target:'table-price_table',title:'俱乐部价格表管理',type:'club_price_tables',desc:'同步陪玩价格范围、下单页面、自定义订单和陪玩端定价限制。',fields:['game','serviceType','level','minPrice','maxPrice','defaultPrice','unit','nightPrice','holidayPrice','sort']},
    gameplays:{target:'table-gameplays',title:'更多玩法商城管理',type:'fixed_play_services',desc:'已迁移至更多玩法商城商品管理模块。',fields:['name','game','category','cover','intro','fixedPrice','unit','duration','requirements','levelRequired','needQualification','showOnHome','sort'],disabled:true},
    'custom-order-settings':{target:'table-custom_orders',title:'自定义订单设置',type:'custom_order_fields',desc:'配置老板自定义订单页面字段，发布后前台表单同步。',fields:['fieldKey','fieldName','placeholder','fieldType','required','visible','options','min','max','sort']},
    'gameplay-qualifications':{target:'table-gameplay_qualifications',title:'玩法资格审核',type:'gameplay_qualifications',desc:'管理陪玩固定玩法服务资格，审核后同步抢单和建单权限。',fields:['applicationId','uid','nickname','gameplay','materials','auditStatus','reviewer','remark']},
    'companion-rules':{target:'table-companion_rules',title:'陪玩申请制度',type:'player_rules',desc:'编辑标题、正文后保存并应用，陪玩申请第 1 步立即读取最新内容。',fields:['title','body','versionNote','notes','penaltyRules','depositRules','sort']},
    'voice-types':{target:'table-voice_types',title:'声音类型管理',type:'voice_types',desc:'同步陪玩申请、陪玩资料编辑、陪玩大厅筛选和陪玩详情。',fields:['name','description','sort']},
    'availability-times':{target:'availabilityTimeManagement',title:'可接单时间配置',type:'availability_times',desc:'配置上午、下午、晚上、深夜和自定义时间段，陪玩申请和资料编辑同步读取。',fields:['name','weekdays','startTime','endTime','sort']},
    'vip-levels':{target:'vipLevelManagement',title:'VIP等级管理',type:'vip_levels',desc:'管理老板 VIP 等级、累计消费门槛、权益、优惠券权益和客服优先级。',fields:['code','name','spendThreshold','icon','description','benefits','couponBenefits','servicePriority','sort']},
    badges:{target:'badgeManagement',title:'徽章 / 身份组管理',type:'badges',desc:'管理老板、陪玩、客服、管理员身份组和前台徽章展示。',fields:['icon','name','description','condition','role','showPublic','sort']},
    'companion-deposit':{target:'table-companion_deposit',title:'陪玩押金设置',type:'player_deposit_settings',desc:'同步陪玩申请和陪玩端认证页面，默认可配置 RM100。',fields:['amount','currency','manualRate','paymentDescription','paymentMethod','refundTerms','refundDescription','auditRequirement']},
    'companion-applications':{target:'table-companion_applications',title:'陪玩申请审核',type:'player_applications',desc:'真实审核工作台，审核通过后开通陪玩端权限。',fields:['applicationNo','uid','nickname','contact','identityDocs','gameProfile','avatar','gallery','voiceSample','depositStatus','auditStatus','reviewer','reviewRemark','level','priceRange','commission','rebate','club'],disabled:true}
  };
  function contentFieldLabel(key){
    var map={title:'标题',desktopImage:'电脑端图片',mobileImage:'手机端图片',link:'跳转地址',discordUrl:'Discord 链接',linkTarget:'打开方式',sort:'排序',startAt:'开始时间',endAt:'结束时间',autoPlay:'自动轮播',intervalSeconds:'轮播秒数',content:'公告内容',displayMode:'展示方式',subtitle:'副标题',image:'广告图',position:'展示位置',carousel:'是否轮播',official:'官方精选',displayName:'显示名称',icon:'图标',welcomeText:'欢迎文案',onlineStatus:'在线状态',businessHours:'营业时间',offlineText:'未营业提示',clickBehavior:'点击行为',defaultChannel:'默认客服频道',showRedDot:'显示红点',globalVisible:'全站显示',moduleName:'模块名称',backendVersion:'后台版本',frontendVersion:'前台版本',syncStatus:'同步状态',publishedBy:'发布人',publishedAt:'发布时间',game:'游戏',serviceType:'服务类型',level:'等级',minPrice:'最低价格',maxPrice:'最高价格',defaultPrice:'默认价格',unit:'计价单位',nightPrice:'夜间价格',holidayPrice:'节假日价格',name:'名称',category:'分类',cover:'封面',intro:'简介',fixedPrice:'固定价格',duration:'服务时长',requirements:'资格要求',levelRequired:'接单等级',needQualification:'需要资格审核',showOnHome:'首页显示',fieldKey:'字段 Key',fieldName:'字段名称',placeholder:'提示文字',fieldType:'字段类型',required:'必填',visible:'显示',options:'选项内容',min:'最小值',max:'最大值',applicationId:'申请编号',uid:'UID',nickname:'昵称',gameplay:'玩法',materials:'资料',auditStatus:'审核状态',reviewer:'审核人',remark:'备注',body:'正文内容',versionNote:'版本 / 更新说明',notes:'注意事项',penaltyRules:'处罚规则',depositRules:'退款与押金规则',description:'说明',amount:'押金金额',currency:'币种',manualRate:'手动汇率',paymentDescription:'支付说明',paymentMethod:'支付方式',refundTerms:'退款条件',refundDescription:'退款说明',auditRequirement:'审核要求',applicationNo:'申请编号',contact:'联系方式',identityDocs:'身份证资料',gameProfile:'游戏资料',avatar:'头像',gallery:'相册',voiceSample:'录音',depositStatus:'押金状态',reviewRemark:'审核备注',priceRange:'价格范围',commission:'佣金',rebate:'返点',club:'所属俱乐部',slug:'标识',group:'分组',code:'等级编号',cardColor:'卡片颜色',commissionRate:'抽成比例',maxPlus:'最高价以上',companionUid:'陪玩UID',reason:'推荐理由',showOnHome:'首页展示',shortName:'游戏简称',terminalType:'终端类型',isHot:'是否热门',allowApply:'申请可选',allowOrder:'订单可选',allGames:'适用全部游戏',fixedPrice:'固定价格',allowCustomOrder:'允许自定义订单',allowGrab:'允许抢单',showInHallFilter:'大厅筛选显示',selfSelectable:'允许陪玩选择',requiresAudit:'需要后台审核',showInHall:'大厅展示',supportsFilter:'支持筛选',cardStyle:'卡片样式标识',giftCommissionRate:'礼物抽成',directRebateRate:'直属陪返点',weekdays:'星期',startTime:'开始时间',endTime:'结束时间',spendThreshold:'累计消费门槛',benefits:'优惠权益',couponBenefits:'优惠券权益',servicePriority:'客服优先级',condition:'获取条件',role:'适用角色',showPublic:'前台展示'};
    return map[key]||key;
  }
  function contentDraft(item){return item&&typeof item.draft==='object'&&item.draft?item.draft:{}}
  function contentPublished(item){return item&&typeof item.published==='object'&&item.published?item.published:{}}
  function contentMergedData(item){return Object.assign({},contentPublished(item),contentDraft(item),{id:item&&item.id,title:item&&item.title,status:item&&item.status,enabled:item&&item.enabled,sort:item&&item.sort,updated_at:item&&item.updated_at});}
  function isBaseDataType(type){return ['games','service_types','companion_levels','companion_tags','voice_types','availability_times','vip_levels','badges'].indexOf(type)>-1}
  function isProtectedBaseData(type){return ['games','service_types','companion_levels','companion_tags','voice_types','availability_times','vip_levels','badges'].indexOf(type)>-1}
  function flagText(value){return value===true||value==='true'||value==='1'||value==='是'||value==='开启'||value==='显示'?'是':'否'}
  function baseDataStatus(item){return item&&item.enabled!==false&&item.status!=='disabled'&&item.status!=='unpublished'?'启用':'停用'}
  function baseDataActions(cfg,item){return '<div class="content-row-actions compact"><button class="mini-btn" data-content-action="edit" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">编辑</button><button class="mini-btn primary-lite" data-content-action="publish" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">启用</button><button class="mini-btn" data-content-action="disable" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">停用</button><button class="mini-btn danger-btn" data-content-action="delete" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">删除</button></div>'}
  function renderBaseDataShell(cfg,items,meta){
    items=(items||[]).slice().sort(function(a,b){var da=contentMergedData(a),db=contentMergedData(b);return Number(da.sort||100)-Number(db.sort||100)});
    var headers=[],rows=[];
    if(cfg.type==='games'){
      headers=['游戏图标','游戏名称','游戏简称','游戏分类','终端类型','是否热门','首页展示','申请可选','订单可选','状态','排序','更新时间','操作'];
      rows=items.map(function(item){var d=contentMergedData(item);return '<tr data-content-id="'+esc(item.id)+'"><td>'+(d.icon?'<img class="content-thumb" src="'+esc(d.icon)+'" alt="">':'-')+'</td><td>'+esc(d.name||item.title||'-')+'</td><td>'+esc(d.shortName||'-')+'</td><td>'+esc(d.category||'-')+'</td><td>'+esc(d.terminalType||'全部')+'</td><td>'+statusChip(flagText(d.isHot))+'</td><td>'+statusChip(flagText(d.showOnHome))+'</td><td>'+statusChip(flagText(d.allowApply))+'</td><td>'+statusChip(flagText(d.allowOrder))+'</td><td>'+statusChip(baseDataStatus(item))+'</td><td>'+esc(d.sort||100)+'</td><td>'+esc(item.updated_at||'-')+'</td><td>'+baseDataActions(cfg,item)+'</td></tr>';});
    } else if(cfg.type==='service_types'){
      headers=['类型名称','所属游戏','计价方式','价格范围','自定义订单','抢单','大厅显示','状态','排序','操作'];
      rows=items.map(function(item){var d=contentMergedData(item);var range=(d.minPrice||d.maxPrice)?('RM'+(d.minPrice||0)+'–'+(d.maxPrice||'')):'-';return '<tr data-content-id="'+esc(item.id)+'"><td>'+esc(d.name||item.title||'-')+'</td><td>'+esc(flagText(d.allGames)==='是'?'全部游戏':(d.game||'-'))+'</td><td>'+esc(d.fixedPrice==='true'||d.fixedPrice===true?'固定价格':'区间计价')+'</td><td>'+esc(range)+'</td><td>'+statusChip(flagText(d.allowCustomOrder))+'</td><td>'+statusChip(flagText(d.allowGrab))+'</td><td>'+statusChip(flagText(d.showInHallFilter))+'</td><td>'+statusChip(baseDataStatus(item))+'</td><td>'+esc(d.sort||100)+'</td><td>'+baseDataActions(cfg,item)+'</td></tr>';});
    } else {
      headers=['名称','分组/编号','说明','状态','排序','更新时间','操作'];
      rows=items.map(function(item){var d=contentMergedData(item);return '<tr data-content-id="'+esc(item.id)+'"><td>'+esc(d.name||d.title||d.code||'-')+'</td><td>'+esc(d.group||d.code||d.role||'-')+'</td><td>'+esc(d.description||d.benefits||d.condition||'-')+'</td><td>'+statusChip(baseDataStatus(item))+'</td><td>'+esc(d.sort||100)+'</td><td>'+esc(item.updated_at||'-')+'</td><td>'+baseDataActions(cfg,item)+'</td></tr>';});
    }
    return '<div class="platform-content-admin base-data-admin" data-platform-content="'+esc(cfg.type)+'"><div class="content-admin-head"><div><h3>'+esc(cfg.title)+'</h3><p>'+esc(cfg.desc)+'</p></div><div class="content-version-meta"><span>最近保存：'+esc(meta&&meta.savedAt||'-')+'</span><span>前台同步：'+esc(meta&&meta.sync||'暂无数据')+'</span></div></div><div class="content-admin-toolbar compact"><input data-content-search="'+esc(cfg.type)+'" placeholder="搜索名称 / 状态 / 内容"><button class="btn primary" data-content-action="new" data-content-type="'+esc(cfg.type)+'" type="button">新增</button><button class="btn" data-content-action="reload" data-content-type="'+esc(cfg.type)+'" type="button">刷新</button></div><div class="content-editor" data-content-editor="'+esc(cfg.type)+'" hidden></div>'+table(headers,rows)+(items.length?'':'<div class="content-empty-action"><strong>暂无数据</strong><span>请新增内容并保存应用，前台会读取同一份后台数据。</span><button class="btn primary" data-content-action="new" data-content-type="'+esc(cfg.type)+'" type="button">新增</button></div>')+'</div>';
  }
  function contentFieldOptions(cfg,field){
    var boolMap={
      isHot:[['true','是'],['false','否']],
      showOnHome:[['true','显示'],['false','隐藏']],
      allowApply:[['true','开启'],['false','关闭']],
      allowOrder:[['true','开启'],['false','关闭']],
      allGames:[['true','是'],['false','否']],
      fixedPrice:[['true','是'],['false','否']],
      allowCustomOrder:[['true','允许'],['false','不允许']],
      allowGrab:[['true','允许'],['false','不允许']],
      showInHallFilter:[['true','显示'],['false','隐藏']],
      selfSelectable:[['true','是'],['false','否']],
      requiresAudit:[['true','是'],['false','否']],
      showInHall:[['true','显示'],['false','隐藏']],
      supportsFilter:[['true','是'],['false','否']],
      maxPlus:[['true','是'],['false','否']],
      showPublic:[['true','显示'],['false','隐藏']]
    };
    if(boolMap[field])return boolMap[field];
    if(field==='terminalType')return [['全部','全部'],['端游','端游'],['手游','手游']];
    if(field==='unit')return [['小时','小时'],['单次','单次'],['局','局'],['天','天']];
    if(field==='role')return [['老板','老板'],['陪玩','陪玩'],['客服','客服'],['管理员','管理员']];
    return null;
  }
  function isBoolContentField(field){
    return ['isHot','showOnHome','allowApply','allowOrder','allGames','fixedPrice','allowCustomOrder','allowGrab','showInHallFilter','selfSelectable','requiresAudit','showInHall','supportsFilter','maxPlus','showPublic'].indexOf(field)>-1;
  }
  function normalizeContentDraftValue(key,value){
    if(['isHot','showOnHome','allowApply','allowOrder','allGames','fixedPrice','allowCustomOrder','allowGrab','showInHallFilter','selfSelectable','requiresAudit','showInHall','supportsFilter','maxPlus','showPublic'].indexOf(key)>-1)return value==='true'||value===true;
    if(['sort','minPrice','maxPrice','commissionRate','giftCommissionRate','directRebateRate','spendThreshold','servicePriority'].indexOf(key)>-1&&value!=='')return Number(value);
    return value;
  }
  function filterPlatformContentRows(input){var wrap=input.closest('[data-platform-content]');if(!wrap)return;var q=String(input.value||'').trim().toLowerCase();wrap.querySelectorAll('tbody tr').forEach(function(row){row.hidden=!!(q&&row.textContent.toLowerCase().indexOf(q)===-1);});}

  function bannerDataFromItem(item){
    item=item||{};
    var draft=contentDraft(item), published=contentPublished(item);
    var data=Object.assign({},published,draft);
    data.id=item.id||'';
    data.title=data.title||item.title||'';
    data.sort=item.sort!=null?item.sort:(data.sort||1);
    data.enabled=item.enabled!==false;
    data.status=item.status||'published';
    return data;
  }
  var LOCAL_BANNER_DB='mcj_local_banner_assets_v1';
  var LOCAL_BANNER_STORE='images';
  function isLocalBannerImage(url){return String(url||'').indexOf('mcj-local-banner://')===0}
  function openLocalBannerDb(){return new Promise(function(resolve,reject){if(!window.indexedDB){reject(new Error('当前浏览器不支持 IndexedDB'));return;}var req=indexedDB.open(LOCAL_BANNER_DB,1);req.onupgradeneeded=function(){var db=req.result;if(!db.objectStoreNames.contains(LOCAL_BANNER_STORE))db.createObjectStore(LOCAL_BANNER_STORE,{keyPath:'id'});};req.onsuccess=function(){resolve(req.result)};req.onerror=function(){reject(req.error||new Error('IndexedDB 打开失败'))};});}
  function saveLocalBannerImage(file,dataUrl){return openLocalBannerDb().then(function(db){return new Promise(function(resolve,reject){var id='banner-'+Date.now()+'-'+Math.random().toString(16).slice(2);var tx=db.transaction(LOCAL_BANNER_STORE,'readwrite');tx.objectStore(LOCAL_BANNER_STORE).put({id:id,fileName:file.name,mimeType:file.type,size:file.size,dataUrl:dataUrl,createdAt:new Date().toISOString(),localOnly:true});tx.oncomplete=function(){db.close();resolve('mcj-local-banner://'+id)};tx.onerror=function(){db.close();reject(tx.error||new Error('本地图片保存失败'))};});});}
  function readLocalBannerImage(url){var id=String(url||'').replace('mcj-local-banner://','');if(!id)return Promise.resolve('');return openLocalBannerDb().then(function(db){return new Promise(function(resolve,reject){var tx=db.transaction(LOCAL_BANNER_STORE,'readonly');var req=tx.objectStore(LOCAL_BANNER_STORE).get(id);req.onsuccess=function(){db.close();resolve(req.result&&req.result.dataUrl||'')};req.onerror=function(){db.close();reject(req.error||new Error('本地图片读取失败'))};});});}
  function setBannerPreviewBox(box,url){if(!box)return;box.dataset.bannerPreviewSrc=url||'';if(!url){box.innerHTML='<div class="banner-simple-placeholder">暂无 Banner，请上传图片</div>';return;}if(isLocalBannerImage(url)){box.innerHTML='<div class="banner-simple-placeholder">正在读取本地测试图片...</div>';readLocalBannerImage(url).then(function(src){box.innerHTML=src?'<img src="'+esc(src)+'" alt="">':'<div class="banner-simple-placeholder">本地图片不存在，请重新上传</div>';}).catch(function(err){console.error('[Banner 管理] 本地图片预览失败',{url:url,error:err});box.innerHTML='<div class="banner-simple-placeholder">本地图片读取失败，请重新上传</div>';});return;}box.innerHTML='<img src="'+esc(url)+'" alt="">';}
  function resolveBannerSimplePreviews(root){(root||document).querySelectorAll('[data-banner-preview-src]').forEach(function(box){setBannerPreviewBox(box,box.dataset.bannerPreviewSrc||'')});}
  function bannerPreviewBox(label,field,url){
    return '<div class="banner-simple-preview-block"><div class="banner-simple-preview-head"><span>'+esc(label)+'</span><small>'+esc(field==='desktopImage'?'推荐尺寸：1920 × 700':'手机端图片，可选')+'</small></div><div class="banner-simple-preview-media" data-banner-preview="'+esc(field)+'" data-banner-preview-src="'+esc(url||'')+'">'+(url?(isLocalBannerImage(url)?'<div class="banner-simple-placeholder">正在读取本地测试图片...</div>':'<img src="'+esc(url)+'" alt="">'):'<div class="banner-simple-placeholder">暂无 Banner，请上传图片</div>')+'</div></div>';
  }
  function renderBannerSimpleShell(cfg,items){
    items=(items||[]).slice().sort(function(a,b){return Number((contentDraft(a).sort)||a.sort||99)-Number((contentDraft(b).sort)||b.sort||99)});
    var current=items.find(function(item){return item&&item.enabled!==false&&item.status!=='disabled'&&item.status!=='unpublished'})||items[0]||{};
    var data=bannerDataFromItem(current);
    var desktop=data.desktopImage||data.image||'';
    var mobile=data.mobileImage||'';
    return '<div class="banner-simple-admin" data-platform-content="'+esc(cfg.type)+'">'+
      '<div class="banner-simple-head"><h3>Banner 设置</h3><p>上传或更换首页 Banner，保存后同步显示到首页。</p></div>'+
      '<form class="banner-simple-form platform-content-form" data-content-form="banners" data-content-id="'+esc(data.id||'')+'">'+
        '<input type="hidden" name="status" value="published"><input type="hidden" name="desktopImage" value="'+esc(desktop)+'"><input type="hidden" name="mobileImage" value="'+esc(mobile)+'"><input type="hidden" name="linkTarget" value="'+esc(data.linkTarget||'_self')+'">'+
        '<section class="banner-simple-section">'+
          '<h4>当前 Banner 预览</h4>'+
          '<div class="banner-simple-preview-grid">'+bannerPreviewBox('电脑端 Banner','desktopImage',desktop)+bannerPreviewBox('手机端 Banner','mobileImage',mobile)+'</div>'+
          '<p class="banner-simple-hint">推荐尺寸：1920 × 700。支持 JPG、PNG、WEBP。</p>'+
        '</section>'+
        '<section class="banner-simple-section">'+
          '<h4>上传或更换 Banner</h4>'+
          '<div class="banner-upload-row">'+
            '<label class="banner-upload-card"><input class="content-file banner-file" type="file" data-content-upload="desktopImage" accept="image/jpeg,image/png,image/webp"><span>上传 / 更换电脑端图片</span><small>选择后会先在当前页面预览，保存后才同步首页。</small></label>'+
            '<label class="banner-upload-card"><input class="content-file banner-file" type="file" data-content-upload="mobileImage" accept="image/jpeg,image/png,image/webp"><span>上传 / 更换手机端图片</span><small>如不上传，手机端沿用电脑端图片。</small></label>'+
          '</div>'+
          '<div class="banner-simple-actions banner-image-actions"><button class="mini-btn danger-btn" type="button" data-banner-clear-image="desktopImage">删除电脑端图片</button><button class="mini-btn danger-btn" type="button" data-banner-clear-image="mobileImage">删除手机端图片</button></div>'+
        '</section>'+
        '<section class="banner-simple-section">'+
          '<h4>Banner 文字设置</h4>'+
          '<div class="banner-text-grid">'+
            '<label><span>主标题</span><input name="title" value="'+esc(data.title||'')+'" placeholder="可选"></label>'+
            '<label><span>副标题</span><input name="subtitle" value="'+esc(data.subtitle||'')+'" placeholder="可选"></label>'+
            '<label><span>按钮文字</span><input name="buttonText" value="'+esc(data.buttonText||data.ctaText||'')+'" placeholder="可选"></label>'+
            '<label><span>按钮跳转链接</span><input name="link" value="'+esc(data.link||data.href||'')+'" placeholder="index.html / https://"></label>'+
            '<label><span>排序</span><input name="sort" type="number" min="1" value="'+esc(data.sort||1)+'"></label>'+
            '<label><span>启用状态</span><select name="enabled"><option value="true" '+(data.enabled!==false?'selected':'')+'>启用</option><option value="false" '+(data.enabled===false?'selected':'')+'>停用</option></select></label>'+
          '</div>'+
        '</section>'+
        '<div class="banner-simple-actions"><button class="btn primary" type="submit">保存并应用</button><button class="btn" data-content-action="reload" data-content-type="banners" type="button">取消修改</button></div>'+
      '</form>'+
    '</div>';
  }
  function refreshBannerSimplePreview(form){
    var draft=collectPlatformContentForm(form).draft;
    [['desktopImage',draft.desktopImage||draft.image||''],['mobileImage',draft.mobileImage||'']].forEach(function(pair){
      var box=form.querySelector('[data-banner-preview="'+pair[0]+'"]');
      setBannerPreviewBox(box,pair[1]);
    });
  }
  function platformContentShell(cfg,items,meta){
    if(cfg.type==='banners')return renderBannerSimpleShell(cfg,items);
    if(isBaseDataType(cfg.type))return renderBaseDataShell(cfg,items,meta);
    items=items||[];
    var rows=items.map(function(item){
      var draft=contentDraft(item),pub=contentPublished(item);
      var image=draft.desktopImage||draft.image||draft.cover||draft.icon||pub.desktopImage||pub.image||pub.cover||'';
      return '<tr data-content-id="'+esc(item.id)+'"><td>'+esc(item.title||draft.title||draft.name||draft.content||'-')+'</td><td>'+statusChip(item.status||'草稿')+'</td><td>'+esc(item.sort||draft.sort||100)+'</td><td>'+esc(item.version||0)+'</td><td>'+esc(item.updated_at||'-')+'</td><td>'+esc(item.published_by||'-')+'</td><td>'+esc(item.published_at||'-')+'</td><td>'+(image?'<img class="content-thumb" src="'+esc(image)+'" alt="">':'-')+'</td><td><div class="content-row-actions"><button class="mini-btn" data-content-action="edit" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">编辑</button><button class="mini-btn" data-content-action="save" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">保存草稿</button><button class="mini-btn primary-lite" data-content-action="publish" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">发布</button><button class="mini-btn" data-content-action="duplicate" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">复制</button><button class="mini-btn" data-content-action="unpublish" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">下架</button><button class="mini-btn danger-btn" data-content-action="delete" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">删除</button></div></td></tr>';
    });
    return '<div class="platform-content-admin" data-platform-content="'+esc(cfg.type)+'">'+
      '<div class="content-admin-head"><div><h3>'+esc(cfg.title)+'</h3><p>'+esc(cfg.desc)+'</p></div><div class="content-version-meta"><span>最近保存：'+esc(meta&&meta.savedAt||'-')+'</span><span>最近发布人：'+esc(meta&&meta.publisher||'-')+'</span><span>当前版本：'+esc(meta&&meta.version||'0')+'</span><span>前台同步：'+esc(meta&&meta.sync||'待发布')+'</span></div></div>'+
      '<div class="content-admin-toolbar"><input data-content-search="'+esc(cfg.type)+'" placeholder="搜索标题 / 状态 / 内容"><button class="btn primary" data-content-action="new" data-content-type="'+esc(cfg.type)+'" type="button">新增</button><button class="btn" data-content-action="reload" data-content-type="'+esc(cfg.type)+'" type="button">刷新</button></div>'+
      '<div class="content-editor" data-content-editor="'+esc(cfg.type)+'" hidden></div>'+
      table(['标题/名称','状态','排序','版本','最近保存','最近发布人','发布时间','预览','操作'],rows)+
      (!items.length?'<div class="content-empty-action"><strong>暂无数据</strong><span>请新增内容并保存应用，前台会读取同一份后台数据。</span><button class="btn primary" data-content-action="new" data-content-type="'+esc(cfg.type)+'" type="button">新增</button></div>':'')+
    '</div>';
  }
  function platformContentForm(cfg,item){
    item=item||{};
    var draft=Object.assign({},contentDraft(item));
    var fields=cfg.fields||['title','sort'];
    var inputs=fields.map(function(field){
      var value=draft[field] == null ? '' : draft[field];
      var upload=/image|cover|icon|avatar|gallery|voice|Docs|Sample/i.test(field);
      var options=contentFieldOptions(cfg,field);
      var isLong=/content|body|intro|description|rules|remark|terms|Requirement|materials|options|benefits|condition/i.test(field);
      var fieldHtml=options?'<select name="'+esc(field)+'" data-admin-control="'+(isBoolContentField(field)?'switch':'select')+'">'+options.map(function(pair){return '<option value="'+esc(pair[0])+'" '+(String(value)===String(pair[0])?'selected':'')+'>'+esc(pair[1])+'</option>';}).join('')+'</select>':(isLong?'<textarea name="'+esc(field)+'">'+esc(value)+'</textarea>':'<input name="'+esc(field)+'" value="'+esc(value)+'">');
      return '<label><span>'+esc(contentFieldLabel(field))+'</span>'+fieldHtml+(upload?'<input class="content-file" type="file" data-content-upload="'+esc(field)+'" accept="image/*,audio/*,application/pdf"><small>上传后会写入真实文件 URL</small>':'')+'</label>';
    }).join('');
    var directPublish=['banners','announcements','games','service_types','companion_tags','companion_levels','voice_types','availability_times','vip_levels','badges','featured_players','hot_games','player_rules'].indexOf(cfg.type)>-1;
    var currentStatus=String(item.status||(directPublish?'published':'draft'));
    var statusMap={'草稿':'draft','待发布':'pending','已发布':'published','已下架':'unpublished','已停用':'disabled'};
    currentStatus=statusMap[currentStatus]||currentStatus;
    var statusItems=[['draft','草稿'],['pending','待发布'],['published','已发布'],['unpublished','已下架'],['disabled','已停用']];
    var statusOptions=statusItems.map(function(pair){return '<option value="'+esc(pair[0])+'" '+(currentStatus===pair[0]?'selected':'')+'>'+esc(pair[1])+'</option>';}).join('');
    var currentEnabled=item.enabled!==false;
    var enabledOptions='<option value="true" '+(currentEnabled?'selected':'')+'>启用</option><option value="false" '+(!currentEnabled?'selected':'')+'>停用</option>';
    var submitLabel=directPublish?'保存并应用':'保存草稿';
    return '<form class="platform-content-form" data-content-form="'+esc(cfg.type)+'" data-content-id="'+esc(item.id||'')+'">'+
      '<div class="form-grid">'+inputs+'<label><span>状态</span><select name="status" data-admin-control="select">'+statusOptions+'</select></label><label><span>启用</span><select name="enabled" data-admin-control="switch">'+enabledOptions+'</select></label></div>'+
      '<div class="content-preview-box">'+renderContentPreview(cfg,draft)+'</div>'+
      '<div class="form-actions"><button class="btn primary" type="submit">'+submitLabel+'</button><button class="btn" data-content-action="preview" data-content-type="'+esc(cfg.type)+'" type="button">预览</button>'+(item.id?'<button class="btn primary" data-content-action="publish" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">发布</button>':'')+'<button class="btn" data-content-action="cancel" data-content-type="'+esc(cfg.type)+'" type="button">取消</button></div>'+
    '</form>';
  }
  function renderContentPreview(cfg,draft){
    var image=draft.desktopImage||draft.mobileImage||draft.image||draft.cover||draft.icon||'';
    if(cfg.type==='banners')return '<div class="content-banner-preview">'+(image?'<img src="'+esc(image)+'" alt="">':'<span>Banner 预览：上传图片后显示</span>')+'</div>';
    if(cfg.type==='player_rules'){
      return '<div class="content-card-preview"><strong>'+esc(draft.title||'陪玩制度')+'</strong><span>'+esc(draft.versionNote||'版本说明')+'</span><pre style="white-space:pre-wrap;margin:10px 0 0;max-height:180px;overflow:auto;color:rgba(255,255,255,.78);font:inherit">'+esc((draft.body||'').slice(0,600))+'</pre></div>';
    }
    return '<div class="content-card-preview">'+(image?'<img src="'+esc(image)+'" alt="">':'')+'<strong>'+esc(draft.title||draft.name||draft.content||cfg.title)+'</strong><span>'+esc(draft.subtitle||draft.intro||draft.description||draft.welcomeText||'预览区域')+'</span></div>';
  }
  function renderPlatformContentManagers(){
    Object.keys(platformContentModules).forEach(function(key){
      if(key==='banners'||key==='games'||key==='announcements')return;
      if(platformContentModules[key].disabled)return;
      loadPlatformContent(platformContentModules[key]);
    });
  }
  function isLocalPlatformContentType(type){return false}
  function localPlatformContentKey(type){return 'mcj_platform_content_'+type;}
  function defaultLocalPlatformContent(type){
    if(type==='team_lobby_channels'){
      return [
        {id:'local-team-mobile',type:type,title:'手游组队',status:'已发布',enabled:true,sort:1,draft:{image:'',name:'手游组队',description:'进入手游开黑频道，快速找到同局队友。',discordUrl:'',sort:1},updated_at:new Date().toISOString(),published_by:'系统默认',published_at:'-',version:1},
        {id:'local-team-pc',type:type,title:'端游组队',status:'已发布',enabled:true,sort:2,draft:{image:'',name:'端游组队',description:'进入端游组队频道，匹配排位、娱乐和固定队。',discordUrl:'',sort:2},updated_at:new Date().toISOString(),published_by:'系统默认',published_at:'-',version:1},
        {id:'local-team-chat',type:type,title:'闲聊频道',status:'已发布',enabled:true,sort:3,draft:{image:'',name:'闲聊频道',description:'进入社区闲聊频道，认识新朋友并等待开黑。',discordUrl:'',sort:3},updated_at:new Date().toISOString(),published_by:'系统默认',published_at:'-',version:1}
      ];
    }
    return [];
  }
  function readLocalPlatformContent(type){
    if(!isLocalPlatformContentType(type))return [];
    try{
      var list=JSON.parse(localStorage.getItem(localPlatformContentKey(type))||'[]');
      if(Array.isArray(list)&&list.length)return list;
      var defaults=defaultLocalPlatformContent(type);
      if(defaults.length){localStorage.setItem(localPlatformContentKey(type),JSON.stringify(defaults));return defaults;}
      return [];
    }catch(err){console.error('[平台内容] 读取本地内容失败',{type:type,error:err});return []}
  }
  function saveLocalPlatformContent(type,payload,id){
    if(!isLocalPlatformContentType(type))return null;
    var list=readLocalPlatformContent(type);
    var now=new Date().toISOString();
    var draft=payload&&payload.draft?payload.draft:{};
    var prefix=type==='banners'?'local-banner-':'local-team-';
    var item={id:id||prefix+Date.now(),type:type,title:payload.title||draft.title||draft.name||'未命名内容',status:payload.status||'草稿',enabled:payload.enabled!==false,sort:Number(payload.sort||draft.sort||100),draft:draft,updated_at:now,published_by:'当前后台',published_at:payload.status==='已发布'||payload.status==='published'?now:'-',version:1};
    var index=list.findIndex(function(row){return String(row.id)===String(item.id)});
    if(index>-1)list[index]=Object.assign({},list[index],item);else list.unshift(item);
    localStorage.setItem(localPlatformContentKey(type),JSON.stringify(list));
    return item;
  }
  function applyLocalPlatformContentAction(action,type,id,payload){
    var list=readLocalPlatformContent(type);
    if(action==='delete')list=list.filter(function(row){return String(row.id)!==String(id)});
    else if(action==='unpublish'||action==='disable')saveLocalPlatformContent(type,Object.assign({},payload||{},{status:'已下架',enabled:false}),id);
    else if(action==='publish')saveLocalPlatformContent(type,Object.assign({},payload||{},{status:'已发布',enabled:true}),id);
    else if(action==='duplicate'){
      var found=list.find(function(row){return String(row.id)===String(id)});
      if(found)saveLocalPlatformContent(type,Object.assign({},found,{title:(found.title||'未命名')+' 副本',draft:Object.assign({},found.draft||{})}), 'local-team-'+Date.now());
    } else saveLocalPlatformContent(type,payload||{},id||'');
    if(action==='delete')localStorage.setItem(localPlatformContentKey(type),JSON.stringify(list));
  }
  function resolvePlatformContentCfg(cfgOrKey){
    if(!cfgOrKey)return null;
    if(typeof cfgOrKey==='string'){
      return platformContentModules[cfgOrKey]||platformContentConfig(cfgOrKey)||null;
    }
    if(cfgOrKey&&cfgOrKey.type&&!cfgOrKey.target){
      var byType=platformContentConfig(cfgOrKey.type);
      return byType?Object.assign({},byType,cfgOrKey):cfgOrKey;
    }
    return cfgOrKey;
  }
  function loadPlatformContent(cfgOrKey){
    var cfg=resolvePlatformContentCfg(cfgOrKey);
    if(!cfg||!cfg.target||!cfg.type)return;
    var target=document.getElementById(cfg.target);
    if(!target)return;
    target.innerHTML='<div class="content-loading">正在读取真实数据库...</div>';
    adminFetch('/api/admin/platform-content?type='+encodeURIComponent(cfg.type),{headers:adminApiHeaders()}).then(function(res){var ct=res.headers.get('content-type')||'';if(ct.indexOf('application/json')<0)return {ok:true,configured:false,items:[],message:'本地 API 未启用平台内容接口'};return res.json();}).then(function(result){
      if(result&&result.ok===false)throw new Error(result.message||'平台内容读取失败');
      var items=result.items||[];
      if(isLocalPlatformContentType(cfg.type)&&(!result.configured||!items.length)){items=readLocalPlatformContent(cfg.type);}
      var latest=items[0]||{};
      target.innerHTML=platformContentShell(cfg,items,{savedAt:latest.updated_at,publisher:latest.published_by,version:latest.version,sync:result.configured===false?(result.message||'数据库未配置'):(latest.status||'暂无数据')})+(result.configured===false?'<div class="admin-sync-note">'+esc(result.message||'平台内容表未配置')+'</div>':'');resolveBannerSimplePreviews(target);
    }).catch(function(err){
      console.error('[Banner 管理] 读取接口错误',{endpoint:'/api/admin/platform-content',type:cfg.type,error:err});
      var items=isLocalPlatformContentType(cfg.type)?readLocalPlatformContent(cfg.type):[];
      var latest=items[0]||{};
      target.innerHTML=platformContentShell(cfg,items,{savedAt:latest.updated_at,publisher:latest.published_by,version:latest.version,sync:items.length?(latest.status||'本地预览'):'读取失败'})+(items.length?'':'<div class="admin-sync-note">读取失败：'+esc(err.message||err)+'</div>');resolveBannerSimplePreviews(target);
    });
  }
  function platformContentConfig(type){
    var found=null;
    Object.keys(platformContentModules).some(function(key){if(platformContentModules[key].type===type){found=platformContentModules[key];return true;}return false;});
    return found;
  }
  function collectPlatformContentForm(form){
    var draft={};
    new FormData(form).forEach(function(value,key){if(value instanceof File)return;draft[key]=normalizeContentDraftValue(key,value);});
    return {title:draft.title||draft.name||draft.content||draft.displayName||draft.moduleName||draft.fieldName||'未命名内容',status:form.querySelector('[name="status"]')?form.querySelector('[name="status"]').value:'草稿',enabled:(form.querySelector('[name="enabled"]')||{}).value!=='false',sort:Number(draft.sort||100),draft:draft};
  }
  function submitPlatformContent(action,type,id,payload){
    adminFetch('/api/admin/platform-content',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,type:type,id:id||'',payload:payload||{}})}).then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(parseErr){console.error('[Banner 管理] 保存接口非 JSON',{status:res.status,body:text,error:parseErr});throw new Error('平台内容接口返回非 JSON：HTTP '+res.status)}if(!res.ok||body.ok===false)throw new Error(body.message||('HTTP '+res.status));return body;})}).then(function(result){alert(type==='banners'?'Banner 已更新':(result.message||'已保存'));var cfg=platformContentConfig(type);if(cfg)loadPlatformContent(cfg);}).catch(function(err){console.error('[Banner 管理] 保存接口错误',{endpoint:'/api/admin/platform-content',action:action,type:type,id:id,error:err});if(isLocalPlatformContentType(type)){applyLocalPlatformContentAction(action,type,id||'',payload||{});alert(type==='banners'?'Banner 已保存到本地测试数据，首页刷新后同步显示。':'接口暂不可用，已使用当前后台保存方式保存内容。');var cfg=platformContentConfig(type);if(cfg)loadPlatformContent(cfg);return;}alert('操作失败：'+err.message+'。');});
  }
  function openPlatformContentEditor(type,id){
    var cfg=platformContentConfig(type);if(!cfg)return;
    var target=document.querySelector('[data-content-editor="'+type+'"]');if(!target)return;
    if(!id){target.hidden=false;target.innerHTML=platformContentForm(cfg,null);return;}
    function openItem(item){target.hidden=false;target.innerHTML=platformContentForm(cfg,item||{});target.scrollIntoView({behavior:'smooth',block:'nearest'});}
    if(isLocalPlatformContentType(type)&&String(id).indexOf('local-')===0){
      var localItem=readLocalPlatformContent(type).find(function(x){return String(x.id)===String(id)});
      openItem(localItem||{id:id,draft:{}});
      return;
    }
    adminFetch('/api/admin/platform-content?type='+encodeURIComponent(type),{headers:{'x-mcj-admin-role':getRole()}}).then(function(res){return res.json();}).then(function(result){
      var item=(result.items||[]).find(function(x){return String(x.id)===String(id)});
      if(!item&&isLocalPlatformContentType(type)){item=readLocalPlatformContent(type).find(function(x){return String(x.id)===String(id)});}
      openItem(item||{});
    }).catch(function(err){
      if(isLocalPlatformContentType(type)){
        var item=readLocalPlatformContent(type).find(function(x){return String(x.id)===String(id)});
        if(item){openItem(item);return;}
      }
      alert('读取编辑内容失败：'+err.message);
    });
  }
  function uploadPlatformContentFile(input){
    var file=input.files&&input.files[0];if(!file)return;
    var form=input.closest('[data-content-form]');
    var field=input.dataset.contentUpload;
    var type=form?form.dataset.contentForm:'platform-content';
    if(type==='banners'&&!/^image\//.test(file.type)){alert('请选择 JPG、PNG 或 WEBP 图片。');input.value='';return;}
    if(file.size>4*1024*1024){alert("文件不能超过 4MB");return;}
    function applyUploadUrl(url,localOnly){
      var target=form&&form.querySelector('[name="'+field+'"]');
      if(target)target.value=url;
      if(form){if(type==='banners'&&form.classList.contains('banner-simple-form')){refreshBannerSimplePreview(form);}else{var cfg=platformContentConfig(type);var box=form.querySelector('.content-preview-box');if(box)box.innerHTML=renderContentPreview(cfg,collectPlatformContentForm(form).draft);}}
      alert(localOnly?'本地测试图片已保存，请点击保存并应用。':'上传成功');
    }
    var reader=new FileReader();
    reader.onload=function(){
      adminFetch('/api/admin/platform-content-upload',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({type:type,fileName:file.name,mimeType:file.type,base64:reader.result})}).then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(parseErr){console.error('[Banner 管理] 上传接口非 JSON',{status:res.status,body:text,error:parseErr});throw new Error('上传接口返回非 JSON：HTTP '+res.status)}if(!res.ok||body.ok===false)throw new Error(body.message||('HTTP '+res.status));return body;})}).then(function(result){applyUploadUrl(result.url,false);}).catch(function(err){console.error('[Banner 管理] 上传接口错误',{endpoint:'/api/admin/platform-content-upload',type:type,file:{name:file.name,size:file.size,mimeType:file.type},error:err});if(type==='banners'&&/^image\//.test(file.type)){saveLocalBannerImage(file,reader.result).then(function(url){applyUploadUrl(url,true);}).catch(function(saveErr){console.error('[Banner 管理] IndexedDB 本地保存失败',{error:saveErr});applyUploadUrl(reader.result,true);});return;}if(type!=='banners'&&isLocalPlatformContentType(type)&&/^image\//.test(file.type)){applyUploadUrl(reader.result,true);return;}alert('上传失败：'+err.message+'。');});
    };
    reader.readAsDataURL(file);
  }
  var homeEntryKeys=['custom-order','more-gameplays','companion-hall','team-lobby','miao-coin','companion-apply'];
  function homeEntryDefaults(){return [
    {slug:'custom-order',name:'自定义订单',description:'填写需求，客服匹配陪玩',href:'custom-order.html',sort:1,enabled:true},
    {slug:'more-gameplays',name:'更多玩法',description:'护航、跑刀、代肝、趣味单',href:'more-gameplays.html',sort:2,enabled:true},
    {slug:'companion-hall',name:'陪玩大厅',description:'浏览已上架陪玩',href:'companion-center.html',sort:3,enabled:true},
    {slug:'team-lobby',name:'组队大厅',description:'进入组队社区',href:'team-lobby.html',sort:4,enabled:true},
    {slug:'miao-coin',name:'猫粮充值',description:'查看猫粮充值与猫粮余额',href:'miao-coin.html',sort:5,enabled:true},
    {slug:'companion-apply',name:'申请成为陪玩',description:'提交资料，成为认证陪玩',href:'companion-apply.html',sort:6,enabled:true}
  ];}
  function normalizeHomeEntry(row){
    var draft=row&&row.draft?row.draft:{};
    var slug=String((draft.slug||row.slug||'')).trim();
    var base=homeEntryDefaults().find(function(item){return item.slug===slug})||{};
    return Object.assign({},base,draft,{id:row&&row.id||'',slug:slug||base.slug||'',name:draft.name||row.title||base.name||'未命名入口',description:draft.description||draft.subtitle||base.description||'',href:draft.href||draft.link||base.href||'',sort:Number(row&&row.sort!=null?row.sort:(draft.sort!=null?draft.sort:base.sort||100)),enabled:row?row.enabled!==false&&row.status!=='disabled'&&row.status!=='unpublished':base.enabled!==false,status:row&&row.status||'默认入口'});
  }
  function mergeHomeEntries(rows){
    var mapped={};
    (rows||[]).forEach(function(row){var entry=normalizeHomeEntry(row);if(entry.slug)mapped[entry.slug]=entry;});
    return homeEntryDefaults().map(function(def){return mapped[def.slug]||normalizeHomeEntry({slug:def.slug,title:def.name,draft:def,status:'默认入口',enabled:def.enabled,sort:def.sort});}).sort(function(a,b){return Number(a.sort||0)-Number(b.sort||0)});
  }
  function apiFetchPlatformContent(type){
    return adminFetch('/api/admin/platform-content?type='+encodeURIComponent(type),{headers:{'x-mcj-admin-role':getRole()}}).then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(err){throw new Error('平台内容接口返回非 JSON：HTTP '+res.status)}if(!res.ok||body.ok===false)throw new Error(body.message||('HTTP '+res.status));return body;})});
  }
  function savePlatformContentStrict(action,type,id,payload){
    return adminFetch('/api/admin/platform-content',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,type:type,id:id||'',payload:payload||{}})}).then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(err){throw new Error('平台内容接口返回非 JSON：HTTP '+res.status)}if(!res.ok||body.ok===false)throw new Error(body.message||('HTTP '+res.status));return body;})});
  }
  function homeEntryStatus(entry){return entry.enabled?'<span class="status ok">显示</span>':'<span class="status muted">隐藏</span>'}
  function renderHomeEntryManager(){
    var target=document.getElementById('homeEntryManager');
    if(!target)return;
    target.innerHTML='<div class="content-loading">正在读取首页入口配置...</div>';
    apiFetchPlatformContent('homepage_entries').then(function(result){
      var entries=mergeHomeEntries(result.items||[]);
      target.innerHTML='<div class="home-entry-admin"><div class="home-entry-head"><div><h2>首页入口管理</h2><p>统一管理首页所有功能入口的名称、卡面、说明、跳转和显示状态。</p></div><button class="btn" type="button" data-home-entry-reload>刷新</button></div><div class="home-entry-grid">'+entries.map(homeEntryCard).join('')+'</div><div class="home-entry-drawer" data-home-entry-drawer hidden></div></div>';
      if(!result.configured){target.insertAdjacentHTML('beforeend','<div class="admin-sync-note">平台内容数据库未配置，不能伪造同步成功；保存需要 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。</div>')}
    }).catch(function(err){
      console.error('[首页入口管理] 读取失败',{endpoint:'/api/admin/platform-content',type:'homepage_entries',error:err});
      target.innerHTML='<div class="home-entry-admin"><div class="home-entry-head"><div><h2>首页入口管理</h2><p>统一管理首页所有功能入口的名称、卡面、说明、跳转和显示状态。</p></div><button class="btn" type="button" data-home-entry-reload>重试</button></div><div class="empty">读取失败：'+esc(err.message||err)+'</div></div>';
    });
  }
  function homeEntryCard(entry){
    var preview=entry.image?'<img src="'+esc(entry.image)+'" alt="">':'<span>'+esc(String(entry.name||'入口').slice(0,2))+'</span>';
    return '<article class="home-entry-card" data-home-entry-card="'+esc(entry.slug)+'"><div class="home-entry-preview">'+preview+'</div><div class="home-entry-info"><strong>'+esc(entry.name)+'</strong><p>'+esc(entry.description)+'</p><small>跳转：'+esc(entry.href||'未设置')+'</small></div><div class="home-entry-meta">'+homeEntryStatus(entry)+'<button class="btn small" type="button" data-home-entry-edit="'+esc(entry.slug)+'">编辑</button></div></article>';
  }
  function openHomeEntryEditor(slug){
    apiFetchPlatformContent('homepage_entries').then(function(result){
      var entries=mergeHomeEntries(result.items||[]);
      var entry=entries.find(function(item){return item.slug===slug})||entries[0];
      var drawer=document.querySelector('[data-home-entry-drawer]');
      if(!drawer)return;
      drawer.hidden=false;
      drawer.innerHTML=homeEntryEditor(entry);
      if(slug==='team-lobby')loadHomeTeamChannels();
      if(slug==='more-gameplays')return;
      drawer.scrollIntoView({behavior:'smooth',block:'nearest'});
    }).catch(function(err){alert('读取入口配置失败：'+err.message);});
  }
  function homeEntryEditor(entry){
    var special='';
    if(entry.slug==='team-lobby')special='<section class="home-entry-special"><h3>频道卡片管理</h3><p>手游组队、端游组队和闲聊频道统一在这里配置，左侧不再单独展示组队大厅设置。</p><div id="homeTeamChannelCards" class="home-entry-channel-grid"><div class="content-loading">正在读取频道卡片...</div></div></section>';
    if(entry.slug==='more-gameplays')special='<section class="home-entry-special"><h3>更多玩法商城</h3><p>商品、价格、上下架与客服派单请到左侧导航「更多玩法管理」维护。老板端入口保持跳转 more-gameplays.html。</p></section>';
    return '<div class="home-entry-editor"><div class="home-entry-editor-head"><div><h3>编辑：'+esc(entry.name)+'</h3><p>保存后写入平台内容统一接口。</p></div><button class="btn" type="button" data-home-entry-close>关闭</button></div><form class="home-entry-form" data-home-entry-form="'+esc(entry.slug)+'" data-home-entry-id="'+esc(entry.id||'')+'"><div class="form-grid"><label><span>入口名称</span><input name="name" value="'+esc(entry.name)+'" required></label><label><span>简短说明</span><input name="description" value="'+esc(entry.description)+'"></label><label><span>图标或卡面图片</span><input name="image" value="'+esc(entry.image||'')+'"></label><label><span>跳转类型</span><select name="targetType"><option value="internal">内部页面</option><option value="external">外部链接</option></select></label><label><span>跳转链接或内部页面</span><input name="href" value="'+esc(entry.href||'')+'" required></label><label><span>排序</span><input name="sort" type="number" value="'+esc(entry.sort||100)+'"></label><label><span>显示状态</span><select name="enabled"><option value="true" '+(entry.enabled?'selected':'')+'>显示</option><option value="false" '+(!entry.enabled?'selected':'')+'>隐藏</option></select></label></div><div class="form-actions"><button class="btn primary" type="submit">保存并应用</button><button class="btn" type="button" data-home-entry-close>取消</button></div></form>'+special+'</div>';
  }
  function collectHomeEntryForm(form){
    var data={};
    new FormData(form).forEach(function(value,key){data[key]=value;});
    data.slug=form.dataset.homeEntryForm;
    data.sort=Number(data.sort||100);
    data.enabled=data.enabled!=='false';
    return data;
  }
  function submitHomeEntryForm(form){
    var data=collectHomeEntryForm(form);
    var payload={slug:data.slug,title:data.name,status:'published',enabled:data.enabled,sort:data.sort,draft:data};
    savePlatformContentStrict(form.dataset.homeEntryId?'save':'create','homepage_entries',form.dataset.homeEntryId,payload).then(function(){alert('已保存并应用');renderHomeEntryManager();}).catch(function(err){console.error('[首页入口管理] 保存失败',{type:'homepage_entries',error:err});alert('保存失败：'+err.message);});
  }
  function teamChannelDefaults(){return [
    {slug:'mobile-team',name:'手游组队',description:'进入手游开黑频道，快速找到同局队友。',discordUrl:'',sort:1,enabled:true},
    {slug:'pc-team',name:'端游组队',description:'进入端游组队频道，匹配排位、娱乐和固定队。',discordUrl:'',sort:2,enabled:true},
    {slug:'chat-team',name:'闲聊频道',description:'进入社区闲聊频道，认识新朋友并等待开黑。',discordUrl:'',sort:3,enabled:true}
  ];}
  function normalizeTeamChannel(row){
    var draft=row&&row.draft?row.draft:{};
    var slug=String(draft.slug||row.slug||'').trim();
    var base=teamChannelDefaults().find(function(item){return item.slug===slug})||{};
    return Object.assign({},base,draft,{id:row&&row.id||'',slug:slug||base.slug||'',name:draft.name||row.title||base.name||'未命名频道',description:draft.description||base.description||'',discordUrl:draft.discordUrl||base.discordUrl||'',image:draft.image||base.image||'',sort:Number(row&&row.sort!=null?row.sort:(draft.sort!=null?draft.sort:base.sort||100)),enabled:row?row.enabled!==false&&row.status!=='disabled'&&row.status!=='unpublished':base.enabled!==false});
  }
  function loadHomeTeamChannels(){
    var target=document.getElementById('homeTeamChannelCards');if(!target)return;
    apiFetchPlatformContent('team_lobby_channels').then(function(result){
      var mapped={};(result.items||[]).forEach(function(row){var item=normalizeTeamChannel(row);if(item.slug)mapped[item.slug]=item;});
      var channels=teamChannelDefaults().map(function(def){return mapped[def.slug]||normalizeTeamChannel({slug:def.slug,title:def.name,draft:def,status:'默认频道',enabled:def.enabled,sort:def.sort});});
      target.innerHTML=channels.map(teamChannelCard).join('');
      if(!result.configured)target.insertAdjacentHTML('beforeend','<div class="admin-sync-note">平台内容数据库未配置，频道卡片不会写入假数据。</div>');
    }).catch(function(err){console.error('[首页入口管理] 读取组队频道失败',{error:err});target.innerHTML='<div class="empty">读取失败：'+esc(err.message||err)+'</div>';});
  }
  function teamChannelCard(item){
    return '<form class="home-channel-card" data-home-channel-form="'+esc(item.slug)+'" data-home-channel-id="'+esc(item.id||'')+'"><div class="home-channel-preview">'+(item.image?'<img src="'+esc(item.image)+'" alt="">':'<span>频道</span>')+'</div><label><span>频道名称</span><input name="name" value="'+esc(item.name)+'"></label><label><span>简短说明</span><input name="description" value="'+esc(item.description)+'"></label><label><span>卡面图片</span><input name="image" value="'+esc(item.image||'')+'"></label><label><span>Discord 链接</span><input name="discordUrl" value="'+esc(item.discordUrl||'')+'" placeholder="留空时前台显示暂未开放"></label><label><span>排序</span><input name="sort" type="number" value="'+esc(item.sort||100)+'"></label><label><span>显示状态</span><select name="enabled"><option value="true" '+(item.enabled?'selected':'')+'>显示</option><option value="false" '+(!item.enabled?'selected':'')+'>隐藏</option></select></label><button class="btn primary" type="submit">保存频道</button></form>';
  }
  function submitHomeChannelForm(form){
    var data={};new FormData(form).forEach(function(value,key){data[key]=value;});data.slug=form.dataset.homeChannelForm;data.sort=Number(data.sort||100);data.enabled=data.enabled!=='false';
    var payload={slug:data.slug,title:data.name,status:'published',enabled:data.enabled,sort:data.sort,draft:data};
    savePlatformContentStrict(form.dataset.homeChannelId?'save':'create','team_lobby_channels',form.dataset.homeChannelId,payload).then(function(){alert('频道已保存');loadHomeTeamChannels();}).catch(function(err){console.error('[首页入口管理] 保存组队频道失败',{type:'team_lobby_channels',error:err});alert('保存失败：'+err.message);});
  }
  function loadHomeMoreGameplays(){
    var target=document.getElementById('homeMoreGameplaysMount');if(!target)return;
    var cfg=Object.assign({},platformContentModules.gameplays,{target:'homeMoreGameplaysMount'});
    loadPlatformContent(cfg);
  }
  var sectionTitles={
    dashboard:['控制台','平台核心数据与待处理事项'],
    bosses:['老板管理','老板账号、钱包、订单与邀请关系'],
    players:['陪玩管理','陪玩资料、等级、审核、接单状态与收益'],
    games:['服务管理','管理平台服务名称、分类、启停、首页显示、申请与下单开关'],
    'service-types':['服务类型管理','维护服务类型和所属游戏，前台筛选同步读取'],
    'companion-tags':['陪玩标签管理','维护甜妹、御姐、搞笑等普通标签，陪玩可多选'],
    'featured-players':['推荐陪玩管理','选择首页展示陪玩和排序'],
    'hot-games':['热门游戏管理','管理首页热门游戏和排序'],
    'companion-levels':['陪玩等级管理','等级名称、颜色、卡片背景、徽章、价格区间、升级条件、抽成和排序'],
    service:['客服管理','客服账号和工作统计'],
    orders:['订单管理','订单流程、状态和售后'],
    'recharge-campaigns':['充值活动管理','充值档位、基础猫粮与赠送猫粮'],
    'compensation-review':['补偿审核','客服补偿申请审核与入账'],
    'recharge-center':['充值中心','充值申请与付款凭证审核'],
    coupons:['优惠券管理','创建、启用和管理用户优惠券'],
    finance:['财务流水','钱包流水、消费、收入和平台利润'],
    recharges:['充值记录','全部充值记录与审核状态'],
    withdraw:['提现审核','陪玩、客服和俱乐部提现审核'],
    refunds:['退款管理','退款申请、售后和处理记录'],
    commissions:['抽成与返点设置','平台抽成、直属陪返点和邀请返利'],
    banners:['Banner 管理','首页 Banner 上传、排序和启用'],
    announcements:['公告管理','首页和全站公告内容'],
    ads:['广告位管理','全站广告位素材与投放状态'],
    'home-entry-settings':['首页入口管理','统一管理首页功能入口、组队大厅频道和更多玩法入口'],
    'page-content-settings':['页面内容管理','价格、制度、玩法资格和页面内容配置'],
    'team-lobby-links':['组队大厅管理','启用/停用组队大厅，并配置老板端首页跳转链接'],
    'meow-butler':['喵管家管理','在线客服入口与快捷入口配置'],
    'sync-center':['全端功能同步','用户端、老板端、陪玩端、客服端数据同步'],
    'price-table':['俱乐部价格表管理','俱乐部服务价格范围和规则'],
    gameplays:['更多玩法商城管理','管理老板端更多玩法商城中的服务商品、价格、库存状态及客服派单规则'],
    'custom-order-settings':['自定义订单设置','自定义订单字段、规则和价格限制'],
    'gameplay-qualifications':['玩法资格审核','陪玩固定玩法服务资格审核'],
    'companion-rules':['制度管理 · 陪玩申请制度','编辑陪玩申请第 1 步制度标题、正文与启用状态'],
    'rules-hub':['制度与等级','俱乐部等级说明、陪玩规则、强制公告与阅读记录'],
    'voice-types':['声音类型管理','声音标签、分类和筛选项'],
    'companion-deposit':['陪玩押金设置','押金金额、审核规则和状态'],
    'companion-applications':['陪玩申请审核','陪玩入驻申请、资料和认证审核'],
    'service-accounts':['客服管理','创建、启用和停用客服登录账号'],
    'service-stats':['客服工作统计','打卡、订单处理和售后处理数据'],
    statistics:['统计中心','平台统计、趋势和报表'],
    'admin-accounts':['我的资料','管理员头像、昵称、邮箱和手机号'],
    'change-password':['修改密码','修改当前管理员登录密码'],
    permissions:['权限系统','角色权限和访问边界'],
    vip:['VIP 设置','VIP 等级、门槛和权益'],
    payment:['支付设置','支付渠道、收款资料和启用状态'],
    'mail-logs':['邮件通知记录','指定订单与状态变更邮件发送日志'],
    gifts:['礼物管理','礼物商城配置、猫粮价格与启用状态'],
    popularity:['人气榜设置','暂未开放 · 礼物/收藏/在线时长链路未验收，禁止重算与写榜'],
    settings:['系统设置','平台基础配置'],
    logs:['操作日志','管理员登录、编辑、审核和敏感操作记录']
  };
  function setTitle(name){
    var meta=sectionTitles[name]||[name,''];
    var title=document.getElementById('pageTitle');
    var crumb=document.getElementById('adminBreadcrumb');
    if(title)title.textContent=meta[0];
    if(crumb)crumb.textContent='超级管理员后台 / '+(meta[0]||name);
  }
  function initTabs(){
    var buttons=document.querySelectorAll('[data-section]');
    var sideButtons=document.querySelectorAll('.side-nav [data-section]');
    var content=document.getElementById('adminContent');
    function escHtml(text){return String(text||'').replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})}
    function targetName(btn){return btn.dataset.targetSection||btn.dataset.section||''}
    function buttonLabel(btn){return (btn.textContent||btn.dataset.section||'').replace(/\s+/g,' ').trim()}
    function ensureSection(name,label){
      var sec=document.getElementById('section-'+name);
      if(sec||!content)return sec;
      sec=document.createElement('section');
      sec.className='section';
      sec.id='section-'+name;
      sec.innerHTML='<section class="panel"><h2>'+escHtml(label||name)+'</h2><div class="empty">该功能正在接入中</div></section>';
      content.appendChild(sec);
      return sec;
    }
    function updateTitle(activeName,target,label,parentLabel){
      var meta=sectionTitles[activeName]||sectionTitles[target]||[label||activeName,''];
      var title=document.getElementById('pageTitle');
      var crumb=document.getElementById('adminBreadcrumb');
      var displayTitle=label||meta[0]||activeName;
      if(title)title.textContent=displayTitle;
      if(crumb)crumb.textContent='超级管理员后台 / '+(parentLabel?parentLabel+' / ':'')+displayTitle;
    }
    function activate(btn){
      var activeName=btn&&btn.dataset?btn.dataset.section:'';
      if(!activeName)return;
      var target=targetName(btn);
      document.body.dataset.adminSection=target;
      var label=buttonLabel(btn);
      var group=btn.closest('.nav-group');
      var parentLabel='';
      var sec=ensureSection(target,label);
      if(group){
        var parent=document.querySelector('[data-toggle-group="'+group.dataset.group+'"]');
        if(parent)parentLabel=buttonLabel(parent);
      }
      sideButtons.forEach(function(b){b.classList.toggle('active',b.dataset.section===activeName)});
      document.querySelectorAll('.nav-parent').forEach(function(parent){parent.classList.remove('active-parent')});
      document.querySelectorAll('.section').forEach(function(s){s.classList.toggle('active',sec&&s===sec)});
      if(group){
        group.classList.add('open');
        var parentBtn=document.querySelector('[data-toggle-group="'+group.dataset.group+'"]');
        if(parentBtn){parentBtn.setAttribute('aria-expanded','true');parentBtn.classList.add('active-parent');}
      }
      if(window.innerWidth<1024)document.body.classList.remove('admin-sidebar-open');
      updateTitle(activeName,target,label,parentLabel);
      if(activeName&&location.hash.slice(1)!==activeName)history.replaceState(null,'','#'+activeName);
      if(target==='team-lobby-links'&&window.MCJAdminTeamLobby&&typeof window.MCJAdminTeamLobby.reload==='function'){
        try{window.MCJAdminTeamLobby.reload();}catch(err){}
      }
      try{document.dispatchEvent(new CustomEvent('mcj:admin-section',{detail:{section:target}}));}catch(err2){}
    }
    document.querySelectorAll('.side-nav button').forEach(function(btn){btn.disabled=false;btn.style.pointerEvents='auto'});
    buttons.forEach(function(btn){
      if(btn.closest('.admin-profile-dropdown'))return;
      btn.addEventListener('click',function(e){
      e.preventDefault();
      activate(btn);
    })});
    document.querySelectorAll('[data-toggle-group]').forEach(function(btn){
      var panel=document.querySelector('[data-group="'+btn.dataset.toggleGroup+'"]');
      btn.setAttribute('aria-expanded',panel&&panel.classList.contains('open')?'true':'false');
      btn.addEventListener('click',function(e){
        e.preventDefault();
        if(!panel)return;
        var open=!panel.classList.contains('open');
        panel.classList.toggle('open',open);
        btn.setAttribute('aria-expanded',open?'true':'false');
      });
    });
    var collapse=document.querySelector('[data-collapse-sidebar]');
    if(collapse)collapse.addEventListener('click',function(){
      var sidebar=document.getElementById('adminSidebar');
      var app=document.querySelector('.admin-shell')||document.querySelector('.admin-app');
      if(!sidebar)return;
      sidebar.classList.toggle('collapsed');
      if(app)app.classList.toggle('sidebar-collapsed',sidebar.classList.contains('collapsed'));
      collapse.textContent=sidebar.classList.contains('collapsed')?'展开':'收起菜单';
    });
    var mobileToggle=document.querySelector('[data-mobile-sidebar]');
    if(mobileToggle)mobileToggle.addEventListener('click',function(){document.body.classList.toggle('admin-sidebar-open')});
    // Close drawer after choosing a section on small screens.
    document.querySelectorAll('.side-nav [data-section], .side-nav [data-target-section]').forEach(function(btn){
      btn.addEventListener('click',function(){
        if(window.innerWidth<1024)document.body.classList.remove('admin-sidebar-open');
      });
    });
    var orderSectionAliases={'order-waiting-accept':'orders','order-waiting-confirm':'orders','order-running':'orders','order-completed':'orders','refund-orders':'orders','pending-orders':'orders','after-sale-orders':'orders'};
    var headerOnlySections={'admin-accounts':1,'change-password':1};
    function sectionFromHash(){return (location.hash||'#dashboard').replace('#','')||'dashboard'}
    function buttonForSection(name){name=orderSectionAliases[name]||name;return document.querySelector('.side-nav [data-section="'+name+'"], .side-nav [data-target-section="'+name+'"]')}
    function activateByName(name){
      name=orderSectionAliases[name]||name;
      var btn=buttonForSection(name);
      if(btn){activate(btn);return true;}
      if(!headerOnlySections[name]&&!document.getElementById('section-'+name))return false;
      activate({dataset:{section:name},textContent:(sectionTitles[name]||[name])[0]||name,closest:function(){return null}});
      return true;
    }
    function activateFromHash(fallback){
      var name=sectionFromHash();
      if(activateByName(name))return;
      if(fallback!==false){
        var dash=document.querySelector('.side-nav [data-section="dashboard"]');
        if(dash)activate(dash);
      }
    }
    activateFromHash(true);
    window.addEventListener('hashchange',function(){activateFromHash(false)});
    window.MCJAdminActivateSection=activateByName;
  }
  function initTableSearch(){
    document.querySelectorAll('[data-table-search]').forEach(function(input){
      input.addEventListener('input',function(){
        var tableBox=document.getElementById(input.dataset.tableSearch);
        var keyword=input.value.trim().toLowerCase();
        if(!tableBox)return;
        var rows=tableBox.querySelectorAll('tbody tr');
        var shown=0;
        rows.forEach(function(row){
          var matched=!keyword||row.innerText.toLowerCase().indexOf(keyword)>-1;
          row.style.display=matched?'':'none';
          if(matched)shown++;
        });
        var empty=tableBox.querySelector('.table-empty');
        if(!empty){
          empty=document.createElement('div');
          empty.className='table-empty';
          empty.textContent='没有找到匹配资料';
          tableBox.appendChild(empty);
        }
        empty.style.display=shown?'none':'block';
      });
    });
  }
  function bindGlobal(){document.addEventListener('click',function(e){var role=e.target.closest('[data-role-login]');if(role){localStorage.setItem('mcjRole',role.dataset.roleLogin);routeByRole(role.dataset.roleLogin);return;}var logout=e.target.closest('[data-admin-logout]');if(logout){e.preventDefault();denyAdminToLogin('已退出后台登录');return;}var preview=e.target.closest('[data-preview-home]');if(preview){location.href='index.html';return;}var saveLevels=e.target.closest('[data-save-companion-levels]');if(saveLevels&&levelApi()){levelApi().save(collectCompanionLevels());log('保存陪玩等级与价格设置');alert('已保存陪玩等级与价格设置');renderCompanionLevels();return;}var deleteLevel=e.target.closest('[data-delete-companion-level]');if(deleteLevel&&levelApi()){var levels=getLevels();var level=levelApi().find(deleteLevel.dataset.deleteCompanionLevel);if(playerLevelCount(level)>0){alert('该等级已有陪玩，不能直接删除。请先停用该等级或迁移陪玩等级。');return;}if(confirm('确认删除 '+levelLabel(level.id)+'？')){levelApi().save(levels.filter(function(item){return item.id!==level.id}));log('删除陪玩等级 '+levelLabel(level.id));renderCompanionLevels();}return;}var action=e.target.closest('[data-action]');if(action){alert('已执行：'+action.dataset.action+' / '+(action.dataset.id||''));log('执行 '+action.dataset.action);return;}var del=e.target.closest('[data-delete]');if(del){var arr=read(del.dataset.delete);arr.splice(Number(del.dataset.index),1);write(del.dataset.delete,arr);location.reload();return;}})}
  function initForms(){document.querySelectorAll('[data-save-settings]').forEach(function(btn){btn.addEventListener('click',function(){var settings={siteName:val('siteName'),logoUrl:val('logoUrl'),customerServiceUrl:val('customerServiceUrl'),discordInviteUrl:val('discordInviteUrl'),whatsappUrl:val('whatsappUrl'),maintenanceMode:val('maintenanceMode'),registerOpen:val('registerOpen'),seoTitle:val('seoTitle')};localStorage.setItem('mcj_siteSettings',JSON.stringify(settings));log('保存平台设置');alert('已保存平台设置');})});document.querySelectorAll('[data-add-row]').forEach(function(btn){btn.addEventListener('click',function(){var key=btn.dataset.addRow;if(isLocalBusinessKey(key)){alert('已禁用本地假数据新增。请通过真实后台接口维护业务数据。');return;}var arr=read(key);arr.unshift({id:key.toUpperCase().slice(0,2)+Date.now(),title:val('crudTitle'),name:val('crudTitle'),content:val('crudDesc'),description:val('crudDesc'),image:val('crudImage')||'assets/meow-cuijiao-brand.jpg',status:'开启',sort:arr.length+1});write(key,arr);alert('已新增');location.reload();})})}
  function bindPaymentAdmin(){
    document.addEventListener('click',function(e){
      var saveLevels=e.target.closest('[data-save-companion-levels]');
      if(saveLevels){e.preventDefault();e.stopPropagation();submitCompanionLevelsSecure();return;}
      var deleteLevel=e.target.closest('[data-delete-companion-level]');
      if(deleteLevel){e.preventDefault();e.stopPropagation();submitCompanionLevelsSecure();return;}
    },true);
    document.addEventListener('click',function(e){
      var closeModal=e.target.closest('[data-close-modal]');
      if(closeModal){e.preventDefault();closeAdminModal();return;}
      var adminModal=document.getElementById('adminModal');
      if(adminModal&&adminModal.classList.contains('show')&&e.target===adminModal){closeAdminModal();return;}
      var notification=e.target.closest('[data-admin-notifications]');if(notification){var dashNav=document.querySelector('.side-nav [data-section="dashboard"]');if(dashNav)dashNav.click();return;}
      var profileToggle=e.target.closest('[data-admin-profile-toggle]');if(profileToggle){profileToggle.closest('.admin-profile-menu').classList.toggle('open');return;}
      if(!e.target.closest('.admin-profile-menu'))document.querySelectorAll('.admin-profile-menu.open').forEach(function(menu){menu.classList.remove('open')});
      var profileJump=e.target.closest('.admin-profile-dropdown [data-section]');if(profileJump){var menu=profileJump.closest('.admin-profile-menu');if(menu)menu.classList.remove('open');if(window.MCJAdminActivateSection)window.MCJAdminActivateSection(profileJump.dataset.section);return;}
      var jump=e.target.closest('.todo-item[data-section],.activity-item[data-section]');if(jump){var nav=document.querySelector('.side-nav [data-section="'+jump.dataset.section+'"]');if(nav)nav.click();return;}
      var bossMore=e.target.closest('[data-boss-more]');
      if(bossMore){
        e.preventDefault();
        e.stopPropagation();
        openBossMoreMenu(bossMore);
        return;
      }
      if(bossMorePopover.el&&!e.target.closest('[data-boss-more-popover]')&&!e.target.closest('[data-boss-more]')){
        closeBossMoreMenu();
      }
      var bossBulkToggle=e.target.closest('[data-boss-bulk-toggle]');if(bossBulkToggle&&!bossBulkToggle.disabled){var bulkMenu=bossBulkToggle.parentElement.querySelector('.boss-bulk-menu');if(bulkMenu)bulkMenu.hidden=!bulkMenu.hidden;return;}
      var bossSearchBtn=e.target.closest('[data-boss-search-button]');if(bossSearchBtn){filterBossManagement();return;}
      var bossClear=e.target.closest('[data-boss-clear]');if(bossClear){var bs=document.querySelector('[data-boss-search]');if(bs)bs.value='';document.querySelectorAll('[data-boss-filter]').forEach(function(input){input.value='';});filterBossManagement();return;}
      var bossExport=e.target.closest('[data-boss-export]');if(bossExport){exportBossRows();return;}
      var bossPage=e.target.closest('[data-boss-page]');if(bossPage){closeBossMoreMenu();bossAdminState.page+=bossPage.dataset.bossPage==='next'?1:-1;renderBossTableRows();return;}
      var bossPageGo=e.target.closest('[data-boss-page-go]');if(bossPageGo){closeBossMoreMenu();var bj=document.querySelector('[data-boss-page-jump]');var bt=visibleBossRows().length;var bp=Math.max(1,Math.ceil(bt/bossAdminState.pageSize));bossAdminState.page=Math.min(Math.max(1,Number(bj&&bj.value)||1),bp);renderBossTableRows();return;}
      var bossAction=e.target.closest('[data-boss-action]');if(bossAction){var bossAct=bossAction.dataset.bossAction,bossId=bossAction.dataset.bossId;closeBossMoreMenu();if(/view|orders|recharge|consume|refunds|coupon|chat|login|vip|invite|ban/.test(bossAct)){openBossDetail(bossId,bossAct);return;}if(bossAct==='remark'){var remark=prompt('编辑老板备注',((bossAdminState.rows||[]).find(function(r){return String(r.id)===String(bossId)})||{}).remark||'');if(remark==null)return;submitBossSecure('remark',bossId,{remark:remark});return;}if(bossAct==='reset_password'){toast('禁止在后台设置明文密码，请使用「发送密码重置邮件」。','error');return;}if(bossAct==='send_password_reset'||bossAct==='send_reset_email'){if(!confirm('向该老板注册邮箱发送密码重置验证码？管理员无法查看新密码。'))return;submitBossSecure('send_password_reset',bossId,{});return;}if(bossAct==='force_change_password'){if(!confirm('强制该老板下次登录后修改密码？'))return;submitBossSecure('force_change_password',bossId,{});return;}if(bossAct==='revoke_sessions'){if(!confirm('注销该老板全部登录会话？'))return;submitBossSecure('revoke_sessions',bossId,{});return;}if(bossAct==='unbind'){if(!confirm('确认解绑该老板手机号？'))return;submitBossSecure('unbind',bossId,{});return;}if(/freeze|blacklist|unban|ban/.test(bossAct)&&!confirm('确认执行该老板账号操作？'))return;submitBossSecure(bossAct,bossId,{});return;}
      var bossTab=e.target.closest('[data-boss-tab]');if(bossTab){switchBossDetailTab(bossTab.dataset.bossTab);return;}
      var bossOpen=e.target.closest('[data-boss-open]');if(bossOpen&&!e.target.closest('button,a,input,select')){openBossDetail(bossOpen.dataset.bossOpen);return;}
      var bossGrant=e.target.closest('[data-boss-wallet-grant]');if(bossGrant){submitBossWalletAction('grant',bossGrant.dataset.bossWalletGrant);return;}
      var bossDeduct=e.target.closest('[data-boss-wallet-deduct]');if(bossDeduct){submitBossWalletAction('deduct',bossDeduct.dataset.bossWalletDeduct);return;}
      var bossLedger=e.target.closest('[data-boss-wallet-ledger]');if(bossLedger){submitBossWalletAction('ledger',bossLedger.dataset.bossWalletLedger);return;}
      var bossBulk=e.target.closest('[data-boss-bulk]');if(bossBulk){var ids=selectedBossIds();if(!ids.length)return;if(/freeze|blacklist/.test(bossBulk.dataset.bossBulk)&&!confirm('确认执行批量操作？'))return;if(bossBulk.dataset.bossBulk==='export'){exportBossRows(visibleBossRows().filter(function(row){return ids.indexOf(String(row.id))>-1;}));return;}submitBossSecure('bulk-'+bossBulk.dataset.bossBulk,ids,{ids:ids});return;}
      var orderTab=e.target.closest('[data-order-status-tab]');if(orderTab){var wrap=orderTab.closest('.order-status-tabs');if(wrap)wrap.querySelectorAll('[data-order-status-tab]').forEach(function(btn){btn.classList.remove('active')});orderTab.classList.add('active');filterOrders();return;}
      var orderAction=e.target.closest('[data-order-action]');if(orderAction){var orderAct=orderAction.dataset.orderAction,orderId=orderAction.dataset.orderId;if(orderAct==='view'||orderAct==='review'){openOrderDetail(orderId);return;}var payload={};if(orderAct==='assign-player'||orderAct==='change-player'){var companionId=prompt('请输入陪玩用户 UUID（profiles.id / companion user_id）：')||'';if(!String(companionId).trim())return;payload.companion_id=String(companionId).trim();}var risky=/cancel|refund|early-end|confirm-complete|return-service|blacklist|compensate|reject|approve|partial/.test(orderAct);var reason='';if(risky){reason=prompt('该订单操作需要记录原因，请填写原因：')||'';if(!reason.trim())return;payload.reason=reason;}submitOrderAction(orderAct,orderId,payload);return;}
      if(e.target.closest('[data-order-export]')){submitOrderAction('export','all',{});return;}
      if(e.target.closest('[data-order-create-service]')){submitOrderAction('service-create','new',{});return;}
      if(e.target.closest('[data-order-dev-test]')){submitOrderAction('create-test-order','dev',{});return;}
      var serviceRecordAction=e.target.closest('[data-service-record-action]');if(serviceRecordAction){openServiceRecordDetail(serviceRecordAction.dataset.serviceRecordId,serviceRecordAction.dataset.serviceRecordAction);return;}
      var serviceRecordOpen=e.target.closest('[data-service-record-open]');if(serviceRecordOpen&&!e.target.closest('button,a,input,select')){openServiceRecordDetail(serviceRecordOpen.dataset.serviceRecordOpen,'summary');return;}
      var serviceRecordSearchBtn=e.target.closest('[data-service-record-search-button]');if(serviceRecordSearchBtn){serviceRecordState.keyword=(document.querySelector('[data-service-record-search]')||{}).value||'';serviceRecordState.page=1;renderServiceRecordRows();return;}
      var serviceRecordClear=e.target.closest('[data-service-record-clear]');if(serviceRecordClear){serviceRecordState.keyword='';serviceRecordState.status='';serviceRecordState.date='';serviceRecordState.page=1;renderServiceRecords();return;}
      var serviceRecordRefresh=e.target.closest('[data-service-record-refresh]');if(serviceRecordRefresh){serviceRecordState.loaded=false;loadServiceRecords();return;}
      var serviceRecordPage=e.target.closest('[data-service-record-page]');if(serviceRecordPage){serviceRecordState.page+=serviceRecordPage.dataset.serviceRecordPage==='next'?1:-1;renderServiceRecordRows();return;}
      var serviceRecordPageGo=e.target.closest('[data-service-record-page-go]');if(serviceRecordPageGo){var srj=document.querySelector('[data-service-record-page-jump]');var srt=visibleServiceRecords().length;var srp=Math.max(1,Math.ceil(srt/serviceRecordState.pageSize));serviceRecordState.page=Math.min(Math.max(1,Number(srj&&srj.value)||1),srp);renderServiceRecordRows();return;}
      var chatItem=e.target.closest('[data-admin-chat-id]');if(chatItem){adminMessageState.activeId=chatItem.dataset.adminChatId;renderAdminMessageCenter();return;}
      var chatFilter=e.target.closest('[data-admin-chat-filter]');if(chatFilter){var wrap=chatFilter.closest('.admin-chat-sidebar');if(wrap){wrap.querySelectorAll('[data-admin-chat-filter]').forEach(function(btn){btn.classList.remove('active')});chatFilter.classList.add('active');filterAdminChats();}return;}
      var chatSend=e.target.closest('[data-chat-send]');if(chatSend){var input=document.querySelector('[data-chat-input]');var text=input?input.value.trim():'';if(!text){alert('请输入消息内容');return;}submitAdminChatAction('send_message',adminMessageState.activeId,{type:'text',content:text});if(input)input.value='';return;}
      var chatAction=e.target.closest('[data-chat-action]');if(chatAction){var action=chatAction.dataset.chatAction;if(/blacklist|delete/.test(action)&&!confirm('确认执行该敏感聊天操作？'))return;submitAdminChatAction(action,adminMessageState.activeId,{});return;}
      var chatTool=e.target.closest('[data-chat-tool]');if(chatTool){submitAdminChatAction('tool_'+chatTool.dataset.chatTool,adminMessageState.activeId,{});return;}
      var chatMessageAction=e.target.closest('[data-chat-message-action]');if(chatMessageAction){var msg=chatMessageAction.closest('[data-message-id]');submitAdminChatAction(chatMessageAction.dataset.chatMessageAction,adminMessageState.activeId,{messageId:msg?msg.dataset.messageId:''});return;}
      var homeReload=e.target.closest('[data-home-entry-reload]');if(homeReload){renderHomeEntryManager();return;}var homeEdit=e.target.closest('[data-home-entry-edit]');if(homeEdit){openHomeEntryEditor(homeEdit.dataset.homeEntryEdit);return;}var homeClose=e.target.closest('[data-home-entry-close]');if(homeClose){var drawer=document.querySelector('[data-home-entry-drawer]');if(drawer){drawer.hidden=true;drawer.innerHTML='';}return;}var bannerClear=e.target.closest('[data-banner-clear-image]');if(bannerClear){var form=bannerClear.closest('[data-content-form]');var field=bannerClear.dataset.bannerClearImage;var target=form&&form.querySelector('[name="'+field+'"]');if(target)target.value='';if(form)refreshBannerSimplePreview(form);return;}var contentAction=e.target.closest('[data-content-action]');if(contentAction){var ctype=contentAction.dataset.contentType,cid=contentAction.dataset.contentId,act=contentAction.dataset.contentAction;if(act==='new'){openPlatformContentEditor(ctype,'');return;}if(act==='edit'){openPlatformContentEditor(ctype,cid);return;}if(act==='cancel'){var editor=document.querySelector('[data-content-editor="'+ctype+'"]');if(editor){editor.hidden=true;editor.innerHTML='';}return;}if(act==='reload'){var cfg=platformContentConfig(ctype);if(cfg)loadPlatformContent(cfg);return;}if(act==='preview'){var form=document.querySelector('[data-content-form="'+ctype+'"]');if(form){var cfgp=platformContentConfig(ctype);var box=form.querySelector('.content-preview-box');if(box)box.innerHTML=renderContentPreview(cfgp,collectPlatformContentForm(form).draft);}return;}if(act==='delete'&&isProtectedBaseData(ctype)){alert('该数据已被业务使用时不能直接删除。请先停用，避免破坏历史订单和资料。');return;}if(/delete|unpublish|disable/.test(act)&&!confirm('确认执行该内容操作？'))return;if(act==='save'){var editForm=document.querySelector('[data-content-form="'+ctype+'"][data-content-id="'+cid+'"]');submitPlatformContent('save',ctype,cid,editForm?collectPlatformContentForm(editForm):{});return;}submitPlatformContent(act,ctype,cid,{});return;}
      var playerMore=e.target.closest('[data-player-more]');if(playerMore){
        e.preventDefault();e.stopPropagation();
        openPlayerMoreMenu(playerMore);
        return;
      }
      if(playerMorePopover.el&&!e.target.closest('.player-more-menu')&&!e.target.closest('[data-player-more]')){
        closePlayerMoreMenu();
      }
      var playerJump=e.target.closest('[data-player-jump]');if(playerJump){var nav=document.querySelector('.side-nav [data-section="'+playerJump.dataset.playerJump+'"]');if(nav)nav.click();return;}
      var playerSearchBtn=e.target.closest('[data-player-search-button]');if(playerSearchBtn){filterPlayerManagement();return;}
      var playerExport=e.target.closest('[data-player-export]');if(playerExport){exportPlayerRows();return;}
      var playerClear=e.target.closest('[data-player-clear]');if(playerClear){var search=document.querySelector('[data-player-search]');if(search)search.value='';document.querySelectorAll('[data-player-filter]').forEach(function(select){select.value='';});filterPlayerManagement();return;}
      var playerPage=e.target.closest('[data-player-page]');if(playerPage){playerAdminState.page+=playerPage.dataset.playerPage==='next'?1:-1;renderPlayerTableRows();return;}
      var playerPageGo=e.target.closest('[data-player-page-go]');if(playerPageGo){var jump=document.querySelector('[data-player-page-jump]');var total=visiblePlayerRows().length;var pages=Math.max(1,Math.ceil(total/playerAdminState.pageSize));playerAdminState.page=Math.min(Math.max(1,Number(jump&&jump.value)||1),pages);renderPlayerTableRows();return;}
      var playerClose=e.target.closest('[data-player-drawer-close]');if(playerClose){closePlayerDrawer();return;}
      var playerSec=e.target.closest('[data-player-sec]');if(playerSec){var secAct=playerSec.dataset.playerSec,secId=playerSec.dataset.playerId;var labels={send_password_reset:'向该陪玩发送密码重置邮件？管理员无法查看新密码。',force_change_password:'强制该陪玩下次登录后修改密码？',revoke_sessions:'注销该陪玩全部登录会话？',enable:'解封该陪玩账号？'};if(!confirm(labels[secAct]||'确认执行该操作？'))return;submitPlayerSecure(secAct,secId,{});return;}
      var playerAction=e.target.closest('[data-player-action]');if(playerAction){closePlayerMoreMenu();var action=playerAction.dataset.playerAction,id=playerAction.dataset.playerId,focus=playerAction.dataset.playerSection||'';if(action==='view'||action==='edit'){openPlayerDetail(id,action,focus);return;}if(action==='save-detail'){var detailForm=document.querySelector('[data-player-detail-form]');var payload=collectPlayerEditForm(detailForm);if(window.MCJAdminPlayerDetail&&window.MCJAdminPlayerDetail.isSaving&&window.MCJAdminPlayerDetail.isSaving())return;savePlayerAdminChanges('edit',id,payload,function(result){alert((result&&result.message)||'修改已保存');openPlayerDetail(id,'view',focus);});return;}if(action==='save-edit'){submitPlayerSecure('edit',id,collectPlayerEditForm(document.querySelector('[data-player-edit-form]')));return;}if(/freeze|ban-order/.test(action)&&!confirm('确认执行该陪玩账号操作？'))return;submitPlayerSecure(action,id,{});return;}var playerOpen=e.target.closest('[data-player-open]');if(playerOpen&&!e.target.closest('button,a,input,select')){openPlayerDetail(playerOpen.dataset.playerOpen,'view');return;}
      var playerBulk=e.target.closest('[data-player-bulk]');if(playerBulk){submitPlayerSecure('bulk-'+playerBulk.dataset.playerBulk,'selected',{});return;}
      var ptab=e.target.closest('[data-payment-tab]');if(ptab){renderPaymentSettings(ptab.dataset.paymentTab);return;}var couponNew=e.target.closest('[data-coupon-new]');if(couponNew){openCouponEditor('');return;}var couponEdit=e.target.closest('[data-coupon-edit]');if(couponEdit){openCouponEditor(couponEdit.dataset.couponEdit);return;}var couponCancel=e.target.closest('[data-coupon-cancel]');if(couponCancel){var ce=document.querySelector('[data-coupon-editor]');if(ce){ce.hidden=true;ce.innerHTML='';}return;}var couponToggle=e.target.closest('[data-coupon-toggle]');if(couponToggle){var enabled=couponToggle.dataset.couponEnabled==='true';if(!enabled&&!confirm('确认停用该优惠券？'))return;toggleCoupon(couponToggle.dataset.couponToggle,enabled);return;}
      var pedit=e.target.closest('[data-payment-edit]');if(pedit){renderPaymentSettings('channels',pedit.dataset.paymentEdit);return;}
      var pcancel=e.target.closest('[data-payment-cancel]');if(pcancel){renderPaymentSettings('channels');return;}
      var psecrettoggle=e.target.closest('[data-payment-secret-toggle]');if(psecrettoggle){var input=psecrettoggle.closest('.payment-secret-row').querySelector('input');if(input){input.type=input.type==='password'?'text':'password';psecrettoggle.textContent=input.type==='password'?'显示':'隐藏';}return;}
      var ptoggle=e.target.closest('[data-payment-toggle]');if(ptoggle){alert('启用或停用支付渠道属于敏感操作，请在支付安全接口接入后由超级管理员或财务管理员二次确认执行。');return;}
      var ptest=e.target.closest('[data-payment-test]');if(ptest){alert('测试事件只会发送到支付安全接口，不会修改真实订单或余额。当前接口未连接，未发送。');return;}
      var whsave=e.target.closest('[data-webhook-save]');if(whsave){alert('Webhook Secret 只能保存到服务器安全环境，当前未写入浏览器本地数据。');return;}
      var whtest=e.target.closest('[data-webhook-test]');if(whtest){alert('Webhook 测试不会修改真实订单或余额。当前支付安全接口未连接，未发送。');return;}
    });
    document.addEventListener('input',function(e){if(e.target.matches('[data-admin-chat-search]'))filterAdminChats();if(e.target.matches('[data-service-record-search]')){serviceRecordState.keyword=e.target.value||'';serviceRecordState.page=1;renderServiceRecordRows();}if(e.target.matches('[data-order-search]'))filterOrders();if(e.target.matches('[data-boss-search]'))filterBossManagement();if(e.target.matches('[data-player-search]'))filterPlayerManagement();if(e.target.matches('[data-coupon-search]')){couponState.keyword=e.target.value||'';var target=document.getElementById('couponManagement');if(target)target.innerHTML=couponPageHtml();}if(e.target.matches('[data-content-search]'))filterPlatformContentRows(e.target);});
    document.addEventListener('change',function(e){if(e.target.matches('[data-boss-check]'))updateBossBulkState();if(e.target.matches('[data-boss-filter]'))filterBossManagement();if(e.target.matches('[data-boss-page-size]')){bossAdminState.pageSize=Number(e.target.value)||20;bossAdminState.page=1;renderBossTableRows();}if(e.target.matches('[data-order-filter]'))filterOrders();if(e.target.matches('[data-content-upload]'))uploadPlatformContentFile(e.target);if(e.target.matches('[data-player-quick-field]')){var quickPayload={};quickPayload[e.target.dataset.playerQuickField]=e.target.value;savePlayerAdminChanges('quick-edit',e.target.dataset.playerId,quickPayload);return;}if(e.target.matches('[data-player-filter]'))filterPlayerManagement();if(e.target.matches('[data-player-page-size]')){playerAdminState.pageSize=Number(e.target.value)||20;playerAdminState.page=1;renderPlayerTableRows();}if(e.target.matches('[data-coupon-filter]')){couponState.filter=e.target.value||'';var target=document.getElementById('couponManagement');if(target)target.innerHTML=couponPageHtml();}});
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'){
        var adminModal=document.getElementById('adminModal');
        if(adminModal&&adminModal.classList.contains('show')){closeAdminModal();return;}
      }
      if(e.target.matches('[data-chat-input]')&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();var send=document.querySelector('[data-chat-send]');if(send)send.click();}
    });
    document.addEventListener('submit',function(e){var homeEntry=e.target.closest('[data-home-entry-form]');if(homeEntry){e.preventDefault();submitHomeEntryForm(homeEntry);return;}var homeChannel=e.target.closest('[data-home-channel-form]');if(homeChannel){e.preventDefault();submitHomeChannelForm(homeChannel);return;}var coupon=e.target.closest('[data-coupon-form]');if(coupon){e.preventDefault();submitCouponForm(coupon);return;}var content=e.target.closest('[data-content-form]');if(content){e.preventDefault();var id=content.dataset.contentId;var type=content.dataset.contentForm;submitPlatformContent(id?'save':'create',type,id,collectPlatformContentForm(content));return;}var payment=e.target.closest('[data-payment-form],[data-payment-secure-form]');if(payment){e.preventDefault();submitSecurePayment(payment);}});
  }
  function filterAdminChats(){
    var search=document.querySelector('[data-admin-chat-search]');
    var active=document.querySelector('[data-admin-chat-filter].active');
    var keyword=(search?search.value:'').trim().toLowerCase();
    var type=active?active.dataset.adminChatFilter:'全部';
    document.querySelectorAll('[data-admin-chat-id]').forEach(function(item){
      var text=(item.dataset.search||'').toLowerCase();
      var matchedKeyword=!keyword||text.indexOf(keyword)>-1;
      var matchedType=type==='全部'||item.dataset.chatType===type;
      item.style.display=matchedKeyword&&matchedType?'':'none';
    });
  }
  function normalizeServiceRecord(item,index){
    item=item||{};
    var id=item.id||item.receptionId||item.reception_id||item.receptionNo||item.reception_no||item.ticketId||item.ticket_id||item.recordNo||'';
    var hasOrder=item.orderCreated;
    if(hasOrder==null)hasOrder=item.hasOrder;
    if(hasOrder==null)hasOrder=item.has_order;
    if(hasOrder==null)hasOrder=!!(item.orderId||item.order_id);
    var record={
      key:String(id||index),
      id:String(id||''),
      time:item.receptionTime||item.reception_time||item.createdAt||item.created_at||item.time||'',
      service:item.serviceName||item.service_name||item.customerService||item.customer_service||item.staffName||item.staff_name||'未分配',
      boss:item.bossName||item.boss_name||item.customerName||item.customer_name||item.userName||item.user_name||'-',
      hasOrder:hasOrder===true||String(hasOrder)==='true'||String(hasOrder)==='1'||String(hasOrder)==='是',
      amount:item.orderAmount||item.order_amount||item.amount||item.totalAmount||item.total_amount||'',
      duration:item.serviceDuration||item.service_duration||item.duration||item.hours||'',
      status:item.status||item.currentStatus||item.current_status||'暂无状态',
      satisfaction:item.satisfaction||item.rating||item.reviewScore||item.review_score||'-',
      conversationId:item.conversationId||item.conversation_id||item.chatId||item.chat_id||'',
      orderId:item.orderId||item.order_id||'',
      refundId:item.refundId||item.refund_id||'',
      reviewId:item.reviewId||item.review_id||''
    };
    record.search=[record.id,record.time,record.service,record.boss,record.status,record.orderId,record.conversationId].join(' ').toLowerCase();
    return record;
  }
  function renderServiceRecords(){
    var target=document.getElementById('serviceRecordManagement');
    if(!target)return;
    target.innerHTML='<div class="service-record-admin"><header class="admin-section-head compact"><div><h3>接待记录</h3><p>历史接待、建单、满意度和后续处理记录。实时聊天请进入客服工作台。</p></div><span class="admin-count-pill" id="serviceRecordCount">共 0 条</span></header><div class="service-record-toolbar"><input type="search" data-service-record-search placeholder="搜索接待编号 / 客服 / 老板 / 订单号" value="'+esc(serviceRecordState.keyword)+'"><select data-service-record-filter="status"><option value="">全部状态</option><option value="接待中">接待中</option><option value="已完成">已完成</option><option value="已转交">已转交</option><option value="售后中">售后中</option></select><input type="date" data-service-record-filter="date" value="'+esc(serviceRecordState.date)+'"><button class="mini-btn primary-lite" type="button" data-service-record-search-button>搜索</button><button class="mini-btn" type="button" data-service-record-clear>重置</button><button class="mini-btn" type="button" data-service-record-refresh>刷新</button></div><div class="table-wrap service-record-table-wrap"><table class="service-record-data-table"><thead><tr><th>接待编号</th><th>接待时间</th><th>客服</th><th>老板</th><th>是否创建订单</th><th>订单金额</th><th>服务时长</th><th>当前状态</th><th>满意度</th><th>操作</th></tr></thead><tbody id="serviceRecordRows"></tbody></table></div><div class="service-record-pagination compact" id="serviceRecordPager"></div><div class="admin-sync-note" id="serviceRecordNotice" hidden></div></div>';
    renderServiceRecordRows();
    if(!serviceRecordState.loaded)loadServiceRecords();
  }
  function loadServiceRecords(){
    adminFetch('/api/admin/service-records',{headers:{'x-mcj-admin-role':getRole(),Accept:'application/json'}}).then(function(res){
      var type=res.headers.get('content-type')||'';
      if(type.indexOf('application/json')<0)return {ok:true,records:[],message:'当前静态预览未启用服务端接待记录接口'};
      return res.json().catch(function(){return {ok:false,message:'接待记录接口返回异常'}});
    }).then(function(result){
      if(!result.ok)throw new Error(result.message||'接待记录读取失败');
      var rows=result.records||result.items||result.data||[];
      if(!Array.isArray(rows))rows=rows.records||rows.items||rows.rows||[];
      serviceRecordState.rows=(Array.isArray(rows)?rows:[]).map(normalizeServiceRecord);
      serviceRecordState.loaded=true;
      serviceRecordState.error=result.message||'';
      renderServiceRecordRows();
    }).catch(function(err){
      serviceRecordState.rows=[];
      serviceRecordState.loaded=true;
      serviceRecordState.error=err.message||'接待记录读取失败';
      renderServiceRecordRows();
    });
  }
  function visibleServiceRecords(){
    var keyword=(serviceRecordState.keyword||'').trim().toLowerCase();
    var status=serviceRecordState.status||'';
    var date=serviceRecordState.date||'';
    return serviceRecordState.rows.filter(function(row){
      var matchedKeyword=!keyword||row.search.indexOf(keyword)>-1;
      var matchedStatus=!status||String(row.status||'')===status;
      var matchedDate=!date||String(row.time||'').indexOf(date)>-1;
      return matchedKeyword&&matchedStatus&&matchedDate;
    });
  }
  function serviceRecordAmount(value){
    if(value==null||value==='')return '-';
    var text=String(value);
    return /^RM/i.test(text)?text:'RM'+text;
  }
  function serviceRecordRow(row){
    return '<tr data-service-record-open="'+esc(row.key)+'"><td title="'+esc(row.id||'-')+'">'+esc(row.id||'-')+'</td><td title="'+esc(row.time||'-')+'">'+esc(row.time||'-')+'</td><td title="'+esc(row.service)+'">'+esc(row.service)+'</td><td title="'+esc(row.boss)+'">'+esc(row.boss)+'</td><td>'+esc(row.hasOrder?'是':'否')+'</td><td>'+esc(serviceRecordAmount(row.amount))+'</td><td>'+esc(row.duration||'-')+'</td><td>'+statusChip(row.status)+'</td><td>'+esc(row.satisfaction||'-')+'</td><td class="service-record-actions"><button class="mini-btn" type="button" data-service-record-action="chat" data-service-record-id="'+esc(row.key)+'">聊天</button><button class="mini-btn" type="button" data-service-record-action="order" data-service-record-id="'+esc(row.key)+'">订单</button><button class="mini-btn" type="button" data-service-record-action="refund" data-service-record-id="'+esc(row.key)+'">退款</button><button class="mini-btn" type="button" data-service-record-action="review" data-service-record-id="'+esc(row.key)+'">评价</button></td></tr>';
  }
  function renderServiceRecordRows(){
    var tbody=document.getElementById('serviceRecordRows');
    var pager=document.getElementById('serviceRecordPager');
    var count=document.getElementById('serviceRecordCount');
    var notice=document.getElementById('serviceRecordNotice');
    if(!tbody)return;
    var rows=visibleServiceRecords();
    var total=rows.length;
    var pages=Math.max(1,Math.ceil(total/serviceRecordState.pageSize));
    serviceRecordState.page=Math.min(Math.max(1,serviceRecordState.page),pages);
    var start=(serviceRecordState.page-1)*serviceRecordState.pageSize;
    var paged=rows.slice(start,start+serviceRecordState.pageSize);
    tbody.innerHTML=paged.length?paged.map(serviceRecordRow).join(''):'<tr class="service-record-empty-row"><td colspan="10"><div class="service-record-empty"><strong>暂无接待记录</strong><span>真实接待数据产生后会显示在这里。</span></div></td></tr>';
    if(count)count.textContent='共 '+total+' 条';
    if(pager)pager.innerHTML='<span>共 '+total+' 条 · 第 '+serviceRecordState.page+' / '+pages+' 页</span><div><span>每页</span><select data-service-record-page-size><option value="20" '+(serviceRecordState.pageSize===20?'selected':'')+'>20</option><option value="50" '+(serviceRecordState.pageSize===50?'selected':'')+'>50</option><option value="100" '+(serviceRecordState.pageSize===100?'selected':'')+'>100</option></select><button class="mini-btn" type="button" data-service-record-page="prev" '+(serviceRecordState.page<=1?'disabled':'')+'>上一页</button><button class="mini-btn" type="button" data-service-record-page="next" '+(serviceRecordState.page>=pages?'disabled':'')+'>下一页</button><input type="number" min="1" value="'+serviceRecordState.page+'" data-service-record-page-jump><button class="mini-btn" type="button" data-service-record-page-go>跳转</button></div>';
    if(notice){notice.hidden=!serviceRecordState.error;notice.textContent=serviceRecordState.error||'';}
  }
  function findServiceRecord(key){
    return (serviceRecordState.rows||[]).find(function(row){return String(row.key)===String(key)||String(row.id)===String(key)})||null;
  }
  function openServiceRecordDetail(key,focus){
    var row=findServiceRecord(key);
    var modal=document.getElementById('adminModal'),body=document.getElementById('modalBody');
    if(!modal||!body||!row)return;
    var focusMap={chat:'聊天记录',order:'订单',refund:'退款',review:'评价',summary:'记录详情'};
    var detail=[['接待编号',row.id||'-'],['接待时间',row.time||'-'],['客服',row.service],['老板',row.boss],['是否创建订单',row.hasOrder?'是':'否'],['订单金额',serviceRecordAmount(row.amount)],['服务时长',row.duration||'-'],['当前状态',row.status],['满意度',row.satisfaction||'-'],['会话 ID',row.conversationId||'-'],['订单 ID',row.orderId||'-'],['退款 ID',row.refundId||'-'],['评价 ID',row.reviewId||'-']];
    body.innerHTML='<h2>接待记录</h2><p class="muted">当前查看：'+esc(focusMap[focus]||focusMap.summary)+'</p><div class="detail-list">'+detail.map(function(item){return '<div><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>'}).join('')+'</div><div class="service-record-detail-actions"><button class="mini-btn" type="button" data-service-record-action="chat" data-service-record-id="'+esc(row.key)+'">查看聊天记录</button><button class="mini-btn" type="button" data-service-record-action="order" data-service-record-id="'+esc(row.key)+'">查看订单</button><button class="mini-btn" type="button" data-service-record-action="refund" data-service-record-id="'+esc(row.key)+'">查看退款</button><button class="mini-btn" type="button" data-service-record-action="review" data-service-record-id="'+esc(row.key)+'">查看评价</button></div><div class="admin-sync-note">接待记录页只负责历史管理和统计；实时沟通请进入客服工作台。</div>';
    openAdminModal();
  }
  function enhanceAdminShell(){
    decorateAdminNav();
    renderAdminTopbarStats();
    renderDashboardExperience();
    enhanceTables();
  }
  function svgMask(path){
    return 'url("data:image/svg+xml,%3Csvg xmlns='+"'http://www.w3.org/2000/svg'"+' fill='+"'none'"+' viewBox='+"'0 0 24 24'"+' stroke='+"'black'"+' stroke-width='+"'2'"+' stroke-linecap='+"'round'"+' stroke-linejoin='+"'round'"+'%3E'+path+'%3C/svg%3E")';
  }
  function decorateAdminNav(){
    var icons={
      dashboard:"%3Cpath d='M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z'/%3E",
      bosses:"%3Cpath d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='9' cy='7' r='4'/%3E%3Cpath d='M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'/%3E",
      players:"%3Cpath d='M6 12h12M8 8h8M10 16h4'/%3E%3Cpath d='M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'/%3E",
      service:"%3Cpath d='M4 12a8 8 0 0 1 16 0v4a2 2 0 0 1-2 2h-2'/%3E%3Cpath d='M6 12v4h2v-4zM16 12v4h2v-4zM12 18h4'/%3E",
      orders:"%3Cpath d='M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'/%3E%3Cpath d='M3.3 7 12 12l8.7-5M12 22V12'/%3E",
      finance:"%3Cpath d='M20 7H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z'/%3E%3Cpath d='M16 7V5a2 2 0 0 0-2-2H6'/%3E%3Ccircle cx='17' cy='13' r='1'/%3E",
      banners:"%3Cpath d='M3 5h18v14H3z'/%3E%3Cpath d='m3 15 5-5 4 4 3-3 6 6'/%3E",
      announcements:"%3Cpath d='m3 11 18-5v12L3 13z'/%3E%3Cpath d='M11.6 16.8a3 3 0 1 1-5.8-1.6'/%3E",
      messages:"%3Cpath d='M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z'/%3E",
      statistics:"%3Cpath d='M3 3v18h18'/%3E%3Cpath d='M7 16v-5M12 16V7M17 16v-3'/%3E",
      permissions:"%3Cpath d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/%3E%3Cpath d='m9 12 2 2 4-4'/%3E",
      vip:"%3Cpath d='m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z'/%3E",
      payment:"%3Crect x='2' y='5' width='20' height='14' rx='2'/%3E%3Cpath d='M2 10h20'/%3E",
      settings:"%3Cpath d='M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'/%3E%3Cpath d='M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-.4-1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 .4 1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.3.36.5.75.6 1.2.1.4.4.7.8.8H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1 .4 1.7 1.7 0 0 0-.5.6z'/%3E"
    };
    document.querySelectorAll('.side-nav button').forEach(function(btn){
      var key=btn.dataset.section||btn.dataset.toggleGroup||'settings';
      if(/recharge|withdraw|refund|commission|finance/.test(key))key='finance';
      if(/banner|announcement|ads|team|content|gameplay|price|voice|deposit|application|custom|meow|sync/.test(key))key='banners';
      if(/admin|permission|logs|security/.test(key))key='permissions';
      btn.style.setProperty('--admin-icon',svgMask(icons[key]||icons.settings));
    });
  }
  function renderAdminTopbarStats(){
    var actions=document.querySelector('.topbar-actions');
    if(!actions)return;
    actions.querySelectorAll('.admin-search,.admin-top-stat,#adminName,#adminClock,.notice-pill,.ghost-btn').forEach(function(el){el.remove();});
  }
  function paintDashboardPendingEmpty(pending){
    if(!pending)return;
    // No pending-aggregation API yet. Never paint hardcoded 0 as a real todo count.
    // Never fall back to localStorage / defaultDb / mock todo rows.
    pending.dataset.pendingSource='unwired';
    pending.dataset.realOnly='1';
    pending.innerHTML=
      '<div class="dashboard-pending-empty dashboard-chart-empty" role="status" aria-live="polite">'+
      '<strong>待办统计暂未接入</strong>'+
      '<span>暂无待办统计数据。上方真实统计卡片来自 Dashboard API；本区不展示硬编码 0，也不读取本地假数据。</span>'+
      '</div>';
  }
  function paintDashboardTrendsEmpty(dash){
    if(!dash)return;
    var existing=dash.querySelector('.dashboard-trends');
    if(existing)existing.remove();
    // No time-series API yet. Do not feed [0,0,0...] into charts.
    dash.insertAdjacentHTML('beforeend',
      '<div class="admin-chart-grid dashboard-trends" data-trend-source="unwired">'+
      dashboardTrendCard('7日订单趋势',null,'7日趋势统计暂未接入')+
      dashboardTrendCard('7日营业额趋势',null,'7日趋势统计暂未接入')+
      dashboardTrendCard('7日平台利润趋势',null,'7日趋势统计暂未接入')+
      '</div>'
    );
  }
  function renderDashboardExperience(){
    var dash=document.getElementById('section-dashboard');
    if(!dash||dash.dataset.enhanced)return;
    dash.dataset.enhanced='1';
    paintDashboardPendingEmpty(document.getElementById('dashboardPending'));
    var logsTarget=document.getElementById('table-admin_logs');
    if(logsTarget){
      logsTarget.innerHTML='<div class="activity-list"><div class="empty">暂无操作记录</div></div>';
    }
    paintDashboardTrendsEmpty(dash);
  }
  function dashboardRowDate(row){
    var raw=row&& (row.created_at||row.createdAt||row.paid_at||row.paidAt||row.completed_at||row.completedAt||'');
    if(!raw)return null;
    var d=new Date(raw);
    return isNaN(d.getTime())?null:d;
  }
  function dashboardDayKey(date){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')}
  function dashboardSeries(rows,valueFn){
    // Helper kept for a future real series API. Callers must pass REAL rows only — never localStorage.
    var days=[], map={};
    for(var i=6;i>=0;i--){var d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);var key=dashboardDayKey(d);days.push(key);map[key]=0;}
    (rows||[]).forEach(function(row){var d=dashboardRowDate(row);if(!d)return;var key=dashboardDayKey(d);if(Object.prototype.hasOwnProperty.call(map,key))map[key]+=Number(valueFn(row)||0);});
    return days.map(function(key){return map[key]||0});
  }
  function moneyNumber(value){return Number(String(value||0).replace(/[^\d.-]/g,''))||0}
  function hasTrendData(values){
    if(!values||!values.length)return false;
    return values.some(function(v){return Number(v)>0});
  }
  function dashboardTrendCard(title,values,emptyText){
    var wired=hasTrendData(values);
    var body=wired
      ? chartBars(values)
      : '<div class="dashboard-chart-empty"><strong>暂无统计数据</strong><span>'+esc(emptyText||'7日趋势统计暂未接入')+'</span></div>';
    return '<details class="admin-chart-card dashboard-trend-card"'+(wired?'':' open')+'><summary><span>'+esc(title)+'</span><small>'+(wired?'点击展开':'未接入')+'</small></summary>'+body+'</details>';
  }
  function chartBars(values){
    if(!hasTrendData(values))return '<div class="dashboard-chart-empty"><strong>暂无统计数据</strong><span>7日趋势统计暂未接入</span></div>';
    var max=Math.max.apply(null,values.concat([1]));
    return '<div class="admin-bars" aria-label="最近7天">'+values.map(function(v){return '<i style="height:'+Math.max(6,Math.round(v/max*100))+'%"></i>'}).join('')+'</div><div class="table-footer"><span>最近7天</span><span>真实数据</span></div>';
  }
  function enhanceTables(){
    document.querySelectorAll('.table-wrap').forEach(function(wrap){
      if(wrap.dataset.enhanced)return;
      wrap.dataset.enhanced='1';
      wrap.insertAdjacentHTML('beforebegin','<div class="table-tools"><button type="button" data-action="batch-select">批量操作</button><button type="button" data-action="export-csv">导出 CSV</button><button type="button" data-action="export-excel">导出 Excel</button></div>');
      wrap.insertAdjacentHTML('afterend','<div class="table-footer"><span>已启用固定表头、搜索和排序样式</span><span>第 1 / 1 页</span></div>');
    });
  }
  function val(id){var el=document.getElementById(id);return el?el.value:''}
  function v1Read(key,def){try{var v=JSON.parse(localStorage.getItem(key)||'null');return v==null?def:v}catch(e){return def}}
  function v1Write(key,val){localStorage.setItem(key,JSON.stringify(val))}
  function v1Now(){return new Date().toLocaleString('zh-CN',{hour12:false})}
  function v1RoleLabel(role){return ({boss:'&#32769;&#26495;',service:'&#23458;&#26381;',companion:'&#38506;&#29609;',player:'&#38506;&#29609;'})[role]||esc(role||'-')}
  function v1StatusLabel(status){return status==='ENABLED'?'&#21551;&#29992;':'&#20572;&#29992;'}
  function v1EnsureCompanionProfile(account){
    if(!account||account.role!=='companion')return;
    var list=v1Read('mcj_v1_profiles',[]);
    var existing=list.find(function(x){return x.account===account.account});
    if(existing){existing.name=account.name||existing.name;existing.nickname=existing.nickname||account.name||account.account;v1Write('mcj_v1_profiles',list);return;}
    list.unshift({account:account.account,name:account.name||account.account,nickname:account.name||account.account,avatar:'',intro:'',game:'',rank:'',tags:'',price:0,voice:'',photos:[]});
    v1Write('mcj_v1_profiles',list);
  }
  function renderV1AccountManagement(){
    var target=document.getElementById('table-admin_accounts');
    if(!target)return;
    var list=v1Read('mcj_v1_accounts',[]);
    target.innerHTML='<div class="table-tools"><button class="primary-btn" type="button" data-v1-new-account>&#26032;&#22686;&#36134;&#21495;</button><span>&#29992;&#20110; V1 &#23458;&#26381;&#31471;&#21644;&#38506;&#29609;&#31471;&#30331;&#24405;</span></div><form class="admin-account-form" data-v1-account-form hidden><input type="hidden" name="id"><div class="form-grid"><label>&#22995;&#21517;<input name="name" required></label><label>&#36134;&#21495;<input name="account" required></label><label>&#23494;&#30721;<input name="password" type="password" placeholder="&#26032;&#24314;&#24517;&#22635;&#65292;&#32534;&#36753;&#21487;&#30041;&#31354;"></label><label>&#36523;&#20221;<select name="role" required><option value="boss">&#32769;&#26495;</option><option value="service">&#23458;&#26381;</option><option value="companion">&#38506;&#29609;</option></select></label><label>&#29366;&#24577;<select name="status"><option value="ENABLED">&#21551;&#29992;</option><option value="DISABLED">&#20572;&#29992;</option></select></label></div><div class="row"><button class="primary-btn" type="submit">&#20445;&#23384;&#36134;&#21495;</button><button class="ghost-btn" type="button" data-v1-cancel-account>&#21462;&#28040;</button></div></form><div class="table-wrap"><table><thead><tr><th>&#22995;&#21517;</th><th>&#36134;&#21495;</th><th>&#36523;&#20221;</th><th>&#29366;&#24577;</th><th>&#23494;&#30721;</th><th>&#21019;&#24314;&#26102;&#38388;</th><th>&#26368;&#36817;&#20462;&#25913;</th><th>&#25805;&#20316;</th></tr></thead><tbody>'+(list.length?list.map(function(item){return '<tr><td>'+esc(item.name||'-')+'</td><td>'+esc(item.account||'-')+'</td><td>'+v1RoleLabel(item.role)+'</td><td><span class="chip '+(item.status==='ENABLED'?'ok':'bad')+'">'+v1StatusLabel(item.status)+'</span></td><td>&#24050;&#35774;&#32622;</td><td>'+esc(item.createdAt||'-')+'</td><td>'+esc(item.updatedAt||'-')+'</td><td><div class="row"><button class="ghost-btn" type="button" data-v1-edit-account="'+esc(item.id)+'">&#32534;&#36753;</button><button class="ghost-btn" type="button" data-v1-password-account="'+esc(item.id)+'">&#25913;&#23494;&#30721;</button><button class="ghost-btn" type="button" data-v1-toggle-account="'+esc(item.id)+'">'+(item.status==='ENABLED'?'&#20572;&#29992;':'&#21551;&#29992;')+'</button></div></td></tr>'}).join(''):'<tr><td colspan="8"><div class="empty">&#26242;&#26080;&#36134;&#21495;&#12290;&#28857;&#20987;&#26032;&#22686;&#36134;&#21495;&#24320;&#22987;&#21019;&#24314;&#12290;</div></td></tr>')+'</tbody></table></div>';
  }
  function resetV1AccountForm(){var form=document.querySelector('[data-v1-account-form]');if(!form)return;form.reset();form.elements.id.value='';form.hidden=true;}
  function bindV1AccountManagement(){
    document.addEventListener('click',function(e){
      if(e.target.closest('[data-v1-new-account]')){var form=document.querySelector('[data-v1-account-form]');if(form){form.hidden=false;form.reset();form.elements.id.value='';form.elements.status.value='ENABLED';form.elements.role.value='service';}return;}
      if(e.target.closest('[data-v1-cancel-account]')){resetV1AccountForm();return;}
      var edit=e.target.closest('[data-v1-edit-account]');
      if(edit){var list=v1Read('mcj_v1_accounts',[]),item=list.find(function(x){return x.id===edit.dataset.v1EditAccount}),form=document.querySelector('[data-v1-account-form]');if(item&&form){form.hidden=false;form.elements.id.value=item.id;form.elements.name.value=item.name||'';form.elements.account.value=item.account||'';form.elements.password.value='';form.elements.role.value=item.role||'service';form.elements.status.value=item.status||'ENABLED';form.scrollIntoView({block:'nearest'});}return;}
      var pass=e.target.closest('[data-v1-password-account]');
      if(pass){var next=prompt('\u8f93\u5165\u65b0\u5bc6\u7801');if(!next)return;var rows=v1Read('mcj_v1_accounts',[]);rows.forEach(function(x){if(x.id===pass.dataset.v1PasswordAccount){x.password=next;x.updatedAt=v1Now();}});v1Write('mcj_v1_accounts',rows);log('\u4fee\u6539 V1 \u8d26\u53f7\u5bc6\u7801');return;}
      var tog=e.target.closest('[data-v1-toggle-account]');
      if(tog){var rows2=v1Read('mcj_v1_accounts',[]);rows2.forEach(function(x){if(x.id===tog.dataset.v1ToggleAccount){x.status=x.status==='ENABLED'?'DISABLED':'ENABLED';x.updatedAt=v1Now();}});v1Write('mcj_v1_accounts',rows2);log('\u5207\u6362 V1 \u8d26\u53f7\u72b6\u6001');return;}
    });
    document.addEventListener('submit',function(e){
      if(!e.target.matches('[data-v1-account-form]'))return;
      e.preventDefault();
      var form=e.target,fd=new FormData(form),id=String(fd.get('id')||''),name=String(fd.get('name')||'').trim(),account=String(fd.get('account')||'').trim(),password=String(fd.get('password')||''),role=String(fd.get('role')||'service'),status=String(fd.get('status')||'ENABLED');
      if(!name||!account){alert('\u8bf7\u586b\u5199\u59d3\u540d\u548c\u8d26\u53f7\u3002');return;}
      var list=v1Read('mcj_v1_accounts',[]);
      if(list.some(function(x){return x.account===account&&x.id!==id})){alert('\u8d26\u53f7\u5df2\u5b58\u5728\u3002');return;}
      var item=id?list.find(function(x){return x.id===id}):null;
      if(!item&&!password){alert('\u7b2c\u4e00\u6b21\u521b\u5efa\u8d26\u53f7\u5fc5\u987b\u586b\u5199\u5bc6\u7801\u3002');return;}
      if(!item){item={id:'ACC-'+Date.now().toString(36),createdAt:v1Now()};list.unshift(item);}
      item.name=name;item.account=account;item.role=role;item.status=status;item.updatedAt=v1Now();if(password)item.password=password;
      v1Write('mcj_v1_accounts',list);
      v1EnsureCompanionProfile(item);
      log(id?'\u7f16\u8f91 V1 \u8d26\u53f7':'\u521b\u5efa V1 \u8d26\u53f7');
      resetV1AccountForm();
      
    });
  }
  function initSuperAdmin(){
    purgeStaleLocalBusinessData();
    var dash=document.getElementById('superStats');
    // Real stats are owned by admin-final-v1 renderDashboard — do not overwrite with localStorage fake cards.
    if(dash && !dash.getAttribute('data-admin-final-owned')){
      dash.setAttribute('data-admin-final-owned','1');
    }
    // Pending todos / 7-day trends: empty/unwired state only (see paintDashboardPendingEmpty).
    // Do not paint hardcoded 0 counts that look like real aggregation results.
    paintDashboardPendingEmpty(document.getElementById('dashboardPending'));
    var tables={
      bosses:[{key:'nickname',label:'老板昵称'},{key:'uid',label:'系统 UID'},{key:'phone',label:'手机号'},{key:'email',label:'邮箱'},{key:'game',label:'游戏'},{key:'gameId',label:'游戏 ID / 游戏昵称'},{key:'registered_at',label:'注册时间'},{key:'vip',label:'VIP等级'},{key:'total_spent',label:'累计消费'},{key:'balance',label:'当前余额'},{key:'status',label:'账号状态',type:'status'},{key:'invite',label:'邀请人'},{key:'actions',label:'详情',type:'actions'}],
      players:[{key:'avatar',label:'头像',type:'avatar'},{key:'name',label:'陪玩昵称'},{key:'uid',label:'UID'},{key:'phone',label:'联系电话'},{key:'id_card',label:'身份证资料'},{key:'bank',label:'结款银行账户'},{key:'audit',label:'审核状态',type:'status'},{key:'order_status',label:'接单状态',type:'status'},{key:'total_income',label:'总收入'},{key:'withdrawable',label:'可提现金额'},{key:'club',label:'所属俱乐部'},{key:'actions',label:'详情',type:'actions'}],
      wallets:[{key:'owner',label:'账户'},{key:'type',label:'钱包类型'},{key:'balance',label:'余额'},{key:'frozen',label:'冻结金额'},{key:'actions',label:'操作',type:'actions'}],
      wallet_transactions:[{key:'id',label:'流水号'},{key:'owner',label:'用户'},{key:'type',label:'类型'},{key:'amount',label:'金额'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'详情',type:'actions'}],
      withdraw_requests:[{key:'id',label:'提现单号'},{key:'owner',label:'申请人'},{key:'role',label:'身份'},{key:'amount',label:'金额'},{key:'bank',label:'收款账户'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'审核',type:'actions'}],
      clubs:[{key:'id',label:'俱乐部ID'},{key:'name',label:'俱乐部名称'},{key:'owner',label:'老板'},{key:'status',label:'状态',type:'status'},{key:'revenue',label:'营业额'},{key:'actions',label:'操作',type:'actions'}],
      invite_rebates:[{key:'id',label:'返利ID'},{key:'inviter',label:'邀请人'},{key:'invitee',label:'被邀请人'},{key:'relation',label:'邀请关系'},{key:'rebate',label:'返利金额'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'详情',type:'actions'}],
      customer_tickets:[{key:'id',label:'工单ID'},{key:'user',label:'用户'},{key:'channel',label:'渠道'},{key:'topic',label:'问题'},{key:'status',label:'状态',type:'status'},{key:'remark',label:'客服备注'},{key:'actions',label:'处理',type:'actions'}],
      reviews:[{key:'id',label:'评价ID'},{key:'order_id',label:'订单'},{key:'player',label:'陪玩'},{key:'rating',label:'评分'},{key:'content',label:'评价内容'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      games:[{key:'id',label:'游戏ID'},{key:'name',label:'游戏名称'},{key:'sort',label:'排序'},{key:'visible',label:'显示状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      admin_logs:[{key:'id',label:'日志ID'},{key:'admin',label:'管理员'},{key:'action',label:'操作内容'},{key:'time',label:'时间'}],
      recharge_requests:[{key:'id',label:'充值单号'},{key:'user',label:'用户'},{key:'amount',label:'金额'},{key:'coins',label:'喵币'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      refunds:[{key:'id',label:'退款单号'},{key:'order_id',label:'订单号'},{key:'user',label:'用户'},{key:'amount',label:'金额'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      role_permissions:[{key:'role',label:'角色'},{key:'scope',label:'权限范围'},{key:'actions',label:'操作',type:'actions'}]
    };
    Object.keys(tables).forEach(function(key){var target=document.getElementById('table-'+key);if(target)renderGenericTable(key,target,tables[key],[]);});
    // Load real companion reviews into existing reviews table (memory only — never write mcj_reviews).
    (function loadRealReviews(){
      var target=document.getElementById('table-reviews');
      if(!target)return;
      adminFetch('/api/admin/orders?action=reviews',{headers:adminApiHeaders()}).then(function(res){
        var ct=res.headers.get('content-type')||'';
        if(ct.indexOf('application/json')<0)return null;
        return res.json().catch(function(){return null});
      }).then(function(result){
        if(!result||!result.ok||!Array.isArray(result.reviews)){
          renderGenericTable('reviews',target,tables.reviews,[]);
          return;
        }
        renderGenericTable('reviews',target,tables.reviews,result.reviews);
      }).catch(function(){
        renderGenericTable('reviews',target,tables.reviews,[]);
      });
    })();
    var rechargeAlt=document.getElementById('table-recharge_requests_alt');if(rechargeAlt)renderGenericTable('recharge_requests',rechargeAlt,tables.recharge_requests,[]);
    var logsFull=document.getElementById('table-admin_logs_full');if(logsFull)renderGenericTable('admin_logs',logsFull,tables.admin_logs,[]);
    var dashboardBosses=document.getElementById('table-dashboard-bosses');
    if(dashboardBosses)renderGenericTable('bosses',dashboardBosses,tables.bosses,[]);
    var dashboardPlayers=document.getElementById('table-dashboard-players');
    if(dashboardPlayers)renderGenericTable('players',dashboardPlayers,tables.players,[]);
    ['players'].forEach(function(key){var t=document.getElementById('crud-'+key);if(t)renderCrud(key,t)});
    [
      ['crud-ads','暂无广告位数据'],
      ['table-meow_butler','暂无喵管家配置'],
      ['table-sync_center','暂无同步记录'],
      ['table-price_table','暂无价格表数据'],
      ['table-custom_orders','暂无自定义订单设置'],
      ['table-gameplay_qualifications','暂无玩法资格审核'],
      ['table-companion_rules','暂无陪玩制度内容'],
      ['table-voice_types','暂无声音类型数据'],
      ['table-companion_deposit','暂无押金设置'],
      ['statisticsPanel','暂无统计数据'],
      ['table-vip_settings','暂无 VIP 设置'],
      ['paymentSettings','']
    ].forEach(function(item){if(item[1])emptyPanel(item[0],item[1])});
    renderBossManagement();
    renderOrderManagement();
    renderPlayerManagement();
    
    renderPaymentSettings();
    renderCouponManagement();
    renderPlatformContentManagers();
    
    enhanceAdminShell();
  }
  function initClubAdmin(){
    // Hardcoded club demo metrics removed. Empty/zero only if those legacy DOM nodes exist.
    var dash=document.getElementById('clubStats');
    if(dash)statCards(dash,[{label:'今日营业额',value:'RM0'},{label:'今日订单',value:'0'},{label:'本月营业额',value:'RM0'},{label:'陪玩人数',value:'0'},{label:'待处理订单',value:'0'},{label:'可提现余额',value:'RM0'}]);
    var target=document.getElementById('clubPlayers');
    if(target)target.innerHTML='<div class="empty">暂无数据</div>';
    var ot=document.getElementById('clubOrders');
    if(ot)ot.innerHTML='<div class="empty">暂无数据</div>';
  }
  function initPlayerAdmin(){
    var dash=document.getElementById('playerStats');
    if(dash)statCards(dash,[{label:'今日订单',value:'0'},{label:'本月订单',value:'0'},{label:'收入',value:'RM0'},{label:'评分',value:'-'},{label:'完成率',value:'-'},{label:'可提现余额',value:'RM0'}]);
    var ot=document.getElementById('playerOrders');
    if(ot)ot.innerHTML='<div class="empty">暂无数据</div>';
    var rt=document.getElementById('playerReviews');
    if(rt)rt.innerHTML='<div class="empty">暂无数据</div>';
  }
  function refreshAdminIdentityFromServer(){
    var Auth=window.MCJAdminAuthFetch;
    if(!Auth||!Auth.getAccessToken||!Auth.getAccessToken())return Promise.resolve(null);
    var headers=Auth.getAuthHeaders?Auth.getAuthHeaders({Accept:'application/json'}):{Accept:'application/json'};
    return (Auth.fetch?Auth.fetch('/api/auth?action=me',{headers:headers}):fetch('/api/auth?action=me',{headers:headers}))
      .then(function(res){return res.json().catch(function(){return {}})})
      .then(function(body){
        var user=body&&(body.user||(body.session&&body.session.user));
        if(!user||!user.role)return null;
        var role=String(user.role||'');
        if(role!=='admin'&&role!=='super_admin'){
          // Database says not admin — do not keep stale local admin soft role.
          return {denied:true,user:user};
        }
        var store=localStorage.getItem('adminAuthToken')?localStorage:sessionStorage;
        var prev={};
        try{prev=JSON.parse(store.getItem('adminUser')||localStorage.getItem('adminUser')||sessionStorage.getItem('adminUser')||'{}')||{}}catch(e){prev={}}
        var next={
          id:user.id||prev.id||'',
          uid:user.uid||user.id||prev.uid||'',
          account:user.email||prev.account||'',
          email:user.email||prev.email||'',
          name:user.displayName||user.email||prev.name||'管理员',
          nickname:user.displayName||prev.nickname||'',
          role:role,
          adminRole:role==='super_admin'?'super_admin':(role==='finance_admin'?'finance_admin':'admin'),
          status:user.status||'active',
          permissions:[role==='super_admin'?'super_admin':(role==='finance_admin'?'finance_admin':'admin')]
        };
        try{
          store.setItem('adminUser',JSON.stringify(next));
          store.setItem('mcjRole',role);
          window.MCJAdminRole=next.adminRole;
        }catch(e){}
        try{
          var brandRole=document.querySelector('[data-admin-role-label]');
          if(brandRole){
            brandRole.textContent=role==='finance_admin'?'Finance Admin':(role==='admin'||role==='super_admin'?'Super Admin':'Admin');
          }
          var toggle=document.querySelector('[data-admin-profile-toggle]');
          if(toggle){
            toggle.textContent=role==='finance_admin'?'财务管理员':(role==='admin'||role==='super_admin'?'超级管理员':'管理员');
          }
        }catch(e){}
        return next;
      })
      .catch(function(){return null});
  }
  document.addEventListener('DOMContentLoaded',function(){
    function boot(){if(enforceRole()===false)return;initTabs();bindGlobal();bindPaymentAdmin();initForms();initSuperAdmin();renderHomeEntryManager();initClubAdmin();initPlayerAdmin();initTableSearch();bindV1AccountManagement();}
    function startVerified(){
      refreshAdminIdentityFromServer().then(function(identity){
        if(!identity){
          denyAdminToLogin('登录已失效，请重新登录后台。');
          return;
        }
        if(identity.denied){
          denyAdminToLogin('非管理员账号不得进入后台中心。');
          return;
        }
        boot();
      }).catch(function(){
        denyAdminToLogin('登录已失效，请重新登录后台。');
      });
    }
    var Auth=window.MCJAdminAuthFetch;
    if(!Auth||!Auth.getAccessToken||!Auth.getAccessToken()){
      denyAdminToLogin('请先使用管理员账号登录后台。');
      return;
    }
    Auth.ensureValidToken().then(startVerified).catch(function(){
      denyAdminToLogin('登录已失效，请重新登录后台。');
    });
  });
  // Back-forward cache: after logout, never show cached admin shell.
  window.addEventListener('pageshow',function(ev){
    var Auth=window.MCJAdminAuthFetch;
    var gate=window.MCJRoleGate;
    var ok=gate&&gate.isLogged?gate.isLogged('admin'):false;
    var jwt=Auth&&Auth.getAccessToken?Auth.getAccessToken():'';
    if(!ok||!jwt){
      if(ev&&ev.persisted){
        denyAdminToLogin('登录已失效，请重新登录后台。');
      }
    }
  });
  window.MCJAdminSuite={
    loadPlatformContent:loadPlatformContent,
    platformContentConfig:platformContentConfig,
    platformContentModules:platformContentModules
  };
  window.MCJAdmin={read:read,write:write,routeByRole:routeByRole};
})();



