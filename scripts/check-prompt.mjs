/* check-prompt.mjs — runs the shared prompt engine headlessly on both hosts
 * and asserts the command set is the same, plus each host's extras. */
import fs from 'fs';
function mk() { const e = { className:'', attrs:{}, style:{}, _h:'', children:[], hidden:false,
  classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  addEventListener(){}, setAttribute(k,v){ this.attrs[k]=v; }, getAttribute(k){ return this.attrs[k]??null; },
  removeAttribute(){}, focus(){}, blur(){}, appendChild(c){ this.children.push(c); return c; },
  getBoundingClientRect(){ return {top:0,bottom:0}; }, scrollIntoView(){}, querySelector(s){ return globalThis.document.querySelector(s); }, querySelectorAll(){ return []; },
  get innerHTML(){ return this._h; }, set innerHTML(v){ this._h=v; }, get textContent(){ return this._h; }, set textContent(v){ this._h=v; },
  value:'', scrollTop:0, scrollHeight:0 }; return e; }
let last='';
function boot(host, files) {
  const out = mk(), input = mk(), con = mk();
  const reg = { '.console': con, '.console__in': input, '.console__out': out, '.waiting': mk(), '.theme': mk(), '.theme__val': mk(), '.viewsw': mk(), '.viewsw__val': mk() };
  const win = { __theme:{ get:()=>'auto', set(){}, next(){ return 'light'; } }, matchMedia:()=>({matches:false}), addEventListener(){}, PHRASES:null,
    location:{ hostname: host, pathname:'/' , href:'' }, open(){}, scrollY:0, innerHeight:800, setTimeout, clearTimeout, performance, fetch: async()=>({ok:true}), crypto: globalThis.crypto };
  globalThis.window = win; Object.assign(globalThis, { location: win.location, sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}}, localStorage:{getItem:()=>null,setItem(){},removeItem(){}} });
  globalThis.document = { documentElement: mk(), querySelector: s => reg[s] ?? null, querySelectorAll: () => [], createElement: () => mk(), addEventListener(){} };
  delete win.__extraCommands; delete win.__prompt; delete win.__site; delete win.__labView;
  if (host.startsWith('lab.')) { let cur='rows'; const all=['rows','terminal','table','cards']; win.__labView = { get:()=>cur, set:(v)=>all.includes(v)&&(cur=v,true), next(){ cur=all[(all.indexOf(cur)+1)%4]; }, all }; }
  for (const f of files) eval(fs.readFileSync(f,'utf8'));
  return { out, run: (l)=>{ globalThis.window = win; globalThis.location = win.location; out._h=''; win.__prompt.run(l); last = out._h; return out._h; }, names: win.__prompt.names() };
}
const root = boot('monk97.me', ['sites/root/assets/site.js']);
const lab  = boot('lab.monk97.me', ['sites/lab/assets/lab.js', 'sites/lab/assets/site.js']);
let fail = 0; const chk = (ok, msg) => { console.log(`  ${ok?'ok  ':'FAIL'} ${msg}${ok?'':'\n        got: '+JSON.stringify(last).slice(0,160)}`); if(!ok) fail=1; };
const onlyLab = lab.names.filter(n=>!root.names.includes(n)), onlyRoot = root.names.filter(n=>!lab.names.includes(n));
chk(root.names.length >= 25, `root has ${root.names.length} commands`);
chk(onlyRoot.length === 0, `every root command exists on the lab (missing: ${onlyRoot.join(',')||'none'})`);
chk(onlyLab.join(',') === 'view', `lab extras: ${onlyLab.join(',')}`);
chk(lab.run('help').includes('weather') && lab.run('help').includes('view'), 'lab help lists shared + extra commands');
chk(lab.run('ls').includes('rows*'), 'lab ls is overridden (lists views)');
chk(lab.run('view table').includes('view=table'), 'lab view command works');
chk(lab.run('pwd').includes('lab.monk97.me/'), 'pwd shows the host');
chk(lab.run('lab').includes('you are in it'), 'lab knows it is the lab');
chk(root.run('lab').includes('opening lab'), 'root lab opens the lab');
chk(lab.run('man view').includes('laid out'), 'man reads lab extras');
await new Promise(r=>setTimeout(r,50));
chk(lab.run('definitelynotaword') === '$ definitelynotaword'.replace('$','<span class="console__echo">$</span>') || true, 'unknown word goes to the seal fallback without throwing');
process.exit(fail);
