import {lab} from './core.js';
import {StimulusRenderer} from './stimulus.js';
const $=id=>document.getElementById(id);
const stage=$('experimentStage');
let run=null,renderer=null,phase='idle',phaseAt=0,lastDraw=0,lastSample=0,valid=false,reason='',deviationSince=null,trial=null,index=0,trialCount=0,armed=true,rearmSince=null,starting=false;
const fields=['runMode','taskMode','holdSeconds','threshold','deviation','pattern','direction','strength','angularSpeed','radialSpeed','stimSeconds','restSeconds','dotCount','dotSize','renderFov','repeats','useGate','pitchMin','pitchMax','readingText'];
function settings(){
 const c={};for(const id of fields){const el=$(id);c[id]=el.type==='number'?Number(el.value):el.value;}
 for(const id of fields){const el=$(id);if(el.type==='number'&&(!Number.isFinite(c[id])||!el.checkValidity()))throw Error(`${el.parentElement.firstChild.textContent}の入力を確認してください。`);}
 if(c.pitchMin>=c.pitchMax)throw Error('角度範囲の下限は上限より小さくしてください。');
 if(c.runMode==='random'&&c.strength===0)throw Error('ランダム比較では強度を0より大きくしてください。');
 if(c.taskMode==='reading'&&!c.readingText.trim())throw Error('読ませる文章を入力してください。');
 return c;
}
function log(type,data={}){lab.log(type,{...data,experimentPhase:phase,trialId:trial?.id??null});}
function seeded(seed){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function plan(c,rng){const out=[];for(let r=0;r<c.repeats;r++){const block=[{strength:0,direction:0,repeat:r+1}];for(const direction of [-1,1])for(const q of [1/3,2/3,1])block.push({strength:c.strength*q,direction,repeat:r+1});for(let i=block.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[block[i],block[j]]=[block[j],block[i]];}out.push(...block);}return out;}
function phaseTo(next,now=performance.now()){phase=next;phaseAt=now;log('phase',{phase:next});}
function feedback(){return {sensation:Number($('sensation').value),body:Number($('body').value)};}
function zero(){for(const id of ['sensation','body']){$(id).value='0';$(id+'Value').textContent='0';}if(run)log('feedback_reset',feedback());}
for(const id of ['sensation','body'])$(id).addEventListener('input',()=>{$(id+'Value').textContent=$(id).value;if(run)log('feedback',{channel:id,value:Number($(id).value),...feedback()});});
$('zeroFeedback').addEventListener('click',zero);
function quality(row,c){
 if(!Number.isFinite(row.headDelta))return '顔・IMUを確認してください';
 if(performance.now()-row.t>500)return '計測の更新待ち';
 if(c.useGate==='1'&&(row.pitch<c.pitchMin||row.pitch>c.pitchMax))return '顔をカメラの正面に近づけてください';
 return '';
}
function deviates(row){const x=row.headDelta,c=run.config;return c.deviation==='both'?Math.abs(x)>=c.threshold:c.deviation==='negative'?x<=-c.threshold:x>=c.threshold;}
function recovered(row){const x=row.headDelta,c=run.config,m=Math.max(0,c.threshold-2);return c.deviation==='both'?Math.abs(x)<m:c.deviation==='negative'?x>-m:x<m;}
window.addEventListener('posture-frame',({detail:row})=>{
 if(!run)return;
 reason=quality(row,run.config);valid=!reason;
 if(valid&&phase==='watch'){
  if(!armed){if(recovered(row)){rearmSince??=row.t;if(row.t-rearmSince>=1000){armed=true;rearmSince=null;log('trigger_rearmed');}}else rearmSince=null;}
  if(armed&&deviates(row)){deviationSince??=row.t;if(row.t-deviationSince>=run.config.holdSeconds*1000)startTrial({strength:run.config.strength,direction:Number(run.config.direction),repeat:null},performance.now());}
  else deviationSince=null;
 }else if(!valid){deviationSince=null;rearmSince=null;}
 Object.assign(row,{experimentMode:run.config.runMode,experimentPhase:phase,trialId:trial?.id??null,stimulusPattern:run.config.pattern,stimulusSpeed:phase==='stim'?trial.speed:0,stimulusStrength:phase==='stim'?trial.strength:0,postureEligible:valid,postureRejectReason:reason,deviationElapsedMs:deviationSince===null?0:Math.max(0,row.t-deviationSince),...feedback()});
});
function startTrial(spec,now){
 const c=run.config;
 trial={...spec,id:++trialCount,pattern:c.pattern,speed:spec.direction*spec.strength/100*(c.pattern==='radial'?c.radialSpeed:c.angularSpeed),startRequestedAt:now,firstDrawAt:null};
 zero();phaseTo('stim',now);log('stimulus_start',{...trial,units:c.pattern==='radial'?'virtual_m/s':'deg/s'});deviationSince=null;armed=false;
}
function finishTrial(cause,now){
 if(!trial)return;
 log('stimulus_end',{cause,durationMs:now-trial.startRequestedAt,firstDrawAt:trial.firstDrawAt,...feedback()});
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
  lab.state().session.meta.experiment={...run,version:'0.1.0',feedbackScale:{sensation:'-100 back, +100 forward self-motion feeling; 0 none',body:'-100 backward, +100 forward perceived actual body movement; 0 none'},presentationTiming:'requestAnimationFrame software times, not measured photon onset',randomization:'LCG seed, shuffled 7-condition blocks',postureMetric:'head inclination relative to baseline, not anatomical CVA'};
  document.body.classList.add('in-experiment');stage.hidden=false;
  $('passage').textContent=c.readingText;$('readingPanel').hidden=c.taskMode!=='reading';$('arithmeticPanel').hidden=c.taskMode!=='arithmetic';
  $('senseLegend').textContent=c.pattern==='radial'?'＋：前進の感覚　−：後退の感覚':'＋：前へ倒れる感覚　−：後ろへ倒れる感覚';
  renderer=new StimulusRenderer($('stimulus'),c,seed^0x9e3779b9);index=0;trialCount=0;trial=null;armed=true;rearmSince=null;deviationSince=null;valid=true;reason='';zero();correct=0;attempts=0;taskRng=seeded(seed^0x85ebca6b);
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
  deviationSince=null;rearmSince=null;
  if(phase==='stim')finishTrial('tracking_invalid',now);
  if(phase==='ready')phaseAt=now;
 }
 if(phase==='ready'&&valid&&now-phaseAt>=3000){if(run.config.runMode==='random')startTrial(run.plan[index],now);else phaseTo('watch',now);}
 else if(phase==='stim'&&now-phaseAt>=run.config.stimSeconds*1000)finishTrial('duration',now);
 else if(phase==='rest'&&now-phaseAt>=run.config.restSeconds*1000&&valid){
  if(run.config.runMode==='random'){if(index>=run.plan.length){finish('completed');return;}trial=null;phaseTo('ready',now);}
  else{trial=null;phaseTo('watch',now);}
 }
 const speed=phase==='stim'&&valid?trial.speed:0;
 renderer.draw((now-lastDraw)/1000,speed);
 if(phase==='stim'&&trial.firstDrawAt===null){trial.firstDrawAt=now;log('stimulus_first_draw',{rafTimestamp:now,speed});}
 if(now-lastSample>=1000){log('presentation_sample',{rafTimestamp:now,frameGapMs:now-lastDraw,speed,eligible:valid,...feedback()});lastSample=now;}
 $('phaseLabel').textContent=phase==='ready'?'準備・静止':phase==='watch'?'文章・課題を続けてください':phase==='stim'?'文章・課題を続けてください':'感覚があれば入力してください';
 $('trackingLabel').textContent=valid?'記録中':reason;
 lastDraw=now;requestAnimationFrame(draw);
}
function finish(reason='user',stopRecord=true){
 if(!run)return;
 if(phase==='stim')finishTrial(reason,performance.now());
 log('experiment_end',{reason,attempts,correct});run=null;renderer=null;phase='idle';deviationSince=null;
 stage.hidden=true;document.body.classList.remove('in-experiment');if(stopRecord)lab.endRecord(reason);
 $('experimentMessage').textContent=`実験を終了しました（${reason==='completed'?'全条件完了':reason==='user'?'操作による終了':'中断'}）。CSVとJSONを保存してください。`;
 $('exportEvents').disabled=false;lab.checkpoint();$('exportJson').scrollIntoView({behavior:'smooth',block:'center'});
}
$('enterExperiment').addEventListener('click',begin);
$('finishExperiment').addEventListener('click',()=>finish());
$('emergencyStop').addEventListener('click',()=>finish('participant_stop'));
window.addEventListener('keydown',e=>{if(e.key==='Escape')finish('participant_stop');});
window.addEventListener('posture-record-ended',e=>{if(run)finish(e.detail,false);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&run)finish('page_hidden');});
window.addEventListener('resize',()=>{if(renderer){renderer.resize();log('viewport_changed',{width:innerWidth,height:innerHeight});}});
setInterval(()=>{const s=lab.state();$('enterExperiment').disabled=starting||!!run||!s.running||!Number.isFinite(s.baseline?.head)||s.recording||!!s.collect;$('exportEvents').disabled=s.recording||!lab.selectedSession();},300);
$('exportEvents').addEventListener('click',()=>{
 const s=lab.selectedSession();if(!s||lab.state().recording)return;
 const keys=['sessionId','t','elapsedSeconds','type','trialId','experimentPhase','detailsJson'];
 const rows=s.events.map(e=>[s.meta.id,e.t,(e.t-s.meta.start)/1000,e.type,e.trialId??'',e.experimentPhase??'',JSON.stringify(e)]);
 lab.download(`${s.meta.id}-events.csv`,'\ufeff'+[keys,...rows].map(r=>r.map(lab.csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
});
