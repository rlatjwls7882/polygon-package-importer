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

async function processJob(jobId, encryptedRecord, locale, attempt) {
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
        jobId, attempt,
        message:t('offscreenRateLimitedRetryInS', method, Math.ceil(waitMs / 1000))
      }).catch(() => {});
    };

    const result = await executeImport({
      job, api,
      // Persist the created ID before uploading any content. If the browser
      // closes mid-upload, the stored job resumes against the same problem.
      onCreated:async id => {
        job = {...job, mode:'replace', problemId:String(id)};
        await stageJob(job, jobId);
      },
      onCheckpoint:async verification => {
        job = {...job, verification};
        await stageJob(job, jobId);
      },
      onProgress:({message,progress,stage,committed}) =>
        publish('IMPORT_PROGRESS', {
          jobId, attempt, message:api.safeDetail(message), stage, committed,
          ...(progress === null ? {} : {progress})
        })
    });

    await publish('IMPORT_COMPLETE', {
      jobId, attempt, phase:'done', progress:100, problemId:result.id,
      committed:result.committed, verification:result.verification,
      stage:result.verification.state === 'verified' ? 'verified' : 'uploaded',
      message:result.verification.state === 'verified' ?
        t('verifySucceeded', result.verification.packageId, result.verification.runs) :
        t('verifyUploadOnly', result.id)
    });
    // Keep the ZIP until the completion state is safely recorded.
    await clearJob(jobId).catch(() => {});
  } catch (error) {
    await publish('IMPORT_COMPLETE', {
      jobId, attempt, phase:'error',
      message:api ? api.safeDetail(error?.message || error) :
        String(error?.message || error).slice(0, 350),
      problemId:error?.problemId || (job?.mode === 'replace' ? job.problemId : null),
      partial:!!error?.partial, committed:!!error?.committed,
      stage:error?.committed ? 'verification-failed' : 'upload-failed'
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
  processJob(message.jobId, message.encryptedRecord, message.locale, message.attempt).finally(() => {
    activeJob = null;
  });
});
