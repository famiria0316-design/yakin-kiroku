'use strict';
// 夜勤記録アプリ:すべて端末内で処理します(外部への送信なし)

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const DEFAULT_DICT = [
  '放出→訪室', '方室→訪室', '包室→訪室', '訪質→訪室',
  '単声答→男性棟', '男性等→男性棟', '男性島→男性棟', '女性等→女性棟', '女性島→女性棟',
  'グループホーム→GH', 'ジーエイチ→GH',
  '特編→特変', '特返→特変', '特変無く→特変なく',
  'シーシーレモン→CCレモン',
].join('\n');

const SYMBOLS = ['〇〇', '△△', '□□', '☆☆', '◇◇', '▽▽', '◎◎', '××'];
const WD = '日月火水木金土';

// ---------- 状態 ----------
const state = store.get('draft', null) || {
  date: '', overnight: true, title: '', raw: '', persons: [], notes: [], globalNotes: [],
};
if (!state.date) state.date = todayStr();

function save() { store.set('draft', state); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- 整形ルール ----------
function toHalf(s) {
  return s.replace(/[０-９Ａ-Ｚａ-ｚ．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
          .replace(/　/g, ' ');
}

function rep(s, re, to, notes) {
  return s.replace(re, (...a) => {
    const m = a[0];
    const r = typeof to === 'function' ? to(...a) : m.replace(new RegExp(re.source, re.flags.replace('g', '')), to);
    if (notes && r !== m) notes.push(`${m.trim()}→${r}`);
    return r;
  });
}

function parseDict(text) {
  return text.split('\n').map((l) => l.split(/→|->|=>/)).filter((p) => p.length === 2 && p[0].trim())
    .map(([a, b]) => [a.trim(), b.trim()]);
}

function parseNames(text) {
  return text.split('\n').map((l) => l.split(/[,、，]/).map((x) => x.trim()).filter(Boolean)).filter((g) => g.length);
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function maskNames(text, groups, notes) {
  // 出てきた順に記号を割り当てる
  const found = groups.map((g) => {
    const idx = Math.min(...g.map((n) => { const i = text.indexOf(n); return i < 0 ? Infinity : i; }));
    return { g, idx };
  }).filter((x) => x.idx !== Infinity).sort((a, b) => a.idx - b.idx);
  found.forEach((x, i) => {
    const sym = SYMBOLS[i] || `（${i + 1}）`;
    const variants = [...x.g].sort((a, b) => b.length - a.length).map(escRe).join('|');
    const re = new RegExp(`(?:${variants})(?:さん|様|さま|くん|君|ちゃん|氏)?`, 'g');
    if (re.test(text)) notes.push(`${x.g[0]}→${sym}さん`);
    text = text.replace(re, `${sym}さん`);
  });
  return text;
}

function cleanParagraph(s, dict, notes) {
  s = toHalf(s);
  // 日本語の前後の空白を詰める
  s = s.replace(/\s*([^\x00-\x7F])\s*/g, '$1').trim();
  // フィラー
  s = s.replace(/(?:えー+と?|ええと|えっと|あのー+|あのぉ+|うーん+|んー+|まあ、|まぁ、)[、,]?/g, '');
  // かっこ
  s = s.replace(/(?:かっこ|カッコ|括弧)(?:とじる?|閉じる?)[、。]?/g, '」')
       .replace(/(?:かぎかっこ|かっこ|カッコ|括弧)(?:ひらく|開く)?[、。]?/g, '「');
  // 繰り返し(漢字・カタカナ2文字以上が続けて2回)
  s = rep(s, /([一-龥々ァ-ヶー]{2,})[、,]?\1/g, (m, a) => a, notes);
  // 辞書
  for (const [a, b] of dict) {
    if (a !== b && s.includes(a)) { s = s.split(a).join(b); notes.push(`${a}→${b}`); }
  }
  // 体温
  s = rep(s, /(3[4-9]|4[0-2])度(\d)分?/g, (m, a, b) => `${a}.${b}°C`, notes);
  s = rep(s, /(3[4-9]|4[0-2])(\.\d)?(?:度|℃|° C)(?!目)/g, (m, a, b) => `${a}${b || ''}°C`, notes);
  // 量
  s = rep(s, /(\d+)(?:ミリリットル|ミリ|mL|ML|cc(?=.{0,2}飲))/g, (m, a) => `${a}ml`, notes);
  // 日付と曜日
  s = rep(s, /(\d{1,2})月(\d{1,2})日[(（]?([月火水木金土日])(?:曜日?)?[)）]?/g, (m, a, b, c) => `${a}月${b}日(${c})`, notes);
  // 範囲「15分から30分」→「15〜30分」
  s = rep(s, /(\d+)(分|時間|時|回)?(?:から|~|〜)(\d+)(分|時間|時|回)/g,
    (m, a, u1, b, u2) => (u1 && u1 !== u2 ? m : `${a}〜${b}${u2}`), null);
  // 句読点の後始末
  s = s.replace(/[、,]{2,}/g, '、').replace(/、。/g, '。').replace(/。{2,}/g, '。')
       .replace(/「[、。]/g, '「').replace(/、」/g, '」').replace(/^[、。・\s]+/, '').trim();
  if (!s) return '';
  if (!/[。！？!?」)]$/.test(s)) s += '。';
  return '・' + s;
}

function formatAll(raw) {
  const dict = parseDict($('dict').value);
  const groups = parseNames($('names').value);
  const globalNotes = [];
  const masked = maskNames(raw, groups, globalNotes);
  const chunks = masked
    .split(/(?:次|つぎ)(?:行|い)く(?:よ|ね|ぞ|わ)?[。、!！.\s]*|次の(?:人|方)(?:に行きます|へ|に)?[。、\s]*/)
    .map((c) => c.trim()).filter(Boolean);
  const persons = [], notes = [];
  for (const c of chunks) {
    const n = [];
    const lines = c.split(/\n+|改行[。、]?|段落[。、]?/).map((p) => cleanParagraph(p, dict, n)).filter(Boolean);
    if (lines.length) { persons.push(lines.join('\n')); notes.push([...new Set(n)]); }
  }
  return { persons, notes, globalNotes };
}

// ---------- 画面 ----------
function renderPersons() {
  const box = $('persons');
  box.innerHTML = '';
  state.persons.forEach((text, i) => {
    const div = document.createElement('div');
    div.className = 'person';
    div.innerHTML = `<div class="person-head"><b>【${i + 1}人目】</b><button class="danger">削除</button></div>`;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.addEventListener('input', () => { state.persons[i] = ta.value; save(); });
    ta.addEventListener('blur', () => {
      // 段落の頭に「・」を付け直す
      const v = ta.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (l.startsWith('・') ? l : '・' + l)).join('\n');
      if (v !== ta.value) { ta.value = v; state.persons[i] = v; save(); }
    });
    div.appendChild(ta);
    const notes = (state.notes[i] || []).concat(i === 0 ? state.globalNotes || [] : []);
    if (notes.length) {
      const nd = document.createElement('div');
      nd.className = 'notes';
      nd.innerHTML = '自動で直したところ:' + notes.map((x) => `<span>${esc(x)}</span>`).join('');
      div.appendChild(nd);
    }
    div.querySelector('button').addEventListener('click', () => {
      if (!confirm(`【${i + 1}人目】を削除しますか?`)) return;
      state.persons.splice(i, 1); state.notes.splice(i, 1); save(); renderPersons();
    });
    box.appendChild(div);
  });
  $('resultSec').hidden = state.persons.length === 0;
}

function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function dateLabel() {
  if (!state.date) return '';
  const [y, m, d] = state.date.split('-').map(Number);
  const a = new Date(y, m - 1, d);
  const f = (x) => `${x.getMonth() + 1}月${x.getDate()}日(${WD[x.getDay()]})`;
  if (!state.overnight) return `${y}年${f(a)}`;
  const b = new Date(y, m - 1, d + 1);
  return `${y}年${f(a)}〜${b.getFullYear() !== y ? b.getFullYear() + '年' : ''}${f(b)}`;
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------- PDF(印刷) ----------
function buildPrint() {
  const pa = $('printArea');
  let html = `<div class="p-date">${esc(dateLabel())}</div>`;
  if (state.title.trim()) html += `<div class="p-title">${esc(state.title.trim())}</div>`;
  state.persons.forEach((t, i) => {
    const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
    html += `<div class="p-person"><div class="p-head">【${i + 1}人目】</div>` +
      lines.map((l) => `<div class="p-line">${esc(l.startsWith('・') ? l : '・' + l)}</div>`).join('') + '</div>';
  });
  pa.innerHTML = html;

  // A4・1枚に収まるよう文字サイズを調整(10.5pt → 最小8pt)
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;height:269mm;width:180mm';
  document.body.appendChild(probe);
  const maxH = probe.offsetHeight;
  probe.remove();
  pa.style.cssText = 'display:block;position:absolute;left:-9999px;top:0;width:180mm;' +
    'font-family:"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
  let size = 10.5;
  pa.style.fontSize = size + 'pt';
  while (pa.scrollHeight > maxH && size > 8) { size -= 0.25; pa.style.fontSize = size + 'pt'; }
  const fits = pa.scrollHeight <= maxH;
  pa.style.cssText = `font-size:${size}pt`;
  return { size, fits };
}

// ---------- イベント ----------
function init() {
  $('date').value = state.date;
  $('overnight').checked = state.overnight;
  $('title').value = state.title;
  $('raw').value = state.raw;
  $('names').value = store.get('names', '');
  $('dict').value = store.get('dict', DEFAULT_DICT);
  renderPersons();

  $('date').addEventListener('change', (e) => { state.date = e.target.value; save(); });
  $('overnight').addEventListener('change', (e) => { state.overnight = e.target.checked; save(); });
  $('title').addEventListener('input', (e) => { state.title = e.target.value; save(); });
  $('raw').addEventListener('input', (e) => { state.raw = e.target.value; save(); });
  $('names').addEventListener('input', (e) => store.set('names', e.target.value));
  $('dict').addEventListener('input', (e) => store.set('dict', e.target.value));

  $('btnDictReset').addEventListener('click', () => {
    if (!confirm('置き換え辞書を初期状態に戻しますか?(追加した分は消えます)')) return;
    $('dict').value = DEFAULT_DICT; store.set('dict', DEFAULT_DICT);
  });

  $('btnFormat').addEventListener('click', () => {
    const raw = $('raw').value.trim();
    if (!raw) { toast('先に①に話してください'); return; }
    if (state.persons.length && !confirm('③の内容を作り直します(手直しした分は消えます)。よろしいですか?')) return;
    const r = formatAll(raw);
    state.persons = r.persons; state.notes = r.notes; state.globalNotes = r.globalNotes; save();
    renderPersons();
    $('resultSec').scrollIntoView({ behavior: 'smooth' });
    toast(`${r.persons.length}人分に分けました`);
  });

  $('btnAdd').addEventListener('click', () => {
    state.persons.push('・'); state.notes.push([]); save(); renderPersons();
    const tas = document.querySelectorAll('#persons textarea'); tas[tas.length - 1].focus();
  });

  $('btnPdf').addEventListener('click', () => {
    document.activeElement && document.activeElement.blur();
    const { size, fits } = buildPrint();
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    $('pdfHint').innerHTML = (fits ? '' : '<b style="color:#b91c1c">内容が多く、1枚に収まりきりません。文を短くしてください。</b><br>') +
      `文字サイズ ${size}pt で出力します。<br>` +
      (ios ? 'iPhone:印刷画面の右上「共有」→「ファイルに保存」でPDFになります。'
           : 'Android:印刷画面の上のプリンタ選択で「PDFとして保存」を選んでください。');
    setTimeout(() => window.print(), 100);
  });

  $('btnClear').addEventListener('click', () => {
    if (!confirm('話した内容と③の記録を全部消します。名前と辞書の設定は残ります。よろしいですか?')) return;
    Object.assign(state, { raw: '', persons: [], notes: [], globalNotes: [], title: state.title, date: todayStr() });
    save(); $('raw').value = ''; $('date').value = state.date; renderPersons(); toast('消しました');
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(() => { $('offline').textContent = 'オフライン対応'; }).catch(() => {});
  }
}

init();
