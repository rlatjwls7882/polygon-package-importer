import { t } from '../i18n.js';
import { readJob, stageJob, clearJob, claimJob, releaseJob, STATUS_KEY } from '../storage/jobs.js';
import { CREDENTIAL_KEY } from '../storage/credentials.js';

const OFFSCREEN_PAGE = 'offscreen.html';
let opening = null;
let commands = Promise.resolve();
let closeTimer = null;

function serialize(action) {
  const result = commands.then(action, action);
  commands = result.catch(() => {});
  return result;
}

function cancelClose() {
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = null;
}

function closeWhenIdle(jobId, attempt) {
  cancelClose();
  closeTimer = setTimeout(() => serialize(async () => {
    const status = await readStatus();
    if (status?.id === jobId && status.attempt === attempt && status.phase !== 'running')
      await chrome.offscreen.closeDocument().catch(() => {});
  }).catch(() => {}), 800);
}

async function offscreenOpen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes:['OFFSCREEN_DOCUMENT'],
    documentUrls:[chrome.runtime.getURL(OFFSCREEN_PAGE)]
  });
  return contexts.length > 0;
}

async function openOffscreen() {
  if (await offscreenOpen()) return;
  opening ||= chrome.offscreen.createDocument({
    url:OFFSCREEN_PAGE,
    reasons:['DOM_PARSER'],
    justification:'Read ZIP files and upload them after the popup closes.'
  }).finally(() => { opening = null; });
  await opening;
}

async function readStatus() {
  return (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] ?? null;
}

async function saveStatus(status) {
  const next = {...status, updatedAt:Date.now()};
  await chrome.storage.local.set({[STATUS_KEY]:next});
  return next;
}

async function getStatus() {
  let status = await readStatus();
  if (status?.phase === 'running' && !(await offscreenOpen())) {
    status = await saveStatus({...status, phase:'error',
      message:t('backgroundUploadInterruptedYouCanRetry')});
  }
  const job = await readJob();
  // A worker may have stopped after claiming the ZIP but before saving status.
  if (job?.locked && (status?.id !== job.id || status?.phase !== 'running'))
    await releaseJob(job.id);
  return status;
}

async function startImport(jobId) {
  let prepared = false, claimed = false;
  try {
    const previous = await getStatus();
    if (previous?.phase === 'running') throw Error(t('backgroundAnUploadIsAlreadyRunning'));

    const credentials = (await chrome.storage.local.get(CREDENTIAL_KEY))[CREDENTIAL_KEY];
    if (!credentials) throw Error(t('backgroundRegisterYourApiKeysFirst'));
    let job = await claimJob(jobId);
    claimed = true;
    // Migrate failed create jobs saved by older versions so Retry doesn't
    // create another Polygon problem when the original ID is already known.
    const resumeId = String(previous?.problemId ?? '');
    if (job.mode === 'create' && previous?.id === job.id &&
        previous.phase === 'error' && previous.partial &&
        /^[1-9]\d{0,11}$/.test(resumeId)) {
      job = {...job, mode:'replace', problemId:resumeId};
      await stageJob(job, jobId);
    }

    cancelClose();
    // Completion has been recorded, but the previous offscreen page may still
    // be releasing its ZIP. Never run a new attempt in that old page.
    if (await offscreenOpen()) await chrome.offscreen.closeDocument();
    const attempt = crypto.randomUUID();
    await saveStatus({
      id:job.id, attempt, phase:'running', progress:0,
      filename:job.filename, mode:job.mode,
      problemId:job.mode === 'replace' ? job.problemId : null,
      message:t('backgroundPreparingUpload'), log:[t('backgroundPreparingUpload')]
    });
    prepared = true;
    await openOffscreen();
    const reply = await chrome.runtime.sendMessage({
      type:'IMPORT_EXECUTE', jobId, attempt, encryptedRecord:credentials,
      locale:chrome.i18n.getMessage('@@ui_locale')
    });
    if (!reply?.ok) throw Error(reply?.reason || t('backgroundFailedToStartUpload'));
    return {ok:true};
  } catch (error) {
    if (prepared) {
      await saveStatus({...await readStatus(), phase:'error',
        message:error?.message || t('backgroundUploadCouldNotStart')});
    }
    if (claimed) await releaseJob(jobId);
    throw error;
  }
}

async function updateStatus(message) {
  const current = await readStatus();
  if (!current || current.id !== message.jobId || current.phase !== 'running' ||
      current.attempt !== message.attempt)
    return {ok:false};

  const done = message.type === 'IMPORT_COMPLETE';
  if (done && !['done','error'].includes(message.phase)) return {ok:false};
  const text = String(message.message || '').slice(0, 350);
  await saveStatus({
    ...current,
    phase:done ? message.phase : 'running',
    message:text,
    log:[...(current.log || []), text].slice(-12),
    progress:Number.isFinite(message.progress) ? message.progress : current.progress,
    ...(message.problemId ? {problemId:message.problemId} : {}),
    ...(message.partial ? {partial:true} : {}),
    ...(message.committed ? {committed:true} : {}),
    ...(['uploading','uploaded','verifying','verified','verification-failed','upload-failed'].includes(message.stage) ? {stage:message.stage} : {}),
    ...(message.verification ? {verification:message.verification} : {})
  });
  if (done) await releaseJob(current.id);
  return {ok:true};
}

async function clearStatus() {
  if ((await getStatus())?.phase === 'running') throw Error(t('backgroundCannotClearARunningUpload'));
  await clearJob();
  await chrome.storage.local.remove(STATUS_KEY);
  return {ok:true};
}

function respond(promise, callback) {
  promise.then(callback, error =>
    callback({ok:false, error:String(error?.message || error)}));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  switch (message?.type) {
    case 'IMPORT_START':
      return respond(serialize(() => startImport(message.jobId)), reply);
    case 'IMPORT_QUERY':
      return respond(serialize(async () => ({ok:true, status:await getStatus()})), reply);
    case 'IMPORT_CLEAR':
      return respond(serialize(clearStatus), reply);
    case 'IMPORT_PROGRESS':
    case 'IMPORT_COMPLETE':
      if (sender.url !== chrome.runtime.getURL(OFFSCREEN_PAGE)) {
        reply({ok:false});
        return;
      }
      return respond(serialize(async () => {
        const result = await updateStatus(message);
        if (result.ok && message.type === 'IMPORT_COMPLETE')
          closeWhenIdle(message.jobId, message.attempt);
        return result;
      }), reply);
  }
});
