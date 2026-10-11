// Node runner: loads the browser scripts into one global context and runs the self-tests.
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'..');
function load(files){ files.forEach(f=>vm.runInThisContext(fs.readFileSync(path.join(root,f),'utf8'),{filename:f})); }
globalThis.window=globalThis;
const files=process.argv.slice(2).length?process.argv.slice(2):['js/config.js','js/tags.js','js/plc-engine.js','js/selftest.js'];
load(files);
const res=PLANT.runSelfTests();
let fail=0;res.forEach(r=>{ if(!r.ok)fail++; console.log((r.ok?'PASS ':'FAIL ')+r.group+' :: '+r.name+(r.ok?'':'  -> '+r.msg)); });
console.log(`\n${res.length-fail}/${res.length} passed`);
process.exit(fail?1:0);
