(function(){
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
