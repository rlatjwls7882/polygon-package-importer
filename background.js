import { readJob, clearJob } from './job-store.js';
import { CREDENTIAL_KEY } from './credential-store.js';
import { STATUS_KEY } from './status.js';

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
      message:'업로드가 중단됐습니다. 다시 시도할 수 있습니다.'});
  }
  return status;
}

async function startImport(jobId) {
  if (starting) throw Error('다른 업로드를 준비 중입니다.');
  starting = true;
  let prepared = false;
  try {
    if ((await getStatus())?.phase === 'running') throw Error('이미 업로드 중입니다.');

    const job = await readJob();
    if (job?.id !== jobId) throw Error('선택한 ZIP을 찾지 못했습니다.');

    const credentials = (await chrome.storage.local.get(CREDENTIAL_KEY))[CREDENTIAL_KEY];
    if (!credentials) throw Error('API 키를 등록하세요.');

    await saveStatus({
      id:job.id, phase:'running', progress:0,
      filename:job.filename, mode:job.mode,
      problemId:job.mode === 'replace' ? job.problemId : null,
      message:'업로드 준비 중', log:['업로드 준비 중']
    });
    prepared = true;
    await openOffscreen();
    const reply = await chrome.runtime.sendMessage({
      type:'IMPORT_EXECUTE', jobId, encryptedRecord:credentials
    });
    if (!reply?.ok) throw Error(reply?.reason || '업로드를 시작하지 못했습니다.');
    return {ok:true};
  } catch (error) {
    if (prepared) {
      await saveStatus({...await readStatus(), phase:'error',
        message:error?.message || '업로드 시작 실패'});
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
  if ((await getStatus())?.phase === 'running') throw Error('업로드 중에는 지울 수 없습니다.');
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
