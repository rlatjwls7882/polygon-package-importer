import { t, localizePage } from '../i18n.js';
import { ZipArchive, MAX_ZIP_SIZE } from '../package/zip.js';
import { loadPolygonPackage } from '../package/load.js';
import { CredentialsUI } from './credentials.js';
import { stageJob, readJob, STATUS_KEY } from '../storage/jobs.js';

const $ = id => document.getElementById(id);
let file = null;
let analysisId = 0;
let validPackage = false;
let credentialsUI = null;
let showCredentials = false;
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
  const authorized = credentialsUI?.state === 'ready';
  const showingCredentials = !authorized || showCredentials || !!credentialsUI?.editing;
  $('credentialPanel').hidden = !showingCredentials;
  $('importForm').hidden = showingCredentials;
  $('settings').hidden = !authorized || showingCredentials;
  $('closeCredentials').hidden = !authorized || !showingCredentials;
  $('credentialTitle').textContent = credentialsUI?.editing ? t('popupChangeApiKeys') :
    authorized ? t('popupManageApiKeys') : credentialsUI?.state === 'legacy' ? t('popupMigrateApiKeys') : t('popupAddApiKeys');

  $('problemIdField').hidden = mode() !== 'replace';
  const validId = mode() === 'create' || /^[1-9]\d{0,11}$/.test(problemId());
  const busy = pending || status?.phase === 'running';
  for (const id of ['zipFile', 'problemId', 'commit', 'verify', 'retry', 'clearStatus']) $(id).disabled = busy;
  for (const input of document.querySelectorAll('input[name="mode"]')) input.disabled = busy;
  $('start').disabled = !authorized || !file || !validPackage || !validId ||
    pending || status?.phase === 'running';

  $('progressSection').hidden = !status || showingCredentials;
  if (!status) return;

  const labels = {running:t('popupRunning'), done:t('popupDone'), error:t('popupFailed')};
  const label = labels[status.phase] || t('popupWaiting');
  const message = status.message || '';
  $('stateLabel').textContent = message.startsWith(label) ? message :
    [label, message].filter(Boolean).join(' · ');
  $('jobSummary').textContent = [
    status.filename,
    status.problemId ? '#' + status.problemId : '',
    status.committed ? t('verifyCommitted') : ''
  ].filter(Boolean).join(' · ');
  $('log').textContent = (status.log || []).join('\n');
  $('clearStatus').hidden = status.phase === 'running';
  $('jobActions').hidden = status.phase !== 'error' || savedJob?.id !== status.id;
}

async function refresh() {
  const reply = await chrome.runtime.sendMessage({type:'IMPORT_QUERY'});
  if (!reply?.ok) throw Error(reply?.error || t('popupCouldNotCheckJobStatus'));
  status = reply.status;
  savedJob = await readJob();
  render();
}

function openCredentials() {
  showCredentials = true;
  errorText();
  render();
}

async function closeCredentials() {
  if (credentialsUI?.pending) return;
  if (credentialsUI?.editing) await credentialsUI.cancel();
  if (credentialsUI?.state !== 'ready') return;
  showCredentials = false;
  errorText();
  render();
}

async function analyze() {
  const requestId = ++analysisId;
  errorText();
  validPackage = false;
  file = $('zipFile').files?.[0] || null;
  if (!file) {
    $('packageInfo').textContent = t('popupSelectAZipFile');
  } else if (file.size > MAX_ZIP_SIZE) {
    file = null;
    $('packageInfo').textContent = t('popupSelectAZipSmallerThan100Mb');
  } else {
    $('packageInfo').textContent = t('popupAnalyzing');
    render();
    try {
      const archive = await ZipArchive.fromFile(file);
      if (requestId !== analysisId) return;
      const plan = await loadPolygonPackage(archive);
      if (requestId !== analysisId) return;
      if (plan.unsupported.length) throw Error(plan.unsupported.join('; '));
      const details = [t('popupTestsSolutions', plan.name, plan.tests.length, plan.solutions.length)];
      if (plan.info.runTwice) details.push(t('packageModeTwoStep'));
      if (plan.info.interactive) details.push(plan.info.runTwice ?
        (plan.info.interactiveSecondRun ? t('packageModeInteractiveBoth') : t('packageModeInteractiveFirst')) :
        t('packageModeInteractive'));
      if (plan.groups.length) details.push(t('packageGroupCount', plan.groups.length));
      $('packageInfo').textContent = details.join(' · ');
      validPackage = true;
    } catch (error) {
      if (requestId !== analysisId) return;
      $('packageInfo').textContent = t('popupInvalidPackage');
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
      if (!job || job.id !== status?.id) throw Error(t('popupNoJobAvailableToRetry'));
    } else {
      if (!file || !validPackage) throw Error(t('popupSelectAZipFirst'));
      // Freeze the exact selection before the first asynchronous operation.
      job = {
        id:crypto.randomUUID(), file, filename:file.name,
        mode:mode(), problemId:mode() === 'replace' ? problemId() : null,
        commit:$('commit').checked, verify:$('verify').checked
      };
      const latest = await chrome.runtime.sendMessage({type:'IMPORT_QUERY'});
      if (!latest?.ok) throw Error(latest?.error || t('popupCouldNotCheckJobStatus'));
      if (latest.status?.phase === 'running') throw Error(t('popupAnotherUploadIsRunning'));
      await stageJob(job);
    }
    savedJob = job;
    const result = await chrome.runtime.sendMessage({type:'IMPORT_START', jobId:job.id});
    if (!result?.ok) throw Error(result?.error || t('popupCouldNotStartUpload'));
  } catch (error) {
    errorText(error?.message || error);
  } finally {
    await refresh().catch(() => {});
    pending = false;
    render();
  }
}

async function initialize() {
  localizePage();
  $('settings').addEventListener('click', openCredentials);
  $('closeCredentials').addEventListener('click', closeCredentials);
  $('zipFile').addEventListener('change', analyze);
  for (const input of document.querySelectorAll('input[name="mode"]'))
    input.addEventListener('change', render);
  $('problemId').addEventListener('input', render);
  $('commit').addEventListener('change', () => { if (!$('commit').checked) $('verify').checked = false; render(); });
  $('verify').addEventListener('change', () => { if ($('verify').checked) $('commit').checked = true; render(); });
  $('start').addEventListener('click', () => start());
  $('retry').addEventListener('click', () => start(true));
  $('clearStatus').addEventListener('click', async () => {
    const reply = await chrome.runtime.sendMessage({type:'IMPORT_CLEAR'});
    if (reply?.ok) {
      errorText();
      await refresh();
    } else errorText(reply?.error || t('popupCouldNotClearTheJob'));
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STATUS_KEY]) return;
    status = changes[STATUS_KEY].newValue || null;
    render();
  });

  try {
    credentialsUI = new CredentialsUI();
    credentialsUI.onChange = render;
    credentialsUI.onAccepted = () => {
      showCredentials = false;
      errorText();
      render();
    };
    await credentialsUI.init();
    await refresh();
  } catch (error) {
    errorText(error?.message || error);
  }
  render();
}

initialize();
