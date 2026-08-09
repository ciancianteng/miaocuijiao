(function(){
  var Auth=window.MCJAdminAuthFetch;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function money(v){
    if(window.MCJCurrency)return window.MCJCurrency.formatPlain(v);
    var n=Number(v||0);return (Number.isFinite(n)?n:0).toFixed(2).replace(/\.00$/,'')+' 猫粮'
  }
  function note(text){return '<div class="admin-final-note">'+esc(text)+'</div>'}
  function statusText(s){return ({awaiting_payment:'待付款',pending:'等待陪玩抢单',claimed:'等待陪玩确认',waiting_boss_confirm:'等待老板选择',confirmed:'进行中',in_progress:'进行中',completed:'已完成',cancelled:'已取消',refund_requested:'售后',refunded:'已退款',after_sale:'售后',reviewed:'已评价'})[s]||s||'-'}
  function get(url){return Auth.get(url)}
  function post(url,body){return Auth.post(url,body)}
  function renderDashboard(){
    var target=document.getElementById('superStats');
    if(!target)return;
    target.innerHTML='<div class="content-loading">正在读取真实统计...</div>';
    get('/api/admin/dashboard').then(function(res){
      if(res.ok===false){
        target.innerHTML=note(res.message||'数据加载失败')+'<button class="mini-btn" type="button" data-admin-final-refresh="dashboard">重试</button>';
        return;
      }
      var s=res.stats||{};
      target.innerHTML=(res.message?note(res.message):'')+'<div class="admin-final-grid">'+[
        ['老板总数',s.bosses||0],['陪玩总数',s.companions||0],['客服总数',s.customerServices||0],['今日有效订单',s.todayOrders||0],['待付款订单',s.awaitingPayment||0],['等待抢单',s.pendingOrders||0],['进行中订单',s.inProgress||0],['已完成订单',s.completed||0],['退款订单',s.refunds||0],['有效营业额',money(s.totalAmount||0)],['今日营业额',money(s.todayAmount||0)],['平台利润',money(s.platformProfit||0)],['提现中/已打款',money(s.withdrawPending||0)+' / '+money(s.withdrawPaid||0)]
      ].map(function(item){return '<article class="admin-final-stat"><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></article>'}).join('')+'</div>';
    }).catch(function(err){
      target.innerHTML=note(err.message||'数据加载失败')+'<button class="mini-btn" type="button" data-admin-final-refresh="dashboard">重试</button>';
    });
  }
  var ORDER_STATUS_OPTIONS=[
    ['awaiting_payment','待付款'],
    ['pending','等待陪玩抢单'],
    ['waiting_boss_confirm','等待老板选择'],
    ['claimed','等待陪玩确认'],
    ['confirmed','进行中'],
    ['in_progress','进行中'],
    ['completed','已完成'],
    ['refund_requested','售后'],
    ['refunded','已退款'],
    ['cancelled','已取消']
  ];
  var ordersById={};
  var orderManagePopover={el:null,anchor:null,orderId:'',bound:false};
  function isUuid(v){
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'').trim());
  }
  function displayOrderNo(o){
    var no=String((o&&(o.orderNo||o.order_no))||'').trim();
    if(no&&!isUuid(no))return no;
    return '—';
  }
  function fmtOrderTime(v){
    var s=String(v||'').trim();
    if(!s||s==='-')return '-';
    var m=s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    if(m)return m[1]+' '+m[2];
    try{
      var d=new Date(s);
      if(isNaN(d.getTime()))return s;
      function p(n){return n<10?'0'+n:String(n)}
      return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());
    }catch(e){return s}
  }
  function orderStatusSelectValue(current){
    var s=String(current||'');
    if(s==='after_sale')return 'refund_requested';
    return s;
  }
  function orderStatusSelect(orderId,current){
    var selected=orderStatusSelectValue(current);
    return '<label class="admin-order-manage-status"><span>更新订单状态（含退款/售后）</span><span class="admin-order-manage-status-row">'+
      '<select class="admin-order-status-select" data-admin-order-status-select="'+esc(orderId)+'" aria-label="订单状态">'+
      ORDER_STATUS_OPTIONS.map(function(opt){
        return '<option value="'+esc(opt[0])+'"'+(String(selected)===opt[0]?' selected':'')+'>'+esc(opt[1])+'</option>';
      }).join('')+
      '</select><button class="mini-btn primary-lite" type="button" data-admin-order-status-apply="'+esc(orderId)+'">更新</button></span></label>';
  }
  function closeOrderManageMenu(){
    if(orderManagePopover.el){
      try{orderManagePopover.el.remove()}catch(e){}
      orderManagePopover.el=null;
    }
    if(orderManagePopover.anchor){
      orderManagePopover.anchor.setAttribute('aria-expanded','false');
      orderManagePopover.anchor.classList.remove('is-open');
    }
    orderManagePopover.anchor=null;
    orderManagePopover.orderId='';
    document.querySelectorAll('[data-admin-order-manage-toggle].is-open').forEach(function(btn){
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded','false');
    });
  }
  function positionOrderManageMenu(){
    var menu=orderManagePopover.el;
    var btn=orderManagePopover.anchor;
    if(!menu||!btn)return;
    var rect=btn.getBoundingClientRect();
    var mw=menu.offsetWidth||220;
    var mh=menu.offsetHeight||280;
    var left=Math.min(Math.max(8,rect.right-mw),window.innerWidth-mw-8);
    var top=rect.bottom+6;
    if(top+mh>window.innerHeight-8)top=Math.max(8,rect.top-mh-6);
    menu.style.left=left+'px';
    menu.style.top=top+'px';
  }
  function buildOrderManageMenuHtml(o,proofByOrder){
    var id=String(o.id||'');
    var st=String(o.status||'');
    var closed=/^(cancelled|refunded)$/i.test(st);
    var done=/^(completed)$/i.test(st);
    var canAssign=!closed&&!done;
    var canUnassign=!!o.companion_id&&!['in_progress','completed','cancelled','refunded'].includes(st);
    var canCancel=!closed&&!done;
    var p=proofByOrder[String(o.id)];
    var items=[];
    items.push('<button type="button" role="menuitem" data-admin-order-detail="'+esc(id)+'">查看订单详情</button>');
    if(p&&p.proofUrl){
      items.push('<button type="button" role="menuitem" data-admin-proof-preview="'+esc(p.proofUrl)+'">查看付款截图</button>');
    }
    if(p){
      items.push('<button type="button" role="menuitem" class="primary-text" data-admin-approve-proof="'+esc(p.orderId||o.id)+'" data-receipt-id="'+esc(p.receiptId||p.id||'')+'">支付审核 · 通过</button>');
      items.push('<button type="button" role="menuitem" data-admin-reject-proof="'+esc(p.orderId||o.id)+'" data-receipt-id="'+esc(p.receiptId||p.id||'')+'">支付审核 · 拒绝</button>');
    }else if(st==='awaiting_payment'){
      items.push('<div class="admin-order-manage-note">待老板上传付款凭证</div>');
    }
    items.push('<div class="admin-order-manage-divider"></div>');
    items.push(orderStatusSelect(id,st));
    items.push('<div class="admin-order-manage-divider"></div>');
    if(!closed){
      items.push('<button type="button" role="menuitem" data-admin-view-grabs="'+esc(id)+'">查看抢单人</button>');
    }
    if(canAssign){
      items.push('<button type="button" role="menuitem" data-admin-assign-grab="'+esc(id)+'">指定陪玩</button>');
    }
    if(canUnassign){
      items.push('<button type="button" role="menuitem" data-admin-unassign="'+esc(id)+'">取消指定</button>');
    }
    if(canCancel){
      items.push('<button type="button" role="menuitem" class="danger-text" data-admin-order-cancel="'+esc(id)+'">取消订单</button>');
    }
    items.push('<button type="button" role="menuitem" class="danger-text" data-admin-order-delete="'+esc(id)+'">删除</button>');
    return items.join('');
  }
  function openOrderManageMenu(anchorBtn){
    var orderId=String(anchorBtn.getAttribute('data-order-id')||'').trim();
    if(!orderId)return;
    if(orderManagePopover.el&&orderManagePopover.orderId===orderId){
      closeOrderManageMenu();
      return;
    }
    closeOrderManageMenu();
    var o=ordersById[orderId];
    if(!o)return;
    var proofByOrder={};
    try{
      (window.__adminPendingProofs||[]).forEach(function(p){if(p.orderId)proofByOrder[String(p.orderId)]=p;});
    }catch(e){}
    var menu=document.createElement('div');
    menu.className='admin-order-manage-popover';
    menu.setAttribute('role','menu');
    menu.setAttribute('data-admin-order-manage-popover','1');
    menu.innerHTML=buildOrderManageMenuHtml(o,proofByOrder);
    document.body.appendChild(menu);
    orderManagePopover.el=menu;
    orderManagePopover.anchor=anchorBtn;
    orderManagePopover.orderId=orderId;
    anchorBtn.setAttribute('aria-expanded','true');
    anchorBtn.classList.add('is-open');
    positionOrderManageMenu();
  }
  function showOrderDetail(orderId){
    var o=ordersById[orderId];
    if(!o){alert('未找到订单');return}
    var lb=document.getElementById('adminProofLightbox');
    if(!lb){
      lb=document.createElement('div');
      lb.id='adminProofLightbox';
      lb.className='admin-proof-lightbox';
      lb.hidden=true;
      document.body.appendChild(lb);
    }
    var rows=[
      ['订单号',displayOrderNo(o)],
      ['订单 UUID',o.id||'-'],
      ['老板',o.bossName||'-'],
      ['老板 UID',o.bossUid||'-'],
      ['服务内容',o.serviceContent||o.game||'-'],
      ['金额',money(o.totalAmount)],
      ['状态',o.statusText||statusText(o.status)],
      ['抢单人数',o.grabCount||0],
      ['已选陪玩',o.companionName||'-'],
      ['创建时间',fmtOrderTime(o.createdAt)],
      ['订单类型',o.orderType||o.type||'-'],
      ['说明',o.description||'-']
    ];
    lb.hidden=false;
    lb.setAttribute('aria-hidden','false');
    lb.innerHTML='<div class="admin-proof-lightbox-card admin-order-detail-card"><div class="admin-proof-lightbox-head"><strong>订单详情</strong><button class="mini-btn" type="button" data-admin-proof-close>关闭</button></div><div class="admin-order-detail-list">'+
      rows.map(function(r){return '<div><span>'+esc(r[0])+'</span><strong>'+esc(r[1])+'</strong></div>'}).join('')+
      '</div></div>';
  }
  function renderOrders(){
    var target=document.getElementById('orderManagement');
    if(!target)return;
    target.innerHTML='<div class="content-loading">正在读取真实订单...</div>';
    Promise.all([
      get('/api/admin/orders'),
      get('/api/admin/finance?action=bootstrap').catch(function(){return {}})
    ]).then(function(pair){
      var res=pair[0]||{};
      var fin=pair[1]||{};
      var rows=res.orders||[];
      var pendingProofs=fin.pendingPaymentProofs||[];
      window.__adminPendingProofs=pendingProofs;
      ordersById={};
      rows.forEach(function(o){if(o&&o.id)ordersById[String(o.id)]=o;});
      var proofByOrder={};
      pendingProofs.forEach(function(p){if(p.orderId)proofByOrder[String(p.orderId)]=p;});
      closeOrderManageMenu();
      var proofPanel='<section class="admin-final-form" style="margin-top:16px"><div class="admin-final-head"><div><h3>支付审核（待处理）</h3><p>查看老板付款截图，审核通过/拒绝后同步订单状态。完整历史见「提现与发放 → 付款凭证中心」。订单行内也可从「管理」进入审核。</p></div></div>'+
        '<div class="admin-final-table-wrap"><table class="admin-final-table"><thead><tr><th>订单号</th><th>老板</th><th>金额</th><th>支付方式</th><th>付款截图</th><th>上传时间</th><th>操作</th></tr></thead><tbody>'+
        (pendingProofs.length?pendingProofs.map(function(r){
          return '<tr><td>'+esc((r.orderNo&&!isUuid(r.orderNo))?r.orderNo:(r.orderId&&!isUuid(r.orderId)?r.orderId:'—'))+'</td><td>'+esc(r.bossName||r.bossUid||'-')+'</td><td>'+esc(r.amount)+'</td><td>'+esc(r.paymentMethod||'-')+'</td><td>'+
            (r.proofUrl?'<button class="mini-btn" type="button" data-admin-proof-preview="'+esc(r.proofUrl)+'"><img src="'+esc(r.proofUrl)+'" alt="付款截图" style="width:56px;height:56px;object-fit:cover;border-radius:8px;display:block"></button>':'无图')+
            '</td><td>'+esc(fmtOrderTime(r.uploadedAt)||'-')+'</td><td><button class="mini-btn primary-lite" type="button" data-admin-approve-proof="'+esc(r.orderId)+'" data-receipt-id="'+esc(r.receiptId||r.id||'')+'">审核通过</button> <button class="mini-btn" type="button" data-admin-reject-proof="'+esc(r.orderId)+'" data-receipt-id="'+esc(r.receiptId||r.id||'')+'">拒绝</button></td></tr>';
        }).join(''):'<tr><td colspan="7"><div class="empty">暂无待审核付款凭证</div></td></tr>')+
        '</tbody></table></div></section>';
      target.innerHTML=(res.message?note(res.message):'')+
        '<div class="admin-final-head"><div><h3>订单管理</h3><p>真实订单：列表保持简洁，点击「管理」展开该笔订单的完整操作（抢单、指定、支付审核、状态、取消/删除）。</p></div><button class="mini-btn" data-admin-final-refresh="orders">刷新</button></div>'+
        proofPanel+
        '<div class="admin-final-table-wrap admin-orders-table-wrap" style="margin-top:16px"><table class="admin-final-table admin-orders-table"><thead><tr><th>订单号</th><th>老板</th><th>服务内容</th><th>金额</th><th>状态</th><th>抢单人数</th><th>已选陪玩</th><th>创建时间</th><th class="admin-orders-col-actions">操作</th></tr></thead><tbody>'+
        (rows.length?rows.map(function(o){
          var hasProof=!!proofByOrder[String(o.id)];
          return '<tr data-order-row="'+esc(o.id)+'"'+(hasProof?' data-has-proof="1"':'')+'>'+
            '<td class="admin-orders-col-no" title="'+esc(displayOrderNo(o))+'"><strong>'+esc(displayOrderNo(o))+'</strong></td>'+
            '<td>'+esc(o.bossName)+'</td>'+
            '<td class="admin-orders-col-service" title="'+esc(o.serviceContent||o.game||'-')+'">'+esc(o.serviceContent||o.game||'-')+'</td>'+
            '<td>'+money(o.totalAmount)+'</td>'+
            '<td>'+esc(o.statusText||statusText(o.status))+'</td>'+
            '<td>'+esc(o.grabCount||0)+'</td>'+
            '<td>'+esc(o.companionName||'-')+'</td>'+
            '<td class="admin-orders-col-time">'+esc(fmtOrderTime(o.createdAt))+'</td>'+
            '<td class="admin-order-actions admin-orders-col-actions">'+
            '<button class="mini-btn admin-order-manage-toggle" type="button" data-admin-order-manage-toggle data-order-id="'+esc(o.id)+'" aria-expanded="false" aria-haspopup="menu">管理 ▼</button>'+
            '</td></tr>';
        }).join(''):'<tr><td colspan="9"><div class="empty">暂无订单</div></td></tr>')+
        '</tbody></table></div><div id="adminProofLightbox" class="admin-proof-lightbox" hidden></div>';
      ensureGrabModalHost();
    }).catch(function(err){target.innerHTML=note(err.message)});
  }
  function grabStatusLabel(s){
    return ({pending_customer_selection:'待老板选择',selected:'已指定',not_selected:'未选中',withdrawn:'已撤回',cancelled:'已取消',rejected:'已拒绝'})[s]||s||'-';
  }
  function onlineStatusLabel(c){
    var raw=String((c&&(c.onlineStatusLabel||c.onlineStatus||c.online_status))||'').trim();
    if(!raw)return '未知';
    if(/online|在线/i.test(raw)&&!/offline|busy|忙碌|离线/i.test(raw))return '在线';
    if(/busy|忙碌/i.test(raw))return '忙碌';
    if(/offline|离线/i.test(raw))return '离线';
    return raw;
  }
  function fmtGrabTime(v){
    if(!v)return '-';
    try{return new Date(v).toLocaleString('zh-CN',{hour12:false})}catch(e){return String(v)}
  }
  function ensureGrabModalHost(){
    var box=document.getElementById('adminOrderGrabModal');
    if(!box){
      box=document.createElement('div');
      box.id='adminOrderGrabModal';
      box.className='admin-grab-modal';
      box.hidden=true;
      box.setAttribute('aria-hidden','true');
      document.body.appendChild(box);
    }else if(!box.classList.contains('admin-grab-modal')){
      box.classList.add('admin-grab-modal');
    }
    return box;
  }
  function closeGrabModal(){
    var box=document.getElementById('adminOrderGrabModal');
    if(!box)return;
    box.hidden=true;
    box.setAttribute('aria-hidden','true');
    box.innerHTML='';
  }
  function companionProfileHref(c){
    var id=String((c&&(c.id||c.companionId||c.user_id||c.uid))||'').trim();
    if(c&&c.detailUrl)return String(c.detailUrl);
    return '/player.html?id='+encodeURIComponent(id);
  }
  function companionPublicId(c){
    return String((c&&(c.companionUid||c.companionCode||c.publicId||c.companion_uid||c.id))||'-');
  }
  function grabCardHtml(orderId,g,mode,designatedId){
    var c=g.companion||{};
    var cid=String(g.companionId||c.id||'');
    var isFinal=!!(designatedId&&cid&&designatedId===cid)||String(g.status||'')==='selected';
    var avatar=c.avatarUrl||c.cardImageUrl
      ?('<img class="admin-grab-avatar" src="'+esc(c.avatarUrl||c.cardImageUrl)+'" alt="">')
      :('<div class="admin-grab-avatar-fallback">'+esc(String(c.nickname||'?').slice(0,1))+'</div>');
    var selectBtn=(mode==='assign'&&cid&&!isFinal)
      ?('<button class="mini-btn primary" type="button" data-admin-confirm-grab="'+esc(orderId)+'" data-companion-id="'+esc(cid)+'" data-from-grabs="1">选择该陪玩</button>')
      :(isFinal?'<span class="admin-sync-note" style="display:inline;margin:0;color:#5ee0a1">已指定</span>':'');
    return '<article class="admin-grab-card'+(isFinal?' is-final':'')+'">'+avatar+
      '<div class="admin-grab-card-body"><strong>'+esc(c.nickname||'陪玩')+(g.bossPreferred?' · 老板意向':'')+'</strong>'+
      '<p>陪玩 ID '+esc(companionPublicId(c))+' · 等级 '+esc(c.level||c.levelName||'-')+'</p>'+
      '<p>游戏/服务 '+esc(c.mainGame||c.game||c.mainService||'-')+' · 价格 '+money(c.price||0)+'</p>'+
      '<p>在线状态 '+esc(onlineStatusLabel(c))+' · 抢单 '+esc(grabStatusLabel(g.status))+' · '+esc(fmtGrabTime(g.grabbedAt||g.grabbed_at))+'</p>'+
      '<div class="admin-grab-actions">'+
      '<a class="mini-btn" href="'+esc(companionProfileHref(c))+'" target="_blank" rel="noopener">查看资料</a>'+
      selectBtn+
      (c.voiceUrl?'<a class="mini-btn" href="'+esc(c.voiceUrl)+'" target="_blank" rel="noopener">试听</a>':'')+
      '</div></div></article>';
  }
  function playerCardHtml(orderId,p){
    var profileId=String(p.user_id||p.uid||p.userId||'').trim();
    if(!profileId)return '';
    var nick=p.nickname||p.name||'陪玩';
    var avatar=p.avatar_url||p.avatar||p.card_image_url
      ?('<img class="admin-grab-avatar" src="'+esc(p.avatar_url||p.avatar||p.card_image_url)+'" alt="">')
      :('<div class="admin-grab-avatar-fallback">'+esc(String(nick).slice(0,1))+'</div>');
    var pub=p.companionUid||p.companion_uid||p.companionCode||p.publicId||profileId;
    return '<article class="admin-grab-card" data-admin-player-row data-name="'+esc(String(nick).toLowerCase())+'" data-code="'+esc(String(pub).toLowerCase())+'" data-id="'+esc(profileId.toLowerCase())+'">'+avatar+
      '<div class="admin-grab-card-body"><strong>'+esc(nick)+'</strong>'+
      '<p>陪玩 ID '+esc(pub)+' · 等级 '+esc(p.levelName||p.level_name||p.level||'-')+'</p>'+
      '<p>游戏/服务 '+esc(p.mainGame||p.game||p.mainService||p.main_service||'-')+' · 价格 '+money(p.price||0)+'</p>'+
      '<p>在线状态 '+esc(onlineStatusLabel(p))+' · 审核 '+esc(p.auditStatus||p.applicationStatus||'-')+'</p>'+
      '<div class="admin-grab-actions">'+
      '<a class="mini-btn" href="/player.html?id='+encodeURIComponent(profileId)+'" target="_blank" rel="noopener">查看资料</a>'+
      '<button class="mini-btn primary" type="button" data-admin-confirm-grab="'+esc(orderId)+'" data-companion-id="'+esc(profileId)+'" data-from-grabs="0">选择该陪玩</button>'+
      '</div></div></article>';
  }
  function isPublicHallOrder(order){
    var st=String((order&&(order.status||''))||'');
    var cid=String((order&&(order.companion_id||order.companionId))||'').trim();
    return (st==='pending'||st==='waiting_boss_confirm')&&!cid;
  }
  function approvedPlayers(list){
    return (list||[]).filter(function(p){
      var audit=String(p.auditStatus||p.applicationStatus||p.verification_status||p.application_status||'').toLowerCase();
      var allow=p.allowOrders!==false&&p.allow_orders!==false;
      var approved=/approved|已通过|verified|passed/.test(audit)||p.auditStatus==='已通过';
      return approved&&allow&&String(p.user_id||p.uid||p.userId||'').trim();
    });
  }
  function paintGrabModal(orderId,mode,res,players){
    var box=ensureGrabModalHost();
    var grabs=res.grabs||[];
    var intent=res.bossIntent||null;
    var order=res.order||{};
    var designatedId=String(order.companion_id||order.companionId||'');
    var hall=isPublicHallOrder(order);
    var title=mode==='assign'?'指定陪玩':'查看抢单人';
    var meta='订单 '+esc(order.orderNo||orderId)+
      ' · 状态 '+esc(order.statusText||statusText(order.status))+
      (intent?' · 老板意向：'+esc(intent.companionName||intent.companionId):'')+
      (designatedId?' · 已指定：'+esc(order.companionName||designatedId):' · 尚未指定');
    var body='';
    if(mode==='view'){
      body=grabs.length
        ?('<div><h4 style="margin:0 0 8px;color:#fff">抢单陪玩（'+grabs.length+'）</h4>'+grabs.map(function(g){return grabCardHtml(orderId,g,'view',designatedId)}).join('')+'</div>')
        :'<div class="admin-grab-empty" data-admin-grabs-empty>暂无抢单人</div>';
    }else{
      var grabBlock=grabs.length
        ?('<div><h4 style="margin:0 0 8px;color:#fff">已抢单陪玩（'+grabs.length+'）</h4><p class="admin-assign-hint">公开抢单订单请从抢单人中确认指定；确认后写入订单并进入待陪玩确认。</p>'+
          grabs.map(function(g){return grabCardHtml(orderId,g,'assign',designatedId)}).join('')+'</div>')
        :'<div class="admin-grab-empty" data-admin-grabs-empty>暂无抢单人</div>';
      var freeBlock='';
      if(hall){
        freeBlock='<p class="admin-assign-hint">公开抢单路径不支持直接指定任意陪玩。请从上方抢单人中选择，或走 VIP 指定下单。</p>';
      }else{
        var approved=approvedPlayers(players||[]);
        freeBlock='<hr style="border:0;border-top:1px solid rgba(255,255,255,.1);margin:14px 0">'+
          '<h4 style="margin:0 0 8px;color:#fff">可用/已审核陪玩</h4>'+
          '<input class="admin-assign-search" type="search" data-admin-assign-search placeholder="搜索昵称 / 陪玩 ID / UUID" autocomplete="off">'+
          '<div class="admin-assign-picker-list" data-admin-assign-picker>'+
          (approved.length?approved.map(function(p){return playerCardHtml(orderId,p)}).join(''):'<div class="admin-grab-empty">暂无可用陪玩</div>')+
          '</div>'+
          '<p class="admin-assign-hint">指定将真实写入订单 companion，与客服端同源。</p>';
      }
      body=grabBlock+freeBlock;
    }
    box.hidden=false;
    box.setAttribute('aria-hidden','false');
    box.innerHTML='<div class="admin-grab-modal-card" role="dialog" aria-modal="true" aria-label="'+esc(title)+'">'+
      '<div class="admin-grab-modal-head"><div><h3>'+esc(title)+'</h3><p>'+meta+'</p></div>'+
      '<button class="mini-btn" type="button" data-admin-close-grabs>关闭</button></div>'+body+'</div>';
  }
  function showGrabModal(orderId,mode){
    var box=ensureGrabModalHost();
    box.hidden=false;
    box.setAttribute('aria-hidden','false');
    box.innerHTML='<div class="admin-grab-modal-card"><div class="content-loading">'+(mode==='assign'?'加载陪玩选择器...':'加载抢单人...')+'</div></div>';
    var grabsReq=post('/api/admin/orders',{action:'list_grabs',id:orderId});
    var playersReq=mode==='assign'
      ?get('/api/admin/players').catch(function(){return {players:[]}})
      :Promise.resolve({players:[]});
    Promise.all([grabsReq,playersReq]).then(function(pair){
      paintGrabModal(orderId,mode,pair[0]||{},(pair[1]&&pair[1].players)||[]);
    }).catch(function(err){
      box.innerHTML='<div class="admin-grab-modal-card"><div class="admin-final-head"><div><h3>加载失败</h3></div><button class="mini-btn" type="button" data-admin-close-grabs>关闭</button></div>'+note(err.message||'加载失败')+'</div>';
    });
  }
  function renderReports(){
    /* 提现与发薪由 src/admin-finance.js 接管 #serviceReportsManagement */
    if(window.MCJAdminFinance&&typeof window.MCJAdminFinance.reload==='function'){
      window.MCJAdminFinance.reload();
    }
  }
  function reportStatus(s){return ({pending:'待审核',approved:'已批准',rejected:'已拒绝',paid:'已支付'})[s]||s||'-'}
  function renderContent(){get('/api/admin/content').then(function(res){renderAnnouncements(res)}).catch(function(err){var a=document.getElementById('table-announcements');if(a)a.innerHTML=note(err.message)})}
  function toDatetimeLocal(value){
    if(!value)return '';
    try{
      var d=new Date(value);
      if(Number.isNaN(d.getTime()))return '';
      var pad=function(n){return String(n).padStart(2,'0')};
      return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
    }catch(e){return ''}
  }
  function categoryLabel(v){return ({companion:'陪玩公告',customer_service:'客服公告',homepage_only:'仅首页',home:'首页公告（首页/老板端）'})[v]||v||'首页公告'}
  function audienceLabel(v){
    return ({home:'首页',boss:'老板端',companion:'陪玩端',customer_service:'客服端',all:'全平台'})[v]||v||'首页';
  }
  function renderAnnouncements(res){
    var target=document.getElementById('table-announcements');
    if(!target)return;
    var rows=res.announcements||[];
    target.innerHTML=(res.message?note(res.message):'')+
      '<div class="admin-final-head"><div><h3>公告管理</h3><p>按分类发布：首页公告=首页/老板端；【仅首页】只上官网首页、不影响其它端；陪玩/客服公告各自独立。保存后实时生效。</p></div></div>'+
      '<form class="admin-final-form" data-announcement-form>'+
        '<input type="hidden" name="id">'+
        '<label>公告分类<select name="category" required><option value="home" selected>首页公告（首页/老板端）</option><option value="homepage_only">仅首页</option><option value="companion">陪玩公告（仅陪玩端）</option><option value="customer_service">客服公告</option></select></label>'+
        '<label>公告类型<select name="kind"><option value="normal" selected>普通公告</option><option value="forced">强制阅读公告</option></select></label>'+
        '<label>发布对象（预留）<select name="audience"><option value="home" selected>首页</option><option value="boss">老板端</option><option value="companion">陪玩端</option><option value="customer_service">客服端</option><option value="all">全平台</option></select></label>'+
        '<label>标题<input name="title" required placeholder="例如：平台维护通知"></label>'+
        '<label>排序<input name="sort_order" type="number" min="0" step="1" value="100" placeholder="数字越小越靠前"></label>'+
        '<label>开始时间<input name="start_at" type="datetime-local"></label>'+
        '<label>结束时间<input name="end_at" type="datetime-local"></label>'+
        '<label>发布时间<input name="published_at" type="datetime-local"></label>'+
        '<label class="admin-switch-field"><span class="admin-field-label">是否置顶</span><select name="is_pinned" data-admin-control="switch"><option value="true">置顶</option><option value="false" selected>不置顶</option></select></label>'+
        '<label class="admin-switch-field"><span class="admin-field-label">是否滚动</span><select name="is_scrolling" data-admin-control="switch"><option value="true" selected>滚动</option><option value="false">不滚动（省略）</option></select></label>'+
        '<label class="admin-switch-field"><span class="admin-field-label">是否启用</span><select name="is_active" data-admin-control="switch"><option value="true" selected>启用</option><option value="false">停用</option></select></label>'+
        '<label class="wide">内容<textarea name="content" required placeholder="公告正文"></textarea></label>'+
        '<button class="primary-btn" type="submit">保存公告</button>'+
        '<button class="mini-btn" type="button" data-announcement-reset>清空表单</button>'+
      '</form>'+
      '<div class="admin-final-table-wrap"><table class="admin-final-table"><thead><tr><th>分类</th><th>对象</th><th>标题</th><th>内容</th><th>时间窗</th><th>排序</th><th>置顶</th><th>滚动</th><th>启用</th><th>操作</th></tr></thead><tbody>'+
      (rows.length?rows.map(function(r){
        var windowText=(r.start_at||'-')+' ~ '+(r.end_at||'-');
        return '<tr>'+
          '<td>'+esc(categoryLabel(r.category))+'</td>'+
          '<td>'+esc(audienceLabel(r.audience))+'</td>'+
          '<td>'+esc(r.title||'-')+'</td>'+
          '<td>'+esc(r.content||'-')+'</td>'+
          '<td>'+esc(windowText)+'</td>'+
          '<td>'+esc(r.sort_order==null?100:r.sort_order)+'</td>'+
          '<td>'+esc(r.is_pinned?'是':'否')+'</td>'+
          '<td>'+esc(r.is_scrolling===false?'否':'是')+'</td>'+
          '<td>'+esc(r.is_active===false?'停用':'启用')+'</td>'+
          '<td><button class="mini-btn" data-edit-announcement="'+encodeURIComponent(JSON.stringify(r))+'">编辑</button>'+
          '<button class="mini-btn danger" data-delete-announcement="'+esc(r.id)+'">删除</button></td></tr>';
      }).join(''):'<tr><td colspan="10"><div class="empty">暂无公告</div></td></tr>')+
      '</tbody></table></div>';
    if(window.MCJAdminForms&&window.MCJAdminForms.enhance)window.MCJAdminForms.enhance(target);
    var catSel=target.querySelector('[name="category"]');
    var audSel=target.querySelector('[name="audience"]');
    if(catSel&&audSel&&!catSel.dataset.bound){
      catSel.dataset.bound='1';
      catSel.addEventListener('change',function(){
        if(catSel.value==='companion')audSel.value='companion';
        else if(catSel.value==='customer_service')audSel.value='customer_service';
        else if(catSel.value==='homepage_only')audSel.value='home';
        else if(audSel.value==='companion'||audSel.value==='customer_service')audSel.value='home';
      });
    }
  }
  function fileToDataUrl(file){return new Promise(function(resolve,reject){if(!file)return resolve('');var reader=new FileReader();reader.onload=function(){resolve(reader.result||'')};reader.onerror=function(){reject(new Error('图片读取失败'))};reader.readAsDataURL(file)})}
  document.addEventListener('submit',function(e){
    if(e.target.matches('[data-announcement-form]')){
      e.preventDefault();
      var ad=new FormData(e.target);
      post('/api/admin/content',{
        action:'save_announcement',
        announcement:{
          id:ad.get('id'),
          kind:ad.get('kind')||'normal',
          requires_ack:String(ad.get('kind')||'')==='forced',
          category:ad.get('category')||'home',
          audience:ad.get('audience')||(ad.get('category')==='companion'?'companion':'home'),
          title:ad.get('title'),
          content:ad.get('content'),
          start_at:ad.get('start_at'),
          end_at:ad.get('end_at'),
          published_at:ad.get('published_at')||ad.get('start_at'),
          sort_order:ad.get('sort_order')||100,
          is_pinned:ad.get('is_pinned')==='true',
          is_scrolling:ad.get('is_scrolling')!=='false',
          is_active:ad.get('is_active')==='true'
        }
      }).then(function(res){
        alert(res.message||'已保存');
        e.target.reset();
        e.target.elements.id.value='';
        if(e.target.elements.kind)e.target.elements.kind.value='normal';
        if(e.target.elements.category)e.target.elements.category.value='home';
        if(e.target.elements.audience)e.target.elements.audience.value='home';
        if(e.target.elements.sort_order)e.target.elements.sort_order.value='100';
        if(e.target.elements.is_scrolling)e.target.elements.is_scrolling.value='true';
        renderContent();
      }).catch(function(err){alert(err.message)});
      return;
    }
  });
  function bindOrderManageChrome(){
    if(orderManagePopover.bound)return;
    orderManagePopover.bound=true;
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&orderManagePopover.orderId)closeOrderManageMenu();
    });
    window.addEventListener('resize',function(){
      if(orderManagePopover.orderId)closeOrderManageMenu();
    });
    window.addEventListener('scroll',function(){
      if(orderManagePopover.orderId)closeOrderManageMenu();
    },true);
  }
  bindOrderManageChrome();
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-admin-final-refresh="orders"]'))renderOrders();
    if(e.target.closest('[data-admin-final-refresh="reports"]'))renderReports();
    if(e.target.closest('[data-admin-final-refresh="dashboard"]'))renderDashboard();
    var manageToggle=e.target.closest('[data-admin-order-manage-toggle]');
    if(manageToggle){
      e.preventDefault();
      e.stopPropagation();
      openOrderManageMenu(manageToggle);
      return;
    }
    var detailBtn=e.target.closest('[data-admin-order-detail]');
    if(detailBtn){
      closeOrderManageMenu();
      showOrderDetail(detailBtn.getAttribute('data-admin-order-detail'));
      return;
    }
    var proofPrev=e.target.closest('[data-admin-proof-preview]');
    if(proofPrev){
      closeOrderManageMenu();
      var lb=document.getElementById('adminProofLightbox');
      if(lb){
        lb.hidden=false;
        lb.setAttribute('aria-hidden','false');
        lb.innerHTML='<div class="admin-proof-lightbox-card"><div class="admin-proof-lightbox-head"><strong>付款截图</strong><button class="mini-btn" type="button" data-admin-proof-close>关闭</button></div><img src="'+esc(proofPrev.dataset.adminProofPreview)+'" alt="付款截图"></div>';
      } else {
        window.open(proofPrev.dataset.adminProofPreview,'_blank');
      }
      return;
    }
    if(e.target.closest('[data-admin-proof-close]')||(e.target.id==='adminProofLightbox')||e.target.classList.contains('admin-proof-lightbox')){
      var lb2=document.getElementById('adminProofLightbox');
      if(lb2){
        lb2.hidden=true;
        lb2.setAttribute('aria-hidden','true');
        lb2.innerHTML='';
      }
      return;
    }
    var ap=e.target.closest('[data-admin-approve-proof]');
    if(ap){
      if(!confirm('确认审核通过该付款凭证？将同步更新订单状态。'))return;
      closeOrderManageMenu();
      post('/api/admin/finance',{action:'approve_payment_proof',orderId:ap.dataset.adminApproveProof,receiptId:ap.dataset.receiptId||''}).then(function(res){alert(res.message||'已通过');renderOrders();}).catch(function(err){alert(err.message)});
      return;
    }
    var rp=e.target.closest('[data-admin-reject-proof]');
    if(rp){
      var reason=prompt('请填写拒绝原因（必填）','');
      if(reason==null)return;
      reason=String(reason||'').trim();
      if(!reason){alert('必须填写拒绝原因');return;}
      closeOrderManageMenu();
      post('/api/admin/finance',{action:'reject_payment_proof',orderId:rp.dataset.adminRejectProof,receiptId:rp.dataset.receiptId||'',reason:reason}).then(function(res){alert(res.message||'已拒绝');renderOrders();}).catch(function(err){alert(err.message)});
      return;
    }
    var vg=e.target.closest('[data-admin-view-grabs]');
    if(vg){closeOrderManageMenu();showGrabModal(vg.dataset.adminViewGrabs,'view');return;}
    var ag=e.target.closest('[data-admin-assign-grab]');
    if(ag){closeOrderManageMenu();showGrabModal(ag.dataset.adminAssignGrab,'assign');return;}
    if(e.target.closest('[data-admin-close-grabs]')||e.target.id==='adminOrderGrabModal'||(e.target.classList&&e.target.classList.contains('admin-grab-modal'))){
      closeGrabModal();
      return;
    }
    var cg=e.target.closest('[data-admin-confirm-grab]');
    if(cg){
      var fromGrabs=String(cg.dataset.fromGrabs||'1')!=='0';
      var label=fromGrabs?'确认指定该抢单陪玩？\n\n确认后订单离开抢单大厅，正式发送给该陪玩等待确认接单；其他抢单陪玩将无法再抢。':'确定指定该陪玩？\n\n指定后将真实写入订单，陪玩端进入待确认。';
      if(!confirm(label))return;
      cg.disabled=true;
      var prevText=cg.textContent;
      cg.textContent='指定中…';
      var action=fromGrabs?'confirm_grab_assignment':'assign_companion';
      post('/api/admin/orders',{action:action,id:cg.dataset.adminConfirmGrab,companion_id:cg.dataset.companionId,from_grabs:!!fromGrabs}).then(function(res){
        alert(res.message||'指定成功');
        closeGrabModal();
        renderOrders();
      }).catch(function(err){
        cg.disabled=false;
        cg.textContent=prevText||'选择该陪玩';
        alert(err.message||'指定失败');
      });
      return;
    }
    var ua=e.target.closest('[data-admin-unassign]');
    if(ua&&confirm('确认取消指定？\n\n将清除订单已指定陪玩，四端同步恢复未指定/返回抢单。')){
      ua.disabled=true;
      closeOrderManageMenu();
      post('/api/admin/orders',{action:'unassign_companion',id:ua.dataset.adminUnassign}).then(function(res){
        alert(res.message||'已取消指定');
        renderOrders();
      }).catch(function(err){ua.disabled=false;alert(err.message)});
      return;
    }
    if(e.target.closest('[data-announcement-reset]')){
      var rf=document.querySelector('[data-announcement-form]');
      if(rf){
        rf.reset();
        rf.elements.id.value='';
        if(rf.elements.category)rf.elements.category.value='home';
        if(rf.elements.audience)rf.elements.audience.value='home';
        if(rf.elements.sort_order)rf.elements.sort_order.value='100';
        if(rf.elements.is_scrolling)rf.elements.is_scrolling.value='true';
      }
      return;
    }
    var os=e.target.closest('[data-admin-order-status-apply]');
    if(os){
      var oid=os.dataset.adminOrderStatusApply;
      var sel=
        (orderManagePopover.el&&orderManagePopover.el.querySelector('[data-admin-order-status-select="'+oid+'"]'))||
        document.querySelector('[data-admin-order-status-select="'+oid+'"]');
      var status=sel?String(sel.value||'').trim():'';
      if(!status){alert('请先选择状态');return}
      if(!confirm('确认将订单状态更新为「'+(sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].text:status)+'」？'))return;
      closeOrderManageMenu();
      post('/api/admin/orders',{action:'update_status',id:oid,status:status}).then(renderOrders).catch(function(err){alert(err.message)});
      return;
    }
    var legacyOs=e.target.closest('[data-admin-order-status]');
    if(legacyOs){
      alert('请使用状态下拉框选择，禁止手输状态。');
      return;
    }
    var oc=e.target.closest('[data-admin-order-cancel]');
    if(oc&&confirm('确认取消该订单？')){
      closeOrderManageMenu();
      post('/api/admin/orders',{action:'cancel',id:oc.dataset.adminOrderCancel}).then(renderOrders).catch(function(err){alert(err.message)});
      return;
    }
    var od=e.target.closest('[data-admin-order-delete]');
    if(od&&confirm('确认永久删除订单？\n将同时删除订单、相关聊天与缓存。真实订单会记入操作日志。')){
      closeOrderManageMenu();
      post('/api/admin/orders',{action:'delete',id:od.dataset.adminOrderDelete}).then(function(res){alert(res.message||'已删除');renderOrders();}).catch(function(err){alert(err.message)});
      return;
    }
    if(orderManagePopover.orderId){
      var inPopover=e.target.closest('.admin-order-manage-popover');
      var inToggle=e.target.closest('[data-admin-order-manage-toggle]');
      if(!inPopover&&!inToggle)closeOrderManageMenu();
    }
    var rr=e.target.closest('[data-report-review]');
    if(rr){
      var noteText=prompt('审核备注')||'';
      post('/api/reports',{id:rr.dataset.reportReview,status:rr.dataset.status,admin_note:noteText}).then(renderReports).catch(function(err){alert(err.message)});
      return;
    }
    var ea=e.target.closest('[data-edit-announcement]');
    if(ea){
      var a=JSON.parse(decodeURIComponent(ea.dataset.editAnnouncement));
      var af=document.querySelector('[data-announcement-form]');
      if(af){
        af.elements.id.value=a.id||'';
        if(af.elements.category)af.elements.category.value=a.category==='companion'?'companion':'home';
        if(af.elements.kind)af.elements.kind.value=a.kind==='forced'?'forced':'normal';
        if(af.elements.audience)af.elements.audience.value=a.audience||(a.category==='companion'?'companion':'home');
        af.elements.title.value=a.title||'';
        af.elements.content.value=a.content||'';
        if(af.elements.sort_order)af.elements.sort_order.value=a.sort_order==null?100:a.sort_order;
        if(af.elements.start_at)af.elements.start_at.value=toDatetimeLocal(a.start_at||'');
        if(af.elements.end_at)af.elements.end_at.value=toDatetimeLocal(a.end_at||'');
        af.elements.published_at.value=toDatetimeLocal(a.published_at||a.created_at||'');
        af.elements.is_pinned.value=a.is_pinned?'true':'false';
        if(af.elements.is_scrolling)af.elements.is_scrolling.value=a.is_scrolling===false?'false':'true';
        af.elements.is_active.value=a.is_active===false?'false':'true';
        if(window.MCJAdminForms&&window.MCJAdminForms.enhance)window.MCJAdminForms.enhance(af);
        af.elements.is_pinned.dispatchEvent(new Event('change',{bubbles:true}));
        if(af.elements.is_scrolling)af.elements.is_scrolling.dispatchEvent(new Event('change',{bubbles:true}));
        af.elements.is_active.dispatchEvent(new Event('change',{bubbles:true}));
        af.scrollIntoView({block:'nearest'});
      }
      return;
    }
    var da=e.target.closest('[data-delete-announcement]');
    if(da&&confirm('确认删除公告？'))post('/api/admin/content',{action:'delete_announcement',id:da.dataset.deleteAnnouncement}).then(renderContent).catch(function(err){alert(err.message)});
  });
  document.addEventListener('input',function(e){
    var search=e.target.closest('[data-admin-assign-search]');
    if(!search)return;
    var q=String(search.value||'').trim().toLowerCase();
    var box=document.getElementById('adminOrderGrabModal');
    if(!box)return;
    box.querySelectorAll('[data-admin-player-row]').forEach(function(row){
      if(!q){row.hidden=false;return;}
      var hay=((row.dataset.name||'')+' '+(row.dataset.code||'')+' '+(row.dataset.id||'')).toLowerCase();
      row.hidden=hay.indexOf(q)<0;
    });
  });
  document.addEventListener('DOMContentLoaded',function(){if(!Auth)return;Auth.ensureValidToken().then(function(){ensureGrabModalHost();renderDashboard();renderOrders();renderReports();renderContent()}).catch(function(){})});
})();
