const THREE_URL="https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js";
(async()=>{
  const app=document.getElementById("app");if(!app)return;
  const canvas=document.createElement("canvas");canvas.id="world3d";Object.assign(canvas.style,{position:"fixed",inset:"0",width:"100%",height:"100%",zIndex:"3",pointerEvents:"none",background:"#77756f"});app.prepend(canvas);
  let T;try{T=await import(THREE_URL)}catch(e){canvas.remove();console.warn("3D fallback",e);return}
  const bridge=await new Promise(resolve=>{let n=0;const f=()=>window.Germany3DBridge?resolve(window.Germany3DBridge):(++n>120?resolve(null):setTimeout(f,50));f()});if(!bridge){canvas.remove();return}
  const S=.02,H=.038,ox=bridge.WORLD.w*S/2,oz=bridge.WORLD.h*S/2,X=x=>x*S-ox,Z=y=>y*S-oz;
  const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=T.SRGBColorSpace;
  const scene=new T.Scene();scene.background=new T.Color(0x77756f);scene.fog=new T.Fog(0x77756f,24,72);
  const camera=new T.PerspectiveCamera(48,innerWidth/innerHeight,.1,150);scene.add(new T.HemisphereLight(0xe4e0d6,0x454440,2.3));const sun=new T.DirectionalLight(0xf4f1e8,1.4);sun.position.set(-20,30,18);scene.add(sun);
  const mat=(c,r=1)=>new T.MeshStandardMaterial({color:c,roughness:r});
  const M={ground:mat(0x89867f),road:mat(0x555552),walk:mat(0xaaa69d),cross:mat(0xd2cdc0),grass:mat(0x68705e),path:mat(0xa9a59b),wall:mat(0x74716b),dark:mat(0x333432),win:mat(0x414544,.55),metal:mat(0x505252,.7),skin:mat(0xcabca8),npc:mat(0x55524d),player:mat(0x242424),police:mat(0x303943),merkel:mat(0x77746d)};
  const world=new T.Group();scene.add(world);
  const box=(w,h,d,m,x,y,z,p=world)=>{const q=new T.Mesh(new T.BoxGeometry(w,h,d),m);q.position.set(x,y,z);p.add(q);return q};
  const plane=(w,d,m,x,z,y=.002)=>{const q=new T.Mesh(new T.PlaneGeometry(w,d),m);q.rotation.x=-Math.PI/2;q.position.set(x,y,z);world.add(q);return q};
  const rect=(r,m,y=.005)=>plane(r.w*S,r.h*S,m,X(r.x+r.w/2),Z(r.y+r.h/2),y);
  plane(bridge.WORLD.w*S,bridge.WORLD.h*S,M.ground,0,0,0);
  bridge.roads.forEach(r=>{rect({x:r.x-28,y:r.y-28,w:r.w+56,h:r.h+56},M.walk,.008);rect(r,M.road,.015);const h=r.w>r.h,total=(h?r.w:r.h)*S;for(let p=-total/2+1;p<total/2-1;p+=2.2)box(h?1.1:.07,.018,h?.07:1.1,M.cross,X(r.x+r.w/2)+(h?p:0),.03,Z(r.y+r.h/2)+(h?0:p))});
  bridge.crossings.forEach(c=>{for(let i=0;i<8;i++){const h=c.w>c.h,f=(i+.5)/8;box(h?c.w*S/8*.48:c.w*S,.025,h?c.h*S:c.h*S/8*.48,M.cross,X(c.x+c.w*(h?f:.5)),.04,Z(c.y+c.h*(h?.5:f)))}});rect(bridge.schreber,M.grass,.02);rect(bridge.policeGarden,M.grass,.021);
  const pp=bridge.policePath,ax=X(pp.x1),az=Z(pp.y1),bx=X(pp.x2),bz=Z(pp.y2),len=Math.hypot(bx-ax,bz-az),path=box(pp.width*S,.03,len,M.path,(ax+bx)/2,.04,(az+bz)/2);path.rotation.y=Math.atan2(bx-ax,bz-az);
  function label(a,b){const c=document.createElement("canvas");c.width=768;c.height=150;const g=c.getContext("2d");g.fillStyle="#ded9cc";g.fillRect(0,0,768,150);g.fillStyle="#222";g.textAlign="center";g.font="900 42px Arial";g.fillText(a,384,65);g.font="700 20px Arial";g.fillText(b||"",384,112);const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;const s=new T.Sprite(new T.SpriteMaterial({map:tx}));s.scale.set(4.6,.9,1);return s}
  function building(b,i){const g=new T.Group(),w=b.w*S,d=b.h*S,h=Math.max(2.8,b.hgt*H),cols=[0x6d6a64,0x77736d,0x62615d,0x807c74],bm=mat(cols[i%cols.length],.96);box(w,h,d,bm,0,h/2,0,g);box(w*1.03,.16,d*1.03,mat(0x8d8981),0,h+.08,0,g);const dx=(b.doorX-(b.x+b.w/2))*S;box(Math.min(1.3,w*.18),1.55,.1,M.dark,dx,.78,d/2+.06,g);box(Math.min(2,w*.32),.1,.62,mat(0xbab5a9),dx,1.72,d/2+.28,g);const cn=Math.max(2,Math.min(5,Math.floor(w/1.4))),rn=Math.max(2,Math.min(4,Math.floor(h/1.1)));for(let r=0;r<rn;r++)for(let c=0;c<cn;c++)box(.52,.34,.04,M.win,-w*.4+c*(w*.8/Math.max(1,cn-1)),.9+r*Math.max(.68,(h-1.6)/Math.max(1,rn-1)),d/2+.025,g);const l=label(b.name,b.sign);l.position.set(0,Math.max(1.8,h*.58),d/2+.09);g.add(l);g.position.set(X(b.x+b.w/2),0,Z(b.y+b.h/2));world.add(g)}
  bridge.buildings.forEach(building);

  function fence(r){const x0=X(r.x),x1=X(r.x+r.w),z0=Z(r.y),z1=Z(r.y+r.h),post=(x,z)=>box(.08,.75,.08,M.metal,x,.375,z);for(let x=x0;x<=x1;x+=2.2){post(x,z0);post(x,z1)}for(let z=z0;z<=z1;z+=2.2){post(x0,z);post(x1,z)}}
  function sheds(r,n){for(let i=0;i<n;i++){const cols=Math.ceil(n/2),x=X(r.x+80+(i%cols)*170),z=Z(r.y+110+Math.floor(i/cols)*220);box(1.5,1.1,1.15,mat(0x898379),x,.55,z);const roof=new T.Mesh(new T.ConeGeometry(1.15,.6,4),M.dark);roof.position.set(x,1.4,z);roof.rotation.y=Math.PI/4;world.add(roof)}}
  fence(bridge.policeGarden);sheds(bridge.schreber,4);sheds(bridge.policeGarden,6);
  [[700,720],[1450,720],[2800,720],[4050,720],[700,1880],[2800,1880],[4050,1880],[700,2860],[2800,2860],[4050,2860]].forEach(([x,y])=>{const g=new T.Group(),p=new T.Mesh(new T.CylinderGeometry(.04,.05,2.5,8),M.metal);p.position.y=1.25;g.add(p);box(.45,.05,.05,M.metal,.12,2.4,0,g);g.position.set(X(x),0,Z(y));world.add(g)});
  [[260,1750],[800,1760],[2700,650],[3400,680],[4300,650],[2700,1800],[4200,1800],[2800,2860],[4200,2860],[700,3500],[1800,3500],[4650,3500]].forEach(([x,y])=>{const g=new T.Group(),tr=new T.Mesh(new T.CylinderGeometry(.12,.16,1.3,7),mat(0x65594a));tr.position.y=.65;g.add(tr);const crown=new T.Mesh(new T.IcosahedronGeometry(.75,1),mat(0x4e5949));crown.position.y=1.7;g.add(crown);g.position.set(X(x),0,Z(y));world.add(g)});
  function prop(p){if(p.asset==="faxbillboard"){const g=new T.Group(),c=document.createElement("canvas");c.width=768;c.height=250;const x=c.getContext("2d");x.fillStyle="#ded9cc";x.fillRect(0,0,768,250);x.strokeStyle="#222";x.lineWidth=12;x.strokeRect(6,6,756,238);x.fillStyle="#222";x.textAlign="center";x.font="900 50px Arial";x.fillText("FAX 3000 PRO",384,70);x.font="900 32px Arial";x.fillText("2,75× SCHNELLER",384,124);x.font="700 18px Arial";x.fillText("DIE ZUKUNFT DER DIGITALISIERUNG IST PAPIER",384,195);const tx=new T.CanvasTexture(c),board=new T.Mesh(new T.BoxGeometry(4.8,1.65,.12),new T.MeshStandardMaterial({map:tx,roughness:.9}));board.position.y=2.8;g.add(board);[-1.7,1.7].forEach(v=>box(.1,2.2,.1,M.metal,v,1.1,0,g));g.position.set(X(p.x),0,Z(p.y));world.add(g)}}
  bridge.props.forEach(prop);
  function character(kind){const g=new T.Group(),m=kind==="player"?M.player:kind==="police"?M.police:kind==="merkel"?M.merkel:M.npc;box(.42,.72,.3,m,0,.72,0,g);const head=new T.Mesh(new T.SphereGeometry(.2,10,7),M.skin);head.position.y=1.3;g.add(head);const lg=new T.CylinderGeometry(.06,.07,.5,8),ag=new T.CylinderGeometry(.05,.06,.48,8),ll=new T.Mesh(lg,m),rl=ll.clone(),la=new T.Mesh(ag,m),ra=la.clone();ll.position.set(-.1,.27,0);rl.position.set(.1,.27,0);la.position.set(-.27,.76,0);ra.position.set(.27,.76,0);g.add(ll,rl,la,ra);g.userData={ll,rl,la,ra};if(kind==="merkel"){const hair=new T.Mesh(new T.SphereGeometry(.22,10,7,0,Math.PI*2,0,Math.PI*.58),mat(0x5d5953));hair.position.y=1.39;g.add(hair)}if(kind==="police"){const cap=new T.Mesh(new T.CylinderGeometry(.21,.21,.08,10),M.dark);cap.position.y=1.52;g.add(cap)}return g}
  function syncChar(q,o,l=0){q.position.set(X(o.x),l,Z(o.y));const ph=performance.now()*.008+(o.x+o.y)*.02,s=Math.sin(ph)*.38;q.userData.ll.rotation.x=s;q.userData.rl.rotation.x=-s;q.userData.la.rotation.x=-s*.7;q.userData.ra.rotation.x=s*.7}
  function pickup(type){const g=new T.Group();if(type==="pfand"){const m=new T.Mesh(new T.CylinderGeometry(.07,.09,.5,9),mat(0x566153));m.position.y=.25;g.add(m)}else{const col=type==="currywurst"?0x805143:type==="bratwurst"?0x9a7653:0x8a694b,m=mat(col),q=new T.Mesh(type==="brezel"?new T.TorusGeometry(.18,.055,8,18):new T.CapsuleGeometry(.08,.4,4,8),m);q.rotation.z=type==="brezel"?0:Math.PI/2;q.position.y=.2;g.add(q)}return g}

  const playerMesh=character("player");scene.add(playerMesh);
  const npcMeshes=new Map(),policeMeshes=new Map(),pickupMeshes=new Map();
  bridge.getNPCs().forEach(n=>{const q=character(n.special==="merkel"?"merkel":"npc");scene.add(q);npcMeshes.set(n,q)});
  bridge.pickups.forEach(p=>{const q=pickup(p.type);scene.add(q);pickupMeshes.set(p,q)});
  function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}resize();addEventListener("resize",resize,{passive:true});
  window.Germany3D={ready:true,sync(){
    syncChar(playerMesh,bridge.player,0);
    bridge.getNPCs().forEach(n=>{let q=npcMeshes.get(n);if(!q){q=character(n.special==="merkel"?"merkel":"npc");scene.add(q);npcMeshes.set(n,q)}syncChar(q,n,n.special==="merkel"?.08:0)});
    const ps=bridge.getPolice();ps.forEach(p=>{let q=policeMeshes.get(p);if(!q){q=character("police");scene.add(q);policeMeshes.set(p,q)}syncChar(q,p,.04)});for(const [p,q] of policeMeshes)if(!ps.includes(p)){scene.remove(q);policeMeshes.delete(p)}
    bridge.pickups.forEach(p=>{const q=pickupMeshes.get(p);q.visible=!p.taken;if(q.visible){q.position.set(X(p.x),.2,Z(p.y));q.rotation.y+=.012}});
    const px=X(bridge.player.x),pz=Z(bridge.player.y);camera.position.set(px,11.5,pz+14);camera.lookAt(px,1,pz-2.7);renderer.render(scene,camera);
  }};
  app.classList.add("three-ready");
})();