const PRESET_HINTS = {
  small: 'O menor arquivo possível. Fotos podem perder um pouco de nitidez se ampliadas. Ótimo para WhatsApp e e-mail.',
  balanced: 'Recomendado. Reduz bastante sem diferença visível na tela.',
  high: 'Reduz menos, mantendo fotos nítidas para imprimir ou projetar.',
};
const PRESET_NAMES = { small: 'Menor tamanho', balanced: 'Equilibrado', high: 'Alta qualidade' };
const STORAGE_KEY = 'compacta-pdf:preset';

const $ = (sel) => document.querySelector(sel);
const dropzone = $('#dropzone');
const fileInput = $('#file-input');
const hint = $('#preset-hint');
const engineStatus = $('#engine-status');
const results = $('#results');
const list = $('#file-list');
const downloadAllBtn = $('#download-all');
const rowTemplate = $('#row-template');

const sizeFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
// Decimal units, matching what macOS Finder shows.
const formatSize = (bytes) => {
  if (bytes < 1e6) return `${sizeFormat.format(Math.max(bytes / 1e3, 0.1))} KB`;
  if (bytes < 1e9) return `${sizeFormat.format(bytes / 1e6)} MB`;
  return `${sizeFormat.format(bytes / 1e9)} GB`;
};

/** @type {Array<{id:number,file:File,preset:string,status:string,page:number,totalPages:number,blob?:Blob,outName?:string,kept?:boolean,error?:string,el:HTMLElement}>} */
const jobs = [];
let nextId = 1;
let worker = null;
let engineReady = false;
let activeJob = null;

// ---------- preset ----------

function currentPreset() {
  return document.querySelector('input[name="preset"]:checked').value;
}

function setPresetHint() {
  hint.textContent = PRESET_HINTS[currentPreset()];
  jobs.forEach(render);
}

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  const input = saved && document.querySelector(`input[name="preset"][value="${saved}"]`);
  if (input) input.checked = true;
} catch { /* storage unavailable */ }

document.querySelectorAll('input[name="preset"]').forEach((input) =>
  input.addEventListener('change', () => {
    try { localStorage.setItem(STORAGE_KEY, currentPreset()); } catch { /* ignore */ }
    setPresetHint();
  }),
);
setPresetHint();

// ---------- worker ----------

function startWorker() {
  engineReady = false;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'ready':
        engineReady = true;
        engineStatus.textContent = '';
        pump();
        break;
      case 'fatal':
        engineStatus.textContent = 'Não foi possível carregar o compactador. Verifique a internet e recarregue a página.';
        engineStatus.classList.add('is-error');
        break;
      case 'progress': {
        const job = findJob(data.id);
        if (!job) return;
        job.page = data.page;
        job.totalPages = data.totalPages;
        render(job);
        break;
      }
      case 'done': {
        const job = findJob(data.id);
        activeJob = null;
        if (job) finishJob(job, data.buffer);
        pump();
        break;
      }
      case 'error': {
        const job = findJob(data.id);
        activeJob = null;
        if (job) {
          job.status = 'error';
          job.error = data.message;
          render(job);
        }
        pump();
        break;
      }
    }
  };
  worker.onerror = () => {
    // A crash (e.g. out of memory) kills the worker; fail the current job and start fresh.
    if (activeJob) {
      activeJob.status = 'error';
      activeJob.error = 'O arquivo é grande demais para este navegador. Tente fechar outras abas e tentar de novo.';
      render(activeJob);
      activeJob = null;
    }
    worker.terminate();
    startWorker();
  };
}

function restartWorker() {
  worker.terminate();
  activeJob = null;
  startWorker();
}

async function pump() {
  if (!engineReady || activeJob) return;
  const job = jobs.find((j) => j.status === 'queued');
  if (!job) return;
  activeJob = job;
  job.status = 'working';
  job.page = 0;
  job.totalPages = 0;
  render(job);
  try {
    const buffer = await job.file.arrayBuffer();
    if (activeJob !== job) return; // cancelled while reading
    worker.postMessage({ type: 'compress', id: job.id, buffer, preset: job.preset }, [buffer]);
  } catch {
    job.status = 'error';
    job.error = 'Não foi possível ler este arquivo.';
    activeJob = null;
    render(job);
    pump();
  }
}

function finishJob(job, buffer) {
  const base = job.file.name.replace(/\.pdf$/i, '');
  if (buffer.byteLength >= job.file.size) {
    job.blob = job.file;
    job.kept = true;
    job.outName = job.file.name;
  } else {
    job.blob = new Blob([buffer], { type: 'application/pdf' });
    job.kept = false;
    job.outName = `${base} (compactado).pdf`;
  }
  job.status = 'done';
  render(job);
}

// ---------- jobs ----------

const findJob = (id) => jobs.find((j) => j.id === id);
const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

function addFiles(fileList) {
  const files = [...fileList];
  const pdfs = files.filter(isPdf);
  const skipped = files.length - pdfs.length;
  for (const file of pdfs) {
    const el = rowTemplate.content.firstElementChild.cloneNode(true);
    const job = { id: nextId++, file, preset: currentPreset(), status: 'queued', page: 0, totalPages: 0, el };
    jobs.push(job);
    list.append(el);
    render(job);
  }
  if (skipped) {
    engineStatus.classList.remove('is-error');
    engineStatus.textContent = skipped === 1
      ? 'Um arquivo foi ignorado porque não é PDF.'
      : `${skipped} arquivos foram ignorados porque não são PDF.`;
  }
  updateChrome();
  pump();
}

function removeJob(job) {
  if (activeJob === job) restartWorker();
  jobs.splice(jobs.indexOf(job), 1);
  job.el.remove();
  updateChrome();
  pump();
}

function redoJob(job) {
  job.status = 'queued';
  job.preset = currentPreset();
  job.blob = undefined;
  job.error = undefined;
  render(job);
  updateChrome();
  pump();
}

function download(job) {
  const url = URL.createObjectURL(job.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = job.outName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function updateChrome() {
  results.hidden = jobs.length === 0;
  downloadAllBtn.hidden = jobs.filter((j) => j.status === 'done').length < 2;
}

// ---------- rendering ----------

function button(label, className, onClick, ariaLabel) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${className}`;
  b.textContent = label;
  if (ariaLabel) b.setAttribute('aria-label', ariaLabel);
  b.addEventListener('click', onClick);
  return b;
}

function render(job) {
  const { el, file } = job;
  el.querySelector('.file-name').textContent = file.name;
  el.querySelector('.file-name').title = file.name;
  el.classList.toggle('is-error', job.status === 'error');

  const meta = el.querySelector('.file-meta');
  const progress = el.querySelector('.progress');
  const bar = el.querySelector('.progress-bar');
  const actions = el.querySelector('.file-actions');
  actions.replaceChildren();
  progress.hidden = true;

  const original = formatSize(file.size);
  const remove = button('✕', 'ghost icon', () => removeJob(job), 'Remover');

  switch (job.status) {
    case 'queued':
      meta.textContent = `${original} · na fila`;
      actions.append(button('Cancelar', 'ghost', () => removeJob(job)));
      break;
    case 'working': {
      progress.hidden = false;
      const known = job.totalPages > 0;
      progress.classList.toggle('is-indeterminate', !known);
      bar.style.width = known ? `${Math.round((job.page / job.totalPages) * 100)}%` : '';
      meta.textContent = known
        ? `${original} · compactando página ${Math.max(job.page, 1)} de ${job.totalPages}…`
        : `${original} · lendo o arquivo…`;
      actions.append(button('Cancelar', 'ghost', () => removeJob(job)));
      break;
    }
    case 'done': {
      if (job.kept) {
        meta.textContent = `${original} · já estava otimizado, mantido o original`;
      } else {
        const saved = Math.round((1 - job.blob.size / file.size) * 100);
        meta.replaceChildren(
          `${original} → ${formatSize(job.blob.size)} · `,
          Object.assign(document.createElement('strong'), { textContent: `${saved}% menor` }),
        );
      }
      if (job.preset !== currentPreset()) {
        actions.append(button('Refazer', 'ghost', () => redoJob(job), `Compactar de novo em ${PRESET_NAMES[currentPreset()]}`));
      }
      actions.append(button('Baixar', 'primary', () => download(job)), remove);
      break;
    }
    case 'error':
      meta.textContent = job.error;
      actions.append(button('Tentar de novo', 'ghost', () => redoJob(job)), remove);
      break;
  }
  updateChrome();
}

// ---------- inputs ----------

fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  dropzone.classList.add('is-over');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropzone.classList.remove('is-over');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove('is-over');
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

$('#clear-all').addEventListener('click', () => {
  if (activeJob) restartWorker();
  jobs.splice(0).forEach((j) => j.el.remove());
  updateChrome();
});

downloadAllBtn.addEventListener('click', async () => {
  for (const job of jobs.filter((j) => j.status === 'done')) {
    download(job);
    await new Promise((r) => setTimeout(r, 400));
  }
});

window.addEventListener('beforeunload', (e) => {
  if (jobs.some((j) => j.status === 'working' || j.status === 'queued')) e.preventDefault();
});

// ---------- start ----------

startWorker();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
