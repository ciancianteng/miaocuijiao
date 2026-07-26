(function(){
  var DB_KEYS=['users','bosses','clubs','players','orders','wallets','wallet_transactions','recharge_requests','withdraw_requests','invite_rebates','customer_tickets','reviews','games','banners','announcements','admin_logs','role_permissions','companionLevels'];
  var defaultDb={
    users:[{id:'U001',name:'夜色老板',role:'boss',status:'正常',balance:'320喵币'},{id:'U002',name:'MOMO',role:'player',status:'在线',balance:'RM860'},{id:'U003',name:'小鱼管理',role:'admin',status:'正常',balance:'-'}],
    bosses:[{nickname:'夜色老板',uid:'BOSS-1001',phone:'6012-888-1024',registered_at:'2026-06-18',vip:'VIP3',total_spent:'RM1,680',balance:'320喵币',club:'妙脆角主俱乐部',status:'正常',invite:'上级：无 / 已邀请 6 人'},{nickname:'Cheese老板',uid:'BOSS-1002',phone:'6016-520-3344',registered_at:'2026-06-22',vip:'VIP2',total_spent:'RM860',balance:'180喵币',club:'Lian Miao Club',status:'正常',invite:'上级：夜色老板 / 已邀请 2 人'},{nickname:'Moon老板',uid:'BOSS-1003',phone:'6018-777-6633',registered_at:'2026-06-29',vip:'VIP1',total_spent:'RM230',balance:'60喵币',club:'妙脆角主俱乐部',status:'冻结',invite:'上级：Cheese老板 / 已邀请 0 人'}],
    clubs:[{id:'C001',name:'妙脆角主俱乐部',owner:'17三角洲电竞',status:'已通过',revenue:'RM86,500'},{id:'C002',name:'Lian Miao Club',owner:'LianMiao',status:'待审核',revenue:'RM12,300'}],
    players:[{id:'P001',uid:'PW-2001',name:'MOMO',phone:'6011-222-1024',id_card:'已上传',bank:'Maybank **** 1024',game:'VALORANT',levelId:'lv1',price:'RM25/小时',rating:'5.0',status:'在线',audit:'已通过',order_status:'可接单',total_income:'RM8,600',withdrawable:'RM860',club:'妙脆角主俱乐部',avatar:'assets/meow-cuijiao-brand.jpg'},{id:'P002',uid:'PW-2002',name:'NANA',phone:'6013-666-3322',id_card:'待补充',bank:'CIMB **** 2201',game:'APEX',levelId:'lv2',price:'RM35/小时',rating:'4.9',status:'忙碌',audit:'待审核',order_status:'忙碌中',total_income:'RM5,420',withdrawable:'RM520',club:'妙脆角主俱乐部',avatar:'assets/lianmiao-club-ad.png'},{id:'P003',uid:'PW-2003',name:'CHEESE',phone:'6017-999-7788',id_card:'已上传',bank:'TNG **** 7788',game:'LOL',levelId:'lv3',price:'RM42/小时',rating:'5.0',status:'休息',audit:'已通过',order_status:'休息中',total_income:'RM12,300',withdrawable:'RM1,230',club:'Lian Miao Club',avatar:'assets/lianmiao-club-ad.png'}],
    orders:[{id:'O1024',boss:'夜色老板',player:'MOMO',club:'妙脆角主俱乐部',game:'VALORANT',amount:'RM48',status:'进行中',time:'2026-07-03 14:20'},{id:'O1025',boss:'Cheese',player:'NANA',club:'妙脆角主俱乐部',game:'APEX',amount:'RM30',status:'待付款',time:'2026-07-03 15:05'},{id:'O1026',boss:'Moon',player:'CHEESE',club:'Lian Miao Club',game:'LOL',amount:'RM72',status:'已完成',time:'2026-07-03 16:18'}],
    wallets:[{owner:'夜色老板',type:'老板钱包',balance:'320喵币',frozen:'0'},{owner:'MOMO',type:'陪玩钱包',balance:'RM860',frozen:'RM60'},{owner:'妙脆角主俱乐部',type:'俱乐部钱包',balance:'RM12,800',frozen:'RM420'}],
    wallet_transactions:[{id:'T001',owner:'夜色老板',type:'充值',amount:'RM100',status:'成功'},{id:'T002',owner:'MOMO',type:'订单收入',amount:'RM48',status:'入账'}],
    recharge_requests:[{id:'R001',user:'夜色老板',amount:'RM100',coins:'1000喵币',status:'成功'}],
    withdraw_requests:[{id:'W001',owner:'MOMO',role:'陪玩',amount:'RM500',bank:'Maybank **** 1024',status:'待审核'},{id:'W002',owner:'妙脆角主俱乐部',role:'俱乐部',amount:'RM3000',bank:'Public Bank **** 8866',status:'待审核'}],
    invite_rebates:[{id:'IB001',inviter:'夜色老板',invitee:'Cheese老板',relation:'老板邀请老板',rebate:'RM32',status:'已发放'},{id:'IB002',inviter:'Cheese老板',invitee:'Moon老板',relation:'二级邀请',rebate:'RM8',status:'待结算'},{id:'IB003',inviter:'MOMO',invitee:'LULU',relation:'陪玩邀请陪玩',rebate:'RM50',status:'审核中'}],
    customer_tickets:[{id:'CS001',user:'夜色老板',channel:'WhatsApp',topic:'充值未到账',status:'处理中',remark:'已核对流水'},{id:'CS002',user:'NANA',channel:'Discord',topic:'订单纠纷',status:'待回复',remark:'等待老板补充截图'},{id:'CS003',user:'Moon老板',channel:'站内反馈',topic:'申请退款',status:'已关闭',remark:'已完成退款说明'}],
    reviews:[{id:'RV001',order_id:'O1026',user_id:'U001',player_id:'P003',player:'CHEESE',rating:'5',content:'声音好听，带飞很稳',status:'显示中'},{id:'RV002',order_id:'O1018',user_id:'U004',player_id:'P001',player:'MOMO',rating:'5',content:'报点非常细',status:'显示中'}],
    games:[{id:'G001',name:'VALORANT',logo:'assets/valorant-bg.jpg',sort:1,visible:'显示'},{id:'G002',name:'APEX',logo:'assets/apex-bg.jpg',sort:2,visible:'显示'},{id:'G003',name:'LOL',logo:'assets/lol-bg.jpg',sort:3,visible:'显示'}],
    banners:[{id:'B001',title:'首页主封面',image:'assets/homepage-cat-cover.png',enabled:'开启',sort:1},{id:'B002',title:'官方广告位',image:'assets/lianmiao-club-ad.png',enabled:'开启',sort:2}],
    announcements:[{id:'A001',title:'新人福利开启',content:'老板充值送积分，热门陪玩限时推荐',enabled:'开启'},{id:'A002',title:'招聘陪玩中',content:'欢迎优秀陪玩加入妙脆角电竞',enabled:'开启'}],
    admin_logs:[{id:'L001',admin:'super_admin',action:'更新首页广告位',time:'2026-07-03 16:30'},{id:'L002',admin:'club_owner',action:'调整陪玩建议价',time:'2026-07-03 17:05'}],
    role_permissions:[{role:'super_admin',scope:'平台全局管理'},{role:'club_owner',scope:'仅自己的俱乐部'},{role:'player',scope:'仅个人资料与订单'}],
    companionLevels:[]
  };
  function read(key){try{var v=JSON.parse(localStorage.getItem('mcj_'+key)||'null');if(Array.isArray(v))return v;}catch(e){}return [];}
  function write(key,val){localStorage.setItem('mcj_'+key,JSON.stringify(val));log('保存 '+key)}
  function log(action){var logs=read('admin_logs');logs.unshift({id:'L'+Date.now(),admin:getRole(),action:action,time:new Date().toLocaleString()});localStorage.setItem('mcj_admin_logs',JSON.stringify(logs.slice(0,60)));}
  function getRole(){return localStorage.getItem('mcjRole')||document.body.dataset.defaultRole||'user'}
  function routeByRole(role){var map={super_admin:'admin.html',club_owner:'admin.html',player:'admin.html',user:'index.html'};location.href=map[role]||'index.html'}
  function enforceRole(){var allowed=(document.body.dataset.allowedRoles||'').split(',').filter(Boolean);var current=localStorage.getItem('mcjRole');if(!current){localStorage.setItem('mcjRole',document.body.dataset.defaultRole||allowed[0]||'user');return;}if(allowed.length&&allowed.indexOf(current)<0){routeByRole(current)}}
  function statusChip(text){var t=String(text||'');var cls=/通过|完成|成功|在线|正常|开启|显示/.test(t)?'ok':/拒绝|冻结|异常|取消|离线|关闭|隐藏/.test(t)?'bad':'wait';return '<span class="chip '+cls+'">'+esc(t)+'</span>'}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function table(headers,rows){return '<div class="table-wrap"><table><thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead><tbody>'+(rows.length?rows.join(''):'<tr><td colspan="'+headers.length+'"><div class="empty">暂无数据</div></td></tr>')+'</tbody></table></div>'}
  function actionButtons(id){return '<div class="row"><button class="btn small" data-action="view" data-id="'+id+'">查看</button><button class="btn small primary" data-action="approve" data-id="'+id+'">通过</button><button class="btn small danger" data-action="reject" data-id="'+id+'">拒绝</button></div>'}
  function renderGenericTable(key,target,columns){var data=read(key);var rows=data.map(function(item){return '<tr>'+columns.map(function(c){var v=item[c.key];if(c.type==='avatar')return '<td><img class="avatar" src="'+esc(v||'assets/meow-cuijiao-brand.jpg')+'"></td>';if(c.type==='status')return '<td>'+statusChip(v)+'</td>';if(c.type==='actions')return '<td>'+actionButtons(item.id||item.name||item.owner)+'</td>';return '<td>'+esc(v)+'</td>';}).join('')+'</tr>'});target.innerHTML=table(columns.map(function(c){return c.label}),rows)}
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
  function renderBossManagement(){
    var target=document.getElementById('bossManagement');
    if(!target)return;
    var bosses=read('bosses');
    var toolbar='<div class="toolbar boss-admin-toolbar"><input data-table-search="bossManagementTable" placeholder="搜索老板昵称 / UID / 老板 ID / 手机号 / 游戏 ID"><select data-boss-filter="vip"><option value="">全部 VIP</option><option>VIP1</option><option>VIP2</option><option>VIP3</option><option>VIP4</option><option>VIP5</option></select><select data-boss-filter="status"><option value="">账号状态</option><option>正常</option><option>限制下单</option><option>限制充值</option><option>冻结</option><option>已注销</option><option>黑名单</option></select><select data-boss-filter="balance"><option value="">是否有余额</option><option>有余额</option><option>无余额</option></select><select data-boss-filter="recharged"><option value="">是否充值过</option><option>已充值</option><option>未充值</option></select><select data-boss-filter="ordered"><option value="">是否下过订单</option><option>有订单</option><option>无订单</option></select><select data-boss-filter="refund"><option value="">退款记录</option><option>有退款</option><option>无退款</option></select><select data-boss-filter="blacklist"><option value="">黑名单</option><option>是</option><option>否</option></select></div><div class="boss-bulk-actions"><button class="mini-btn" data-boss-bulk="message" type="button">批量发送系统消息</button><button class="mini-btn" data-boss-bulk="status" type="button">批量调整账号状态</button><button class="mini-btn danger-btn" data-boss-bulk="blacklist" type="button">批量加入黑名单</button><button class="mini-btn" data-boss-bulk="export" type="button">批量导出</button><button class="mini-btn" data-boss-bulk="tag" type="button">批量添加标签</button></div>';
    var headers=['选择','头像','老板昵称','系统 UID','老板 ID','手机号','邮箱','游戏','游戏 ID / 游戏昵称','注册时间','最近登录时间','VIP 等级','当前余额','累计充值','累计消费','累计订单','退款金额','邀请人','账号状态','操作'];
    var rows=bosses.map(function(boss){
      var systemUid=bossValue(boss,['uid','systemUid','system_uid','id'],'-');
      var bossId=bossValue(boss,['bossId','boss_id','publicId','public_id'],'未设置');
      var mainGame=bossValue(boss,['mainGame','game','favoriteGame'],'-');
      var gameId=bossValue(boss,['gameId','game_id','gameNickname','game_nickname'],'-');
      var id=systemUid;
      return '<tr data-boss-row data-search="'+esc(JSON.stringify(boss))+'">'+
        '<td><input type="checkbox" data-boss-select="'+esc(id)+'"></td>'+
        '<td><img class="avatar" src="'+esc(boss.avatar||'assets/meow-cuijiao-brand.jpg')+'"></td>'+
        '<td>'+esc(bossValue(boss,['nickname','name'],'-'))+'</td>'+
        '<td><strong>'+esc(systemUid)+'</strong></td>'+
        '<td>'+esc(bossId)+'</td>'+
        '<td>'+esc(maskPhone(bossValue(boss,['phone','mobile'],'-')))+'</td>'+
        '<td>'+esc(maskEmail(bossValue(boss,['email'],'-')))+'</td>'+
        '<td>'+esc(mainGame)+'</td>'+
        '<td>'+esc(gameId)+'</td>'+
        '<td>'+esc(bossValue(boss,['registered_at','registeredAt','createdAt'],'-'))+'</td>'+
        '<td>'+esc(bossValue(boss,['lastLoginAt','last_login_at','last_login'],'-'))+'</td>'+
        '<td><span class="status info">'+esc(bossValue(boss,['vip','vipLevel'],'VIP0'))+'</span></td>'+
        '<td>'+esc(bossValue(boss,['balance','walletBalance'],'RM0'))+'</td>'+
        '<td>'+esc(bossValue(boss,['totalRecharge','total_recharge'],'RM0'))+'</td>'+
        '<td>'+esc(bossValue(boss,['total_spent','totalSpent','totalConsume'],'RM0'))+'</td>'+
        '<td>'+esc(bossValue(boss,['totalOrders','total_orders'],'0'))+'</td>'+
        '<td>'+esc(bossValue(boss,['refundAmount','refund_amount'],'RM0'))+'</td>'+
        '<td>'+esc(bossValue(boss,['inviter','inviterId','invite'],'-'))+'</td>'+
        '<td>'+statusChip(bossValue(boss,['accountStatus','account_status','status'],'正常'))+'</td>'+
        '<td><div class="boss-row-actions"><button class="mini-btn" data-boss-action="view" data-boss-id="'+esc(id)+'" type="button">查看</button><button class="mini-btn" data-boss-action="edit" data-boss-id="'+esc(id)+'" type="button">编辑</button><button class="mini-btn" data-boss-action="boss-id" data-boss-id="'+esc(id)+'" type="button">'+(bossId==='未设置'?'设置 ID':'编辑老板 ID')+'</button><button class="mini-btn" data-boss-action="orders" data-boss-id="'+esc(id)+'" type="button">查看订单</button><button class="mini-btn" data-boss-action="recharge" data-boss-id="'+esc(id)+'" type="button">查看充值</button><button class="mini-btn" data-boss-action="flow" data-boss-id="'+esc(id)+'" type="button">查看流水</button><button class="mini-btn" data-boss-action="balance" data-boss-id="'+esc(id)+'" type="button">调整余额</button><button class="mini-btn" data-boss-action="vip" data-boss-id="'+esc(id)+'" type="button">调整 VIP</button><button class="mini-btn danger-btn" data-boss-action="restrict-order" data-boss-id="'+esc(id)+'" type="button">限制下单</button><button class="mini-btn danger-btn" data-boss-action="freeze" data-boss-id="'+esc(id)+'" type="button">冻结账号</button><button class="mini-btn danger-btn" data-boss-action="blacklist" data-boss-id="'+esc(id)+'" type="button">加入黑名单</button><button class="mini-btn" data-boss-action="remove-blacklist" data-boss-id="'+esc(id)+'" type="button">移出黑名单</button><button class="mini-btn danger-btn" data-boss-action="reset-password" data-boss-id="'+esc(id)+'" type="button">重置密码</button><button class="mini-btn" data-boss-action="login-logs" data-boss-id="'+esc(id)+'" type="button">查看登录记录</button></div></td>'+
      '</tr>';
    }).join('');
    target.innerHTML=toolbar+'<div id="bossManagementTable">'+table(headers,rows)+'</div><div class="admin-sync-note">老板是平台消费用户。系统 UID 只用于数据库、订单和内部关联；老板 ID 用于对外展示和搜索。所有修改必须通过真实数据库接口保存，不写入本地假数据。</div>';
  }
  function openBossDetail(bossId){
    var boss=read('bosses').find(function(item){return String(item.uid||item.systemUid||item.id)===String(bossId)});
    var modal=document.getElementById('adminModal'),body=document.getElementById('modalBody');
    if(!modal||!body)return;
    var tabs=['基本资料','游戏账号','钱包与充值','订单记录','消费记录','VIP 记录','退款与售后','邀请关系','收藏与关注','登录记录','操作日志','风控记录'];
    body.innerHTML='<h2>老板详情</h2><p class="muted">'+esc(boss?(bossValue(boss,['uid','systemUid'],'-')+' · '+bossValue(boss,['nickname','name'],'-')):'真实数据库中暂无该老板资料')+'</p><div class="boss-detail-tabs">'+tabs.map(function(tab){return '<span>'+esc(tab)+'</span>'}).join('')+'</div><div class="detail-list"><div><span>老板昵称</span><strong>'+esc(bossValue(boss||{},['nickname','name'],'-'))+'</strong></div><div><span>系统 UID</span><strong>'+esc(bossValue(boss||{},['uid','systemUid'],'-'))+'</strong></div><div><span>老板 ID</span><strong>'+esc(bossValue(boss||{},['bossId','boss_id','publicId'],'未设置'))+'</strong></div><div><span>手机号 / 邮箱</span><strong>'+esc(maskPhone(bossValue(boss||{},['phone'],'-')))+' / '+esc(maskEmail(bossValue(boss||{},['email'],'-')))+'</strong></div><div><span>钱包</span><strong>'+esc(bossValue(boss||{},['balance'],'RM0'))+' · 累计消费 '+esc(bossValue(boss||{},['total_spent','totalSpent'],'RM0'))+'</strong></div><div><span>邀请关系</span><strong>'+esc(bossValue(boss||{},['inviter','invite'],'-'))+'</strong></div></div>';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
  }
  function submitBossSecure(action,id,payload){
    fetch('/api/admin/bosses',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,id:id,payload:payload||{}})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'老板管理接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'保存失败');alert('已提交到真实数据库');}).catch(function(err){alert('保存失败：'+err.message+'。未写入本地假数据。');});
  }
  var orderState={orders:[],summary:null,loaded:false,error:''};
  var orderTypes=['普通陪玩订单','更多玩法固定单','自定义订单','护航订单','跑刀订单','代肝订单','趣味订单','客服创建订单'];
  var orderStatuses=['待支付','待接单','待老板确认陪玩','待开始','进行中','待确认完成','已完成','已取消','售后处理中','退款处理中','已退款','异常订单'];
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
  function moneyText(value){return 'RM'+moneyNumber(value).toFixed(2)}
  function orderPaymentAmount(order){return moneyNumber(orderValue(order,['actualPaidAmount','actual_paid_amount','paidAmount','paid_amount','amount'],0))}
  function orderPlayerIncome(order){var explicit=orderValue(order,['playerIncome','player_income'],'');if(explicit!=='')return moneyNumber(explicit);var commission=Number(String(orderValue(order,['playerCommissionRate','player_commission_rate'],'80')).replace(/[^\d.]/g,''));return orderPaymentAmount(order)*(Number.isFinite(commission)?commission:80)/100}
  function orderPlatformProfit(order){var explicit=orderValue(order,['platformProfit','platform_profit'],'');if(explicit!=='')return moneyNumber(explicit);return Math.max(0,orderPaymentAmount(order)-orderPlayerIncome(order)-moneyNumber(orderValue(order,['directRebate','direct_rebate'],0))-moneyNumber(orderValue(order,['refundAmount','refund_amount'],0)))}
  function orderStatusChip(text){var t=String(text||'');var cls=/完成|已支付|平台直营|老板自助/.test(t)?'ok':/退款|售后|待|支付中|接单|确认|开始/.test(t)?'wait':/取消|异常|失败/.test(t)?'bad':'info';return '<span class="status '+cls+'">'+esc(t||'-')+'</span>'}
  function normalizeOrder(order){
    order=order||{};
    return Object.assign({},order,{
      id:orderValue(order,['orderNo','order_no','id'],'-'),
      type:orderValue(order,['orderType','order_type','type'],'普通陪玩订单'),
      bossName:orderValue(order,['bossName','boss_name','boss'],'-'),
      bossUid:orderValue(order,['bossUid','boss_uid','customerUid','customer_uid'],'-'),
      bossId:orderValue(order,['bossId','boss_id'],'-'),
      playerName:orderValue(order,['playerName','player_name','player'],'待分配'),
      playerUid:orderValue(order,['playerUid','player_uid'],'-'),
      game:orderValue(order,['game'],'-'),
      serviceContent:orderValue(order,['serviceContent','service_content','service','gameplay'],'-'),
      serviceStaff:orderValue(order,['serviceStaff','currentService','current_service','support','customerService'],'-'),
      amount:orderPaymentAmount(order),
      playerIncome:orderPlayerIncome(order),
      platformProfit:orderPlatformProfit(order),
      paymentStatus:orderValue(order,['paymentStatus','payment_status'],'未支付'),
      orderStatus:orderValue(order,['orderStatus','order_status','status'],'待支付'),
      createdAt:orderValue(order,['createdAt','created_at','time'],'-'),
      serviceTime:orderValue(order,['serviceTime','service_time','appointmentTime','appointment_time'],'-'),
      source:orderValue(order,['orderSource','order_source','source'],'平台直营')
    });
  }
  function renderOrderManagement(){
    var target=document.getElementById('orderManagement');
    if(!target)return;
    target.innerHTML='<div class="content-loading">正在读取真实订单数据库...</div>';
    fetch('/api/admin/orders',{headers:{'x-mcj-admin-role':getRole(),Accept:'application/json'}}).then(function(res){var ct=res.headers.get('content-type')||'';if(ct.indexOf('application/json')<0)return {ok:true,configured:false,orders:[],summary:null,message:'本地静态预览未启用订单接口'};return res.json();}).then(function(result){
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
    var rows=orders.map(function(o){return '<tr data-order-row data-search="'+esc([o.id,o.type,o.bossName,o.bossUid,o.bossId,o.playerName,o.playerUid,o.serviceStaff,o.game,o.paymentOrderNo].join(' '))+'">'+
      '<td><strong>'+esc(o.id)+'</strong></td><td>'+orderStatusChip(o.type)+'</td><td>'+esc(o.bossName)+'</td><td>'+esc(o.bossUid)+'</td><td>'+esc(o.playerName)+'</td><td>'+esc(o.playerUid)+'</td><td>'+esc(o.game)+'</td><td>'+esc(o.serviceContent)+'</td><td>'+esc(o.serviceStaff)+'</td><td>'+moneyText(o.amount)+'</td><td>'+moneyText(o.playerIncome)+'</td><td>'+moneyText(o.platformProfit)+'</td><td>'+orderStatusChip(o.paymentStatus)+'</td><td>'+orderStatusChip(o.orderStatus)+'</td><td>'+esc(o.createdAt)+'</td><td>'+esc(o.serviceTime)+'</td><td><div class="order-row-actions">'+orderActions(o).map(function(a){return '<button class="mini-btn '+(a.danger?'danger-btn':'')+'" data-order-action="'+esc(a.key)+'" data-order-id="'+esc(o.id)+'" type="button">'+esc(a.label)+'</button>'}).join('')+'</div></td></tr>'}).join('');
    return '<div class="order-admin">'+
      '<div class="order-metrics">'+metric.map(function(item){return '<div><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>'}).join('')+'</div>'+
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
      '售后处理中':[['after-sale-view','查看售后'],['refund-approve','同意退款',true],['refund-reject','拒绝退款',true],['partial-refund','部分退款',true],['change-player','更换陪玩'],['compensate','补偿余额',true]]
    };
    var base=[['view','查看'],['remark','编辑备注'],['chat','查看聊天'],['payment','查看支付'],['settlement','查看结算'],['assign-service','分配客服']];
    return base.concat(map[order.orderStatus]||[['cancel','取消订单',true]]).map(function(x){return {key:x[0],label:x[1],danger:!!x[2]}});
  }
  function openOrderDetail(orderId){
    fetch('/api/admin/orders?id='+encodeURIComponent(orderId),{headers:{'x-mcj-admin-role':getRole(),Accept:'application/json'}}).then(function(res){var ct=res.headers.get('content-type')||'';if(ct.indexOf('application/json')<0)return {ok:true,order:orderState.orders.find(function(x){return x.id===orderId})};return res.json();}).then(function(result){if(!result.ok)throw new Error(result.message||'读取详情失败');renderOrderDetail(normalizeOrder(result.order||orderState.orders.find(function(x){return x.id===orderId})||{}));}).catch(function(err){alert('读取订单详情失败：'+err.message);});
  }
  function renderOrderDetail(order){
    var modal=document.getElementById('adminModal'),body=document.getElementById('modalBody');if(!modal||!body)return;
    var tabs=['订单概况','老板资料','陪玩资料','服务内容','支付与结算','聊天记录','时间记录','售后与退款','操作日志'];
    var detail=[
      ['订单号',order.id],['订单类型',order.type],['当前状态',order.orderStatus],['支付状态',order.paymentStatus],['游戏',order.game],['区服',orderValue(order,['server','region'],'-')],['游戏 ID',orderValue(order,['gameId','game_id'],'-')],['服务项目',order.serviceContent],['服务时长',orderValue(order,['duration','serviceDuration'],'-')],['预约时间',order.serviceTime],['实际开始时间',orderValue(order,['startedAt','started_at'],'-')],['实际结束时间',orderValue(order,['endedAt','ended_at'],'-')],['创建时间',order.createdAt],['订单来源',order.source],['负责客服',order.serviceStaff],
      ['老板支付金额',moneyText(orderValue(order,['originalAmount','original_amount','amount'],order.amount))],['优惠金额',moneyText(orderValue(order,['discountAmount','discount_amount'],0))],['实际支付金额',moneyText(order.amount)],['陪玩佣金比例',orderValue(order,['playerCommissionRate','player_commission_rate'],'-')],['陪玩应得收入',moneyText(order.playerIncome)],['平台抽成',moneyText(orderValue(order,['platformFee','platform_fee'],order.amount-order.playerIncome))],['直属返点',moneyText(orderValue(order,['directRebate','direct_rebate'],0))],['退款金额',moneyText(orderValue(order,['refundAmount','refund_amount'],0))],['最终平台利润',moneyText(order.platformProfit)],['结算状态',orderValue(order,['settlementStatus','settlement_status'],'待结算')]
    ];
    var timing='<div class="order-timer"><div><span>计划时长</span><strong>'+esc(orderValue(order,['duration','serviceDuration'],'-'))+'</strong></div><div><span>已进行时间</span><strong>'+esc(orderValue(order,['elapsed','elapsedTime'],'-'))+'</strong></div><div><span>剩余时间</span><strong>'+esc(orderValue(order,['remaining','remainingTime'],'-'))+'</strong></div><div><span>预计结束时间</span><strong>'+esc(orderValue(order,['expectedEndAt','expected_end_at'],'-'))+'</strong></div></div>';
    body.innerHTML='<h2>订单详情</h2><p class="muted">'+esc(order.id)+' · '+esc(order.type)+' · '+esc(order.orderStatus)+'</p><div class="order-detail-tabs">'+tabs.map(function(tab){return '<span>'+esc(tab)+'</span>'}).join('')+'</div>'+timing+'<div class="detail-list">'+detail.map(function(item){return '<div><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>'}).join('')+'</div><div class="admin-sync-note">聊天记录、售后记录、支付流水和操作日志均应通过订单 ID 关联统一数据库；当前详情页不会生成模拟上下文。</div>';
    modal.classList.add('show');modal.setAttribute('aria-hidden','false');
  }
  function submitOrderAction(action,id,payload){
    fetch('/api/admin/orders',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,id:id,payload:payload||{}})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'订单接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'操作失败');alert(result.message||'已提交到真实订单数据库');renderOrderManagement();}).catch(function(err){alert('操作失败：'+err.message+'。未写入 localStorage 假订单。');});
  }
  function filterOrders(){
    var keyword=(document.querySelector('[data-order-search]')||{}).value||'';
    keyword=keyword.trim().toLowerCase();
    document.querySelectorAll('[data-order-row]').forEach(function(row){row.style.display=!keyword||(row.dataset.search||'').toLowerCase().indexOf(keyword)>-1?'':'none';});
  }
  function renderPlayerManagement(){
    var target=document.getElementById('playerManagement');
    if(!target)return;
    var players=read('players');
    var levels=getLevels();
    var clubs=read('clubs');
    var levelOptions=['<option value="">全部等级</option>'].concat(levels.map(function(level){return '<option value="'+esc(level.id)+'">'+esc(level.code+' '+level.name)+'</option>'})).join('');
    var clubOptions=['<option value="">全部俱乐部</option>'].concat(clubs.map(function(club){return '<option value="'+esc(club.name)+'">'+esc(club.name)+'</option>'})).join('');
    var toolbar='<div class="toolbar player-admin-toolbar"><input data-table-search="playerManagementTable" placeholder="搜索 UID / 昵称 / 手机号 / 游戏 / 俱乐部 / 等级 / 审核状态 / 接单状态"><select data-player-filter="level">'+levelOptions+'</select><select data-player-filter="club">'+clubOptions+'</select><select data-player-filter="online"><option value="">全部在线状态</option><option>在线</option><option>忙碌</option><option>离线</option></select><select data-player-filter="audit"><option value="">全部审核状态</option><option>待审核</option><option>已通过</option><option>已拒绝</option><option>已停用</option></select><select data-player-filter="commission"><option value="">佣金比例</option><option>80%</option><option>75%</option><option>70%</option></select><select data-player-filter="rebate"><option value="">返点比例</option><option>0%</option><option>2%</option><option>3%</option><option>5%</option></select><select data-player-filter="platformShare"><option value="">平台分成</option><option>20%</option><option>25%</option><option>30%</option></select></div><div class="player-bulk-actions"><button class="mini-btn" data-player-bulk="approve" type="button">批量审核</button><button class="mini-btn" data-player-bulk="level" type="button">批量修改等级</button><button class="mini-btn" data-player-bulk="commission" type="button">批量修改佣金</button><button class="mini-btn" data-player-bulk="rebate" type="button">批量修改返点</button><button class="mini-btn" data-player-bulk="club" type="button">批量修改俱乐部</button><button class="mini-btn" data-player-bulk="disable" type="button">批量停用</button><button class="mini-btn" data-player-bulk="enable" type="button">批量启用</button></div>';
    var headers=['选择','头像','UID','昵称','所属俱乐部','直属老板','等级','当前单价','订单抽成','直属返点','平台分成','接单状态','在线状态','累计订单','累计收入','本月收入','总提现','可提现金额','押金状态','身份认证','联系方式','银行账户','审核状态','操作'];
    var rows=players.map(function(player){
      var level=levelApi()?levelApi().find(player.levelId||player.level||player.level_name):null;
      var id=player.id||player.uid||player.name;
      var action='<div class="player-row-actions"><button class="mini-btn" data-player-action="view" data-player-id="'+esc(id)+'" type="button">查看</button><button class="mini-btn" data-player-action="edit" data-player-id="'+esc(id)+'" type="button">编辑</button><button class="mini-btn" data-player-action="level" data-player-id="'+esc(id)+'" type="button">修改等级</button><button class="mini-btn" data-player-action="commission" data-player-id="'+esc(id)+'" type="button">修改佣金</button><button class="mini-btn" data-player-action="rebate" data-player-id="'+esc(id)+'" type="button">修改返点</button><button class="mini-btn" data-player-action="orders" data-player-id="'+esc(id)+'" type="button">查看订单</button><button class="mini-btn" data-player-action="withdraw" data-player-id="'+esc(id)+'" type="button">查看提现</button><button class="mini-btn danger-btn" data-player-action="disable" data-player-id="'+esc(id)+'" type="button">停用</button><button class="mini-btn danger-btn" data-player-action="delete" data-player-id="'+esc(id)+'" type="button">删除</button></div>';
      return '<tr data-player-row data-search="'+esc(JSON.stringify(player))+'">'+
        '<td><input type="checkbox" data-player-select="'+esc(id)+'"></td>'+
        '<td><img class="avatar" src="'+esc(player.avatar||'assets/meow-cuijiao-brand.jpg')+'"></td>'+
        '<td>'+esc(player.uid||id)+'</td>'+
        '<td>'+esc(player.name||player.nickname||'-')+'</td>'+
        '<td>'+esc(playerValue(player,['club','clubName','club_name'],'未分配'))+'</td>'+
        '<td>'+esc(playerValue(player,['directBoss','direct_boss','ownerBoss','boss'],'-'))+'</td>'+
        '<td>'+esc(level?level.code+' '+level.name:playerValue(player,['level','levelId','level_name'],'-'))+'</td>'+
        '<td>'+esc(playerValue(player,['price','defaultPrice','default_price'],'-'))+'</td>'+
        '<td>'+esc(playerValue(player,['orderCommission','order_commission'],'80%'))+'</td>'+
        '<td>'+esc(playerValue(player,['directRebate','direct_rebate'],'0%'))+'</td>'+
        '<td>'+esc(playerValue(player,['platformShare','platform_share'],'20%'))+'</td>'+
        '<td>'+statusChip(playerValue(player,['order_status','orderStatus'],'-'))+'</td>'+
        '<td>'+statusChip(playerValue(player,['status','onlineStatus','online_status'],'-'))+'</td>'+
        '<td>'+esc(playerValue(player,['totalOrders','total_orders'],'0'))+'</td>'+
        '<td>'+esc(playerValue(player,['total_income','totalIncome','cumulativeIncome'],'RM0'))+'</td>'+
        '<td>'+esc(playerValue(player,['monthIncome','monthly_income'],'RM0'))+'</td>'+
        '<td>'+esc(playerValue(player,['totalWithdraw','total_withdraw'],'RM0'))+'</td>'+
        '<td>'+esc(playerValue(player,['withdrawable','withdrawableAmount'],'RM0'))+'</td>'+
        '<td>'+statusChip(playerValue(player,['depositStatus','deposit_status'],'未缴纳'))+'</td>'+
        '<td>'+statusChip(playerValue(player,['id_card','identityStatus','identity_status'],'未认证'))+'</td>'+
        '<td>'+esc(playerValue(player,['phone','contact','email'],'-'))+'</td>'+
        '<td>'+esc(playerValue(player,['bank','bankAccount','bank_account'],'-'))+'</td>'+
        '<td>'+statusChip(playerValue(player,['audit','auditStatus','review_status'],'待审核'))+'</td>'+
        '<td>'+action+'</td>'+
      '</tr>';
    }).join('');
    target.innerHTML=toolbar+'<div id="playerManagementTable">'+table(headers,rows)+'</div><div class="admin-sync-note">所有修改必须通过后端接口保存到真实数据库；当前页面不会写入浏览器本地假数据。字段同步范围：用户首页、陪玩端、订单系统、提现与收益结算。</div>';
  }
  function openPlayerDetail(playerId){
    var player=read('players').find(function(item){return String(item.id||item.uid||item.name)===String(playerId)});
    var modal=document.getElementById('adminModal'),body=document.getElementById('modalBody');
    if(!modal||!body)return;
    var tabs=['基本资料','游戏资料','录音','标签','所属俱乐部','等级','佣金','返点','提现','订单','评价','登录记录','操作日志','银行资料','身份证资料'];
    body.innerHTML='<h2>陪玩详情</h2><p class="muted">'+esc(player?(player.uid||player.id||'')+' · '+(player.name||player.nickname||''):'真实数据库中暂无该陪玩资料')+'</p><div class="player-detail-tabs">'+tabs.map(function(tab){return '<span>'+esc(tab)+'</span>'}).join('')+'</div><div class="detail-list"><div><span>所属俱乐部</span><strong>'+esc(playerValue(player||{},['club','clubName'],'-'))+'</strong></div><div><span>等级</span><strong>'+esc(playerValue(player||{},['levelId','level'],'-'))+'</strong></div><div><span>佣金 / 返点</span><strong>'+esc(playerValue(player||{},['orderCommission'],'80%'))+' / '+esc(playerValue(player||{},['directRebate'],'0%'))+'</strong></div><div><span>银行账户</span><strong>'+esc(playerValue(player||{},['bank','bankAccount'],'-'))+'</strong></div><div><span>身份证资料</span><strong>'+esc(playerValue(player||{},['id_card','identityStatus'],'未认证'))+'</strong></div></div>';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
  }
  function submitPlayerSecure(action,id,payload){
    fetch('/api/admin/players',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,id:id,payload:payload||{}})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'陪玩管理接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'保存失败');alert('已提交到真实数据库');}).catch(function(err){alert('保存失败：'+err.message+'。未写入本地假数据。');});
  }
  var adminMessageState={conversations:[],messages:[],profiles:{},activeId:'',loaded:false,error:''};
  var chatTypeLabels={boss:'老板',customer:'老板',player:'陪玩',companion:'陪玩',service:'客服',support:'客服',system:'系统通知'};
  function avatarInitial(name){return esc(String(name||'喵').trim().slice(0,1).toUpperCase()||'喵')}
  function chatProfileField(label,value){return '<div><span>'+esc(label)+'</span><strong>'+esc(value==null||value===''?'-':value)+'</strong></div>'}
  function normalizeAdminConversation(item){
    item=item||{};
    return {
      id:String(item.id||item.conversationId||item.conversation_id||''),
      type:String(item.type||item.targetType||item.target_type||'boss'),
      name:item.name||item.nickname||item.title||'未命名会话',
      uid:item.uid||item.userUid||item.user_uid||item.targetUid||item.target_uid||'-',
      phone:item.phone||item.mobile||'',
      externalId:item.bossId||item.boss_id||item.playerId||item.player_id||item.externalId||'',
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
    fetch('/api/admin/messages',{headers:{'x-mcj-admin-role':getRole()}}).then(function(res){var type=res.headers.get('content-type')||'';if(type.indexOf('application/json')<0)return {ok:true,conversations:[],messages:[],profiles:{},message:'本地静态预览未启用服务端消息接口'};return res.json().catch(function(){return {ok:false,message:'消息接口返回异常'}})}).then(function(result){
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
    return '<div class="admin-chat-workbench">'+renderAdminChatList(active)+renderAdminChatMain(active)+renderAdminChatProfile(active)+'</div><div class="admin-sync-note">消息中心只读取统一聊天数据库。没有真实会话时显示空状态；发送、接管、转交、拉黑、删除和导出操作必须通过后端接口落库，不写入本地假数据。</div>';
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
    return '<aside class="admin-chat-profile"><h3>资料栏</h3>'+(active?'<div class="profile-hero"><span class="admin-chat-avatar large">'+adminChatAvatar(active)+'</span><strong>'+esc(active.name)+'</strong><small>'+esc(type)+'</small></div><div class="detail-list">'+base.map(function(item){return chatProfileField(item[0],item[1])}).join('')+'</div><div class="profile-admin-actions"><button data-chat-action="take-over" type="button">接管聊天</button><button data-chat-action="transfer" type="button">转交客服</button><button data-chat-action="export" type="button">导出聊天记录</button><button class="danger-btn" data-chat-action="blacklist" type="button">拉黑</button></div>':'<div class="chat-empty-state"><strong>请选择会话</strong><span>资料栏会根据老板、陪玩或客服自动切换字段。</span></div>')+'</aside>';
  }
  function submitAdminChatAction(action,conversationId,payload){
    if(!conversationId){alert('请先选择一个真实会话');return;}
    fetch('/api/admin/messages',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,conversationId:conversationId,payload:payload||{}})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'消息接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'操作失败');alert('已提交到统一聊天数据库');loadAdminMessages();}).catch(function(err){alert('操作失败：'+err.message+'。未写入本地假数据。');});
  }
  function submitCompanionLevelsSecure(){
    fetch('/api/admin/companion-levels',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({levels:collectCompanionLevelAdmin()})}).then(function(res){return res.json().catch(function(){return {ok:false,message:'陪玩等级接口返回异常'}})}).then(function(result){if(!result.ok)throw new Error(result.message||'保存失败');alert('已提交到真实数据库');}).catch(function(err){alert('保存失败：'+err.message+'。未写入本地假数据。');});
  }
  function renderCompanionLevelAdmin(){
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
    active=active||target.dataset.currentPaymentTab||'channels';
    target.dataset.currentPaymentTab=active;
    target.innerHTML='<div class="payment-module-head"><h2>支付设置</h2><p>管理支付渠道、收款资料、接口配置与启用状态</p></div>'+paymentTabsHtml(active)+'<div class="payment-body">'+paymentBody(active,editId)+'</div>';
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
  var platformContentModules={
    banners:{target:'crud-banners',title:'Banner 管理',type:'banners',desc:'直接同步首页 Banner，支持电脑端与手机端图片、跳转、排期、排序和发布。',fields:['title','desktopImage','mobileImage','link','linkTarget','sort','startAt','endAt','autoPlay','intervalSeconds']},
    announcements:{target:'table-announcements',title:'公告管理',type:'announcements',desc:'对应首页 Banner 下方公告，前台按后台排序和时间播放。',fields:['content','link','sort','startAt','endAt','displayMode']},
    ads:{target:'crud-ads',title:'广告位管理',type:'ad_slots',desc:'同步首页、陪玩大厅、组队大厅、充值中心等广告位。',fields:['title','subtitle','image','link','position','sort','startAt','endAt','carousel','official']},
    'team-lobby-links':{target:'teamLobbySettings',title:'组队大厅设置',type:'team_lobby_channels',desc:'管理组队大厅 Discord 频道卡片，前台按排序和显示状态读取。',fields:['image','name','description','discordUrl','sort']},
    'meow-butler':{target:'table-meow_butler',title:'喵管家管理',type:'customer_service_widget',desc:'控制首页和老板端右下角客服浮窗。',fields:['displayName','icon','welcomeText','onlineStatus','businessHours','offlineText','clickBehavior','defaultChannel','showRedDot','globalVisible']},
    'sync-center':{target:'table-sync_center',title:'全端功能同步',type:'system_content_versions',desc:'查看各内容模块后台版本、前台版本、发布时间和同步状态。',fields:['moduleName','backendVersion','frontendVersion','syncStatus','publishedBy','publishedAt']},
    'price-table':{target:'table-price_table',title:'俱乐部价格表管理',type:'club_price_tables',desc:'同步陪玩价格范围、下单页面、自定义订单和陪玩端定价限制。',fields:['game','serviceType','level','minPrice','maxPrice','defaultPrice','unit','nightPrice','holidayPrice','sort']},
    gameplays:{target:'table-gameplays',title:'更多玩法管理',type:'fixed_play_services',desc:'同步首页更多玩法、老板下单、陪玩抢单大厅和客服建单。',fields:['name','game','category','cover','intro','fixedPrice','unit','duration','requirements','levelRequired','needQualification','showOnHome','sort']},
    'custom-order-settings':{target:'table-custom_orders',title:'自定义订单设置',type:'custom_order_fields',desc:'配置老板自定义订单页面字段，发布后前台表单同步。',fields:['fieldKey','fieldName','placeholder','fieldType','required','visible','options','min','max','sort']},
    'gameplay-qualifications':{target:'table-gameplay_qualifications',title:'玩法资格审核',type:'gameplay_qualifications',desc:'管理陪玩固定玩法服务资格，审核后同步抢单和建单权限。',fields:['applicationId','uid','nickname','gameplay','materials','auditStatus','reviewer','remark']},
    'companion-rules':{target:'table-companion_rules',title:'陪玩制度管理',type:'player_rules',desc:'发布后同步到申请陪玩第 1 步。',fields:['title','body','versionNote','sort']},
    'voice-types':{target:'table-voice_types',title:'声音类型管理',type:'voice_types',desc:'同步陪玩申请和陪玩资料编辑。',fields:['name','description','sort']},
    'companion-deposit':{target:'table-companion_deposit',title:'陪玩押金设置',type:'player_deposit_settings',desc:'同步陪玩申请和陪玩端认证页面，默认可配置 RM100。',fields:['amount','currency','manualRate','paymentDescription','paymentMethod','refundTerms','refundDescription','auditRequirement']},
    'companion-applications':{target:'table-companion_applications',title:'陪玩申请审核',type:'player_applications',desc:'真实审核工作台，审核通过后开通陪玩端权限。',fields:['applicationNo','uid','nickname','contact','identityDocs','gameProfile','avatar','gallery','voiceSample','depositStatus','auditStatus','reviewer','reviewRemark','level','priceRange','commission','rebate','club']}
  };
  function contentFieldLabel(key){
    var map={title:'标题',desktopImage:'电脑端图片',mobileImage:'手机端图片',link:'跳转地址',discordUrl:'Discord 链接',linkTarget:'打开方式',sort:'排序',startAt:'开始时间',endAt:'结束时间',autoPlay:'自动轮播',intervalSeconds:'轮播秒数',content:'公告内容',displayMode:'展示方式',subtitle:'副标题',image:'广告图',position:'展示位置',carousel:'是否轮播',official:'官方精选',displayName:'显示名称',icon:'图标',welcomeText:'欢迎文案',onlineStatus:'在线状态',businessHours:'营业时间',offlineText:'未营业提示',clickBehavior:'点击行为',defaultChannel:'默认客服频道',showRedDot:'显示红点',globalVisible:'全站显示',moduleName:'模块名称',backendVersion:'后台版本',frontendVersion:'前台版本',syncStatus:'同步状态',publishedBy:'发布人',publishedAt:'发布时间',game:'游戏',serviceType:'服务类型',level:'等级',minPrice:'最低价格',maxPrice:'最高价格',defaultPrice:'默认价格',unit:'计价单位',nightPrice:'夜间价格',holidayPrice:'节假日价格',name:'名称',category:'分类',cover:'封面',intro:'简介',fixedPrice:'固定价格',duration:'服务时长',requirements:'资格要求',levelRequired:'接单等级',needQualification:'需要资格审核',showOnHome:'首页显示',fieldKey:'字段 Key',fieldName:'字段名称',placeholder:'提示文字',fieldType:'字段类型',required:'必填',visible:'显示',options:'选项内容',min:'最小值',max:'最大值',applicationId:'申请编号',uid:'UID',nickname:'昵称',gameplay:'玩法',materials:'资料',auditStatus:'审核状态',reviewer:'审核人',remark:'备注',body:'正文',versionNote:'版本说明',description:'说明',amount:'押金金额',currency:'币种',manualRate:'手动汇率',paymentDescription:'支付说明',paymentMethod:'支付方式',refundTerms:'退款条件',refundDescription:'退款说明',auditRequirement:'审核要求',applicationNo:'申请编号',contact:'联系方式',identityDocs:'身份证资料',gameProfile:'游戏资料',avatar:'头像',gallery:'相册',voiceSample:'录音',depositStatus:'押金状态',reviewRemark:'审核备注',priceRange:'价格范围',commission:'佣金',rebate:'返点',club:'所属俱乐部'};
    return map[key]||key;
  }
  function contentDraft(item){return item&&typeof item.draft==='object'&&item.draft?item.draft:{}}
  function contentPublished(item){return item&&typeof item.published==='object'&&item.published?item.published:{}}
  function platformContentShell(cfg,items,meta){
    items=items||[];
    var rows=items.map(function(item){
      var draft=contentDraft(item),pub=contentPublished(item);
      var image=draft.desktopImage||draft.image||draft.cover||draft.icon||pub.desktopImage||pub.image||pub.cover||'';
      return '<tr data-content-id="'+esc(item.id)+'"><td>'+esc(item.title||draft.title||draft.name||draft.content||'-')+'</td><td>'+statusChip(item.status||'草稿')+'</td><td>'+esc(item.sort||draft.sort||100)+'</td><td>'+esc(item.version||0)+'</td><td>'+esc(item.updated_at||'-')+'</td><td>'+esc(item.published_by||'-')+'</td><td>'+esc(item.published_at||'-')+'</td><td>'+(image?'<img class="content-thumb" src="'+esc(image)+'" alt="">':'-')+'</td><td><div class="content-row-actions"><button class="mini-btn" data-content-action="edit" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">编辑</button><button class="mini-btn" data-content-action="save" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">保存草稿</button><button class="mini-btn primary-lite" data-content-action="publish" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">发布</button><button class="mini-btn" data-content-action="duplicate" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">复制</button><button class="mini-btn" data-content-action="unpublish" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">下架</button><button class="mini-btn danger-btn" data-content-action="delete" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">删除</button></div></td></tr>';
    }).join('');
    return '<div class="platform-content-admin" data-platform-content="'+esc(cfg.type)+'">'+
      '<div class="content-admin-head"><div><h3>'+esc(cfg.title)+'</h3><p>'+esc(cfg.desc)+'</p></div><div class="content-version-meta"><span>最近保存：'+esc(meta&&meta.savedAt||'-')+'</span><span>最近发布人：'+esc(meta&&meta.publisher||'-')+'</span><span>当前版本：'+esc(meta&&meta.version||'0')+'</span><span>前台同步：'+esc(meta&&meta.sync||'待发布')+'</span></div></div>'+
      '<div class="content-admin-toolbar"><input data-content-search="'+esc(cfg.type)+'" placeholder="搜索标题 / 状态 / 内容"><button class="btn primary" data-content-action="new" data-content-type="'+esc(cfg.type)+'" type="button">新增第一条内容</button><button class="btn" data-content-action="reload" data-content-type="'+esc(cfg.type)+'" type="button">刷新</button></div>'+
      '<div class="content-editor" data-content-editor="'+esc(cfg.type)+'" hidden></div>'+
      table(['标题/名称','状态','排序','版本','最近保存','最近发布人','发布时间','预览','操作'],rows)+
      (!items.length?'<div class="content-empty-action"><strong>暂无数据</strong><span>可以直接新增第一条内容，保存草稿后再发布到前台。</span><button class="btn primary" data-content-action="new" data-content-type="'+esc(cfg.type)+'" type="button">新增第一条内容</button></div>':'')+
    '</div>';
  }
  function platformContentForm(cfg,item){
    item=item||{};
    var draft=Object.assign({},contentDraft(item));
    var fields=cfg.fields||['title','sort'];
    var inputs=fields.map(function(field){
      var value=draft[field] == null ? '' : draft[field];
      var upload=/image|cover|icon|avatar|gallery|voice|Docs|Sample/i.test(field);
      var isLong=/content|body|intro|description|rules|remark|terms|Requirement|materials|options/i.test(field);
      var fieldHtml=isLong?'<textarea name="'+esc(field)+'">'+esc(value)+'</textarea>':'<input name="'+esc(field)+'" value="'+esc(value)+'">';
      return '<label><span>'+esc(contentFieldLabel(field))+'</span>'+fieldHtml+(upload?'<input class="content-file" type="file" data-content-upload="'+esc(field)+'" accept="image/*,audio/*,application/pdf"><small>上传后会写入真实文件 URL</small>':'')+'</label>';
    }).join('');
    var directPublish=cfg.type==='banners'||cfg.type==='announcements';
    var currentStatus=item.status||(directPublish?'已发布':'草稿');
    var statusOptions=['草稿','待发布','已发布','已下架','已停用'].map(function(status){return '<option value="'+esc(status)+'" '+(String(currentStatus)===status?'selected':'')+'>'+esc(status)+'</option>';}).join('');
    var currentEnabled=item.enabled!==false;
    var enabledOptions='<option value="true" '+(currentEnabled?'selected':'')+'>启用</option><option value="false" '+(!currentEnabled?'selected':'')+'>停用</option>';
    var submitLabel=directPublish?'保存并应用':'保存草稿';
    return '<form class="platform-content-form" data-content-form="'+esc(cfg.type)+'" data-content-id="'+esc(item.id||'')+'">'+
      '<div class="form-grid">'+inputs+'<label><span>状态</span><select name="status">'+statusOptions+'</select></label><label><span>启用</span><select name="enabled">'+enabledOptions+'</select></label></div>'+
      '<div class="content-preview-box">'+renderContentPreview(cfg,draft)+'</div>'+
      '<div class="form-actions"><button class="btn primary" type="submit">'+submitLabel+'</button><button class="btn" data-content-action="preview" data-content-type="'+esc(cfg.type)+'" type="button">预览</button>'+(item.id?'<button class="btn primary" data-content-action="publish" data-content-type="'+esc(cfg.type)+'" data-content-id="'+esc(item.id)+'" type="button">发布</button>':'')+'<button class="btn" data-content-action="cancel" data-content-type="'+esc(cfg.type)+'" type="button">取消</button></div>'+
    '</form>';
  }
  function renderContentPreview(cfg,draft){
    var image=draft.desktopImage||draft.mobileImage||draft.image||draft.cover||draft.icon||'';
    if(cfg.type==='banners')return '<div class="content-banner-preview">'+(image?'<img src="'+esc(image)+'" alt="">':'<span>Banner 预览：上传图片后显示</span>')+'</div>';
    return '<div class="content-card-preview">'+(image?'<img src="'+esc(image)+'" alt="">':'')+'<strong>'+esc(draft.title||draft.name||draft.content||cfg.title)+'</strong><span>'+esc(draft.subtitle||draft.intro||draft.description||draft.welcomeText||'预览区域')+'</span></div>';
  }
  function renderPlatformContentManagers(){
    Object.keys(platformContentModules).forEach(function(key){loadPlatformContent(platformContentModules[key]);});
  }
  function isLocalPlatformContentType(type){return type==='team_lobby_channels'}
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
  function loadPlatformContent(cfg){
    var target=document.getElementById(cfg.target);
    if(!target)return;
    target.innerHTML='<div class="content-loading">正在读取真实数据库...</div>';
    fetch('/api/admin/platform-content?type='+encodeURIComponent(cfg.type),{headers:{'x-mcj-admin-role':getRole()}}).then(function(res){var ct=res.headers.get('content-type')||'';if(ct.indexOf('application/json')<0)return {ok:true,configured:false,items:[],message:'本地 API 未启用平台内容接口'};return res.json();}).then(function(result){
      var items=result.items||[];
      if(isLocalPlatformContentType(cfg.type)&&(!result.configured||!items.length)){items=readLocalPlatformContent(cfg.type);}
      var latest=items[0]||{};
      target.innerHTML=platformContentShell(cfg,items,{savedAt:latest.updated_at,publisher:latest.published_by,version:latest.version,sync:latest.status||'暂无数据'});
    }).catch(function(err){
      console.error('[Banner 管理] 读取接口错误',{endpoint:'/api/admin/platform-content',type:cfg.type,error:err});
      var items=isLocalPlatformContentType(cfg.type)?readLocalPlatformContent(cfg.type):[];
      var latest=items[0]||{};
      target.innerHTML=platformContentShell(cfg,items,{savedAt:latest.updated_at,publisher:latest.published_by,version:latest.version,sync:items.length?(latest.status||'本地预览'):'读取失败'})+(items.length?'':'<div class="admin-sync-note">读取失败：'+esc(err.message||err)+'</div>');
    });
  }
  function platformContentConfig(type){
    var found=null;
    Object.keys(platformContentModules).some(function(key){if(platformContentModules[key].type===type){found=platformContentModules[key];return true;}return false;});
    return found;
  }
  function collectPlatformContentForm(form){
    var draft={};
    new FormData(form).forEach(function(value,key){if(value instanceof File)return;draft[key]=value;});
    return {title:draft.title||draft.name||draft.content||draft.displayName||draft.moduleName||draft.fieldName||'未命名内容',status:form.querySelector('[name="status"]')?form.querySelector('[name="status"]').value:'草稿',enabled:(form.querySelector('[name="enabled"]')||{}).value!=='false',sort:Number(draft.sort||100),draft:draft};
  }
  function submitPlatformContent(action,type,id,payload){
    fetch('/api/admin/platform-content',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,type:type,id:id||'',payload:payload||{}})}).then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(parseErr){console.error('[Banner 管理] 保存接口非 JSON',{status:res.status,body:text,error:parseErr});throw new Error('平台内容接口返回非 JSON：HTTP '+res.status)}if(!res.ok||body.ok===false)throw new Error(body.message||('HTTP '+res.status));return body;})}).then(function(result){alert(result.message||'已保存');var cfg=platformContentConfig(type);if(cfg)loadPlatformContent(cfg);}).catch(function(err){console.error('[Banner 管理] 保存接口错误',{endpoint:'/api/admin/platform-content',action:action,type:type,id:id,error:err});if(isLocalPlatformContentType(type)){applyLocalPlatformContentAction(action,type,id||'',payload||{});alert('接口暂不可用，已使用当前后台保存方式保存内容。');var cfg=platformContentConfig(type);if(cfg)loadPlatformContent(cfg);return;}alert('操作失败：'+err.message+'。');});
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
    fetch('/api/admin/platform-content?type='+encodeURIComponent(type),{headers:{'x-mcj-admin-role':getRole()}}).then(function(res){return res.json();}).then(function(result){
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
    if(file.size>4*1024*1024){alert("文件不能超过 4MB");return;}
    var form=input.closest('[data-content-form]');
    var field=input.dataset.contentUpload;
    var type=form?form.dataset.contentForm:'platform-content';
    function applyUploadUrl(url,localOnly){
      var target=form&&form.querySelector('[name="'+field+'"]');
      if(target)target.value=url;
      if(form){var cfg=platformContentConfig(type);var box=form.querySelector('.content-preview-box');if(box)box.innerHTML=renderContentPreview(cfg,collectPlatformContentForm(form).draft);}
      alert(localOnly?'上传接口暂不可用，已使用所选图片生成当前页面预览，请点击保存。':'上传成功');
    }
    var reader=new FileReader();
    reader.onload=function(){
      fetch('/api/admin/platform-content-upload',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({type:type,fileName:file.name,mimeType:file.type,base64:reader.result})}).then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(parseErr){console.error('[Banner 管理] 上传接口非 JSON',{status:res.status,body:text,error:parseErr});throw new Error('上传接口返回非 JSON：HTTP '+res.status)}if(!res.ok||body.ok===false)throw new Error(body.message||('HTTP '+res.status));return body;})}).then(function(result){applyUploadUrl(result.url,false);}).catch(function(err){console.error('[Banner 管理] 上传接口错误',{endpoint:'/api/admin/platform-content-upload',type:type,file:{name:file.name,size:file.size,mimeType:file.type},error:err});if(type!=='banners'&&isLocalPlatformContentType(type)&&/^image\//.test(file.type)){applyUploadUrl(reader.result,true);return;}alert('上传失败：'+err.message+'。');});
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
    return fetch('/api/admin/platform-content?type='+encodeURIComponent(type),{headers:{'x-mcj-admin-role':getRole()}}).then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(err){throw new Error('平台内容接口返回非 JSON：HTTP '+res.status)}if(!res.ok||body.ok===false)throw new Error(body.message||('HTTP '+res.status));return body;})});
  }
  function savePlatformContentStrict(action,type,id,payload){
    return fetch('/api/admin/platform-content',{method:'POST',headers:{'Content-Type':'application/json','x-mcj-admin-role':getRole()},body:JSON.stringify({action:action,type:type,id:id||'',payload:payload||{}})}).then(function(res){return res.text().then(function(text){var body={};try{body=text?JSON.parse(text):{}}catch(err){throw new Error('平台内容接口返回非 JSON：HTTP '+res.status)}if(!res.ok||body.ok===false)throw new Error(body.message||('HTTP '+res.status));return body;})});
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
      if(slug==='more-gameplays')loadHomeMoreGameplays();
      drawer.scrollIntoView({behavior:'smooth',block:'nearest'});
    }).catch(function(err){alert('读取入口配置失败：'+err.message);});
  }
  function homeEntryEditor(entry){
    var special='';
    if(entry.slug==='team-lobby')special='<section class="home-entry-special"><h3>频道卡片管理</h3><p>手游组队、端游组队和闲聊频道统一在这里配置，左侧不再单独展示组队大厅设置。</p><div id="homeTeamChannelCards" class="home-entry-channel-grid"><div class="content-loading">正在读取频道卡片...</div></div></section>';
    if(entry.slug==='more-gameplays')special='<section class="home-entry-special"><h3>更多玩法内容管理</h3><p>更多玩法设置已收进首页入口管理，原独立左侧菜单已隐藏。</p><div id="homeMoreGameplaysMount"></div></section>';
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
    dashboard:['仪表盘','平台核心数据与待处理事项'],
    bosses:['老板管理','老板账号、钱包、订单与邀请关系'],
    players:['陪玩管理','陪玩资料、等级、审核、接单状态与收益'],
    'companion-levels':['陪玩等级','等级名称、价格范围、升级条件、开放申请与展示颜色'],
    service:['客服管理','客服账号、会话、工单和工资'],
    orders:['订单管理','平台订单状态、售后和结算'],
    'recharge-center':['充值中心','充值申请与付款凭证审核'],
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
    'team-lobby-links':['组队大厅设置','Discord 频道卡片、卡面图片、排序和跳转链接'],
    'meow-butler':['喵管家管理','在线客服入口与快捷入口配置'],
    'sync-center':['全端功能同步','用户端、老板端、陪玩端、客服端数据同步'],
    'price-table':['俱乐部价格表管理','俱乐部服务价格范围和规则'],
    gameplays:['更多玩法管理','护航单、跑刀单、代肝单、趣味单'],
    'custom-order-settings':['自定义订单设置','自定义订单字段、规则和价格限制'],
    'gameplay-qualifications':['玩法资格审核','陪玩固定玩法服务资格审核'],
    'companion-rules':['陪玩制度管理','陪玩制度内容与展示状态'],
    'voice-types':['声音类型管理','声音标签、分类和筛选项'],
    'companion-deposit':['陪玩押金设置','押金金额、审核规则和状态'],
    'companion-applications':['陪玩申请审核','陪玩入驻申请、资料和认证审核'],
    messages:['消息中心','全端聊天会话、客服接管、订单卡片与消息记录'],
    statistics:['统计中心','平台统计、趋势和报表'],
    'admin-accounts':['\u8d26\u53f7\u7ba1\u7406','\u521b\u5efa\u5ba2\u670d\u3001\u966a\u73a9\u548c\u8001\u677f\u8d26\u53f7'],
    permissions:['权限系统','角色权限和访问边界'],
    vip:['VIP 设置','VIP 等级、门槛和权益'],
    payment:['支付设置','支付渠道、收款资料和启用状态'],
    settings:['系统设置','平台基础配置'],
    logs:['操作日志','管理员登录、编辑、审核和敏感操作记录']
  };
  function setTitle(name){
    var meta=sectionTitles[name]||[name,''];
    var title=document.getElementById('pageTitle');
    var sub=document.getElementById('pageSubtitle');
    if(title)title.textContent=meta[0];
    if(sub)sub.textContent=meta[1]||'';
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
    function updateTitle(activeName,target,label){
      if(sectionTitles[activeName]){setTitle(activeName);return;}
      if(sectionTitles[target]){setTitle(target);return;}
      var title=document.getElementById('pageTitle');
      var sub=document.getElementById('pageSubtitle');
      if(title)title.textContent=label||activeName;
      if(sub)sub.textContent='该功能正在接入中';
    }
    function activate(btn){
      var activeName=btn&&btn.dataset?btn.dataset.section:'';
      if(!activeName)return;
      var target=targetName(btn);
      var label=buttonLabel(btn);
      var sec=ensureSection(target,label);
      sideButtons.forEach(function(b){b.classList.toggle('active',b.dataset.section===activeName)});
      document.querySelectorAll('.section').forEach(function(s){s.classList.toggle('active',sec&&s===sec)});
      var group=btn.closest('.nav-group');
      if(group){
        group.classList.add('open');
        var parent=document.querySelector('[data-toggle-group="'+group.dataset.group+'"]');
        if(parent)parent.setAttribute('aria-expanded','true');
      }
      updateTitle(activeName,target,label);
    }
    document.querySelectorAll('.side-nav button').forEach(function(btn){btn.disabled=false;btn.style.pointerEvents='auto'});
    buttons.forEach(function(btn){btn.addEventListener('click',function(e){
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
      var app=document.querySelector('.admin-app');
      if(!sidebar)return;
      sidebar.classList.toggle('collapsed');
      if(app)app.classList.toggle('sidebar-collapsed',sidebar.classList.contains('collapsed'));
      collapse.textContent=sidebar.classList.contains('collapsed')?'展开':'收起菜单';
    });
    var initialBtn=document.querySelector('.side-nav [data-section="dashboard"]');
    if(initialBtn)activate(initialBtn);else setTitle('dashboard');
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
  function bindGlobal(){document.addEventListener('click',function(e){var role=e.target.closest('[data-role-login]');if(role){localStorage.setItem('mcjRole',role.dataset.roleLogin);routeByRole(role.dataset.roleLogin);return;}var logout=e.target.closest('[data-admin-logout]');if(logout){localStorage.removeItem('mcjRole');location.href='index.html';return;}var preview=e.target.closest('[data-preview-home]');if(preview){location.href='index.html';return;}var saveLevels=e.target.closest('[data-save-companion-levels]');if(saveLevels&&levelApi()){levelApi().save(collectCompanionLevels());log('保存陪玩等级与价格设置');alert('已保存陪玩等级与价格设置');renderCompanionLevels();return;}var deleteLevel=e.target.closest('[data-delete-companion-level]');if(deleteLevel&&levelApi()){var levels=getLevels();var level=levelApi().find(deleteLevel.dataset.deleteCompanionLevel);if(playerLevelCount(level)>0){alert('该等级已有陪玩，不能直接删除。请先停用该等级或迁移陪玩等级。');return;}if(confirm('确认删除 '+levelLabel(level.id)+'？')){levelApi().save(levels.filter(function(item){return item.id!==level.id}));log('删除陪玩等级 '+levelLabel(level.id));renderCompanionLevels();}return;}var action=e.target.closest('[data-action]');if(action){alert('已执行：'+action.dataset.action+' / '+(action.dataset.id||''));log('执行 '+action.dataset.action);return;}var del=e.target.closest('[data-delete]');if(del){var arr=read(del.dataset.delete);arr.splice(Number(del.dataset.index),1);write(del.dataset.delete,arr);location.reload();return;}})}
  function initForms(){document.querySelectorAll('[data-save-settings]').forEach(function(btn){btn.addEventListener('click',function(){var settings={siteName:val('siteName'),logoUrl:val('logoUrl'),customerServiceUrl:val('customerServiceUrl'),discordInviteUrl:val('discordInviteUrl'),whatsappUrl:val('whatsappUrl'),maintenanceMode:val('maintenanceMode'),registerOpen:val('registerOpen'),seoTitle:val('seoTitle')};localStorage.setItem('mcj_siteSettings',JSON.stringify(settings));log('保存平台设置');alert('已保存平台设置');})});document.querySelectorAll('[data-add-row]').forEach(function(btn){btn.addEventListener('click',function(){var key=btn.dataset.addRow;var arr=read(key);arr.unshift({id:key.toUpperCase().slice(0,2)+Date.now(),title:val('crudTitle'),name:val('crudTitle'),content:val('crudDesc'),description:val('crudDesc'),image:val('crudImage')||'assets/meow-cuijiao-brand.jpg',status:'开启',sort:arr.length+1});write(key,arr);alert('已新增');location.reload();})})}
  function bindPaymentAdmin(){
    document.addEventListener('click',function(e){
      var saveLevels=e.target.closest('[data-save-companion-levels]');
      if(saveLevels){e.preventDefault();e.stopPropagation();submitCompanionLevelsSecure();return;}
      var deleteLevel=e.target.closest('[data-delete-companion-level]');
      if(deleteLevel){e.preventDefault();e.stopPropagation();submitCompanionLevelsSecure();return;}
    },true);
    document.addEventListener('click',function(e){
      var profileToggle=e.target.closest('[data-admin-profile-toggle]');if(profileToggle){profileToggle.closest('.admin-profile-menu').classList.toggle('open');return;}
      if(!e.target.closest('.admin-profile-menu'))document.querySelectorAll('.admin-profile-menu.open').forEach(function(menu){menu.classList.remove('open')});
      var profileJump=e.target.closest('.admin-profile-dropdown [data-section]');if(profileJump){var pnav=document.querySelector('.side-nav [data-section="'+profileJump.dataset.section+'"]');if(pnav)pnav.click();return;}
      var jump=e.target.closest('.todo-item[data-section],.activity-item[data-section]');if(jump){var nav=document.querySelector('.side-nav [data-section="'+jump.dataset.section+'"]');if(nav)nav.click();return;}
      var bossAction=e.target.closest('[data-boss-action]');if(bossAction){var bossAct=bossAction.dataset.bossAction,bossId=bossAction.dataset.bossId;if(bossAct==='view'){openBossDetail(bossId);return;}if(/boss-id|balance|vip|restrict|freeze|blacklist|reset/.test(bossAct)&&!confirm('确认执行该老板敏感操作？'))return;submitBossSecure(bossAct,bossId,{});return;}
      var bossBulk=e.target.closest('[data-boss-bulk]');if(bossBulk){submitBossSecure('bulk-'+bossBulk.dataset.bossBulk,'selected',{});return;}
      var orderAction=e.target.closest('[data-order-action]');if(orderAction){var orderAct=orderAction.dataset.orderAction,orderId=orderAction.dataset.orderId;if(orderAct==='view'){openOrderDetail(orderId);return;}var risky=/cancel|refund|early-end|confirm-complete|return-service|blacklist|compensate|reject|approve|partial/.test(orderAct);var reason='';if(risky){reason=prompt('该订单操作需要记录原因，请填写原因：')||'';if(!reason.trim())return;}submitOrderAction(orderAct,orderId,{reason:reason});return;}
      if(e.target.closest('[data-order-export]')){submitOrderAction('export','all',{});return;}
      if(e.target.closest('[data-order-create-service]')){submitOrderAction('service-create','new',{});return;}
      if(e.target.closest('[data-order-dev-test]')){submitOrderAction('create-test-order','dev',{});return;}
      var chatItem=e.target.closest('[data-admin-chat-id]');if(chatItem){adminMessageState.activeId=chatItem.dataset.adminChatId;renderAdminMessageCenter();return;}
      var chatFilter=e.target.closest('[data-admin-chat-filter]');if(chatFilter){var wrap=chatFilter.closest('.admin-chat-sidebar');if(wrap){wrap.querySelectorAll('[data-admin-chat-filter]').forEach(function(btn){btn.classList.remove('active')});chatFilter.classList.add('active');filterAdminChats();}return;}
      var chatSend=e.target.closest('[data-chat-send]');if(chatSend){var input=document.querySelector('[data-chat-input]');var text=input?input.value.trim():'';if(!text){alert('请输入消息内容');return;}submitAdminChatAction('send_message',adminMessageState.activeId,{type:'text',content:text});if(input)input.value='';return;}
      var chatAction=e.target.closest('[data-chat-action]');if(chatAction){var action=chatAction.dataset.chatAction;if(/blacklist|delete/.test(action)&&!confirm('确认执行该敏感聊天操作？'))return;submitAdminChatAction(action,adminMessageState.activeId,{});return;}
      var chatTool=e.target.closest('[data-chat-tool]');if(chatTool){submitAdminChatAction('tool_'+chatTool.dataset.chatTool,adminMessageState.activeId,{});return;}
      var chatMessageAction=e.target.closest('[data-chat-message-action]');if(chatMessageAction){var msg=chatMessageAction.closest('[data-message-id]');submitAdminChatAction(chatMessageAction.dataset.chatMessageAction,adminMessageState.activeId,{messageId:msg?msg.dataset.messageId:''});return;}
      var homeReload=e.target.closest('[data-home-entry-reload]');if(homeReload){renderHomeEntryManager();return;}var homeEdit=e.target.closest('[data-home-entry-edit]');if(homeEdit){openHomeEntryEditor(homeEdit.dataset.homeEntryEdit);return;}var homeClose=e.target.closest('[data-home-entry-close]');if(homeClose){var drawer=document.querySelector('[data-home-entry-drawer]');if(drawer){drawer.hidden=true;drawer.innerHTML='';}return;}var contentAction=e.target.closest('[data-content-action]');if(contentAction){var ctype=contentAction.dataset.contentType,cid=contentAction.dataset.contentId,act=contentAction.dataset.contentAction;if(act==='new'){openPlatformContentEditor(ctype,'');return;}if(act==='edit'){openPlatformContentEditor(ctype,cid);return;}if(act==='cancel'){var editor=document.querySelector('[data-content-editor="'+ctype+'"]');if(editor){editor.hidden=true;editor.innerHTML='';}return;}if(act==='reload'){var cfg=platformContentConfig(ctype);if(cfg)loadPlatformContent(cfg);return;}if(act==='preview'){var form=document.querySelector('[data-content-form="'+ctype+'"]');if(form){var cfgp=platformContentConfig(ctype);var box=form.querySelector('.content-preview-box');if(box)box.innerHTML=renderContentPreview(cfgp,collectPlatformContentForm(form).draft);}return;}if(/delete|unpublish|disable/.test(act)&&!confirm('确认执行该内容操作？'))return;if(act==='save'){var editForm=document.querySelector('[data-content-form="'+ctype+'"][data-content-id="'+cid+'"]');submitPlatformContent('save',ctype,cid,editForm?collectPlatformContentForm(editForm):{});return;}submitPlatformContent(act,ctype,cid,{});return;}
      var playerAction=e.target.closest('[data-player-action]');if(playerAction){var action=playerAction.dataset.playerAction,id=playerAction.dataset.playerId;if(action==='view'){openPlayerDetail(id);return;}submitPlayerSecure(action,id,{});return;}
      var playerBulk=e.target.closest('[data-player-bulk]');if(playerBulk){submitPlayerSecure('bulk-'+playerBulk.dataset.playerBulk,'selected',{});return;}
      var ptab=e.target.closest('[data-payment-tab]');if(ptab){renderPaymentSettings(ptab.dataset.paymentTab);return;}
      var pedit=e.target.closest('[data-payment-edit]');if(pedit){renderPaymentSettings('channels',pedit.dataset.paymentEdit);return;}
      var pcancel=e.target.closest('[data-payment-cancel]');if(pcancel){renderPaymentSettings('channels');return;}
      var psecrettoggle=e.target.closest('[data-payment-secret-toggle]');if(psecrettoggle){var input=psecrettoggle.closest('.payment-secret-row').querySelector('input');if(input){input.type=input.type==='password'?'text':'password';psecrettoggle.textContent=input.type==='password'?'显示':'隐藏';}return;}
      var ptoggle=e.target.closest('[data-payment-toggle]');if(ptoggle){alert('启用或停用支付渠道属于敏感操作，请在支付安全接口接入后由超级管理员或财务管理员二次确认执行。');return;}
      var ptest=e.target.closest('[data-payment-test]');if(ptest){alert('测试事件只会发送到支付安全接口，不会修改真实订单或余额。当前接口未连接，未发送。');return;}
      var whsave=e.target.closest('[data-webhook-save]');if(whsave){alert('Webhook Secret 只能保存到服务器安全环境，当前未写入浏览器本地数据。');return;}
      var whtest=e.target.closest('[data-webhook-test]');if(whtest){alert('Webhook 测试不会修改真实订单或余额。当前支付安全接口未连接，未发送。');return;}
    });
    document.addEventListener('input',function(e){if(e.target.matches('[data-admin-chat-search]'))filterAdminChats();if(e.target.matches('[data-order-search]'))filterOrders();});
    document.addEventListener('change',function(e){if(e.target.matches('[data-content-upload]'))uploadPlatformContentFile(e.target);});
    document.addEventListener('keydown',function(e){if(e.target.matches('[data-chat-input]')&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();var send=document.querySelector('[data-chat-send]');if(send)send.click();}});
    document.addEventListener('submit',function(e){var homeEntry=e.target.closest('[data-home-entry-form]');if(homeEntry){e.preventDefault();submitHomeEntryForm(homeEntry);return;}var homeChannel=e.target.closest('[data-home-channel-form]');if(homeChannel){e.preventDefault();submitHomeChannelForm(homeChannel);return;}var content=e.target.closest('[data-content-form]');if(content){e.preventDefault();var id=content.dataset.contentId;var type=content.dataset.contentForm;submitPlatformContent(id?'save':'create',type,id,collectPlatformContentForm(content));return;}var payment=e.target.closest('[data-payment-form],[data-payment-secure-form]');if(payment){e.preventDefault();submitSecurePayment(payment);}});
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
    if(!actions||actions.dataset.enhanced)return;
    actions.dataset.enhanced='1';
    var orders=read('orders'), players=read('players'), tickets=read('customer_tickets');
    var pendingOrders=orders.filter(function(x){return !/完成|取消|退款|关闭/.test(String(x.status||''))}).length;
    var onlinePlayers=players.filter(function(x){return /在线|可接|鍦ㄧ嚎|鍙帴/.test(String(x.status||x.order_status||''))}).length;
    var onlineService=tickets.filter(function(x){return /在线|处理|澶勭悊/.test(String(x.status||''))}).length;
    actions.insertAdjacentHTML('afterbegin','<input class="admin-search" type="search" placeholder="搜索订单 / 用户 / 陪玩 / 模块"><span class="admin-top-stat online">服务器 <b>正常</b></span><span class="admin-top-stat online">客服 <b>'+onlineService+'</b></span><span class="admin-top-stat online">陪玩 <b>'+onlinePlayers+'</b></span><span class="admin-top-stat warn">待处理 <b>'+pendingOrders+'</b></span><div class="admin-profile-menu"><button class="admin-avatar-btn" type="button" title="管理员资料" data-admin-profile-toggle>A</button><div class="admin-profile-dropdown"><button type="button" data-section="admin-accounts">个人资料</button><button type="button" data-section="permissions">修改密码</button><button type="button" data-section="logs">登录日志</button><button type="button" data-admin-logout>退出登录</button></div></div>');
  }
  function renderDashboardExperience(){
    var dash=document.getElementById('section-dashboard');
    if(!dash||dash.dataset.enhanced)return;
    dash.dataset.enhanced='1';
    var pending=document.getElementById('dashboardPending');
    if(pending){
      var players=read('players'), withdraws=read('withdraw_requests'), refunds=read('refunds'), tickets=read('customer_tickets'), reviews=read('reviews');
      var items=[
        ['待审核陪玩',players.filter(function(x){return /待|寰呭/.test(String(x.audit||x.status||''))}).length,'players'],
        ['待审核提现',withdraws.filter(function(x){return /待|寰呭/.test(String(x.status||''))}).length,'withdraw'],
        ['待处理退款',refunds.filter(function(x){return /待|退款|处理中/.test(String(x.status||''))}).length,'refunds'],
        ['待回复工单',tickets.filter(function(x){return /待|处理/.test(String(x.status||''))}).length,'service'],
        ['待审核评论',reviews.filter(function(x){return /待|审核/.test(String(x.status||''))}).length,'logs']
      ];
      pending.innerHTML='<div class="todo-list">'+items.map(function(item){return '<button class="todo-item" type="button" data-section="'+item[2]+'"><span class="todo-icon">'+item[1]+'</span><span><strong>'+esc(item[0])+'</strong><span>点击进入对应模块处理</span></span><span class="status '+(item[1]?'wait':'ok')+'">'+(item[1]?'待处理':'已清空')+'</span></button>'}).join('')+'</div>';
    }
    var logsTarget=document.getElementById('table-admin_logs');
    if(logsTarget){
      var logs=read('admin_logs').slice(0,6);
      logsTarget.innerHTML='<div class="activity-list">'+(logs.length?logs.map(function(item){return '<button class="activity-item" type="button" data-section="logs"><span class="activity-avatar">'+esc(String(item.admin||'A').slice(0,1).toUpperCase())+'</span><span><strong>'+esc(item.admin||'admin')+'</strong><span>'+esc(item.action||'-')+'</span><small>'+esc(item.time||'-')+' · 当前设备 · 内网 IP</small></span><span class="status info">详情</span></button>'}).join(''):'<div class="empty">暂无操作记录</div>')+'</div>';
    }
    dash.insertAdjacentHTML('beforeend','<div class="admin-chart-grid"><section class="admin-chart-card"><h3>今日订单趋势</h3>'+chartBars([15,28,36,20,44,33,52])+'</section><section class="admin-chart-card"><h3>营业额趋势</h3>'+chartBars([22,18,40,31,46,52,58])+'</section><section class="admin-chart-card"><h3>平台利润趋势</h3>'+chartBars([12,18,24,30,28,40,45])+'</section><section class="admin-chart-card"><h3>陪玩新增趋势</h3>'+chartBars([6,10,8,12,16,14,18])+'</section><section class="admin-chart-card"><h3>老板新增趋势</h3>'+chartBars([8,13,18,15,22,25,30])+'</section><section class="admin-chart-card"><h3>充值趋势</h3>'+chartBars([10,22,19,32,44,38,50])+'</section></div>');
  }
  function chartBars(values){
    var max=Math.max.apply(null,values.concat([1]));
    return '<div class="admin-bars" aria-label="最近7天">'+values.map(function(v){return '<i style="height:'+Math.max(6,Math.round(v/max*100))+'%"></i>'}).join('')+'</div><div class="table-footer"><span>最近7天</span><span>可扩展 30天 / 一年</span></div>';
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
      if(pass){var next=prompt('\u8f93\u5165\u65b0\u5bc6\u7801');if(!next)return;var rows=v1Read('mcj_v1_accounts',[]);rows.forEach(function(x){if(x.id===pass.dataset.v1PasswordAccount){x.password=next;x.updatedAt=v1Now();}});v1Write('mcj_v1_accounts',rows);log('\u4fee\u6539 V1 \u8d26\u53f7\u5bc6\u7801');renderV1AccountManagement();return;}
      var tog=e.target.closest('[data-v1-toggle-account]');
      if(tog){var rows2=v1Read('mcj_v1_accounts',[]);rows2.forEach(function(x){if(x.id===tog.dataset.v1ToggleAccount){x.status=x.status==='ENABLED'?'DISABLED':'ENABLED';x.updatedAt=v1Now();}});v1Write('mcj_v1_accounts',rows2);log('\u5207\u6362 V1 \u8d26\u53f7\u72b6\u6001');renderV1AccountManagement();return;}
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
      renderV1AccountManagement();
    });
  }
  function initSuperAdmin(){
    var dash=document.getElementById('superStats');
    var orders=read('orders'), bosses=read('bosses'), players=read('players'), withdraws=read('withdraw_requests'), refunds=read('refunds'), logs=read('admin_logs'), tickets=read('customer_tickets');
    var today=new Date().toLocaleDateString('zh-CN');
    var todayOrders=orders.filter(function(o){return String(o.time||o.created_at||o.createdAt||'').indexOf(today)>-1});
    var completedToday=todayOrders.filter(function(o){return /完成|已完成/.test(String(o.status||''))});
    var revenue=todayOrders.reduce(function(n,o){return n+Number(String(o.amount||0).replace(/[^\d.-]/g,''));},0);
    if(dash)statCards(dash,[
      {label:'今日订单',value:todayOrders.length},
      {label:'今日营业额',value:'RM'+revenue.toFixed(2)},
      {label:'平台利润',value:'RM0.00'},
      {label:'新增老板',value:bosses.filter(function(x){return String(x.registered_at||x.createdAt||'').indexOf(today)>-1}).length},
      {label:'新增陪玩',value:players.filter(function(x){return String(x.registered_at||x.createdAt||'').indexOf(today)>-1}).length},
      {label:'待审核陪玩',value:players.filter(function(x){return /待审核|审核中/.test(String(x.audit||x.status||''))}).length},
      {label:'待审核提现',value:withdraws.filter(function(x){return /待审核|审核中/.test(String(x.status||''))}).length},
      {label:'待处理退款',value:refunds.filter(function(x){return /待审核|退款中|处理中/.test(String(x.status||''))}).length},
      {label:'进行中订单',value:orders.filter(function(x){return /进行中/.test(String(x.status||''))}).length},
      {label:'客服在线人数',value:tickets.filter(function(x){return /在线|处理中/.test(String(x.status||''))}).length}
    ]);
    var pending=document.getElementById('dashboardPending');
    if(pending)pending.innerHTML='<div class="detail-list"><div><span>今日完成订单</span><strong>'+completedToday.length+'</strong></div><div><span>待审核提现</span><strong>'+withdraws.filter(function(x){return /待审核|审核中/.test(String(x.status||''))}).length+'</strong></div><div><span>待处理退款</span><strong>'+refunds.filter(function(x){return /待审核|退款中|处理中/.test(String(x.status||''))}).length+'</strong></div></div>';
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
      announcements:[{key:'id',label:'公告ID'},{key:'title',label:'标题'},{key:'content',label:'内容'},{key:'enabled',label:'状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      admin_logs:[{key:'id',label:'日志ID'},{key:'admin',label:'管理员'},{key:'action',label:'操作内容'},{key:'time',label:'时间'}],
      recharge_requests:[{key:'id',label:'充值单号'},{key:'user',label:'用户'},{key:'amount',label:'金额'},{key:'coins',label:'喵币'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      refunds:[{key:'id',label:'退款单号'},{key:'order_id',label:'订单号'},{key:'user',label:'用户'},{key:'amount',label:'金额'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      role_permissions:[{key:'role',label:'角色'},{key:'scope',label:'权限范围'},{key:'actions',label:'操作',type:'actions'}]
    };
    Object.keys(tables).forEach(function(key){var target=document.getElementById('table-'+key);if(target)renderGenericTable(key,target,tables[key]);});
    var rechargeAlt=document.getElementById('table-recharge_requests_alt');if(rechargeAlt)renderGenericTable('recharge_requests',rechargeAlt,tables.recharge_requests);
    var logsFull=document.getElementById('table-admin_logs_full');if(logsFull)renderGenericTable('admin_logs',logsFull,tables.admin_logs);
    var dashboardBosses=document.getElementById('table-dashboard-bosses');
    if(dashboardBosses)renderGenericTable('bosses',dashboardBosses,tables.bosses);
    var dashboardPlayers=document.getElementById('table-dashboard-players');
    if(dashboardPlayers)renderGenericTable('players',dashboardPlayers,tables.players);
    ['banners','players','announcements'].forEach(function(key){var t=document.getElementById('crud-'+key);if(t)renderCrud(key,t)});
    [
      ['crud-ads','暂无广告位数据'],
      ['table-meow_butler','暂无喵管家配置'],
      ['table-sync_center','暂无同步记录'],
      ['table-price_table','暂无价格表数据'],
      ['table-gameplays','暂无玩法数据'],
      ['table-custom_orders','暂无自定义订单设置'],
      ['table-gameplay_qualifications','暂无玩法资格审核'],
      ['table-companion_rules','暂无陪玩制度内容'],
      ['table-voice_types','暂无声音类型数据'],
      ['table-companion_deposit','暂无押金设置'],
      ['table-companion_applications','暂无陪玩申请'],
      ['statisticsPanel','暂无统计数据'],
      ['table-admin_accounts','暂无管理员账号数据'],
      ['table-vip_settings','暂无 VIP 设置'],
      ['paymentSettings','暂无支付方式配置'],
      ['systemSettings','暂无系统设置']
    ].forEach(function(item){emptyPanel(item[0],item[1])});
    renderBossManagement();
    renderOrderManagement();
    renderPlayerManagement();
    renderAdminMessageCenter();
    renderPaymentSettings();
    renderCompanionLevelAdmin();
    renderPlatformContentManagers();
    renderV1AccountManagement();
    enhanceAdminShell();
  }
  function initClubAdmin(){var dash=document.getElementById('clubStats');if(dash)statCards(dash,[{label:'今日营业额',value:'RM3,820'},{label:'今日订单',value:'42'},{label:'本月营业额',value:'RM86,500'},{label:'陪玩人数',value:'36'},{label:'待处理订单',value:'9'},{label:'可提现余额',value:'RM12,800'}]);var clubPlayers=read('players').filter(function(p){return p.club==='妙脆角主俱乐部'});var target=document.getElementById('clubPlayers');if(target)target.innerHTML=table(['头像','昵称','游戏','建议价','评分','状态','操作'],clubPlayers.map(function(p){return '<tr><td><img class="avatar" src="'+esc(p.avatar)+'"></td><td>'+esc(p.name)+'</td><td>'+esc(p.game)+'</td><td>'+esc(p.price)+'</td><td>'+esc(p.rating)+'</td><td>'+statusChip(p.status)+'</td><td>'+actionButtons(p.id)+'</td></tr>'}));var orders=read('orders').filter(function(o){return o.club==='妙脆角主俱乐部'});var ot=document.getElementById('clubOrders');if(ot)ot.innerHTML=table(['订单','老板','陪玩','游戏','金额','状态','时间','操作'],orders.map(function(o){return '<tr><td>'+o.id+'</td><td>'+o.boss+'</td><td>'+o.player+'</td><td>'+o.game+'</td><td>'+o.amount+'</td><td>'+statusChip(o.status)+'</td><td>'+o.time+'</td><td>'+actionButtons(o.id)+'</td></tr>'}))}
  function initPlayerAdmin(){var dash=document.getElementById('playerStats');if(dash)statCards(dash,[{label:'今日订单',value:'6'},{label:'本月订单',value:'84'},{label:'收入',value:'RM3,260'},{label:'评分',value:'5.0'},{label:'完成率',value:'99%'},{label:'可提现余额',value:'RM860'}]);var myOrders=read('orders').filter(function(o){return o.player==='MOMO'});var ot=document.getElementById('playerOrders');if(ot)ot.innerHTML=table(['订单','老板','游戏','金额','状态','时间','接单操作'],myOrders.map(function(o){return '<tr><td>'+o.id+'</td><td>'+o.boss+'</td><td>'+o.game+'</td><td>'+o.amount+'</td><td>'+statusChip(o.status)+'</td><td>'+o.time+'</td><td><div class="row"><button class="btn small primary" data-action="accept" data-id="'+o.id+'">接受</button><button class="btn small danger" data-action="reject" data-id="'+o.id+'">拒绝</button><button class="btn small" data-action="complete" data-id="'+o.id+'">完成</button></div></td></tr>'}));var reviews=read('reviews').filter(function(r){return r.player==='MOMO'});var rt=document.getElementById('playerReviews');if(rt)rt.innerHTML=table(['订单','评分','评价','状态'],reviews.map(function(r){return '<tr><td>'+r.order_id+'</td><td>'+r.rating+'</td><td>'+r.content+'</td><td>'+statusChip(r.status)+'</td></tr>'}))}
  document.addEventListener('DOMContentLoaded',function(){enforceRole();initTabs();bindGlobal();bindPaymentAdmin();initForms();initSuperAdmin();renderHomeEntryManager();initClubAdmin();initPlayerAdmin();initTableSearch();bindV1AccountManagement();});
  window.MCJAdmin={read:read,write:write,routeByRole:routeByRole};
})();
