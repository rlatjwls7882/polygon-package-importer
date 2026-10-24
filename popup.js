import { ZipArchive } from './zip.js';
import { loadPolygonPackage } from './model.js';
import { loadCredentials } from './credential-store.js';
import { stageJob, readJob } from './job-store.js';
import { STATUS_KEY } from './status.js';

const $ = id => document.getElementById(id);
const MAX_ZIP_SIZE = 100 * 1024 * 1024;
let file = null;
let validPackage = false;
let authorized = false;
let pending = false;
let status = null;
let savedJob = null;

const mode = () => document.querySelector('input[name="mode"]:checked').value;
const problemId = () => $('problemId').value.trim();

function errorText(message = '') {
  $('error').textContent = String(message);
  $('error').hidden = !message;
}

function render() {
  $('problemIdField').hidden = mode() !== 'replace';
  const validId = mode() === 'create' || /^[1-9]\d{0,11}$/.test(problemId());
  $('start').disabled = !authorized || !file || !validPackage || !validId ||
    pending || status?.phase === 'running';

  $('progressSection').hidden = !status;
  if (!status) return;

  const labels = {running:'진행 중', done:'완료', error:'실패'};
  const label = labels[status.phase] || '대기 중';
  const message = status.message || '';
  $('stateLabel').textContent = message.startsWith(label) ? message :
    [label, message].filter(Boolean).join(' · ');
  $('jobSummary').textContent = [
    status.filename,
    status.problemId ? '#' + status.problemId : ''
  ].filter(Boolean).join(' · ');
  $('log').textContent = (status.log || []).join('\n');
  $('clearStatus').hidden = status.phase === 'running';
  $('jobActions').hidden = status.phase !== 'error' || savedJob?.id !== status.id;
}

async function refresh() {
  const reply = await chrome.runtime.sendMessage({type:'IMPORT_QUERY'});
  if (!reply?.ok) throw Error(reply?.error || '작업 상태를 확인할 수 없습니다.');
  status = reply.status;
  savedJob = await readJob();
  render();
}

async function openOptions() {
  await chrome.runtime.openOptionsPage();
  window.close();
}

async function analyze() {
  errorText();
  validPackage = false;
  file = $('zipFile').files?.[0] || null;
  if (!file) {
    $('packageInfo').textContent = 'ZIP 파일을 선택하세요.';
  } else if (file.size > MAX_ZIP_SIZE) {
    file = null;
    $('packageInfo').textContent = '100MB 이하의 ZIP을 선택하세요.';
  } else {
    $('packageInfo').textContent = '분석 중…';
    render();
    try {
      const archive = await ZipArchive.fromFile(file);
      const plan = await loadPolygonPackage(archive);
      if (plan.unsupported.length) throw Error(plan.unsupported.join('; '));
      $('packageInfo').textContent =
        plan.name + ' · 테스트 ' + plan.tests.length + '개 · 솔루션 ' + plan.solutions.length + '개';
      validPackage = true;
    } catch (error) {
      $('packageInfo').textContent = '패키지 오류';
      errorText(error?.message || error);
    }
  }
  render();
}

async function start(retry = false) {
  if (pending || status?.phase === 'running') return;
  pending = true;
  errorText();
  render();
  try {
    let job;
    if (retry) {
      job = await readJob();
      if (!job || job.id !== status?.id) throw Error('재시도할 작업이 없습니다.');
    } else {
      if (!file || !validPackage) throw Error('먼저 ZIP을 선택하세요.');
      const latest = await chrome.runtime.sendMessage({type:'IMPORT_QUERY'});
      if (!latest?.ok) throw Error(latest?.error || '작업 상태를 확인할 수 없습니다.');
      if (latest.status?.phase === 'running') throw Error('다른 업로드가 진행 중입니다.');
      job = {
        id:crypto.randomUUID(), file, filename:file.name,
        mode:mode(), problemId:mode() === 'replace' ? problemId() : null,
        commit:$('commit').checked
      };
      await stageJob(job);
    }
    savedJob = job;
    const result = await chrome.runtime.sendMessage({type:'IMPORT_START', jobId:job.id});
    if (!result?.ok) throw Error(result?.error || '업로드를 시작하지 못했습니다.');
  } catch (error) {
    errorText(error?.message || error);
  } finally {
    await refresh().catch(() => {});
    pending = false;
    render();
  }
}

async function initialize() {
  $('settings').addEventListener('click', openOptions);
  $('openSetup').addEventListener('click', openOptions);
  $('zipFile').addEventListener('change', analyze);
  for (const input of document.querySelectorAll('input[name="mode"]'))
    input.addEventListener('change', render);
  $('problemId').addEventListener('input', render);
  $('start').addEventListener('click', () => start());
  $('retry').addEventListener('click', () => start(true));
  $('clearStatus').addEventListener('click', async () => {
    const reply = await chrome.runtime.sendMessage({type:'IMPORT_CLEAR'});
    if (reply?.ok) {
      errorText();
      await refresh();
    } else errorText(reply?.error || '작업을 지우지 못했습니다.');
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STATUS_KEY]) return;
    status = changes[STATUS_KEY].newValue || null;
    render();
  });

  try {
    authorized = !!(await loadCredentials()).credentials;
    $('importForm').hidden = !authorized;
    $('needSetup').hidden = authorized;
    if (authorized) await refresh();
    else await openOptions();
  } catch (error) {
    $('importForm').hidden = true;
    $('needSetup').hidden = false;
    errorText(error?.message || error);
  }
  render();
}

initialize();
