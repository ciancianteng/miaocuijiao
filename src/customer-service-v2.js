(function(){
  var root=document.getElementById('serviceApp');
  if(!root)return;
  // Login page has its own script; never run SPA paint/remount here.
  if(/\/customer-service\/login/i.test(location.pathname)||window.__MCJCsLoginOnly){
    return;
  }
  var SESSION_KEY='mcjServiceSession';
  var ROUTES={'/customer-service/':'dashboard','/customer-service':'dashboard','/customer-service/login':'login','/customer-service/dashboard':'dashboard','/customer-service/conversations':'conversations','/customer-service/orders':'orders','/customer-service/create-order':'createOrder','/customer-service/compensation':'compensation','/customer-service/reports':'reports','/customer-service/profile':'profile'};
  var NAV=[['dashboard','工作台','/customer-service/dashboard'],['conversations','统一会话池','/customer-service/conversations'],['orders','订单处理','/customer-service/orders'],['reports','工资中心','/customer-service/reports'],['createOrder','客服代下单','/customer-service/create-order'],['profile','我的资料','/customer-service/profile'],['logout','退出登录','logout']];
  var HIDDEN_MVP_ROUTES={compensation:1};
  var Auth=window.MCJAuthShell;
  var softRefreshSeq=0;
  var toastTimer=null;
  var COMPOSER_SEL='[data-cs-composer], form[data-send-message] textarea[name="content"], form[data-send-message] input[name="content"]';
  var state={route:'dashboard',session:null,data:null,services:[],servicesError:'',servicesSource:'',createOrderErrors:{bosses:'',companions:'',services:''},loading:false,error:'',notice:'',activeConversation:'',orderFilter:'',convFilter:'active',suppressAutoSelect:false,loginError:'',loginBusy:false,loginDraft:{account:'',password:'',remember:false},composerDraft:'',composerDrafts:{},composerFocused:false,sendingChat:false,showConversationList:false,acceptLock:null,readCursors:{},acceptingId:''};
  function myServiceId(){
    return String(
      (state.session&&state.session.user&&(state.session.user.id||state.session.user.user_id||state.session.user.uid))||
      (state.data&&state.data.staff&&(state.data.staff.id||state.data.staff.user_id))||
      ''
    ).trim();
  }
  function healSessionStaff(data){
    var staff=(data&&data.staff)||{};
    var sid=String(staff.id||staff.user_id||'').trim();
    if(!sid||!state.session)return;
    if(!state.session.user)state.session.user={};
    if(!state.session.user.id){
      state.session.user=Object.assign({},state.session.user,{id:sid,name:staff.name||state.session.user.name||''});
      try{
        var raw=JSON.parse(localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||'null')||state.session;
        raw.user=Object.assign({},raw.user||{},state.session.user);
        localStorage.setItem(SESSION_KEY,JSON.stringify(raw));
        sessionStorage.setItem(SESSION_KEY,JSON.stringify(raw));
      }catch(e){}
    }
  }
  function isClosedConv(c){
    if(!c)return false;
    var raw=String(c.rawStatus||'').toLowerCase();
    return raw==='closed'||raw==='ended'||c.status==='已结束';
  }
  function convBucket(c){
    if(isClosedConv(c))return 'ended';
    if(c&&c.currentServiceId)return 'active';
    return 'waiting';
  }
  function filterCounts(){
    var counts={waiting:0,active:0,ended:0};
    ((state.data&&state.data.conversations)||[]).forEach(function(c){counts[convBucket(c)]++;});
    return counts;
  }
  function filteredConversations(){
    var f=state.convFilter||'active';
    return ((state.data&&state.data.conversations)||[]).filter(function(c){return convBucket(c)===f});
  }
  function activeConversation(){
    var list=(state.data&&state.data.conversations)||[];
    if(!state.activeConversation)return null;
    return list.find(function(c){return c.id===state.activeConversation})||null;
  }
  function composerCanReply(conv){
    if(!conv)return false;
    if(isClosedConv(conv))return false;
    if(state.acceptLock&&state.acceptLock.id===conv.id&&state.acceptLock.until>Date.now())return true;
    var mid=myServiceId();
    if(!mid)return false;
    return !!(conv.currentServiceId&&conv.currentServiceId===mid);
  }
  function myServiceName(){
    return String(
      (state.session&&state.session.user&&(state.session.user.name||state.session.user.display_name))||
      (state.data&&state.data.staff&&(state.data.staff.name||state.data.staff.display_name))||
      '客服'
    ).trim()||'客服';
  }
  function applyAcceptedLocally(cid, remoteConv){
    if(!cid||!state.data)return;
    var myId=myServiceId()||String((remoteConv&&(remoteConv.customer_service_id||remoteConv.currentServiceId))||'').trim();
    var nick=myServiceName();
    state.acceptLock={id:cid,until:Date.now()+60000};
    state.convFilter='active';
    state.activeConversation=cid;
    state.suppressAutoSelect=false;
    if(!state.readCursors)state.readCursors={};
    state.readCursors[cid]=new Date().toISOString();
    var list=state.data.conversations||[];
    var idx=list.findIndex(function(c){return c.id===cid});
    if(idx>=0){
      list[idx]=Object.assign({},list[idx],{
        currentServiceId:myId||list[idx].currentServiceId,
        currentServiceName:nick,
        status:'正在接待',
        rawStatus:String((remoteConv&&remoteConv.status)||list[idx].rawStatus||'active'),
        unread:0,
        unreadCount:0,
        lastReadAt:state.readCursors[cid],
        lastMessage:'客服 '+nick+' 已接待您。'
      });
    }
    clearUnreadLocally(cid);
    var msgs=state.data.messages||[];
    var already=msgs.some(function(m){
      return m.conversationId===cid&&m.messageType==='system'&&String(m.content||'').indexOf('已接待您')>=0;
    });
    if(!already){
      msgs.push({
        id:'local-accept-'+Date.now(),
        conversationId:cid,
        senderId:myId||'',
        senderRole:'customer_service',
        senderName:nick,
        messageType:'system',
        content:'客服 '+nick+' 已接待您。',
        createdAt:new Date().toISOString()
      });
      state.data.messages=msgs;
    }
    if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
    else if(state.route==='conversations')paint();
    syncComposerEnabled();
  }
  function acceptConversation(cid){
    var id=String(cid||'').trim();
    if(!id)return Promise.reject(new Error('缺少会话 ID'));
    if(state.acceptingId===id)return Promise.resolve();
    state.acceptingId=id;
    var opts={
      method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({id:id,conversation_id:id,action:'accept'})
    };
    if(token())opts.headers['x-mcj-service-token']=token();
    return fetch('/api/customer-service/accept',opts).then(parse).then(function(res){
      applyAcceptedLocally(id,res.conversation||{});
      toast(res.message||'已接待');
      syncComposerEnabled();
      var input=root.querySelector(COMPOSER_SEL);
      if(input){
        input.disabled=false;
        input.readOnly=false;
        input.removeAttribute('readonly');
        input.placeholder='输入消息，Enter 发送，Shift+Enter 换行';
        state.composerFocused=true;
        try{input.focus({preventScroll:true});}catch(err){try{input.focus();}catch(e2){}}
      }
      var hint=root.querySelector('[data-cs-composer-hint]');
      if(hint){hint.hidden=true;hint.textContent='';}
      return softRefresh().then(function(){
        applyAcceptedLocally(id,res.conversation||{});
        syncComposerEnabled();
      }).catch(function(){});
    }).finally(function(){
      if(state.acceptingId===id)state.acceptingId='';
    });
  }
  function composerBlockReason(conv){
    if(!conv)return '请先选择会话';
    if(isClosedConv(conv))return '会话已结束，无法继续发送';
    var mid=myServiceId();
    if(conv.currentServiceId&&mid&&conv.currentServiceId!==mid)return '该会话已由客服 '+(conv.currentServiceName||'其他客服')+' 接待。';
    if(state.acceptLock&&state.acceptLock.id===conv.id&&state.acceptLock.until>Date.now())return '';
    if(!conv.currentServiceId)return '请先点击接待后再回复';
    return '';
  }
  function clearUnreadLocally(cid){
    if(!cid||!state.data)return;
    var list=state.data.conversations||[];
    var idx=list.findIndex(function(c){return c.id===cid});
    var readAt=new Date().toISOString();
    if(!state.readCursors)state.readCursors={};
    state.readCursors[cid]=readAt;
    if(idx>=0){
      list[idx]=Object.assign({},list[idx],{unread:0,unreadCount:0,lastReadAt:readAt});
    }
    (state.data.messages||[]).forEach(function(m){
      if(m.conversationId===cid&&m.senderRole==='boss'&&!m.readAt)m.readAt=readAt;
    });
    var badge=root.querySelector('[data-conversation="'+cid+'"] .cs-conv-unread');
    if(badge)badge.remove();
  }
  function applyReadCursors(remote){
    if(!remote||!state.readCursors)return remote;
    var cursors=state.readCursors;
    (remote.conversations||[]).forEach(function(c){
      var at=cursors[c.id];
      if(!at)return;
      (remote.messages||[]).forEach(function(m){
        if(m.conversationId===c.id&&m.senderRole==='boss'&&String(m.createdAt||'')<=String(at)){
          m.readAt=m.readAt||at;
        }
      });
      var newer=(remote.messages||[]).filter(function(m){
        return m.conversationId===c.id&&m.senderRole==='boss'&&!m.readAt&&String(m.createdAt||'')>String(at);
      }).length;
      c.unread=newer;
      c.unreadCount=newer;
      c.lastReadAt=c.lastReadAt||at;
    });
    return remote;
  }
  function markConversationRead(cid){
    var id=String(cid||'').trim();
    if(!id)return Promise.resolve();
    clearUnreadLocally(id);
    if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
    return api('mark_read',{id:id,conversation_id:id}).then(function(res){
      clearUnreadLocally(id);
      var unread=Number((res&&(res.unreadCount!=null?res.unreadCount:res.unread))||0)||0;
      if(unread===0)clearUnreadLocally(id);
      else if(state.data&&state.data.conversations){
        var idx=state.data.conversations.findIndex(function(c){return c.id===id});
        if(idx>=0){
          state.data.conversations[idx]=Object.assign({},state.data.conversations[idx],{unread:unread,unreadCount:unread});
        }
      }
      if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
      return softRefresh().then(function(){
        // Soft refresh must not resurrect cleared unread for this cursor.
        clearUnreadLocally(id);
        if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
      }).catch(function(){});
    }).catch(function(err){
      toast((err&&err.message)||'标记已读失败，请刷新重试');
    });
  }
  function applyEndedLocally(cid){
    if(!cid||!state.data)return;
    var list=state.data.conversations||[];
    var idx=list.findIndex(function(c){return c.id===cid});
    if(idx>=0){
      list[idx]=Object.assign({},list[idx],{
        status:'已结束',
        rawStatus:'closed',
        unread:0,
        unreadCount:0,
        lastMessage:'客服已结束本次接待。',
        closedAt:new Date().toISOString(),
        closedBy:myServiceId()
      });
    }
    var msgs=state.data.messages||[];
    msgs.push({
      id:'local-end-'+Date.now(),
      conversationId:cid,
      senderId:myServiceId()||'',
      senderRole:'customer_service',
      senderName:myServiceName(),
      messageType:'system',
      content:'客服已结束本次接待。',
      createdAt:new Date().toISOString()
    });
    state.data.messages=msgs;
  }
  function saveComposerDraftFor(id){
    if(!id)return;
    captureComposer();
    if(!state.composerDrafts)state.composerDrafts={};
    state.composerDrafts[id]=String(state.composerDraft||'');
  }
  function loadComposerDraftFor(id){
    if(!id){state.composerDraft='';return;}
    if(!state.composerDrafts)state.composerDrafts={};
    state.composerDraft=typeof state.composerDrafts[id]==='string'?state.composerDrafts[id]:'';
  }
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    var n = Number(v || 0);
    return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function moneyRate(v, unit) {
    if (window.MCJCurrency) return window.MCJCurrency.formatRate(v, unit || "每单");
    return money(v).replace(/\s*猫粮$/, "") + " 猫粮 / " + (unit || "每单");
  }
  function routeFromPath(pathname){
    var p=String(pathname||location.pathname||'').replace(/\\/g,'/').replace(/\/$/,'')||'/customer-service';
    if(/\/customer-service\/login/i.test(p))return 'login';
    if(p==='/customer-service')p='/customer-service/';
    return ROUTES[p]||'dashboard';
  }
  function route(){
    // Prefer SPA in-memory route so soft refresh / typing never snaps back to 工作台.
    if(state.route&&state.route!=='login')return state.route;
    return routeFromPath(location.pathname);
  }
  function go(path){
    if(isLoginView())captureLoginDraft();
    var raw=String(path||'');
    var clean=raw.replace(/\\/g,'/').replace(/\/$/,'')||'/customer-service';
    // Full navigation only for login page.
    if(/\/customer-service\/login$/i.test(clean)){
      location.assign('/customer-service/login/');
      return;
    }
    // SPA route switch — keep URL + in-memory route in sync, never hard-jump away from chats while typing.
    var next=ROUTES[clean]||'dashboard';
    var url=raw;
    if(next==='dashboard')url='/customer-service/dashboard/';
    else if(next==='conversations')url='/customer-service/conversations';
    else if(next==='orders')url='/customer-service/orders';
    else if(next==='profile')url='/customer-service/profile';
    history.pushState(null,'',url);
    state.route=next;
    // Defer remount so the same click cannot "ghost click" 工作台 after buttons regenerate.
    setTimeout(function(){ paint(); }, 0);
  }
  function readSession(){
    if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.hasSession==='function'&&window.MCJServiceAuth.hasSession()){
      try{
        var raw=JSON.parse(localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||'null');
        if(raw&&(raw.token||raw.accessToken||raw.refreshToken)){
          return {
            token:raw.token||raw.accessToken||'',
            refreshToken:raw.refreshToken||'',
            expiresAt:raw.expiresAt||'',
            user:raw.user||{},
            remember:raw.remember!==false
          };
        }
      }catch(e){}
    }
    try{return JSON.parse(localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY)||'null')}catch(e){return null}
  }
  function saveSession(session,remember){
    if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.saveSession==='function'){
      state.session=window.MCJServiceAuth.saveSession(session,remember!==false);
      return;
    }
    // Always keep a localStorage copy so refresh keeps login.
    localStorage.setItem(SESSION_KEY,JSON.stringify(session));
    sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
    state.session=session;
  }
  function clearSession(){
    if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.clearSession==='function'){
      window.MCJServiceAuth.clearSession('logout');
    }else{
      localStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(SESSION_KEY);
    }
    state.session=null;state.data=null;state.activeConversation='';
  }
  function token(){
    if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.getAccessToken==='function'){
      return window.MCJServiceAuth.getAccessToken()||'';
    }
    var s=state.session||readSession()||{};
    return s.token||s.accessToken||'';
  }
  function isLoginView(){
    return state.route==='login'||!state.session;
  }
  function captureComposer(){
    var input=root.querySelector(COMPOSER_SEL);
    if(!input)return;
    state.composerDraft=String(input.value||'');
    if(state.activeConversation){
      if(!state.composerDrafts)state.composerDrafts={};
      state.composerDrafts[state.activeConversation]=state.composerDraft;
    }
    state.composerFocused=document.activeElement===input||!!state.composerFocused;
  }
  function restoreComposer(){
    var input=root.querySelector(COMPOSER_SEL);
    if(!input)return;
    if(typeof state.composerDraft==='string')input.value=state.composerDraft;
    syncComposerEnabled();
    if((state.composerFocused||composerCanReply(activeConversation()))&&!input.disabled){
      try{
        input.focus({preventScroll:true});
        var len=input.value.length;
        input.setSelectionRange(len,len);
      }catch(e){
        try{input.focus();}catch(err){}
      }
    }
  }
  function syncComposerEnabled(){
    var input=root.querySelector(COMPOSER_SEL);
    var sendBtn=root.querySelector('[data-cs-send]');
    var hint=root.querySelector('[data-cs-composer-hint]');
    var conv=activeConversation();
    var can=composerCanReply(conv);
    var reason=composerBlockReason(conv);
    var draft=String((input&&input.value)!=null?(input.value):(state.composerDraft||''));
    var empty=!draft.trim();
    if(input){
      input.disabled=!can;
      input.readOnly=!can;
      if(can)input.removeAttribute('readonly');
      else input.setAttribute('readonly','readonly');
      input.placeholder=can?'输入消息，Enter 发送，Shift+Enter 换行':(reason||'无法回复');
    }
    if(sendBtn){
      sendBtn.disabled=!can||!!state.sendingChat||empty;
      sendBtn.setAttribute('type','button');
    }
    if(hint){
      hint.hidden=can;
      hint.textContent=can?'':reason;
    }
  }
  function captureLoginDraft(){
    var form=root.querySelector('form[data-login]');
    if(!form)return;
    state.loginDraft={
      account:form.elements.account?String(form.elements.account.value||''):'',
      password:form.elements.password?String(form.elements.password.value||''):'',
      remember:!!(form.elements.remember&&form.elements.remember.checked)
    };
  }
  function restoreLoginDraft(){
    var form=root.querySelector('form[data-login]');
    var draft=state.loginDraft||{};
    if(!form)return;
    // Only restore when we actually have a draft. Never wipe live typed values with blanks.
    if(!draft.account&&!draft.password&&!draft.remember)return;
    if(form.elements.account&&draft.account)form.elements.account.value=draft.account;
    if(form.elements.password&&draft.password)form.elements.password.value=draft.password;
    if(form.elements.remember)form.elements.remember.checked=!!draft.remember;
  }
  function updateLoginChrome(){
    var err=root.querySelector('[data-auth-error]');
    if(err)err.textContent=state.loginError||'';
    var btn=root.querySelector('form[data-login] [type="submit"]');
    if(btn){
      btn.disabled=!!state.loginBusy;
      btn.textContent=state.loginBusy?'登录中…':'登录';
    }
  }
  function toast(msg){
    state.notice=msg||'';
    if(isLoginView()){
      var err=document.querySelector('[data-auth-error]');
      if(err){
        err.textContent=msg||'';
        setTimeout(function(){if(err.textContent===msg){err.textContent='';state.notice='';}},2200);
        return;
      }
      // Login form must never be remounted just to show a toast.
      return;
    }
    // Never remount the shell for toasts — that destroyed the chat composer mid-typing.
    showToastOverlay(msg||'');
  }
  function showToastOverlay(msg){
    var el=document.getElementById('csToastOverlay');
    if(!el){
      el=document.createElement('div');
      el.id='csToastOverlay';
      el.className='cs-toast show';
      el.setAttribute('role','status');
      document.body.appendChild(el);
    }
    el.className='cs-toast show';
    el.textContent=msg||'';
    if(toastTimer)clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){
      state.notice='';
      if(el&&el.parentNode)el.parentNode.removeChild(el);
      toastTimer=null;
    },2200);
  }
  function api(action,body,method){
    function doFetch(){
      var opts={method:method||'POST',headers:{'Content-Type':'application/json',Accept:'application/json'}};
      if(token())opts.headers['x-mcj-service-token']=token();
      if(opts.method==='GET')return fetch('/api/customer-service?action='+encodeURIComponent(action||'bootstrap'),opts).then(parse);
      opts.body=JSON.stringify(Object.assign({action:action},body||{}));
      return fetch('/api/customer-service',opts).then(parse);
    }
    var ready=window.MCJServiceAuth&&window.MCJServiceAuth.ensureSession
      ?window.MCJServiceAuth.ensureSession().catch(function(){return null;})
      :Promise.resolve();
    return ready.then(doFetch).catch(function(err){
      var msg=String((err&&err.message)||'');
      var expired=/登录已过期|请先登录|jwt|token is expired|invalid jwt/i.test(msg)||err&&err.status===401;
      if(expired&&window.MCJServiceAuth&&window.MCJServiceAuth.refreshSession){
        return window.MCJServiceAuth.refreshSession().then(function(){
          state.session=readSession();
          return doFetch();
        }).catch(function(){
          clearSession();
          location.replace('/customer-service/login/');
          throw err;
        });
      }
      throw err;
    });
  }
  function parse(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(e){throw new Error('接口返回格式错误')}if(!res.ok||body.ok===false){var err=new Error(body.message||('请求失败：HTTP '+res.status));err.status=res.status;throw err;}return body})}
  function emptyDashboardData(){
    var staff=(state.session&&state.session.user)||{};
    return {staff:staff,summary:{},conversations:[],messages:[],orders:[],bosses:[],companions:[],payrolls:[],orderStatuses:{}};
  }
  function loadServices(){
    return fetch('/api/platform/services?scope=cs',{headers:{Accept:'application/json'}}).then(function(res){
      return res.text().then(function(text){
        var body={};
        try{body=text?JSON.parse(text):{}}catch(e){body={services:[],ok:false,message:'服务列表返回格式错误'}}
        state.services=Array.isArray(body.services)?body.services:[];
        state.servicesSource=body.source||'';
        if(!res.ok||body.ok===false){
          state.servicesError=body.message||('服务列表请求失败：HTTP '+res.status);
        }else if(body.source==='missing_table'){
          state.servicesError=body.message||'services 表未初始化。请在 Supabase SQL Editor 执行 supabase/services.sql。';
        }else if(!state.services.length){
          state.servicesError=body.message||'暂无服务配置';
        }else{
          state.servicesError='';
        }
        if(!state.createOrderErrors)state.createOrderErrors={bosses:'',companions:'',services:''};
        state.createOrderErrors.services=state.servicesError||'';
      });
    }).catch(function(err){
      state.services=[];
      state.servicesSource='';
      state.servicesError=(err&&err.message)||'服务列表请求失败';
      if(!state.createOrderErrors)state.createOrderErrors={bosses:'',companions:'',services:''};
      state.createOrderErrors.services=state.servicesError;
    });
  }
  function load(){
    if(!state.session||!state.session.token){state.loading=false;paint();return Promise.resolve()}
    state.loading=true;state.error='';
    state.createOrderErrors={bosses:'',companions:'',services:state.servicesError||''};
    if(!state.data)state.data=emptyDashboardData();
    paint();
    var bootFailed=false;
    var bootMsg='';
    var boot=api('bootstrap',{},'GET').then(function(res){return res}).catch(function(err){
      bootFailed=true;
      bootMsg=err&&err.message?err.message:'客服端数据读取失败';
      state.error=bootMsg;
      return {data:state.data||emptyDashboardData(),ok:false};
    });
    return Promise.all([boot,loadServices()]).then(function(results){
      var res=results[0]||{};
      var next=res.data||emptyDashboardData();
      if(!next.staff||!next.staff.name){
        next.staff=Object.assign({},(state.session&&state.session.user)||{},next.staff||{});
      }
      if(!next.summary)next.summary={};
      state.data=next;
      healSessionStaff(next);
      applyReadCursors(state.data);
      if(state.suppressAutoSelect){
        state.activeConversation='';
      }else if(state.activeConversation){
        var still=(state.data.conversations||[]).some(function(c){return c.id===state.activeConversation});
        if(!still)state.activeConversation='';
      }
      if(!state.createOrderErrors)state.createOrderErrors={bosses:'',companions:'',services:''};
      if(bootFailed){
        state.createOrderErrors.bosses='老板列表加载失败：'+bootMsg;
        state.createOrderErrors.companions='陪玩列表加载失败：'+bootMsg;
      }else{
        state.createOrderErrors.bosses='';
        state.createOrderErrors.companions='';
      }
      state.createOrderErrors.services=state.servicesError||'';
    }).catch(function(err){
      state.error=err&&err.message?err.message:'客服端数据读取失败';
      if(!state.data)state.data=emptyDashboardData();
      if(!state.createOrderErrors)state.createOrderErrors={bosses:'',companions:'',services:''};
      state.createOrderErrors.bosses='老板列表加载失败：'+state.error;
      state.createOrderErrors.companions='陪玩列表加载失败：'+state.error;
      state.createOrderErrors.services=state.servicesError||state.error;
    }).finally(function(){state.loading=false;try{paint()}catch(e){paintSafeFallback()}})
  }
  function softRefresh(){
    if(!state.session||!state.session.token)return Promise.resolve();
    var keepRoute=state.route;
    var keepConv=state.activeConversation;
    if(keepRoute==='conversations')captureComposer();
    var seq=++softRefreshSeq;
    return api('bootstrap',{},'GET').then(function(res){
      if(seq!==softRefreshSeq)return;
      var nowRoute=state.route||keepRoute;
      var remote=res.data||state.data||emptyDashboardData();
      healSessionStaff(remote);
      // Protect just-accepted conversation from a stale poll overwriting the claim.
      if(state.acceptLock&&state.acceptLock.until>Date.now()&&state.data&&state.data.conversations){
        var lockId=state.acceptLock.id;
        var localConv=(state.data.conversations||[]).find(function(c){return c.id===lockId});
        var remoteList=remote.conversations||[];
        var rIdx=remoteList.findIndex(function(c){return c.id===lockId});
        if(localConv&&localConv.currentServiceId&&rIdx>=0){
          if(!remoteList[rIdx].currentServiceId){
            remoteList[rIdx]=Object.assign({},remoteList[rIdx],{
              currentServiceId:localConv.currentServiceId,
              currentServiceName:localConv.currentServiceName,
              status:localConv.status||'正在接待',
              rawStatus:localConv.rawStatus||'active',
              unread:0,
              unreadCount:0
            });
          }else{
            // Keep zeroed unread while lock is warm if remote briefly lags on mark_read.
            remoteList[rIdx]=Object.assign({},remoteList[rIdx],{
              unread:Math.min(Number(remoteList[rIdx].unread||0)||0,Number(localConv.unread||0)||0),
              unreadCount:Math.min(Number(remoteList[rIdx].unreadCount||0)||0,Number(localConv.unreadCount||0)||0)
            });
          }
        }
        if(localConv&&localConv.currentServiceId&&rIdx<0){
          remoteList.unshift(localConv);
          remote.conversations=remoteList;
        }
      }
      applyReadCursors(remote);
      state.data=remote;
      // Keep focus sticky: never jump to conversations[0] on poll/refresh.
      if(state.suppressAutoSelect){
        state.activeConversation='';
      }else if(keepConv){
        var stillThere=(state.data.conversations||[]).some(function(c){return c.id===keepConv});
        state.activeConversation=stillThere?keepConv:'';
      }else{
        state.activeConversation='';
      }
      if(nowRoute)state.route=nowRoute;
      else if(keepRoute)state.route=keepRoute;
      // Conversations: always patch in place — never remount composer on poll / realtime / send refresh.
      if(state.route==='conversations'){
        if(patchConversationMessages())return;
      }
      paint();
    }).catch(function(){});
  }
  function patchConversationMessages(){
    var layout=root.querySelector('.cs-chat-layout');
    var box=root.querySelector('.cs-chat-messages');
    var listEl=root.querySelector('.cs-chat-list');
    if(!layout||!box)return false;
    // Do NOT captureComposer here — softRefresh already captured before fetch.
    // Capturing mid-switch would write the previous conversation's textarea into the new draft.
    var data=state.data||{};
    var list=filteredConversations();
    var all=data.conversations||[];
    var active=all.find(function(c){return c.id===state.activeConversation})||null;
    if(!active){
      // No selected conversation (e.g. after end reception) — force full remount.
      return false;
    }
    var msgs=(data.messages||[]).filter(function(m){return active&&m.conversationId===active.id});
    var wasNearBottom=true;
    try{wasNearBottom=(box.scrollHeight-box.scrollTop-box.clientHeight)<80;}catch(e){}
    box.innerHTML=msgs.length?msgs.map(messageHtml).join(''):'<div class="cs-empty">暂无消息</div>';
    if(wasNearBottom){try{box.scrollTop=box.scrollHeight;}catch(e){}}
    if(listEl){
      var counts=filterCounts();
      var headHtml='<div class="cs-chat-list-head"><strong>会话列表</strong><div class="cs-actions"><button class="cs-btn" type="button" data-refresh>刷新</button><button class="cs-btn cs-list-close" type="button" data-close-conv-list>关闭</button></div></div>'+
        '<div class="cs-conv-tabs" role="tablist">'+
        '<button type="button" class="cs-conv-tab'+(state.convFilter==='waiting'?' active':'')+'" data-conv-filter="waiting">待接待 <em>'+counts.waiting+'</em></button>'+
        '<button type="button" class="cs-conv-tab'+(state.convFilter==='active'?' active':'')+'" data-conv-filter="active">接待中 <em>'+counts.active+'</em></button>'+
        '<button type="button" class="cs-conv-tab'+(state.convFilter==='ended'?' active':'')+'" data-conv-filter="ended">已结束 <em>'+counts.ended+'</em></button>'+
        '</div>';
      listEl.innerHTML=headHtml+(list.length?list.map(function(c){return conversationCardHtml(c,active,data)}).join(''):'<div class="cs-empty">该分类暂无会话</div>');
      listEl.classList.toggle('is-open',!!state.showConversationList);
    }
    var layoutEl=root.querySelector('.cs-chat-layout');
    if(layoutEl)layoutEl.classList.toggle('list-open',!!state.showConversationList);
    // Update reception controls + composer enablement without touching the textarea DOM node value/focus.
    var headEl=root.querySelector('.cs-chat-head');
    if(headEl&&active){
      var myId=myServiceId();
      var takenByOther=!!(active.currentServiceId&&active.currentServiceId!==myId);
      var takenByMe=!!(active.currentServiceId&&active.currentServiceId===myId);
      var titleBox=headEl.querySelector('.cs-chat-head-main > div')||headEl.querySelector('div');
      if(titleBox&&!titleBox.classList.contains('cs-chat-head-main')){
        var bossLabel=active.bossUid||active.bossId||'';
        titleBox.innerHTML='<h2>'+esc(active.bossName||'老板')+'</h2><p>'+(bossLabel?'编号 '+esc(bossLabel)+' · ':'')+(active.orderNo?'订单 '+esc(active.orderNo)+' · ':'')+esc(active.currentServiceId?(active.currentServiceName||'接待中'):'待接待')+'</p>';
      }
      var actionBtn=headEl.querySelector('[data-take],[data-end],button.cs-btn');
      var isClosed=isClosedConv(active);
      var takeHtml=isClosed
        ?'<button class="cs-btn" type="button" disabled>会话已结束</button>'
        :takenByOther
        ?'<button class="cs-btn" type="button" disabled>该会话已由客服 '+esc(active.currentServiceName||'其他客服')+' 接待。</button>'
        :(takenByMe
          ?'<button class="cs-btn danger" type="button" data-end="'+esc(active.id)+'">结束接待</button>'
          :'<button class="cs-btn primary" type="button" data-take="'+esc(active.id)+'"'+(state.acceptingId===active.id?' disabled data-taking="1"':'')+'>'+(state.acceptingId===active.id?'接待中…':'接待')+'</button>');
      if(actionBtn)actionBtn.outerHTML=takeHtml;
      else headEl.insertAdjacentHTML('beforeend',takeHtml);
      // Closed conversations must not keep composer.
      var composerWrap=root.querySelector('[data-cs-composer-wrap]');
      if(composerWrap&&isClosed)composerWrap.remove();
    } else if(headEl&&!active){
      // Return to list empty state handled by paint; patch only when layout exists with active.
    }
    syncComposerEnabled();
    // While typing, never overwrite textarea. Otherwise sync from draft map.
    var input=root.querySelector(COMPOSER_SEL);
    if(input){
      if(document.activeElement===input){
        state.composerDraft=String(input.value||'');
        if(state.activeConversation){
          if(!state.composerDrafts)state.composerDrafts={};
          state.composerDrafts[state.activeConversation]=state.composerDraft;
        }
      }else if(typeof state.composerDraft==='string'){
        input.value=state.composerDraft;
      }
    }
    return true;
  }
  function quietRefresh(){
    if(!state.session||!state.session.token||document.hidden)return Promise.resolve();
    if(state.route!=='conversations'&&state.route!=='dashboard')return Promise.resolve();
    // While user is typing in chat, only refresh data and keep route + composer.
    return softRefresh();
  }
  function startPoll(){
    if(window.__MCJCsPoll)return;
    window.__MCJCsPoll=setInterval(function(){
      if(isLoginView())return;
      quietRefresh();
    },2000);
  }
  function paintSafeFallback(){
    try{
      var staff=(state.data&&state.data.staff)||(state.session&&state.session.user)||{};
      root.innerHTML='<div class="cs-shell"><aside class="cs-side"><div class="cs-brand"><strong>MEOW CUI JIAO</strong><span>Customer Service</span></div><nav class="cs-nav">'+NAV.map(function(n){if(n[0]==='logout')return '<button type="button" data-logout>'+n[1]+'</button>';return '<button type="button" class="'+(n[0]==='dashboard'?'active':'')+'" data-route="'+n[2]+'">'+n[1]+'</button>'}).join('')+'</nav></aside><section class="cs-main"><header class="cs-top"><div><h1>客服工作台</h1><p>数据加载异常时仍保留工作台框架。</p></div><div class="cs-account"><span>'+esc(staff.name||staff.email||'客服')+'</span></div></header><main class="cs-page">'+dashboardHtml()+'</main></section></div>';
    }catch(e){
      root.textContent='客服工作台加载失败，请刷新页面。';
    }
  }
  function init(){
    try{
      var start=function(){
        state.session=readSession();
        state.route=routeFromPath(location.pathname);
        if(!state.session&&state.route!=='login'){
          if(/\/customer-service\/login/i.test(location.pathname)){
            state.route='login';
            paint();
            return;
          }
          // Shared auth gate owns redirect; avoid racing before restore.
          if(!(window.MCJServiceAuth&&window.MCJServiceAuth.hasSession&&window.MCJServiceAuth.hasSession())){
            if(window.MCJServiceAuth&&window.MCJServiceAuth.redirectToLogin){
              window.MCJServiceAuth.redirectToLogin(location.pathname+location.search+location.hash);
            }else{
              location.replace('/customer-service/login/');
            }
          }
          return;
        }
        if(state.session&&state.route==='login'){
          location.replace('/customer-service/dashboard/');
          return;
        }
        if(state.session){
          state.data=state.data||emptyDashboardData();
          state.loading=false;
          paint();
          load().then(startPoll).catch(function(){state.loading=false;paint()});
        }else{
          paint();
        }
      };
      if(window.MCJServiceAuth&&typeof window.MCJServiceAuth.ensureSession==='function'){
        window.MCJServiceAuth.ensureSession().then(start).catch(start);
      }else{
        start();
      }
    }catch(e){
      paintSafeFallback();
    }
  }
  window.addEventListener('popstate',function(){
    // Never remount the login form on history changes — that wiped typed values.
    if(!state.session||routeFromPath(location.pathname)==='login'){
      state.route='login';
      updateLoginChrome();
      return;
    }
    state.route=routeFromPath(location.pathname);
    paint();
  });
  function paint(){
    try{
      // Do NOT re-read URL into state.route here — that snapped 统一会话池 back to 工作台.
      if(state.route==='conversations')captureComposer();
      if(state.route==='login'||!state.session){
        ensureLoginMounted();
        return;
      }
      if(!state.data)state.data=emptyDashboardData();
      renderShell();
      if(state.route==='conversations')restoreComposer();
    }catch(e){
      paintSafeFallback();
    }
  }
  function noticeHtml(){return state.notice?'<div class="cs-toast show">'+esc(state.notice)+'</div>':''}
  function ensureLoginMounted(){
    var existing=root.querySelector('form[data-login]');
    if(existing){
      updateLoginChrome();
      return;
    }
    renderLogin();
  }
  function renderLogin(){
    // Never remount over an existing login form — that wiped typed values.
    if(root.querySelector('form[data-login]')){
      restoreLoginDraft();
      updateLoginChrome();
      return;
    }
    captureLoginDraft();
    var header=Auth&&Auth.brandHeader?Auth.brandHeader('客服端登录','使用后台创建的客服账号登录'):'<h1 class="mcj-auth-title">客服端登录</h1><p class="mcj-auth-desc">使用后台创建的客服账号登录</p>';
    var pwd=Auth&&Auth.passwordField?Auth.passwordField('password','密码'):'<label class="mcj-auth-field">密码<div class="mcj-auth-password password-field"><input name="password" type="password" autocomplete="current-password" required><button class="mcj-auth-eye" type="button" tabindex="-1" data-toggle-password aria-label="显示或隐藏密码">显示</button></div></label>';
    root.innerHTML=
      '<main class="mcj-auth-page">'+
      '<section class="mcj-auth-card">'+header+
      '<form class="mcj-auth-form" data-login autocomplete="on">'+
      '<label class="mcj-auth-field">邮箱<input name="account" type="text" inputmode="email" autocomplete="username" required placeholder="请输入客服邮箱"></label>'+
      pwd+
      '<label class="mcj-auth-check"><input name="remember" type="checkbox" checked> 记住登录</label>'+
      '<button class="mcj-auth-btn primary" type="submit"'+(state.loginBusy?' disabled':'')+'>'+(state.loginBusy?'登录中…':'登录')+'</button>'+
      '<p class="mcj-auth-error" data-auth-error>'+esc(state.loginError||'')+'</p>'+
      '<p class="mcj-auth-note">客服账号由管理员创建，停用账号无法登录。本页面不提供注册入口。</p>'+
      '</form></section></main>';
    restoreLoginDraft();
    updateLoginChrome();
    if(!window.__MCJCsAuthTogglesBound){
      window.__MCJCsAuthTogglesBound=true;
      root.addEventListener('click',function(e){
        var btn=e.target.closest('[data-toggle-password]');
        if(!btn)return;
        e.preventDefault();
        var wrap=btn.closest('.mcj-auth-password,.password-field')||btn.parentElement;
        var input=wrap&&wrap.querySelector('input');
        if(!input)return;
        captureLoginDraft();
        var value=input.value;
        var show=input.type==='password';
        input.type=show?'text':'password';
        input.value=value;
        if(state.loginDraft)state.loginDraft.password=value;
        btn.textContent=show?'隐藏':'显示';
      });
    }
  }
  function title(){return ({dashboard:'客服工作台',conversations:'统一会话池',orders:'订单处理',createOrder:'客服代下单',compensation:'申请补偿',reports:'工资中心',profile:'我的资料'})[state.route]||'客服端'}
  function renderShell(){var staff=(state.data&&state.data.staff)||(state.session&&state.session.user)||{};root.innerHTML='<div class="cs-shell"><aside class="cs-side"><div class="cs-brand"><strong>MEOW CUI JIAO</strong><span>Customer Service</span></div><nav class="cs-nav">'+NAV.map(function(n){if(n[0]==='logout')return '<button type="button" data-logout>'+n[1]+'</button>';return '<button type="button" class="'+(state.route===n[0]?'active':'')+'" data-route="'+n[2]+'">'+n[1]+'</button>'}).join('')+'</nav></aside><section class="cs-main"><header class="cs-top"><div><h1>'+title()+'</h1><p>客服端只处理会话与订单主流程。</p></div><div class="cs-account"><span>'+esc(staff.name||staff.email||'客服')+'</span></div></header><main class="cs-page" data-route="'+esc(state.route||'dashboard')+'">'+pageHtml()+'</main></section></div>'+noticeHtml()}
  function maintenanceHtml(name){return '<div class="cs-page-head"><div><h2>'+esc(name||'功能开发中')+'</h2><p>该模块暂未开放上线，请返回工作台继续处理会话与订单。</p></div><button class="cs-btn primary" type="button" data-route="/customer-service/dashboard">返回工作台</button></div><div class="cs-empty">功能开发中</div>'}
  function pageHtml(){
    var note='';
    if(state.loading)note+='<div class="cs-empty" style="padding:16px">正在读取真实数据...</div>';
    // create-order: never show page-level "部分数据暂不可用 / Supabase 请求失败"; use per-field tips only.
    if(state.error&&state.route!=='createOrder')note+='<div class="cs-dev-note"><strong>部分数据暂不可用</strong><span> '+esc(state.error)+'</span></div>';
    if(HIDDEN_MVP_ROUTES[state.route])return note+maintenanceHtml(title());
    if(state.route==='conversations')return note+conversationsHtml();
    if(state.route==='orders')return note+ordersHtml();
    if(state.route==='createOrder')return (state.loading?note:'')+createOrderHtml();
    if(state.route==='profile')return note+profileHtml();
    return note+dashboardHtml();
  }
  function metric(label,value){return '<article class="cs-card cs-metric"><span>'+esc(label)+'</span><strong>'+esc(value==null||value===''?'0':value)+'</strong></article>'}
  function dashboardHtml(){var s=(state.data&&state.data.summary)||{},work=(state.data&&state.data.workData)||{},att=work.todayAttendance||{},reassign=s.needsReassign||0,clocked=!!att.clockInAt,clockedOut=!!att.clockOutAt;return '<div class="cs-page-head"><div><h2>工作台</h2><p>今晚主流程：接待会话、确认付款、推进订单。</p></div><div class="cs-actions"><button class="cs-btn primary" type="button" data-route="/customer-service/conversations">进入会话池</button><button class="cs-btn" type="button" data-route="/customer-service/orders">订单处理</button></div></div><section class="cs-card" style="margin-bottom:14px"><h3>今日打卡</h3><div class="cs-info-list"><div><span>当前状态</span><strong>'+esc(att.attendanceStatus||'未打卡')+'</strong></div><div><span>上班时间</span><strong>'+esc(att.clockInText||'-')+'</strong></div><div><span>下班时间</span><strong>'+esc(att.clockOutText||'-')+'</strong></div><div><span>今日工时</span><strong>'+esc(att.workHours?att.workHours+' 小时':'-')+'</strong></div></div><div class="cs-actions" style="margin-top:12px"><button class="cs-btn primary" type="button" data-clock-in '+(clocked?'disabled':'')+'>上班打卡</button><button class="cs-btn" type="button" data-clock-out '+(!clocked||clockedOut?'disabled':'')+'>下班打卡</button></div></section>'+(reassign?'<div class="cs-empty" style="margin-bottom:12px"><strong>待重新安排订单</strong><span>共 '+esc(reassign)+' 单陪玩无法接单或确认超时，请到订单处理中更换陪玩 / 推送抢单 / 联系老板 / 发起退款。</span></div>':'')+'<section class="cs-grid cs-metrics">'+metric('当前接待中会话',s.currentReceptions||0)+metric('今日已接待会话',s.todayReceptions||0)+metric('今日完成订单',s.todayCompleted||0)+metric('今日协助付款',s.todayPaid||0)+metric('今日退款处理',s.todayRefunds||0)+metric('未读消息',s.unreadMessages||0)+metric('本月出勤天数',s.monthAttendanceDays||0)+metric('本月迟到次数',s.monthLateCount||0)+metric('本月缺勤次数',s.monthAbsenceCount||0)+metric('本月预计工资',money(s.estimatedSalary||0))+metric('待重新安排',reassign)+metric('今日处理订单数',s.todayHandled||0)+'</section>'}
  function parseProductCard(content){
    try{
      var data=typeof content==='string'?JSON.parse(content):content;
      if(data&&(data.kind==='gameplay_product'||data.productId))return data;
    }catch(e){}
    return null;
  }
  function productCardHtml(data){
    data=data||{};
    var price=data.fixedPrice===false?'咨询客服报价':moneyRate(data.price, data.pricingUnit||'每单');
    return '<div class="cs-product-card"><div class="cs-product-cover">'+(data.coverUrl?'<img src="'+esc(data.coverUrl)+'" alt="">':'MEOW')+'</div><div><strong>'+esc(data.name||'玩法商品')+'</strong><span>'+esc(price)+'</span><small>商品ID：'+esc(data.productId||'-')+' · 老板ID：'+esc(data.bossId||'-')+'</small><div class="cs-actions"><button class="cs-btn" type="button" data-route="/customer-service/create-order" data-gp-fill="'+esc(data.productId||'')+'" data-gp-name="'+esc(data.name||'')+'" data-gp-price="'+esc(data.price||0)+'" data-gp-unit="'+esc(data.pricingUnit||'')+'" data-gp-boss="'+esc(data.bossId||'')+'">创建正式订单</button></div></div></div>';
  }
  function isGameplayConversation(c,msgs){
    var list=(msgs||[]).filter(function(m){return c&&m.conversationId===c.id});
    return list.some(function(m){return m.messageType==='product_card'||/更多玩法/.test(String(m.content||''));});
  }
  function fmtChatTime(v){
    if(!v)return '';
    var d=new Date(v);
    if(isNaN(d.getTime()))return String(v);
    var now=new Date();
    var hh=String(d.getHours()).padStart(2,'0');
    var mm=String(d.getMinutes()).padStart(2,'0');
    var time=hh+':'+mm;
    var sameDay=d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth()&&d.getDate()===now.getDate();
    if(sameDay)return '今天 '+time;
    var yest=new Date(now);yest.setDate(now.getDate()-1);
    var isYest=d.getFullYear()===yest.getFullYear()&&d.getMonth()===yest.getMonth()&&d.getDate()===yest.getDate();
    if(isYest)return '昨天 '+time;
    return (d.getMonth()+1)+'/'+d.getDate()+' '+time;
  }
  function companionAcceptLabel(order){
    if(!order)return '-';
    var s=String(order.status||'');
    var note=String(order.note||order.cancelReason||'');
    if(s==='awaiting_payment')return '尚未付款';
    if(s==='claimed')return '等待陪玩确认';
    if(s==='confirmed')return '陪玩已接单';
    if(s==='in_progress')return '服务进行中';
    if(s==='pending'&&(/无法接单|拒单/.test(note)||order.needsReassign))return '需要重新安排';
    if(s==='pending'&&/确认超时/.test(note))return '需要重新安排';
    if(s==='pending')return '待客服安排';
    if(s==='completed')return '已完成';
    return order.statusText||s||'-';
  }
  function paymentStatusLabel(order){
    if(!order)return '-';
    var s=String(order.status||'');
    if(s==='awaiting_payment')return '待付款';
    if(s==='cancelled')return '已取消';
    if(s==='refunded')return '已退款';
    return '已付款';
  }
  function conversationCardHtml(c,active,data){
    var order=(data.orders||[]).find(function(o){return o.id===c.orderId})||{};
    var tag=isGameplayConversation(c,data.messages)?'更多玩法咨询':(c.orderNo||'无订单');
    var uid=c.bossUid||c.bossId||'';
    var companionName=order.companionName&&order.companionName!=='-'?order.companionName:'未指定';
    var unread=Number(c.unread||c.unreadCount||0)||0;
    var statusLabel=isClosedConv(c)?'已结束':(c.currentServiceId?(c.currentServiceName||'接待中'):'待接待');
    return '<button type="button" class="cs-conversation '+(active&&active.id===c.id?'active':'')+'" data-conversation="'+esc(c.id)+'">'+
      '<strong class="cs-conv-title">'+esc(c.bossName||'老板')+(uid?' · '+esc(uid):'')+'</strong>'+
      '<span class="cs-conv-line">订单：'+esc(tag)+'</span>'+
      '<span class="cs-conv-line">'+esc(companionName)+' · '+esc(statusLabel)+'</span>'+
      '<small class="cs-conv-preview">'+esc(c.lastMessage||'暂无消息')+'</small>'+
      (unread?'<b class="cs-conv-unread">'+esc(unread)+'</b>':'')+
      '</button>';
  }
  function conversationsHtml(){
    var data=state.data||{};
    var counts=filterCounts();
    var list=filteredConversations();
    var active=(data.conversations||[]).find(function(c){return c.id===state.activeConversation})||null;
    var msgs=(data.messages||[]).filter(function(m){return active&&m.conversationId===active.id});
    var order=(data.orders||[]).find(function(o){return active&&o.id===active.orderId});
    var activeProduct=null;
    msgs.forEach(function(m){if(m.messageType==='product_card')activeProduct=parseProductCard(m.content)||activeProduct;});
    var myId=myServiceId();
    var takenByOther=!!(active&&active.currentServiceId&&active.currentServiceId!==myId);
    var takenByMe=!!(active&&active.currentServiceId&&active.currentServiceId===myId);
    var canReply=composerCanReply(active);
    var blockReason=composerBlockReason(active);
    var isClosed=isClosedConv(active);
    var takeBtn=active?(isClosed
      ?'<button class="cs-btn" type="button" disabled>会话已结束</button>'
      :takenByOther
      ?'<button class="cs-btn" type="button" disabled>该会话已由客服 '+esc(active.currentServiceName||'其他客服')+' 接待。</button>'
      :(takenByMe
        ?'<button class="cs-btn danger" type="button" data-end="'+esc(active.id)+'">结束接待</button>'
        :'<button class="cs-btn primary" type="button" data-take="'+esc(active.id)+'"'+(state.acceptingId===active.id?' disabled data-taking="1"':'')+'>'+(state.acceptingId===active.id?'接待中…':'接待')+'</button>')):'';
    var bossLabel=active?(active.bossUid||active.bossId||''):'';
    var listOpen=!!state.showConversationList;
    var composerHtml=(active&&!isClosed)
      ?('<div class="cs-chat-composer" data-cs-composer-wrap>'+
        '<p class="cs-composer-hint" data-cs-composer-hint'+(canReply?' hidden':'')+'>'+esc(canReply?'':blockReason)+'</p>'+
        '<form class="cs-chat-input" data-send-message action="#" method="post" autocomplete="off" onsubmit="return false;">'+
        '<textarea name="content" data-cs-composer rows="1" placeholder="'+esc(canReply?'输入消息，Enter 发送，Shift+Enter 换行':(blockReason||'无法回复'))+'" autocomplete="off" maxlength="2000"'+(canReply?'':' disabled readonly')+'></textarea>'+
        '<button class="cs-btn primary cs-send-btn" type="button" data-cs-send'+(canReply&&String(state.composerDraft||'').trim()?'':' disabled')+'>发送</button>'+
        '</form></div>')
      :'';
    var listHtml='<aside class="cs-chat-list'+(listOpen?' is-open':'')+'" data-cs-chat-list>'+
      '<div class="cs-chat-list-head"><strong>会话列表</strong><div class="cs-actions">'+
      '<button class="cs-btn" type="button" data-refresh>刷新</button>'+
      '<button class="cs-btn cs-list-close" type="button" data-close-conv-list>关闭</button>'+
      '</div></div>'+
      '<div class="cs-conv-tabs" role="tablist">'+
      '<button type="button" class="cs-conv-tab'+(state.convFilter==='waiting'?' active':'')+'" data-conv-filter="waiting">待接待 <em>'+counts.waiting+'</em></button>'+
      '<button type="button" class="cs-conv-tab'+(state.convFilter==='active'?' active':'')+'" data-conv-filter="active">接待中 <em>'+counts.active+'</em></button>'+
      '<button type="button" class="cs-conv-tab'+(state.convFilter==='ended'?' active':'')+'" data-conv-filter="ended">已结束 <em>'+counts.ended+'</em></button>'+
      '</div>'+
      (list.length?list.map(function(c){return conversationCardHtml(c,active,data)}).join(''):'<div class="cs-empty">该分类暂无会话</div>')+
      '</aside>';
    var orderPanel=order
      ?('<div class="cs-info-list">'+
        '<div><span>订单编号</span><strong title="'+esc(order.orderNo||'')+'">'+esc(order.orderNo)+'</strong></div>'+
        '<div><span>付款状态</span><strong>'+esc(paymentStatusLabel(order))+'</strong></div>'+
        '<div><span>指定陪玩</span><strong>'+esc(order.companionName||'-')+'</strong></div>'+
        '<div><span>陪玩确认</span><strong>'+esc(companionAcceptLabel(order))+'</strong></div>'+
        '<div><span>确认时间</span><strong>'+esc(order.acceptedAt?fmtChatTime(order.acceptedAt):'-')+'</strong></div>'+
        '<div><span>拒绝原因</span><strong>'+esc((/无法接单[：:]?\s*(.+)/.exec(String(order.cancelReason||order.note||''))||[])[1]||'-')+'</strong></div>'+
        '<div><span>当前处理人</span><strong>'+esc(active&&active.currentServiceName?active.currentServiceName:'待接待')+'</strong></div>'+
        '<div><span>游戏</span><strong>'+esc(order.game||'-')+'</strong></div>'+
        '<div><span>金额</span><strong>'+money(order.totalAmount)+'</strong></div>'+
        '<div><span>订单状态</span><strong>'+esc(order.statusText||'-')+'</strong></div>'+
        (order.needsReassign?'<div><span>待处理</span><strong style="color:#ff6b7a">需要重新安排</strong></div>':'')+
        '</div><button class="cs-btn" type="button" data-route="/customer-service/orders">查看订单</button>')
      :(!activeProduct?'<div class="cs-empty">暂无关联订单</div>':'');
    return '<div class="cs-chat-layout'+(listOpen?' list-open':'')+'">'+
      (listOpen?'<div class="cs-chat-list-backdrop" data-close-conv-list></div>':'')+
      listHtml+
      '<section class="cs-chat-main">'+
      (active
        ?('<header class="cs-chat-head">'+
          '<div class="cs-chat-head-main">'+
          '<button class="cs-btn cs-back-list" type="button" data-open-conv-list>会话列表</button>'+
          '<div><h2>'+esc(active.bossName||'老板')+'</h2>'+
          '<p>'+(bossLabel?'编号 '+esc(bossLabel)+' · ':'')+(active.orderNo?'订单 '+esc(active.orderNo)+' · ':'')+esc(isClosed?'已结束':(active.currentServiceId?(active.currentServiceName||'接待中'):'待接待'))+'</p></div></div>'+
          takeBtn+
          '</header>'+
          '<div class="cs-chat-messages">'+(msgs.length?msgs.map(messageHtml).join(''):'<div class="cs-empty">暂无消息</div>')+'</div>'+
          composerHtml)
        :'<div class="cs-empty cs-pick-session">请从左侧选择会话<button class="cs-btn primary" style="margin-top:12px" type="button" data-open-conv-list>打开会话列表</button></div>')+
      '</section>'+
      '<aside class="cs-chat-side"><h3>订单 / 商品资料</h3>'+(activeProduct?productCardHtml(activeProduct):'')+orderPanel+'</aside></div>';
  }
  function messageHtml(m){
    var when=fmtChatTime(m.createdAt);
    if(m.messageType==='product_card'){
      var card=parseProductCard(m.content);
      if(card)return '<div class="cs-msg '+(m.senderRole==='customer_service'?'mine':'')+'">'+productCardHtml(card)+'<small>'+esc(when)+'</small></div>';
    }
    var system=m.senderRole==='system'||m.messageType==='system';
    var mine=m.senderRole==='customer_service'&&!system;
    var who=mine?(m.senderName||'客服'):(system?'':(m.senderName||(m.senderRole==='boss'?'老板':'')));
    return '<div class="cs-msg '+(mine?'mine':'')+(system?' system':'')+'">'+(who?'<strong>'+esc(who)+'</strong>':'')+'<p>'+esc(m.content||'')+'</p><small>'+esc(when)+'</small></div>';
  }
  function ordersHtml(){var rows=((state.data&&state.data.orders)||[]).filter(function(o){return !state.orderFilter||o.status===state.orderFilter});var statuses=(state.data&&state.data.orderStatuses)||{};return '<div class="cs-page-head"><div><h2>订单处理</h2><p>确认付款、指派陪玩、处理退款，所有操作写入真实订单表。</p></div><div class="cs-actions"><button class="cs-btn primary" data-route="/customer-service/create-order">客服代下单</button></div></div><div class="cs-toolbar"><select data-order-filter><option value="">全部状态</option>'+Object.keys(statuses).map(function(k){return '<option value="'+esc(k)+'" '+(state.orderFilter===k?'selected':'')+'>'+esc(statuses[k])+'</option>'}).join('')+'</select><button class="cs-btn" data-refresh>刷新</button></div><section class="cs-table-wrap"><table class="cs-table"><thead><tr><th>订单编号</th><th>老板</th><th>陪玩</th><th>游戏</th><th>金额</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>'+(rows.length?rows.map(orderRow).join(''):'<tr><td colspan="8"><div class="cs-empty">暂无订单</div></td></tr>')+'</tbody></table></section>'}
  function compensationHtml(){var bosses=(state.data&&state.data.bosses)||[],orders=(state.data&&state.data.orders)||[];return '<div class="cs-page-head"><div><h2>申请补偿</h2><p>客服只能提交申请，管理员审核通过后才会入账赠送猫粮。</p></div></div><form class="cs-card cs-form" data-compensation-form><label>老板 UID / 选择老板<select name="boss_id" required><option value="">请选择老板</option>'+bosses.map(function(b){return '<option value="'+esc(b.id)+'">'+esc(b.bossUid||b.uid||'')+' / '+esc(b.name)+'</option>'}).join('')+'</select></label><label>或输入老板 UID<input name="boss_uid" placeholder="B100001"></label><label>关联订单<select name="related_order_id"><option value="">可选</option>'+orders.map(function(o){return '<option value="'+esc(o.id)+'">'+esc(o.orderNo)+' / '+esc(o.bossName)+'</option>'}).join('')+'</select></label><label>类型<select name="request_type"><option value="bad_review">差评安抚</option><option value="after_sale">售后补偿</option><option value="activity">活动奖励</option><option value="other">其他</option></select></label><label>建议补偿猫粮<input name="suggested_amount" type="number" min="1" required></label><label>差评或投诉原因<textarea name="reason" required></textarea></label><label>客服说明<textarea name="staff_note"></textarea></label><button class="cs-btn primary" type="submit">提交申请</button></form>'}
  function orderRow(o){var actions=[];if(o.status==='awaiting_payment')actions.push('<button class="cs-btn" data-confirm-payment="'+esc(o.id)+'">确认已付款</button>');if(o.needsReassign||o.status==='pending'||o.status==='claimed')actions.push('<button class="cs-btn primary" data-assign-order="'+esc(o.id)+'">'+(o.needsReassign?'更换陪玩':'指定陪玩')+'</button>');else actions.push('<button class="cs-btn" data-assign-order="'+esc(o.id)+'">指定陪玩</button>');actions.push('<button class="cs-btn" data-status-order="'+esc(o.id)+'">改状态</button>');if(o.status==='refund_requested'||o.needsReassign)actions.push('<button class="cs-btn" data-refund-order="'+esc(o.id)+'">'+(o.needsReassign?'发起退款':'处理退款')+'</button>');var statusCell=esc(o.statusText)+(o.needsReassign?'<br><small style="color:#f59e0b">'+(esc(o.reassignHint||'待重新安排'))+'</small>':'')+(o.acceptedAt&&o.status==='confirmed'?'<br><small>确认：'+esc(o.acceptedAt)+'</small>':'');return '<tr'+(o.needsReassign?' style="background:rgba(245,158,11,.08)"':'')+'><td>'+esc(o.orderNo)+'</td><td>'+esc(o.bossName)+(o.bossUid?'<br><small>'+esc(o.bossUid)+'</small>':'')+'</td><td>'+esc(o.companionName)+'</td><td>'+esc(o.game||'-')+'</td><td>'+money(o.totalAmount)+'</td><td>'+statusCell+'</td><td>'+esc(o.createdAt||'-')+'</td><td><div class="cs-actions">'+actions.join('')+'</div></td></tr>'}
  function createOrderHtml(){
    var bosses=(state.data&&state.data.bosses)||[];
    var companions=(state.data&&state.data.companions)||[];
    var services=(state.services||[]).filter(function(s){return s.allowOrder!==false});
    var errs=state.createOrderErrors||{};
    var bossesErr=errs.bosses||'';
    var companionsErr=errs.companions||'';
    var servicesErr=errs.services||state.servicesError||'';
    var draft=null;
    try{draft=JSON.parse(sessionStorage.getItem('mcjGameplayOrderDraft')||'null');}catch(e){draft=null;}
    var bossesTip=bossesErr
      ?('<div class="cs-empty" data-create-order-bosses-err>'+esc(bossesErr)+'</div>')
      :(!bosses.length?'<div class="cs-empty" data-create-order-bosses-empty>暂无老板账号，可手动输入老板 UID。</div>':'');
    var companionsTip=companionsErr
      ?('<div class="cs-empty" data-create-order-companions-err>'+esc(companionsErr)+'</div>')
      :(!companions.length?'<div class="cs-empty" data-create-order-companions-empty>暂无陪玩数据。</div>':'');
    var serviceField;
    if(services.length){
      serviceField='<label>服务<select name="game" required><option value="">请选择服务</option>'+(draft&&draft.name?'<option value="'+esc(draft.name)+'" selected>'+esc(draft.name)+' / 更多玩法</option>':'')+services.map(function(s){var price=s.defaultPrice||s.default_price||'';var label=(s.icon?s.icon+' ':'')+(s.name||'')+(price?' · '+price:'')+' / '+(s.category||'-');return '<option value="'+esc(s.name)+'">'+esc(label)+'</option>'}).join('')+'</select></label>';
    }else if(state.servicesSource==='missing_table'||/services\.sql|表未初始化/i.test(servicesErr||'')){
      serviceField='<label>服务<select name="game" disabled><option value="">暂不可用</option></select></label><div class="cs-empty" data-create-order-services-err>'+esc(servicesErr||'services 表未初始化。请在 Supabase SQL Editor 执行 supabase/services.sql。')+'</div>'+(draft&&draft.name?'<input type="hidden" name="game" value="'+esc(draft.name)+'">':'');
    }else{
      serviceField='<label>服务<select name="game" '+(draft&&draft.name?'':'disabled')+'><option value="">'+(servicesErr||'暂无服务配置')+'</option>'+(draft&&draft.name?'<option value="'+esc(draft.name)+'" selected>'+esc(draft.name)+' / 更多玩法</option>':'')+'</select></label><div class="cs-empty" data-create-order-services-empty>'+esc(servicesErr||'暂无服务配置')+'</div>';
    }
    return '<div class="cs-page-head"><div><h2>客服代下单</h2><p>客服根据老板需求代为创建订单。可通过老板 UID 识别账号。</p></div></div><form class="cs-card cs-form" data-order-form><label>选择老板<select name="boss_id"><option value="">请选择老板</option>'+bosses.map(function(b){return '<option value="'+esc(b.id)+'" '+(draft&&draft.bossId===b.id?'selected':'')+'>'+esc(b.bossUid||b.uid||'')+' / '+esc(b.name)+' / '+esc(b.email)+'</option>'}).join('')+'</select></label>'+bossesTip+'<label>或输入老板 UID<input name="boss_uid" placeholder="例如 B100001" value=""></label><label>指定陪玩（可选）<select name="companion_id"><option value="">发布到抢单大厅</option>'+companions.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+' / '+(p.companionUid?'P'+esc(p.companionUid):esc(p.id))+' / '+esc(p.game||'-')+' / '+money(p.price)+'</option>'}).join('')+'</select></label>'+companionsTip+serviceField+'<label>订单类型<input name="order_type" value="'+(draft?'gameplay_mall':'customer_service')+'"></label><label>需求说明<textarea name="description" required>'+(draft?('更多玩法商品：'+(draft.name||'')+'（ID：'+(draft.productId||'')+'）\n计价：'+(draft.unit||'')+'\n数量：\n时长：\n游戏区服：\n开始时间：\n备注：'):'')+'</textarea></label><label>时长<input name="hours" type="number" min="1" value="1" required></label><label>单价 RM<input name="unit_price" type="number" min="0" value="'+esc(draft&&draft.price||'')+'" required></label><label>总金额 RM<input name="total_amount" type="number" min="1" value="'+esc(draft&&draft.price||'')+'" required></label><button class="cs-btn primary" type="submit">创建订单</button></form>';
  }
  function reportsHtml(){var work=(state.data&&state.data.workData)||{},salary=work.salary||{},cur=salary.current||{},history=salary.history||[];return '<div class="cs-page-head"><div><h2>工资中心</h2><p>工资来源于真实接待、订单和出勤统计，客服只能查看。</p></div></div><section class="cs-grid cs-metrics">'+metric('基础工资',money(cur.baseSalary||0))+metric('全勤奖励',money(cur.attendanceBonus||0))+metric('接待奖励',money(cur.receptionBonus||0))+metric('订单提成',money(cur.orderCommission||0))+metric('夜班补贴',money(cur.nightShiftAllowance||0))+metric('迟到扣款',money(cur.lateDeduction||0))+metric('缺勤扣款',money(cur.absenceDeduction||0))+metric('其他调整',money(cur.otherAdjustment||0))+metric('本月预计工资',money(cur.totalSalary||0))+metric('工资状态',cur.status||'统计中')+'</section><section class="cs-table-wrap" style="margin-top:14px"><table class="cs-table"><thead><tr><th>月份</th><th>基础工资</th><th>全勤奖励</th><th>接待奖励</th><th>订单提成</th><th>扣款合计</th><th>预计工资</th><th>状态</th></tr></thead><tbody>'+(history.length?history.map(function(r){var deductions=(Number(r.lateDeduction||0)+Number(r.absenceDeduction||0)+Number(r.earlyLeaveDeduction||0));return '<tr><td>'+esc(r.salaryMonth||'-')+'</td><td>'+money(r.baseSalary||0)+'</td><td>'+money(r.attendanceBonus||0)+'</td><td>'+money(r.receptionBonus||0)+'</td><td>'+money(r.orderCommission||0)+'</td><td>'+money(deductions)+'</td><td>'+money(r.totalSalary||0)+'</td><td>'+esc(r.status||'统计中')+'</td></tr>'}).join(''):'<tr><td colspan="8">暂无工资记录</td></tr>')+'</tbody></table></section>'}
  function reportStatus(s){return ({pending:'待审核',approved:'已批准',rejected:'已拒绝',paid:'已支付',completed:'已发放'})[s]||s||'-'}
  function profileHtml(){var s=(state.data&&state.data.staff)||state.session.user||{},work=(state.data&&state.data.workData)||{},cfg=work.config||{},att=work.attendance||{},sum=(state.data&&state.data.summary)||{},avatar='<div class="cs-avatar" style="width:64px;height:64px;display:grid;place-items:center">'+esc((s.name||s.email||'客').slice(0,1))+'</div>';return '<section class="cs-card"><h2>我的资料</h2><div class="cs-user-card">'+avatar+'<div><strong>'+esc(s.name||'-')+'</strong><div style="color:#9ca3af;margin-top:4px">'+esc(cfg.employeeCode||'未设置工号')+' · '+esc(cfg.shiftName||'默认班次')+'</div></div></div><div class="cs-info-list"><div><span>登录邮箱</span><strong>'+esc(s.email||'-')+'</strong></div><div><span>当前班次</span><strong>'+esc((cfg.shiftStart||'09:00')+' - '+(cfg.shiftEnd||'18:00'))+'</strong></div><div><span>入职日期</span><strong>'+esc(cfg.joinDate||'-')+'</strong></div><div><span>在线状态</span><strong>'+esc(sum.currentReceptions>0?'接待中':'在线')+'</strong></div><div><span>今日打卡状态</span><strong>'+esc((work.todayAttendance&&work.todayAttendance.attendanceStatus)||'未打卡')+'</strong></div><div><span>本月出勤</span><strong>'+esc((att.actualDays||0)+' / '+(att.standardDays||0))+'</strong></div><div><span>本月预计工资</span><strong>'+money(sum.estimatedSalary||0)+'</strong></div><div><span>历史工资记录</span><strong>'+esc((work.salary&&work.salary.history&&work.salary.history.length)||0)+' 条</strong></div></div></section>'}
  function sendChatMessage(){
    if(state.sendingChat)return;
    var conv=activeConversation();
    if(!composerCanReply(conv)){
      toast(composerBlockReason(conv)||'当前无法发送消息');
      syncComposerEnabled();
      return;
    }
    var input=root.querySelector(COMPOSER_SEL);
    var content=String((input&&input.value)||state.composerDraft||'');
    // Keep exact draft for failure restore; only trim for empty check / API.
    var trimmed=content.trim();
    if(!trimmed||!state.activeConversation)return;
    state.sendingChat=true;
    state.composerDraft=content;
    state.composerFocused=true;
    syncComposerEnabled();
    var safety=setTimeout(function(){state.sendingChat=false;syncComposerEnabled();},12000);
    api('send_message',{conversation_id:state.activeConversation,content:trimmed}).then(function(res){
      state.composerDraft='';
      if(state.activeConversation&&state.composerDrafts)state.composerDrafts[state.activeConversation]='';
      if(input)input.value='';
      // Optimistic append when API returns the row (avoids waiting on bootstrap while staying on 统一会话池).
      if(res&&res.messageRow){
        var box=root.querySelector('.cs-chat-messages');
        if(box){
          var empty=box.querySelector('.cs-empty');
          if(empty)empty.remove();
          box.insertAdjacentHTML('beforeend',messageHtml(res.messageRow));
          try{box.scrollTop=box.scrollHeight;}catch(e){}
        }
      }
      return softRefresh();
    }).catch(function(err){
      // Keep original text on failure; do not remount composer.
      state.composerDraft=content;
      if(state.activeConversation){
        if(!state.composerDrafts)state.composerDrafts={};
        state.composerDrafts[state.activeConversation]=content;
      }
      if(input){
        input.value=content;
        try{
          input.focus({preventScroll:true});
          var len=content.length;
          input.setSelectionRange(len,len);
        }catch(e){}
      }
      toast(err.message||'发送失败');
    }).finally(function(){
      clearTimeout(safety);
      state.sendingChat=false;
      syncComposerEnabled();
    });
  }
  document.addEventListener('input',function(e){
    if(!e.target||!e.target.closest)return;
    if(e.target.closest('form[data-login]'))captureLoginDraft();
    if(e.target.matches&&e.target.matches(COMPOSER_SEL)){
      state.composerDraft=String(e.target.value||'');
      if(state.activeConversation){
        if(!state.composerDrafts)state.composerDrafts={};
        state.composerDrafts[state.activeConversation]=state.composerDraft;
      }
      state.composerFocused=true;
      syncComposerEnabled();
    }
  },true);
  document.addEventListener('focusin',function(e){
    if(e.target&&e.target.matches&&e.target.matches(COMPOSER_SEL)){
      state.composerFocused=true;
    }
  },true);
  document.addEventListener('focusout',function(e){
    if(e.target&&e.target.matches&&e.target.matches(COMPOSER_SEL)){
      state.composerDraft=String(e.target.value||'');
      if(state.activeConversation){
        if(!state.composerDrafts)state.composerDrafts={};
        state.composerDrafts[state.activeConversation]=state.composerDraft;
      }
      // Keep sticky focus flag during poll windows; only clear if focus left the composer wrap.
      setTimeout(function(){
        var ae=document.activeElement;
        if(!(ae&&ae.matches&&ae.matches(COMPOSER_SEL)))state.composerFocused=false;
      },0);
    }
  },true);
  document.addEventListener('change',function(e){
    if(!e.target||!e.target.matches)return;
    if(e.target.closest&&e.target.closest('form[data-login]'))captureLoginDraft();
    if(e.target.matches('[data-order-filter]')){state.orderFilter=e.target.value;paint()}
  });
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter')return;
    if(e.isComposing||e.keyCode===229)return;
    var input=e.target&&e.target.closest&&e.target.closest(COMPOSER_SEL);
    if(!input)return;
    // Shift+Enter = newline (textarea default); Enter alone = send.
    if(e.shiftKey)return;
    e.preventDefault();
    e.stopPropagation();
    sendChatMessage();
  },true);
  document.addEventListener('submit',function(e){
    if(e.target.matches('[data-send-message]')){
      e.preventDefault();
      e.stopPropagation();
      sendChatMessage();
      return;
    }
    if(e.target.matches('[data-login]')){e.preventDefault();var form=e.target;var fd=new FormData(form);var btn=form.querySelector('[type="submit"]');var remember=!!fd.get('remember');captureLoginDraft();state.loginError='';state.loginBusy=true;updateLoginChrome();if(Auth&&Auth.setFormError)Auth.setFormError(form,'');else{var box=form.querySelector('[data-auth-error]');if(box)box.textContent='';}if(Auth&&Auth.setLoading)Auth.setLoading(btn,true);else if(btn){btn.disabled=true;btn.textContent='登录中…';}api('login',{account:String(fd.get('account')||'').trim(),password:String(fd.get('password')||''),remember:remember}).then(function(res){saveSession(res.session,true);state.loginBusy=false;state.loginError='';state.loginDraft={account:'',password:'',remember:false};location.assign('/customer-service/dashboard/');}).catch(function(err){state.loginBusy=false;state.loginError=err.message||'账号或密码错误。';updateLoginChrome();if(Auth&&Auth.setLoading)Auth.setLoading(btn,false,'登录');else if(btn){btn.disabled=false;btn.textContent='登录';}if(Auth&&Auth.setFormError)Auth.setFormError(form,state.loginError);else{var errBox=form.querySelector('[data-auth-error]');if(errBox)errBox.textContent=state.loginError;else toast(state.loginError);}restoreLoginDraft();});return}if(e.target.matches('[data-order-form]')){e.preventDefault();var fd2=new FormData(e.target),order={};fd2.forEach(function(v,k){order[k]=String(v||'')});var bossId=String(order.boss_id||'').trim();var bossUid=String(order.boss_uid||'').trim();var companionId=String(order.companion_id||'').trim();if(!bossId&&!bossUid){toast('请选择老板或输入老板 UID');return;}order.boss_id=bossId||bossUid;order.boss_uid=bossUid||'';order.companion_id=companionId||null;api('create_order',{order:order}).then(function(res){toast(res.message||'订单已创建');go('/customer-service/orders');return softRefresh()}).catch(function(err){toast(err.message||'创建订单失败')});return}if(e.target.matches('[data-compensation-form]')){e.preventDefault();var cf=new FormData(e.target),payload={};cf.forEach(function(v,k){payload[k]=String(v||'')});if(payload.boss_uid&&payload.boss_uid.trim())payload.boss_id=payload.boss_uid.trim();api('apply_compensation',payload).then(function(res){toast(res.message||'补偿申请已提交');go('/customer-service/orders');return softRefresh()}).catch(function(err){toast(err.message)});return}if(e.target.matches('[data-report-form]')){e.preventDefault();toast('客服不能自行填写应付工资，请使用工资记录申诉');return}
  });
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-clock-in]')){api('clock_in',{}).then(function(res){toast(res.message||'上班打卡成功');state.data=res.data||state.data;paint();}).catch(function(err){toast(err.message||'上班打卡失败')});return}
    if(e.target.closest('[data-clock-out]')){api('clock_out',{}).then(function(res){toast(res.message||'下班打卡成功');state.data=res.data||state.data;paint();}).catch(function(err){toast(err.message||'下班打卡失败')});return}
    if(e.target.closest('[data-cs-send]')){
      e.preventDefault();
      e.stopPropagation();
      sendChatMessage();
      return;
    }
    var filterBtn=e.target.closest('[data-conv-filter]');
    if(filterBtn){
      e.preventDefault();
      state.convFilter=filterBtn.getAttribute('data-conv-filter')||'active';
      if(state.route==='conversations'){
        if(root.querySelector('.cs-chat-layout')&&patchConversationMessages()){/* ok */}
        else paint();
      }
      return;
    }
    // Only real nav controls — never #serviceApp[data-route] (that mapped every chat click to 工作台).
    var r=e.target.closest('a[data-route], button[data-route]');
    if(r&&r!==root&&!r.closest('form[data-send-message], form[data-login]')){
    e.preventDefault();
    e.stopPropagation();
    var fill=r.getAttribute('data-gp-fill');
    if(fill!=null){
      try{sessionStorage.setItem('mcjGameplayOrderDraft',JSON.stringify({productId:fill,name:r.getAttribute('data-gp-name')||'',price:r.getAttribute('data-gp-price')||'',unit:r.getAttribute('data-gp-unit')||'',bossId:r.getAttribute('data-gp-boss')||''}));}catch(err){}
    }
    var targetPath=r.getAttribute('data-route');
    if(!targetPath||targetPath==='/'||targetPath==='/customer-service'||targetPath==='/customer-service/')return;
    setTimeout(function(){ go(targetPath); }, 0);
    return;
  }var appealBtn=e.target.closest('[data-payroll-appeal]');if(appealBtn){var reason=prompt('请填写工资异议申诉原因');if(!reason)return;api('appeal_payroll',{payrollId:appealBtn.dataset.payrollAppeal,reason:reason}).then(function(res){toast(res.message||'申诉已提交');return softRefresh()}).catch(function(err){toast(err.message)});return}if(e.target.closest('[data-logout]')){clearSession();if(window.MCJRoleGate&&window.MCJRoleGate.logout)window.MCJRoleGate.logout('customer_service');location.assign('/customer-service/login/');return}if(e.target.closest('[data-refresh]')){softRefresh();return}
  if(e.target.closest('[data-open-conv-list]')){state.showConversationList=true;if(state.route==='conversations')paint();return}
  if(e.target.closest('[data-close-conv-list]')){state.showConversationList=false;if(state.route==='conversations')paint();return}
  var c=e.target.closest('[data-conversation]');if(c){e.preventDefault();e.stopPropagation();var cid=c.dataset.conversation;setTimeout(function(){
      var prev=state.activeConversation;
      if(prev&&prev!==cid){
        saveComposerDraftFor(prev);
        var pending=String((state.composerDrafts&&state.composerDrafts[prev])||state.composerDraft||'').trim();
        if(pending&&!confirm('当前会话有未发送内容，切换后将为你保留草稿。确定切换？'))return;
      }
      state.suppressAutoSelect=false;
      state.activeConversation=cid;
      state.showConversationList=false;
      state.route='conversations';
      // Switch filter tab to match selected conversation bucket.
      var picked=((state.data&&state.data.conversations)||[]).find(function(x){return x.id===cid});
      if(picked)state.convFilter=convBucket(picked);
      clearUnreadLocally(cid);
      loadComposerDraftFor(cid);
      paint();
      markConversationRead(cid);
    },0);return}var take=e.target.closest('[data-take]');if(take){e.preventDefault();e.stopPropagation();
      if(take.disabled||take.getAttribute('data-taking')==='1')return;
      var cid=String(take.getAttribute('data-take')||take.dataset.take||'').trim();
      if(!cid){toast('会话无效');return;}
      take.setAttribute('data-taking','1');
      take.disabled=true;
      take.textContent='接待中…';
      acceptConversation(cid).then(function(){
        // Button DOM may have been replaced; sync via patch/paint.
        if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
        else if(state.route==='conversations')paint();
        syncComposerEnabled();
      }).catch(function(err){
        take.disabled=false;
        take.removeAttribute('data-taking');
        take.textContent='接待';
        toast(err&&err.message?err.message:'接待失败');
        if(root.querySelector('.cs-chat-layout'))patchConversationMessages();
      });
      return;
    }var endTake=e.target.closest('[data-end]');if(endTake){e.preventDefault();if(!confirm('确认结束本次接待吗？'))return;
      var endId=String(endTake.dataset.end||'').trim();
      api('end_conversation',{id:endId,conversation_id:endId}).then(function(res){
        toast(res.message||'已结束接待');
        applyEndedLocally(endId);
        state.acceptLock=null;
        state.activeConversation='';
        state.suppressAutoSelect=true;
        state.convFilter='ended';
        state.showConversationList=true;
        state.composerDraft='';
        state.route='conversations';
        return softRefresh().finally(function(){
          state.activeConversation='';
          state.suppressAutoSelect=true;
          state.convFilter='ended';
          paint();
        });
      }).catch(function(err){toast(err.message||'结束接待失败')});return}var pay=e.target.closest('[data-confirm-payment]');if(pay){api('confirm_payment',{id:pay.dataset.confirmPayment}).then(function(res){toast(res.message||'已确认付款');return softRefresh()}).catch(function(err){toast(err.message)});return}var assign=e.target.closest('[data-assign-order]');if(assign){openAssign(assign.dataset.assignOrder);return}var st=e.target.closest('[data-status-order]');if(st){openStatus(st.dataset.statusOrder);return}var refund=e.target.closest('[data-refund-order]');if(refund){openRefund(refund.dataset.refundOrder);return}var close=e.target.closest('[data-close-modal]');if(close){close.closest('.cs-modal').remove();return}});
  function modal(html){document.body.insertAdjacentHTML('beforeend','<div class="cs-modal"><div class="cs-dialog cs-form">'+html+'</div></div>')}
  function openAssign(id){var cs=(state.data&&state.data.companions)||[];modal('<div class="cs-dialog-head"><h3>指定陪玩</h3><button class="cs-btn" type="button" data-close-modal>关闭</button></div><label>陪玩<select data-assign-companion>'+cs.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+' / '+esc(p.game||'-')+'</option>'}).join('')+'</select></label><button class="cs-btn primary" type="button" data-do-assign="'+esc(id)+'" '+(!cs.length?'disabled':'')+'>保存</button>')}
  function openStatus(id){var statuses=(state.data&&state.data.orderStatuses)||{};modal('<div class="cs-dialog-head"><h3>修改订单状态</h3><button class="cs-btn" type="button" data-close-modal>关闭</button></div><label>状态<select data-next-status>'+Object.keys(statuses).map(function(k){return '<option value="'+esc(k)+'">'+esc(statuses[k])+'</option>'}).join('')+'</select></label><button class="cs-btn primary" type="button" data-do-status="'+esc(id)+'">保存</button>')}
  function openRefund(id){modal('<div class="cs-dialog-head"><h3>处理退款</h3><button class="cs-btn" type="button" data-close-modal>关闭</button></div><label>处理结果<select data-refund-decision><option value="approve">批准退款</option><option value="reject">拒绝退款</option></select></label><label>拒绝后恢复状态<select data-restore-status><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label><label>备注<textarea data-refund-note required></textarea></label><button class="cs-btn primary" type="button" data-do-refund="'+esc(id)+'">保存</button>')}
  document.addEventListener('click',function(e){var a=e.target.closest('[data-do-assign]');if(a){var val=document.querySelector('[data-assign-companion]').value;api('assign_companion',{id:a.dataset.doAssign,companion_id:val}).then(function(res){toast(res.message||'已指定');a.closest('.cs-modal').remove();return softRefresh()}).catch(function(err){toast(err.message)});return}var s=e.target.closest('[data-do-status]');if(s){var status=document.querySelector('[data-next-status]').value;api('update_order_status',{id:s.dataset.doStatus,status:status}).then(function(res){toast(res.message||'已更新');s.closest('.cs-modal').remove();return softRefresh()}).catch(function(err){toast(err.message)});return}var rf=e.target.closest('[data-do-refund]');if(rf){api('refund_decision',{id:rf.dataset.doRefund,decision:document.querySelector('[data-refund-decision]').value,restore_status:document.querySelector('[data-restore-status]').value,note:document.querySelector('[data-refund-note]').value}).then(function(res){toast(res.message||'已处理');rf.closest('.cs-modal').remove();return softRefresh()}).catch(function(err){toast(err.message)});return}});
  window.__MCJ_CS_DEBUG = state;
  function bootDashboard(){
    if(window.__MCJCsBooted)return;
    window.__MCJCsBooted=true;
    try{init()}catch(e){paintSafeFallback()}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootDashboard);
  else bootDashboard();
})();
