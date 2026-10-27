import { releaseJob, STATUS_KEY } from '../storage/jobs.js';

export async function readStatus() {
  return (await chrome.storage.local.get(STATUS_KEY))[STATUS_KEY] ?? null;
}

export async function saveStatus(status) {
  const next = {...status, updatedAt:Date.now()};
  await chrome.storage.local.set({[STATUS_KEY]:next});
  return next;
}

export async function updateStatus(message) {
  const current = await readStatus();
  if (!current || current.id !== message.jobId || current.phase !== 'running' ||
      current.attempt !== message.attempt)
    return {ok:false};

  const done = message.type === 'IMPORT_COMPLETE';
  if (done && !['done','error'].includes(message.phase)) return {ok:false};
  const text = String(message.message || '').slice(0, 350);
  const next = {
    ...current,
    phase:done ? message.phase : 'running',
    message:text,
    log:current.log?.at(-1) === text ? current.log : [...(current.log || []), text].slice(-12),
    progress:Number.isFinite(message.progress) ? message.progress : current.progress,
    ...(message.problemId ? {problemId:message.problemId} : {}),
    ...(message.partial ? {partial:true} : {}),
    ...(message.committed ? {committed:true} : {}),
    ...(['uploading','uploaded','verifying','verified','verification-failed','upload-failed'].includes(message.stage) ? {stage:message.stage} : {}),
    ...(message.verification ? {verification:message.verification} : {})
  };
  if (!done && ['phase','message','progress','problemId','partial','committed','stage'].every(key => next[key] === current[key]) &&
      JSON.stringify(next.verification) === JSON.stringify(current.verification)) return {ok:true};
  await saveStatus(next);
  if (done) await releaseJob(current.id);
  return {ok:true};
}
