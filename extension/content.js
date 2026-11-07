(() => {
  const SEED = globalThis.PAUSE_SEED || {};
  const DEFAULTS = {
    shortMinutes: Number(SEED.shortMinutes) || 5,
    longMinutes: Number(SEED.longMinutes) || 60,
    youtube: SEED.youtube !== false,
    instagram: SEED.instagram !== false,
    snoozeMinutes: Number(SEED.snoozeMinutes) || 5,
    friction: ["light", "medium", "strong"].includes(SEED.friction) ? SEED.friction : "medium",
    ideas: Array.isArray(SEED.ideas) && SEED.ideas.length ? SEED.ideas : [
      "Take five minutes away from the feed."
    ]
  };

  const SESSION_KEY = 'pauseActiveSession';
  let settings = { ...DEFAULTS };
  let seconds = 0;
  let currentModeKey = null;
  let shownForSession = false;
  let snoozedUntil = 0;
  let snoozeUsed = false; // retained for backwards-compatible saved sessions; snoozes are now unlimited
  let lastIdea = '';
  let initialized = false;
  let persistTick = 0;

  function mode() {
    const host = location.hostname;
    const path = location.pathname;
    if (host.includes('youtube.com') && settings.youtube) {
      if (path.startsWith('/shorts/')) return { type: 'short', label: 'YouTube Shorts', site: 'youtube' };
      if (path.startsWith('/watch')) return { type: 'long', label: 'YouTube', site: 'youtube' };
    }
    if (host.includes('instagram.com') && settings.instagram && (path.startsWith('/reels') || path.startsWith('/reel/'))) {
      return { type: 'short', label: 'Instagram Reels', site: 'instagram' };
    }
    return null;
  }

  function modeKey(current) {
    return current ? `${current.site}:${current.type}` : null;
  }

  function limitSeconds(current) {
    return (current.type === 'short' ? Number(settings.shortMinutes) : Number(settings.longMinutes)) * 60;
  }

  function sessionSnapshot(current) {
    if (!current) return null;
    const limit = limitSeconds(current);
    return {
      key: modeKey(current),
      type: current.type,
      label: current.label,
      site: current.site,
      elapsedSeconds: Math.max(0, Math.floor(seconds)),
      limitSeconds: limit,
      remainingSeconds: Math.max(0, limit - Math.floor(seconds)),
      blocked: shownForSession,
      snoozedUntil,
      snoozeUsed,
      updatedAt: Date.now()
    };
  }

  function persistSession(current) {
    const snapshot = sessionSnapshot(current);
    if (snapshot) chrome.storage.local.set({ [SESSION_KEY]: snapshot });
    else chrome.storage.local.remove(SESSION_KEY);
  }

  function clearOverlay() {
    document.getElementById('pause-scroll-nudge')?.remove();
  }

  function resetSession(current = null) {
    seconds = 0;
    shownForSession = false;
    snoozedUntil = 0;
    snoozeUsed = false;
    clearOverlay();
    currentModeKey = modeKey(current);
    persistSession(current);
  }

  function restoreOrStart(current) {
    const key = modeKey(current);
    currentModeKey = key;
    chrome.storage.local.get({ [SESSION_KEY]: null }, result => {
      const saved = result[SESSION_KEY];
      const same = saved && saved.key === key && Number(saved.limitSeconds) === limitSeconds(current);
      if (same) {
        seconds = Math.max(0, Number(saved.elapsedSeconds) || 0);
        snoozedUntil = Math.max(0, Number(saved.snoozedUntil) || 0);
        snoozeUsed = false;
        shownForSession = Boolean(saved.blocked);
        if (shownForSession && Date.now() >= snoozedUntil) showNudge(current, true);
      } else {
        resetSession(current);
      }
      initialized = true;
      persistSession(current);
    });
  }

  chrome.storage.sync.get(DEFAULTS, stored => {
    settings = { ...DEFAULTS, ...stored };
    if (!Array.isArray(settings.ideas) || !settings.ideas.length) settings.ideas = DEFAULTS.ideas;
    const current = mode();
    if (current) restoreOrStart(current);
    else {
      initialized = true;
      chrome.storage.local.remove(SESSION_KEY);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    let timerChanged = false;
    for (const [key, change] of Object.entries(changes)) {
      settings[key] = change.newValue;
      if (['shortMinutes', 'longMinutes', 'youtube', 'instagram'].includes(key)) timerChanged = true;
    }
    if (!Array.isArray(settings.ideas) || !settings.ideas.length) settings.ideas = DEFAULTS.ideas;
    if (timerChanged) resetSession(mode());
  });

  function randomIdea() {
    const list = (settings.ideas || []).map(x => String(x).trim()).filter(Boolean);
    if (!list.length) return 'Take five minutes away from the feed.';
    let idea = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && idea === lastIdea) idea = list[(list.indexOf(idea) + 1) % list.length];
    lastIdea = idea;
    return idea;
  }

  function leaveFeed() {
    chrome.runtime.sendMessage({ type: 'PAUSE_CLOSE_TAB' });
  }

  let lastChallengeType = null;

  function shuffled(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function makeChallenge() {
    const level = settings.friction || 'medium';
    const size = level === 'light' ? 3 : level === 'medium' ? 4 : 5;
    const count = size * size;
    const orderMax = level === 'light' ? 4 : level === 'medium' ? 6 : 8;
    const wireCount = level === 'light' ? 3 : level === 'medium' ? 4 : 6;
    const factories = [];

    factories.push(() => {
      const wordsA = ['mint', 'violet', 'solar', 'quiet', 'pixel', 'lucky', 'cosmic', 'silver'];
      const wordsB = ['comet', 'orbit', 'lantern', 'cloud', 'button', 'rocket', 'puzzle', 'pebble'];
      const wordsC = ['north', 'echo', 'seven', 'river', 'signal', 'copper'];
      const extra = level === 'strong' ? ` ${wordsC[Math.floor(Math.random()*wordsC.length)]} ${wordsA[Math.floor(Math.random()*wordsA.length)]}` : level === 'medium' ? ` ${wordsC[Math.floor(Math.random()*wordsC.length)]}` : '';
      return { type:'phrase', phrase:`${wordsA[Math.floor(Math.random()*wordsA.length)]} ${wordsB[Math.floor(Math.random()*wordsB.length)]}${extra} ${Math.floor(10+Math.random()*90)}` };
    });

    factories.push(() => {
      if (level === 'light') {
        const a = 2 + Math.floor(Math.random()*8), b = 1 + Math.floor(Math.random()*8);
        return {type:'math', question:`${a} + ${b}`, answer:a+b};
      }
      if (level === 'medium') {
        const op = ['+','−','×'][Math.floor(Math.random()*3)];
        if (op === '×') { const a=2+Math.floor(Math.random()*8), b=2+Math.floor(Math.random()*7); return {type:'math',question:`${a} × ${b}`,answer:a*b}; }
        const a=10+Math.floor(Math.random()*30), b=4+Math.floor(Math.random()*20);
        if (op === '−') { const left=Math.max(a,b),right=Math.min(a,b); return {type:'math',question:`${left} − ${right}`,answer:left-right}; }
        return {type:'math',question:`${a} + ${b}`,answer:a+b};
      }
      const op = ['+','−','×','÷'][Math.floor(Math.random()*4)];
      if (op === '×') { const a=4+Math.floor(Math.random()*12), b=3+Math.floor(Math.random()*11); return {type:'math',question:`${a} × ${b}`,answer:a*b}; }
      if (op === '÷') { const divisor=2+Math.floor(Math.random()*11), answer=3+Math.floor(Math.random()*12); return {type:'math',question:`${divisor*answer} ÷ ${divisor}`,answer}; }
      const a=20+Math.floor(Math.random()*60), b=8+Math.floor(Math.random()*45);
      if (op === '−') { const left=Math.max(a,b),right=Math.min(a,b); return {type:'math',question:`${left} − ${right}`,answer:left-right}; }
      return {type:'math',question:`${a} + ${b}`,answer:a+b};
    });

    factories.push(() => {
      const icons=['🎧','🎮','⭐','🧩','🎨','🌙','🚀','🎲','🎯','🪐','🍀','⚡'];
      const target=icons[Math.floor(Math.random()*icons.length)], others=icons.filter(x=>x!==target);
      const targetCount=level==='light'?3:level==='medium'?5:7, tiles=[];
      for(let i=0;i<targetCount;i++) tiles.push(target);
      while(tiles.length<count) tiles.push(others[Math.floor(Math.random()*others.length)]);
      return {type:'match',target,tiles:shuffled(tiles),cols:size};
    });

    factories.push(() => {
      const symbols=['▲','➤','♠','☂','✦'];
      const symbol=symbols[Math.floor(Math.random()*symbols.length)], oddIndex=Math.floor(Math.random()*count);
      const rotation=level==='light'?24:level==='medium'?15:9;
      return {type:'odd',symbol,oddIndex,cols:size,rotation};
    });

    factories.push(() => ({type:'order', nums:shuffled(Array.from({length:orderMax},(_,i)=>i+1)), max:orderMax}));

    factories.push(() => {
      const palette = [
        {id:'tri',shape:'▲',color:'#e24b4b',name:'red triangle'}, {id:'cir',shape:'●',color:'#4f7fe8',name:'blue circle'},
        {id:'squ',shape:'■',color:'#e0a52b',name:'gold square'}, {id:'dia',shape:'◆',color:'#7b5bd6',name:'purple diamond'},
        {id:'hex',shape:'⬢',color:'#3aa57a',name:'green hexagon'}, {id:'star',shape:'★',color:'#d568b5',name:'pink star'},
        {id:'plus',shape:'✚',color:'#39a5b8',name:'teal plus'}, {id:'moon',shape:'☾',color:'#e07b3b',name:'orange moon'}
      ];
      const pairs = shuffled(palette).slice(0,wireCount);
      return {type:'wire', left:shuffled(pairs), right:shuffled(pairs)};
    });

    factories.push(() => {
      const target = level==='light' ? 10*Math.floor(2+Math.random()*7) : level==='medium' ? 5*Math.floor(5+Math.random()*15) : 20+Math.floor(Math.random()*76);
      const tolerance = level==='light' ? 5 : level==='medium' ? 2 : 0;
      return {type:'slider', target, tolerance};
    });

    factories.push(() => {
      const shapes=['●','▲','■','◆','⬢'];
      const target=shapes[Math.floor(Math.random()*shapes.length)], others=shapes.filter(x=>x!==target);
      const targetCount=level==='light'?3+Math.floor(Math.random()*4):level==='medium'?5+Math.floor(Math.random()*6):8+Math.floor(Math.random()*9);
      const tiles=Array.from({length:targetCount},()=>target);
      while(tiles.length<count) tiles.push(others[Math.floor(Math.random()*others.length)]);
      return {type:'count',target,tiles:shuffled(tiles),answer:targetCount,cols:size};
    });

    factories.push(() => {
      const icons=['🎧','🎮','⭐','🧩','🎨','🌙','🚀','🎲','🎯','🪐','🍀','⚡','🎵','📌','🔷','🔶','🟣','🟩','🔺','🔸','☂️','🍎','🧠','🎈','🪁','🧊'];
      const unique=shuffled(icons).slice(0,count-1), duplicate=unique[Math.floor(Math.random()*unique.length)], tiles=shuffled([...unique,duplicate]);
      return {type:'duplicate',tiles,duplicate,cols:size};
    });

    factories.push(() => ({type:'spam', clicks:level==='light'?15:level==='medium'?30:50}));

    factories.push(() => ({type:'balloon', pumps:level==='light'?6:level==='medium'?15:30}));

    factories.push(() => ({type:'fishing', seconds:level==='light'?4:level==='medium'?7:10, tolerance:level==='light'?14:level==='medium'?10:7, pauseMin:level==='light'?900:level==='medium'?650:450, pauseMax:level==='light'?1600:level==='medium'?1250:950, runMs:level==='light'?700:level==='medium'?520:380, minJump:level==='light'?24:level==='medium'?34:44, gain:level==='light'?1.25:level==='medium'?1.4:1.75, decay:level==='light'?.45:level==='medium'?.5:.55}));

    factories.push(() => {
      const length=level==='light'?4:level==='medium'?5:7;
      const keys=['C','D','E','F','G'];
      return {type:'piano', sequence:Array.from({length},()=>Math.floor(Math.random()*keys.length)), keys};
    });

    factories.push(() => {
      const cols=level==='light'?4:5;
      const rows=cols;
      const checkpointCount=level==='light'?4:level==='medium'?6:8;
      // Use a full-board Hamiltonian snake so at least one valid visit-every-tile solution always exists.
      let route=[];
      for(let r=0;r<rows;r++){
        const xs=Array.from({length:cols},(_,i)=>i);
        if(r%2) xs.reverse();
        xs.forEach(c=>route.push(r*cols+c));
      }
      const transforms=[
        i=>i,
        i=>{const r=Math.floor(i/cols),c=i%cols;return r*cols+(cols-1-c);},
        i=>{const r=Math.floor(i/cols),c=i%cols;return (rows-1-r)*cols+c;},
        i=>{const r=Math.floor(i/cols),c=i%cols;return c*cols+r;}
      ];
      const tf=transforms[Math.floor(Math.random()*transforms.length)];
      route=route.map(tf);
      if(Math.random()<.5) route.reverse();
      const checkpoints=[];
      for(let n=0;n<checkpointCount;n++){
        const ix=Math.round(n*(route.length-1)/(checkpointCount-1));
        checkpoints.push(route[ix]);
      }
      return {type:'path', cols, route, checkpoints};
    });

    factories.push(() => {
      const layouts = level==='light' ? [
        {start:[-92,58],target:[76,-42],walls:[[-18,-28,18,82],[48,34,82,18]]},
        {start:[82,54],target:[-70,-48],walls:[[8,10,18,100],[-48,-24,72,18]]},
        {start:[-78,-54],target:[72,48],walls:[[-18,18,88,18],[50,-30,18,74]]}
      ] : level==='medium' ? [
        {start:[-102,66],target:[70,-52],walls:[[-52,-18,18,104],[18,34,92,18],[58,-34,18,72]]},
        {start:[92,-58],target:[-74,50],walls:[[38,-10,18,100],[-20,-42,92,18],[-55,38,18,70]]},
        {start:[-88,-62],target:[82,42],walls:[[-36,20,92,18],[34,-24,90,18],[68,48,18,54]]},
        {start:[0,68],target:[-86,-48],walls:[[-46,24,92,18],[42,-20,96,18],[0,-56,18,54]]}
      ] : [
        {start:[-108,66],target:[78,-54],walls:[[-62,-12,18,118],[-8,40,88,18],[42,-30,18,92],[82,34,62,18]]},
        {start:[96,-62],target:[-72,48],walls:[[54,-10,18,116],[-5,-46,94,18],[-48,18,18,86],[8,48,86,18]]},
        {start:[-92,-64],target:[72,54],walls:[[-52,24,86,18],[12,-20,18,112],[56,30,76,18],[-72,-38,52,18]]},
        {start:[0,68],target:[-88,-50],walls:[[-58,18,18,100],[-5,42,86,18],[45,-12,18,100],[82,-52,54,18]]},
        {start:[-100,8],target:[82,-42],walls:[[-45,-42,18,72],[-12,18,76,18],[38,48,18,70],[72,-8,70,18]]},
        {start:[88,60],target:[-82,-22],walls:[[52,16,18,98],[8,-38,86,18],[-42,26,18,94],[-78,-54,54,18]]}
      ];
      const pointBlocked=(x,y,walls,pad=31)=>walls.some(w=>Math.abs(x-w.x)<w.w/2+pad&&Math.abs(y-w.y)<w.h/2+pad);
      let choice=null;
      for(let attempt=0;attempt<30&&!choice;attempt++){
        const base=layouts[Math.floor(Math.random()*layouts.length)];
        const flipX=Math.random()<.5?-1:1, flipY=Math.random()<.5?-1:1;
        const walls=base.walls.map(([x,y,w,h])=>({x:x*flipX,y:y*flipY,w,h}));
        const startX=base.start[0]*flipX,startY=base.start[1]*flipY,targetX=base.target[0]*flipX,targetY=base.target[1]*flipY;
        const inBounds=(x,y)=>Math.abs(x)<=132&&Math.abs(y)<=72;
        if(inBounds(startX,startY)&&inBounds(targetX,targetY)&&!pointBlocked(startX,startY,walls)&&!pointBlocked(targetX,targetY,walls)&&Math.hypot(startX-targetX,startY-targetY)>90){choice={startX,startY,targetX,targetY,walls};}
      }
      if(!choice){choice={startX:-112,startY:62,targetX:112,targetY:-62,walls:[{x:-35,y:0,w:18,h:88},{x:35,y:0,w:18,h:88},{x:0,y:0,w:42,h:18}]};}
      return {
        type:'align',
        ...choice,
        step:level==='light'?14:level==='medium'?10:7,
        tolerance:level==='light'?15:level==='medium'?9:5
      };
    });

    factories.push(() => ({type:'cook', items:level==='light'?2:level==='medium'?3:4, greenMs:level==='light'?1800:level==='medium'?1200:800}));

    factories.push(() => ({type:'tower', blocks:level==='light'?3:level==='medium'?4:5, wind:level==='light'?.035:level==='medium'?.075:.13, gust:level==='light'?.35:level==='medium'?.8:1.5, gravity:level==='light'?.42:level==='medium'?.55:.68}));

    const options=factories.map((factory,index)=>({factory,index})).filter(x=>x.index!==lastChallengeType || factories.length===1);
    const selected=options[Math.floor(Math.random()*options.length)];
    lastChallengeType=selected.index;
    return selected.factory();
  }

  function gridClass(cols) { return cols === 5 ? 'pause-grid-5' : cols === 4 ? 'pause-grid-4' : ''; }

  function challengeMarkup(challenge) {
    if (challenge.type === 'phrase') return `<div class="pause-check-copy">Type <strong>${escapeHtml(challenge.phrase)}</strong> to unlock ${settings.snoozeMinutes} more minutes.</div><div class="pause-check-row"><input id="pause-challenge-input" autocomplete="off" spellcheck="false" placeholder="Type the phrase exactly"><button id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button></div>`;
    if (challenge.type === 'math') return `<div class="pause-check-copy">Solve this quick check to unlock ${settings.snoozeMinutes} more minutes.</div><div class="pause-math-question">${escapeHtml(challenge.question)} = ?</div><div class="pause-check-row"><input id="pause-challenge-input" inputmode="numeric" autocomplete="off" placeholder="Answer"><button id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button></div>`;
    if (challenge.type === 'match') return `<div class="pause-check-copy">Select every tile with <strong class="pause-target-icon">${challenge.target}</strong>.</div><div class="pause-tile-grid ${gridClass(challenge.cols)}" id="pause-tile-grid">${challenge.tiles.map((icon,i)=>`<button type="button" class="pause-tile" data-index="${i}">${icon}</button>`).join('')}</div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'odd') return `<div class="pause-check-copy">Spot the subtly different tile.</div><div class="pause-tile-grid ${gridClass(challenge.cols)}" id="pause-tile-grid">${Array.from({length:challenge.cols*challenge.cols},(_,i)=>`<button type="button" class="pause-tile pause-shape-tile" data-index="${i}"><span style="display:inline-block;transform:rotate(${i===challenge.oddIndex?challenge.rotation:0}deg)">${challenge.symbol}</span></button>`).join('')}</div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'wire') return `<div class="pause-check-copy">Connect each left wire to the matching <strong>color + shape</strong> on the right.</div><div class="pause-wire-board" id="pause-wire-board"><svg class="pause-wire-lines" id="pause-wire-lines"></svg><div class="pause-wire-column">${challenge.left.map(item=>`<button type="button" class="pause-wire-node" data-side="left" data-pair="${item.id}" data-color="${item.color}" style="--wire-color:${item.color}" aria-label="${item.name}"><span>${item.shape}</span></button>`).join('')}</div><div class="pause-wire-column">${challenge.right.map(item=>`<button type="button" class="pause-wire-node" data-side="right" data-pair="${item.id}" data-color="${item.color}" style="--wire-color:${item.color}" aria-label="${item.name}"><span>${item.shape}</span></button>`).join('')}</div></div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'slider') return `<div class="pause-check-copy">Move the slider to <strong>${challenge.target}</strong>${challenge.tolerance?` (within ±${challenge.tolerance})`:''}.</div><div class="pause-precision"><input id="pause-precision-slider" type="range" min="0" max="100" value="0"><output id="pause-precision-value">0</output></div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'count') return `<div class="pause-check-copy">How many <strong>${challenge.target}</strong> shapes are in the grid?</div><div class="pause-tile-grid ${gridClass(challenge.cols)} pause-count-grid">${challenge.tiles.map(x=>`<div class="pause-tile pause-static-tile">${x}</div>`).join('')}</div><div class="pause-check-row"><input id="pause-challenge-input" inputmode="numeric" autocomplete="off" placeholder="Count"><button id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button></div>`;
    if (challenge.type === 'duplicate') return `<div class="pause-check-copy">Find the <strong>two matching tiles</strong>. Tap both copies.</div><div class="pause-tile-grid ${gridClass(challenge.cols)}" id="pause-tile-grid">${challenge.tiles.map((x,i)=>`<button type="button" class="pause-tile" data-index="${i}">${x}</button>`).join('')}</div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'spam') return `<div class="pause-check-copy">Press the button <strong>${challenge.clicks} times</strong> to prove you really want more scrolling time.</div><div class="pause-spam-wrap"><button type="button" class="pause-spam-button" id="pause-spam-button">PRESS ME</button><div class="pause-pump-count" id="pause-spam-count">0 / ${challenge.clicks} presses</div></div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'balloon') return `<div class="pause-check-copy">Pump the balloon until it pops. Drag the pump all the way back and forth.</div><div class="pause-balloon-wrap"><div class="pause-balloon" id="pause-balloon">🎈</div><div class="pause-pump-count" id="pause-pump-count">0 / ${challenge.pumps} pumps</div><input id="pause-balloon-pump" type="range" min="0" max="100" value="0" aria-label="Balloon pump"></div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'fishing') return `<div class="pause-check-copy">Keep the hook inside the moving green catch zone until the meter fills.</div><div class="pause-fishing"><div class="pause-fish-track"><div id="pause-fish-zone" class="pause-fish-zone"></div></div><input id="pause-fish-slider" type="range" min="0" max="100" value="50" aria-label="Fishing hook position"><div class="pause-fish-progress"><i id="pause-fish-progress"></i></div></div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'piano') return `<div class="pause-check-copy">Watch the piano pattern, then play it back from memory.</div><div class="pause-piano" id="pause-piano">${challenge.keys.map((k,i)=>`<button type="button" class="pause-piano-key" data-key="${i}">${k}</button>`).join('')}</div><button type="button" class="pause-piano-replay" id="pause-piano-replay">Show pattern</button><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'path') { const cells=Array.from({length:challenge.cols*challenge.cols},(_,i)=>{const n=challenge.checkpoints.indexOf(i)+1;return `<button type="button" class="pause-path-cell ${n?'has-number':''}" data-cell="${i}" data-number="${n||0}">${n||''}</button>`}).join(''); return `<div class="pause-check-copy">Start on <strong>1</strong> and visit <strong>every tile exactly once</strong>, while hitting each numbered checkpoint in order. Move only up, down, left, or right.</div><div class="pause-path-wrap" id="pause-path-wrap"><svg class="pause-path-lines" id="pause-path-lines" aria-hidden="true"></svg><div class="pause-path-grid" id="pause-path-grid" style="--path-cols:${challenge.cols}">${cells}</div></div><button type="button" class="pause-piano-replay" id="pause-path-reset">Reset path</button><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;}
    if (challenge.type === 'align') return `<div class="pause-check-copy">Navigate around the walls and fit the solid shape inside the outline.</div><div class="pause-align-board" id="pause-align-board">${challenge.walls.map(w=>`<div class="pause-align-wall" style="left:calc(50% + ${w.x}px);top:calc(50% + ${w.y}px);width:${w.w}px;height:${w.h}px"></div>`).join('')}<div class="pause-align-target" style="transform:translate(${challenge.targetX}px,${challenge.targetY}px)">◆</div><div class="pause-align-piece" id="pause-align-piece">◆</div></div><div class="pause-dpad"><button data-dir="up">↑</button><div><button data-dir="left">←</button><button data-dir="down">↓</button><button data-dir="right">→</button></div></div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'cook') return `<div class="pause-check-copy">Cook every item to green. Drag or click an item onto the grill, then remove it while it is perfectly cooked. Burn one and you restart.</div><div class="pause-cook-source" id="pause-cook-source">${Array.from({length:challenge.items},(_,i)=>`<button type="button" draggable="true" class="pause-food" data-food="${i}">${['🥩','🍔','🌽','🍤'][i%4]}</button>`).join('')}</div><div class="pause-grill" id="pause-grill"><span>GRILL</span></div><div class="pause-cook-score" id="pause-cook-score">0 / ${challenge.items} perfect</div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    if (challenge.type === 'tower') return `<div class="pause-check-copy">Stack every shape so none touch the ground, then keep the tower standing for 3 seconds.</div><div class="pause-tower-board" id="pause-tower-board"><div class="pause-tower-ground"></div><div class="pause-tower-platform" id="pause-tower-platform"></div>${Array.from({length:challenge.blocks},(_,i)=>`<div class="pause-tower-block" data-block="${i}" style="left:${12+i*16}%;top:${10+(i%2)*10}px;width:${44+(i%3)*8}px">${['■','●','▲','◆','⬢'][i%5]}</div>`).join('')}</div><div class="pause-pump-count" id="pause-tower-status">Drag the pieces into a tower.</div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
    return `<div class="pause-check-copy">Tap the numbers in order: <strong>${Array.from({length:challenge.max||4},(_,i)=>i+1).join(' → ')}</strong>.</div><div class="pause-order-row ${challenge.max>=8?'pause-order-hard':''}" id="pause-order-row">${challenge.nums.map(n=>`<button type="button" class="pause-order-tile" data-number="${n}">${n}</button>`).join('')}</div><button class="pause-wide-snooze" id="pause-snooze" disabled>${settings.snoozeMinutes} more min</button>`;
  }

  function wireChallenge(el, challenge, unlock, allowSnooze = true) {
    const status = el.querySelector('#pause-check-status');
    const snoozeButton = el.querySelector('#pause-snooze');
    const solved = () => {
      snoozeButton.disabled = !allowSnooze;
      status.textContent = allowSnooze ? 'Challenge complete.' : 'Check complete.';
    };

    if (challenge.type === 'phrase' || challenge.type === 'math') {
      const input = el.querySelector('#pause-challenge-input');
      input.addEventListener('input', () => {
        const value = input.value.trim();
        const correct = challenge.type === 'phrase'
          ? value.toLowerCase() === challenge.phrase.toLowerCase()
          : Number(value) === challenge.answer;
        snoozeButton.disabled = allowSnooze ? !correct : true;
        status.textContent = correct ? 'Challenge complete.' : 'Complete the check.';
      });
      setTimeout(() => input.focus(), 100);
    } else if (challenge.type === 'match') {
      const selected = new Set();
      const targetIndices = new Set(challenge.tiles.map((x, i) => x === challenge.target ? i : -1).filter(i => i >= 0));
      el.querySelectorAll('.pause-tile').forEach(button => {
        button.addEventListener('click', () => {
          const i = Number(button.dataset.index);
          if (selected.has(i)) selected.delete(i); else selected.add(i);
          button.classList.toggle('selected', selected.has(i));
          button.setAttribute('aria-pressed', selected.has(i) ? 'true' : 'false');
          const exact = selected.size === targetIndices.size && [...targetIndices].every(index => selected.has(index));
          snoozeButton.disabled = allowSnooze ? !exact : true;
          status.textContent = exact ? 'Challenge complete.' : `Selected ${selected.size}. Find every ${challenge.target}.`;
        });
      });
    } else if (challenge.type === 'odd') {
      el.querySelectorAll('.pause-tile').forEach(button => {
        button.addEventListener('click', () => {
          const correct = Number(button.dataset.index) === challenge.oddIndex;
          el.querySelectorAll('.pause-tile').forEach(b => b.classList.remove('selected', 'wrong'));
          button.classList.add(correct ? 'selected' : 'wrong');
          snoozeButton.disabled = allowSnooze ? !correct : true;
          status.textContent = correct ? 'Challenge complete.' : 'Not that one. Look again.';
        });
      });
    } else if (challenge.type === 'wire') {
      const board = el.querySelector('#pause-wire-board');
      const svg = el.querySelector('#pause-wire-lines');
      const matched = new Set();
      let selectedLeft = null;

      const drawWire = (leftButton, rightButton, color) => {
        const boardRect = board.getBoundingClientRect();
        const l = leftButton.getBoundingClientRect();
        const r = rightButton.getBoundingClientRect();
        const x1 = l.right - boardRect.left;
        const y1 = l.top + l.height / 2 - boardRect.top;
        const x2 = r.left - boardRect.left;
        const y2 = r.top + r.height / 2 - boardRect.top;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const bend = Math.max(28, (x2 - x1) * .45);
        line.setAttribute('d', `M ${x1} ${y1} C ${x1+bend} ${y1}, ${x2-bend} ${y2}, ${x2} ${y2}`);
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', color);
        line.setAttribute('stroke-width', '5');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);
      };

      const leftNodes = [...el.querySelectorAll('.pause-wire-node[data-side="left"]')];
      const rightNodes = [...el.querySelectorAll('.pause-wire-node[data-side="right"]')];
      leftNodes.forEach(button => button.addEventListener('click', () => {
        if (matched.has(button.dataset.pair)) return;
        leftNodes.forEach(b => b.classList.remove('active'));
        selectedLeft = button;
        button.classList.add('active');
        status.textContent = `Now choose the matching ${button.getAttribute('aria-label')} on the right.`;
      }));
      rightNodes.forEach(button => button.addEventListener('click', () => {
        if (matched.has(button.dataset.pair)) return;
        if (!selectedLeft) {
          status.textContent = 'Choose a wire on the left first.';
          return;
        }
        if (selectedLeft.dataset.pair === button.dataset.pair) {
          const pair = button.dataset.pair;
          matched.add(pair);
          selectedLeft.classList.remove('active');
          selectedLeft.classList.add('matched');
          button.classList.add('matched');
          drawWire(selectedLeft, button, button.dataset.color);
          selectedLeft = null;
          status.textContent = matched.size === challenge.left.length
            ? 'All wires connected — challenge complete.'
            : `${matched.size}/${challenge.left.length} wires connected.`;
          if (matched.size === challenge.left.length) solved();
        } else {
          button.classList.add('wrong');
          selectedLeft.classList.add('wrong');
          status.textContent = 'Those do not match. Try that wire again.';
          setTimeout(() => {
            button.classList.remove('wrong');
            if (selectedLeft) selectedLeft.classList.remove('wrong');
          }, 320);
        }
      }));
    } else if (challenge.type === 'slider') {
      const slider=el.querySelector('#pause-precision-slider'), out=el.querySelector('#pause-precision-value');
      slider.addEventListener('input',()=>{const v=Number(slider.value);out.textContent=v;const ok=Math.abs(v-challenge.target)<=challenge.tolerance;snoozeButton.disabled=allowSnooze?!ok:true;status.textContent=ok?'Precision check complete.':`Current value: ${v}. Target: ${challenge.target}.`;});
    } else if (challenge.type === 'count') {
      const input=el.querySelector('#pause-challenge-input');
      input.addEventListener('input',()=>{const ok=Number(input.value)===challenge.answer;snoozeButton.disabled=allowSnooze?!ok:true;status.textContent=ok?'Count correct — challenge complete.':'Count the target shapes carefully.';});
    } else if (challenge.type === 'duplicate') {
      const selected=new Set();
      el.querySelectorAll('.pause-tile').forEach(button=>button.addEventListener('click',()=>{const i=Number(button.dataset.index);if(selected.has(i))selected.delete(i);else if(selected.size<2)selected.add(i);button.classList.toggle('selected',selected.has(i));const picks=[...selected].map(ix=>challenge.tiles[ix]);const ok=picks.length===2&&picks[0]===challenge.duplicate&&picks[1]===challenge.duplicate;snoozeButton.disabled=allowSnooze?!ok:true;status.textContent=ok?'Duplicate found — challenge complete.':selected.size===2?'Those are not the duplicate pair.':'Select both matching tiles.';if(selected.size===2&&!ok){setTimeout(()=>{selected.clear();el.querySelectorAll('.pause-tile').forEach(b=>b.classList.remove('selected'));},450);}}));
    } else if (challenge.type === 'spam') {
      const spamButton=el.querySelector('#pause-spam-button'), countEl=el.querySelector('#pause-spam-count');
      let clicks=0;
      spamButton.addEventListener('click',()=>{clicks++;const remaining=Math.max(0,challenge.clicks-clicks);countEl.textContent=`${Math.min(clicks,challenge.clicks)} / ${challenge.clicks} presses`;spamButton.textContent=remaining?`PRESS ME · ${remaining}`:'DONE';if(clicks>=challenge.clicks){spamButton.disabled=true;snoozeButton.disabled=!allowSnooze;status.textContent='Button check complete.';}else status.textContent=`${remaining} presses left.`;});
    } else if (challenge.type === 'balloon') {
      const pump=el.querySelector('#pause-balloon-pump'), balloon=el.querySelector('#pause-balloon'), countEl=el.querySelector('#pause-pump-count');
      let pumps=0,lastEdge='low';
      pump.addEventListener('input',()=>{const v=Number(pump.value);let edge=v>=92?'high':v<=8?'low':null;if(edge&&edge!==lastEdge){if(lastEdge==='low'&&edge==='high'||lastEdge==='high'&&edge==='low'){pumps++;countEl.textContent=`${Math.min(pumps,challenge.pumps)} / ${challenge.pumps} pumps`;const scale=1+Math.min(.9,pumps/challenge.pumps*.9);balloon.style.transform=`scale(${scale})`;if(pumps>=challenge.pumps){balloon.textContent='💥';snoozeButton.disabled=!allowSnooze;status.textContent='Balloon popped — challenge complete.';pump.disabled=true;}}lastEdge=edge;}});
    } else if (challenge.type === 'fishing') {
      const slider=el.querySelector('#pause-fish-slider'),zone=el.querySelector('#pause-fish-zone'),bar=el.querySelector('#pause-fish-progress');
      let progress=0,last=performance.now(),zonePos=50,from=50,to=50,moveStart=0,moving=false,nextMoveAt=performance.now()+challenge.pauseMin+Math.random()*(challenge.pauseMax-challenge.pauseMin);
      const need=challenge.seconds*1000;
      zone.style.width=`${challenge.tolerance*2}%`;
      const pickFarTarget=()=>{let candidate=zonePos,tries=0;while(Math.abs(candidate-zonePos)<challenge.minJump&&tries++<20)candidate=12+Math.random()*76;return Math.max(12,Math.min(88,candidate));};
      const tick=(now)=>{if(!document.documentElement.contains(el)||progress>=need)return;const dt=Math.min(60,now-last);last=now;
        if(!moving&&now>=nextMoveAt){from=zonePos;to=pickFarTarget();moveStart=now;moving=true;status.textContent='The fish is running — follow it!';}
        if(moving){const t=Math.min(1,(now-moveStart)/challenge.runMs);const eased=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;zonePos=from+(to-from)*eased;if(t>=1){moving=false;zonePos=to;nextMoveAt=now+challenge.pauseMin+Math.random()*(challenge.pauseMax-challenge.pauseMin);}}
        zone.style.left=`${zonePos-challenge.tolerance}%`;
        const inside=Math.abs(Number(slider.value)-zonePos)<=challenge.tolerance;
        progress=Math.max(0,Math.min(need,progress+(inside?dt*(challenge.gain||1.4):-dt*(challenge.decay||.5))));bar.style.width=`${progress/need*100}%`;
        if(!moving)status.textContent=inside?'Hold it there…':'Get the hook back into the green catch zone.';
        if(progress>=need){snoozeButton.disabled=!allowSnooze;status.textContent='Fish caught — challenge complete.';return;}requestAnimationFrame(tick);};requestAnimationFrame(tick);
    } else if (challenge.type === 'piano') {
      const keys=[...el.querySelectorAll('.pause-piano-key')],replay=el.querySelector('#pause-piano-replay'); let accepting=false,index=0;
      const flash=async()=>{accepting=false;index=0;keys.forEach(k=>k.disabled=true);for(const n of challenge.sequence){keys[n].classList.add('active');await new Promise(r=>setTimeout(r,330));keys[n].classList.remove('active');await new Promise(r=>setTimeout(r,120));}keys.forEach(k=>k.disabled=false);accepting=true;status.textContent='Your turn — repeat the pattern.';};
      replay.addEventListener('click',flash); keys.forEach((k,n)=>k.addEventListener('click',()=>{if(!accepting)return;k.classList.add('active');setTimeout(()=>k.classList.remove('active'),140);if(challenge.sequence[index]===n){index++;if(index===challenge.sequence.length){accepting=false;snoozeButton.disabled=!allowSnooze;status.textContent='Pattern remembered — challenge complete.';}}else{index=0;status.textContent='Pattern reset. Watch it again.';flash();}})); setTimeout(flash,350);
    } else if (challenge.type === 'path') {
      const grid=el.querySelector('#pause-path-grid'),wrap=el.querySelector('#pause-path-wrap'),svg=el.querySelector('#pause-path-lines'),cells=[...grid.querySelectorAll('.pause-path-cell')];
      let visited=[], nextCheckpoint=1;
      const clearLines=()=>{svg.innerHTML='';};
      const adjacent=(a,b)=>{const ar=Math.floor(a/challenge.cols),ac=a%challenge.cols,br=Math.floor(b/challenge.cols),bc=b%challenge.cols;return Math.abs(ar-br)+Math.abs(ac-bc)===1;};
      const drawLine=(a,b)=>{const wr=wrap.getBoundingClientRect(),ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${wr.width} ${wr.height}`);svg.setAttribute('width',wr.width);svg.setAttribute('height',wr.height);const x1=ar.left+ar.width/2-wr.left,y1=ar.top+ar.height/2-wr.top,x2=br.left+br.width/2-wr.left,y2=br.top+br.height/2-wr.top;const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',x1);line.setAttribute('y1',y1);line.setAttribute('x2',x2);line.setAttribute('y2',y2);line.setAttribute('stroke','#7057ff');line.setAttribute('stroke-width','5');line.setAttribute('stroke-linecap','round');svg.appendChild(line);};
      const reset=()=>{visited=[];nextCheckpoint=1;clearLines();cells.forEach(c=>c.classList.remove('selected','wrong'));status.textContent='Start on 1, then visit every tile exactly once while reaching checkpoints in order.';snoozeButton.disabled=true;};
      const resetButton=el.querySelector('#pause-path-reset');
      if(resetButton) resetButton.addEventListener('click',reset);
      cells.forEach(cell=>cell.addEventListener('click',()=>{
        const idx=Number(cell.dataset.cell), num=Number(cell.dataset.number);
        if(!visited.length){
          if(num!==1){cell.classList.add('wrong');status.textContent='Your path must start on 1.';setTimeout(()=>cell.classList.remove('wrong'),240);return;}
          visited=[idx];nextCheckpoint=2;cell.classList.add('selected');status.textContent=`Path started. Reach checkpoint ${nextCheckpoint}.`;return;
        }
        const last=visited[visited.length-1];
        if(visited.includes(idx)){cell.classList.add('wrong');status.textContent='You cannot reuse a tile.';setTimeout(()=>cell.classList.remove('wrong'),240);return;}
        if(!adjacent(last,idx)){cell.classList.add('wrong');status.textContent='Move only up, down, left, or right — no diagonals or jumps.';setTimeout(()=>cell.classList.remove('wrong'),240);return;}
        if(num && num!==nextCheckpoint){cell.classList.add('wrong');status.textContent=`You must reach checkpoint ${nextCheckpoint} before ${num}.`;setTimeout(()=>cell.classList.remove('wrong'),240);return;}
        const prev=cells[last];drawLine(prev,cell);visited.push(idx);cell.classList.add('selected');
        if(num===nextCheckpoint) nextCheckpoint++;
        const allTiles=visited.length===challenge.cols*challenge.cols;
        const allCheckpoints=nextCheckpoint>challenge.checkpoints.length;
        if(allTiles&&allCheckpoints){snoozeButton.disabled=!allowSnooze;status.textContent='Path complete — every tile visited exactly once.';}
        else if(allCheckpoints){status.textContent=`All checkpoints reached. Keep going — ${challenge.cols*challenge.cols-visited.length} tile${challenge.cols*challenge.cols-visited.length===1?'':'s'} left.`;}
        else status.textContent=`Good. Keep extending the path to checkpoint ${nextCheckpoint}. ${challenge.cols*challenge.cols-visited.length} tiles left.`;
      }));
      reset();
    } else if (challenge.type === 'align') {
      const piece=el.querySelector('#pause-align-piece');let x=challenge.startX,y=challenge.startY;
      const hitsWall=(nx,ny)=>challenge.walls.some(w=>Math.abs(nx-w.x)<w.w/2+23&&Math.abs(ny-w.y)<w.h/2+23);
      const draw=()=>{piece.style.transform=`translate(${x}px,${y}px)`;const dx=Math.abs(x-challenge.targetX),dy=Math.abs(y-challenge.targetY);const ok=dx<=challenge.tolerance&&dy<=challenge.tolerance;snoozeButton.disabled=allowSnooze?!ok:true;status.textContent=ok?'Shape aligned — challenge complete.':`Target distance: ${Math.round(dx+dy)} px`;};draw();
      el.querySelectorAll('.pause-dpad button').forEach(b=>b.addEventListener('click',()=>{let nx=x,ny=y;const d=b.dataset.dir;if(d==='left')nx-=challenge.step;if(d==='right')nx+=challenge.step;if(d==='up')ny-=challenge.step;if(d==='down')ny+=challenge.step;nx=Math.max(-125,Math.min(125,nx));ny=Math.max(-88,Math.min(88,ny));if(!hitsWall(nx,ny)){x=nx;y=ny;}else{status.textContent='Wall blocked you — go around.';}draw();}));
    } else if (challenge.type === 'cook') {
      const source=el.querySelector('#pause-cook-source'),grill=el.querySelector('#pause-grill'),score=el.querySelector('#pause-cook-score');let done=0;const timers=new Map();
      const originalEmoji=new Map([...source.querySelectorAll('.pause-food')].map(f=>[f.dataset.food,f.textContent]));
      const resetAll=()=>{timers.forEach(v=>clearInterval(v.timer));timers.clear();done=0;score.textContent=`0 / ${challenge.items} perfect`;grill.querySelectorAll('.pause-food').forEach(f=>source.appendChild(f));source.querySelectorAll('.pause-food').forEach(f=>{f.disabled=false;f.dataset.state='raw';f.style.background='';f.textContent=originalEmoji.get(f.dataset.food)||'🍳';});status.textContent='Start again — watch the grill carefully.';};
      const burnFood=(food)=>{food.dataset.state='burn';food.style.background='#d3322b';food.textContent='🔥';food.disabled=true;status.textContent='Burned! 🔥 Restarting the grill…';timers.forEach(v=>clearInterval(v.timer));timers.clear();setTimeout(resetAll,900);};
      const startFood=(food)=>{if(timers.has(food)||food.disabled)return;grill.appendChild(food);const base=2600+Number(food.dataset.food)*700,greenStart=base,greenEnd=base+challenge.greenMs,started=Date.now();const timer=setInterval(()=>{const t=Date.now()-started;let color=t<greenStart*.55?'#d84b4b':t<greenStart?'#d8aa3a':'#4caf67';food.style.background=color;food.dataset.state=t>=greenStart&&t<=greenEnd?'green':'cooking';if(t>greenEnd){clearInterval(timer);burnFood(food);}},80);timers.set(food,{timer});status.textContent='Watch the colors. The instant green ends, it burns.';};
      const finishFood=(food)=>{if(food.parentElement!==grill)return;if(food.dataset.state==='green'){const o=timers.get(food);if(o)clearInterval(o.timer);timers.delete(food);food.disabled=true;food.style.background='#4caf67';source.appendChild(food);done++;score.textContent=`${done} / ${challenge.items} perfect`;if(done===challenge.items){snoozeButton.disabled=!allowSnooze;status.textContent='Everything cooked perfectly — challenge complete.';}}else if(food.dataset.state==='burn'){burnFood(food);}else{status.textContent='Not ready yet — wait for green.';}};
      source.querySelectorAll('.pause-food').forEach(food=>{food.addEventListener('click',()=>startFood(food));food.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain',food.dataset.food));});grill.addEventListener('dragover',e=>e.preventDefault());grill.addEventListener('drop',e=>{e.preventDefault();const food=source.querySelector(`[data-food="${e.dataTransfer.getData('text/plain')}"]`);if(food)startFood(food);});grill.addEventListener('click',e=>{const food=e.target.closest('.pause-food');if(food)finishFood(food);});
    } else if (challenge.type === 'tower') {
      const board=el.querySelector('#pause-tower-board'),blocks=[...board.querySelectorAll('.pause-tower-block')],platform=el.querySelector('#pause-tower-platform'),label=el.querySelector('#pause-tower-status');
      const state=blocks.map((b,i)=>({el:b,x:b.offsetLeft,y:b.offsetTop,placed:false,drag:false,ox:0,oy:0,index:i}));
      let stableSince=0,done=false,raf=0;
      const overlap=(x1,w1,x2,w2)=>Math.max(0,Math.min(x1+w1,x2+w2)-Math.max(x1,x2));
      const platformTop=()=>platform.offsetTop;
      const supportsFor=st=>{
        const out=[{kind:'platform',x:platform.offsetLeft,y:platformTop(),w:platform.offsetWidth}];
        for(const o of state){if(o===st||!o.placed)continue;out.push({kind:'block',block:o,x:o.x,y:o.y,w:o.el.offsetWidth});}
        return out;
      };
      const snapBlock=st=>{
        const w=st.el.offsetWidth,h=st.el.offsetHeight;
        const candidates=supportsFor(st).filter(s=>overlap(st.x,w,s.x,s.w)>=Math.min(w,s.w)*0.34);
        if(!candidates.length){st.placed=false;return false;}
        candidates.sort((a,b)=>Math.abs((a.y-h)-st.y)-Math.abs((b.y-h)-st.y));
        const s=candidates[0];
        if(Math.abs((s.y-h)-st.y)>115){st.placed=false;return false;}
        st.y=s.y-h;
        const minX=Math.max(s.x-w*.55,0),maxX=Math.min(s.x+s.w-w*.45,board.clientWidth-w);
        st.x=Math.max(minX,Math.min(maxX,st.x));
        st.placed=true;
        st.el.style.left=`${st.x}px`;st.el.style.top=`${st.y}px`;st.el.style.transform='translateX(0px) rotate(0deg)';
        return true;
      };
      const isFullySupported=st=>{
        if(!st.placed)return false;
        const w=st.el.offsetWidth,h=st.el.offsetHeight;
        return supportsFor(st).some(s=>Math.abs(st.y-(s.y-h))<3&&overlap(st.x,w,s.x,s.w)>=Math.min(w,s.w)*0.34);
      };
      const allStacked=()=>state.every(isFullySupported)&&state.some(st=>Math.abs(st.y-(platformTop()-st.el.offsetHeight))<3);
      const windLoop=now=>{
        if(done||!document.documentElement.contains(el))return;
        const stacked=allStacked();
        if(stacked){
          const amp=settings.friction==='strong'?5.5:settings.friction==='light'?1.5:3;
          state.forEach(st=>{if(!st.drag)st.el.style.transform=`translateX(${Math.sin(now/380+st.index*1.6)*amp}px) rotate(${Math.sin(now/520+st.index)*amp*.18}deg)`;});
          if(!stableSince)stableSince=now;
          const remain=Math.max(0,3-(now-stableSince)/1000);
          label.textContent=`Tower standing… ${remain.toFixed(1)}s`;
          if(now-stableSince>=3000){done=true;state.forEach(st=>st.el.style.transform='');snoozeButton.disabled=!allowSnooze;status.textContent='Tower survived the wind — challenge complete.';return;}
        }else{
          stableSince=0;
          state.forEach(st=>{if(!st.drag)st.el.style.transform='';});
          label.textContent='Stack every piece on the raised platform. Wind starts once the tower is complete.';
        }
        raf=requestAnimationFrame(windLoop);
      };
      state.forEach(st=>{const b=st.el;
        b.addEventListener('pointerdown',e=>{st.drag=true;st.placed=false;stableSince=0;b.style.transform='';const r=b.getBoundingClientRect();st.ox=e.clientX-r.left;st.oy=e.clientY-r.top;b.setPointerCapture?.(e.pointerId);});
        b.addEventListener('pointermove',e=>{if(!st.drag)return;const br=board.getBoundingClientRect();const maxX=board.clientWidth-b.offsetWidth,maxY=board.clientHeight-b.offsetHeight-34;st.x=Math.max(0,Math.min(maxX,e.clientX-br.left-st.ox));st.y=Math.max(0,Math.min(maxY,e.clientY-br.top-st.oy));b.style.left=`${st.x}px`;b.style.top=`${st.y}px`;});
        const release=e=>{if(!st.drag)return;st.drag=false;try{if(e?.pointerId!=null&&b.hasPointerCapture?.(e.pointerId))b.releasePointerCapture(e.pointerId);}catch{}
          const br=board.getBoundingClientRect(),rr=b.getBoundingClientRect();st.x=Math.max(0,Math.min(board.clientWidth-b.offsetWidth,rr.left-br.left));st.y=Math.max(0,Math.min(board.clientHeight-b.offsetHeight-34,rr.top-br.top));
          if(!snapBlock(st)){label.textContent='Drop the piece close to the platform or another block so it can stack.';}
        };
        b.addEventListener('pointerup',release);b.addEventListener('pointercancel',release);
      });
      raf=requestAnimationFrame(windLoop);
    } else if (challenge.type === 'order') {
      let next = 1;
      el.querySelectorAll('.pause-order-tile').forEach(button => {
        button.addEventListener('click', () => {
          const n = Number(button.dataset.number);
          if (n === next) {
            button.disabled = true;
            button.classList.add('selected');
            next += 1;
            const max = challenge.max || 4;
            status.textContent = next > max ? 'Sequence complete — challenge complete.' : `Good. Tap ${next} next.`;
            if (next > max) solved();
          } else {
            next = 1;
            el.querySelectorAll('.pause-order-tile').forEach(b => { b.disabled = false; b.classList.remove('selected'); });
            status.textContent = 'Order reset. Start again with 1.';
          }
        });
      });
    }

    snoozeButton.addEventListener('click', unlock);
  }

  function challengeRequirement() {
    const level = String(settings.friction || 'medium').toLowerCase();
    return level === 'light' ? 1 : level === 'strong' ? 3 : 2;
  }

  function showNudge(current, restoring = false) {
    if (document.getElementById('pause-scroll-nudge')) return;
    shownForSession = true;
    const minutes = current.type === 'short' ? settings.shortMinutes : settings.longMinutes;
    const idea = randomIdea();
    const requiredChallenges = challengeRequirement();
    let challengeStep = 1;
    const el = document.createElement('aside');
    el.id = 'pause-scroll-nudge';
    el.innerHTML = `
      <div class="pause-overlay-card" role="dialog" aria-modal="true" aria-label="Pause scrolling check-in">
        <div class="pause-logo"><i></i><i></i></div>
        <div class="pause-kicker">${minutes} minute check-in · ${current.label}</div>
        <div class="pause-title">Time for a real break?</div>
        <div class="pause-copy">You asked Pause to interrupt you here instead of letting the feed keep going.</div>
        <div class="pause-idea-label">Try this instead</div>
        <div class="pause-idea" id="pause-idea">${escapeHtml(idea)}</div>
        <div class="pause-actions">
          <button id="pause-done">Do this & leave</button>
          <button id="pause-another">Another idea</button>
        </div>
        <div class="pause-intent-check">
          <div class="pause-check-title">Want to keep scrolling?</div>
          <div class="pause-check-progress" id="pause-check-progress"></div>
          <div id="pause-challenge-stage"></div>
        </div>
        <div class="pause-small">Your idea list is editable from the Pause extension popup.</div>
      </div>`;
    document.documentElement.appendChild(el);

    el.querySelector('#pause-done').addEventListener('click', leaveFeed);
    el.querySelector('#pause-another').addEventListener('click', () => {
      el.querySelector('#pause-idea').textContent = randomIdea();
    });

    const stage = el.querySelector('#pause-challenge-stage');
    const progress = el.querySelector('#pause-check-progress');

    const renderSequenceChallenge = () => {
      const challenge = makeChallenge();
      const finalStep = challengeStep >= requiredChallenges;
      progress.textContent = requiredChallenges === 1
        ? 'Complete 1 intent check to unlock extra time.'
        : `Challenge ${challengeStep} of ${requiredChallenges}`;
      stage.innerHTML = `${challengeMarkup(challenge)}<div class="pause-check-status" id="pause-check-status" aria-live="polite">Complete this check${finalStep ? ' to unlock more scrolling time.' : ' to continue to the next check.'}</div>`;
      const actionButton = stage.querySelector('#pause-snooze');
      if (actionButton) {
        actionButton.textContent = finalStep ? `${settings.snoozeMinutes} more min` : `Next challenge (${challengeStep}/${requiredChallenges})`;
      }

      wireChallenge(stage, challenge, () => {
        const button = stage.querySelector('#pause-snooze');
        if (!button || button.disabled) return;
        if (!finalStep) {
          challengeStep += 1;
          renderSequenceChallenge();
          return;
        }
        snoozedUntil = Date.now() + Number(settings.snoozeMinutes) * 60 * 1000;
        shownForSession = false;
        // Keep the session at its limit during snooze. When the snooze expires,
        // the overlay returns immediately with a fresh sequence of challenges.
        seconds = limitSeconds(current);
        el.remove();
        persistSession(current);
      });
    };

    renderSequenceChallenge();
    if (!restoring) persistSession(current);
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'PAUSE_GET_TIMER') return;
    const current = mode();
    if (!current) {
      sendResponse({ active: false });
      return;
    }
    const snapshot = sessionSnapshot(current);
    sendResponse({ active: true, ...snapshot });
  });

  setInterval(() => {
    if (!initialized) return;
    const current = mode();
    const key = modeKey(current);

    if (key !== currentModeKey) {
      // Moving between individual Shorts/Reels keeps the same key, so the timer does not reset.
      // Leaving the feed or switching between short- and long-form starts a new session.
      if (!current) {
        currentModeKey = null;
        seconds = 0;
        shownForSession = false;
        snoozedUntil = 0;
        snoozeUsed = false;
        clearOverlay();
        chrome.storage.local.remove(SESSION_KEY);
        return;
      }
      resetSession(current);
    }

    if (!current || document.hidden) return;
    if (Date.now() < snoozedUntil) {
      if (++persistTick % 5 === 0) persistSession(current);
      return;
    }

    seconds += 1;
    const threshold = limitSeconds(current);
    if (seconds >= threshold && !shownForSession) showNudge(current);
    if (++persistTick % 5 === 0) persistSession(current);
  }, 1000);
})();
