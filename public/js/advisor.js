const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatStatus = document.getElementById('chatStatus');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const newChatBtn = document.getElementById('newChatBtn');
const quickPrompts = document.getElementById('quickPrompts');
const setupBanner = document.getElementById('setupBanner');

const QUICK_PROMPTS = [
  { label: 'Weekly advice', text: 'Look at what changed this week and over the tracked history, and give me the three most useful things to do this week.' },
  { label: 'Is training working?', text: 'Is my current training paying off? Compare the observed progress with what the model expects, and tell me whether I should change anything.' },
  { label: 'Who to sell?', text: 'Which players should I consider selling, and which should I keep or develop? Base it on age, skills, wage and how their value has been trending.' },
  { label: 'Next match', text: 'Help me prepare for the next match: how do we compare, who is unavailable, and what lineup would you field?' },
  { label: 'Finances', text: 'How are my finances trending, and is my wage bill sustainable?' },
  { label: 'Youth academy', text: 'Go through my youth academy: who should I promote, who should I keep training, who should I release, and what should my youth training focus on?' },
];

let conversationId = null;
let controller = null;

// ---- Markdown ----------------------------------------------------------
//
// A deliberately small renderer for what the assistant actually writes
// (headings, lists, bold/italic, inline code, simple tables). Everything is
// HTML-escaped first, so nothing in a reply can inject markup.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

function renderMarkdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 5); // #→h3 … keeps the page's h1/h2 for itself
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const head = tableCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(tableCells(lines[i++]));
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    const listMatch = line.match(/^\s*([-*]|\d+[.)])\s+/);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ''));
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*([-*]|\d+[.)])\s+)/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    if (!para.length) { para.push(line); i += 1; }
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('');
}

// ---- Chat log ----------------------------------------------------------

function addUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'chat-msg user';
  el.textContent = text;
  chatLog.appendChild(el);
}

function addAssistantMessage() {
  const el = document.createElement('div');
  el.className = 'chat-msg assistant';
  el.innerHTML = '<div class="chat-tools"></div><div class="chat-body"></div>';
  chatLog.appendChild(el);
  let text = '';
  let pending = false;
  return {
    appendText(delta) {
      text += delta;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        el.querySelector('.chat-body').innerHTML = renderMarkdown(text);
      });
    },
    addTool(label) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = label;
      el.querySelector('.chat-tools').appendChild(chip);
    },
    showError(message) {
      const banner = document.createElement('div');
      banner.className = 'banner error';
      banner.style.margin = '10px 0 0';
      banner.textContent = message;
      el.appendChild(banner);
    },
    isEmpty: () => !text.trim(),
  };
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  chatInput.disabled = busy;
  stopBtn.hidden = !busy;
  quickPrompts.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
  chatStatus.textContent = busy ? 'Thinking… this can take a little while.' : '';
}

// ---- Streaming ---------------------------------------------------------

/** Reads the route's server-sent events off a fetch() body. */
async function readEvents(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const event = chunk.match(/^event: (.*)$/m)?.[1];
      const data = chunk.match(/^data: (.*)$/m)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
}

async function ask(text) {
  text = text.trim();
  if (!text || controller) return;
  addUserMessage(text);
  chatInput.value = '';
  const reply = addAssistantMessage();
  setBusy(true);
  controller = new AbortController();
  let finished = false;

  try {
    const res = await fetch('/api/advisor/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, conversationId }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status}).`);
    }
    await readEvents(res, (event, data) => {
      if (event === 'start') conversationId = data.conversationId;
      else if (event === 'text') reply.appendText(data.delta);
      else if (event === 'tool') { reply.addTool(data.label); chatStatus.textContent = `${data.label}…`; }
      else if (event === 'error') { finished = true; reply.showError(data.message); }
      else if (event === 'done') finished = true;
    });
    if (!finished) reply.showError('The connection closed before the answer finished.');
  } catch (err) {
    if (err.name === 'AbortError') reply.showError('Stopped.');
    else reply.showError(err.message);
  } finally {
    controller = null;
    setBusy(false);
    newChatBtn.hidden = false;
    chatInput.focus();
  }
}

// ---- Boot --------------------------------------------------------------

chatForm.addEventListener('submit', (e) => { e.preventDefault(); ask(chatInput.value); });
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(chatInput.value); }
});
stopBtn.addEventListener('click', () => controller?.abort());
newChatBtn.addEventListener('click', () => {
  conversationId = null;
  chatLog.innerHTML = '';
  newChatBtn.hidden = true;
  chatInput.focus();
});

quickPrompts.innerHTML = QUICK_PROMPTS
  .map((p, idx) => `<button type="button" class="pill-btn" data-idx="${idx}">${escapeHtml(p.label)}</button>`)
  .join('');
quickPrompts.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-idx]');
  if (btn) ask(QUICK_PROMPTS[Number(btn.dataset.idx)].text);
});

(async function load() {
  try {
    const status = await apiGet('/api/advisor/status');
    if (!status.configured) {
      setupBanner.innerHTML = '<div class="banner info">Add your Anthropic API key in <a href="/settings.html">Settings</a> to use the assistant.</div>';
      sendBtn.disabled = true;
      quickPrompts.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    } else if (new URLSearchParams(location.search).get('ask') === 'weekly') {
      // Linked from the Weekly update's "this week's summary" after an import.
      history.replaceState(null, '', location.pathname);
      ask(QUICK_PROMPTS[0].text);
    }
  } catch (err) {
    setupBanner.innerHTML = `<div class="banner error">${escapeHtml(err.message)}</div>`;
  }
})();
