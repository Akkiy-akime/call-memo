"use strict";

const STORE_KEY = "callmemo.v1";
const CLAUDE_URL = "https://claude.ai/new";

const DEFAULT_PROMPT = `以下は顧客との電話商談の文字起こしです。次の形式で、日本語で要約してください。

【概要】(3行以内)
【顧客の課題・ニーズ】
【懸念点・反論】
【予算・時期】
【決裁者・関係者】
【決定事項】
【次回アクション】(担当・期限)

ルール:
- 文字起こしにない内容は推測せず「記載なし」と書く
- 固有名詞・数字・日付は正確に転記する
- 誤認識と思われる箇所は補正せず、末尾に[要確認]と付記する`;

const state = {
  notes: [],
  settings: { prompt: DEFAULT_PROMPT },
  view: "list",
  currentId: null,
  query: "",
};

/* ---------- storage ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.notes)) state.notes = data.notes;
    if (data.settings && typeof data.settings.prompt === "string") {
      state.settings.prompt = data.settings.prompt;
    }
  } catch (e) {
    console.warn("load failed", e);
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ notes: state.notes, settings: state.settings }));
  } catch (e) {
    toast("保存に失敗しました(端末の容量を確認してください)");
  }
}

/* ---------- helpers ---------- */

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "value" || k === "checked" || k === "readOnly") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = h("textarea", { value: text, style: "position:fixed;opacity:0" });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (_) { /* ignore */ }
    ta.remove();
    if (!ok) return toast("コピーに失敗しました");
  }
  toast(okMsg || "コピーしました");
}

async function pasteInto(textarea, onChange) {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return toast("クリップボードが空です");
    textarea.value = text;
    onChange(text);
    toast("貼り付けました");
  } catch (e) {
    toast("貼り付けできません。入力欄を長押しして貼り付けてください");
  }
}

function buildClaudeText(note) {
  return `${state.settings.prompt.trim()}\n\n--- 文字起こし ---\n${(note.transcript || "").trim()}\n`;
}

function buildShareText(note, withTranscript) {
  const head = `【${note.title || "無題"}】${note.customer ? " " + note.customer : ""}\n${fmtDate(note.createdAt)}`;
  let body = `${head}\n\n${(note.summary || "").trim() || "(要約なし)"}`;
  if (withTranscript && note.transcript) body += `\n\n--- 文字起こし ---\n${note.transcript.trim()}`;
  return body;
}

/* ---------- navigation ---------- */

function go(view, id) {
  if (state.view === "edit") dropIfEmpty(state.currentId);
  state.view = view;
  state.currentId = id || null;
  render();
  window.scrollTo(0, 0);
}

function currentNote() {
  return state.notes.find((n) => n.id === state.currentId);
}

function dropIfEmpty(id) {
  const n = state.notes.find((x) => x.id === id);
  if (n && !n.title && !n.customer && !n.transcript && !n.summary) {
    state.notes = state.notes.filter((x) => x.id !== id);
    save();
  }
}

function createNote(fields) {
  const now = new Date().toISOString();
  const note = {
    id: newId(), title: "", customer: "", transcript: "", summary: "",
    mode: "recorder", createdAt: now, updatedAt: now, ...fields,
  };
  state.notes.unshift(note);
  save();
  return note;
}

function touch(note) {
  note.updatedAt = new Date().toISOString();
  save();
}

window.addEventListener("popstate", () => { if (state.view !== "list") go("list"); });

/* ---------- views ---------- */

function setTopbar(title, back, actions) {
  const bar = document.getElementById("topbar");
  bar.replaceChildren(
    back ? h("button", { onClick: back, "aria-label": "戻る" }, "← 戻る") : null,
    h("h1", null, title),
    ...(actions || [])
  );
}

function render() {
  const app = document.getElementById("app");
  if (state.view === "edit" && currentNote()) renderEdit(app);
  else if (state.view === "settings") renderSettings(app);
  else { state.view = "list"; renderList(app); }
}

function renderList(app) {
  setTopbar("通話メモ", null, [h("button", { onClick: () => go("settings") }, "設定")]);
  const search = h("input", {
    type: "search", placeholder: "検索(顧客名・内容)", value: state.query,
    onInput: (e) => { state.query = e.target.value; renderListBody(); },
  });
  const listBox = h("div", { id: "listbox" });
  app.replaceChildren(
    search, h("div", { style: "height:12px" }), listBox,
    h("button", { class: "fab", onClick: () => { const n = createNote({}); go("edit", n.id); } }, "＋ 新規メモ")
  );

  function renderListBody() {
    const qq = state.query.trim().toLowerCase();
    const items = state.notes
      .filter((n) => !qq || [n.title, n.customer, n.summary, n.transcript].join("\n").toLowerCase().includes(qq))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!items.length) {
      listBox.replaceChildren(h("div", { class: "empty" },
        state.notes.length ? "該当するメモがありません" : "メモはまだありません。「＋ 新規メモ」から追加できます。"));
      return;
    }
    listBox.replaceChildren(...items.map((n) => h("button", { class: "card item", onClick: () => go("edit", n.id) },
      h("div", { class: "t" }, n.title || "無題",
        n.summary ? h("span", { class: "badge ok" }, "要約あり") : h("span", { class: "badge" }, "未要約")),
      h("div", { class: "m" }, [n.customer, fmtDate(n.createdAt)].filter(Boolean).join(" ・ ")),
      h("div", { class: "s" }, (n.summary || n.transcript || "").slice(0, 200))
    )));
  }
  renderListBody();
}

function renderEdit(app) {
  const note = currentNote();
  setTopbar("メモ", () => go("list"), []);

  const field = (key) => (e) => { note[key] = e.target.value; touch(note); };

  const transcriptTa = h("textarea", {
    class: "tall", placeholder: "Recorderアプリ等の文字起こしを貼り付け", value: note.transcript,
    onInput: (e) => { note.transcript = e.target.value; touch(note); refreshClaude(); },
  });
  const summaryTa = h("textarea", {
    placeholder: note.mode === "external" ? "Claudeが返した要約を貼り付け" : "Recorderアプリの要約を貼り付け",
    value: note.summary, onInput: field("summary"),
  });

  const claudeBox = h("textarea", { class: "tall", readOnly: true });
  const counter = h("p", { class: "hint" });
  function refreshClaude() {
    claudeBox.value = buildClaudeText(note);
    counter.textContent = `${claudeBox.value.length.toLocaleString()} 文字`;
  }
  refreshClaude();

  const setMode = (mode) => { note.mode = mode; touch(note); render(); };
  const includeTranscript = h("input", { type: "checkbox", id: "inc-tr" });

  const externalCard = h("section", { class: "card" },
    h("h2", null, "② 外部AI(Claude)に要約を依頼"),
    h("p", { class: "hint" }, "下の内容をコピーしてClaudeに貼り付け、返ってきた要約を「③ 要約」に貼り付けてください。"),
    h("label", { class: "field" }, "Claudeに貼り付ける内容(要約用プロンプト + 文字起こし)"),
    claudeBox, counter,
    h("div", { class: "row" },
      h("button", { class: "btn primary grow", onClick: () => copyText(claudeBox.value, "プロンプト+文字起こしをコピーしました") }, "全文をコピー"),
      h("button", { class: "btn", onClick: () => copyText(state.settings.prompt.trim(), "プロンプトをコピーしました") }, "プロンプトのみ"),
      h("button", { class: "btn", onClick: () => copyText(note.transcript || "", "文字起こしをコピーしました") }, "文字起こしのみ"),
    ),
    h("div", { class: "row" },
      h("a", { class: "btn grow", href: CLAUDE_URL, target: "_blank", rel: "noopener", style: "text-align:center;text-decoration:none;line-height:28px" }, "Claudeを開く"),
      h("button", { class: "btn", onClick: () => go("settings") }, "プロンプトを編集"),
    )
  );

  app.replaceChildren(
    h("section", { class: "card" },
      h("label", { class: "field" }, "タイトル"),
      h("input", { type: "text", placeholder: "例: ○○社 見積フォロー", value: note.title, onInput: field("title") }),
      h("label", { class: "field" }, "顧客名"),
      h("input", { type: "text", placeholder: "例: 株式会社○○ 山田様", value: note.customer, onInput: field("customer") }),
      h("p", { class: "hint" }, `作成: ${fmtDate(note.createdAt)} ・ 入力内容は自動保存されます`)
    ),
    h("section", { class: "card" },
      h("h2", null, "① 文字起こし"),
      transcriptTa,
      h("div", { class: "row" },
        h("button", { class: "btn", onClick: () => pasteInto(transcriptTa, (t) => { note.transcript = t; touch(note); refreshClaude(); }) }, "貼り付け"),
        h("button", { class: "btn", onClick: () => copyText(note.transcript || "", "文字起こしをコピーしました") }, "コピー"),
      )
    ),
    h("section", { class: "card" },
      h("h2", null, "要約の方法"),
      h("div", { class: "seg" },
        h("button", { class: note.mode === "recorder" ? "on" : "", onClick: () => setMode("recorder") }, "Recorderの要約を使う"),
        h("button", { class: note.mode === "external" ? "on" : "", onClick: () => setMode("external") }, "使わない(外部AIに依頼)"),
      )
    ),
    note.mode === "external" ? externalCard : null,
    h("section", { class: "card" },
      h("h2", null, note.mode === "external" ? "③ 要約(Claudeの回答)" : "② 要約(Recorder)"),
      summaryTa,
      h("div", { class: "row" },
        h("button", { class: "btn", onClick: () => pasteInto(summaryTa, (t) => { note.summary = t; touch(note); }) }, "貼り付け"),
        h("button", { class: "btn", onClick: () => copyText(note.summary || "", "要約をコピーしました") }, "コピー"),
      )
    ),
    h("section", { class: "card" },
      h("h2", null, "Google Keepに保存"),
      h("p", { class: "hint" }, "共有先の一覧から「Keep」を選ぶと、ノートとして保存されます。"),
      h("label", { class: "check" }, includeTranscript, "文字起こしも含める"),
      h("div", { class: "row" },
        h("button", { class: "btn primary grow", onClick: () => shareToKeep(note, includeTranscript.checked) }, "Keepに共有"),
      )
    ),
    h("div", { class: "row" },
      h("button", { class: "btn danger", onClick: () => {
        if (confirm("このメモを削除しますか?")) {
          state.notes = state.notes.filter((n) => n.id !== note.id);
          save();
          go("list");
        }
      } }, "削除")
    )
  );
}

async function shareToKeep(note, withTranscript) {
  if (!(note.summary || "").trim() && !withTranscript) return toast("要約が空です");
  const text = buildShareText(note, withTranscript);
  if (navigator.share) {
    try {
      await navigator.share({ title: note.title || "通話メモ", text });
    } catch (e) {
      if (e.name !== "AbortError") toast("共有に失敗しました");
    }
  } else {
    await copyText(text, "コピーしました。Keepに貼り付けてください");
  }
}

function renderSettings(app) {
  setTopbar("設定", () => go("list"), []);
  const promptTa = h("textarea", {
    class: "tall", value: state.settings.prompt,
    onInput: (e) => { state.settings.prompt = e.target.value; save(); },
  });
  const fileInput = h("input", { type: "file", accept: "application/json", style: "display:none", onChange: importBackup });

  app.replaceChildren(
    h("section", { class: "card" },
      h("h2", null, "外部AI用の要約プロンプト"),
      h("p", { class: "hint" }, "「外部AIに依頼」時、このプロンプトの後ろに文字起こしを付けてコピーします。"),
      promptTa,
      h("div", { class: "row" },
        h("button", { class: "btn", onClick: () => {
          state.settings.prompt = DEFAULT_PROMPT; save(); promptTa.value = DEFAULT_PROMPT; toast("初期値に戻しました");
        } }, "初期値に戻す")
      )
    ),
    h("section", { class: "card" },
      h("h2", null, "バックアップ"),
      h("p", { class: "hint" }, "データはこの端末のブラウザ内にのみ保存されます。機種変更やデータ削除に備え、定期的に書き出してください。"),
      h("div", { class: "row" },
        h("button", { class: "btn", onClick: exportBackup }, "書き出し(JSON)"),
        h("button", { class: "btn", onClick: () => fileInput.click() }, "読み込み"),
        fileInput
      )
    )
  );
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ notes: state.notes, settings: state.settings }, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `call-memo-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.notes)) throw new Error("invalid");
    const known = new Set(state.notes.map((n) => n.id));
    const added = data.notes.filter((n) => n && n.id && !known.has(n.id));
    state.notes.push(...added);
    if (data.settings && typeof data.settings.prompt === "string") state.settings.prompt = data.settings.prompt;
    save();
    toast(`${added.length}件を読み込みました`);
    render();
  } catch (_) {
    toast("読み込みに失敗しました(ファイル形式を確認してください)");
  }
}

/* ---------- startup ---------- */

function handleIncomingShare() {
  const p = new URLSearchParams(location.search);
  const text = [p.get("text"), p.get("url")].filter(Boolean).join("\n").trim();
  const title = (p.get("title") || "").trim();
  if (!text && !title) return false;
  const note = createNote({ title, transcript: text });
  history.replaceState(null, "", location.pathname);
  state.view = "edit";
  state.currentId = note.id;
  toast("共有された内容を文字起こしに取り込みました");
  return true;
}

load();
handleIncomingShare();
render();

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
