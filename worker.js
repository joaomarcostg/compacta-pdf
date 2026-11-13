// Runs Ghostscript (compiled to WebAssembly) off the main thread.
// Each job gets a fresh Ghostscript instance; the compiled wasm module is reused.
import loadGhostscript from './vendor/ghostscript/gs.js';

const WASM_URL = new URL('./vendor/ghostscript/gs.wasm', import.meta.url);

const PRESETS = {
  small: { dpi: 90, jpegQ: 65 },
  balanced: { dpi: 110, jpegQ: 75 },
  high: { dpi: 150, jpegQ: 82 },
};

const wasmModulePromise = (async () => {
  const res = await fetch(WASM_URL);
  if (!res.ok) throw new Error(`Falha ao baixar o compactador (${res.status})`);
  try {
    return await WebAssembly.compileStreaming(res.clone());
  } catch {
    // Some servers send the wrong MIME type for .wasm; fall back to compiling the bytes.
    return WebAssembly.compile(await res.arrayBuffer());
  }
})();

wasmModulePromise.then(
  () => postMessage({ type: 'ready' }),
  (err) => postMessage({ type: 'fatal', message: String(err?.message || err) }),
);

function ghostscriptArgs(preset) {
  const { dpi, jpegQ } = PRESETS[preset] || PRESETS.balanced;
  return [
    '-dNOPAUSE', '-dBATCH', '-dSAFER',
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    '-dSubsetFonts=true',
    '-dDownsampleColorImages=true',
    '-dColorImageDownsampleType=/Bicubic',
    `-dColorImageResolution=${dpi}`,
    '-dColorImageDownsampleThreshold=1.0',
    '-dDownsampleGrayImages=true',
    '-dGrayImageDownsampleType=/Bicubic',
    `-dGrayImageResolution=${dpi}`,
    '-dGrayImageDownsampleThreshold=1.0',
    '-dDownsampleMonoImages=true',
    '-dMonoImageResolution=300',
    '-dAutoFilterColorImages=false',
    '-dColorImageFilter=/DCTEncode',
    '-dAutoFilterGrayImages=false',
    '-dGrayImageFilter=/DCTEncode',
    `-dJPEGQ=${jpegQ}`,
    '-sOutputFile=/output.pdf',
    '/input.pdf',
  ];
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'compress') return;
  const { id, buffer, preset } = data;
  const log = [];
  let totalPages = 0;

  const onLine = (line) => {
    log.push(line);
    const range = /Processing pages (\d+) through (\d+)/.exec(line);
    if (range) {
      totalPages = Number(range[2]);
      postMessage({ type: 'progress', id, page: 0, totalPages });
      return;
    }
    const page = /^Page (\d+)/.exec(line);
    if (page && totalPages) {
      postMessage({ type: 'progress', id, page: Number(page[1]), totalPages });
    }
  };

  try {
    const wasmModule = await wasmModulePromise;
    const gs = await loadGhostscript({
      print: onLine,
      printErr: onLine,
      instantiateWasm(imports, done) {
        WebAssembly.instantiate(wasmModule, imports).then((instance) => done(instance, wasmModule));
        return {};
      },
    });

    gs.FS.writeFile('/input.pdf', new Uint8Array(buffer));

    let exitCode = 0;
    try {
      exitCode = gs.callMain(ghostscriptArgs(preset));
    } catch (err) {
      exitCode = typeof err?.status === 'number' ? err.status : 1;
      if (typeof err?.status !== 'number') log.push(String(err?.message || err));
    }

    let output = null;
    try {
      output = gs.FS.readFile('/output.pdf');
    } catch {
      /* no output written */
    }

    if (exitCode !== 0 || !output || output.length === 0) {
      postMessage({ type: 'error', id, message: describeFailure(log) });
      return;
    }

    const out = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    postMessage({ type: 'done', id, buffer: out, totalPages }, [out]);
  } catch (err) {
    postMessage({ type: 'error', id, message: describeFailure(log, err) });
  }
};

function describeFailure(log, err) {
  const text = log.join('\n').toLowerCase();
  if (text.includes('password')) {
    return 'Este PDF é protegido por senha. Remova a senha e tente de novo.';
  }
  if (err && /memory|out of bounds|allocation/i.test(String(err?.message || err))) {
    return 'O arquivo é grande demais para este navegador. Tente fechar outras abas ou usar outro navegador.';
  }
  return 'Não foi possível compactar este arquivo. Ele pode estar corrompido ou não ser um PDF válido.';
}
