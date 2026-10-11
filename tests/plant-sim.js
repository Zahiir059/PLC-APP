// quick integration probe: start plant, log progress
const fs=require('fs'),vm=require('vm'),path=require('path');globalThis.window=globalThis;
['js/config.js','js/tags.js','js/plc-engine.js','js/process-model.js','js/sim.js','data/default-data.js'].forEach(f=>vm.runInThisContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8')));
const sim=new PLANT.Sim();sim.init(PLANT_DEFAULTS.tags,PLANT_DEFAULTS.program);
const g=n=>sim.get(n);
sim.runSeconds(1);
sim.pulse('M_START');
let last=-1;
for(let s=0;s<600;s++){ sim.runSeconds(1);
  if(g('SEQ_STEP')!==last||s%20===0){ last=g('SEQ_STEP'); console.log(`t=${s+1}s step=${g('SEQ_STEP')} run=${g('PLANT_RUN')} WT=${g('AI_WT103').toFixed(1)} LT201=${g('AI_LT201').toFixed(0)} TT=${g('AI_TT201').toFixed(1)} out=${g('AO_HEATER').toFixed(0)} bowl=${g('AI_LT301').toFixed(0)} cans=${g('CAN_PACKED.CV')} rej=${sim.plant.totalRejects()} ctn=${g('BARCODE_CNT.CV')} plt=${g('PALLET_CNT.CV')} order=${g('ORDER_DONE')}`);}
  if(g('ORDER_DONE')&&!g('PLANT_RUN')){console.log('order done at',s+1);break;}
}
console.log('fillSamples',sim.plant.stats.fillSamples.slice(0,5).map(x=>x.toFixed(0)).join(','),'rejects',JSON.stringify(sim.plant.stats.rejects));
