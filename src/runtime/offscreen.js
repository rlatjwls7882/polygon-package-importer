import { t, loadMessages } from '../i18n.js';
import { readJob, stageJob, clearJob } from '../storage/jobs.js';
import { decryptCredentialRecord } from '../storage/credentials.js';
import { PolygonAPI } from '../polygon/api.js';
import { executeImport } from '../polygon/import.js';

let activeJob = null;

async function publish(type, payload) {
  const reply = await chrome.runtime.sendMessage({type, ...payload});
  if (!reply?.ok) throw Error(t('offscreenCouldNotUpdateJobStatus'));
}

async function processJob(jobId, encryptedRecord, locale) {
  let job = null;
  let api = null;
  try {
    await loadMessages(locale);
    job = await readJob();
    if (!job || job.id !== jobId) {
      throw Error(t('offscreenSavedZipNotFoundSelectItAgain'));
    }

    const credentials = await decryptCredentialRecord(encryptedRecord);
    api = new PolygonAPI(credentials.key, credentials.secret);
    api.onRateLimit = ({method,waitMs}) => {
      publish('IMPORT_PROGRESS', {
        jobId,
        message:t('offscreenRateLimitedRetryInS', method, Math.ceil(waitMs / 1000))
      }).catch(() => {});
    };

    const result = await executeImport({
      job, api,
      // Persist the created ID before uploading any content. If the browser
      // closes mid-upload, the stored job resumes against the same problem.
      onCreated:id => stageJob({...job, mode:'replace', problemId:String(id)}),
      onProgress:({message,progress}) =>
        publish('IMPORT_PROGRESS', {
          jobId, message:api.safeDetail(message),
          ...(progress === null ? {} : {progress})
        })
    });

    await publish('IMPORT_COMPLETE', {
      jobId, phase:'done', progress:100, problemId:result.id,
      message:t('offscreenDoneProblemChangesSkipped', result.id, result.mutations, result.skipped)
    });
    // Keep the ZIP until the completion state is safely recorded.
    await clearJob(jobId).catch(() => {});
  } catch (error) {
    await publish('IMPORT_COMPLETE', {
      jobId, phase:'error',
      message:api ? api.safeDetail(error?.message || error) :
        String(error?.message || error).slice(0, 350),
      problemId:error?.problemId || (job?.mode === 'replace' ? job.problemId : null),
      partial:!!error?.partial
    }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'IMPORT_EXECUTE') return;
  if (activeJob) {
    respond({ok:false, reason:t('offscreenAnotherUploadIsAlreadyRunning')});
    return;
  }
  activeJob = message.jobId;
  respond({ok:true});
  processJob(message.jobId, message.encryptedRecord, message.locale).finally(() => {
    activeJob = null;
  });
});
