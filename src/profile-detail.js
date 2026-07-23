(function(){
  function getCompanion(){
    if (!window.MCJCompanionLevels) return null;
    var params = new URLSearchParams(location.search);
    var id = params.get("id") || params.get("uid");
    var lists = [];
    try {
      if (window.MCJRealData && typeof window.MCJRealData.approvedCompanions === "function") lists.push(window.MCJRealData.approvedCompanions());
      if (window.MCJPlatformStore) lists.push(window.MCJPlatformStore.list("companions"));
      lists.push(JSON.parse(localStorage.getItem("mcj_players") || "[]"));
    } catch (e) {}
    var flat = lists.reduce(function (all, list) { return all.concat(Array.isArray(list) ? list : []); }, []);
    var found = flat.find(function (item) {
      return id && [item.id, item.uid, item.companionId, item.name].indexOf(id) > -1;
    });
    return window.MCJCompanionLevels.normalizeCompanion(found || { level: "Lv.1", price: 25 });
  }

  function hydrateLevel(){
    var companion = getCompanion();
    if (!companion || !window.MCJCompanionLevels) return;
    var label = document.querySelector("[data-level-label]");
    var price = document.querySelector("[data-level-price]");
    var range = document.querySelector("[data-level-range]");
    var desc = document.querySelector("[data-level-description]");
    if (label) label.textContent = companion.levelLabel;
    if (price) price.textContent = companion.priceDisplay;
    if (range) range.textContent = companion.levelRange;
    if (desc) desc.textContent = companion.levelDescription;
  }

  hydrateLevel();

  var cards=[].slice.call(document.querySelectorAll('.game-stat-card'));
  var dots=[].slice.call(document.querySelectorAll('#gameDots button'));
  var index=0;
  function show(i){
    if(!cards.length)return;
    index=(i+cards.length)%cards.length;
    cards.forEach(function(card,n){card.classList.toggle('active',n===index);});
    dots.forEach(function(dot,n){dot.classList.toggle('active',n===index);});
  }
  var prev=document.getElementById('gamePrev');
  var next=document.getElementById('gameNext');
  if(prev)prev.addEventListener('click',function(){show(index-1);});
  if(next)next.addEventListener('click',function(){show(index+1);});
  dots.forEach(function(dot,n){dot.addEventListener('click',function(){show(n);});});
  var grid=document.getElementById('uploadGrid');
  var btn=document.getElementById('uploadMore');
  var input=document.getElementById('profileUploadInput');
  if(btn&&input&&grid){
    btn.addEventListener('click',function(){input.click();});
    input.addEventListener('change',function(){
      Array.from(input.files||[]).forEach(function(file){
        var url=URL.createObjectURL(file);
        var img=document.createElement('img');
        img.src=url;
        img.alt='上传素材预览';
        grid.insertBefore(img,btn);
      });
      input.value='';
    });
  }
})();
