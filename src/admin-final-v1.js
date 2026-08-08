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
  var orderUiState={filter:'all',q:'',orders:[],pendingProofs:[],message:'',companionsCache:null};

  function orderStatusSelectValue(current){
    var s=String(current||'');
    if(s==='after_sale')return 'refund_requested';
    return s;
  }
  function companionLabel(o){
    var name=String(o.companionName||'').trim();
    var code=String(o.companionCode||o.playerUid||'').trim();
    if(code==='-'||code===o.companion_id)code='';
    if(!name||name==='-')return code||'-';
    if(code&&name.indexOf(code)<0)return name+' · '+code;
    return name;
  }
  function onlineLabel(c){
    var raw=String((c&&(c.onlineStatusLabel||c.onlineStatus||c.online_status))||'').toLowerCase();
    if(/online|在线可接|接单中/.test(raw))return '在线';
    if(/busy|服务中/.test(raw))return '忙碌';
    if(/rest|休息/.test(raw))return '休息';
    if(/offline|离线/.test(raw))return '离线';
    return (c&&(c.onlineStatusLabel||c.onlineStatus))||'-';
  }
  function proofThumbHtml(url){
    if(!url)return '<span class="admin-om-muted">无图</span>';
    return '<button class="admin-om-proof-thumb" type="button" data-admin-proof-preview="'+esc(url)+'" title="点击放大">'+
      '<img src="'+esc(url)+'" alt="付款截图" data-mcj-pay-proof="1" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.parentNode.insertAdjacentHTML(\'beforeend\',\'<span class=admin-om-muted>截图加载失败</span>\')">'+
      '</button>';
  }
  function orderActionsHtml(o){
    var st=String(o.status||'');
    var id=esc(o.id);
    var parts=[];
    if(st==='pending'||st==='waiting_boss_confirm'){
      parts.push('<button class="mini-btn" type="button" data-admin-view-grabs="'+id+'">查看抢单人'+(Number(o.grabCount||0)?' ('+esc(o.grabCount)+')':'')+'</button>');
      parts.push('<button class="mini-btn primary-lite" type="button" data-admin-assign-grab="'+id+'">指定陪玩</button>');
      if(o.companion_id)parts.push('<button class="mini-btn" type="button" data-admin-unassign="'+id+'">取消指定</button>');
    }else if(st==='claimed'){
      parts.push('<button class="mini-btn" type="button" data-admin-view-order="'+id+'">查看订单</button>');
      parts.push('<button class="mini-btn" type="button" data-admin-assign-grab="'+id+'">更换陪玩</button>');
      if(o.companion_id)parts.push('<button class="mini-btn" type="button" data-admin-unassign="'+id+'">取消指定</button>');
    }else if(st==='confirmed'||st==='in_progress'){
      parts.push('<button class="mini-btn" type="button" data-admin-view-order="'+id+'">查看订单</button>');
    }else if(st==='completed'||st==='reviewed'){
      parts.push('<button class="mini-btn" type="button" data-admin-view-order="'+id+'">查看详情</button>');
    }else if(st==='refund_requested'||st==='refunded'||st==='after_sale'){
      parts.push('<button class="mini-btn" type="button" data-admin-view-order="'+id+'">查看售后</button>');
    }else if(st==='cancelled'){
      parts.push('<button class="mini-btn" type="button" data-admin-view-order="'+id+'">查看详情</button>');
    }else if(st==='awaiting_payment'){
      parts.push('<button class="mini-btn" type="button" data-admin-view-order="'+id+'">查看订单</button>');
    }else{
      parts.push('<button class="mini-btn" type="button" data-admin-view-order="'+id+'">查看订单</button>');
    }
    if(st!=='completed'&&st!=='reviewed'&&st!=='cancelled'&&st!=='refunded'){
      parts.push('<button class="mini-btn danger" type="button" data-admin-order-cancel="'+id+'">取消</button>');
    }
    return parts.join('');
  }
  function filterOrders(rows){
    var q=String(orderUiState.q||'').trim().toLowerCase();
    var filter=String(orderUiState.filter||'all');
    return (rows||[]).filter(function(o){
      if(filter!=='all'&&String(o.status||'')!==filter)return false;
      if(!q)return true;
      var blob=[o.orderNo,o.id,o.bossName,o.bossUid,o.companionName,o.companionCode,o.serviceContent,o.game].join(' ').toLowerCase();
      return blob.indexOf(q)>=0;
    });
  }
  function paintOrders(){
    var target=document.getElementById('orderManagement');
    if(!target)return;
    var rows=filterOrders(orderUiState.orders);
    var pendingProofs=orderUiState.pendingProofs||[];
    var filterOpts=[['all','全部']].concat(ORDER_STATUS_OPTIONS).map(function(opt){
      return '<option value="'+esc(opt[0])+'"'+(String(orderUiState.filter)===opt[0]?' selected':'')+'>'+esc(opt[1])+'</option>';
    }).join('');
    var proofRows=pendingProofs.length?pendingProofs.map(function(r){
      return '<tr>'+
        '<td><code class="admin-om-code">'+esc(r.orderNo||r.orderId||'-')+'</code></td>'+
        '<td>'+esc(r.bossName||r.bossUid||'-')+'</td>'+
        '<td>'+esc(money(r.amount))+'</td>'+
        '<td>'+esc(r.paymentMethod||'-')+'</td>'+
        '<td>'+proofThumbHtml(r.proofUrl)+'</td>'+
        '<td>'+esc(r.uploadedAt||'-')+'</td>'+
        '<td class="admin-order-actions">'+
          '<button class="mini-btn primary-lite" type="button" data-admin-approve-proof="'+esc(r.orderId)+'" data-receipt-id="'+esc(r.receiptId||r.id||'')+'">审核通过</button>'+
          '<button class="mini-btn" type="button" data-admin-reject-proof="'+esc(r.orderId)+'" data-receipt-id="'+esc(r.receiptId||r.id||'')+'">拒绝</button>'+
        '</td></tr>';
    }).join(''):'<tr><td colspan="7"><div class="empty">暂无待审核付款凭证</div></td></tr>';

    var orderRows=rows.length?rows.map(function(o){
      return '<tr data-order-row="'+esc(o.id)+'">'+
        '<td><code class="admin-om-code">'+esc(o.orderNo||o.id)+'</code></td>'+
        '<td>'+esc(o.bossName||'-')+'</td>'+
        '<td class="admin-om-wrap">'+esc(o.serviceContent||o.game||'-')+'</td>'+
        '<td>'+money(o.totalAmount)+'</td>'+
        '<td><span class="admin-om-status" data-st="'+esc(o.status)+'">'+esc(o.statusText||statusText(o.status))+'</span></td>'+
        '<td>'+esc(o.grabCount||0)+'</td>'+
        '<td class="admin-om-wrap">'+esc(companionLabel(o))+'</td>'+
        '<td>'+esc(o.createdAt||'-')+'</td>'+
        '<td class="admin-order-actions">'+orderActionsHtml(o)+'</td></tr>';
    }).join(''):'<tr><td colspan="9"><div class="empty">没有符合条件的订单</div></td></tr>';

    target.innerHTML=(orderUiState.message?note(orderUiState.message):'')+
      '<div class="admin-om">'+
        '<div class="admin-om-toolbar">'+
          '<div><h3>订单管理</h3><p>支付审核与全部订单分区展示；抢单/指定为真实接口。</p></div>'+
          '<div class="admin-om-tools">'+
            '<label class="admin-om-field">状态<select data-admin-order-filter>'+filterOpts+'</select></label>'+
            '<label class="admin-om-field">搜索<input data-admin-order-search type="search" placeholder="订单号 / 老板 / 陪玩" value="'+esc(orderUiState.q)+'"></label>'+
            '<button class="mini-btn" type="button" data-admin-final-refresh="orders">刷新</button>'+
          '</div>'+
        '</div>'+
        '<section class="admin-om-panel">'+
          '<div class="admin-om-panel-head"><h4>待支付审核</h4><span>'+esc(pendingProofs.length)+' 单</span></div>'+
          '<div class="admin-om-table-wrap"><table class="admin-om-table admin-om-proof-table"><thead><tr>'+
            '<th>订单号</th><th>老板</th><th>金额</th><th>支付方式</th><th>付款截图</th><th>上传时间</th><th>操作</th>'+
          '</tr></thead><tbody>'+proofRows+'</tbody></table></div>'+
        '</section>'+
        '<section class="admin-om-panel">'+
          '<div class="admin-om-panel-head"><h4>全部订单</h4><span>显示 '+esc(rows.length)+' / '+esc((orderUiState.orders||[]).length)+'</span></div>'+
          '<div class="admin-om-table-wrap"><table class="admin-om-table admin-om-orders-table"><thead><tr>'+
            '<th>订单号</th><th>老板</th><th>服务内容</th><th>金额</th><th>订单状态</th><th>抢单人数</th><th>已选陪玩</th><th>创建时间</th><th>操作</th>'+
          '</tr></thead><tbody>'+orderRows+'</tbody></table></div>'+
        '</section>'+
      '</div>';
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
      orderUiState.orders=res.orders||[];
      orderUiState.pendingProofs=fin.pendingPaymentProofs||[];
      orderUiState.message=res.message||'';
      paintOrders();
    }).catch(function(err){target.innerHTML=note(err.message||'订单加载失败')});
  }
  function grabStatusLabel(s){
    return ({pending_customer_selection:'待老板选择',selected:'已指定',not_selected:'未选中',withdrawn:'已撤回',cancelled:'已取消',rejected:'已拒绝'})[s]||s||'-';
  }
  function fmtGrabTime(v){
    if(!v)return '-';
    try{return new Date(v).toLocaleString('zh-CN',{hour12:false})}catch(e){return String(v)}
  }
  function ensureModalShell(){
    var box=document.getElementById('adminOrderGrabModal');
    if(!box){
      box=document.createElement('div');
      box.id='adminOrderGrabModal';
      box.className='admin-om-modal';
      box.hidden=true;
      document.body.appendChild(box);
    }
    return box;
  }
  function closeGrabModal(){
    var box=document.getElementById('adminOrderGrabModal');
    if(box){box.hidden=true;box.innerHTML='';box.classList.remove('is-open')}
  }
  function companionCardHtml(c, opts){
    opts=opts||{};
    var avatar=c.avatarUrl||c.avatar||c.cardImageUrl||'';
    var avatarHtml=avatar
      ?('<img class="admin-om-avatar" src="'+esc(avatar)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">')
      :('<div class="admin-om-avatar admin-om-avatar-fallback">'+esc(String(c.nickname||c.name||'?').slice(0,1))+'</div>');
    var code=c.companionUid||c.companionCode||c.publicId||c.boss_uid||'';
    var meta=[
      code?('编号 '+code):'',
      c.level||c.levelName||'',
      c.mainGame||c.game||c.mainService||'',
      (c.price!=null?'单价 '+money(c.price):''),
      onlineLabel(c)
    ].filter(Boolean).join(' · ');
    var timeLine=opts.grabbedAt?('<p class="admin-om-card-sub">抢单时间 '+esc(fmtGrabTime(opts.grabbedAt))+(opts.status?' · '+esc(grabStatusLabel(opts.status)):'')+'</p>'):'';
    var actions=opts.actions||'';
    return '<article class="admin-om-card'+(opts.highlight?' is-preferred':'')+'">'+
      avatarHtml+
      '<div class="admin-om-card-body">'+
        '<strong>'+esc(c.nickname||c.name||'陪玩')+(opts.highlight?' · 老板意向':'')+(opts.isFinal?' · 已指定':'')+'</strong>'+
        '<p class="admin-om-card-sub">'+esc(meta||'-')+'</p>'+
        timeLine+
        (actions?'<div class="admin-om-card-actions">'+actions+'</div>':'')+
      '</div></article>';
  }
  function showGrabModal(orderId,mode){
    var box=ensureModalShell();
    box.hidden=false;
    box.classList.add('is-open');
    box.innerHTML='<div class="admin-om-dialog"><div class="admin-om-dialog-head"><h3>加载中…</h3><button class="mini-btn" type="button" data-admin-close-grabs>关闭</button></div><div class="content-loading">加载抢单人...</div></div>';
    post('/api/admin/orders',{action:'list_grabs',id:orderId}).then(function(res){
      var grabs=res.grabs||[];
      var intent=res.bossIntent||null;
      var order=res.order||{};
      var designatedId=String(order.companion_id||order.companionId||'');
      var title=mode==='assign'?'指定陪玩':'查看抢单人';
      var headMeta='订单 '+esc(order.orderNo||orderId)+
        (intent?' · 老板意向：'+esc(intent.companionName||intent.companionId):'')+
        (designatedId?' · 已选：'+esc(order.companionName||designatedId):' · 尚未指定');
      var body='';
      if(!grabs.length){
        body='<div class="empty admin-om-empty">当前暂无陪玩抢单</div>';
        if(mode==='assign'){
          body+='<p class="admin-om-hint">可使用下方搜索指定其他陪玩。</p>';
        }
      }else{
        body='<div class="admin-om-card-list">'+grabs.map(function(g){
          var c=g.companion||{};
          var cid=String(g.companionId||c.id||'');
          var isFinal=!!(designatedId&&cid&&designatedId===cid)||String(g.status||'')==='selected';
          var actions='';
          if(mode==='assign'&&!isFinal&&cid){
            actions='<button class="mini-btn primary" type="button" data-admin-confirm-grab="'+esc(orderId)+'" data-companion-id="'+esc(cid)+'" data-companion-name="'+esc(c.nickname||c.name||'')+'">指定此陪玩</button>';
          }else if(mode==='view'&&!isFinal&&cid&&(String(order.status||'')==='pending'||String(order.status||'')==='waiting_boss_confirm')){
            actions='<button class="mini-btn primary" type="button" data-admin-confirm-grab="'+esc(orderId)+'" data-companion-id="'+esc(cid)+'" data-companion-name="'+esc(c.nickname||c.name||'')+'">指定此陪玩</button>';
          }
          return companionCardHtml(c,{
            grabbedAt:g.grabbedAt||g.grabbed_at,
            status:g.status,
            highlight:!!g.bossPreferred,
            isFinal:isFinal,
            actions:actions
          });
        }).join('')+'</div>';
      }
      if(mode==='assign'){
        body+='<div class="admin-om-assign-box" data-admin-assign-box="'+esc(orderId)+'">'+
          '<h4>自由指定陪玩</h4>'+
          '<label class="admin-om-field">搜索昵称 / 编号<input type="search" data-admin-assign-search placeholder="输入昵称或 PW 编号"></label>'+
          '<div class="admin-om-assign-results" data-admin-assign-results><div class="admin-om-muted">输入关键字后显示可指定陪玩</div></div>'+
        '</div>';
      }
      box.innerHTML='<div class="admin-om-dialog">'+
        '<div class="admin-om-dialog-head"><div><h3>'+esc(title)+'</h3><p>'+headMeta+'</p></div>'+
        '<button class="mini-btn" type="button" data-admin-close-grabs>关闭</button></div>'+
        body+
      '</div>';
      if(mode==='assign')preloadCompanionsForAssign();
    }).catch(function(err){
      box.innerHTML='<div class="admin-om-dialog"><div class="admin-om-dialog-head"><h3>加载失败</h3><button class="mini-btn" type="button" data-admin-close-grabs>关闭</button></div>'+note(err.message||'加载抢单人失败')+'</div>';
    });
  }
  function preloadCompanionsForAssign(){
    if(orderUiState.companionsCache)return Promise.resolve(orderUiState.companionsCache);
    return Promise.all([
      get('/api/public/companions').catch(function(){return {companions:[]}}),
      get('/api/admin/players').catch(function(){return {players:[]}})
    ]).then(function(pair){
      var pub=pair[0].companions||[];
      var players=pair[1].players||[];
      var byId={};
      pub.forEach(function(c){
        var id=String(c.id||c.user_id||'');
        if(!id)return;
        byId[id]={
          id:id,
          user_id:id,
          nickname:c.name||c.nickname||'陪玩',
          companionUid:c.publicId||c.companionCode||c.companionUid||'',
          level:c.levelLabel||c.level||'',
          mainGame:c.game||c.mainGame||'',
          price:c.priceValue||c.price||0,
          avatarUrl:c.avatar||c.avatarUrl||'',
          onlineStatus:c.onlineStatus||c.availabilityText||'',
          onlineStatusLabel:c.availabilityText||c.onlineStatus||''
        };
      });
      players.forEach(function(p){
        var id=String(p.user_id||p.uid||'');
        if(!id)return;
        if(byId[id]){
          if(!byId[id].companionUid&&(p.companionCode||p.publicId))byId[id].companionUid=p.companionCode||p.publicId;
          return;
        }
        byId[id]={
          id:id,
          user_id:id,
          nickname:p.nickname||p.name||'陪玩',
          companionUid:p.companionCode||p.publicId||p.boss_uid||'',
          level:p.levelName||p.level_name||p.levelId||'',
          mainGame:p.mainGame||p.game||p.mainService||'',
          price:p.price||0,
          avatarUrl:p.avatar||p.avatar_url||'',
          onlineStatus:p.online_status||'',
          onlineStatusLabel:p.onlineStatus||p.online_status||''
        };
      });
      orderUiState.companionsCache=Object.keys(byId).map(function(k){return byId[k]});
      return orderUiState.companionsCache;
    });
  }
  function paintAssignSearch(orderId, query){
    var box=document.querySelector('[data-admin-assign-results]');
    if(!box)return;
    var q=String(query||'').trim().toLowerCase();
    if(!q){box.innerHTML='<div class="admin-om-muted">输入关键字后显示可指定陪玩</div>';return;}
    box.innerHTML='<div class="content-loading">搜索中…</div>';
    preloadCompanionsForAssign().then(function(list){
      var hits=(list||[]).filter(function(c){
        var blob=[c.nickname,c.companionUid,c.id,c.mainGame,c.level].join(' ').toLowerCase();
        return blob.indexOf(q)>=0;
      }).slice(0,20);
      if(!hits.length){box.innerHTML='<div class="empty">未找到匹配陪玩</div>';return;}
      box.innerHTML='<div class="admin-om-card-list">'+hits.map(function(c){
        return companionCardHtml(c,{
          actions:'<button class="mini-btn primary" type="button" data-admin-free-assign="'+esc(orderId)+'" data-companion-id="'+esc(c.id)+'" data-companion-name="'+esc(c.nickname||'')+'">指定此陪玩</button>'
        });
      }).join('')+'</div>';
    }).catch(function(err){box.innerHTML=note(err.message||'搜索失败')});
  }
  function showOrderDetail(orderId){
    var o=(orderUiState.orders||[]).find(function(x){return String(x.id)===String(orderId)})||{};
    var box=ensureModalShell();
    box.hidden=false;
    box.classList.add('is-open');
    box.innerHTML='<div class="admin-om-dialog">'+
      '<div class="admin-om-dialog-head"><div><h3>订单详情</h3><p>'+esc(o.orderNo||orderId)+'</p></div>'+
      '<button class="mini-btn" type="button" data-admin-close-grabs>关闭</button></div>'+
      '<div class="admin-om-detail-grid">'+
        '<div><span>老板</span><strong>'+esc(o.bossName||'-')+'</strong></div>'+
        '<div><span>状态</span><strong>'+esc(o.statusText||statusText(o.status))+'</strong></div>'+
        '<div><span>服务</span><strong>'+esc(o.serviceContent||o.game||'-')+'</strong></div>'+
        '<div><span>金额</span><strong>'+esc(money(o.totalAmount))+'</strong></div>'+
        '<div><span>抢单人数</span><strong>'+esc(o.grabCount||0)+'</strong></div>'+
        '<div><span>已选陪玩</span><strong>'+esc(companionLabel(o))+'</strong></div>'+
        '<div><span>创建时间</span><strong>'+esc(o.createdAt||'-')+'</strong></div>'+
      '</div>'+
      '<div class="admin-order-actions" style="margin-top:14px">'+orderActionsHtml(o)+'</div>'+
    '</div>';
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
  document.addEventListener('click',function(e){
    if(e.target.closest('[data-admin-final-refresh="orders"]')){renderOrders();return;}
    if(e.target.closest('[data-admin-final-refresh="reports"]'))renderReports();
    if(e.target.closest('[data-admin-final-refresh="dashboard"]'))renderDashboard();
    var proofPrev=e.target.closest('[data-admin-proof-preview]');
    if(proofPrev){
      var lb=document.getElementById('adminProofLightbox');
      if(!lb){
        lb=document.createElement('div');
        lb.id='adminProofLightbox';
        lb.className='admin-om-lightbox';
        document.body.appendChild(lb);
      }
      lb.hidden=false;
      lb.classList.add('is-open');
      lb.innerHTML='<div class="admin-om-lightbox-card"><div class="admin-om-dialog-head"><strong>付款截图</strong><button class="mini-btn" type="button" data-admin-proof-close>关闭</button></div><img src="'+esc(proofPrev.dataset.adminProofPreview)+'" alt="付款截图" data-mcj-pay-proof="1" referrerpolicy="no-referrer"></div>';
      return;
    }
    if(e.target.closest('[data-admin-proof-close]')||e.target.id==='adminProofLightbox'){
      var lb2=document.getElementById('adminProofLightbox');
      if(lb2){lb2.hidden=true;lb2.classList.remove('is-open');lb2.innerHTML='';}
      return;
    }
    var ap=e.target.closest('[data-admin-approve-proof]');
    if(ap){
      if(!confirm('确认审核通过该付款凭证？将同步更新订单状态。'))return;
      post('/api/admin/finance',{action:'approve_payment_proof',orderId:ap.dataset.adminApproveProof,receiptId:ap.dataset.receiptId||''}).then(function(res){alert(res.message||'已通过');renderOrders();}).catch(function(err){alert(err.message)});
      return;
    }
    var rp=e.target.closest('[data-admin-reject-proof]');
    if(rp){
      var reason=prompt('请填写拒绝原因（必填）','');
      if(reason==null)return;
      reason=String(reason||'').trim();
      if(!reason){alert('必须填写拒绝原因');return;}
      post('/api/admin/finance',{action:'reject_payment_proof',orderId:rp.dataset.adminRejectProof,receiptId:rp.dataset.receiptId||'',reason:reason}).then(function(res){alert(res.message||'已拒绝');renderOrders();}).catch(function(err){alert(err.message)});
      return;
    }
    var vg=e.target.closest('[data-admin-view-grabs]');
    if(vg){showGrabModal(vg.dataset.adminViewGrabs,'view');return;}
    var ag=e.target.closest('[data-admin-assign-grab]');
    if(ag){showGrabModal(ag.dataset.adminAssignGrab,'assign');return;}
    var vo=e.target.closest('[data-admin-view-order]');
    if(vo){showOrderDetail(vo.dataset.adminViewOrder);return;}
    if(e.target.closest('[data-admin-close-grabs]')||(e.target.id==='adminOrderGrabModal'&&e.target.classList.contains('admin-om-modal'))){
      closeGrabModal();
      return;
    }
    var cg=e.target.closest('[data-admin-confirm-grab]');
    if(cg){
      var gName=cg.dataset.companionName||'该陪玩';
      if(!confirm('确定指定「'+gName+'」？\n\n指定后订单离开抢单大厅，进入待陪玩确认；其他抢单陪玩将无法再接此单。'))return;
      cg.disabled=true;
      post('/api/admin/orders',{action:'confirm_grab_assignment',id:cg.dataset.adminConfirmGrab,companion_id:cg.dataset.companionId,from_grabs:true}).then(function(res){
        alert(res.message||'指定成功');
        closeGrabModal();
        renderOrders();
      }).catch(function(err){cg.disabled=false;alert(err.message)});
      return;
    }
    var fa=e.target.closest('[data-admin-free-assign]');
    if(fa){
      var fName=fa.dataset.companionName||'该陪玩';
      if(!confirm('确定自由指定「'+fName+'」到此订单？\n\n将写入真实 companion_id，并通知陪玩端。'))return;
      fa.disabled=true;
      post('/api/admin/orders',{
        action:'assign_companion',
        id:fa.dataset.adminFreeAssign,
        companion_id:fa.dataset.companionId,
        free_assign:true,
        from_grabs:false
      }).then(function(res){
        alert(res.message||'指定成功');
        closeGrabModal();
        renderOrders();
      }).catch(function(err){fa.disabled=false;alert(err.message)});
      return;
    }
    var ua=e.target.closest('[data-admin-unassign]');
    if(ua&&confirm('确认取消指定？订单将回到待抢单。')){
      post('/api/admin/orders',{action:'unassign_companion',id:ua.dataset.adminUnassign}).then(function(){closeGrabModal();renderOrders();}).catch(function(err){alert(err.message)});
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
    var oc=e.target.closest('[data-admin-order-cancel]');
    if(oc&&confirm('确认取消该订单？')){
      post('/api/admin/orders',{action:'cancel',id:oc.dataset.adminOrderCancel}).then(function(){closeGrabModal();renderOrders();}).catch(function(err){alert(err.message)});
      return;
    }
    var od=e.target.closest('[data-admin-order-delete]');
    if(od&&confirm('确认永久删除订单？\n将同时删除订单、相关聊天与缓存。真实订单会记入操作日志。')){
      post('/api/admin/orders',{action:'delete',id:od.dataset.adminOrderDelete}).then(function(res){alert(res.message||'已删除');renderOrders();}).catch(function(err){alert(err.message)});
      return;
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
    var search=e.target.closest('[data-admin-order-search]');
    if(search){
      orderUiState.q=search.value||'';
      // Re-render table only; keep focus without nuking open modals on body.
      var keep=search.selectionStart;
      paintOrders();
      var again=document.querySelector('[data-admin-order-search]');
      if(again){
        again.focus();
        try{again.setSelectionRange(keep,keep)}catch(err){}
      }
      return;
    }
    var as=e.target.closest('[data-admin-assign-search]');
    if(as){
      var box=as.closest('[data-admin-assign-box]');
      var oid=box?box.getAttribute('data-admin-assign-box'):'';
      paintAssignSearch(oid, as.value||'');
    }
  });
  document.addEventListener('change',function(e){
    var filter=e.target.closest('[data-admin-order-filter]');
    if(filter){
      orderUiState.filter=filter.value||'all';
      paintOrders();
    }
  });
  document.addEventListener('DOMContentLoaded',function(){if(!Auth)return;Auth.ensureValidToken().then(function(){renderDashboard();renderOrders();renderReports();renderContent()}).catch(function(){})});
})();
