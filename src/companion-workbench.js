(function(){
  var root=document.getElementById('companionApp');
  if(!root)return;
  var ROUTES={
    '/companion/':'dashboard','/companion/login':'login','/companion/dashboard':'dashboard',
    '/companion/order-hall':'hall','/companion/orders':'orders',
    '/companion/earnings':'earnings','/companion/wallet':'earnings',
    '/companion/profile':'profile',
    '/companion/account':'account','/companion/mine':'account','/companion/verification':'account',
    '/companion/withdraw':'withdraw',
    '/companion/messages':'messages',
    '/companion/settings':'settings',
    '/companion/popularity':'popularity'
  };
  var NAV=[
    ['dashboard','工作台','/companion/dashboard'],
    ['hall','抢单大厅','/companion/order-hall'],
    ['orders','我的订单','/companion/orders'],
    ['earnings','收益中心','/companion/earnings'],
    ['profile','我的资料（公开）','/companion/profile'],
    ['account','账号中心（隐私）','/companion/account'],
    ['messages','消息中心','/companion/messages'],
    ['settings','设置','/companion/settings']
  ];
  var BOTTOM_NAV=[
    ['dashboard','工作台','/companion/dashboard'],
    ['hall','抢单','/companion/order-hall'],
    ['orders','订单','/companion/orders'],
    ['earnings','收益','/companion/earnings'],
    ['account','账号','/companion/account']
  ];
  var HIDDEN_MVP_ROUTES={popularity:1};
  var state={route:'dashboard',session:null,data:null,notice:'',loading:false,error:'',walletWarning:'',authTab:'login',loginError:'',loginBusy:false,profileServices:[],profileErrors:{},uploadBusy:'',statusBusy:false,pendingOnlineStatus:null,settlement:null,orderFilter:'all',pollTimer:null,ordersCacheAt:0,msgFilter:'all',settings:null,earningsTab:'overview',chatSession:'cs',chatBusy:false,withdrawBusy:false,inbox:null,hallOrderType:'all',hallGame:'all'};
  var SESSION_KEY='mcjCompanionSession';
  var SETTINGS_KEY='mcjCompanionSettings';
  var MSG_READ_KEY='mcjCompanionMsgRead';
  var Auth=window.MCJAuthShell;
  var STATUS_META={
    online:{emoji:'🟢',label:'在线接单',hint:'可以进入抢单大厅，也可以收到客服派单。'},
    busy:{emoji:'🟡',label:'忙碌',hint:'已有订单，不再收到新订单。'},
    paused:{emoji:'⏸',label:'暂停接单',hint:'暂时停止接单，但保留在线。'},
    offline:{emoji:'⚫',label:'离线',hint:'完全停止工作。'}
  };
  var WD_STATUS_TEXT={pending:'待审核',pending_review:'待审核',approved:'已通过',approved_pending_pay:'已通过',paying:'审核中',paid_pending_receipt:'已通过',completed:'已打款',rejected:'已拒绝',pay_failed:'付款失败',cancelled:'已取消'};
  var LEDGER_STATUS_CN={completed:'已完成',pending:'处理中',processing:'处理中',cancelled:'已取消',failed:'失败',rejected:'已拒绝'};
  function ledgerStatusCN(s){
    var v=String(s||'').trim();
    if(WD_STATUS_TEXT[v])return WD_STATUS_TEXT[v];
    var low=v.toLowerCase();
    return LEDGER_STATUS_CN[low]||v||'-';
  }
  var STATUS_CN={
    verification:function(s){
      var v=String(s||'').trim().toLowerCase();
      if(!v||/none|not_submitted|missing|unsubmitted/.test(v))return '未提交';
      if(/approved|verified|passed|active/.test(v))return '已通过';
      if(/reject|declin|fail/.test(v))return '未通过';
      if(/pending|review|submit/.test(v))return '待审核';
      return s||'未提交';
    },
    deposit:function(s){
      var v=String(s||'').trim().toLowerCase();
      if(!v||/none|not_submitted|missing|unsubmitted/.test(v))return '未缴纳';
      if(/approved|verified|passed|paid|active|completed/.test(v))return '已缴纳';
      if(/reject|declin|fail/.test(v))return '未通过';
      if(/pending|review|submit/.test(v))return '待审核';
      return s||'未缴纳';
    }
  };
  var HALL_TYPE_FILTERS=[['all','全部'],['fixed','固定单'],['custom','自定义单']];
  var EARNINGS_TABS=[['overview','收益概览'],['withdraw','申请提现'],['records','提现记录']];
  function readSettings(){
    try{return Object.assign({notify:true,sound:true,theme:'dark'},JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}'))}catch(e){return {notify:true,sound:true,theme:'dark'}}
  }
  function saveSettings(next){state.settings=next;try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(next))}catch(e){}}
  function readMsgRead(){try{return JSON.parse(localStorage.getItem(MSG_READ_KEY)||'{}')}catch(e){return {}}}
  function markMsgRead(id){var map=readMsgRead();map[id]=1;try{localStorage.setItem(MSG_READ_KEY,JSON.stringify(map))}catch(e){}}
  function availableGames(){
    return availableServiceOptions().map(function(s){return s.name}).filter(Boolean);
  }
  function availableServiceOptions(){
    var list=[];
    var seen={};
    (state.profileServices||[]).forEach(function(s){
      var id=String((s&&s.id)||'').trim();
      var name=String((s&&(s.name||s.title))||'').trim();
      if(!id||!name||seen[id])return;
      seen[id]=1;
      list.push({id:id,name:name});
    });
    return list;
  }
  function selectedServiceIdsFromPlayer(p,raw){
    var ids=[];
    if(Array.isArray(p.serviceIds))ids=p.serviceIds.slice();
    else if(Array.isArray(p.service_ids))ids=p.service_ids.slice();
    else if(raw&&raw.service_ids){
      if(Array.isArray(raw.service_ids))ids=raw.service_ids.slice();
      else if(typeof raw.service_ids==='string'){
        try{ids=JSON.parse(raw.service_ids)}catch(e){ids=String(raw.service_ids).split(/[,，、/|]+/)}
      }
    }
    ids=(ids||[]).map(function(x){return String(x||'').trim()}).filter(Boolean);
    if(ids.length)return ids;
    var names=String(p.mainGame||raw.game||'').split(/[,，、/|]+/).map(function(x){return x.trim()}).filter(Boolean);
    var byName={};
    availableServiceOptions().forEach(function(s){byName[s.name]=s.id});
    return names.map(function(n){return byName[n]}).filter(Boolean);
  }
  function selectedServiceTypesFromPlayer(p,raw){
    var rawType=p.service_type||p.serviceType||(Array.isArray(p.serviceTypes)?p.serviceTypes.join(','):'')||raw.service_type||'';
    var types=String(rawType).split(/[,，、/|]+/).map(function(x){return String(x||'').trim()}).filter(Boolean).map(function(s){
      if(s==='陪玩服务'||s==='陪聊服务')return s;
      if(/陪聊|语音|语聊|聊天/.test(s))return '陪聊服务';
      if(/陪玩/.test(s))return '陪玩服务';
      return '';
    }).filter(Boolean);
    var uniq=[];
    types.forEach(function(t){if(uniq.indexOf(t)===-1)uniq.push(t)});
    if(!uniq.length&&(p.mainGame||raw.game||(p.serviceIds&&p.serviceIds.length)))uniq=['陪玩服务'];
    return uniq;
  }
  function num(v){var n=Number(v);return Number.isFinite(n)?n:0}
  function isAuditLocked(){
    var perm=(state.data||{}).permissions||{};
    return perm.canWork===false||perm.canSetAvailable===false;
  }
  function auditHint(){
    var perm=(state.data||{}).permissions||{};
    return perm.lockReason||'账号审核通过后即可开始接单。';
  }
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    var n = Number(v || 0);
    return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function humanId(v){
    var s=String(v==null?'':v).trim();
    if(!s)return '-';
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s))return s.slice(0,8);
    return s;
  }
  function humanOrderNo(o){
    o=o||{};
    var no=o.orderNo||o.order_no;
    if(no)return no;
    return humanId(o.id);
  }
  function infoRow(label,value){return '<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>'}
  function cleanTip(t){
    var s=String(t||'').trim();
    if(!s||/regression|selector|grabber|uuid/i.test(s))return '';
    return s;
  }
  function orderNoLookup(){
    var map={};
    ((state.data&&state.data.myOrders)||[]).forEach(function(o){map[o.id]=humanOrderNo(o)});
    return map;
  }
  function unreadCount(){
    if(state.inbox&&typeof state.inbox.unreadTotal==='number')return state.inbox.unreadTotal;
    var s=(state.data||{}).summary||{};
    if(typeof s.unreadMessages==='number'&&s.unreadMessages>0)return s.unreadMessages;
    return buildInbox().filter(function(m){return m.unread}).length;
  }
  function route(){var p=location.pathname.replace(/\/$/,'')||'/companion';if(p==='/companion')p='/companion/';return ROUTES[p]||'dashboard'}
  function go(path){history.pushState(null,'',path);paint()}
  function readSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||'null')}catch(e){return null}}
  function saveSession(session,remember){
    // Always dual-write so refresh + new tab keep companion login.
    var payload=JSON.stringify(session||{});
    try{localStorage.setItem(SESSION_KEY,payload);}catch(e){}
    try{sessionStorage.setItem(SESSION_KEY,payload);}catch(e){}
    state.session=session;
  }
  function clearSession(){
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    try{
      localStorage.removeItem('companionAuthToken');
      localStorage.removeItem('companionUser');
      sessionStorage.removeItem('companionAuthToken');
      sessionStorage.removeItem('companionUser');
    }catch(e){}
    state.session=null;
    state.data=null;
    if(window.MCJRoleGate&&typeof window.MCJRoleGate.logout==='function'){
      window.MCJRoleGate.logout('companion');
    }
  }
  function toast(msg){
    state.notice=msg||'';
    if(state.route==='login'||!state.session){
      var err=document.querySelector('[data-auth-error]');
      if(err){
        err.textContent=msg||'';
        setTimeout(function(){if(err.textContent===msg){err.textContent='';state.notice='';}},2200);
        return;
      }
    }
    paint();
    setTimeout(function(){state.notice='';paint()},2200);
  }
  function api(action,body,method){
    var opts={method:method||'POST',headers:{'Content-Type':'application/json'}};
    var session=state.session||readSession();
    if(session&&session.token)opts.headers['x-mcj-companion-token']=session.token;
    if(opts.method==='GET'){
      var qs='action='+encodeURIComponent(action);
      if(body&&typeof body==='object'){
        Object.keys(body).forEach(function(k){
          if(body[k]==null||body[k]==='')return;
          qs+='&'+encodeURIComponent(k)+'='+encodeURIComponent(body[k]);
        });
      }
      return fetch('/api/companion?'+qs,opts).then(parseResponse);
    }
    opts.body=JSON.stringify(Object.assign({action:action},body||{}));
    return fetch('/api/companion',opts).then(parseResponse);
  }
  function parseResponse(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(e){throw new Error('接口返回格式错误')}if(!res.ok||body.ok===false)throw new Error(body.message||('请求失败：HTTP '+res.status));return body})}
  function loadProfileServices(){
    return fetch('/api/platform/services?scope=profile',{headers:{Accept:'application/json'},cache:'no-store'})
      .then(function(res){return res.json().catch(function(){return {ok:false,services:[],message:'游戏列表读取失败'}})})
      .then(function(body){
        state.profileServices=(body&&body.services)||[];
        if(body&&body.source==='missing_table'){
          state.walletWarning=body.message||'游戏列表未初始化，请联系管理员执行 services 迁移。';
        }else if(body&&body.ok===false&&body.message){
          state.walletWarning=body.message;
        }
      })
      .catch(function(){state.profileServices=[];});
  }
  function mergeWithdrawals(primary,fallback){
    var byId={};
    (primary||[]).forEach(function(w){if(w&&w.id)byId[String(w.id)]=Object.assign({},w)});
    (fallback||[]).forEach(function(w){
      if(!w||!w.id)return;
      var id=String(w.id);
      byId[id]=Object.assign({},byId[id]||{},w,{
        accountLast4:(byId[id]&&byId[id].accountLast4)||w.accountLast4||'',
        paidAt:(byId[id]&&byId[id].paidAt)||w.paidAt||'',
        reviewedAt:(byId[id]&&byId[id].reviewedAt)||w.reviewedAt||''
      });
    });
    return Object.keys(byId).map(function(k){return byId[k]}).sort(function(a,b){
      return String(b.submittedAt||b.createdAt||'').localeCompare(String(a.submittedAt||a.createdAt||''));
    });
  }
  function reloadInbox(){
    if(!state.session||!state.session.token)return Promise.resolve();
    return api('inbox',{},'GET').then(function(res){
      if(res&&res.ok){
        state.inbox=res.data||res.inbox||null;
        if(state.data&&state.data.summary&&state.inbox){
          state.data.summary.unreadMessages=num(state.inbox.unreadTotal);
        }
      }
    }).catch(function(){}).then(function(){paint()});
  }
  function optimisticClearSessionUnread(sessionKey){
    if(!state.inbox)return;
    if(sessionKey==='cs'){
      (state.inbox.conversations||[]).forEach(function(c){
        if(c.key==='cs'||c.type==='cs')c.unread=0;
      });
      (state.inbox.messages||[]).forEach(function(m){
        if(m.senderRole!=='companion'&&!m.readAt)m.readAt=new Date().toISOString();
      });
    }else if(sessionKey==='system'){
      (state.inbox.systemNotices||[]).forEach(function(n){n.unread=false});
      (state.inbox.conversations||[]).forEach(function(c){
        if(c.key==='system'||c.type==='system')c.unread=0;
      });
    }
    var cs=(state.inbox.conversations||[]).filter(function(c){return c.key==='cs'||c.type==='cs'})[0];
    var sys=(state.inbox.systemNotices||[]).filter(function(n){return n.unread}).length;
    state.inbox.unreadTotal=num(cs&&cs.unread)+sys;
    state.inbox.unreadMessages=state.inbox.unreadTotal;
    if(state.data&&state.data.summary)state.data.summary.unreadMessages=state.inbox.unreadTotal;
  }
  function markActiveChatSessionRead(){
    if(!state.session||!state.session.token)return Promise.resolve();
    if(state.route!=='messages')return Promise.resolve();
    var session=state.chatSession==='system'?'system':'cs';
    optimisticClearSessionUnread(session);
    paint();
    if(session==='cs'){
      return api('mark_cs_read',{}).then(function(){return reloadInbox()}).catch(function(){return reloadInbox()});
    }
    var keys=[];
    if(state.inbox&&Array.isArray(state.inbox.systemNotices)){
      keys=state.inbox.systemNotices.map(function(n){return n.key||n.id}).filter(Boolean);
    }else{
      keys=buildInbox().map(function(m){return m.id});
    }
    keys.forEach(function(k){markMsgRead(k)});
    if(!keys.length)return reloadInbox();
    return api('mark_notices_read',{keys:keys}).then(function(){return reloadInbox()}).catch(function(){return reloadInbox()});
  }
  function loadData(opts){
    opts=opts||{};
    if(!state.session||!state.session.token)return Promise.resolve();
    var soft=!!opts.soft||!!state.data;
    if(!soft){state.loading=true;paint();}
    var boot=api('bootstrap',{},'GET');
    var needWallet=state.route==='earnings'||state.route==='withdraw'||state.route==='account'||state.route==='wallet';
    var walletReq=needWallet
      ? api('wallet',{},'GET').catch(function(){return null;})
      : Promise.resolve(null);
    var inboxReq=api('inbox',{},'GET').catch(function(){return null;});
    return Promise.all([boot,loadProfileServices(),walletReq,inboxReq]).then(function(results){
      var result=results[0]||{};
      var walletResult=results[2];
      var inboxResult=results[3];
      state.data=Object.assign({},state.data||{},result.data||{});
      state.ordersCacheAt=Date.now();
      if(inboxResult&&inboxResult.ok)state.inbox=inboxResult.data||inboxResult.inbox||null;
      if(walletResult&&walletResult.ok&&walletResult.data){
        state.data.summary=walletResult.data.summary||state.data.summary;
        state.data.earnings=walletResult.data.earnings||state.data.earnings;
        state.data.walletLedger=walletResult.data.walletLedger||state.data.walletLedger||[];
        state.data.earningDetails=walletResult.data.earningDetails||state.data.earningDetails||[];
        state.data.withdrawals=mergeWithdrawals(walletResult.data.withdrawals,state.data.withdrawals)||[];
        if(walletResult.data.withdrawalRules){
          state.data.withdrawalRules=Object.assign({},state.data.withdrawalRules||{},walletResult.data.withdrawalRules);
        }
      }
      // Do not treat informational/server notice as fatal page error when data exists.
      state.error='';
      state.walletWarning=(walletResult&&walletResult.data&&walletResult.data.warnings&&walletResult.data.warnings[0])
        || (result.data&&result.data.walletWarnings&&result.data.walletWarnings[0])
        || '';
    }).catch(function(err){
      // Keep previous data if any; wallet page must still show zeros instead of blank failure.
      state.error=err.message||'陪玩端数据读取失败';
      if(state.route==='earnings'||state.route==='withdraw'||state.route==='account'||state.route==='wallet'){
        return api('wallet',{},'GET').then(function(walletResult){
          if(!walletResult||!walletResult.ok)throw new Error((walletResult&&walletResult.message)||state.error);
          state.data=Object.assign({},state.data||{},{
            summary:walletResult.data.summary,
            earnings:walletResult.data.earnings,
            walletLedger:walletResult.data.walletLedger||[],
            withdrawals:walletResult.data.withdrawals||[],
            withdrawalRules:walletResult.data.withdrawalRules||{},
            permissions:(state.data&&state.data.permissions)||{}
          });
          state.error='';
          state.walletWarning=(walletResult.data.warnings&&walletResult.data.warnings[0])||'';
        }).catch(function(walletErr){
          state.data=Object.assign({},state.data||{},{
            summary:{todayIncome:0,monthIncome:0,totalIncome:0,withdrawable:0,frozen:0,withdrawn:0},
            earnings:{todayIncome:0,monthIncome:0,totalIncome:0,withdrawable:0,available:0,frozen:0,withdrawn:0},
            walletLedger:[],
            withdrawals:[],
            withdrawalRules:{minAmount:0,monthlyLimit:0,remainingThisMonth:0,exchangeRate:1},
            permissions:(state.data&&state.data.permissions)||{}
          });
          state.walletWarning=walletErr.message||state.error;
          if(state.route==='earnings'||state.route==='withdraw'||state.route==='account'||state.route==='wallet')state.error='';
        });
      }
    }).finally(function(){
      state.loading=false;
      paint();
      if(state.route==='messages')markActiveChatSessionRead();
    });
  }
  function startPoll(){if(state.pollTimer)clearInterval(state.pollTimer);state.pollTimer=setInterval(function(){if(!state.session||!state.session.token||document.hidden||state.statusBusy)return;if(['dashboard','hall','orders','earnings','profile','account','messages'].indexOf(state.route)===-1)return;api('bootstrap',{},'GET').then(function(result){state.data=Object.assign({},state.data||{},result.data||{});state.ordersCacheAt=Date.now();state.error='';if(state.route==='messages'){return api('inbox',{},'GET').then(function(res){if(res&&res.ok){state.inbox=res.data||res.inbox||null;if(state.data&&state.data.summary&&state.inbox)state.data.summary.unreadMessages=num(state.inbox.unreadTotal);}var session=state.chatSession==='system'?'system':'cs';var cs=(state.inbox&&state.inbox.conversations||[]).filter(function(c){return c.key==='cs'||c.type==='cs'})[0];var needMark=session==='cs'?num(cs&&cs.unread)>0:((state.inbox&&state.inbox.systemNotices)||[]).some(function(n){return n.unread});paint();if(needMark)return markActiveChatSessionRead();}).catch(function(){paint()});}paint();}).catch(function(){});},4000)}
  function init(){state.settings=readSettings();state.session=readSession();state.route=route();if(!state.session&&state.route!=='login'){go('/companion/login');return}if(state.session&&state.route==='login'){go('/companion/dashboard');return}if(state.session)loadData().then(startPoll);else paint()}
  window.addEventListener('popstate',init);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&state.session)loadData({soft:true});});
  function paint(){
    state.route=route();
    if(state.route==='withdraw'){
      state.earningsTab='withdraw';
      try{history.replaceState(null,'','/companion/earnings')}catch(e){}
      state.route='earnings';
    }
    if(state.route==='login')return renderLogin();
    if(!state.session){renderLogin();return}
    renderShell();
  }
  function noticeHtml(){return state.notice?'<div class="pw-toast show">'+esc(state.notice)+'</div>':''}
  function renderLogin(){
    var tab=state.authTab==='register'?'register':'login';
    var header=Auth&&Auth.brandHeader?Auth.brandHeader('陪玩端登录','登录或注册成为妙脆角陪玩'):'<h1 class="mcj-auth-title">陪玩端登录</h1><p class="mcj-auth-desc">登录或注册成为妙脆角陪玩</p>';
    var loginPwd=Auth&&Auth.passwordField?Auth.passwordField('password','密码'):'<label class="mcj-auth-field">密码<input name="password" type="password" autocomplete="current-password" required></label>';
    var regPwd=Auth&&Auth.passwordField?Auth.passwordField('password','密码','autocomplete="new-password" minlength="8"'):'<label class="mcj-auth-field">密码<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>';
    var regConfirm=Auth&&Auth.passwordField?Auth.passwordField('confirm_password','确认密码','autocomplete="new-password" minlength="8"'):'<label class="mcj-auth-field">确认密码<input name="confirm_password" type="password" autocomplete="new-password" minlength="8" required></label>';
    root.innerHTML=
      '<main class="mcj-auth-page">'+
      '<section class="mcj-auth-card">'+header+
      '<div class="mcj-auth-tabs">'+
      '<button class="mcj-auth-btn '+(tab==='login'?'primary active':'ghost')+'" type="button" data-auth-tab="login">登录</button>'+
      '<button class="mcj-auth-btn '+(tab==='register'?'primary active':'ghost')+'" type="button" data-auth-tab="register">注册陪玩</button>'+
      '</div>'+
      '<form class="mcj-auth-form" data-login '+(tab==='login'?'':'hidden')+' autocomplete="on">'+
      '<label class="mcj-auth-field">陪玩 ID / 邮箱 / 手机号<input name="account" autocomplete="username" required></label>'+
      loginPwd+
      '<label class="mcj-auth-check"><input name="remember" type="checkbox" checked> 记住登录</label>'+
      '<button class="mcj-auth-btn primary" type="submit"'+(state.loginBusy?' disabled':'')+'>'+(state.loginBusy?'登录中…':'登录')+'</button>'+
      '<button class="mcj-auth-btn ghost" type="button" data-forgot-password>忘记密码</button>'+
      '<p class="mcj-auth-error" data-auth-error>'+esc(state.loginError||'')+'</p>'+
      '</form>'+
      '<form class="mcj-auth-form" data-register '+(tab==='register'?'':'hidden')+' autocomplete="on">'+
      '<label class="mcj-auth-field">邮箱<input name="email" type="email" autocomplete="email" required></label>'+
      '<label class="mcj-auth-field">陪玩昵称<input name="nickname" required></label>'+
      '<label class="mcj-auth-field">手机号 / 联系方式<input name="phone" autocomplete="tel"></label>'+
      regPwd+regConfirm+
      '<label class="mcj-auth-check"><input name="agree" type="checkbox" required> 我已阅读并同意服务条款</label>'+
      '<label class="mcj-auth-check"><input name="remember" type="checkbox" checked> 注册后保持登录</label>'+
      '<button class="mcj-auth-btn primary" type="submit">注册并提交资料</button>'+
      '<p class="mcj-auth-error" data-auth-error></p>'+
      '</form>'+
      '<p class="mcj-auth-note">正式数据保存到统一数据库；未配置数据库时不会生成本地假账号。</p>'+
      '</section></main>';
    if(Auth&&Auth.bindPasswordToggles)Auth.bindPasswordToggles(root);
  }
  function title(){return ({dashboard:'工作台',hall:'抢单大厅',orders:'我的订单',earnings:'收益中心',wallet:'收益中心',profile:'我的资料（公开）',account:'账号中心（隐私）',mine:'账号中心（隐私）',withdraw:'提现',messages:'消息中心',settings:'设置',popularity:'我的人气'})[state.route]||'陪玩端'}
  function maintenanceHtml(name){return '<div class="pw-page-head"><div><h2>'+esc(name||'功能开发中')+'</h2><p>该模块今晚暂未开放，请先处理抢单与订单完成。</p></div><button class="pw-btn primary" type="button" data-route="/companion/dashboard">返回工作台</button></div><div class="pw-empty">功能开发中</div>'}
  function bottomNavHtml(){
    return '<nav class="pw-bottom-nav">'+BOTTOM_NAV.map(function(n){
      var active=state.route===n[0]||(n[0]==='account'&&state.route==='mine')||(n[0]==='earnings'&&state.route==='wallet');
      return '<button type="button" class="'+(active?'active':'')+'" data-route="'+n[2]+'">'+n[1]+'</button>';
    }).join('')+'</nav>';
  }
  function settlementModalHtml(){
    var s=state.settlement;if(!s)return '';
    var rows=[
      ['订单编号',s.orderNo||humanId(s.orderId)],
      ['老板', (s.bossName||'-')+(s.bossUid?' / '+s.bossUid:'')],
      ['服务项目',s.serviceName||s.game||'-'],
      ['服务时长',s.duration||'-'],
      ['订单总猫粮',s.totalCatFood],
      ['平台抽成比例',(s.platformCommissionRate!=null?s.platformCommissionRate:'-')+'%'],
      ['平台抽成猫粮',s.platformCommissionCatFood],
      ['邀请返点/其他扣除',s.rebateOrOtherDeduction||0],
      ['陪玩实际到账猫粮',s.companionNetCatFood],
      ['完成时间',s.completedAt||'-'],
      ['结算状态',s.settlementStatus||'已结算']
    ];
    return '<div class="pw-modal" data-close-settlement><div class="pw-dialog" data-settlement-dialog><div class="pw-dialog-head"><h3>订单结算详情</h3><button type="button" class="pw-btn" data-close-settlement>关闭</button></div><div class="pw-info-list">'+rows.map(function(r){return '<div><span>'+esc(r[0])+'</span><strong>'+esc(r[1])+'</strong></div>'}).join('')+'</div></div></div>';
  }
  function renderShell(){
    var data=state.data||{},player=data.player||state.session.user||{},lock=data.permissions&&data.permissions.lockReason;
    var unread=unreadCount();
    root.innerHTML='<div class="pw-shell"><aside class="pw-side"><div class="pw-brand"><strong>MEOW CUI JIAO</strong><span>Companion Workbench</span></div><nav class="pw-nav">'+NAV.map(function(n){
      var badge=n[0]==='messages'&&unread?' <em class="pw-nav-badge">'+unread+'</em>':'';
      return '<button class="'+(state.route===n[0]||(n[0]==='account'&&(state.route==='mine'||state.route==='verification'))||(n[0]==='earnings'&&state.route==='wallet')?'active':'')+'" data-route="'+n[2]+'">'+n[1]+badge+'</button>';
    }).join('')+'</nav></aside><section class="pw-main"><header class="pw-top"><div><h1>'+title()+'</h1><p>'+(lock?esc(lock):'抢单 → 服务 → 完成订单 → 收益提现')+'</p></div><div class="pw-account"><button class="pw-avatar" data-account-toggle>'+esc(String(player.name||player.uid||'P').slice(0,1).toUpperCase())+'</button><div class="pw-menu"><button type="button" data-route="/companion/profile">我的资料</button><button type="button" data-route="/companion/account">账号中心</button><button type="button" data-route="/companion/settings">设置</button><button class="danger" type="button" data-logout>退出登录</button></div></div></header><main class="pw-page">'+pageHtml()+'</main></section>'+bottomNavHtml()+'</div>'+noticeHtml()+settlementModalHtml();
  }
  function pageHtml(){
    if(state.loading&&!state.data)return '<div class="pw-empty pw-skeleton"><div class="pw-skel-line"></div><div class="pw-skel-line short"></div><div class="pw-skel-cards"></div><span>加载中…</span></div>';
    var softBanner=state.loading&&state.data?'<div class="pw-soft-loading" aria-live="polite">同步中…</div>':'';
    if(HIDDEN_MVP_ROUTES[state.route])return softBanner+maintenanceHtml(title());
    if(state.error&&!state.data&&state.route!=='earnings'&&state.route!=='withdraw'&&state.route!=='account')return '<div class="pw-empty"><strong>数据源未就绪</strong><span>'+esc(state.error)+'</span></div>';
    var body='';
    if(state.route==='hall')body=hallHtml();
    else if(state.route==='orders')body=ordersHtml();
    else if(state.route==='earnings'||state.route==='wallet')body=earningsHtml();
    else if(state.route==='withdraw'){state.earningsTab='withdraw';body=earningsHtml();}
    else if(state.route==='messages')body=messagesHtml();
    else if(state.route==='settings')body=settingsHtml();
    else if(state.route==='popularity')body=popularityHtml();
    else if(state.route==='profile')body=profileHtml();
    else if(state.route==='account'||state.route==='mine')body=accountHtml();
    else body=dashboardHtml();
    return softBanner+body;
  }
  function metric(label,value){return '<article class="pw-card pw-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></article>'}
  function popularityHtml(){
    var pop=(state.data&&state.data.popularity)||{};
    var w=pop.weekly||{},m=pop.monthly||{},t=pop.total||{};
    var tip=cleanTip(w.tip)||'完成订单、好评与礼物可提升人气。';
    var penalties=(w.penalties||[]).map(function(p){return '<div><span>'+esc(p.type)+' ×'+esc(p.count)+'</span><strong>'+esc(p.points)+'</strong></div>'}).join('')||'<div><span>本周扣分</span><strong>无</strong></div>';
    return '<div class="pw-page-head"><div><h2>我的人气</h2><p>排名来自真实订单、评价、礼物与在线数据，刷新后不会丢。</p></div></div>'+
      '<section class="pw-card pad" style="margin-bottom:14px"><strong style="display:block;margin-bottom:8px">动力提示</strong><p style="margin:0;color:rgba(255,220,235,.92)">'+esc(tip)+'</p></section>'+
      '<section class="pw-grid">'+metric('本周排名',w.rank||'-')+metric('本月排名',m.rank||'-')+metric('总榜排名',t.rank||'-')+metric('本周人气值',w.score||0)+metric('距上一名',w.gapToPrevious==null?'-':w.gapToPrevious)+metric('本周完成订单',w.completedOrders||0)+metric('本周好评',(w.fiveStarReviews||0)+(w.fourStarReviews||0))+metric('本周礼物猫粮',w.giftCatFood||0)+metric('本周在线(分钟)',w.onlineMinutes||0)+'</section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>本周扣分记录</h3><div class="pw-info-list">'+penalties+'</div></section>';
  }
  function currentOnlineStatus(){
    var p=(state.data&&state.data.player)||{};
    var s=String(p.onlineStatus||'offline').toLowerCase();
    return STATUS_META[s]?s:'offline';
  }
  function applyOnlineStatusUi(next){
    if(state.data&&state.data.player){
      state.data.player.onlineStatus=next;
      state.data.player.onlineStatusLabel=(STATUS_META[next]&&STATUS_META[next].label)||next;
      state.data.player.workStatus=state.data.player.onlineStatusLabel;
    }
    document.querySelectorAll('[data-online-status]').forEach(function(btn){
      var on=btn.dataset.onlineStatus===next;
      btn.classList.toggle('is-active',on);
      btn.setAttribute('aria-checked',on?'true':'false');
    });
    var label=document.querySelector('[data-current-status-label]');
    if(label){
      var m=STATUS_META[next]||{};
      label.textContent=(m.emoji?m.emoji+' ':'')+(m.label||next);
    }
  }
  function commitOnlineStatus(next){
    state.statusBusy=true;
    state.pendingOnlineStatus=null;
    api('set_online_status',{online_status:next}).then(function(x){
      var saved=x.onlineStatus||next;
      if(state.data&&state.data.player){
        state.data.player.onlineStatus=saved;
        state.data.player.onlineStatusLabel=x.onlineStatusLabel||((STATUS_META[saved]||{}).label);
        state.data.player.workStatus=state.data.player.onlineStatusLabel;
      }
      applyOnlineStatusUi(saved);
      toast(x.message||'状态已更新');
    }).catch(function(err){
      toast(err.message||'状态更新失败');
    }).finally(function(){
      state.statusBusy=false;
      var pending=state.pendingOnlineStatus;
      if(pending&&pending!==currentOnlineStatus()){
        state.pendingOnlineStatus=null;
        applyOnlineStatusUi(pending);
        commitOnlineStatus(pending);
        return;
      }
      loadData({soft:true});
    });
  }
  function statusSwitcherHtml(extraClass){
    var cur=currentOnlineStatus();
    var locked=isAuditLocked();
    var metaCur=STATUS_META[cur]||STATUS_META.offline;
    var label=locked?'审核中（不可接单）':(metaCur.emoji+' '+metaCur.label);
    return '<div class="pw-status-panel '+(extraClass||'')+(state.statusBusy?' is-busy':'')+(locked?' is-locked':'')+'">'+
      '<div class="pw-status-current">今日状态：<strong data-current-status-label>'+esc(label)+'</strong></div>'+
      '<div class="pw-status-switch" role="radiogroup" aria-label="接单状态">'+
      ['online','busy','paused','offline'].map(function(key){
        var meta=STATUS_META[key];
        var active=!locked&&cur===key;
        return '<button type="button" class="pw-btn pw-status-btn'+(active?' is-active':'')+(locked?' is-disabled':'')+'" role="radio" aria-checked="'+(active?'true':'false')+'" data-online-status="'+key+'" '+(locked?'disabled':'')+' aria-label="'+esc(meta.label)+'：'+esc(meta.hint)+'"><span class="pw-status-emoji" aria-hidden="true">'+meta.emoji+'</span><span class="pw-status-btn-label">'+esc(meta.label)+'</span></button>';
      }).join('')+
      '</div>'+
      (locked
        ?'<p class="pw-status-hint warn" data-status-hint>'+esc(auditHint())+'</p>'
        :(extraClass&&String(extraClass).indexOf('compact')>=0
          ?'<p class="pw-status-hint" data-status-hint>'+esc(metaCur.hint)+'</p>'
          :'<ul class="pw-status-guide">'+
            ['online','busy','paused','offline'].map(function(key){
              var m=STATUS_META[key];
              return '<li><strong>'+m.emoji+' '+esc(m.label)+'</strong><span>'+esc(m.hint)+'</span></li>';
            }).join('')+
          '</ul>'))+
      '</div>';
  }
  function dashboardHtml(){
    var s=(state.data||{}).summary||{};
    var online=currentOnlineStatus()==='online';
    var locked=isAuditLocked();
    var designated=num(s.waitingConfirm||s.designatedPending);
    var banner=locked
      ?'<div class="pw-alert" role="status"><strong>账号审核中</strong><span>'+esc(auditHint())+'</span><button class="pw-btn" type="button" data-route="/companion/profile">完善公开资料</button></div>'
      :(designated>0?'<div class="pw-alert designated" role="status"><strong>你有新的指定订单</strong><span>共 '+esc(designated)+' 单等待确认接单</span><button class="pw-btn primary" type="button" data-route="/companion/orders" data-order-filter="waiting_confirm">去处理</button></div>':'');
    return '<div class="pw-page-head"><div><h2>工作台</h2><p>先切换今日状态，再处理订单。收益与提现请到独立页面。</p></div><div class="pw-actions"><button class="pw-btn primary" type="button" data-enter-hall '+(locked?'disabled':'')+'>进入抢单大厅</button><button class="pw-btn" data-route="/companion/orders">我的订单</button></div></div>'+
      banner+
      statusSwitcherHtml()+
      (!locked&&!online?'<div class="pw-note" style="margin:0 0 14px">请先切换为在线接单。</div>':'')+
      '<section class="pw-grid">'+
      metric('待确认',num(s.waitingConfirm))+
      metric('待开始',num(s.waitingStart))+
      metric('进行中',num(s.runningOrders))+
      metric('今日完成',num(s.todayCompleted))+
      '</section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>待处理事项</h3>'+todoList()+'</section>'+
      '<div class="pw-actions" style="margin-top:14px"><button class="pw-btn" type="button" data-route="/companion/earnings">收益中心</button><button class="pw-btn" type="button" data-route="/companion/messages">消息中心</button></div>';
  }
  function todoList(){var s=(state.data||{}).summary||{},p=(state.data||{}).player||{};var rows=[['待确认订单',s.waitingConfirm||0],['待开始订单',s.waitingStart||0],['待完成订单',s.waitingComplete||0],['待处理消息',unreadCount()],['资料审核状态',STATUS_CN.verification(p.auditStatus)],['押金状态',STATUS_CN.deposit(p.depositStatus)]];return '<div class="pw-info-list">'+rows.map(function(r){return '<div><span>'+esc(r[0])+'</span><strong>'+esc(r[1])+'</strong></div>'}).join('')+'</div>'}
  function orderStatus(o){return o.orderStatus||o.statusText||o.status||'-'}
  function fmtTime(v){if(!v)return '-';try{return new Date(v).toLocaleString('zh-CN',{hour12:false})}catch(e){return String(v)}}
  var REJECT_REASONS=['正在服务其他订单','时间无法配合','临时有事','不接该项目','其他'];
  function orderActions(o){
    var s=orderStatus(o),id=esc(o.id);var raw=o.status||o.rawStatus||'';var out=[];
    // Open-grab applicant: never show 开始订单 until boss selected (confirmed).
    if(o.grabStatus==='pending_customer_selection'||(raw==='waiting_boss_confirm'&&!o.companionId)){
      out.push('<span class="pw-note">已抢单，等待老板确认人选后进入待开始</span>');
      return out.join('');
    }
    if(o.grabStatus==='not_selected'){
      out.push('<span class="pw-note">该订单已由其他陪玩接单</span>');
      return out.join('');
    }
    if(s==='待老板确认'||s==='等待老板选择')out.push('<span class="pw-note">等待老板确认陪玩</span>');
    if(raw==='claimed'||/等待陪玩确认|已支付待陪玩/.test(s)){
      out.push('<div class="pw-order-actions sticky">'+
        '<button class="pw-btn primary" type="button" data-order-action="accept_direct_order" data-order-id="'+id+'">确认接单</button>'+
        '<button class="pw-btn danger" type="button" data-order-action="reject_direct_order" data-order-id="'+id+'">无法接单</button>'+
        '</div>');
    }
    if(raw==='confirmed'||s==='已接单待开始'||s==='待开始')out.push('<button class="pw-btn primary" data-order-action="start_order" data-order-id="'+id+'">开始订单</button>');
    if((s==='进行中'||raw==='in_progress')&&!o.completionPending)out.push('<button class="pw-btn primary" data-order-action="complete_order" data-order-id="'+id+'">完成订单</button>');
    if(o.completionPending&&raw==='in_progress')out.push('<span class="pw-note">已申请完成，等待老板确认</span>');
    if(raw==='completed'||s==='已完成'){
      out.push('<button class="pw-btn" type="button" data-view-settlement="'+id+'">查看结算详情</button>');
    }
    return out.join('')||'<span class="pw-note">无可用操作</span>';
  }
  function designatedOrderCard(o){
    var banner=o.status==='claimed'?'<div class="pw-order-banner">你有新的指定订单</div>':'';
    return '<article class="pw-order-card'+(o.status==='claimed'?' is-designated':'')+'">'+banner+
      '<header><div><h3>'+esc(humanOrderNo(o))+'</h3><p>'+esc(o.game||o.serviceName||'-')+' / '+esc(o.serviceName||o.serviceContent||'-')+'</p></div><span class="pw-status info">'+esc(orderStatus(o))+'</span></header>'+
      '<div class="pw-order-meta">'+
      '<div><span>老板昵称/编号</span><strong>'+esc((o.bossName||'-')+(o.bossUid?' / '+o.bossUid:''))+'</strong></div>'+
      '<div><span>数量/预计时长</span><strong>'+esc(o.duration||(o.hours?o.hours+'小时':'-'))+'</strong></div>'+
      '<div><span>陪玩单价</span><strong>'+money(o.unitPrice||0)+'</strong></div>'+
      '<div><span>本单总额</span><strong>'+money(o.amount||0)+'</strong></div>'+
      '<div><span>预计到手猫粮</span><strong>'+money(o.playerIncome||0)+'</strong></div>'+
      '<div><span>平台抽成</span><strong>'+money(o.platformFee||0)+'</strong></div>'+
      '<div><span>游戏 ID</span><strong>'+esc(o.gameId||'-')+'</strong></div>'+
      '<div><span>老板备注</span><strong>'+esc(o.bossNotes||'-')+'</strong></div>'+
      '<div><span>下单时间</span><strong>'+esc(fmtTime(o.createdAt))+'</strong></div>'+
      '<div><span>最迟确认时间</span><strong>'+esc(fmtTime(o.confirmDeadline))+'</strong></div>'+
      '</div><footer class="pw-actions">'+orderActions(o)+'</footer></article>';
  }
  function ordersHtml(){
    var rows=(state.data&&state.data.myOrders)||[];
    var filter=state.orderFilter||'all';
    var designatedCount=rows.filter(function(o){return o.status==='claimed'}).length;
    var filtered=rows.filter(function(o){
      if(filter==='waiting_selection')return o.grabStatus==='pending_customer_selection'||o.status==='waiting_boss_confirm';
      if(filter==='waiting_confirm')return o.status==='claimed';
      if(filter==='waiting_start')return o.status==='confirmed';
      if(filter==='running')return o.status==='in_progress'&&!o.completionPending;
      if(filter==='completed')return o.status==='completed'||o.completionPending||orderStatus(o)==='已完成';
      if(filter==='cancelled')return o.status==='cancelled';
      if(filter==='after_sale')return o.status==='refund_requested'||o.status==='refunded'||o.status==='disputed';
      return true;
    });
    var tabs=[
      ['all','全部'],
      ['waiting_selection','等待老板选择'],
      ['waiting_confirm','待确认'],
      ['waiting_start','待开始'],
      ['running','进行中'],
      ['completed','已完成'],
      ['cancelled','已取消'],
      ['after_sale','售后订单']
    ];
    return '<div class="pw-page-head"><div><h2>我的订单</h2><p>所有订单来自统一订单表；指定订单需先确认接单后才能开始服务。</p></div></div>'+
      (designatedCount?'<div class="pw-alert designated"><strong>你有新的指定订单</strong><span>共 '+esc(designatedCount)+' 单待确认</span></div>':'')+
      '<div class="pw-tabs">'+tabs.map(function(t){
        return '<button type="button" class="'+(filter===t[0]?'active':'')+'" data-order-filter="'+t[0]+'">'+t[1]+'</button>';
      }).join('')+'</div>'+
      '<section class="pw-list">'+(filtered.length?filtered.map(designatedOrderCard).join(''):'<div class="pw-empty"><strong>暂无订单</strong><span>接单成功后会显示在这里。</span></div>')+'</section>';
  }
  function computeIncomeStats(){
    var ledger=(state.data&&state.data.walletLedger)||[];
    var now=new Date();
    var y=new Date(now);y.setDate(y.getDate()-1);
    var yesterday=y.toISOString().slice(0,10);
    var weekStart=new Date(now);
    var dow=(weekStart.getDay()+6)%7;
    weekStart.setHours(0,0,0,0);
    weekStart.setDate(weekStart.getDate()-dow);
    var yesterdayIncome=0,weekIncome=0;
    ledger.forEach(function(r){
      if(r.typeCode!=='companion_income')return;
      var day=String(r.createdAt||'').slice(0,10);
      if(!day)return;
      if(day===yesterday)yesterdayIncome+=num(r.amount);
      if(new Date(day+'T00:00:00')>=weekStart)weekIncome+=num(r.amount);
    });
    return {yesterdayIncome:yesterdayIncome,weekIncome:weekIncome};
  }
  function earningsHtml(){
    var tab=state.earningsTab||'overview';
    var body=tab==='withdraw'
      ?'<div class="pw-form-narrow">'+earningsWithdrawTab()+'</div>'
      :(tab==='records'
        ?'<div class="pw-list-narrow">'+earningsRecordsTab()+'</div>'
        :earningsOverviewTab());
    return '<div class="pw-page-head"><div><h2>收益中心</h2><p>收入与流水来自真实数据库，切换下方标签查看概览 / 提现 / 记录。</p></div></div>'+
      '<div class="pw-tabs">'+EARNINGS_TABS.map(function(t){
        return '<button type="button" class="'+(tab===t[0]?'active':'')+'" data-earnings-tab="'+t[0]+'">'+t[1]+'</button>';
      }).join('')+'</div>'+
      body;
  }
  function earningsOverviewTab(){
    var e=(state.data&&state.data.earnings)||{},summary=(state.data&&state.data.summary)||{},ledger=(state.data&&state.data.walletLedger)||[],details=(state.data&&state.data.earningDetails)||[],level=(state.data&&state.data.levelInfo)||{},warn=state.walletWarning||'';
    var available=e.available!=null?e.available:e.withdrawable;
    var frozen=e.frozen!=null?e.frozen:summary.frozen||0;
    var commission=level.platformCommissionRate!=null?level.platformCommissionRate:(level.orderCommissionRate||0);
    var stats=computeIncomeStats();
    var noMap=orderNoLookup();
    return (warn?'<div class="pw-empty" style="margin-bottom:12px"><strong>部分数据读取异常</strong><span>'+esc(warn)+'</span></div>':'')+
      '<section class="pw-grid">'+
      metric('今日收入',money(num(e.todayIncome)))+
      metric('昨日收入',money(num(stats.yesterdayIncome)))+
      metric('本周收入',money(num(stats.weekIncome)))+
      metric('本月收入',money(num(e.monthIncome||summary.monthIncome)))+
      metric('累计收入',money(num(e.totalIncome||summary.totalIncome)))+
      metric('可提现猫粮',money(num(available)))+
      metric('冻结中',money(num(frozen)))+
      metric('平台抽成',esc(commission)+'%')+
      '</section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>奖励 / 其它</h3><div class="pw-info-list">'+infoRow('奖励猫粮',money(num(e.bonus||e.reward||0)))+infoRow('已提现',money(num(e.withdrawn||summary.withdrawn)))+'</div></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>收入明细</h3>'+(details.length?'<div class="pw-table-wrap"><table class="pw-table"><thead><tr><th>类型</th><th>订单</th><th>订单总额</th><th>平台抽成</th><th>实际到账</th><th>状态</th><th>时间</th></tr></thead><tbody>'+details.map(function(x){
        var s=x.settlement||{};
        var gross=s.totalCatFood!=null?s.totalCatFood:x.amount;
        var fee=s.platformCommissionCatFood!=null?s.platformCommissionCatFood:0;
        var net=s.companionNetCatFood!=null?s.companionNetCatFood:x.amount;
        var no=x.orderId?(noMap[x.orderId]||humanId(x.orderId)):'-';
        return '<tr><td data-label="类型">'+esc(x.type||'订单收入')+'</td><td data-label="订单">'+esc(no)+'</td><td data-label="订单总额">'+money(num(gross))+'</td><td data-label="平台抽成">'+money(num(fee))+'</td><td data-label="实际到账">'+money(num(net))+'</td><td data-label="状态">'+esc(ledgerStatusCN(x.status))+'</td><td data-label="时间">'+esc(fmtTime(x.createdAt))+'</td></tr>';
      }).join('')+'</tbody></table></div>':'<div class="pw-empty">暂无收入明细</div>')+'</section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>猫粮流水</h3>'+(ledger.length?'<div class="pw-table-wrap"><table class="pw-table"><thead><tr><th>类型</th><th>金额</th><th>关联</th><th>状态</th><th>时间</th></tr></thead><tbody>'+ledger.map(function(x){
        var rel=x.orderId?(noMap[x.orderId]||humanId(x.orderId)):(x.withdrawalId?'提现 '+humanId(x.withdrawalId):(x.note||'-'));
        return '<tr><td data-label="类型">'+esc(x.type||'-')+'</td><td data-label="金额">'+(x.direction==='out'?'-':'')+money(x.amount||0)+'</td><td data-label="关联">'+esc(rel)+'</td><td data-label="状态">'+esc(ledgerStatusCN(x.status))+'</td><td data-label="时间">'+esc(fmtTime(x.createdAt))+'</td></tr>';
      }).join('')+'</tbody></table></div>':'<div class="pw-empty">暂无流水</div>')+'</section>';
  }
  function earningsWithdrawTab(){
    var e=(state.data&&state.data.earnings)||{},rules=(state.data&&state.data.withdrawalRules)||{},perm=(state.data&&state.data.permissions)||{};
    var can=!!perm.canWithdraw&&!state.withdrawBusy;
    var available=e.available!=null?e.available:e.withdrawable;
    return (!perm.canWithdraw&&perm.withdrawLockReason?'<div class="pw-empty" style="margin-bottom:12px"><strong>暂不可提现</strong><span>'+esc(perm.withdrawLockReason)+'</span></div>':'')+
      '<form class="pw-card pad pw-form" data-withdraw-form novalidate>'+
      '<div class="pw-info-list" style="margin-bottom:14px">'+
      infoRow('可提现余额',money(num(available)))+
      infoRow('最低提现金额',(rules.minAmount||0)+' 猫粮')+
      infoRow('预计到账时间','1–3 个工作日')+
      infoRow('提现账户',rules.currentAccount||'未绑定')+
      infoRow('本月剩余次数',(rules.remainingThisMonth||0)+' / '+(rules.monthlyLimit||0))+
      '</div>'+
      '<label>提现猫粮数量<input name="amount" type="number" inputmode="decimal" step="1" placeholder="请输入数量" '+(can?'':'disabled')+'></label>'+
      '<label>备注（可选）<input name="remark" placeholder="可选" '+(can?'':'disabled')+'></label>'+
      '<button class="pw-btn primary" type="submit" '+(can?'':'disabled')+'>'+(state.withdrawBusy?'提交中…':'提交提现申请')+'</button>'+
      '</form>';
  }
  function earningsRecordsTab(){
    var withdrawals=((state.data&&state.data.withdrawals)||[]).slice().sort(function(a,b){return String(b.submittedAt||b.createdAt||'').localeCompare(String(a.submittedAt||a.createdAt||''))});
    if(!withdrawals.length)return '<div class="pw-empty"><strong>暂无提现记录</strong><span>提交提现申请后会显示在这里。</span></div>';
    return '<section class="pw-list">'+withdrawals.map(function(x){
      var statusKey=x.status||'';
      var statusCn=WD_STATUS_TEXT[statusKey]||x.statusText||statusKey||'-';
      var tagClass=statusKey==='completed'?'ok':((statusKey==='rejected'||statusKey==='pay_failed')?'bad':(statusKey==='cancelled'?'muted':'warn'));
      var last4=x.accountLast4?String(x.accountLast4):'';
      return '<details class="pw-card pad pw-record-card">'+
        '<summary>'+
          '<span>'+esc(fmtTime(x.submittedAt||x.createdAt))+' · '+money(num(x.catFoodAmount||x.amount))+'</span>'+
          '<span class="pw-status-tag '+tagClass+'">'+esc(statusCn)+'</span>'+
        '</summary>'+
        '<div class="pw-info-list pw-record-body">'+
          infoRow('单号',x.withdrawalNo||humanId(x.id))+
          infoRow('提现金额',money(num(x.catFoodAmount||x.amount)))+
          infoRow('到账金额',money(num(x.netAmountRm||0))+' RM')+
          infoRow('收款账户',last4?('尾号 '+last4):'-')+
          infoRow('提交时间',fmtTime(x.submittedAt||x.createdAt))+
          infoRow('审核时间',fmtTime(x.reviewedAt||x.approvedAt))+
          infoRow('打款时间',fmtTime(x.paidAt))+
          (x.rejectReason?infoRow('拒绝原因',x.rejectReason):'')+
        '</div>'+
      '</details>';
    }).join('')+'</section>';
  }
  function buildInbox(){
    var read=readMsgRead();
    var items=[];
    var p=(state.data&&state.data.player)||{};
    var v=(state.data&&state.data.verification)||{};
    var d=(state.data&&state.data.deposit)||{};
    var orders=(state.data&&state.data.myOrders)||[];
    var withdrawals=(state.data&&state.data.withdrawals)||[];
    function push(id,cat,title,body,at){
      items.push({id:id,category:cat,title:title,body:body,at:at||'',unread:!read[id]});
    }
    if(isAuditLocked())push('sys-audit','audit','账号审核中',auditHint(),'');
    if(v.identityRejectReason)push('audit-id','audit','实名认证驳回',v.identityRejectReason,'');
    if(v.paymentRejectReason)push('audit-pay','audit','收款账户驳回',v.paymentRejectReason,'');
    if(d.rejectReason||v.depositRejectReason)push('audit-dep','audit','押金审核驳回',d.rejectReason||v.depositRejectReason,'');
    if(v.applicationRejectReason)push('audit-app','audit','资料审核驳回',v.applicationRejectReason,'');
    push('sys-welcome','system','欢迎使用陪玩端','完善公开资料与账号中心后，等待后台审核通过即可接单。','');
    orders.slice(0,20).forEach(function(o){
      push('ord-'+o.id,'order','订单 '+humanOrderNo(o),orderStatus(o)+' · '+(o.game||o.serviceName||''),o.updatedAt||o.createdAt||'');
    });
    withdrawals.forEach(function(w){
      push('wd-'+w.id,'withdraw','提现 '+(w.withdrawalNo||humanId(w.id)),(WD_STATUS_TEXT[w.status]||w.statusText||w.status)+' · '+(w.catFoodAmount||w.amount||0)+' 猫粮',w.submittedAt||w.createdAt||'');
    });
    var pop=((state.data&&state.data.popularity)||{}).weekly||{};
    var tip=cleanTip(pop.tip);
    if(tip)push('act-pop','activity','人气活动',tip,'');
    return items;
  }
  var CATEGORY_LABEL_CN={system:'系统通知',order:'订单通知',withdraw:'提现通知',audit:'审核通知',activity:'活动通知'};
  function chatCsPanelHtml(inbox){
    var messages=(inbox&&inbox.messages)||[];
    var busy=!!state.chatBusy;
    var head='<div class="pw-chat-head"><div><h3>官方客服</h3><p>'+(inbox?'工作时间 9:00–24:00，非工作时间将延迟回复':'客服连接中，请稍后重试')+'</p></div></div>';
    var body;
    if(!inbox){
      body='<div class="pw-empty"><strong>暂时无法连接客服</strong><span>请稍后重试，或先查看系统通知。</span></div>';
    }else if(!messages.length){
      body='<div class="pw-empty"><strong>暂无消息</strong><span>发送消息即可联系官方客服。</span></div>';
    }else{
      body=messages.filter(function(m){
        var c=String(m.content||'');
        return !/^(CHAT-|E2E-MSG-|CS-LINK-|SVC-|MSG-|ORDER-CHAT-)/i.test(c.trim());
      }).map(function(m){
        var side=m.side||(m.senderRole==='companion'?'right':'left');
        var Media=window.MCJChatMedia;
        var isImg=Media&&Media.isImageMessage(m);
        var body=isImg?Media.imageBubbleHtml(Media.imageUrlOf(m),esc):('<div class="pw-bubble">'+esc(m.content)+'</div>');
        var pending=m._pending?' · 上传中…':'';
        var failed=m._failed?' · 发送失败':'';
        return '<div class="pw-msg '+esc(side)+'" data-msg-id="'+esc(m.id||m._localId||'')+'">'+body+'<small>'+esc(m.senderLabel||'')+' · '+esc(fmtTime(m.createdAt))+pending+failed+'</small></div>';
      }).join('');
      if(!body)body='<div class="pw-empty"><strong>暂无消息</strong><span>发送消息即可联系官方客服。</span></div>';
    }
    var composer='<form class="pw-composer" data-chat-composer>'+
      '<div class="mcj-composer-tools">'+
      '<button class="mcj-composer-tool" type="button" data-pw-emoji '+(busy?'disabled':'')+' aria-label="表情">😊</button>'+
      '<button class="mcj-composer-tool" type="button" data-pw-image '+(busy?'disabled':'')+' aria-label="图片">🖼</button>'+
      '</div>'+
      '<textarea name="content" placeholder="输入消息，Enter 发送，Shift+Enter 换行" data-chat-input '+(busy?'disabled':'')+'></textarea>'+
      '<div class="pw-send-line"><span class="mcj-upload-status" data-pw-upload-status>'+(busy?'发送中…':'')+'</span><button class="pw-btn primary" type="submit" '+(busy?'disabled':'')+'>发送</button></div>'+
      '</form>';
    return '<div class="pw-chat-main">'+head+'<div class="pw-messages">'+body+'</div>'+composer+'</div>';
  }
  function chatSystemPanelHtml(notices){
    var unread=notices.filter(function(n){return n.unread}).length;
    var total=notices.length;
    var head='<div class="pw-chat-head"><div><h3>系统通知</h3><p>全部 '+esc(total)+' · 未读 '+esc(unread)+'</p></div><button class="pw-btn" type="button" data-msg-read-all '+(unread?'':'disabled')+'>全部已读</button></div>';
    var body=notices.length?'<div class="pw-notice-list">'+notices.map(function(n){
      var cat=n.categoryLabel||CATEGORY_LABEL_CN[n.category]||n.category||'通知';
      return '<article class="pw-msg-card'+(n.unread?' is-unread':'')+'" data-notice-id="'+esc(n.id||n.key)+'"><header><strong>'+esc(n.title)+'</strong><span>'+esc(cat)+'</span></header><p>'+esc(n.body)+'</p><footer>'+esc(fmtTime(n.at))+(n.unread?' · 未读':'')+'</footer></article>';
    }).join('')+'</div>':'<div class="pw-empty"><strong>暂无通知</strong><span>订单 / 审核 / 提现 / 活动通知会出现在这里。</span></div>';
    return '<div class="pw-chat-main pw-chat-main-notices">'+head+body+'</div>';
  }
  function messagesHtml(){
    var inbox=state.inbox;
    var session=state.chatSession==='system'?'system':'cs';
    var localInbox=buildInbox();
    var systemNotices=(inbox&&inbox.systemNotices)?inbox.systemNotices:localInbox.map(function(m){
      return {id:m.id,key:m.id,title:m.title,body:m.body,at:m.at,category:m.category,unread:m.unread};
    });
    var csConv=inbox&&Array.isArray(inbox.conversations)?inbox.conversations.filter(function(c){return c.key==='cs'||c.type==='cs'})[0]:null;
    var csUnread=csConv?num(csConv.unread):0;
    var sysUnread=systemNotices.filter(function(n){return n.unread}).length;
    var sessions=[
      {key:'cs',title:'官方客服',last:(csConv&&csConv.lastMessage)||'有问题可以咨询官方客服',unread:csUnread,icon:'🎧'},
      {key:'system',title:'系统通知',last:(systemNotices[0]&&systemNotices[0].title)||'暂无通知',unread:sysUnread,icon:'🔔'}
    ];
    var listHtml=sessions.map(function(s){
      return '<button type="button" class="pw-session'+(session===s.key?' active':'')+'" data-chat-session="'+s.key+'">'+
        '<span class="pw-session-avatar" aria-hidden="true">'+s.icon+'</span>'+
        '<span><b>'+esc(s.title)+'</b><span>'+esc(s.last)+'</span></span>'+
        (s.unread?'<em class="pw-unread">'+esc(s.unread)+'</em>':'')+
      '</button>';
    }).join('');
    var rightHtml=session==='cs'?chatCsPanelHtml(inbox):chatSystemPanelHtml(systemNotices);
    return '<div class="pw-page-head"><div><h2>消息中心</h2><p>官方客服与系统通知，未读共 '+esc(csUnread+sysUnread)+' 条。</p></div></div>'+
      '<div class="pw-chat"><div class="pw-chat-list"><div class="pw-session-list">'+listHtml+'</div></div>'+rightHtml+'</div>';
  }
  function settingsHtml(){
    var s=state.settings||readSettings();
    return '<div class="pw-page-head"><div><h2>设置</h2><p>仅影响本机陪玩端体验。</p></div></div>'+
      '<section class="pw-card pad"><h3>主题</h3><p class="pw-note">当前为固定黑粉运营主题（上线版不可切换品牌色）。</p><div class="pw-info-list"><div><span>主题</span><strong>暗色粉（默认）</strong></div></div></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>通知</h3><label class="pw-check"><input type="checkbox" data-setting="notify" '+(s.notify?'checked':'')+'> 接收订单 / 提现 / 审核提醒</label></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>声音</h3><label class="pw-check"><input type="checkbox" data-setting="sound" '+(s.sound?'checked':'')+'> 新消息提示音（本机）</label></section>'+
      '<section class="pw-card pad" style="margin-top:14px"><h3>账号</h3><button class="pw-btn danger" type="button" data-logout>退出登录</button></section>';
  }
  function fieldErr(name){var msg=state.profileErrors&&state.profileErrors[name];return msg?'<span class="pw-field-error" data-field-error="'+esc(name)+'">'+esc(msg)+'</span>':''}
  function fieldLabel(text,required){return '<span class="pw-field-label">'+esc(text)+(required?'<i class="pw-req">*</i>':'')+'</span>'}
  function profileHtml(){
    var p=(state.data&&state.data.player)||{};
    var raw=p.raw||{};
    var level=(state.data&&state.data.levelInfo)||{};
    var media=(state.data&&state.data.media)||[];
    var avatarMedia=media.filter(function(m){return m.mediaType==='avatar'})[0];
    var gallery=media.filter(function(m){return m.mediaType==='gallery'}).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)});
    var avatarUrl=avatarMedia&&avatarMedia.url?avatarMedia.url:(p.hasCustomAvatar?p.avatar:'');
    var displayAvatar=avatarUrl||'/default-avatar.png';
    var gender=String(raw.gender||'');
    var gameId=p.gameId||raw.game_id||'';
    var serviceOptions=availableServiceOptions();
    var selectedIds=selectedServiceIdsFromPlayer(p,raw);
    var selectedTypes=selectedServiceTypesFromPlayer(p,raw);
    var gameList=availableGames();
    selectedIds.forEach(function(id){
      if(!serviceOptions.some(function(s){return s.id===id})){
        // keep orphan selected id with name fallback from game string
        var name=String(p.mainGame||raw.game||'').split(/[,，、/|]+/).map(function(x){return x.trim()}).filter(Boolean)[0]||id;
        serviceOptions.push({id:id,name:name});
      }
    });
    var gamePrices=p.gamePrices||level.gamePrices||{};
    var publicTags=String(p.publicTags||'').trim()||String(raw.public_tags||'').trim();
    if(!publicTags){
      publicTags=String(p.tags||raw.tags||'').replace(/\[\[MCJ_[^\]]+\]\]/g,'').replace(/游戏ID:[^,，]*/g,'').split(/[,，、]/).map(function(x){return x.trim()}).filter(function(x){return x&&gameList.indexOf(x)===-1}).join('、');
    }
    var uploadBusy=state.uploadBusy;
    var minP=level.minPrice!=null?level.minPrice:20;
    var maxP=level.maxPrice!=null?level.maxPrice:30;
    var maxPlus=!!level.maxPlus;
    var rangeText=level.priceRangeText||('RM'+minP+'–RM'+maxP+(maxPlus?'+':'')+' / 小时');
    var levelLabel=level.level||p.level||'未设置';
    var fallbackPrice=level.price!=null?level.price:(p.rawPrice||p.price||'');
    var needsReset=!!(level.priceNeedsReset||p.priceNeedsReset);
    var genderRadios=['男','女','不公开'].map(function(g){
      return '<label class="pw-radio"><input type="radio" name="gender" value="'+esc(g)+'" '+(gender===g?'checked':'')+'> '+esc(g)+'</label>';
    }).join('');
    var serviceTypeChecks=['陪玩服务','陪聊服务'].map(function(t){
      var on=selectedTypes.indexOf(t)!==-1;
      return '<label class="pw-check-chip"><input type="checkbox" name="service_type_opt" value="'+esc(t)+'" '+(on?'checked':'')+'> '+esc(t)+'</label>';
    }).join('');
    var gameChecks=serviceOptions.length?serviceOptions.map(function(s){
      var on=selectedIds.indexOf(s.id)!==-1;
      return '<label class="pw-check-chip"><input type="checkbox" name="service_id_opt" value="'+esc(s.id)+'" data-game-name="'+esc(s.name)+'" '+(on?'checked':'')+' data-game-toggle> '+esc(s.name)+'</label>';
    }).join(''):'<div class="pw-empty"><strong>暂无游戏</strong><span>请后台在「服务管理」新增游戏后刷新。</span></div>';
    var priceRows=serviceOptions.length?serviceOptions.map(function(s){
      var on=selectedIds.indexOf(s.id)!==-1;
      var val=gamePrices[s.id]!=null&&gamePrices[s.id]!==''?gamePrices[s.id]:(gamePrices[s.name]!=null&&gamePrices[s.name]!==''?gamePrices[s.name]:(on&&!needsReset?fallbackPrice:''));
      return '<label class="pw-game-price'+(on?' is-on':'')+'" data-game-price-row="'+esc(s.id)+'">'+
        '<span>'+esc(s.name)+'</span>'+
        '<span class="pw-game-price-unit"><input name="game_price_'+esc(s.id)+'" type="number" inputmode="decimal" step="0.01" min="0" value="'+(needsReset&&!(gamePrices[s.id]||gamePrices[s.name])?'':esc(val))+'" placeholder="RM" '+(on?'':'disabled')+' data-min-price="'+esc(minP)+'" data-max-price="'+esc(maxP)+'" data-max-plus="'+(maxPlus?'1':'0')+'"> /小时</span>'+
        '</label>';
    }).join(''):'';
    var galleryHtml=gallery.map(function(item,idx){
      return '<div class="pw-gallery-item" data-media-id="'+esc(item.id)+'">'+
        '<img src="'+esc(item.url||'/default-avatar.png')+'" alt="相册">' +
        '<div class="pw-gallery-actions">'+
        '<button type="button" class="pw-btn" data-gallery-move="-1" '+(idx===0?'disabled':'')+'>上移</button>'+
        '<button type="button" class="pw-btn" data-gallery-move="1" '+(idx===gallery.length-1?'disabled':'')+'>下移</button>'+
        '<button type="button" class="pw-btn danger" data-delete-media="'+esc(item.id)+'">删除</button>'+
        '</div></div>';
    }).join('');
    var previewId=encodeURIComponent(p.id||p.uid||'');
    return '<div class="pw-page-head"><div><h2>我的资料（公开）</h2><p>老板可见。联系方式 / 身份证 / 押金 / 收款请到「账号中心」。</p></div><div class="pw-actions">'+
      (previewId?'<a class="pw-btn" href="/profile.html?player='+previewId+'" target="_blank" rel="noopener">预览老板端展示</a>':'')+
      '<button class="pw-btn" type="button" data-route="/companion/account">账号中心</button>'+
      '</div></div>'+
      '<div class="pw-alert"><strong>隐私提醒</strong><span>以下内容将展示给老板，请勿填写身份证、银行卡、私人联系方式等隐私信息。</span></div>'+
      '<form class="pw-form-narrow pw-profile-form" data-profile-form novalidate>'+
      '<section class="pw-card pad" style="margin-bottom:14px"><h3>基本展示资料</h3>'+
      '<div class="pw-field pw-upload-block">'+
      fieldLabel('头像',false)+
      '<div class="pw-avatar-upload">'+
      '<img class="pw-avatar-preview" src="'+esc(displayAvatar)+'" alt="头像预览" data-avatar-preview>'+
      '<div class="pw-upload-actions">'+
      '<label class="pw-btn'+(uploadBusy==='avatar'?' is-busy':'')+'">'+
      (uploadBusy==='avatar'?'上传中…':'上传头像')+
      '<input type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/*" capture="environment" data-upload-avatar hidden '+(uploadBusy?'disabled':'')+'>'+
      '</label>'+
      (avatarUrl?'<button type="button" class="pw-btn danger" data-delete-avatar>删除头像</button>':'')+
      '</div></div>'+
      '<p class="pw-field-hint">支持 jpg / png / webp，单张不超过 5MB。</p>'+
      '</div>'+
      '<div class="pw-two-col">'+
      '<div class="pw-field">'+fieldLabel('昵称',true)+'<input name="nickname" value="'+esc(p.name||'')+'" placeholder="例如：1717大王" autocomplete="nickname">'+fieldErr('nickname')+'</div>'+
      '<div class="pw-field">'+fieldLabel('年龄',true)+'<input name="age" type="number" inputmode="numeric" min="18" max="60" value="'+esc(raw.age||'')+'" placeholder="例如 23">'+fieldErr('age')+'</div>'+
      '</div>'+
      '<div class="pw-two-col">'+
      '<div class="pw-field">'+fieldLabel('性别',true)+'<div class="pw-radio-row">'+genderRadios+'</div>'+fieldErr('gender')+'</div>'+
      '<div class="pw-field">'+fieldLabel('地区',true)+'<input name="region" value="'+esc(raw.region||'')+'" placeholder="例如：马来西亚·吉隆坡">'+fieldErr('region')+'</div>'+
      '</div>'+
      '<div class="pw-field"><span class="pw-field-label">当前等级</span><p class="pw-field-hint">'+esc(levelLabel)+'（由后台评定，决定可设置的价格区间）</p></div>'+
      '<div class="pw-field">'+fieldLabel('标签',false)+'<input name="public_tags" value="'+esc(publicTags)+'" placeholder="例如：温柔、技术流、可语音"></div>'+
      '<div class="pw-field">'+fieldLabel('介绍',false)+'<textarea name="bio" rows="4" placeholder="简单介绍你的技术、声音和陪玩风格">'+esc(p.bio||'')+'</textarea></div>'+
      '</section>'+
      '<section class="pw-card pad" style="margin-bottom:14px"><h3>游戏与价格</h3>'+
      '<div class="pw-field">'+fieldLabel('可提供服务',true)+'<div class="pw-chip-grid">'+serviceTypeChecks+'</div>'+'<p class="pw-field-hint">可多选：陪玩服务 / 陪聊服务</p>'+fieldErr('service_type')+'</div>'+
      '<div class="pw-field">'+fieldLabel('可接游戏',true)+'<div class="pw-chip-grid">'+gameChecks+'</div>'+'<p class="pw-field-hint">从后台启用游戏中多选；每个勾选游戏需单独设置价格</p>'+fieldErr('main_game')+'</div>'+
      '<div class="pw-field">'+fieldLabel('各游戏价格',true)+
      '<div class="pw-price-meta"><div>当前等级：<strong>'+esc(levelLabel)+'</strong></div><div>可设置范围：<strong>'+esc(rangeText)+'</strong></div>'+
      (needsReset?'<div class="pw-field-error">有价格超出等级范围，请按游戏重新设置</div>':'')+
      '</div>'+
      '<div class="pw-game-price-grid" data-game-price-grid>'+priceRows+'</div>'+fieldErr('price')+'</div>'+
      '<div class="pw-two-col">'+
      '<div class="pw-field">'+fieldLabel('游戏 ID',true)+'<input name="game_id" value="'+esc(gameId)+'" placeholder="游戏内昵称或 ID">'+fieldErr('game_id')+'</div>'+
      '<div class="pw-field">'+fieldLabel('段位',false)+'<input name="rank" value="'+esc(raw.game_rank||raw.rank||'')+'" placeholder="例如：超凡 2"></div>'+
      '</div>'+
      '<div class="pw-field">'+fieldLabel('擅长位置',false)+'<input name="position" value="'+esc(raw.position||'')+'" placeholder="例如：决斗 / 烟位"></div>'+
      '</section>'+
      '<section class="pw-card pad" style="margin-bottom:14px"><h3>展示资料</h3>'+
      '<div class="pw-field pw-upload-block">'+
      fieldLabel('相册',false)+
      '<div class="pw-gallery-grid" data-gallery-list>'+(galleryHtml||'<div class="pw-empty tiny">还没有相册照片，请至少上传 1 张（最多 6 张）</div>')+'</div>'+
      '<label class="pw-btn'+(uploadBusy==='gallery'||gallery.length>=6?' is-busy':'')+'">'+
      (uploadBusy==='gallery'?'上传中…':(gallery.length>=6?'已达 6 张上限':'上传相册照片'))+
      '<input type="file" accept="image/jpeg,image/jpg,image/png,image/webp,image/*" capture="environment" data-upload-gallery hidden '+(uploadBusy||gallery.length>=6?'disabled':'')+'>'+
      '</label>'+
      '</div>'+
      '<div class="pw-field pw-upload-block">'+
      fieldLabel('录音',false)+
      (function(){var v=p.voiceUrl||raw.voice_url||'';return v?'<p class="pw-field-hint">当前已有录音：<a href="'+esc(v)+'" target="_blank" rel="noopener">试听</a></p>':'<p class="pw-field-hint">尚未上传语音试听。</p>';})()+
      '<label class="pw-btn'+(uploadBusy==='voice'?' is-busy':'')+'">'+
      (uploadBusy==='voice'?'上传中…':'上传录音')+
      '<input type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg" data-upload-voice hidden '+(uploadBusy?'disabled':'')+'>'+
      '</label>'+
      '</div>'+
      '<div class="pw-field">'+fieldLabel('在线状态',false)+'<p class="pw-field-hint">当前：'+esc((STATUS_META[currentOnlineStatus()]||{}).label||'离线')+'（只读，审核通过后可在工作台切换）</p></div>'+
      (function(){
        var reviews=(state.data&&state.data.reviews)||[];
        var fav=num((state.data&&state.data.summary&&state.data.summary.favorites)||p.favorites||0);
        var list=reviews.slice(0,5).map(function(r){
          return '<div><span>'+esc(r.bossName||r.bossUid||'老板')+' · '+esc(r.rating||'-')+'★</span><strong>'+esc(r.content||'无文字')+'</strong></div>';
        }).join('')||'<div><span>暂无评价</span><strong>0</strong></div>';
        return '<div class="pw-field"><span class="pw-field-label">评价 / 收藏（公开只读）</span><div class="pw-info-list"><div><span>收藏数</span><strong>'+esc(fav)+'</strong></div>'+list+'</div></div>';
      })()+
      '</section>'+
      '<button class="pw-btn primary" type="submit">保存公开资料</button>'+
      '</form>';
  }
  function matchesHallType(o,filter){
    if(filter==='all')return true;
    if(filter==='fixed')return o.orderTypeKey==='gameplay_mall';
    if(filter==='custom')return o.orderTypeKey==='custom'||o.orderTypeKey==='open_grab';
    return true;
  }
  function hallHtml(){
    var rows=(state.data&&state.data.openOrders)||[],perm=(state.data&&state.data.permissions)||{};
    var statusKey=currentOnlineStatus();
    var online=statusKey==='online';
    var locked=isAuditLocked();
    var statusMeta=STATUS_META[statusKey]||STATUS_META.offline;
    var typeFilter=state.hallOrderType||'all';
    var gameFilter=state.hallGame||'all';
    var games=[];
    var seenGame={};
    rows.forEach(function(o){var g=o.game||'';if(g&&!seenGame[g]){seenGame[g]=1;games.push(g)}});
    var filtered=rows.filter(function(o){
      if(!matchesHallType(o,typeFilter))return false;
      if(gameFilter!=='all'&&o.game!==gameFilter)return false;
      return true;
    });
    var statusReadout='<div class="pw-card pad" style="margin-bottom:14px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px">'+
      '<span>当前状态：<strong>'+esc((locked?'审核中（不可接单）':statusMeta.emoji+' '+statusMeta.label))+'</strong>。如需切换，请前往工作台。</span>'+
      '<button class="pw-btn" type="button" data-route="/companion/dashboard">前往工作台</button>'+
      '</div>';
    var filtersRow='<div class="pw-hall-filters">'+
      HALL_TYPE_FILTERS.map(function(t){return '<button type="button" class="pw-tab-chip'+(typeFilter===t[0]?' active':'')+'" data-hall-type="'+t[0]+'">'+t[1]+'</button>'}).join('')+
      '<select data-hall-game aria-label="游戏筛选">'+
        '<option value="all">全部游戏</option>'+
        games.map(function(g){return '<option value="'+esc(g)+'" '+(gameFilter===g?'selected':'')+'>'+esc(g)+'</option>'}).join('')+
      '</select>'+
      '<button class="pw-btn" type="button" data-hall-refresh>刷新</button>'+
      '</div>';
    return '<div class="pw-page-head"><div><h2>抢单大厅</h2><p>仅「在线接单」可进入抢单。</p></div></div>'+
      statusReadout+
      (locked?'<div class="pw-empty" style="margin-bottom:12px"><strong>暂不可抢单</strong><span>'+esc(auditHint())+'</span></div>':'')+
      filtersRow+
      '<section class="pw-card-list">'+(filtered.length?filtered.map(function(o){
        var already=!!o.alreadyGrabbed||!!(o.myGrab&&o.myGrab.companionId);
        var disabled=false,btnLabel='立即抢单';
        if(already){disabled=true;btnLabel='已抢单，等待老板确认';}
        else if(locked){disabled=true;btnLabel='审核通过后可抢单';}
        else if(statusKey==='busy'){disabled=true;btnLabel='当前忙碌，无法抢新订单';}
        else if(statusKey==='paused'){disabled=true;btnLabel='已暂停接单，无法抢新订单';}
        else if(statusKey==='offline'){disabled=true;btnLabel='离线状态无法抢单';}
        else if(!perm.canAcceptOrder){disabled=true;btnLabel=perm.lockReason||perm.acceptLockReason||'暂不可接单';}
        var serviceText=String(o.serviceContent||'')
          .replace(/\[\[ORDER_GRABS\]\][\s\S]*$/g,'')
          .replace(/\[\[COMPLETION_PENDING\]\]/g,'')
          .replace(/\buuid\s+create\s+regression\s+\d+\b/gi,'')
          .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'')
          .replace(/\b(selector|grabber)\b/gi,'')
          .trim()||'-';
        var orderNo=o.orderNo||humanId(o.id)||'-';
        var created=o.createdAt||o.appointmentAt||'';
        var createdLabel=created?fmtTime(created):'-';
        return '<article class="pw-grab-card" data-order-id="'+esc(o.id)+'"><header><div><span class="pw-type">'+esc(o.orderType||o.orderSource||'订单')+'</span><h3>'+esc(o.game||'-')+'</h3><p>'+esc(serviceText)+'</p></div><strong>'+money(o.amount||o.budget||0)+'</strong></header><div class="pw-order-meta"><div><span>订单编号</span><strong>'+esc(orderNo)+'</strong></div><div><span>服务类型</span><strong>'+esc(o.serviceType||o.serviceName||o.orderType||'-')+'</strong></div><div><span>游戏</span><strong>'+esc(o.game||'-')+'</strong></div><div><span>区服</span><strong>'+esc(o.gameServer||'-')+'</strong></div><div><span>单价</span><strong>'+money(o.unitPrice||0)+'</strong></div><div><span>时长/局数</span><strong>'+esc(o.duration||'-')+'</strong></div><div><span>老板备注</span><strong>'+esc(o.bossNotes||o.remark||'-')+'</strong></div><div><span>下单时间</span><strong>'+esc(createdLabel)+'</strong></div><div><span>订单来源</span><strong>'+esc(o.orderSource||o.orderType||'-')+'</strong></div><div><span>预计收入</span><strong>'+money(o.playerIncome||0)+'</strong></div><div><span>当前状态</span><strong>'+esc(o.statusText||o.orderStatus||'待抢单')+'</strong></div></div><footer><button class="pw-btn primary" data-accept-order="'+esc(o.id)+'" '+(disabled?'disabled':'')+'>'+esc(btnLabel)+'</button></footer></article>';
      }).join(''):'<div class="pw-empty"><strong>暂无可抢订单</strong><span>'+(locked?auditHint():(!online?'请先切换为在线接单。':'客服发布订单后会自动显示，或调整筛选条件。'))+'</span></div>')+'</section>';
  }
  function accountHtml(){
    var v=(state.data&&state.data.verification)||{},d=(state.data&&state.data.deposit)||{},level=(state.data&&state.data.levelInfo)||{},p=(state.data&&state.data.player)||{};
    var raw=p.raw||{};
    var rules=(state.data&&state.data.withdrawalRules)||{};
    var rejectBits=[v.identityRejectReason,v.paymentRejectReason,v.applicationRejectReason,v.mediaRejectReason,v.depositRejectReason,d.rejectReason].filter(Boolean);
    return '<div class="pw-page-head"><div><h2>账号中心（隐私）</h2><p>仅本人 / 客服 / 后台可见，老板永远看不到。</p></div><button class="pw-btn" type="button" data-route="/companion/profile">公开资料</button></div>'+
      '<div class="pw-alert"><strong>隐私提示</strong><span>本页面仅本人和平台后台可见，不会公开给老板。</span></div>'+
      (rejectBits.length?'<div class="pw-empty" style="margin-bottom:12px"><strong>审核驳回</strong><span>'+esc(rejectBits.join('；'))+'</span></div>':'')+
      '<div class="pw-two-col">'+
        '<section class="pw-card pad"><h3>账号信息</h3><div class="pw-info-list">'+
          infoRow('登录邮箱',p.email||p.uid||'-')+
          infoRow('联系方式',raw.contact_phone||v.phone||'未填写')+
          infoRow('实名认证',STATUS_CN.verification(v.identityStatus))+
          infoRow('真实姓名',v.realName||'未填写')+
          infoRow('资料审核状态',STATUS_CN.verification(p.auditStatus))+
        '</div></section>'+
        '<section class="pw-card pad"><h3>提现与押金</h3><div class="pw-info-list">'+
          infoRow('收款账户审核',STATUS_CN.verification(v.bankStatus))+
          infoRow('银行名称',v.bankName||'未填写')+
          infoRow('当前提现账户',rules.currentAccount||'未绑定')+
          infoRow('押金状态',STATUS_CN.deposit(d.status||v.depositStatus))+
          infoRow('当前等级',level.level||p.level||'未设置')+
        '</div>'+
        '<div class="pw-actions" style="margin-top:12px"><button class="pw-btn primary" type="button" data-route="/companion/earnings" data-earnings-tab="withdraw">去提现</button></div>'+
        '</section>'+
      '</div>'+
      '<form class="pw-card pad pw-form pw-form-narrow" style="margin-top:14px" data-private-contact-form><h3>联系方式</h3>'+
      '<label>联系方式（WhatsApp / 手机）<input name="contact_phone" value="'+esc(raw.contact_phone||v.phone||'')+'" required placeholder="仅后台/客服可见"></label>'+
      '<button class="pw-btn primary" type="submit">保存联系方式</button></form>'+
      '<form class="pw-card pad pw-form pw-form-narrow" style="margin-top:14px" data-verification-form><h3>身份证 / 实名认证 / 收款账户</h3>'+
      '<label>真实姓名<input name="real_name" value="'+esc(v.realName||'')+'" required></label>'+
      '<label>身份证号码<input name="identity_no" required></label>'+
      '<label>身份证正面（可选）<input name="id_front" placeholder="data:image/... 或留空"></label>'+
      '<label>身份证反面<input name="id_back" placeholder="data:image/... 或留空"></label>'+
      '<label>联系方式<input name="phone" value="'+esc(v.phone||raw.contact_phone||'')+'" required></label>'+
      '<label>银行名称<input name="bank_name" value="'+esc(v.bankName||'')+'" required></label>'+
      '<label>收款账号 / 提现账户<input name="bank_account" required></label>'+
      '<label>TNG 账号<input name="tng_account"></label>'+
      '<label>备注<textarea name="remark"></textarea></label>'+
      '<button class="pw-btn primary" type="submit">提交认证审核</button></form>'+
      '<form class="pw-card pad pw-form pw-form-narrow" style="margin-top:14px" data-deposit-form><h3>押金</h3>'+
      '<label>已缴金额 RM<input name="paid_amount" type="number" min="1" required></label>'+
      '<label>付款方式<input name="payment_method" required></label>'+
      '<label>付款凭证（图片 dataURL 或链接）<input name="proof_url" required></label>'+
      '<label>备注<textarea name="remark"></textarea></label>'+
      '<button class="pw-btn primary" type="submit">提交押金凭证</button></form>'+
      '<section class="pw-card pad pw-form-narrow" style="margin-top:14px"><h3>账号安全 / 登录设备 / 修改密码</h3>'+
      '<div class="pw-info-list">'+
      infoRow('登录账号',p.email||p.uid||'-')+
      infoRow('最近资料更新',raw.updated_at||p.updatedAt||'-')+
      infoRow('本机设备',navigator.userAgent?String(navigator.userAgent).slice(0,48)+'…':'未知')+
      '</div>'+
      '<p class="pw-note" style="margin-top:10px">修改密码：请到登录页使用「忘记密码」。后台通知请查看「消息中心」。</p>'+
      '<div class="pw-actions" style="margin-top:12px"><button class="pw-btn" type="button" data-route="/companion/settings">打开设置</button><button class="pw-btn danger" type="button" data-logout>退出登录</button></div></section>';
  }
  function mineHtml(){return accountHtml()}
  function hallGateMessage(){
    if(isAuditLocked())return auditHint();
    return '请先切换为在线接单。';
  }
  function readFileAsDataUrl(file,kind){
    return new Promise(function(resolve,reject){
      if(!file)return reject(new Error('未选择文件'));
      var type=String(file.type||'').toLowerCase();
      var name=String(file.name||'');
      if(kind==='voice'){
        if(!/^audio\//.test(type) && !/\.(mp3|wav|m4a|webm|ogg|aac)$/i.test(name)){
          return reject(new Error('仅支持 mp3、wav、m4a、webm、ogg 音频'));
        }
        if(file.size>10*1024*1024)return reject(new Error('录音不能超过 10MB'));
      }else{
        if(!/image\/(jpeg|jpg|png|webp)/.test(type) && !/\.(jpe?g|png|webp)$/i.test(name)){
          return reject(new Error('仅支持 jpg、jpeg、png、webp 格式'));
        }
        if(file.size>5*1024*1024)return reject(new Error('单张图片不能超过 5MB'));
      }
      var reader=new FileReader();
      reader.onload=function(){resolve(String(reader.result||''))};
      reader.onerror=function(){reject(new Error(kind==='voice'?'读取录音失败，请重试':'读取图片失败，请重试'))};
      reader.readAsDataURL(file);
    });
  }
  function withTimeout(promise,ms,message){
    return new Promise(function(resolve,reject){
      var done=false;
      var t=setTimeout(function(){if(done)return;done=true;reject(new Error(message||'请求超时，请重试'))},ms||45000);
      Promise.resolve(promise).then(function(v){if(done)return;done=true;clearTimeout(t);resolve(v)},function(err){if(done)return;done=true;clearTimeout(t);reject(err)});
    });
  }
  function uploadImage(mediaType,file){
    if(state.uploadBusy){toast('请等待当前上传完成');return Promise.resolve()}
    state.uploadBusy=mediaType;
    paint();
    return withTimeout(readFileAsDataUrl(file,mediaType==='voice'?'voice':'image').then(function(dataUrl){
      var preview=document.querySelector('[data-avatar-preview]');
      if(mediaType==='avatar'&&preview)preview.src=dataUrl;
      return api('upload_media',{media_type:mediaType,data_url:dataUrl,filename:file.name||(mediaType==='voice'?'voice.webm':mediaType+'.jpg')});
    }),45000,'上传超时，请检查网络后重试').then(function(res){
      toast(res.message||'上传成功');
      state.uploadBusy='';
      return loadData({soft:true});
    }).catch(function(err){
      state.uploadBusy='';
      paint();
      toast(err.message||'上传失败，请重试');
    });
  }
  function validateProfileForm(form){
    var fd=new FormData(form);
    var errors={};
    var nickname=String(fd.get('nickname')||'').trim();
    var age=Number(fd.get('age'));
    var gender=String(fd.get('gender')||'').trim();
    var region=String(fd.get('region')||'').trim();
    var gameId=String(fd.get('game_id')||'').trim();
    var serviceTypes=Array.prototype.map.call(form.querySelectorAll('input[name="service_type_opt"]:checked'),function(el){return el.value}).filter(Boolean);
    var serviceInputs=Array.prototype.slice.call(form.querySelectorAll('input[name="service_id_opt"]:checked'));
    var serviceIds=serviceInputs.map(function(el){return el.value}).filter(Boolean);
    var serviceNames=serviceInputs.map(function(el){return el.getAttribute('data-game-name')||el.value}).filter(Boolean);
    var minP=20,maxP=30,maxPlus=false;
    var sample=form.querySelector('[data-game-price-grid] input')||form.querySelector('[name="price"]');
    if(sample){
      minP=Number(sample.dataset.minPrice)||minP;
      maxP=Number(sample.dataset.maxPrice)||maxP;
      maxPlus=sample.dataset.maxPlus==='1';
    }
    var gamePrices={};
    var priceError='';
    serviceInputs.forEach(function(el){
      var id=el.value;
      var name=el.getAttribute('data-game-name')||id;
      var raw=String(fd.get('game_price_'+id)||'').trim();
      if(!raw){priceError=priceError||('请填写 '+name+' 的价格');return;}
      if(!/^\d+(\.\d{1,2})?$/.test(raw)){priceError=priceError||(name+' 单价格式无效');return;}
      var price=Number(raw);
      if(price<minP||(!maxPlus&&price>maxP)){priceError=priceError||(name+' 须在 RM'+minP+'–RM'+maxP+(maxPlus?'+':'')+' 之间');return;}
      gamePrices[id]=price;
      if(name)gamePrices[name]=price;
    });
    if(!nickname)errors.nickname='请填写昵称';
    if(!Number.isFinite(age)||age<18||age>60)errors.age='年龄须为 18–60 的数字';
    if(!gender)errors.gender='请选择性别';
    if(!region)errors.region='请填写地区';
    if(!serviceTypes.length)errors.service_type='请至少选择一种可提供服务';
    if(!serviceIds.length)errors.main_game='请至少选择一个可接游戏';
    if(!gameId)errors.game_id='请填写游戏 ID';
    if(priceError)errors.price=priceError;
    state.profileErrors=errors;
    var primaryPrice=serviceIds.length&&gamePrices[serviceIds[0]]!=null?String(gamePrices[serviceIds[0]]):'';
    return {
      ok:!Object.keys(errors).length,
      payload:{
        nickname:nickname,
        age:String(age),
        gender:gender,
        region:region,
        service_type:serviceTypes.join(','),
        service_ids:serviceIds,
        main_game:serviceNames.join('、'),
        game_id:gameId,
        rank:String(fd.get('rank')||'').trim(),
        position:String(fd.get('position')||'').trim(),
        bio:String(fd.get('bio')||'').trim(),
        public_tags:String(fd.get('public_tags')||'').trim(),
        tags:String(fd.get('public_tags')||'').trim(),
        price:primaryPrice,
        game_prices:gamePrices
      }
    };
  }
  function reorderGallery(mediaId,delta){
    var media=((state.data&&state.data.media)||[]).filter(function(m){return m.mediaType==='gallery'}).slice().sort(function(a,b){return (a.sortOrder||0)-(b.sortOrder||0)});
    var idx=media.findIndex(function(m){return String(m.id)===String(mediaId)});
    if(idx<0)return;
    var next=idx+delta;
    if(next<0||next>=media.length)return;
    var tmp=media[idx];media[idx]=media[next];media[next]=tmp;
    api('reorder_media',{ordered_ids:media.map(function(m){return m.id})}).then(function(res){toast(res.message||'顺序已更新');return loadData()}).catch(function(err){toast(err.message)});
  }
  document.addEventListener('click',function(e){
    var tab=e.target.closest('[data-auth-tab]');
    if(tab){state.authTab=tab.dataset.authTab==='register'?'register':'login';state.loginError='';paint();return}
    if(e.target.closest('[data-enter-hall]')){
      if(isAuditLocked()){toast(auditHint());return}
      go('/companion/order-hall');
      return;
    }
    var r=e.target.closest('[data-route]');
    if(r){
      if(r.dataset.route==='/companion/order-hall' && isAuditLocked()){
        toast(auditHint());
        return;
      }
      if(r.dataset.orderFilter)state.orderFilter=r.dataset.orderFilter;
      if(r.dataset.earningsTab)state.earningsTab=r.dataset.earningsTab;
      go(r.dataset.route);
      if(/\/(wallet|earnings|withdraw|account|mine)/.test(r.dataset.route||''))loadData({soft:true});
      if(/\/messages/.test(r.dataset.route||'')){
        loadData({soft:true}).then(function(){return markActiveChatSessionRead()});
      }
      return;
    }
    var earnTab=e.target.closest('[data-earnings-tab]');
    if(earnTab){state.earningsTab=earnTab.dataset.earningsTab||'overview';paint();return}
    var chatSess=e.target.closest('[data-chat-session]');
    if(chatSess){
      state.chatSession=chatSess.dataset.chatSession==='system'?'system':'cs';
      markActiveChatSessionRead();
      return;
    }
    var hallType=e.target.closest('[data-hall-type]');
    if(hallType){state.hallOrderType=hallType.dataset.hallType||'all';paint();return}
    if(e.target.closest('[data-hall-refresh]')){loadData({soft:true});return}
    if(e.target.closest('[data-account-toggle]')){e.target.closest('.pw-account').classList.toggle('open');return}
    if(e.target.closest('[data-logout]')){clearSession();go('/companion/login');return}
    if(e.target.closest('[data-forgot-password]')){var account=prompt('请输入陪玩 ID / 邮箱 / 手机号');if(account)api('forgot_password',{account:account}).then(function(x){toast(x.message||'已提交')}).catch(function(err){toast(err.message)});return}
    var accept=e.target.closest('[data-accept-order]');
    if(accept){
      if(!confirm('确认抢单？抢单后需等待老板选择，不会立即成为正式接单，也不能直接开始订单。'))return;
      api('accept_order',{id:accept.dataset.acceptOrder}).then(function(x){
        toast(x.message||'已抢单，等待老板确认');
        state.route='orders';
        state.orderFilter='waiting_selection';
        go('/companion/orders');
        return loadData();
      }).catch(function(err){toast(err.message)});
      return;
    }
    var filterBtn=e.target.closest('[data-order-filter]');
    if(filterBtn){state.orderFilter=filterBtn.dataset.orderFilter||'all';paint();return}
    if(e.target.closest('[data-close-settlement]')){
      if(e.target.closest('[data-settlement-dialog]')&&!e.target.closest('.pw-dialog-head [data-close-settlement]'))return;
      state.settlement=null;paint();return;
    }
    var viewSettle=e.target.closest('[data-view-settlement]');
    if(viewSettle){
      var oid=viewSettle.dataset.viewSettlement;
      var local=((state.data&&state.data.myOrders)||[]).find(function(o){return String(o.id)===String(oid)});
      if(local&&local.settlement){state.settlement=local.settlement;paint();return}
      api('get_settlement',{id:oid},'GET').then(function(res){
        state.settlement=res.settlement;paint();
      }).catch(function(err){toast(err.message||'暂无结算详情')});
      return;
    }
    var action=e.target.closest('[data-order-action]');
    if(action){
      var act=action.dataset.orderAction;
      var oid=action.dataset.orderId;
      if(act==='accept_direct_order'){
        if(!confirm('确认接受此订单吗？'))return;
        api(act,{id:oid}).then(function(x){
          toast(x.message||'已确认接单');
          state.route='orders';
          state.orderFilter='waiting_start';
          go('/companion/orders');
          return loadData();
        }).catch(function(err){toast(err.message)});
        return;
      }
      if(act==='reject_direct_order'){
        var reason=prompt('请选择无法接单原因：\n'+REJECT_REASONS.map(function(r,i){return (i+1)+'. '+r}).join('\n')+'\n\n请输入序号 1-5，或直接输入原因','1');
        if(reason==null)return;
        var picked=REJECT_REASONS[Number(reason)-1]||String(reason).trim();
        if(!picked){toast('请选择无法接单原因');return}
        if(!confirm('确认无法接单？订单将交给客服重新安排，不会自动消失。'))return;
        api(act,{id:oid,reason:picked}).then(function(x){toast(x.message||'已提交无法接单');return loadData()}).catch(function(err){toast(err.message)});
        return;
      }
      if(act==='start_order'){
        if(!confirm('确认现在开始服务吗？'))return;
        api(act,{id:oid}).then(function(x){
          toast(x.message||'已开始服务');
          state.route='orders';
          state.orderFilter='running';
          go('/companion/orders');
          return loadData();
        }).catch(function(err){toast(err.message)});
        return;
      }
      if(act==='complete_order'||act==='confirm_complete'){
        if(!confirm('确认本次服务已经完成吗？'))return;
        api(act,{id:oid}).then(function(x){
          if(x.settlement){state.settlement=x.settlement;}
          toast(x.message||'已提交完成，订单进入已完成');
          state.route='orders';
          state.orderFilter='completed';
          go('/companion/orders');
          return loadData();
        }).catch(function(err){toast(err.message)});
        return;
      }
      api(act,{id:oid}).then(function(x){
        toast(x.message||'操作成功');
        return loadData();
      }).catch(function(err){toast(err.message)});
      return;
    }
    var online=e.target.closest('[data-online-status]');
    if(online){
      if(isAuditLocked()){toast(auditHint());return}
      if(online.disabled)return;
      var next=online.dataset.onlineStatus;
      if(!next)return;
      if(next===currentOnlineStatus()&&!state.statusBusy)return;
      applyOnlineStatusUi(next);
      if(state.statusBusy){
        state.pendingOnlineStatus=next;
        return;
      }
      commitOnlineStatus(next);
      return;
    }
    if(e.target.closest('[data-delete-avatar]')){
      api('delete_media',{media_type:'avatar'}).then(function(x){toast(x.message||'头像已删除');return loadData()}).catch(function(err){toast(err.message)});
      return;
    }
    var del=e.target.closest('[data-delete-media]');
    if(del){
      api('delete_media',{media_id:del.dataset.deleteMedia}).then(function(x){toast(x.message||'已删除');return loadData()}).catch(function(err){toast(err.message)});
      return;
    }
    var move=e.target.closest('[data-gallery-move]');
    if(move){
      var item=move.closest('[data-media-id]');
      if(item)reorderGallery(item.dataset.mediaId,Number(move.dataset.galleryMove||0));
      return;
    }
    if(e.target.closest('[data-open-withdraw]')){
      state.earningsTab='withdraw';
      go('/companion/earnings');
      loadData({soft:true});
      return;
    }
    var readAllBtn=e.target.closest('[data-msg-read-all]');
    if(readAllBtn){
      if(readAllBtn.disabled)return;
      buildInbox().forEach(function(m){markMsgRead(m.id)});
      if(state.inbox&&Array.isArray(state.inbox.systemNotices)){
        var keys=state.inbox.systemNotices.map(function(n){return n.key||n.id}).filter(Boolean);
        api('mark_all_read',{keys:keys}).then(function(){return reloadInbox()}).catch(function(){paint()});
      }else{
        paint();
      }
      return;
    }
    var noticeEl=e.target.closest('[data-notice-id]');
    if(noticeEl){
      var noticeId=noticeEl.dataset.noticeId;
      markMsgRead(noticeId);
      if(state.inbox){
        api('mark_notices_read',{keys:[noticeId]}).then(function(){return reloadInbox()}).catch(function(){paint()});
      }else{
        paint();
      }
      return;
    }
  });
  document.addEventListener('change',function(e){
    var setting=e.target.closest('[data-setting]');
    if(setting){
      var cur=state.settings||readSettings();
      cur[setting.dataset.setting]=!!setting.checked;
      saveSettings(cur);
      toast('设置已保存');
      return;
    }
    var hallGameSel=e.target.closest('[data-hall-game]');
    if(hallGameSel){state.hallGame=hallGameSel.value||'all';paint();return}
    var gameToggle=e.target.closest('[data-game-toggle]');
    if(gameToggle){
      var g=gameToggle.value;
      var row=document.querySelector('[data-game-price-row="'+g+'"]');
      var input=row&&row.querySelector('input');
      if(row)row.classList.toggle('is-on',gameToggle.checked);
      if(input){input.disabled=!gameToggle.checked;if(!gameToggle.checked)input.value='';}
      return;
    }
    var avatarInput=e.target.closest('[data-upload-avatar]');
    if(avatarInput&&avatarInput.files&&avatarInput.files[0]){uploadImage('avatar',avatarInput.files[0]);avatarInput.value='';return}
    var galleryInput=e.target.closest('[data-upload-gallery]');
    if(galleryInput&&galleryInput.files&&galleryInput.files[0]){uploadImage('gallery',galleryInput.files[0]);galleryInput.value='';return}
    var voiceInput=e.target.closest('[data-upload-voice]');
    if(voiceInput&&voiceInput.files&&voiceInput.files[0]){uploadImage('voice',voiceInput.files[0]);voiceInput.value='';return}
  });
  document.addEventListener('focusin',function(e){
    var field=e.target.closest('.pw-profile-form input,.pw-profile-form textarea,.pw-profile-form select');
    if(!field)return;
    setTimeout(function(){try{field.scrollIntoView({behavior:'smooth',block:'center'})}catch(err){}},300);
  });
  document.addEventListener('keydown',function(e){
    var input=e.target.closest('[data-chat-input]');
    if(!input)return;
    if(e.key==='Enter'&&!e.shiftKey){
      e.preventDefault();
      var form=input.closest('form');
      if(form){
        if(typeof form.requestSubmit==='function')form.requestSubmit();
        else form.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
      }
    }
  });
  document.addEventListener('submit',function(e){
    if(e.target.matches('[data-login]')){
      e.preventDefault();
      var form=e.target;var fd=new FormData(form);var btn=form.querySelector('[type="submit"]');var remember=true;
      state.loginError='';state.loginBusy=true;
      if(Auth&&Auth.setFormError)Auth.setFormError(form,'');else{var box=form.querySelector('[data-auth-error]');if(box)box.textContent='';}
      if(Auth&&Auth.setLoading)Auth.setLoading(btn,true);else if(btn){btn.disabled=true;btn.textContent='登录中…';}
      var account=String(fd.get('account')||'').trim();var password=String(fd.get('password')||'');
      var Gate=window.MCJRoleGate;
      var run=Gate&&typeof Gate.loginPortal==='function'?Gate.loginPortal('companion',account,password,remember):api('login',{account:account,password:password,remember:remember});
      run.then(function(res){
        var sess=res.session||{};
        if(sess.accessToken){saveSession({token:sess.accessToken,user:sess.user||{},remember:remember},remember);}
        else if(sess.token){saveSession(sess,remember);}
        state.loginBusy=false;state.loginError='';go('/companion/dashboard');return loadData();
      }).catch(function(err){
        state.loginBusy=false;
        state.loginError=(Gate&&Gate.humanizeAuthError?Gate.humanizeAuthError(err):null)||err.message||'账号或密码错误。';
        if(Auth&&Auth.setLoading)Auth.setLoading(btn,false,'登录');else if(btn){btn.disabled=false;btn.textContent='登录';}
        if(Auth&&Auth.setFormError)Auth.setFormError(form,state.loginError);else{var errBox=form.querySelector('[data-auth-error]');if(errBox)errBox.textContent=state.loginError;else toast(state.loginError);}
      });
      return;
    }
    if(e.target.matches('[data-register]')){
      e.preventDefault();
      var rf=e.target;var rd=new FormData(rf);
      var password=String(rd.get('password')||'');var confirm=String(rd.get('confirm_password')||'');
      if(!rd.get('agree')){toast('请先同意服务条款');return}
      if(password!==confirm){toast('两次输入的密码不一致');return}
      api('register',{email:String(rd.get('email')||'').trim(),nickname:String(rd.get('nickname')||'').trim(),phone:String(rd.get('phone')||'').trim(),password:password,remember:!!rd.get('remember')}).then(function(res){saveSession(res.session,!!rd.get('remember'));go('/companion/profile');return loadData()}).catch(function(err){toast(err.message)});
      return;
    }
    if(e.target.matches('[data-profile-form]')){
      e.preventDefault();
      var formEl=e.target;
      var checked=validateProfileForm(formEl);
      if(!checked.ok){
        formEl.querySelectorAll('[data-field-error]').forEach(function(n){n.remove()});
        Object.keys(state.profileErrors).forEach(function(key){
          var input=formEl.querySelector('[name="'+key+'"]')||formEl.querySelector('input[name="main_game_opt"]');
          var field=input&&input.closest('.pw-field');
          if(!field)return;
          var span=document.createElement('span');
          span.className='pw-field-error';
          span.setAttribute('data-field-error',key);
          span.textContent=state.profileErrors[key];
          field.appendChild(span);
        });
        toast('请完善必填资料');
        var firstErr=formEl.querySelector('.pw-field-error');
        if(firstErr){try{firstErr.scrollIntoView({behavior:'smooth',block:'center'})}catch(err){}}
        return;
      }
      api('update_profile',checked.payload).then(function(res){state.profileErrors={};toast(res.message||'资料已提交审核');return loadData({soft:true})}).catch(function(err){
        if(err.message){
          var map={昵称:'nickname',年龄:'age',性别:'gender',地区:'region',联系方式:'contact_phone',主接游戏:'main_game','游戏 ID':'game_id','游戏ID':'game_id',单价:'price',价格:'price'};
          Object.keys(map).forEach(function(k){if(err.message.indexOf(k)!==-1)state.profileErrors[map[k]]=err.message});
        }
        toast(err.message||'保存失败');
        paint();
      });
      return;
    }
    if(e.target.matches('[data-verification-form]')){e.preventDefault();var vf=new FormData(e.target),vp={};vf.forEach(function(v,k){vp[k]=String(v||'')});api('submit_verification',vp).then(function(res){toast(res.message||'认证已提交');return loadData({soft:true})}).catch(function(err){toast(err.message)});return}
    if(e.target.matches('[data-deposit-form]')){e.preventDefault();var df=new FormData(e.target),dp={};df.forEach(function(v,k){dp[k]=String(v||'')});api('submit_deposit_proof',dp).then(function(res){toast(res.message||'押金凭证已提交');return loadData({soft:true})}).catch(function(err){toast(err.message)});return}
    if(e.target.matches('[data-private-contact-form]')){
      e.preventDefault();
      var cf=new FormData(e.target);
      var phone=String(cf.get('contact_phone')||'').trim();
      if(!phone){toast('请填写联系方式');return}
      api('update_profile',{contact_phone:phone,privacy_only:true}).then(function(res){toast(res.message||'联系方式已保存');return loadData({soft:true})}).catch(function(err){toast(err.message)});
      return;
    }
    if(e.target.matches('[data-withdraw-form]')){
      e.preventDefault();
      if(state.withdrawBusy)return;
      var wf=new FormData(e.target);
      var amountRaw=String(wf.get('amount')||'').trim();
      var remark=String(wf.get('remark')||'').trim();
      var rules=(state.data&&state.data.withdrawalRules)||{};
      var perm=(state.data&&state.data.permissions)||{};
      var earnings=(state.data&&state.data.earnings)||{};
      var available=num(earnings.available!=null?earnings.available:earnings.withdrawable);
      var minAmount=num(rules.minAmount||0);
      var accountId=(rules.approvedAccounts&&rules.approvedAccounts[0]&&rules.approvedAccounts[0].id)||'';
      var accountLabel=rules.currentAccount||'';
      if(!perm.canWithdraw){toast(perm.withdrawLockReason||'暂不可提现');return}
      if(!amountRaw){toast('请输入提现金额');return}
      if(!/^\d+(\.\d+)?$/.test(amountRaw)){toast('提现金额必须是正数');return}
      var amount=Number(amountRaw);
      if(!(amount>0)){toast('提现金额必须大于 0');return}
      if(minAmount>0&&amount<minAmount){toast('提现金额不能低于最低提现额 '+minAmount+' 猫粮');return}
      if(amount>available){toast('提现金额不能超过可提现余额 '+available+' 猫粮');return}
      if(!accountId&&!accountLabel){toast('请先在账号中心绑定并审核通过提现账户');return}
      if(num(rules.remainingThisMonth)<=0){toast('本月提现次数已用完');return}
      state.withdrawBusy=true;
      paint();
      api('request_withdrawal',{amount:amount,remark:remark,paymentAccountId:accountId}).then(function(res){
        state.withdrawBusy=false;
        state.earningsTab='records';
        var item=res&&(res.item||res.withdrawal||(res.data&&res.data.item));
        if(item&&state.data){
          var mapped={
            id:item.id,
            withdrawalNo:item.withdrawal_no||item.withdrawalNo||'',
            amount:item.amount||item.cat_food_amount||amount,
            status:item.status||'pending_review',
            submittedAt:item.submitted_at||item.submittedAt||new Date().toISOString(),
            remark:item.remark||remark||'',
            accountLast4:item.account_last4||item.accountLast4||''
          };
          state.data.withdrawals=mergeWithdrawals([mapped],state.data.withdrawals||[]);
          state.data.withdrawalRecords=mergeWithdrawals([mapped],state.data.withdrawalRecords||[]);
        }
        toast((res&&res.message)||'提现申请已提交，等待后台审核');
        paint();
        return loadData({soft:true});
      }).catch(function(err){
        state.withdrawBusy=false;
        toast(err.message||'提现失败');
        paint();
      });
      return;
    }
    if(e.target.matches('[data-chat-composer]')){
      e.preventDefault();
      if(state.chatBusy)return;
      var ta=e.target.querySelector('[data-chat-input]');
      var content=String((ta&&ta.value)||'').trim();
      if(!content){toast('请输入消息内容');return}
      if(!state.inbox){toast('客服暂不可用，请稍后重试');return}
      state.chatBusy=true;
      paint();
      api('send_cs_message',{content:content}).then(function(){
        state.chatBusy=false;
        return reloadInbox();
      }).catch(function(err){
        state.chatBusy=false;
        toast(err.message||'发送失败');
        paint();
      });
      return;
    }
  });
  root.addEventListener('click',function(e){
    if(e.target.closest('[data-pw-emoji]')){
      e.preventDefault();
      var ta=root.querySelector('[data-chat-input]');
      if(!ta||ta.disabled)return;
      var emojis=['😊','😂','👍','❤️','🙏','🔥','✨','😺','👌','🎉'];
      var panel=root.querySelector('[data-pw-emoji-panel]');
      if(!panel){
        panel=document.createElement('div');
        panel.setAttribute('data-pw-emoji-panel','1');
        panel.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px';
        panel.innerHTML=emojis.map(function(em){return '<button type="button" data-pw-pick-emoji="'+em+'">'+em+'</button>'}).join('');
        var composer=root.querySelector('[data-chat-composer]');
        if(composer)composer.parentNode.insertBefore(panel,composer);
      }else panel.hidden=!panel.hidden;
      return;
    }
    var pick=e.target.closest('[data-pw-pick-emoji]');
    if(pick){
      e.preventDefault();
      var ta2=root.querySelector('[data-chat-input]');
      if(!ta2||ta2.disabled)return;
      ta2.value=String(ta2.value||'')+pick.getAttribute('data-pw-pick-emoji');
      ta2.focus();
      return;
    }
    if(e.target.closest('[data-pw-image]')){
      e.preventDefault();
      if(state.chatBusy)return;
      if(!state.inbox){toast('客服暂不可用，请稍后重试');return}
      var Media=window.MCJChatMedia;
      if(!Media){toast('图片组件未加载');return}
      var token=(state.session&&state.session.token)||'';
      var statusEl=root.querySelector('[data-pw-upload-status]');
      Media.pickAndSendImages({
        token:token,
        multiple:true,
        onStatus:function(t){if(statusEl)statusEl.textContent=t||'';},
        onError:function(err){toast((err&&err.message)||'发送失败');},
        onUploaded:function(url){
          state.chatBusy=true;
          if(statusEl)statusEl.textContent='上传中…';
          // optimistic
          if(state.inbox){
            state.inbox.messages=(state.inbox.messages||[]).concat([{
              id:'local-img-'+Date.now(),_localId:'local-img',_pending:true,
              side:'right',senderRole:'companion',senderLabel:'我',
              messageType:'image',message_type:'image',content:url,createdAt:new Date().toISOString()
            }]);
            paint();
          }
          return api('send_cs_message',{content:url,message_type:'image'}).then(function(){
            state.chatBusy=false;
            return reloadInbox();
          }).catch(function(err){
            state.chatBusy=false;
            toast(err.message||'图片发送失败');
            paint();
          });
        }
      }).then(function(){if(statusEl)setTimeout(function(){statusEl.textContent='';},1200);});
      return;
    }
  });
  if(window.MCJChatMedia)window.MCJChatMedia.bindLightboxClicks(root);
  init();
})();

