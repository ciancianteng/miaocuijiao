(function(){
  var DB_KEYS=['users','bosses','clubs','players','orders','wallets','wallet_transactions','recharge_requests','withdraw_requests','invite_rebates','customer_tickets','reviews','games','banners','announcements','admin_logs','role_permissions','companionLevels'];
  var defaultDb={
    users:[{id:'U001',name:'夜色老板',role:'boss',status:'正常',balance:'320喵币'},{id:'U002',name:'MOMO',role:'player',status:'在线',balance:'RM860'},{id:'U003',name:'小鱼管理',role:'admin',status:'正常',balance:'-'}],
    bosses:[{nickname:'夜色老板',uid:'BOSS-1001',phone:'6012-888-1024',registered_at:'2026-06-18',vip:'VIP3',total_spent:'RM1,680',balance:'320喵币',club:'妙脆角主俱乐部',status:'正常',invite:'上级：无 / 已邀请 6 人'},{nickname:'Cheese老板',uid:'BOSS-1002',phone:'6016-520-3344',registered_at:'2026-06-22',vip:'VIP2',total_spent:'RM860',balance:'180喵币',club:'Lian Miao Club',status:'正常',invite:'上级：夜色老板 / 已邀请 2 人'},{nickname:'Moon老板',uid:'BOSS-1003',phone:'6018-777-6633',registered_at:'2026-06-29',vip:'VIP1',total_spent:'RM230',balance:'60喵币',club:'妙脆角主俱乐部',status:'冻结',invite:'上级：Cheese老板 / 已邀请 0 人'}],
    clubs:[{id:'C001',name:'妙脆角主俱乐部',owner:'17三角洲电竞',status:'已通过',revenue:'RM86,500'},{id:'C002',name:'Lian Miao Club',owner:'LianMiao',status:'待审核',revenue:'RM12,300'}],
    players:[{id:'P001',uid:'PW-2001',name:'MOMO',phone:'6011-222-1024',id_card:'已上传',selfie:'已通过',bank:'Maybank **** 1024',game:'VALORANT',levelId:'lv1',price:'RM25/小时',rating:'5.0',status:'在线',audit:'已通过',order_status:'可接单',total_income:'RM8,600',withdrawable:'RM860',club:'妙脆角主俱乐部',avatar:'assets/meow-cuijiao-brand.jpg'},{id:'P002',uid:'PW-2002',name:'NANA',phone:'6013-666-3322',id_card:'待补充',selfie:'待审核',bank:'CIMB **** 2201',game:'APEX',levelId:'lv2',price:'RM35/小时',rating:'4.9',status:'忙碌',audit:'待审核',order_status:'忙碌中',total_income:'RM5,420',withdrawable:'RM520',club:'妙脆角主俱乐部',avatar:'assets/lianmiao-club-ad.png'},{id:'P003',uid:'PW-2003',name:'CHEESE',phone:'6017-999-7788',id_card:'已上传',selfie:'已通过',bank:'TNG **** 7788',game:'LOL',levelId:'lv3',price:'RM42/小时',rating:'5.0',status:'休息',audit:'已通过',order_status:'休息中',total_income:'RM12,300',withdrawable:'RM1,230',club:'Lian Miao Club',avatar:'assets/lianmiao-club-ad.png'}],
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
  function read(key){try{var v=JSON.parse(localStorage.getItem('mcj_'+key)||'null');if(Array.isArray(v))return v;}catch(e){}return (defaultDb[key]||[]).slice();}
  function write(key,val){localStorage.setItem('mcj_'+key,JSON.stringify(val));log('保存 '+key)}
  function log(action){var logs=read('admin_logs');logs.unshift({id:'L'+Date.now(),admin:getRole(),action:action,time:new Date().toLocaleString()});localStorage.setItem('mcj_admin_logs',JSON.stringify(logs.slice(0,60)));}
  function getRole(){return localStorage.getItem('mcjRole')||document.body.dataset.defaultRole||'user'}
  function routeByRole(role){var map={super_admin:'admin.html',club_owner:'admin.html',player:'admin.html',user:'index.html'};location.href=map[role]||'index.html'}
  function enforceRole(){var allowed=(document.body.dataset.allowedRoles||'').split(',').filter(Boolean);var current=localStorage.getItem('mcjRole');if(!current){localStorage.setItem('mcjRole',document.body.dataset.defaultRole||allowed[0]||'user');return;}if(allowed.length&&allowed.indexOf(current)<0){routeByRole(current)}}
  function statusChip(text){var t=String(text||'');var cls=/通过|完成|成功|在线|正常|开启|显示/.test(t)?'ok':/拒绝|冻结|异常|取消|离线|关闭|隐藏/.test(t)?'bad':'wait';return '<span class="chip '+cls+'">'+esc(t)+'</span>'}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function table(headers,rows){return '<div class="table-wrap"><table><thead><tr>'+headers.map(function(h){return '<th>'+h+'</th>'}).join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>'}
  function actionButtons(id){return '<div class="row"><button class="btn small" data-action="view" data-id="'+id+'">查看</button><button class="btn small primary" data-action="approve" data-id="'+id+'">通过</button><button class="btn small danger" data-action="reject" data-id="'+id+'">拒绝</button></div>'}
  function renderGenericTable(key,target,columns){var data=read(key);var rows=data.map(function(item){return '<tr>'+columns.map(function(c){var v=item[c.key];if(c.type==='avatar')return '<td><img class="avatar" src="'+esc(v||'assets/meow-cuijiao-brand.jpg')+'"></td>';if(c.type==='status')return '<td>'+statusChip(v)+'</td>';if(c.type==='actions')return '<td>'+actionButtons(item.id||item.name||item.owner)+'</td>';return '<td>'+esc(v)+'</td>';}).join('')+'</tr>'});target.innerHTML=table(columns.map(function(c){return c.label}),rows)}
  function statCards(target,stats){target.innerHTML='<div class="stat-grid">'+stats.map(function(s){return '<div class="stat-card"><span>'+esc(s.label)+'</span><b>'+esc(s.value)+'</b><small>'+esc(s.sub||'实时模拟数据')+'</small></div>'}).join('')+'</div>'}
  function renderCrud(key,target){var data=read(key);target.innerHTML='<div class="crud-list">'+data.map(function(item,i){return '<div class="mini-card"><img src="'+esc(item.image||item.avatar||'assets/meow-cuijiao-brand.jpg')+'"><h4>'+esc(item.title||item.name||item.id||'未命名')+'</h4><p>'+esc(item.sub||item.content||item.description||item.game||item.status||'可编辑内容')+'</p><div class="row"><button class="btn small" data-edit="'+key+'" data-index="'+i+'">编辑</button><button class="btn small danger" data-delete="'+key+'" data-index="'+i+'">删除</button></div></div>'}).join('')+'</div>'}
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
  function initTabs(){var buttons=document.querySelectorAll('[data-section]');buttons.forEach(function(btn){btn.addEventListener('click',function(){buttons.forEach(function(b){b.classList.remove('active')});document.querySelectorAll('.section').forEach(function(s){s.classList.remove('active')});btn.classList.add('active');var sec=document.getElementById('section-'+btn.dataset.section);if(sec)sec.classList.add('active')})})}
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
  function bindGlobal(){document.addEventListener('click',function(e){var role=e.target.closest('[data-role-login]');if(role){localStorage.setItem('mcjRole',role.dataset.roleLogin);routeByRole(role.dataset.roleLogin);return;}var preview=e.target.closest('[data-preview-home]');if(preview){location.href='index.html';return;}var saveLevels=e.target.closest('[data-save-companion-levels]');if(saveLevels&&levelApi()){levelApi().save(collectCompanionLevels());log('保存陪玩等级与价格设置');alert('已保存陪玩等级与价格设置');renderCompanionLevels();return;}var deleteLevel=e.target.closest('[data-delete-companion-level]');if(deleteLevel&&levelApi()){var levels=getLevels();var level=levelApi().find(deleteLevel.dataset.deleteCompanionLevel);if(playerLevelCount(level)>0){alert('该等级已有陪玩，不能直接删除。请先停用该等级或迁移陪玩等级。');return;}if(confirm('确认删除 '+levelLabel(level.id)+'？')){levelApi().save(levels.filter(function(item){return item.id!==level.id}));log('删除陪玩等级 '+levelLabel(level.id));renderCompanionLevels();}return;}var action=e.target.closest('[data-action]');if(action){alert('已执行：'+action.dataset.action+' / '+(action.dataset.id||''));log('执行 '+action.dataset.action);return;}var del=e.target.closest('[data-delete]');if(del){var arr=read(del.dataset.delete);arr.splice(Number(del.dataset.index),1);write(del.dataset.delete,arr);location.reload();return;}})}
  function initForms(){document.querySelectorAll('[data-save-settings]').forEach(function(btn){btn.addEventListener('click',function(){var settings={siteName:val('siteName'),logoUrl:val('logoUrl'),customerServiceUrl:val('customerServiceUrl'),discordInviteUrl:val('discordInviteUrl'),whatsappUrl:val('whatsappUrl'),maintenanceMode:val('maintenanceMode'),registerOpen:val('registerOpen'),seoTitle:val('seoTitle')};localStorage.setItem('mcj_siteSettings',JSON.stringify(settings));log('保存平台设置');alert('已保存平台设置');})});document.querySelectorAll('[data-add-row]').forEach(function(btn){btn.addEventListener('click',function(){var key=btn.dataset.addRow;var arr=read(key);arr.unshift({id:key.toUpperCase().slice(0,2)+Date.now(),title:val('crudTitle'),name:val('crudTitle'),content:val('crudDesc'),description:val('crudDesc'),image:val('crudImage')||'assets/meow-cuijiao-brand.jpg',status:'开启',sort:arr.length+1});write(key,arr);alert('已新增');location.reload();})})}
  function val(id){var el=document.getElementById(id);return el?el.value:''}
  function initSuperAdmin(){
    var dash=document.getElementById('superStats');
    if(dash)statCards(dash,[{label:'总营业额',value:'RM286,500'},{label:'今日订单',value:'128'},{label:'今日充值',value:'RM5,660'},{label:'今日退款',value:'RM420'},{label:'平台抽成',value:'RM18,640'},{label:'在线用户',value:'512'},{label:'在线陪玩',value:'86'},{label:'待处理提现',value:'6'}]);
    var tables={
      bosses:[{key:'nickname',label:'老板昵称'},{key:'uid',label:'UID'},{key:'phone',label:'手机号'},{key:'registered_at',label:'注册时间'},{key:'vip',label:'VIP等级'},{key:'total_spent',label:'消费总额'},{key:'balance',label:'当前余额'},{key:'club',label:'所属俱乐部'},{key:'status',label:'状态',type:'status'},{key:'invite',label:'邀请关系'},{key:'actions',label:'详情',type:'actions'}],
      players:[{key:'avatar',label:'头像',type:'avatar'},{key:'name',label:'陪玩昵称'},{key:'uid',label:'UID'},{key:'phone',label:'联系电话'},{key:'id_card',label:'身份证资料'},{key:'selfie',label:'自拍认证',type:'status'},{key:'bank',label:'结款银行账户'},{key:'audit',label:'审核状态',type:'status'},{key:'order_status',label:'接单状态',type:'status'},{key:'total_income',label:'总收入'},{key:'withdrawable',label:'可提现金额'},{key:'club',label:'所属俱乐部'},{key:'actions',label:'详情',type:'actions'}],
      orders:[{key:'id',label:'订单号'},{key:'boss',label:'老板'},{key:'player',label:'陪玩'},{key:'club',label:'俱乐部'},{key:'game',label:'游戏'},{key:'amount',label:'金额'},{key:'status',label:'状态',type:'status'},{key:'time',label:'时间'},{key:'actions',label:'操作',type:'actions'}],
      wallets:[{key:'owner',label:'账户'},{key:'type',label:'钱包类型'},{key:'balance',label:'余额'},{key:'frozen',label:'冻结金额'},{key:'actions',label:'操作',type:'actions'}],
      wallet_transactions:[{key:'id',label:'流水号'},{key:'owner',label:'用户'},{key:'type',label:'类型'},{key:'amount',label:'金额'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'详情',type:'actions'}],
      withdraw_requests:[{key:'id',label:'提现单号'},{key:'owner',label:'申请人'},{key:'role',label:'身份'},{key:'amount',label:'金额'},{key:'bank',label:'收款账户'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'审核',type:'actions'}],
      clubs:[{key:'id',label:'俱乐部ID'},{key:'name',label:'俱乐部名称'},{key:'owner',label:'老板'},{key:'status',label:'状态',type:'status'},{key:'revenue',label:'营业额'},{key:'actions',label:'操作',type:'actions'}],
      invite_rebates:[{key:'id',label:'返利ID'},{key:'inviter',label:'邀请人'},{key:'invitee',label:'被邀请人'},{key:'relation',label:'邀请关系'},{key:'rebate',label:'返利金额'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'详情',type:'actions'}],
      customer_tickets:[{key:'id',label:'工单ID'},{key:'user',label:'用户'},{key:'channel',label:'渠道'},{key:'topic',label:'问题'},{key:'status',label:'状态',type:'status'},{key:'remark',label:'客服备注'},{key:'actions',label:'处理',type:'actions'}],
      reviews:[{key:'id',label:'评价ID'},{key:'order_id',label:'订单'},{key:'player',label:'陪玩'},{key:'rating',label:'评分'},{key:'content',label:'评价内容'},{key:'status',label:'状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      games:[{key:'id',label:'游戏ID'},{key:'name',label:'游戏名称'},{key:'sort',label:'排序'},{key:'visible',label:'显示状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      announcements:[{key:'id',label:'公告ID'},{key:'title',label:'标题'},{key:'content',label:'内容'},{key:'enabled',label:'状态',type:'status'},{key:'actions',label:'操作',type:'actions'}],
      admin_logs:[{key:'id',label:'日志ID'},{key:'admin',label:'管理员'},{key:'action',label:'操作内容'},{key:'time',label:'时间'}]
    };
    Object.keys(tables).forEach(function(key){var target=document.getElementById('table-'+key);if(target)renderGenericTable(key,target,tables[key]);});
    var dashboardBosses=document.getElementById('table-dashboard-bosses');
    if(dashboardBosses)renderGenericTable('bosses',dashboardBosses,tables.bosses);
    var dashboardPlayers=document.getElementById('table-dashboard-players');
    if(dashboardPlayers)renderGenericTable('players',dashboardPlayers,tables.players);
    ['banners','players','announcements'].forEach(function(key){var t=document.getElementById('crud-'+key);if(t)renderCrud(key,t)});
    renderCompanionLevels();
  }
  function initClubAdmin(){var dash=document.getElementById('clubStats');if(dash)statCards(dash,[{label:'今日营业额',value:'RM3,820'},{label:'今日订单',value:'42'},{label:'本月营业额',value:'RM86,500'},{label:'陪玩人数',value:'36'},{label:'待处理订单',value:'9'},{label:'可提现余额',value:'RM12,800'}]);var clubPlayers=read('players').filter(function(p){return p.club==='妙脆角主俱乐部'});var target=document.getElementById('clubPlayers');if(target)target.innerHTML=table(['头像','昵称','游戏','建议价','评分','状态','操作'],clubPlayers.map(function(p){return '<tr><td><img class="avatar" src="'+esc(p.avatar)+'"></td><td>'+esc(p.name)+'</td><td>'+esc(p.game)+'</td><td>'+esc(p.price)+'</td><td>'+esc(p.rating)+'</td><td>'+statusChip(p.status)+'</td><td>'+actionButtons(p.id)+'</td></tr>'}));var orders=read('orders').filter(function(o){return o.club==='妙脆角主俱乐部'});var ot=document.getElementById('clubOrders');if(ot)ot.innerHTML=table(['订单','老板','陪玩','游戏','金额','状态','时间','操作'],orders.map(function(o){return '<tr><td>'+o.id+'</td><td>'+o.boss+'</td><td>'+o.player+'</td><td>'+o.game+'</td><td>'+o.amount+'</td><td>'+statusChip(o.status)+'</td><td>'+o.time+'</td><td>'+actionButtons(o.id)+'</td></tr>'}))}
  function initPlayerAdmin(){var dash=document.getElementById('playerStats');if(dash)statCards(dash,[{label:'今日订单',value:'6'},{label:'本月订单',value:'84'},{label:'收入',value:'RM3,260'},{label:'评分',value:'5.0'},{label:'完成率',value:'99%'},{label:'可提现余额',value:'RM860'}]);var myOrders=read('orders').filter(function(o){return o.player==='MOMO'});var ot=document.getElementById('playerOrders');if(ot)ot.innerHTML=table(['订单','老板','游戏','金额','状态','时间','接单操作'],myOrders.map(function(o){return '<tr><td>'+o.id+'</td><td>'+o.boss+'</td><td>'+o.game+'</td><td>'+o.amount+'</td><td>'+statusChip(o.status)+'</td><td>'+o.time+'</td><td><div class="row"><button class="btn small primary" data-action="accept" data-id="'+o.id+'">接受</button><button class="btn small danger" data-action="reject" data-id="'+o.id+'">拒绝</button><button class="btn small" data-action="complete" data-id="'+o.id+'">完成</button></div></td></tr>'}));var reviews=read('reviews').filter(function(r){return r.player==='MOMO'});var rt=document.getElementById('playerReviews');if(rt)rt.innerHTML=table(['订单','评分','评价','状态'],reviews.map(function(r){return '<tr><td>'+r.order_id+'</td><td>'+r.rating+'</td><td>'+r.content+'</td><td>'+statusChip(r.status)+'</td></tr>'}))}
  document.addEventListener('DOMContentLoaded',function(){enforceRole();initTabs();bindGlobal();initForms();initSuperAdmin();initClubAdmin();initPlayerAdmin();initTableSearch();});
  window.MCJAdmin={read:read,write:write,routeByRole:routeByRole};
})();

