const fake={dispatch:[['#MCJ-2401','VALORANT 盲盒派单','等待陪玩接单'],['#MCJ-2402','APEX 双排陪玩','已分配给奶油'],['#MCJ-2403','英雄联盟 局','客服复核中']],gifts:[['喵喵','收到粉色火箭 RM66','用户评价 5.0'],['小白猫','收到奶茶 RM18','用户评价 4.9'],['奶油','收到玫瑰 RM8','用户评价 4.8']],flows:[['订单收入','RM 2,480','已入账'],['礼物收入','RM 618','待结算'],['退款支出','RM 120','已处理']],tickets:[]};function $(id){return document.getElementById(id)}function renderList(id,rows){const el=$(id);if(!el)return;el.innerHTML=rows.map(function(r){return '<div class="item"><span><b>'+r[0]+'</b><small>'+r[1]+'</small></span><strong>'+r[2]+'</strong></div>'}).join('')}renderList('flowList',fake.flows);renderList('adminActions',[['盲盒派单','按游戏、评分、在线状态匹配','已预留'],['评价管理','筛选低分和申诉评价','已预留'],['收入导出','按日期导出收入和礼物收入','已预留']]);const modal=$('loginModal');let code='';document.querySelectorAll('[data-login]').forEach(function(btn){btn.addEventListener('click',function(){if(modal){modal.classList.add('show');modal.setAttribute('aria-hidden','false')}})});document.querySelectorAll('[data-close]').forEach(function(btn){btn.addEventListener('click',function(){if(modal){modal.classList.remove('show');modal.setAttribute('aria-hidden','true')}})});if($('sendCode'))$('sendCode').addEventListener('click',function(){code=String(Math.floor(100000+Math.random()*900000));$('loginState').textContent='模拟验证码：'+code});if($('confirmLogin'))$('confirmLogin').addEventListener('click',function(){const phone=$('phoneInput').value.trim();const input=$('codeInput').value.trim();if(!/^1\d{10}$/.test(phone)){$('loginState').textContent='请输入正确的 11 位手机号。';return}if(!code||input!==code){$('loginState').textContent='验证码不正确，请先获取验证码。';return}localStorage.setItem('mcjLoginPhone',phone);$('loginState').textContent='登录成功，身份路由已预留。';setTimeout(function(){modal.classList.remove('show')},500)});const chat=$('chatMessages');function addMsg(text,me){if(!chat)return;const div=document.createElement('div');div.className='msg'+(me?' me':'');div.textContent=text;chat.appendChild(div)}addMsg('客服主管：今天盲盒派单成功率 96%，异常订单 19 个。',false);addMsg('老板：重点看礼物收入和低分评价。',true);if($('sendChat'))$('sendChat').addEventListener('click',function(){const input=$('chatInput');if(!input.value.trim())return;addMsg(input.value.trim(),true);input.value='';setTimeout(function(){addMsg('系统：消息已同步到后台中心。',false)},300)});
// homepage service picker
document.querySelectorAll('.service-card').forEach(function(card){card.addEventListener('click',function(){document.querySelectorAll('.service-card').forEach(function(c){c.classList.remove('active')});card.classList.add('active');var detail=document.getElementById('serviceDetail');if(detail){detail.querySelector('h2').textContent=card.dataset.service;detail.querySelector('p:last-child').textContent=card.dataset.desc + ' 登录后可继续选择时长、预算和指定要求。';}})});

// theme switcher
(function(){var names={pink:'原色',mint:'薄荷绿',orange:'橙色'};var root=document.body;var saved=localStorage.getItem('mcjTheme')||'pink';function applyTheme(theme){root.classList.remove('theme-mint','theme-orange');if(theme==='mint')root.classList.add('theme-mint');if(theme==='orange')root.classList.add('theme-orange');localStorage.setItem('mcjTheme',theme);document.querySelectorAll('[data-theme-toggle]').forEach(function(btn){btn.textContent='主题：'+(names[theme]||'原色')});}applyTheme(saved);document.querySelectorAll('[data-theme-toggle]').forEach(function(btn){btn.addEventListener('click',function(e){e.stopPropagation();var wrap=btn.closest('[data-theme-switch]');if(wrap)wrap.classList.toggle('open');});});document.querySelectorAll('[data-theme]').forEach(function(btn){btn.addEventListener('click',function(e){e.stopPropagation();applyTheme(btn.dataset.theme);var wrap=btn.closest('[data-theme-switch]');if(wrap)wrap.classList.remove('open');});});document.addEventListener('click',function(){document.querySelectorAll('[data-theme-switch]').forEach(function(w){w.classList.remove('open')});});})();

// ad carousel
(function(){var carousel=document.querySelector('[data-carousel]');if(!carousel)return;var slides=[].slice.call(carousel.querySelectorAll('.ad-slide'));var dots=[].slice.call(carousel.querySelectorAll('[data-carousel-dot]'));var index=Math.max(0,slides.findIndex(function(s){return s.classList.contains('active')}));var timer;function show(i){index=(i+slides.length)%slides.length;slides.forEach(function(s,n){s.classList.toggle('active',n===index)});dots.forEach(function(d,n){d.classList.toggle('active',n===index)});}function next(){show(index+1)}function restart(){clearInterval(timer);timer=setInterval(next,3600)}var prev=carousel.querySelector('[data-carousel-prev]');var nextBtn=carousel.querySelector('[data-carousel-next]');if(prev)prev.addEventListener('click',function(){show(index-1);restart()});if(nextBtn)nextBtn.addEventListener('click',function(){show(index+1);restart()});dots.forEach(function(dot){dot.addEventListener('click',function(){show(Number(dot.dataset.carouselDot));restart()})});carousel.addEventListener('mouseenter',function(){clearInterval(timer)});carousel.addEventListener('mouseleave',restart);show(index);restart();})();


// universal companion showcase
(function(){
  var data={
    '全部陪玩':{label:'ALL SERVICES',title:'全部陪玩资料',intro:'系统会按你的需求推荐不同游戏的陪玩。',games:['APEX','CSGO','VALORANT','三角洲行动','盲盒'],cards:[['在线','小雨','APEX','RM25','photo-one','匿名老板送出 粉色火箭 x1','声音好听，配合很舒服。'],['不在线','小美','VALORANT','RM30','photo-two','匿名老板送出 星光礼盒 x2','很稳，节奏带得好。'],['在线','阿奈','CSGO','RM28','photo-three','匿名老板送出 奶茶 x3','聊天轻松，不会冷场。']]},
    'APEX':{label:'APEX GAMING',title:'APEX 陪玩资料',intro:'APEX 娱乐局、单、固定队都可以预约。',games:['APEX ','APEX 娱乐','APEX 双排','APEX 固定队'],cards:[['不在线','小雨','APEX · 猎杀大师','RM25','photo-one','匿名老板送出 粉色火箭 x1','报点清楚，残局处理很细。'],['在线','小美','APEX · 猎杀大师','RM30','photo-two','匿名老板送出 爱心礼盒 x2','打得很稳，带我吃了两把。'],['在线','阿奈','APEX','RM28','photo-three','匿名老板送出 奶茶 x5','很有耐心，适合新手。']]},
    'CSGO':{label:'CSGO GAMING',title:'CSGO 陪玩资料',intro:'CSGO 娱乐开黑、语音陪打、队友补位。',games:['CSGO 娱乐','CSGO 双排','CSGO 五排','CSGO 陪练'],cards:[['在线','阿杰','CSGO · 步枪手','RM22','photo-three','匿名老板送出 金色徽章 x1','枪法在线，沟通干净。'],['不在线','小白','CSGO · 娱乐开黑','RM26','photo-one','匿名老板送出 幸运星 x6','气氛很好，不压力。'],['在线','可乐','CSGO · 双排','RM24','photo-two','匿名老板送出 能量饮料 x3','补位很快，体验不错。']]},
    '无畏契约':{label:'VALORANT GAMING',title:'无畏契约资料',intro:'VALORANT 娱乐、、都可以选择。',games:['无畏契约娱乐','无畏契约双排','无畏契约五排'],cards:[['在线','奶油','VALORANT · 烟位','RM26','photo-two','匿名老板送出 浅粉花束 x1','技能给得准，很会配合。'],['在线','小七','VALORANT · 决斗','RM32','photo-one','匿名老板送出 金色皇冠 x1','很能打开局面。'],['不在线','星野','VALORANT','RM35','photo-three','匿名老板送出 蓝色星球 x1','讲解细，复盘很有用。']]},
    '三角洲行动':{label:'DELTA FORCE',title:'三角洲行动陪玩资料',intro:'高强度开黑，稳定沟通，适合组队推进。',games:['三角洲开黑','三角洲摸金','三角洲任务','三角洲指挥'],cards:[['在线','北北','三角洲 · 突击','RM28','photo-three','匿名老板送出 战术箱 x1','指挥清楚，节奏舒服。'],['不在线','小沐','三角洲 · 支援','RM30','photo-two','匿名老板送出 金色补给 x2','支援及时，很安心。'],['在线','林川','三角洲 · 指挥','RM35','photo-one','匿名老板送出 蓝色电台 x1','路线规划很专业。']]},

    '和平精英':{label:'PEACE ELITE',title:'和平精英陪玩资料',intro:'吃鸡开黑、四排上车、娱乐陪打。',games:['和平精英四排','和平精英双排','吃鸡娱乐','上车陪玩'],cards:[['在线','小橙','和平精英 · 四排','RM22','photo-three','匿名老板送出 空投箱 x1','报点清楚，开车很稳。'],['不在线','阿晴','和平精英 · 娱乐','RM26','photo-two','匿名老板送出 金色头盔 x1','气氛很好，玩得开心。'],['在线','南风','和平精英 · 双排','RM24','photo-one','匿名老板送出 能量饮料 x5','配合舒服，不乱冲。']]},
    '王者荣耀':{label:'HONOR OF KINGS',title:'王者荣耀陪玩资料',intro:'排位开黑、娱乐局、双排五排都可以。',games:['王者排位','王者娱乐','王者双排','王者五排'],cards:[['在线','小鹿','王者 · 中辅','RM20','photo-two','匿名老板送出 金色皇冠 x1','意识好，保护到位。'],['在线','七七','王者 · 射手','RM24','photo-one','匿名老板送出 浅粉花束 x2','输出稳定，沟通轻松。'],['不在线','阿泽','王者 · 打野','RM28','photo-three','匿名老板送出 蓝色星球 x1','节奏很强，带飞。']]},
    '洛克王国':{label:'ROCO KINGDOM',title:'洛克王国陪玩资料',intro:'活动、日常、回归号陪玩。',games:['洛克日常','洛克活动','洛克回归','宠物陪刷'],cards:[['在线','糖糖','洛克王国 · 活动','RM18','photo-one','匿名老板送出 糖果礼盒 x3','很耐心，讲得清楚。'],['在线','小洛','洛克王国 · 日常','RM20','photo-two','匿名老板送出 粉色星星 x2','效率很高，不拖时间。'],['不在线','莓莓','洛克王国 · 回归','RM22','photo-three','匿名老板送出 童话徽章 x1','回归路线安排得好。']]},
    '英雄联盟':{label:'LEAGUE OF LEGENDS',title:'英雄联盟 陪玩资料',intro:'召唤师峡谷开黑、双排、娱乐局。',games:['英雄联盟 双排','英雄联盟 五排','英雄联盟 娱乐','峡谷陪练'],cards:[['在线','阿宁','英雄联盟 · 辅助','RM22','photo-two','匿名老板送出 金色眼位 x1','保护很好，心态稳定。'],['不在线','小川','英雄联盟 · 打野','RM28','photo-three','匿名老板送出 蓝色BUFF x1','节奏舒服，很会控资源。'],['在线','软软','英雄联盟 · 中单','RM25','photo-one','匿名老板送出 浅粉礼盒 x1','对线稳，聊天也甜。']]},
    '金铲铲之战':{label:'GOLDEN SPATULA',title:'金铲铲之战陪玩资料',intro:'阵容推荐、双人模式、娱乐。',games:['金铲铲双人','阵容推荐','娱乐','赛季'],cards:[['在线','小鱼','金铲铲 · 阵容','RM20','photo-one','匿名老板送出 金铲铲 x1','阵容讲得明白，运营很稳。'],['在线','栗子','金铲铲 · 双人','RM24','photo-two','匿名老板送出 金色棋子 x3','双人配合很好。'],['不在线','可可','金铲铲','RM26','photo-three','匿名老板送出 浅蓝星星 x2','讲经济和节奏很清楚。']]},

    '永劫无间':{label:'NARAKA',title:'永劫无间陪玩资料',intro:'三排开黑、娱乐陪打、英雄练习都可以。',games:['永劫三排','永劫双排','永劫娱乐','英雄练习'],cards:[['在线','阿澈','永劫无间 · 近战','RM28','photo-three','匿名老板送出 金色魂玉 x1','连招很稳，沟通清楚。'],['不在线','小梨','永劫无间 · 三排','RM30','photo-two','匿名老板送出 浅粉花束 x2','气氛很好，很会配合。'],['在线','夜白','永劫无间 · 教练','RM35','photo-one','匿名老板送出 蓝色星光 x1','讲得细，进步很明显。']]},
    '盲盒陪玩':{label:'LUCKY BOX',title:'盲盒陪玩资料',intro:'随机匹配在线陪玩，适合快速开局。',games:['随机盲盒','甜音盲盒','技术盲盒','娱乐盲盒'],cards:[['在线','盲盒一号','随机游戏','RM18','photo-one','匿名老板送出 幸运礼盒 x1','惊喜感不错。'],['在线','盲盒二号','甜音开黑','RM22','photo-two','匿名老板送出 浅粉糖果 x8','声音甜，气氛好。'],['不在线','盲盒三号','娱乐陪打','RM20','photo-three','匿名老板送出 金色星星 x3','很会接话，很放松。']]},
    '语音聊天':{label:'VOICE CHAT',title:'语音聊天',intro:'适合陪聊、连麦、睡前聊天，声音和情绪陪伴优先。',games:['语音聊天','甜音陪聊','情绪陪伴','连麦'],cards:[['在线','小甜','语音聊天','RM18','photo-two','匿名老板送出 粉色话筒 x1','声音舒服，很会接话。'],['在线','软糖','甜音陪聊','RM22','photo-one','匿名老板送出 爱心礼盒 x2','聊天很自然，不尴尬。'],['不在线','晚晚','情绪陪伴','RM20','photo-three','匿名老板送出 星光糖果 x3','很温柔，很放松。']]},
    '打字聊天':{label:'TEXT CHAT',title:'打字聊天',intro:'适合文字陪聊、轻松聊天、日常分享。',games:['打字聊天','日常陪伴','文字树洞'],cards:[['在线','栗栗','打字聊天','RM15','photo-one','匿名老板送出 奶茶 x2','回复很快，很有耐心。'],['不在线','小眠','文字树洞','RM18','photo-two','匿名老板送出 浅粉星星 x1','很会安慰人。'],['在线','可可','日常陪伴','RM16','photo-three','匿名老板送出 糖果 x5','聊天节奏舒服。']]},
    '语音条聊天':{label:'VOICE NOTE',title:'语音条聊天',intro:'适合不方便连麦但想听声音的老板。',games:['语音条聊天','语音回复','睡前语音'],cards:[['在线','小鹿','语音条聊天','RM16','photo-two','匿名老板送出 小话筒 x1','语音条很甜。'],['在线','奈奈','睡前语音','RM20','photo-one','匿名老板送出 月亮礼盒 x1','声音很治愈。'],['不在线','星星','语音回复','RM18','photo-three','匿名老板送出 粉色星球 x1','回复认真。']]},
    '挂睡':{label:'SLEEP CALL',title:'挂睡',intro:'适合睡前陪伴、安静连麦、轻声聊天。',games:['挂睡','睡前陪伴','安静连麦'],cards:[['在线','眠眠','挂睡','RM20','photo-one','匿名老板送出 月亮 x1','很安静，很有安全感。'],['不在线','小夜','睡前陪伴','RM22','photo-two','匿名老板送出 星光礼盒 x1','声音很轻柔。'],['在线','团团','安静连麦','RM18','photo-three','匿名老板送出 云朵 x2','不吵，陪伴感很好。']]},
    '陪看共享':{label:'WATCH TOGETHER',title:'陪看共享',intro:'适合一起看剧、看比赛、共享屏幕聊天。',games:['陪看共享','一起看剧','比赛陪看'],cards:[['在线','阿晴','陪看共享','RM18','photo-three','匿名老板送出 爆米花 x1','一起看很有气氛。'],['在线','小圆','比赛陪看','RM22','photo-two','匿名老板送出 应援棒 x1','很会聊天，不冷场。'],['不在线','木木','一起看剧','RM20','photo-one','匿名老板送出 电影票 x2','陪看体验很好。']]}
  };
  function setupBookingPhotos(card){
    var stage=document.getElementById('bookingPhotoStage');var dots=document.getElementById('bookingPhotoDots');if(!stage||!dots)return;
    var photos=[['assets/meow-cuijiao-brand.jpg','陪玩照片'],['assets/apex-button-bg.jpg','生活照'],['assets/csgo-button-bg.jpg','游戏照']];
    stage.innerHTML=photos.map(function(p,i){return '<div class=\"booking-photo-slide '+(i===0?'active':'')+'\" style=\"background-image:url('+p[0]+')\"><div class=\"booking-photo-caption\">'+card[1]+' · '+p[1]+'</div></div>';}).join('');
    dots.innerHTML=photos.map(function(p,i){return '<button type=\"button\" class=\"'+(i===0?'active':'')+'\" data-booking-photo=\"'+i+'\"></button>';}).join('');
    var slides=[].slice.call(stage.querySelectorAll('.booking-photo-slide'));var dotBtns=[].slice.call(dots.querySelectorAll('[data-booking-photo]'));var idx=0;clearInterval(window.bookingPhotoTimer);
    function show(n){idx=(n+slides.length)%slides.length;slides.forEach(function(s,i){s.classList.toggle('active',i===idx)});dotBtns.forEach(function(d,i){d.classList.toggle('active',i===idx)});}
    var prev=document.getElementById('bookingPhotoPrev');var next=document.getElementById('bookingPhotoNext');if(prev)prev.onclick=function(){show(idx-1)};if(next)next.onclick=function(){show(idx+1)};dotBtns.forEach(function(d){d.onclick=function(){show(Number(d.dataset.bookingPhoto))};});
    window.bookingPhotoTimer=setInterval(function(){show(idx+1)},5000);
  }
  function openBooking(card, info){
    var modal=document.getElementById('bookingModal'); if(!modal)return;
    setupBookingPhotos(card);
    document.getElementById('bookingGameLabel').textContent=info.label;
    document.getElementById('bookingName').textContent=card[1]+' · '+card[2];
    document.getElementById('bookingGift').textContent=card[5];
    document.getElementById('bookingReview').textContent=card[6];
    var tags=document.getElementById('bookingGameButtons');
    tags.innerHTML=info.games.map(function(g){return '<button type="button">'+g+'</button>';}).join('');
    modal.classList.add('show'); modal.setAttribute('aria-hidden','false');
  }
  document.querySelectorAll('[data-booking-close]').forEach(function(btn){btn.addEventListener('click',function(){var modal=document.getElementById('bookingModal'); if(modal){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');}})});
  function render(service){
    var showcase=document.getElementById('companionShowcase'); var wrap=document.getElementById('companionCards'); if(!showcase||!wrap)return;
    var info=data[service]||data['全部陪玩'];
    var label=document.getElementById('showcaseLabel'); var title=document.getElementById('showcaseTitle'); var intro=document.getElementById('showcaseIntro'); var selected=document.getElementById('selectedChannelName');
    if(label)label.textContent=info.label; if(title)title.textContent=service; if(intro)intro.textContent=info.intro; if(selected)selected.textContent=service;
    wrap.innerHTML=info.cards.map(function(c,i){
      var statusClass=c[0]==='在线'?'online':'ingame'; var featured=i===1?' featured':'';
      return '<article class="companion-card'+featured+'" data-card-index="'+i+'"><div class="status '+statusClass+'">'+c[0]+'</div><div class="gift-danmu"><span>'+c[5]+'</span></div><button type="button" class="companion-photo '+c[4]+'" data-photo-upload="'+i+'"><span>更换图片</span><input type="file" accept="image/*"></button><div class="companion-info"><div class="name-row"><h3>'+c[1]+'</h3><button type="button" class="voice-icon-btn" data-voice="'+i+'" aria-label="听试音">🔊</button></div><p>'+c[2]+'</p><div class="price-row"><strong>'+c[3]+'</strong><span>/ HR</span><a class="profile-detail-link" href="companion-detail.html" data-profile-detail>查看详情</a><button type="button" data-booking="'+i+'">立即预约</button></div></div></article>';
    }).join('');
    wrap.querySelectorAll('[data-photo-upload]').forEach(function(photoBtn){var input=photoBtn.querySelector('input[type="file"]');photoBtn.addEventListener('click',function(e){if(e.target===input)return;if(input)input.click();});if(input)input.addEventListener('change',function(){var file=input.files&&input.files[0];if(!file)return;var url=URL.createObjectURL(file);photoBtn.style.backgroundImage='linear-gradient(180deg,rgba(255,117,181,.05),rgba(0,0,0,.18)),url('+url+')';photoBtn.classList.add('custom-photo');var span=photoBtn.querySelector('span');if(span)span.textContent='已上传';});});wrap.querySelectorAll('[data-voice]').forEach(function(btn){btn.addEventListener('click',function(){var card=info.cards[Number(btn.dataset.voice)];btn.classList.add('playing');setTimeout(function(){btn.classList.remove('playing');},1800);var old=document.querySelector('.voice-toast');if(old)old.remove();var toast=document.createElement('div');toast.className='voice-toast';toast.textContent=card[1]+' 的试音正在播放';document.body.appendChild(toast);setTimeout(function(){toast.remove();},1800);});});wrap.querySelectorAll('[data-booking]').forEach(function(btn){btn.addEventListener('click',function(e){e.preventDefault();window.location.href='companion-detail.html';});});
    showcase.classList.add('active'); showcase.setAttribute('aria-hidden','false'); document.body.classList.add('companion-modal-open'); document.body.classList.remove('channel-menu-open');
  }
  document.querySelectorAll('.service-card').forEach(function(card){card.addEventListener('click',function(){render(card.dataset.service||'全部陪玩');});});
})();

// custom order modal
(function(){var modal=document.getElementById('customOrderModal');if(!modal)return;document.querySelectorAll('[data-custom-order]').forEach(function(btn){btn.addEventListener('click',function(){modal.classList.add('show');modal.setAttribute('aria-hidden','false');});});document.querySelectorAll('[data-custom-close]').forEach(function(btn){btn.addEventListener('click',function(){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');});});var submit=document.getElementById('submitCustomOrder');if(submit)submit.addEventListener('click',function(){var players=document.getElementById('customPlayers').value;var start=document.getElementById('customStartTime').value;var end=document.getElementById('customEndTime').value;var game=document.getElementById('customGame').value;var chatService=document.getElementById('customChatService').value;var gender=document.getElementById('customGender').value;var priceInput=document.getElementById('customPrice');var price=Math.max(10, Number(priceInput.value||10));priceInput.value=price;var note=document.getElementById('customNote').value.trim();var state=document.getElementById('customOrderState');state.textContent='已生成订单：'+game+(chatService&&chatService!=='无'?' / '+chatService:'')+' / '+players+'位陪玩 / '+start+' - '+end+' / '+gender+' / 单价 '+'RM'+price+(note?' / 备注：'+note:'')+'，等待系统匹配。';});})();

// enforce custom price min
(function(){var input=document.getElementById('customPrice');if(!input)return;input.addEventListener('change',function(){if(Number(input.value)<10||!input.value)input.value=10;});})();


// floating service (legacy 喵管家) — permanently removed
(function(){
  function purge(){
    ['floatingService','serviceChat','closeServiceChat','serviceChatInput','sendServiceChat','serviceChatBody'].forEach(function(id){
      var el=document.getElementById(id);
      if(el&&el.parentNode)el.parentNode.removeChild(el);
    });
    document.querySelectorAll('.floating-service,#floatingService,.service-chat,#serviceChat').forEach(function(el){
      if(el&&el.parentNode)el.parentNode.removeChild(el);
    });
  }
  purge();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',purge);
})();

// service tip modal
(function(){var selected=10;function initTip(){var open=document.getElementById('tipServiceBtn');var modal=document.getElementById('tipModal');var close=document.getElementById('closeTipModal');var send=document.getElementById('sendTipBtn');var input=document.getElementById('customTipAmount');var state=document.getElementById('tipState');if(!open||!modal||open.dataset.tipBound==='1')return;open.dataset.tipBound='1';open.addEventListener('click',function(){modal.classList.add('show');modal.setAttribute('aria-hidden','false');});if(close)close.addEventListener('click',function(){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');});document.querySelectorAll('[data-tip]').forEach(function(btn){btn.addEventListener('click',function(){document.querySelectorAll('[data-tip]').forEach(function(b){b.classList.remove('active')});btn.classList.add('active');selected=Number(btn.dataset.tip);if(input)input.value='';});});if(send)send.addEventListener('click',function(){var amount=Number(input&&input.value||selected||10);if(amount<1)amount=1;state.textContent='已送出 RM'+amount+' 打赏，客服收到啦。';});}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initTip);else initTip();})();

// chat plus custom order
(function(){function init(){var btn=document.getElementById('chatCustomOrderBtn');var modal=document.getElementById('customOrderModal');if(!btn||!modal||btn.dataset.bound==='1')return;btn.dataset.bound='1';btn.addEventListener('click',function(){modal.classList.add('show');modal.setAttribute('aria-hidden','false');});}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();})();


// homepage cat cover meow
(function(){
  var cover=document.querySelector('[data-cat-cover]');
  if(!cover)return;
  var last=0;
  function meow(){
    var now=Date.now();
    if(now-last<900)return;
    last=now;
    try{
      var AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(!AudioCtx)return;
      var ctx=new AudioCtx();
      var osc=ctx.createOscillator();
      var gain=ctx.createGain();
      var filter=ctx.createBiquadFilter();
      osc.type='sine';
      filter.type='bandpass';
      filter.frequency.setValueAtTime(980,ctx.currentTime);
      filter.Q.setValueAtTime(7,ctx.currentTime);
      osc.frequency.setValueAtTime(660,ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(980,ctx.currentTime+.09);
      osc.frequency.exponentialRampToValueAtTime(520,ctx.currentTime+.32);
      gain.gain.setValueAtTime(0.0001,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.09,ctx.currentTime+.035);
      gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+.38);
      osc.connect(filter);filter.connect(gain);gain.connect(ctx.destination);
      osc.start();osc.stop(ctx.currentTime+.4);
      setTimeout(function(){ctx.close&&ctx.close();},520);
    }catch(e){}
  }
  cover.addEventListener('mouseenter',meow);
  cover.addEventListener('click',meow);
})();


// creative cover start button
(function(){
  var btn=document.querySelector('[data-cover-start]');
  if(!btn)return;
  btn.addEventListener('click',function(e){
    e.stopPropagation();
    var target=document.querySelector('.service-heading')||document.querySelector('.service-grid');
    if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
  });
})();








// logo channel drawer
(function(){
  var logo=document.querySelector('[data-channel-toggle]');
  var menu=document.querySelector('.channel-directory');
  if(!logo||!menu)return;
  logo.addEventListener('click',function(e){e.preventDefault();document.body.classList.toggle('channel-menu-open');});
  menu.addEventListener('click',function(e){if(e.target.closest('.service-card'))document.body.classList.remove('channel-menu-open');});
  document.addEventListener('click',function(e){if(!document.body.classList.contains('channel-menu-open'))return;if(e.target.closest('.channel-directory')||e.target.closest('[data-channel-toggle]'))return;document.body.classList.remove('channel-menu-open');});
})();




// companion overlay close
(function(){
  var showcase=document.getElementById('companionShowcase');
  if(!showcase)return;
  function close(){showcase.classList.remove('active');showcase.setAttribute('aria-hidden','true');document.body.classList.remove('companion-modal-open');}
  document.querySelectorAll('[data-companion-close]').forEach(function(btn){btn.addEventListener('click',close);});
  showcase.addEventListener('click',function(e){if(e.target===showcase)close();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&showcase.classList.contains('active'))close();});
})();


// channel game category
(function(){
  var group=document.querySelector('[data-game-group]');
  if(!group)return;
  group.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.toggle('channel-games-open');
  });
})();


// channel chat category
(function(){
  var group=document.querySelector('[data-chat-group]');
  if(!group)return;
  group.addEventListener('click',function(e){
    e.preventDefault();
    e.stopPropagation();
    document.body.classList.toggle('channel-chat-open');
  });
})();


// join apply modal v2
(function(){
  var modal=document.getElementById('joinApplyModal');
  if(!modal)return;
  var closeTimer;
  function openJoin(){
    clearTimeout(closeTimer);
    modal.classList.remove('join-closing');
    modal.classList.add('show','action-modal');
    modal.setAttribute('aria-hidden','false');
    document.body.classList.add('action-modal-open');
  }
  function closeJoin(){
    modal.classList.add('join-closing');
    modal.setAttribute('aria-hidden','true');
    clearTimeout(closeTimer);
    closeTimer=setTimeout(function(){
      modal.classList.remove('show','join-closing');
      if(!document.querySelector('.action-modal.show')) document.body.classList.remove('action-modal-open');
    },190);
  }
  document.querySelectorAll('[data-join-apply],[data-modal="join-apply"]').forEach(function(btn){
    btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();openJoin();},true);
  });
  document.querySelectorAll('[data-join-close]').forEach(function(btn){
    btn.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();closeJoin();},true);
  });
  modal.addEventListener('click',function(e){if(e.target===modal){e.stopPropagation();closeJoin();}},true);
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.classList.contains('show'))closeJoin();});

  var photoCard=document.getElementById('joinPhotoCard');
  var photoInput=document.getElementById('joinPhoto');
  var photoPreview=document.getElementById('joinPhotoPreview');
  var photoPlus=document.getElementById('joinPhotoPlus');
  var photoText=document.getElementById('joinPhotoText');
  var removePhoto=document.getElementById('removeJoinPhoto');
  var photoData='';
  if(photoCard&&photoInput){
    photoCard.addEventListener('click',function(){photoInput.click();});
    photoInput.addEventListener('change',function(){
      var file=photoInput.files&&photoInput.files[0];
      if(!file)return;
      var reader=new FileReader();
      reader.onload=function(){
        photoData=String(reader.result||'');
        if(photoPreview)photoPreview.src=photoData;
        photoCard.classList.add('has-photo');
        if(photoPlus)photoPlus.style.display='none';
        if(photoText)photoText.textContent='已上传资料照片';
      };
      reader.readAsDataURL(file);
    });
  }
  if(removePhoto)removePhoto.addEventListener('click',function(){
    photoData='';
    if(photoInput)photoInput.value='';
    if(photoPreview)photoPreview.removeAttribute('src');
    if(photoCard)photoCard.classList.remove('has-photo');
    if(photoPlus)photoPlus.style.display='block';
    if(photoText)photoText.textContent='上传资料照片';
  });

  var mediaRecorder=null, audioChunks=[], audioBlob=null, audioUrl='', voiceConfirmed=false, recordTimer=null, recordSeconds=0;
  var meter=document.getElementById('joinVoiceMeter');
  var state=document.getElementById('joinVoiceState');
  var audio=document.getElementById('joinVoiceAudio');
  var startBtn=document.getElementById('startJoinRecord');
  var stopBtn=document.getElementById('stopJoinRecord');
  var playBtn=document.getElementById('playJoinVoice');
  var redoBtn=document.getElementById('redoJoinVoice');
  var confirmBtn=document.getElementById('confirmJoinVoice');
  function fmt(s){var m=Math.floor(s/60),r=s%60;return String(m).padStart(2,'0')+':'+String(r).padStart(2,'0');}
  function setState(text,cls){if(state){state.textContent=text;state.className='voice-state '+(cls||'');}}
  function resetVoice(){
    audioChunks=[];audioBlob=null;voiceConfirmed=false;recordSeconds=0;if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl='';
    if(meter)meter.textContent='00:00'; if(audio){audio.hidden=true;audio.removeAttribute('src');}
    if(startBtn)startBtn.disabled=false; if(stopBtn)stopBtn.disabled=true; if(playBtn)playBtn.disabled=true; if(redoBtn)redoBtn.disabled=true; if(confirmBtn)confirmBtn.disabled=true;
    setState('准备录制','');
  }
  if(startBtn)startBtn.addEventListener('click',async function(){
    if(!navigator.mediaDevices||!window.MediaRecorder){setState('当前浏览器不支持录音','');return;}
    try{
      var stream=await navigator.mediaDevices.getUserMedia({audio:true});
      audioChunks=[]; audioBlob=null; voiceConfirmed=false;
      mediaRecorder=new MediaRecorder(stream);
      mediaRecorder.ondataavailable=function(e){if(e.data&&e.data.size)audioChunks.push(e.data);};
      mediaRecorder.onstop=function(){
        stream.getTracks().forEach(function(t){t.stop();});
        audioBlob=new Blob(audioChunks,{type:mediaRecorder.mimeType||'audio/webm'});
        if(audioUrl)URL.revokeObjectURL(audioUrl);
        audioUrl=URL.createObjectURL(audioBlob);
        if(audio){audio.src=audioUrl;audio.hidden=false;}
        if(playBtn)playBtn.disabled=false; if(redoBtn)redoBtn.disabled=false; if(confirmBtn)confirmBtn.disabled=false; if(startBtn)startBtn.disabled=true; if(stopBtn)stopBtn.disabled=true;
        setState('录制完成，请试听后确认','');
      };
      mediaRecorder.start();
      recordSeconds=0; if(meter)meter.textContent='00:00';
      clearInterval(recordTimer); recordTimer=setInterval(function(){recordSeconds++; if(meter)meter.textContent=fmt(recordSeconds);},1000);
      if(startBtn)startBtn.disabled=true; if(stopBtn)stopBtn.disabled=false; if(playBtn)playBtn.disabled=true; if(redoBtn)redoBtn.disabled=true; if(confirmBtn)confirmBtn.disabled=true;
      setState('● 正在录制','recording');
    }catch(err){setState('麦克风权限未开启','');}
  });
  if(stopBtn)stopBtn.addEventListener('click',function(){clearInterval(recordTimer); if(mediaRecorder&&mediaRecorder.state==='recording')mediaRecorder.stop();});
  if(playBtn)playBtn.addEventListener('click',function(){if(audio&&audio.src)audio.play();});
  if(redoBtn)redoBtn.addEventListener('click',resetVoice);
  if(confirmBtn)confirmBtn.addEventListener('click',function(){if(!audioBlob)return;voiceConfirmed=true;setState('语音已确认','');confirmBtn.disabled=true;});

  var submit=document.getElementById('submitJoinApply');
  if(submit)submit.addEventListener('click',function(){
    var name=(document.getElementById('joinName').value||'').trim();
    var type=document.getElementById('joinType').value;
    var channel=document.getElementById('joinChannel').value;
    var gender=document.getElementById('joinGender').value;
    var contact=(document.getElementById('joinContact').value||'').trim();
    var intro=(document.getElementById('joinIntro').value||'').trim();
    var status=document.getElementById('joinApplyState');
    if(!name||!contact){status.textContent='请填写昵称和联系方式。';status.className='login-state join-v2-state warn';return;}
    var payload={name:name,type:type,channel:channel,gender:gender,contact:contact,intro:intro,photo:!!photoData,voice:voiceConfirmed,createdAt:new Date().toLocaleString()};
    var list=JSON.parse(localStorage.getItem('mcjJoinApplications')||'[]');
    list.unshift(payload);
    localStorage.setItem('mcjJoinApplications',JSON.stringify(list.slice(0,20)));
    status.textContent='已提交入职申请：'+name+' / '+type+' / '+channel+' / '+gender+'，等待后台审核。';
    status.className='login-state join-v2-state ok';
  });
})();


// order guide modal
(function(){
  var modal=document.getElementById('orderGuideModal');
  if(!modal)return;
  document.querySelectorAll('[data-order-guide]').forEach(function(btn){btn.addEventListener('click',function(){modal.classList.add('show');modal.setAttribute('aria-hidden','false');});});
  document.querySelectorAll('[data-guide-close]').forEach(function(btn){btn.addEventListener('click',function(){modal.classList.remove('show');modal.setAttribute('aria-hidden','true');});});
})();

// draggable floating service — removed with 喵管家

// safe channel no jump
(function(){
  document.querySelectorAll('.channel-directory .service-card').forEach(function(card){
    card.addEventListener('click',function(e){
      e.preventDefault();
    });
  });
})();


// unified action modal overlay behavior
(function(){
  var configs=[
    {open:'[data-custom-order]', modal:'customOrderModal', close:'[data-custom-close]'},
    {open:'[data-join-apply]', modal:'joinApplyModal', close:'[data-join-close]'},
    {open:'[data-order-guide]', modal:'orderGuideModal', close:'[data-guide-close]'}
  ];
  function lock(){document.body.classList.add('action-modal-open');}
  function unlock(){
    if(!document.querySelector('.action-modal.show')) document.body.classList.remove('action-modal-open');
  }
  function openModal(modal){
    if(!modal)return;
    modal.classList.add('show','action-modal');
    modal.setAttribute('aria-hidden','false');
    lock();
  }
  function closeModal(modal){
    if(!modal)return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
    unlock();
  }
  configs.forEach(function(cfg){
    var modal=document.getElementById(cfg.modal);
    if(!modal)return;
    modal.classList.add('action-modal');
    document.querySelectorAll(cfg.open).forEach(function(btn){
      btn.removeAttribute('href');
      btn.addEventListener('click',function(e){
        e.preventDefault();
        e.stopPropagation();
        openModal(modal);
      },true);
    });
    document.querySelectorAll(cfg.close).forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.preventDefault();
        closeModal(modal);
      });
    });
    modal.addEventListener('click',function(e){
      if(e.target===modal) closeModal(modal);
    });
  });
  document.addEventListener('keydown',function(e){
    if(e.key!=='Escape')return;
    document.querySelectorAll('.action-modal.show').forEach(function(modal){closeModal(modal);});
  });
})();


// data-modal action buttons
(function(){
  var map={
    'custom-order':'customOrderModal',
    'join-apply':'joinApplyModal',
    'order-guide':'orderGuideModal'
  };
  function openModal(modal){
    if(!modal)return;
    modal.classList.add('show','action-modal');
    modal.setAttribute('aria-hidden','false');
    document.body.classList.add('action-modal-open');
  }
  document.querySelectorAll('[data-modal]').forEach(function(btn){
    if(btn.dataset.modalBound==='1')return;
    btn.dataset.modalBound='1';
    btn.addEventListener('click',function(e){
      var id=map[btn.dataset.modal];
      if(!id)return;
      e.preventDefault();
      e.stopPropagation();
      openModal(document.getElementById(id));
    },true);
  });
})();


// homepage ad settings from admin center
(function(){
  function parse(){try{return JSON.parse(localStorage.getItem('mcjAdSettings')||'null')}catch(e){return null}}
  function valid(data){
    if(!data)return false;
    var now=Date.now();
    if(data.start && now < new Date(data.start).getTime())return false;
    if(data.end && now > new Date(data.end).getTime())return false;
    return true;
  }
  function apply(){
    var data=parse(); if(!valid(data))return;
    var first=document.querySelector('.ad-carousel .ad-slide'); if(!first)return;
    var title=first.querySelector('h2'); var sub=first.querySelector('span'); var label=first.querySelector('p');
    if(label)label.textContent='MEOW CUI JIAO';
    if(title){title.textContent=data.title||title.textContent; if(data.fontSize)title.style.fontSize=data.fontSize+'px'; if(data.color)title.style.color=data.color;}
    if(sub)sub.textContent=data.sub||sub.textContent;
    if(data.image)first.style.setProperty('--ad-image','url('+data.image+')');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply);else apply();
})();


// booking buttons go detail page
(function(){document.addEventListener('click',function(e){var btn=e.target.closest&&e.target.closest('[data-booking]');if(!btn)return;e.preventDefault();window.location.href='companion-detail.html';},true);})();


// interactive home banner particles
(function(){
  function init(){
    document.querySelectorAll('.interactive-banner').forEach(function(banner){
      if(banner.dataset.interactiveBound==='1')return;
      banner.dataset.interactiveBound='1';
      function burst(e){
        var rect=banner.getBoundingClientRect();
        var point=e.touches&&e.touches[0]?e.touches[0]:e;
        var x=(point.clientX-rect.left);
        var y=(point.clientY-rect.top);
        var count=6+Math.floor(Math.random()*5);
        for(var i=0;i<count;i++){
          var p=document.createElement('span');
          p.className='banner-particle';
          p.textContent=Math.random()>.45?'♥':'🐾';
          p.style.setProperty('--x',x+'px');
          p.style.setProperty('--y',y+'px');
          p.style.setProperty('--dx',(Math.random()*120-60)+'px');
          p.style.setProperty('--dy',(-45-Math.random()*70)+'px');
          p.style.setProperty('--r',(Math.random()*80-40)+'deg');
          p.style.setProperty('--s',(14+Math.random()*10)+'px');
          p.style.setProperty('--c',Math.random()>.5?'#ff9acb':'#ffd6e7');
          banner.appendChild(p);
          setTimeout(function(el){el.remove();},1000,p);
        }
      }
      banner.addEventListener('click',burst);
      banner.addEventListener('touchstart',burst,{passive:true});
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

