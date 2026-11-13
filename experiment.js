import {lab} from './core.js?v=0.2.0';
import {StimulusRenderer,MODES,motionFactor,REVERSE_AT} from './stimulus.js?v=0.3.0';
const $=id=>document.getElementById(id);
const stage=$('experimentStage');
let run=null,renderer=null,phase='idle',phaseAt=0,lastDraw=0,lastSample=0,valid=false,reason='',deviationSince=null,trial=null,index=0,trialCount=0,starting=false;
const fields=['runMode','taskMode','holdSeconds','threshold','deviation','mode','direction','speed','density','motion','layout','shape','axisR','hub','clearing','dotSize','renderFov','compare','stimSeconds','restSeconds','repeats','useGate','pitchMin','pitchMax','readingText'];
function settings(){
 const c={};for(const id of fields){const el=$(id);c[id]=['number','range'].includes(el.type)?Number(el.value):el.value;}
 for(const id of fields){const el=$(id);if(['number','range'].includes(el.type)&&(!Number.isFinite(c[id])||!el.checkValidity()))throw Error(`${el.parentElement.firstChild.textContent}の入力を確認してください。`);}
 if(c.pitchMin>=c.pitchMax)throw Error('角度範囲の下限は上限より小さくしてください。');
 if(c.runMode==='random'&&c.speed===0&&c.compare==='speed')throw Error('速さを比較するときは、速さを0より大きくしてください。');
 if(c.taskMode==='reading'&&!c.readingText.trim())throw Error('読ませる文章を入力してください。');
 return c;
}
function log(type,data={}){lab.log(type,{...data,experimentPhase:phase,trialId:trial?.id??null});}
function seeded(seed){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
const LEVELS={motion:['const','accel','reverse','osc'],mode:['drum','wheel','stream'],layout:['random','grid'],shape:['cloud','tube'],density:['1','2','3'],clearing:[0,0.55,0.85],speed:[1/3,2/3,1]};
function plan(c,rng){const out=[];for(let r=0;r<c.repeats;r++){const block=[{label:'static',overrides:{speed:0},repeat:r+1}];for(const lv of LEVELS[c.compare]){const o=c.compare==='speed'?{speed:c.speed*lv}:{[c.compare]:lv};if(c.compare==='shape')o.mode='wheel';block.push({label:`${c.compare}=${c.compare==='speed'?(c.speed*lv).toFixed(0):lv}`,overrides:o,repeat:r+1});}for(let i=block.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[block[i],block[j]]=[block[j],block[i]];}out.push(...block);}return out;}
function stimCfg(c){return {mode:c.mode,R:c.axisR,hub:c.hub,layout:c.layout,shape:c.shape,density:Number(c.density),dotSize:c.dotSize,fov:c.renderFov,clearing:Number(c.clearing)};}
const rateOf=(t,tt)=>tt.dir*tt.speedFrac*MODES[tt.mode].max*motionFactor(tt.motion,t);
function phaseTo(next,now=performance.now()){phase=next;phaseAt=now;log('phase',{phase:next});}
let felt=false,feltDir=null,sens=null;
function feedback(){return {felt,feltDirection:feltDir,sensation:sens};}
function renderFeedback(){const b=$('feltBtn');b.setAttribute('aria-pressed',String(felt));b.textContent=felt?'消えた':'感じた';$('feltPanel').hidden=!felt;$('dirFwd').setAttribute('aria-pressed',String(feltDir==='forward'));$('dirBack').setAttribute('aria-pressed',String(feltDir==='backward'));$('sensationValue').textContent=sens===null?'–':String(sens);if(sens===null)$('sensation').value='0';}
function zero(){felt=false;feltDir=null;sens=null;renderFeedback();if(run)log('feedback_reset',feedback());}
const tNow=()=>trial?Number(trial.t.toFixed(3)):null;
$('feltBtn').addEventListener('click',()=>{felt=!felt;if(!felt){feltDir=null;sens=null;}renderFeedback();if(run)log(felt?'felt_on':'felt_off',{trialT:tNow(),...feedback()});});
for(const [id,dir] of [['dirFwd','forward'],['dirBack','backward']])$(id).addEventListener('click',()=>{feltDir=feltDir===dir?null:dir;renderFeedback();if(run)log('felt_direction',{trialT:tNow(),...feedback()});});
$('sensation').addEventListener('input',()=>{sens=Number($('sensation').value);renderFeedback();if(run)log('feedback',{channel:'sensation',trialT:tNow(),...feedback()});});
for(const el of document.querySelectorAll('#experimentSettings input[type="range"]')){
 const output=document.createElement('output');output.setAttribute('for',el.id);output.className='setting-value';el.before(output);
 const update=()=>{output.textContent=el.value;};el.addEventListener('input',update);update();
}
function updateMode(){const random=$('runMode').value==='random';$('stimSeconds').disabled=!random;$('repeats').disabled=!random;$('compare').disabled=!random;}
$('runMode').addEventListener('change',updateMode);updateMode();
function quality(row,c){
 if(!Number.isFinite(row.headDelta))return '顔・IMUを確認してください';
 if(performance.now()-row.t>500)return '計測の更新待ち';
 if(c.useGate==='1'&&(row.pitch<c.pitchMin||row.pitch>c.pitchMax))return '顔をカメラの正面に近づけてください';
 return '';
}
function deviates(row){const x=row.headDelta,c=run.config;return c.deviation==='both'?Math.abs(x)>c.threshold:c.deviation==='negative'?x<-c.threshold:x>c.threshold;}
window.addEventListener('posture-frame',({detail:row})=>{
 if(!run)return;
 reason=quality(row,run.config);valid=!reason;
 if(valid&&phase==='stim'&&run.config.runMode==='adaptive'&&!deviates(row))finishTrial('posture_recovered',performance.now());
 if(valid&&phase==='watch'){
  if(deviates(row)){deviationSince??=row.t;if(row.t-deviationSince>=run.config.holdSeconds*1000)startTrial({label:'adaptive',overrides:{},repeat:null},performance.now());}
  else deviationSince=null;
 }else if(!valid){deviationSince=null;}
 Object.assign(row,{experimentMode:run.config.runMode,experimentPhase:phase,trialId:trial?.id??null,stimulusMode:trial?.mode??null,stimulusMotion:trial?.motion??null,stimulusLabel:trial?.label??null,stimulusSpeed:phase==='stim'&&valid?trial.rate:0,stimulusSpeedFrac:phase==='stim'&&valid?trial.speedFrac:0,trialT:phase==='stim'?tNow():null,stimulusPaused:phase==='stim'&&!valid,postureEligible:valid,postureRejectReason:reason,deviationElapsedMs:deviationSince===null?0:Math.max(0,row.t-deviationSince),...feedback()});
});
function startTrial(spec,now){
 const c=run.config,eff={...c,...spec.overrides},speedFrac=(spec.overrides.speed!==undefined?spec.overrides.speed:c.speed)/100;
 trial={id:++trialCount,label:spec.label,repeat:spec.repeat,mode:eff.mode,motion:eff.motion,layout:eff.layout,shape:eff.mode==='wheel'?eff.shape:'n/a',density:Number(eff.density),clearing:Number(eff.clearing),R:eff.mode==='wheel'?eff.axisR:eff.mode==='drum'?0:'inf',hub:eff.hub,dir:Number(c.direction),speedFrac,t:0,rate:0,reversed:false,startRequestedAt:now,firstDrawAt:null,pauseAt:null,pausedMs:0};
 renderer.configure(stimCfg(eff));zero();phaseTo('stim',now);log('stimulus_start',{...trial,units:MODES[eff.mode].unit});deviationSince=null;
}
function finishTrial(cause,now){
 if(!trial)return;
 const pausedMs=trial.pausedMs+(trial.pauseAt===null?0:now-trial.pauseAt);
 log('stimulus_end',{cause,trialT:tNow(),durationMs:now-trial.startRequestedAt,pausedMs,eligibleDurationMs:now-trial.startRequestedAt-pausedMs,firstDrawAt:trial.firstDrawAt,...feedback()});
 if(run.config.runMode==='random')index++;
 phaseTo('rest',now);
}
let taskRng=null,question=null,correct=0,attempts=0;
function nextQuestion(){const a=1+Math.floor(taskRng()*19),b=1+Math.floor(taskRng()*19);question={a,b,answer:a+b};$('question').textContent=`${a} ＋ ${b} ＝ ？`;const opts=[a+b,a+b-1,a+b+2];for(let i=opts.length-1;i>0;i--){let j=Math.floor(taskRng()*(i+1));[opts[i],opts[j]]=[opts[j],opts[i]];}$('answers').replaceChildren(...opts.map(v=>{const btn=document.createElement('button');btn.textContent=v;btn.onclick=()=>{if(!run)return;attempts++;if(v===question.answer)correct++;log('task_answer',{...question,response:v,correct:v===question.answer});$('taskScore').textContent=`回答 ${attempts} 問`;nextQuestion();};return btn;}));log('task_question',question);}
async function begin(){
 if(run||starting)return;
 const state=lab.state();if(!state.running||!Number.isFinite(state.baseline?.head)){ $('experimentMessage').textContent='カメラ・IMUを開始して、頭部角度の基準を取得してください。';return;}
 let c;try{c=settings();}catch(e){$('experimentMessage').textContent=e.message;return;}
 if(!state.latest||quality(state.latest,c)){$('experimentMessage').textContent='顔とIMUを確認し、設定した角度範囲内に入ってから開始してください。';return;}
 starting=true;$('enterExperiment').disabled=true;
 try{
  await lab.startRecording();if(!lab.state().recording)throw Error('記録を開始できません。上の状態表示を確認してください。');
  const seed=crypto.getRandomValues(new Uint32Array(1))[0],rng=seeded(seed);
  run={config:c,seed,plan:c.runMode==='random'?plan(c,rng):[],startedAt:performance.now()};
  lab.state().session.meta.experiment={...run,version:'0.3.0',feedbackScale:{felt:'tap 感じた when self-motion is felt, tap again (消えた) when it disappears; absent = not felt',feltDirection:'forward/backward self-motion, optional',sensation:'0 weak, 100 strongest self-motion feeling, null = not rated; unsigned intensity only'},stimulusModel:'static random 3D dots, camera orbits rotation axis offset R: drum R=0, wheel finite R, stream R=inf',postResponseTiming:'retrospective per-trial directions and perceived body movement after experiment',adaptiveStopRule:'valid headDelta returns within the configured threshold; no fixed stimulus duration',presentationTiming:'requestAnimationFrame software times, not measured photon onset',randomization:'LCG seed, shuffled 7-condition blocks',postureMetric:'head inclination relative to baseline, not anatomical CVA'};
  document.body.classList.add('in-experiment');stage.hidden=false;
  $('passage').textContent=c.readingText;$('readingPanel').hidden=c.taskMode!=='reading';$('arithmeticPanel').hidden=c.taskMode!=='arithmetic';
  renderer=new StimulusRenderer($('stimulus'),stimCfg(c),seed^0x9e3779b9);index=0;trialCount=0;trial=null;deviationSince=null;valid=true;reason='';zero();correct=0;attempts=0;taskRng=seeded(seed^0x85ebca6b);
  if(c.taskMode==='arithmetic')nextQuestion();
  phaseTo('ready');log('experiment_start',{config:c,seed});lab.checkpoint();lastDraw=performance.now();lastSample=lastDraw;requestAnimationFrame(draw);
 }catch(e){if(run)finish('start_error');else if(lab.state().recording)lab.endRecord('experiment_start_error');$('experimentMessage').textContent=e.message;stage.hidden=true;document.body.classList.remove('in-experiment');}
 finally{starting=false;}
}
function draw(now){
 if(!run)return;
 if(!lab.state().recording){finish('recording_stopped',false);return;}
 const row=lab.state().latest;
 reason=row?quality(row,run.config):'顔・IMUを確認してください';valid=!reason;
 if(!valid){
  deviationSince=null;
  if(phase==='stim'&&run.config.runMode==='random')finishTrial('tracking_invalid',now);
  if(phase==='ready')phaseAt=now;
 }
 if(phase==='ready'&&valid&&now-phaseAt>=3000){if(run.config.runMode==='random')startTrial(run.plan[index],now);else phaseTo('watch',now);}
 else if(phase==='stim'&&run.config.runMode==='random'&&now-phaseAt>=run.config.stimSeconds*1000)finishTrial('duration',now);
 else if(phase==='rest'&&now-phaseAt>=run.config.restSeconds*1000&&valid){
  if(run.config.runMode==='random'){if(index>=run.plan.length){finish('completed');return;}trial=null;phaseTo('ready',now);}
  else{trial=null;phaseTo('watch',now);}
 }
 if(phase==='stim'){
  if(!valid&&trial.pauseAt===null){trial.pauseAt=now;log('stimulus_pause',{reason});}
  else if(valid&&trial.pauseAt!==null){trial.pausedMs+=now-trial.pauseAt;trial.pauseAt=null;log('stimulus_resume');}
 }
 const dt=(now-lastDraw)/1000;
 if(phase==='stim'&&valid){trial.t+=dt;trial.rate=rateOf(trial.t,trial);if(trial.motion==='reverse'&&!trial.reversed&&trial.t>=REVERSE_AT){trial.reversed=true;log('stimulus_reversal',{trialT:tNow(),rate:trial.rate,...feedback()});}}
 const speed=phase==='stim'&&valid?trial.rate:0;
 renderer.draw(dt,speed);
 if(phase==='stim'&&valid&&trial.firstDrawAt===null){trial.firstDrawAt=now;log('stimulus_first_draw',{rafTimestamp:now,speed});}
 if(now-lastSample>=1000){log('presentation_sample',{rafTimestamp:now,frameGapMs:now-lastDraw,speed,eligible:valid,...feedback()});lastSample=now;}
 $('phaseLabel').textContent=phase==='ready'?'準備・静止':phase==='watch'||phase==='stim'?'文章を読み続けてください':'休憩';
 $('trackingLabel').textContent=valid?'記録中':reason;
 lastDraw=now;requestAnimationFrame(draw);
}
function finish(reason='user',stopRecord=true){
 if(!run)return;
 if(phase==='stim')finishTrial(reason,performance.now());
 log('experiment_end',{reason,attempts,correct});run=null;renderer=null;phase='idle';deviationSince=null;
 stage.hidden=true;document.body.classList.remove('in-experiment');if(stopRecord)lab.endRecord(reason);
 $('experimentMessage').textContent=`実験を終了しました（${reason==='completed'?'全条件完了':reason==='user'?'操作による終了':'中断'}）。感覚の方向などを回答してから、CSVとJSONを保存してください。`;
 $('exportEvents').disabled=false;lab.checkpoint();refreshResponses();$('postResponses').scrollIntoView({behavior:'smooth',block:'start'});
}

// ---- カメラ・記録なしで刺激だけ試すプレビュー ----
let preview=null;
const PV=['mode','density','motion','layout','shape'];
function openPreview(){
 if(run||preview||starting)return;
 let c;try{c=settings();}catch(e){$('experimentMessage').textContent=e.message;return;}
 preview={t:0,last:performance.now()};
 document.body.classList.add('in-experiment');stage.hidden=false;stage.classList.add('pv');$('previewBar').hidden=false;
 $('passage').textContent=c.readingText;$('readingPanel').hidden=false;$('arithmeticPanel').hidden=true;
 for(const id of PV)$('pv_'+id).value=$(id).value;
 renderer=new StimulusRenderer($('stimulus'),stimCfg(c),1);zero();
 $('phaseLabel').textContent='プレビュー（記録なし）';$('trackingLabel').textContent='プレビュー';
 requestAnimationFrame(drawPreview);
}
function closePreview(){if(!preview)return;preview=null;renderer=null;stage.hidden=true;stage.classList.remove('pv');$('previewBar').hidden=true;document.body.classList.remove('in-experiment');zero();}
for(const id of PV)$('pv_'+id).addEventListener('change',()=>{if(!preview)return;$(id).value=$('pv_'+id).value;try{const c=settings();renderer.configure(stimCfg(c));preview.t=0;}catch(e){}});
function drawPreview(now){
 if(!preview)return;
 const dt=(now-preview.last)/1000;preview.last=now;
 let c;try{c=settings();}catch(e){requestAnimationFrame(drawPreview);return;}
 const loop=Math.max(12,c.stimSeconds);preview.t=(preview.t+dt)%loop;
 const tt={dir:Number(c.direction),speedFrac:c.speed/100,mode:c.mode,motion:c.motion};
 renderer.draw(dt,rateOf(preview.t,tt));
 requestAnimationFrame(drawPreview);
}
$('previewBtn').addEventListener('click',openPreview);
$('enterExperiment').addEventListener('click',begin);
$('finishExperiment').addEventListener('click',()=>{if(preview)closePreview();else finish();});
$('emergencyStop').addEventListener('click',()=>{if(preview)closePreview();else finish('participant_stop');});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(preview)closePreview();else finish('participant_stop');}});
window.addEventListener('posture-record-ended',e=>{if(run)finish(e.detail,false);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&run)finish('page_hidden');});
window.addEventListener('resize',()=>{if(renderer){renderer.resize();log('viewport_changed',{width:innerWidth,height:innerHeight});}});
setInterval(()=>{const s=lab.state();$('enterExperiment').disabled=starting||!!run||!s.running||!Number.isFinite(s.baseline?.head)||s.recording||!!s.collect;$('exportEvents').disabled=s.recording||!lab.selectedSession();refreshResponses();},300);
$('exportEvents').addEventListener('click',()=>{
 const s=lab.selectedSession();if(!s||lab.state().recording)return;
 const keys=['sessionId','t','elapsedSeconds','type','trialId','experimentPhase','detailsJson'];
 const rows=s.events.map(e=>[s.meta.id,e.t,(e.t-s.meta.start)/1000,e.type,e.trialId??'',e.experimentPhase??'',JSON.stringify(e)]);
 lab.download(`${s.meta.id}-events.csv`,'\ufeff'+[keys,...rows].map(r=>r.map(lab.csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
});

let responseSession=null;
const directionOptions=[['','未回答'],['forward','前へ'],['backward','後ろへ'],['both','前後両方'],['none','感じなかった'],['other','その他'],['unsure','分からない'],['not_recalled','覚えていない']];
function refreshResponses(){
 const session=lab.selectedSession();const target=!lab.state().recording&&session?.meta.experiment?session:null;
 if(target===responseSession)return;
 responseSession=target;$('postResponses').hidden=!target;$('responseFields').replaceChildren();
 if(!target)return;
 const trials=target.events.filter(e=>e.type==='stimulus_start');
 if(!trials.length){$('responseFields').textContent='この記録には刺激提示がありません。';return;}
 const saved=target.meta.experiment.postResponses?.trials??[];
 for(const entry of trials){
  const id=entry.id??entry.trialId;const answer=saved.find(a=>a.trialId===id)??{};
  const field=document.createElement('fieldset');field.dataset.trialId=id;
  const legend=document.createElement('legend');legend.textContent=`刺激 ${id}（開始 ${(Math.max(0,entry.t-target.meta.start)/1000).toFixed(1)} 秒）`;field.append(legend);
  for(const [key,label] of [['sensationDirection','自分が動いたと感じた方向'],['bodyDirection','体勢が実際に動いたと感じた方向']]){
   const wrap=document.createElement('label');wrap.textContent=label;const select=document.createElement('select');select.dataset.answer=key;
   for(const [value,text] of directionOptions)select.add(new Option(text,value));select.value=answer[key]??'';wrap.append(select);field.append(wrap);
  }
  const wrap=document.createElement('label');wrap.textContent='補足（任意）';const input=document.createElement('textarea');input.rows=2;input.maxLength=2000;input.dataset.answer='note';input.value=answer.note??'';wrap.append(input);field.append(wrap);$('responseFields').append(field);
 }
 $('responseStatus').textContent='回答は刺激・回答CSVと全記録JSONに含まれます。回答後に保存してください。';
}
function saveResponses(){
 const session=responseSession;if(!session||session!==lab.selectedSession()||lab.state().recording)return;
 const trials=[...$('responseFields').querySelectorAll('fieldset')].map(field=>({trialId:Number(field.dataset.trialId),...Object.fromEntries([...field.querySelectorAll('[data-answer]')].map(el=>[el.dataset.answer,el.value]))}));
 if(!trials.length||JSON.stringify(trials)===JSON.stringify(session.meta.experiment.postResponses?.trials))return;
 lab.updateResponses(session,trials).then(()=>{if(responseSession===session)$('responseStatus').textContent='回答を端末内に記録しました。刺激・回答CSVと全記録JSONを保存してください。';}).catch(()=>{if(responseSession===session)$('responseStatus').textContent='端末内への退避ができません。回答はメモリー上にあるため、このまま全記録JSONを保存してください。';});
}
$('responseFields').addEventListener('change',saveResponses);
for(const id of ['exportCsv','exportJson','exportEvents','enterExperiment','sessionSelect'])$(id).addEventListener('pointerdown',saveResponses);
for(const id of ['exportCsv','exportJson','exportEvents','enterExperiment'])$(id).addEventListener('click',saveResponses,{capture:true});
