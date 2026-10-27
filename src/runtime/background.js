import { t } from '../i18n.js';
import { readJob, stageJob, clearJob, STATUS_KEY } from '../storage/jobs.js';
import { CREDENTIAL_KEY } from '../storage/credentials.js';

const OFFSCREEN_PAGE = 'offscreen.html';
let opening = null;
let starting = false;

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
  const status = await readStatus();
  if (status?.phase === 'running' && !starting && !(await offscreenOpen())) {
    return saveStatus({...status, phase:'error',
      message:t('backgroundUploadInterruptedYouCanRetry')});
  }
  return status;
}

async function startImport(jobId) {
  if (starting) throw Error(t('backgroundAnotherUploadIsBeingPrepared'));
  starting = true;
  let prepared = false;
  try {
    const previous = await getStatus();
    if (previous?.phase === 'running') throw Error(t('backgroundAnUploadIsAlreadyRunning'));

    let job = await readJob();
    if (job?.id !== jobId) throw Error(t('backgroundSelectedZipNotFound'));
    // Migrate failed create jobs saved by older versions so Retry doesn't
    // create another Polygon problem when the original ID is already known.
    const resumeId = String(previous?.problemId ?? '');
    if (job.mode === 'create' && previous?.id === job.id &&
        previous.phase === 'error' && previous.partial &&
        /^[1-9]\d{0,11}$/.test(resumeId)) {
      job = {...job, mode:'replace', problemId:resumeId};
      await stageJob(job);
    }

    const credentials = (await chrome.storage.local.get(CREDENTIAL_KEY))[CREDENTIAL_KEY];
    if (!credentials) throw Error(t('backgroundRegisterYourApiKeysFirst'));

    await saveStatus({
      id:job.id, phase:'running', progress:0,
      filename:job.filename, mode:job.mode,
      problemId:job.mode === 'replace' ? job.problemId : null,
      message:t('backgroundPreparingUpload'), log:[t('backgroundPreparingUpload')]
    });
    prepared = true;
    await openOffscreen();
    const reply = await chrome.runtime.sendMessage({
      type:'IMPORT_EXECUTE', jobId, encryptedRecord:credentials,
      locale:chrome.i18n.getMessage('@@ui_locale')
    });
    if (!reply?.ok) throw Error(reply?.reason || t('backgroundFailedToStartUpload'));
    return {ok:true};
  } catch (error) {
    if (prepared) {
      await saveStatus({...await readStatus(), phase:'error',
        message:error?.message || t('backgroundUploadCouldNotStart')});
    }
    throw error;
  } finally {
    starting = false;
  }
}

async function updateStatus(message) {
  const current = await readStatus();
  if (!current || current.id !== message.jobId || current.phase !== 'running')
    return {ok:false};

  const done = message.type === 'IMPORT_COMPLETE';
  const text = String(message.message || '').slice(0, 350);
  await saveStatus({
    ...current,
    phase:done ? message.phase : 'running',
    message:text,
    log:[...(current.log || []), text].slice(-12),
    progress:Number.isFinite(message.progress) ? message.progress : current.progress,
    ...(message.problemId ? {problemId:message.problemId} : {}),
    ...(message.partial ? {partial:true} : {})
  });
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
      return respond(startImport(message.jobId), reply);
    case 'IMPORT_QUERY':
      return respond(getStatus().then(status => ({ok:true, status})), reply);
    case 'IMPORT_CLEAR':
      return respond(clearStatus(), reply);
    case 'IMPORT_PROGRESS':
    case 'IMPORT_COMPLETE':
      if (!sender.url?.startsWith(chrome.runtime.getURL(OFFSCREEN_PAGE))) {
        reply({ok:false});
        return;
      }
      return respond(updateStatus(message).then(result => {
        if (result.ok && message.type === 'IMPORT_COMPLETE') {
          setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 800);
        }
        return result;
      }), reply);
  }
});
