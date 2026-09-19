(function(){
"use strict";
const canvas=document.getElementById("game"),ctx=canvas.getContext("2d"),keys=Object.create(null),WORLD={w:2400,h:2000};
const player={x:1180,y:1760,r:16,energy:100};
const state={started:false,modal:false,dialogue:false,wanted:0,offence:"AKTENLAGE: UNAUFFÄLLIG",wantedCooldown:0,runTimer:0,runWarned:false,roadTimer:0,roadWarned:false,jayCooldown:0,grassTimer:0,grassWarned:false,gardenCooldown:0,mission:0,forms:0,pfand:0,day:1,minutes:480,stadtbild:0,citizen:false,gameOver:false,rule:0,ruleTimer:0,lang:"de",voiceOn:true,region:"berlin",regionCooldown:0};
let police=[],particles=[],width=innerWidth,height=innerHeight,dpr=1,last=performance.now();
const roads=[{x:0,y:820,w:WORLD.w,h:260},{x:1050,y:0,w:260,h:WORLD.h}],crossings=[{x:1010,y:890,w:340,h:70},{x:1135,y:760,w:90,h:380}],schreber={x:90,y:1210,w:560,h:570};
const policeGarden={x:650,y:1530,w:560,h:440};
const BORDER_Y=1120;
const policePath={x1:1080,y1:1930,x2:620,y2:1490,width:104};

const props=[
 {x:130,y:1180,asset:"gartenzwerg",w:42,h:64},
 {x:360,y:1260,asset:"gartenzwerg",w:42,h:64},
 {x:590,y:1380,asset:"gartenzwerg",w:42,h:64},
 {x:720,y:1595,asset:"rasen",w:72,h:60},
 {x:1150,y:1900,asset:"rasen",w:72,h:60},
 {x:530,y:660,asset:"wartemarke",w:58,h:38},
 {x:1360,y:1180,asset:"muell",w:82,h:54},
 {x:560,y:505,asset:"ordner",w:36,h:48},
 {x:985,y:1160,asset:"db",w:100,h:66,id:"db",label:"DB-ANZEIGE"},
 {x:1010,y:720,asset:"baustelle",w:105,h:62,id:"baustelle",label:"BAUSTELLE"},
 {x:1320,y:1185,asset:"fahrrad",w:88,h:56,id:"fahrrad",label:"FAHRRAD"},
 {x:455,y:545,asset:"kaffee",w:48,h:66,id:"kaffee",label:"KAFFEEAUTOMAT",used:false},
 {x:575,y:1170,asset:"pfandautomat",w:54,h:70,id:"pfandautomat",label:"PFANDAUTOMAT"}
];
const assetSources={
 currywurst:"./assets/currywurst.svg",bratwurst:"./assets/bratwurst.svg",brezel:"./assets/brezel.svg",
 pfand:"./assets/pfandflasche.svg",gartenzwerg:"./assets/gartenzwerg.svg",ordner:"./assets/ordner.svg",
 wartemarke:"./assets/wartemarke.svg",rasen:"./assets/rasen-verboten.svg",muell:"./assets/muelltrennung.svg",
 db:"./assets/db-verspaetung.svg",baustelle:"./assets/baustelle.svg",fahrrad:"./assets/fahrrad.svg",kaffee:"./assets/kaffeeautomat.svg",pfandautomat:"./assets/pfandautomat.svg"
};
const assets={};for(const key in assetSources){const img=new Image();img.src=assetSources[key];assets[key]=img}
const policeBarks={
 berlin:["HALT! Stop mal immediately!","Nicht auf ze grass, bitte!","Ausweis, ID, irgendwas Officiales!","Please leave den Grünbereich sofort!","Das ist so wirklich not vorgesehen!","Bleiben Sie hinter ze line!"],
 germany:["HALT! STEHENBLEIBEN!","NICHT ÜBER DEN RASEN!","AUSWEIS BITTE!","SIE VERLASSEN SOFORT DEN GRÜNBEREICH!","DAS IST SO NICHT VORGESEHEN!","BLEIBEN SIE HINTER DER LINIE!"]
};
const npcDenglisch=["Also this ist jetzt aber auch nicht so gedacht.","Kann man machen. Muss man aber really nicht.","Ich möchte mich nicht complainen, aber ich complain jetzt.","Dafür gibt es bestimmt ein Formular, probably online but not really.","Früher war hier weniger process.","Sie stehen minimal im way.","Das ist bestimmt wegen der Baustelle. Die ist since 2009 da.","Dafür bin ich not responsible.","Ordnung muss schon sein, you know.","Haben Sie dafür einen appointment?"];
const englishText=new Map([
 ["ANMELDUNG I","REGISTRATION I"],["ANMELDUNG II","REGISTRATION II"],["ANMELDUNG III","REGISTRATION III"],
 ["STEUERLICHE ERFASSUNG","TAX REGISTRATION"],["VERSICHERUNGSNACHWEIS","INSURANCE EVIDENCE"],["DAS STADTBILD","THE CITY IMAGE"],["AUFENTHALT","RESIDENCE"],["EINBÜRGERUNG","CITIZENSHIP"],
 ["Gehen Sie zum Bürgeramt. Beantragen Sie die Erlaubnis, einen Antrag zu stellen.","Go to the Bürgeramt. Apply for permission to submit an application."],
 ["Die Wohnungsgeberbestätigung fehlt natürlich. Holen Sie sie bei der Hausverwaltung.","Naturally, the landlord confirmation is missing. Collect it from the property management office."],
 ["Zurück zum Bürgeramt. Jetzt fehlt das Ergänzungsblatt zum Ergänzungsblatt.","Back to the Bürgeramt. You are now missing the supplementary sheet for the supplementary sheet."],
 ["Gehen Sie zum Finanzamt. Dort erhalten Sie eine Nummer, mit der Sie weitere Nummern beantragen.","Go to the Finanzamt. There you receive a number allowing you to apply for more numbers."],
 ["Die Krankenkasse benötigt einen Nachweis, dass der Nachweis beantragt wurde.","The health insurer requires evidence that the evidence has been requested."],
 ["Das Stadtbildamt verlangt drei dringende optische Normierungen.","The City Image Office requires three urgent visual standardisations."],
 ["Beweisen Sie der Ausländerbehörde, dass Sie bereits alles bewiesen haben.","Prove to the immigration office that you have already proved everything."],
 ["Letzter fiktiver Antrag: deutsche Staatsangehörigkeit durch administratives Durchhaltevermögen.","Final fictional application: German citizenship through administrative endurance."],
 ["Also das ist jetzt aber auch nicht so gedacht.","Well, that is really not how this was intended."],
 ["Kann man machen. Muss man aber wirklich nicht.","You can do that. But you really do not have to."],
 ["Ich möchte mich nicht beschweren, aber ich beschwere mich.","I do not want to complain, but I am complaining."],
 ["Dafür gibt es bestimmt ein Formular.","There is certainly a form for that."],
 ["Früher war hier weniger Vorgang.","There used to be less procedure here."],
 ["Sie stehen minimal im Weg.","You are standing very slightly in the way."],
 ["Das ist bestimmt wegen der Baustelle. Die ist seit 2009 da.","That is probably because of the construction site. It has been there since 2009."],
 ["Dafür bin ich nicht zuständig.","I am not responsible for that."],
 ["Ordnung muss schon sein.","There does have to be order."],
 ["Haben Sie dafür einen Termin?","Do you have an appointment for that?"],
 ["Schrebergarten-Rasen ist anzuschauen, nicht zu betreten. Zuwiderhandlung löst sofortige Gefahrenabwehr aus.","Allotment-garden lawn is for viewing, not walking. Violations trigger immediate intervention."],
 ["Überdurchschnittlich zügiges Gehen kann als unnötige Dynamik gewertet werden.","Above-average walking speed may be treated as unnecessary dynamism."],
 ["Fahrbahnen sind ausschließlich an geometrisch vorgesehenen Stellen zu überqueren.","Roads may only be crossed at geometrically designated locations."],
 ["Mülltonnen müssen parallel zur gefühlten Bordsteinkante stehen.","Bins must remain parallel to the perceived kerb."],
 ["Spontaneität bedarf grundsätzlich der vorherigen Terminvereinbarung.","Spontaneity generally requires a prior appointment."],
 ["Leergut ist kein Müll, sondern temporär illiquides Vermögen.","Empty returnable bottles are not rubbish but temporarily illiquid assets."],
 ["Nach 22:00 Uhr ist sogar enthusiastisches Denken nur in Zimmerlautstärke zulässig.","After 22:00 even enthusiastic thinking is permitted only at room volume."],
 ["Wer wartet, hat durch sichtbares Warten seine Wartebereitschaft nachzuweisen.","Anyone waiting must demonstrate willingness to wait by visibly waiting."]
]);
const formEnglish={a38:["Application Permit A38","Incomplete completeness is considered incomplete."],wohnung:["Landlord confirmation confirming a dwelling","Confirm that the dwelling in which you dwell is, in fact, a dwelling."],ergaenzung:["Supplementary sheet for the supplemented application","This form only became necessary because of the previous form."],steuer:["Tax registration questionnaire","The following numbers exist primarily to generate further numbers."],versicherung:["Application for evidence of evidence","Health is private. This form is not."],aufenthalt:["Application for continuation of presence","For your appointment you require evidence that your appointment occurred."],citizenship:["Fictional application for German citizenship","Purely a game procedure. Not real law or a real requirement."]};
function localize(text){return state.lang==="en"?(englishText.get(text)||text):text}
function pointSegmentDistance(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,l2=dx*dx+dy*dy;if(!l2)return Math.hypot(px-x1,py-y1);const t=clamp(((px-x1)*dx+(py-y1)*dy)/l2,0,1),x=x1+t*dx,y=y1+t*dy;return Math.hypot(px-x,py-y)}
function onPoliceGardenPath(x,y){return pointSegmentDistance(x,y,policePath.x1,policePath.y1,policePath.x2,policePath.y2)<=policePath.width*.5}
function onPoliceGardenGrass(x,y){return inRect(x,y,policeGarden)&&!onPoliceGardenPath(x,y)}
function lawFor(msg){if(msg.includes("RASEN"))return "SPIEL-§ 17.3b";if(msg.includes("FAHRBAHN"))return "SPIEL-§ 8a";if(msg.includes("ZÜGIG"))return "SPIEL-§ 4 Abs. 2";return "SPIEL-§ 404"}
function regionOf(y){return y>BORDER_Y?"berlin":"germany"}
function showBorder(region){
 state.region=region;
 const box=document.getElementById("border-alert"),title=document.getElementById("border-title"),copy=document.getElementById("border-copy");
 if(region==="germany"){title.textContent="DEUTSCHLAND";copy.textContent="AB HIER NUR NOCH DEUTSCH.";speak("Willkommen in Deutschland. Ab hier nur noch Deutsch.",true)}
 else{title.textContent="BERLIN";copy.textContent="WELCOME BACK. DENG-LISCH IST WIEDER ZULÄSSIG.";speak("Welcome back in Berlin. Denglisch ist wieder erlaubt.",false)}
 box.hidden=false;clearTimeout(showBorder.t);showBorder.t=setTimeout(()=>box.hidden=true,2100);
 uiTone(region==="germany"?330:440,.12,"square",.04);updateHud()
}
function updateRegion(){
 const next=regionOf(player.y);
 state.regionCooldown=Math.max(0,state.regionCooldown-.016);
 if(next!==state.region&&state.regionCooldown<=0){state.regionCooldown=1;showBorder(next)}
}
function worldNpcLine(index){return state.region==="berlin"?npcDenglisch[index]:npcLines[index]}


const buildings=[
{id:"buergeramt",name:"BÜRGERAMT",x:150,y:220,w:350,h:250,hgt:115,doorX:325,doorY:500,sign:"TERMIN NUR MIT TERMIN"},
{id:"hausverwaltung",name:"HAUSVERWALTUNG",x:590,y:210,w:330,h:255,hgt:95,doorX:755,doorY:495,sign:"WOHNUNGSGEBERBESTÄTIGUNG"},
{id:"stadtbild",name:"AMT FÜR STADTBILD",x:1390,y:220,w:360,h:245,hgt:105,doorX:1570,doorY:495,sign:"OPTISCHE ORDNUNG · DIN 0815"},
{id:"auslaender",name:"AUSLÄNDERBEHÖRDE",x:1840,y:190,w:430,h:280,hgt:130,doorX:2055,doorY:505,sign:"VORSPRACHE NUR NACH VORSPRACHE"},
{id:"finanzamt",name:"FINANZAMT",x:1420,y:1260,w:360,h:265,hgt:120,doorX:1600,doorY:1555,sign:"STEUERN · NUMMERN · RÜCKFRAGEN"},
{id:"krankenkasse",name:"KRANKENKASSE",x:1900,y:1260,w:340,h:260,hgt:90,doorX:2070,doorY:1550,sign:"BITTE BLEIBEN SIE GESUND"},
{id:"polizei",name:"POLIZEI",x:710,y:1320,w:280,h:230,hgt:95,doorX:850,doorY:1580,sign:"ABSCHNITT 08"},
{id:"spaeti",name:"SPÄTI",x:130,y:620,w:250,h:145,hgt:55,doorX:255,doorY:795,sign:"PFAND · MATE · ALLES"},
{id:"imbiss",name:"WURST-INSEL",x:1900,y:630,w:280,h:150,hgt:55,doorX:2040,doorY:810,sign:"BRATWURST · CURRYWURST"}];
const missions=[
{title:"ANMELDUNG I",text:"Gehen Sie zum Bürgeramt. Beantragen Sie die Erlaubnis, einen Antrag zu stellen.",target:"buergeramt",form:"a38"},
{title:"ANMELDUNG II",text:"Die Wohnungsgeberbestätigung fehlt natürlich. Holen Sie sie bei der Hausverwaltung.",target:"hausverwaltung",form:"wohnung"},
{title:"ANMELDUNG III",text:"Zurück zum Bürgeramt. Jetzt fehlt das Ergänzungsblatt zum Ergänzungsblatt.",target:"buergeramt",form:"ergaenzung"},
{title:"STEUERLICHE ERFASSUNG",text:"Gehen Sie zum Finanzamt. Dort erhalten Sie eine Nummer, mit der Sie weitere Nummern beantragen.",target:"finanzamt",form:"steuer"},
{title:"VERSICHERUNGSNACHWEIS",text:"Die Krankenkasse benötigt einen Nachweis, dass der Nachweis beantragt wurde.",target:"krankenkasse",form:"versicherung"},
{title:"DAS STADTBILD",text:"Das Stadtbildamt verlangt drei dringende optische Normierungen.",target:"stadtbild",form:null},
{title:"AUFENTHALT",text:"Beweisen Sie der Ausländerbehörde, dass Sie bereits alles bewiesen haben.",target:"auslaender",form:"aufenthalt"},
{title:"EINBÜRGERUNG",text:"Letzter fiktiver Antrag: deutsche Staatsangehörigkeit durch administratives Durchhaltevermögen.",target:"auslaender",form:"citizenship"}];
const rules=[
["§17.3b","Schrebergarten-Rasen ist anzuschauen, nicht zu betreten. Zuwiderhandlung löst sofortige Gefahrenabwehr aus."],
["§4 Abs.2","Überdurchschnittlich zügiges Gehen kann als unnötige Dynamik gewertet werden."],
["§8a","Fahrbahnen sind ausschließlich an geometrisch vorgesehenen Stellen zu überqueren."],
["DIN 0815","Mülltonnen müssen parallel zur gefühlten Bordsteinkante stehen."],
["§23f","Spontaneität bedarf grundsätzlich der vorherigen Terminvereinbarung."],
["PfandO §1","Leergut ist kein Müll, sondern temporär illiquides Vermögen."],
["RuheV §2","Nach 22:00 Uhr ist sogar enthusiastisches Denken nur in Zimmerlautstärke zulässig."],
["§5.1","Wer wartet, hat durch sichtbares Warten seine Wartebereitschaft nachzuweisen."]];
const npcLines=["Also das ist jetzt aber auch nicht so gedacht.","Kann man machen. Muss man aber wirklich nicht.","Ich möchte mich nicht beschweren, aber ich beschwere mich.","Dafür gibt es bestimmt ein Formular.","Früher war hier weniger Vorgang.","Sie stehen minimal im Weg.","Das ist bestimmt wegen der Baustelle. Die ist seit 2009 da.","Dafür bin ich nicht zuständig.","Ordnung muss schon sein.","Haben Sie dafür einen Termin?"];
const npcs=[{x:520,y:720,name:"HERR KLEIN",line:0,vx:16,vy:0,min:470,max:900},{x:1470,y:670,name:"FRAU MÜLLER",line:3,vx:-13,vy:0,min:1360,max:1760},{x:720,y:1140,name:"HERR SCHULZ",line:6,vx:0,vy:12,min:1100,max:1280},{x:2150,y:1120,name:"FRAU NEUMANN",line:2,vx:0,vy:-10,min:1010,max:1240},{x:1500,y:1660,name:"HERR DIN",line:8,vx:14,vy:0,min:1360,max:1800}];
const pickups=[{x:1980,y:870,type:"bratwurst",label:"BRATWURST",taken:false,value:35},{x:2110,y:880,type:"currywurst",label:"CURRYWURST",taken:false,value:50},{x:1870,y:880,type:"brezel",label:"BREZEL",taken:false,value:22},{x:420,y:930,type:"pfand",label:"PFAND",taken:false},{x:930,y:1120,type:"pfand",label:"PFAND",taken:false},{x:1360,y:940,type:"pfand",label:"PFAND",taken:false},{x:2260,y:1210,type:"pfand",label:"PFAND",taken:false}];
const normObjects=[{x:2210,y:1190,type:"bin",fixed:false,label:"MÜLLTONNE 4,6° SCHIEF"},{x:1650,y:650,type:"chairs",fixed:false,label:"STÜHLE NICHT FLUCHTGERECHT"},{x:570,y:1140,type:"hedge",fixed:false,label:"HECKE 3 CM ZU INDIVIDUELL"}];
const forms={
a38:{code:"A38/1",title:"Passierschein A38 zur Beantragung eines weiteren Antrags",subtitle:"Bitte vollständig ausfüllen. Unvollständige Vollständigkeit gilt als unvollständig.",fields:[["text","VOLLSTÄNDIGER NAME"],["text","GEBURTSORT IN HEUTIGEN GEMEINDEGRENZEN"],["select","MELDESTATUS",["gemeldet","noch nicht gemeldet","gefühltermaßen gemeldet"]],["text","AKTENZEICHEN, FALLS BEREITS VORHANDEN"],["check","Ich bestätige, dass ich dieses Formular freiwillig unfreiwillig ausfülle."]]},
wohnung:{code:"WGB-88",title:"Wohnungsgeberbestätigung zur Bestätigung einer Wohnung",subtitle:"Bestätigen Sie, dass Ihre Wohnung tatsächlich eine Wohnung ist.",fields:[["text","ANSCHRIFT"],["text","WOHNUNGSGEBENDER WOHNUNGSGEBER"],["select","ART DER ÜBERLASSUNG",["vermietet","untervermietet","mysteriös überlassen"]],["text","TATSÄCHLICHES DATUM DER TATSACHE DES EINZUGS"],["check","Ich bestätige das Vorhandensein von Wänden und mindestens einer Tür."]]},
ergaenzung:{code:"ANM-E17",title:"Ergänzungsblatt zur Ergänzung des ergänzten Antrags",subtitle:"Dieses Formular wurde erst durch das vorherige Formular erforderlich.",fields:[["text","VORHERIGES AKTENZEICHEN"],["text","WARUM DIESES AKTENZEICHEN NICHT SCHON VORHER VORLAG"],["select","BEILAGENFORMAT",["A4","A4 gefaltet","A4 aus Überzeugung"]],["check","Ich akzeptiere die Entstehung eines weiteren Verwaltungsvorgangs."]]},
steuer:{code:"F-A-19%",title:"Fragebogen zur steuerlichen Erfassung einer erfassten Person",subtitle:"Die nachfolgenden Zahlen dienen der Erzeugung weiterer Zahlen.",fields:[["text","STEUERLICH RELEVANTER LIEBLINGSBUCHSTABE"],["text","GESCHÄTZTE EINNAHMEN IN EURO, CENT UND GEFÜHL"],["select","ORDNUNGSMÄSSIGKEIT",["ordnungsgemäß","sehr ordnungsgemäß","noch zu prüfen"]],["text","IBAN ODER ERKLÄRUNG DER NICHT-IBAN"],["check","Ich bestätige, dass Nichtwissen kein Dateiformat ist."]]},
versicherung:{code:"KV-100",title:"Antrag auf Nachweis eines Nachweises",subtitle:"Gesundheit ist privat. Dieses Formular ist es nicht.",fields:[["text","VERSICHERTENNUMMER, FALLS VORHANDEN"],["text","ERSATZNUMMER, FALLS NICHT VORHANDEN"],["select","AKTUELLER ZUSTAND",["versichert","voraussichtlich versichert","formularbedingt erschöpft"]],["text","HAUSARZT ODER URLAUBSBEGRÜNDUNG"],["check","Ich akzeptiere, dass eine Karte separat versendet werden könnte."]]},
aufenthalt:{code:"ABH-404",title:"Antrag auf Fortsetzung der Anwesenheit",subtitle:"Für die Vorsprache benötigen Sie einen Nachweis über die erfolgreiche Vorsprache.",fields:[["text","AKTENZEICHEN"],["text","ZWEITES AKTENZEICHEN"],["select","GRUND DES AUFENTHALTS",["Formulare","weitere Formulare","vorübergehend dauerhaft"]],["text","NACHWEIS DES NACHWEISES"],["check","Ich bin für Rückfragen zu Rückfragen erreichbar."]]},
citizenship:{code:"DE-1A",title:"Fiktiver Antrag auf deutsche Staatsangehörigkeit",subtitle:"Reines Spielverfahren. Keine echte Rechtslage oder Voraussetzung.",fields:[["text","NAME"],["select","KENNTNIS DER HAUSORDNUNG",["ausreichend","übertrieben","laminiert"]],["select","VERHÄLTNIS ZUR MÜLLTRENNUNG",["ambitioniert","akademisch","existenziell"]],["text","WARUM IST DIESES FORMULAR NICHT GEHEFTET?"],["check","Ich erkenne an, dass alle dargestellten Fristen und Regeln frei erfunden sind."]]}}
const tilt={available:false,enabled:false,centred:false,reading:null,readingAt:0,center:null,x:0,y:0,status:"KEYBOARD"};let orientationAbort=null;
function resize(){dpr=Math.min(devicePixelRatio||1,2);width=innerWidth;height=innerHeight;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0)}addEventListener("resize",resize);resize();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),dist=(ax,ay,bx,by)=>Math.hypot(ax-bx,ay-by),inRect=(x,y,r)=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;
const onRoad=(x,y)=>roads.some(r=>inRect(x,y,r)),onCrossing=(x,y)=>crossings.some(r=>inRect(x,y,r)),onGardenGrass=(x,y)=>(x>schreber.x+20&&x<schreber.x+schreber.w-20&&y>schreber.y+20&&y<schreber.y+schreber.h-20)||onPoliceGardenGrass(x,y);
function blocked(x,y){if(x<25||y<25||x>WORLD.w-25||y>WORLD.h-25)return true;for(const b of buildings)if(x>b.x-player.r&&x<b.x+b.w+player.r&&y>b.y-player.r&&y<b.y+b.h+player.r)return true;return false}
const normalizeScreenAngle=a=>((a%360)+360)%360,screenAngle=()=>normalizeScreenAngle(screen.orientation?.angle||window.orientation||0),wrap=a=>((a+180)%360+360)%360-180;
function orientationAngles(reading,angle){if(!reading||reading.beta==null||reading.gamma==null||!Number.isFinite(reading.beta)||!Number.isFinite(reading.gamma))return null;const rad=Math.PI/180,b=reading.beta*rad,g=reading.gamma*rad,t=angle*rad,gx=-Math.sin(g)*Math.cos(b),gy=Math.sin(b),gz=Math.cos(g)*Math.cos(b),x=gx*Math.cos(t)+gy*Math.sin(t),y=-gx*Math.sin(t)+gy*Math.cos(t);return{bank:Math.asin(clamp(-x,-1,1))*180/Math.PI,pitch:Math.atan2(y,gz)*180/Math.PI}}
function tiltAxis(a,dead=3,full=27){return Math.sign(a)*Math.min(1,Math.max(0,(Math.abs(a)-dead)/(full-dead)))}
function setSensor(s){tilt.status=s;document.getElementById("sensor-state").textContent=s}
function calibrateTilt(){const a=orientationAngles(tilt.reading,screenAngle());if(!a){tilt.centred=false;setSensor("MOVE PHONE TO CALIBRATE");return false}tilt.center=a;tilt.centred=true;tilt.x=0;tilt.y=0;setSensor("TILT LIVE");toast("TILT CALIBRATED · FORWARD/BACK + LEFT/RIGHT");return true}
function updateTilt(){if(!tilt.enabled||!tilt.centred||!tilt.reading||performance.now()-tilt.readingAt>700){tilt.x*=.8;tilt.y*=.8;return}const a=orientationAngles(tilt.reading,screenAngle());if(!a)return;const tx=tiltAxis(wrap(a.bank-tilt.center.bank)),ty=tiltAxis(wrap(tilt.center.pitch-a.pitch));tilt.x+=(tx-tilt.x)*.22;tilt.y+=(ty-tilt.y)*.22}
async function enableTilt(){const D=window.DeviceOrientationEvent;if(!D){setSensor("NO MOTION SENSOR");return false}try{if(typeof D.requestPermission==="function"){const p=await D.requestPermission();if(p!=="granted")throw new Error("Motion permission not granted")}orientationAbort?.abort();orientationAbort=new AbortController();tilt.enabled=true;tilt.available=true;tilt.centred=false;setSensor("HOLD PHONE STEADY");addEventListener("deviceorientation",e=>{tilt.reading={beta:e.beta,gamma:e.gamma};tilt.readingAt=performance.now();if(!tilt.centred)calibrateTilt()},{signal:orientationAbort.signal});try{await navigator.wakeLock?.request("screen")}catch{}return true}catch(err){tilt.enabled=false;setSensor("KEYBOARD / TOUCH");document.getElementById("intro-status").textContent=(err&&err.message?err.message:"Tilt unavailable")+". Keyboard/touch remains available.";return false}}
function toast(msg){const e=document.getElementById("toast");e.textContent=msg;e.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("show"),2300)}
function ensureAudio(){if(!audio)audio=new (window.AudioContext||window.webkitAudioContext)();audio.resume();return audio}
function uiTone(freq=440,dur=.08,type="square",gain=.04){const a=ensureAudio(),o=a.createOscillator(),g=a.createGain(),t=a.currentTime;o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g).connect(a.destination);o.start(t);o.stop(t+dur+.02)}
function playSiren(){const a=ensureAudio(),t=a.currentTime;for(let i=0;i<6;i++){const o=a.createOscillator(),g=a.createGain(),st=t+i*.18;o.type="sawtooth";o.frequency.setValueAtTime(i%2?920:620,st);o.frequency.linearRampToValueAtTime(i%2?620:920,st+.17);g.gain.setValueAtTime(.0001,st);g.gain.linearRampToValueAtTime(.065,st+.015);g.gain.exponentialRampToValueAtTime(.0001,st+.18);o.connect(g).connect(a.destination);o.start(st);o.stop(st+.19)}}
function speak(text,urgent=false){if(!state.voiceOn||!("speechSynthesis" in window))return;const msg=localize(text);speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(msg);const voices=speechSynthesis.getVoices();u.voice=voices.find(v=>/^de(-|_)/i.test(v.lang))||voices.find(v=>/german/i.test(v.name))||null;u.lang="de-DE";u.rate=urgent?.98:.9;u.pitch=urgent?.72:.88;u.volume=1;speechSynthesis.speak(u)}
function violationAlert(msg,level){const alert=document.getElementById("violation-alert"),app=document.getElementById("app");document.getElementById("violation-law").textContent=lawFor(msg);document.getElementById("violation-title").textContent=state.lang==="en"?"RULE VIOLATION":"ORDNUNGSWIDRIGKEIT";document.getElementById("violation-text").textContent=state.lang==="en"?localize(msg):msg;document.getElementById("violation-stars").textContent="★".repeat(level)+"☆".repeat(Math.max(0,5-level));alert.hidden=false;app.classList.remove("enforcement");void app.offsetWidth;app.classList.add("enforcement");clearTimeout(violationAlert.t);violationAlert.t=setTimeout(()=>{alert.hidden=true;app.classList.remove("enforcement")},2200);playSiren()}
function policeBark(force=false){const now=performance.now();if(!force&&now-(policeBark.last||0)<2300)return;policeBark.last=now;const lines=policeBarks[state.region]||policeBarks.germany,msg=lines[Math.floor(Math.random()*lines.length)],box=document.getElementById("police-bark");document.getElementById("police-bark-text").textContent=msg;box.hidden=false;clearTimeout(policeBark.t);policeBark.t=setTimeout(()=>box.hidden=true,1500);speak(msg,true);uiTone(1280,.06,"square",.035)}
function softWarn(msg){toast((state.lang==="en"?"WARNING · ":"VERWARNUNG · ")+msg);uiTone(520,.055,"square",.025)}
function wanted(level,msg,instant){const old=state.wanted;state.wanted=Math.max(state.wanted,level);state.offence=msg;state.wantedCooldown=12;if(instant||(state.wanted>old&&state.wanted>=2))spawnPolice(instant?4:Math.max(1,state.wanted-old));violationAlert(msg,state.wanted);toast(msg+" · "+state.wanted+" STERN"+(state.wanted===1?"":"E"));updateHud()}
function spawnPolice(n){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,d=180+Math.random()*120;police.push({x:clamp(player.x+Math.cos(a)*d,40,WORLD.w-40),y:clamp(player.y+Math.sin(a)*d,40,WORLD.h-40),speed:120+state.wanted*18,barkAt:0})}policeBark(true)}
function updateHud(){const stars=document.getElementById("stars"),wantedBox=document.querySelector(".wanted");stars.innerHTML="";wantedBox.classList.toggle("hot",state.wanted>0);for(let i=0;i<5;i++){const s=document.createElement("span");s.className="star"+(i<state.wanted?" active":"");s.textContent="★";stars.appendChild(s)}document.getElementById("offence").textContent=state.lang==="en"?(state.wanted?"ACTIVE VIOLATION FILE":"FILE STATUS: UNREMARKABLE"):state.offence;const m=missions[Math.min(state.mission,missions.length-1)];document.getElementById("mission-title").textContent=localize(m.title);document.getElementById("mission-text").textContent=localize(m.text);const frac=state.mission/missions.length+(state.mission===5?state.stadtbild/3/missions.length:0);document.getElementById("mission-progress").style.width=Math.min(100,frac*100)+"%";document.getElementById("energy").textContent=Math.round(player.energy);document.getElementById("forms").textContent=state.forms;document.getElementById("pfand").textContent=state.pfand;document.getElementById("day").textContent=state.day+"/3";const r=rules[state.rule%rules.length];document.getElementById("rule-id").textContent=r[0];document.getElementById("rule-text").textContent=localize(r[1]);document.getElementById("region-name").textContent=state.region==="berlin"?"BERLIN":"DEUTSCHLAND";document.getElementById("region-language").textContent=state.region==="berlin"?"Denglisch-Zone":"Nur Deutsch"}
function openDialogue(speaker,lines,portrait,done){state.modal=true;state.dialogue=true;state.dialogueData={speaker,lines,portrait:portrait||"§",done,i:0};renderDialogue()}
function renderDialogue(){const d=state.dialogueData,line=localize(d.lines[d.i]);document.getElementById("dialogue").hidden=false;document.getElementById("speaker").textContent=d.speaker;document.getElementById("portrait").textContent=d.portrait;document.getElementById("dialogue-text").textContent=line;document.getElementById("dialogue-next").textContent=d.i===d.lines.length-1?(state.lang==="en"?"UNDERSTOOD":"VERSTANDEN"):(state.lang==="en"?"CONTINUE":"WEITER");document.getElementById("voice-state").textContent=state.voiceOn?(state.lang==="en"?"GERMAN-ACCENT VOICE":"SPRECHENDE BEHÖRDE"):(state.lang==="en"?"VOICE OFF":"STIMME AUS");speak(d.lines[d.i])}
function nextDialogue(){if(!state.dialogue)return;const d=state.dialogueData;d.i++;if(d.i<d.lines.length){renderDialogue();return}document.getElementById("dialogue").hidden=true;state.dialogue=false;state.modal=false;if(d.done)d.done()}document.getElementById("dialogue-next").onclick=nextDialogue;
document.getElementById("dialogue-speak").onclick=()=>{if(state.dialogue)speak(state.dialogueData.lines[state.dialogueData.i])};
function showForm(type){const def=forms[type],en=formEnglish[type];state.modal=true;document.getElementById("form-modal").hidden=false;document.getElementById("form-code").textContent=def.code;document.getElementById("form-title").textContent=state.lang==="en"&&en?en[0]:def.title;document.getElementById("form-subtitle").textContent=state.lang==="en"&&en?en[1]+" Official field labels remain in German, naturally.":def.subtitle;document.getElementById("form-error").textContent="";const wrap=document.getElementById("form-fields");wrap.innerHTML="";for(const f of def.fields){if(f[0]==="check"){const lab=document.createElement("label");lab.className="check";const inp=document.createElement("input");inp.type="checkbox";inp.required=true;const span=document.createElement("span");span.textContent=f[1];lab.append(inp,span);wrap.append(lab);continue}const lab=document.createElement("label");lab.className="field";const title=document.createElement("span");title.textContent=f[1];lab.append(title);if(f[0]==="select"){const sel=document.createElement("select");sel.required=true;const empty=document.createElement("option");empty.value="";empty.textContent=state.lang==="en"?"PLEASE SELECT / BITTE AUSWÄHLEN":"BITTE AUSWÄHLEN";sel.append(empty);for(const o of f[2]){const op=document.createElement("option");op.value=o;op.textContent=o;sel.append(op)}lab.append(sel)}else{const inp=document.createElement("input");inp.required=true;inp.autocomplete="off";lab.append(inp)}wrap.append(lab)}document.getElementById("bureaucracy-form").dataset.type=type}
document.getElementById("bureaucracy-form").onsubmit=e=>{e.preventDefault();if(!e.currentTarget.reportValidity()){document.getElementById("form-error").textContent=state.lang==="en"?"PROCEDURE INCOMPLETE. NATURALLY.":"VORGANG UNVOLLSTÄNDIG. NATÜRLICH.";uiTone(130,.14,"square",.04);return}const type=e.currentTarget.dataset.type;document.getElementById("form-modal").hidden=true;state.modal=false;state.forms++;state.mission++;uiTone(95,.08,"square",.05);setTimeout(()=>uiTone(70,.1,"square",.045),70);toast(state.lang==="en"?"FORM "+forms[type].code+" SUCCESSFULLY MOVED TO ANOTHER PILE":"FORMULAR "+forms[type].code+" ERFOLGREICH IN EINEN ANDEREN STAPEL GELEGT");if(type==="citizenship"){state.citizen=true;endGame(true)}updateHud()};
function bureaucrat(b,m){const lines=state.region==="berlin"?["Guten Tag, hello. Bitte waiten Sie, bis Ihr Warten systemseitig confirmed wurde.","Für "+m.title+" brauchen Sie Formular "+forms[m.form].code+". Very important.","Bitte every field ausfüllen. Auch die Felder, die später erst relevant werden."]:[ "Guten Tag. Bitte warten Sie, bis Ihr Warten verwaltungsintern erfasst wurde.","Für "+m.title+" benötigen Sie Formular "+forms[m.form].code+".","Füllen Sie jedes Feld aus. Auch die Felder, deren Zweck sich erst nach der Abgabe ergibt."];openDialogue(b.name,lines,"§",()=>showForm(m.form))}
function microInteract(p){
 if(p.id==="db"){openDialogue("DEUTSCHE BAHN",state.region==="berlin"?["Your train nach Deutschland is currently thirty-five Minuten delayed.","Reason: ein previous Vorgang. Thank you for your understanding, maybe."]:["Der Regionalexpress verspätet sich heute um voraussichtlich 35 Minuten.","Grund: vorausgegangener Vorgang. Wir bitten um Verständnis."],"DB");return}
 if(p.id==="baustelle"){openDialogue("BAUSTELLENLEITUNG",state.region==="berlin"?["This Baustelle is temporary permanent.","Completion is planned for Q4, year currently under review."]:["Diese Baustelle ist vorübergehend dauerhaft eingerichtet.","Die Fertigstellung ist für das vierte Quartal eines noch zu prüfenden Jahres vorgesehen."],"🚧");return}
 if(p.id==="fahrrad"){uiTone(1450,.06,"square",.03);setTimeout(()=>uiTone(1620,.05,"square",.025),55);openDialogue("FAHRRAD",state.region==="berlin"?["Klingeling. You are standing maybe slightly in the Radweg.","Please optimize your body position immediately."]:["Klingeling. Sie stehen geringfügig im Radweg.","Bitte korrigieren Sie Ihre Körperposition unverzüglich."],"🚲");return}
 if(p.id==="kaffee"){if(!p.used){p.used=true;player.energy=clamp(player.energy+24,0,100);uiTone(720,.08,"triangle",.035);toast(state.lang==="en"?"BÜRGERAMT COFFEE +24 ENERGY":"BÜRGERAMT-KAFFEE +24 ENERGIE");updateHud()}else toast(state.lang==="en"?"MACHINE SAYS: CLEANING":"AUTOMAT: REINIGUNG LÄUFT");return}
 if(p.id==="pfandautomat"){if(state.pfand>0){const n=state.pfand;state.pfand=0;player.energy=clamp(player.energy+n*4,0,100);uiTone(880,.05,"square",.03);setTimeout(()=>uiTone(1100,.06,"square",.03),70);toast((state.lang==="en"?"DEPOSIT RECEIPT ":"PFANDBON ")+(n*.25).toFixed(2).replace(".",",")+" € · +"+n*4+" ENERGIE");updateHud()}else openDialogue("PFANDAUTOMAT",state.region==="berlin"?["No bottle detected. Insert asset first.","Bitte nicht gegen den Automaten kick-en."]:["Keine Flasche erkannt.","Bitte führen Sie zuerst ein pfandpflichtiges Gebinde zu."],"♻");return}
}

function interact(){if(state.dialogue){nextDialogue();return}if(state.modal)return;const m=missions[Math.min(state.mission,missions.length-1)];for(const b of buildings){if(dist(player.x,player.y,b.doorX,b.doorY)<112){if(b.id===m.target){if(state.mission===5){if(state.stadtbild>=3)openDialogue("AMT FÜR STADTBILD",["Ausgezeichnet. Die Mülltonne steht wieder parallel zur gefühlten Bordsteinkante.","Die Stadt ist nun statistisch 14 Prozent weniger individuell.","Stempel B: optische Unbedenklichkeit."],"✓",()=>{state.mission++;updateHud()});else openDialogue("AMT FÜR STADTBILD",["Gemäß der rein fiktiven Gestaltungsvorschrift ist das Stadtbild zu normieren.","Richten Sie die Mülltonne, die Stühle und die Hecke aus.","Der politische Aushang ist eine satirische Requisite und keine Tatsachenbehauptung."],"FM",()=>toast("3 STADTBILD-ABWEICHUNGEN MARKIERT"))}else bureaucrat(b,m)}else if(b.id==="imbiss")openDialogue("WURST-INSEL",["Bratwurst +35 Energie. Currywurst +50 Verwaltungsmut.","Senf ist kein gültiges Aktenzeichen."],"🌭");else openDialogue(b.name,state.region==="berlin"?["Sie sind hier basically richtig, aber für einen anderen process.","Try Zuständigkeit. Oder Tuesday. Tuesday ist beliebt."]:["Sie sind hier grundsätzlich richtig, aber für einen anderen Vorgang.","Versuchen Sie es mit Zuständigkeit. Oder Dienstag."],"§");return}}for(const n of npcs)if(dist(player.x,player.y,n.x,n.y)<92){openDialogue(n.name,[worldNpcLine(n.line),worldNpcLine((n.line+3)%npcLines.length)],"!");return}for(const p of props)if(p.id&&dist(player.x,player.y,p.x,p.y)<96){microInteract(p);return}for(const o of normObjects)if(!o.fixed&&dist(player.x,player.y,o.x,o.y)<92){if(state.mission===5){o.fixed=true;state.stadtbild++;toast("STADTBILD NORMIERT · "+o.label);updateHud()}else toast("DAS IST NOCH NICHT IHR VORGANG");return}toast("HIER IST NIEMAND ZUSTÄNDIG")}
function collect(){for(const p of pickups){if(p.taken||dist(player.x,player.y,p.x,p.y)>34)continue;p.taken=true;uiTone(p.type==="pfand"?660:880,.1,"square",.04);if(p.type==="pfand"){state.pfand++;toast(state.lang==="en"?"DEPOSIT +1 · ASSET LIQUID AGAIN":"PFAND +1 · VERMÖGEN WIEDER LIQUID")}else{player.energy=clamp(player.energy+p.value,0,100);toast(p.label+" +"+p.value+" ENERGIE");particles.push({x:p.x,y:p.y,t:1,text:"+ "+p.label})}updateHud()}}
function endGame(win){state.gameOver=true;state.modal=true;document.getElementById("end-modal").hidden=false;document.getElementById("end-kicker").textContent=win?"VERWALTUNGSVORGANG ABGESCHLOSSEN":"FIKTIVE SPIELFRIST ABGELAUFEN";document.getElementById("end-title").textContent=win?"EINBÜRGERUNG: VORLÄUFIG ERFOLGREICH":"AUSWEISUNG AUS DEM SPIEL";document.getElementById("end-copy").textContent=win?"Sie haben genügend Formulare ausgefüllt, Regeln überlebt und verdächtig viel Geduld nachgewiesen. Dieses Spiel bildet keine echte Einbürgerung ab.":"Die absichtlich absurde Drei-Tage-Frist ist abgelaufen. Reale Gesetze, Verfahren und Rechte sind anders. Hier müssen Sie leider noch einmal von vorne anfangen."}document.getElementById("restart").onclick=()=>location.reload();
function update(dt){
 if(!state.started||state.modal)return;
 updateTilt();state.minutes+=dt*2;
 if(state.minutes>=1440){state.minutes-=1440;state.day++;if(state.day>3&&!state.citizen){endGame(false);return}}

 let sx=(keys.ArrowRight||keys.KeyD?1:0)-(keys.ArrowLeft||keys.KeyA?1:0),fy=(keys.ArrowUp||keys.KeyW?1:0)-(keys.ArrowDown||keys.KeyS?1:0);
 if(tilt.enabled&&tilt.centred&&performance.now()-tilt.readingAt<700){sx=clamp(sx+tilt.x,-1,1);fy=clamp(fy+tilt.y,-1,1)}
 const mag=Math.hypot(sx,fy);if(mag>1){sx/=mag;fy/=mag}
 const sprint=!!(keys.ShiftLeft||keys.ShiftRight)||Math.abs(fy)>.94;
 const speed=146*(sprint?1.58:1)*(player.energy<25?.84:1),nx=player.x+sx*speed*dt,ny=player.y-fy*speed*dt;
 if(!blocked(nx,player.y))player.x=nx;if(!blocked(player.x,ny))player.y=ny;
 updateRegion();

 if(mag>.05){
   player.energy=clamp(player.energy-dt*(sprint?1.25:.12),0,100);
   if(sprint)state.runTimer+=dt;
   else{state.runTimer=Math.max(0,state.runTimer-dt*2.5);if(state.runTimer<.25)state.runWarned=false}
 }else{
   player.energy=clamp(player.energy+dt*.72,0,100);
   state.runTimer=Math.max(0,state.runTimer-dt*3);if(state.runTimer<.25)state.runWarned=false
 }
 if(state.runTimer>2.8&&!state.runWarned){softWarn(state.lang==="en"?"SPEED IS BECOMING ADMINISTRATIVELY NOTICEABLE":"IHRE GESCHWINDIGKEIT WIRD VERWALTUNGSSEITIG AUFFÄLLIG");state.runWarned=true}
 if(state.runTimer>5.5&&state.wanted<1){wanted(1,"VERDÄCHTIG ZÜGIGES FORTBEWEGEN OHNE SPORTBESCHEINIGUNG",false);state.runTimer=0;state.runWarned=false}

 state.jayCooldown=Math.max(0,state.jayCooldown-dt);
 const roadViolation=onRoad(player.x,player.y)&&!onCrossing(player.x,player.y);
 if(roadViolation){
   state.roadTimer+=dt;
   if(state.roadTimer>.9&&!state.roadWarned){softWarn(state.lang==="en"?"PLEASE USE THE GEOMETRICALLY APPROVED CROSSING":"BITTE BENUTZEN SIE DIE GEOMETRISCH VORGESEHENE QUERUNGSSTELLE");state.roadWarned=true}
   if(state.roadTimer>2.2&&state.jayCooldown===0){state.jayCooldown=8;wanted(Math.max(1,state.wanted),"FAHRBAHNÜBERQUERUNG AUSSERHALB MARKIERTER GEOMETRIE",false);state.roadTimer=0;state.roadWarned=false}
 }else{
   state.roadTimer=Math.max(0,state.roadTimer-dt*3);if(state.roadTimer<.2)state.roadWarned=false
 }

 state.gardenCooldown=Math.max(0,state.gardenCooldown-dt);
 const grass=onGardenGrass(player.x,player.y),stationGrass=onPoliceGardenGrass(player.x,player.y);
 if(grass){
   state.grassTimer+=dt;
   if(state.grassTimer>.45&&!state.grassWarned){softWarn(state.lang==="en"?"YOU ARE TOUCHING ADMINISTRATIVELY SENSITIVE GRASS":"SIE BERÜHREN VERWALTUNGSRELEVANTEN RASEN");state.grassWarned=true}
   const triggerAt=stationGrass?1.35:1.9;
   if(state.grassTimer>triggerAt&&state.gardenCooldown===0){state.gardenCooldown=8;wanted(Math.max(2,state.wanted),"RASENBETRETUNG IM SCHREBERGARTEN · SOFORTMASSNAHME",false);state.grassTimer=0;state.grassWarned=false}
 }else{
   state.grassTimer=Math.max(0,state.grassTimer-dt*4);if(state.grassTimer<.15)state.grassWarned=false
 }

 state.wantedCooldown=Math.max(0,state.wantedCooldown-dt);
 if(state.wanted>0&&state.wantedCooldown===0){state.wanted--;state.wantedCooldown=10;if(state.wanted===0)state.offence="AKTENLAGE: VORLÄUFIG UNAUFFÄLLIG"}

 for(let i=police.length-1;i>=0;i--){
   const p=police[i],dx=player.x-p.x,dy=player.y-p.y,d=Math.hypot(dx,dy)||1;
   p.x+=dx/d*p.speed*dt;p.y+=dy/d*p.speed*dt;
   if(d<260&&performance.now()>(p.barkAt||0)){p.barkAt=performance.now()+2200+Math.random()*1800;policeBark()}
   if(d<30){police.splice(i,1);player.energy=Math.max(36,player.energy-12);player.x=1080;player.y=1930;state.wanted=Math.max(0,state.wanted-1);state.offence="PERSONALIEN FESTGESTELLT · HINWEIS ERTEILT";uiTone(180,.18,"sawtooth",.05);toast(state.lang==="en"?"POLICE ACTION · ESCORTED TO THE STATION GARDEN":"POLIZEILICHE MASSNAHME · IN DEN WACHEN-SCHREBERGARTEN BEGLEITET")}
   else if(state.wanted<2&&d>520)police.splice(i,1)
 }

 for(const n of npcs){if(n.vx){n.x+=n.vx*dt;if(n.x<n.min||n.x>n.max)n.vx*=-1}else{n.y+=n.vy*dt;if(n.y<n.min||n.y>n.max)n.vy*=-1}}
 state.ruleTimer+=dt;if(state.ruleTimer>8){state.ruleTimer=0;state.rule=(state.rule+1)%rules.length}
 for(const p of particles){p.t-=dt;p.y-=12*dt}particles=particles.filter(p=>p.t>0);
 collect();updateHud()
}
function project(x,y,z=0){const sway=tilt.enabled?tilt.x*.08:0,dx=x-player.x,dy=player.y-y,cs=Math.cos(sway),sn=Math.sin(sway),side=dx*cs-dy*sn,forward=dx*sn+dy*cs;if(forward<-155)return null;const scale=520/(520+Math.max(-150,forward)),horizon=height*.34;return{x:width*.5+side*scale,y:horizon+(height*.24)*scale-z*scale,s:scale,d:forward}}
function poly(points,fill,stroke){const pp=points.map(p=>project(p[0],p[1],p[2]||0));if(pp.some(p=>!p))return;ctx.beginPath();ctx.moveTo(pp[0].x,pp[0].y);for(let i=1;i<pp.length;i++)ctx.lineTo(pp[i].x,pp[i].y);ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}}
function groundRect(r,fill,stroke){poly([[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]],fill,stroke)}
function drawPoliceDiagonalPath(){const dx=policePath.x2-policePath.x1,dy=policePath.y2-policePath.y1,len=Math.hypot(dx,dy)||1,nx=-dy/len*policePath.width*.5,ny=dx/len*policePath.width*.5;poly([[policePath.x1+nx,policePath.y1+ny],[policePath.x2+nx,policePath.y2+ny],[policePath.x2-nx,policePath.y2-ny],[policePath.x1-nx,policePath.y1-ny]],"#a9a59b","#858177")}
function drawGround(){const horizon=height*.34,sky=ctx.createLinearGradient(0,0,0,horizon);sky.addColorStop(0,"#74736f");sky.addColorStop(1,"#aaa79f");ctx.fillStyle=sky;ctx.fillRect(0,0,width,horizon);const grd=ctx.createLinearGradient(0,horizon,0,height);grd.addColorStop(0,"#96938b");grd.addColorStop(1,"#77756f");ctx.fillStyle=grd;ctx.fillRect(0,horizon,width,height-horizon);for(let d=120;d<1700;d+=120){const a=project(player.x-900,player.y-d),b=project(player.x+900,player.y-d);if(a&&b){ctx.strokeStyle="rgba(45,45,42,.12)";ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}for(let x=-900;x<=900;x+=150){const a=project(player.x+x,player.y+120),b=project(player.x+x,player.y-1650);if(a&&b){ctx.strokeStyle="rgba(45,45,42,.09)";ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}roads.forEach(r=>groundRect({x:r.x-26,y:r.y-26,w:r.w+52,h:r.h+52},"#aaa69d"));roads.forEach(r=>groundRect(r,"#5c5b57","#4b4a47"));crossings.forEach(r=>groundRect(r,"#d2cdc0"));groundRect({x:0,y:BORDER_Y-8,w:WORLD.w,h:16},"#ded9cd","#252525");groundRect(schreber,"#68705e","#4d5149");groundRect(policeGarden,"#68705e","#4d5149");drawPoliceDiagonalPath()}
function drawBuilding(b){const corners=[[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]],base=corners.map(p=>project(p[0],p[1],0)),top=corners.map(p=>project(p[0],p[1],b.hgt));if(base.some(p=>!p)||top.some(p=>!p))return;ctx.fillStyle="#5b5955";ctx.beginPath();ctx.moveTo(base[2].x,base[2].y);ctx.lineTo(base[3].x,base[3].y);ctx.lineTo(top[3].x,top[3].y);ctx.lineTo(top[2].x,top[2].y);ctx.closePath();ctx.fill();ctx.fillStyle="#74716b";ctx.beginPath();ctx.moveTo(base[1].x,base[1].y);ctx.lineTo(base[2].x,base[2].y);ctx.lineTo(top[2].x,top[2].y);ctx.lineTo(top[1].x,top[1].y);ctx.closePath();ctx.fill();ctx.fillStyle="#929088";ctx.beginPath();ctx.moveTo(top[0].x,top[0].y);for(let i=1;i<4;i++)ctx.lineTo(top[i].x,top[i].y);ctx.closePath();ctx.fill();ctx.strokeStyle="#4a4945";ctx.stroke();const sign=project(b.x+b.w*.5,b.y+b.h+5,b.hgt*.55);if(sign&&sign.s>.22){ctx.fillStyle="#eee9dd";ctx.font="900 "+Math.max(8,15*sign.s)+"px Arial";ctx.textAlign="center";ctx.fillText(b.name,sign.x,sign.y);ctx.font="700 "+Math.max(6,8*sign.s)+"px Arial";ctx.fillText(b.sign,sign.x,sign.y+12*sign.s);ctx.textAlign="left"}}
function drawGarden(){for(let i=0;i<4;i++){const x=schreber.x+45+i*125,y=schreber.y+110,p=project(x,y,0);if(!p||p.s<.2)continue;ctx.save();ctx.translate(p.x,p.y);ctx.scale(p.s,p.s);ctx.fillStyle="#8e887c";ctx.fillRect(-26,-42,52,42);ctx.fillStyle="#4d4c48";ctx.beginPath();ctx.moveTo(-32,-42);ctx.lineTo(0,-65);ctx.lineTo(32,-42);ctx.fill();ctx.restore()}const sign=project(schreber.x+schreber.w*.5,schreber.y+schreber.h-30,0);if(sign){ctx.fillStyle="#e5dfd2";ctx.fillRect(sign.x-92*sign.s,sign.y-28*sign.s,184*sign.s,25*sign.s);ctx.fillStyle="#171717";ctx.font="900 "+Math.max(7,10*sign.s)+"px Arial";ctx.textAlign="center";ctx.fillText("SCHREBERGÄRTEN · RASEN VERBOTEN",sign.x,sign.y-11*sign.s);ctx.textAlign="left"}const maze=project(930,1885,0);if(maze){ctx.fillStyle="#e5dfd2";ctx.fillRect(maze.x-86*maze.s,maze.y-30*maze.s,172*maze.s,27*maze.s);ctx.fillStyle="#171717";ctx.font="900 "+Math.max(7,10*maze.s)+"px Arial";ctx.textAlign="center";ctx.fillText("WACHEN-SCHREBERGARTEN · NICHT AUF DEN RASEN",maze.x,maze.y-12*maze.s);ctx.textAlign="left"}}
function drawBorderSign(){
 const p=project(1200,BORDER_Y,72);if(!p||p.s<.16)return;const s=p.s;
 ctx.save();ctx.translate(p.x,p.y);ctx.scale(s,s);
 ctx.fillStyle="#dcd7ca";ctx.strokeStyle="#222";ctx.lineWidth=3;ctx.fillRect(-126,-76,252,68);ctx.strokeRect(-126,-76,252,68);
 ctx.fillStyle="#222";ctx.textAlign="center";ctx.font="900 19px Arial";ctx.fillText("BERLIN  ⇄  DEUTSCHLAND",0,-46);
 ctx.font="700 10px Arial";ctx.fillText("Denglisch                    Nur Deutsch",0,-25);
 ctx.strokeStyle="#333";ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-105,-7);ctx.lineTo(-105,64);ctx.moveTo(105,-7);ctx.lineTo(105,64);ctx.stroke();ctx.restore()
}

function drawAsset(name,x,y,w,h,angle=0){const p=project(x,y,0),img=assets[name];if(!p||!img||!img.complete||p.s<.14)return false;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);ctx.drawImage(img,-w*p.s/2,-h*p.s,w*p.s,h*p.s);ctx.restore();return true}
function sprite(x,y,label,type,accent){const p=project(x,y,0);if(!p||p.s<.16)return;const s=clamp(p.s,.2,1.45),phase=performance.now()/145+(x+y)*.01,swing=Math.sin(phase)*8;
 if(["currywurst","bratwurst","brezel","pfand"].includes(type)&&drawAsset(type,x,y,type==="pfand"?30:54,type==="pfand"?48:40))return;
 ctx.save();ctx.translate(p.x,p.y);ctx.scale(s,s);
 if(type==="person"||type==="police"){const body=type==="police"?"#303943":(accent||"#45443f");ctx.strokeStyle=body;ctx.lineWidth=5;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(-4,-8);ctx.lineTo(-8+swing*.22,13);ctx.moveTo(4,-8);ctx.lineTo(8-swing*.22,13);ctx.moveTo(-7,-23);ctx.lineTo(-13-swing*.35,-5);ctx.moveTo(7,-23);ctx.lineTo(13+swing*.35,-5);ctx.stroke();ctx.fillStyle=body;ctx.fillRect(-9,-30,18,25);ctx.fillStyle="#d0c8b8";ctx.beginPath();ctx.arc(0,-39,8,0,Math.PI*2);ctx.fill();if(type==="police"){ctx.fillStyle="#222b34";ctx.fillRect(-10,-48,20,5);ctx.fillStyle="#eee";ctx.font="900 7px Arial";ctx.fillText("POL",-7,-13)}}
 if(type==="bin"){ctx.fillStyle="#555b54";ctx.fillRect(-15,-34,30,34)}if(type==="chairs"){ctx.strokeStyle="#4f4e49";ctx.lineWidth=3;ctx.strokeRect(-26,-22,20,22);ctx.strokeRect(7,-22,20,22)}if(type==="hedge"){ctx.fillStyle="#4e594a";ctx.fillRect(-36,-28,72,28)}
 if(label&&s>.28){ctx.fillStyle="#171717";ctx.font="800 8px Arial";ctx.textAlign="center";ctx.fillText(label,0,18);ctx.textAlign="left"}ctx.restore()}
function drawPoster(){const p=project(1570,530,90);if(!p||p.s<.2)return;const s=p.s;ctx.save();ctx.translate(p.x,p.y);ctx.scale(s,s);ctx.fillStyle="#ded8cb";ctx.fillRect(-58,-72,116,84);ctx.strokeStyle="#222";ctx.strokeRect(-58,-72,116,84);ctx.fillStyle="#777";ctx.beginPath();ctx.ellipse(0,-43,20,25,0,0,Math.PI*2);ctx.fill();ctx.fillStyle="#494949";ctx.beginPath();ctx.moveTo(-22,-50);ctx.quadraticCurveTo(0,-72,24,-50);ctx.lineTo(17,-59);ctx.lineTo(-16,-59);ctx.closePath();ctx.fill();ctx.fillStyle="#222";ctx.font="900 8px Arial";ctx.textAlign="center";ctx.fillText("FRIEDRICH MERZ",0,-8);ctx.font="7px Arial";ctx.fillText("SATIRISCHER AUSHANG",0,3);ctx.restore()}
function drawWorld(){drawGround();drawGarden();drawBorderSign();const drawables=[];for(const b of buildings)drawables.push({d:player.y-(b.y+b.h*.5),fn:()=>drawBuilding(b)});for(const n of npcs)drawables.push({d:player.y-n.y,fn:()=>sprite(n.x,n.y,n.name,"person","#4f4d48")});for(const p of police)drawables.push({d:player.y-p.y,fn:()=>sprite(p.x,p.y,"POLIZEI","police")});for(const p of pickups)if(!p.taken)drawables.push({d:player.y-p.y,fn:()=>sprite(p.x,p.y,p.label,p.type==="pfand"?"pfand":p.type)});for(const o of normObjects)drawables.push({d:player.y-o.y,fn:()=>sprite(o.x,o.y,o.fixed?"NORMIERT":"! "+o.label,o.type,o.fixed?"#3f5b43":"#6c3d37")});for(const prop of props)drawables.push({d:player.y-prop.y,fn:()=>drawAsset(prop.asset,prop.x,prop.y,prop.w,prop.h)});drawables.sort((a,b)=>b.d-a.d);for(const d of drawables)d.fn();drawPoster();for(const p of particles){const q=project(p.x,p.y,40);if(q){ctx.fillStyle="#111";ctx.font="800 10px Arial";ctx.textAlign="center";ctx.fillText(p.text,q.x,q.y);ctx.textAlign="left"}}drawPlayer()}
function drawPlayer(){const x=width*.5,y=height*.58,swing=Math.sin(performance.now()/130)*9;ctx.save();ctx.translate(x,y);ctx.rotate((tilt.enabled?tilt.x:0)*.18);ctx.strokeStyle="#252525";ctx.lineWidth=7;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(-5,-10);ctx.lineTo(-10+swing*.3,18);ctx.moveTo(5,-10);ctx.lineTo(10-swing*.3,18);ctx.moveTo(-9,-30);ctx.lineTo(-17-swing*.35,-7);ctx.moveTo(9,-30);ctx.lineTo(17+swing*.35,-7);ctx.stroke();ctx.fillStyle="#252525";ctx.fillRect(-12,-38,24,31);ctx.fillStyle="#d3cbbb";ctx.beginPath();ctx.arc(0,-49,11,0,Math.PI*2);ctx.fill();ctx.fillStyle="#eee9dd";ctx.font="900 9px Arial";ctx.textAlign="center";ctx.fillText(state.lang==="en"?"YOU":"SIE",0,27);ctx.restore()}
function drawMinimap(){const mw=160,mh=118,x=width-mw-16,y=height-mh-44,sx=mw/WORLD.w,sy=mh/WORLD.h;ctx.save();ctx.globalAlpha=.9;ctx.fillStyle="#d7d2c5";ctx.fillRect(x,y,mw,mh);ctx.strokeStyle="#222";ctx.strokeRect(x,y,mw,mh);ctx.fillStyle="#5d5b57";roads.forEach(r=>ctx.fillRect(x+r.x*sx,y+r.y*sy,r.w*sx,r.h*sy));ctx.fillStyle="#6c7166";ctx.fillRect(x+schreber.x*sx,y+schreber.y*sy,schreber.w*sx,schreber.h*sy);ctx.strokeStyle="#222";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,y+BORDER_Y*sy);ctx.lineTo(x+mw,y+BORDER_Y*sy);ctx.stroke();const m=missions[Math.min(state.mission,missions.length-1)],b=buildings.find(q=>q.id===m.target);if(b){ctx.fillStyle="#762f29";ctx.fillRect(x+b.doorX*sx-3,y+b.doorY*sy-3,6,6)}ctx.fillStyle="#111";ctx.beginPath();ctx.arc(x+player.x*sx,y+player.y*sy,3,0,Math.PI*2);ctx.fill();ctx.restore()}
function nearestInteract(){let label="",best=122;for(const b of buildings){const d=dist(player.x,player.y,b.doorX,b.doorY);if(d<best){best=d;label=b.name}}for(const n of npcs){const d=dist(player.x,player.y,n.x,n.y);if(d<best){best=d;label=state.region==="berlin"?"COMPLAINT LISTENING":"BESCHWERDE ANHÖREN"}}for(const p of props){if(!p.id)continue;const d=dist(player.x,player.y,p.x,p.y);if(d<best){best=d;label=p.label}}for(const o of normObjects){if(o.fixed)continue;const d=dist(player.x,player.y,o.x,o.y);if(d<best){best=d;label="AUSRICHTEN"}}const e=document.getElementById("interact-hint");e.hidden=!label;e.textContent=label?"E · "+label:""}
function draw(){ctx.clearRect(0,0,width,height);drawWorld();drawMinimap();nearestInteract()}
const NOTE={C4:261.63,D4:293.66,E4:329.63,F4:349.23,G4:392,A4:440,B4:493.88,C5:523.25,D5:587.33,E5:659.25,F5:698.46,G5:783.99};
const melody=[["G4",.5],["G4",.5],["A4",.5],["B4",1],["C5",.5],["B4",.5],["A4",1],["G4",1],["D5",.5],["D5",.5],["C5",.5],["B4",1],["A4",.5],["B4",.5],["C5",1],["B4",1],["A4",.5],["G4",.5],["A4",.5],["B4",1],["C5",.5],["D5",.5],["E5",1],["D5",.5],["C5",.5],["B4",1],["A4",1],["G4",1]];
let audio=null,musicTimer=null,musicOn=true;
function chip(a,freq,when,dur,type="square",gain=.045){const o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(.0001,when);g.gain.linearRampToValueAtTime(gain,when+.01);g.gain.setValueAtTime(gain,when+dur*.75);g.gain.exponentialRampToValueAtTime(.0001,when+dur);o.connect(g).connect(a.destination);o.start(when);o.stop(when+dur+.02)}
function scheduleTheme(){if(!audio||!musicOn)return;const beat=.19,start=audio.currentTime+.05;let t=start;for(let i=0;i<melody.length;i++){const n=melody[i][0],l=melody[i][1],dur=l*beat*2;chip(audio,NOTE[n],t,dur*.9,"square",.04);const bass=i%4<2?"C4":"G4";chip(audio,NOTE[bass]/2,t,dur*.95,"triangle",.025);if(i%2===0)chip(audio,NOTE.C5*2,t,.035,"square",.009);t+=dur}clearTimeout(musicTimer);musicTimer=setTimeout(scheduleTheme,Math.max(100,(t-audio.currentTime-.08)*1000))}
function startMusic(){if(!musicOn)return;if(!audio)audio=new (window.AudioContext||window.webkitAudioContext)();audio.resume();scheduleTheme()}
document.getElementById("mute").onclick=()=>{musicOn=!musicOn;document.getElementById("mute").textContent=musicOn?"MUSIC ON":"MUSIC OFF";if(musicOn)startMusic();else clearTimeout(musicTimer)};
async function startGame(withTilt){startMusic();if(withTilt)await enableTilt();else setSensor("KEYBOARD / TOUCH");state.started=true;state.region=regionOf(player.y);document.getElementById("intro").classList.add("hidden");const lines=state.region==="berlin"?["Welcome in Berlin. Hier reden wir erstmal practical Denglisch.","Your mission ist simple: become German citizen in drei completely fictional Behördentagen.","Aber careful: auf Schrebergarten grass kommt sofort die Polizei. No discussion.","First go Richtung border. Hinter DEUTSCHLAND wird nicht mehr gedenglischt."]:[ "Willkommen in Deutschland.","Ihr Ziel: Werden Sie innerhalb von drei völlig fiktiven Behördentagen deutscher Staatsbürger.","Dazu benötigen Sie vor allem Formulare. Sehr viele Formulare.","Wenn Sie den Rasen im Schrebergarten betreten, kommt die Polizei sofort."];openDialogue(state.region==="berlin"?"WELCOME TO BERLIN":"WILLKOMMEN IN DEUTSCHLAND",lines,"DE",()=>toast(state.lang==="en"?"FIRST PROCEDURE · BÜRGERAMT":"ERSTER VORGANG · BÜRGERAMT"));updateHud()}
document.querySelectorAll(".lang").forEach(btn=>btn.onclick=()=>{state.lang=btn.dataset.lang;document.documentElement.lang=state.lang;document.querySelectorAll(".lang").forEach(b=>b.classList.toggle("active",b===btn));document.getElementById("start").textContent=state.lang==="en"?"START GAME · ENABLE TILT":"SPIEL STARTEN · TILT AKTIVIEREN";document.getElementById("keyboard-start").textContent=state.lang==="en"?"START WITHOUT TILT":"OHNE TILT STARTEN";updateHud()});
document.getElementById("start").onclick=()=>startGame(true);document.getElementById("keyboard-start").onclick=()=>startGame(false);document.getElementById("recenter").onclick=()=>{if(!tilt.enabled)enableTilt();else calibrateTilt()};document.getElementById("dock-recenter").onclick=()=>{if(!tilt.enabled)enableTilt();else calibrateTilt()};
document.getElementById("voice-toggle").onclick=()=>{state.voiceOn=!state.voiceOn;document.getElementById("voice-toggle").textContent=state.voiceOn?"VOICE ON":"VOICE OFF";if(!state.voiceOn&&"speechSynthesis" in window)speechSynthesis.cancel()};
function keydown(e){if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code))e.preventDefault();keys[e.code]=true;if(e.repeat)return;if(e.code==="KeyE")interact()}function keyup(e){keys[e.code]=false}addEventListener("keydown",keydown);addEventListener("keyup",keyup);
document.querySelectorAll(".control-dock [data-key]").forEach(btn=>{const code=btn.dataset.key,down=e=>{e.preventDefault();keys[code]=true;if(code==="KeyE")interact()},up=e=>{e.preventDefault();keys[code]=false};btn.addEventListener("pointerdown",down);btn.addEventListener("pointerup",up);btn.addEventListener("pointercancel",up);btn.addEventListener("pointerleave",up)});
function loop(now){const dt=Math.min(.05,(now-last)/1000);last=now;update(dt);draw();requestAnimationFrame(loop)}updateHud();requestAnimationFrame(loop);
})();