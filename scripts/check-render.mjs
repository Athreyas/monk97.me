/* check-render.mjs — headless smoke test for the lab status renderers.
 * A syntax check proves nothing about whether a view actually draws;
 * this shims just enough DOM to run each one and count the nodes. */
import fs from 'fs';

function mkEl(cls='') {
  const e = {
    className: cls, children: [], attrs: {}, _text: '',
    style:{}, classList:{ toggle(){}, add(){} },
    appendChild(c){ this.children.push(c); return c; },
    setAttribute(k,v){ this.attrs[k]=v; },
    getAttribute(k){ return this.attrs[k] ?? null; },
    removeAttribute(k){ delete this.attrs[k]; },
    addEventListener(){}, querySelector(){ return null; },
    get firstChild(){ return this.children[0] ?? null; },
    get textContent(){ return this._text; },
    set textContent(v){ this._text = v; if (v==='') this.children=[]; },
  };
  return e;
}
const reg = {};
for (const s of ['[data-cats]','[data-vitals]','[data-host]','[data-spec]','[data-inc]','[data-inc-list]',
                 '.cats__live','[data-stat-text]','[data-stat-age]','.theme',
                 '.theme__val','.viewsw','.viewsw__val','.rail']) reg[s]=mkEl();
reg['[data-inc]'].hidden = true;

global.document = {
  documentElement: mkEl(),
  querySelector: s => reg[s] ?? null,
  createElement: t => mkEl(),
};
let store = {};
global.localStorage = { getItem:k=>store[k]??null, setItem:(k,v)=>store[k]=v, removeItem:k=>delete store[k] };
global.addEventListener = ()=>{};
global.setInterval = ()=>0;
global.window = global;
const feed = JSON.parse(fs.readFileSync('sites/lab/status.json','utf8'));
global.fetch = async () => ({ ok:true, json: async()=>feed });

eval(fs.readFileSync('sites/lab/assets/status.js','utf8'));

function countNodes(n){ return 1 + n.children.reduce((a,c)=>a+countNodes(c),0); }
await new Promise(r=>setTimeout(r,60));

const box = reg['[data-cats]'];
let fail = 0;
for (const v of window.__labView.all) {
  window.__labView.set(v);
  const n = countNodes(box) - 1;
  const ok = n > 20;
  if (!ok) fail = 1;
  console.log(`  ${v.padEnd(9)} ${String(n).padStart(4)} nodes  ${ok?'ok':'FAIL (empty)'}`);
}
const vit = countNodes(reg['[data-vitals]'])-1;
console.log(`  vitals    ${String(vit).padStart(4)} nodes  ${vit>=8?'ok':'FAIL'}`);
console.log(`  incidents ${reg['[data-inc]'].hidden?'hidden FAIL':'shown ok'}`);
const hn = countNodes(reg['[data-host]'])-1; console.log(`  host      ${String(hn).padStart(4)} nodes  ${hn>=12?'ok':'FAIL'}`); if (hn<12) fail=1;
const sp = countNodes(reg['[data-spec]'])-1;
console.log(`  spec      ${String(sp).padStart(4)} nodes  ${sp>=7?'ok':'FAIL'}`); if (sp<7) fail=1;
console.log(`  status    "${reg['[data-stat-text]'].textContent}"`);
process.exit(fail);
