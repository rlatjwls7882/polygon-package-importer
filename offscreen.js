import { readJob, clearJob } from './job-store.js';
import { decryptCredentialRecord } from './credential-store.js';
import { PolygonAPI } from './api.js';
import { executeImport } from './polygon-import.js';

let activeJob = null;

async function publish(type, payload) {
  const reply = await chrome.runtime.sendMessage({type, ...payload});
  if (!reply?.ok) throw Error('작업 상태를 업데이트하지 못했습니다.');
}

async function processJob(jobId, encryptedRecord) {
  let job = null;
  let api = null;
  try {
    job = await readJob();
    if (!job || job.id !== jobId) {
      throw Error('보관된 ZIP을 찾지 못했습니다. 다시 선택하세요.');
    }

    const credentials = await decryptCredentialRecord(encryptedRecord);
    api = new PolygonAPI(credentials.key, credentials.secret);
    api.onRateLimit = ({method,waitMs}) => {
      publish('IMPORT_PROGRESS', {
        jobId,
        message:method + ': 요청 제한 · ' + Math.ceil(waitMs / 1000) + '초 후 재시도'
      }).catch(() => {});
    };

    const result = await executeImport({
      job, api,
      onProgress:({message,progress}) =>
        publish('IMPORT_PROGRESS', {
          jobId, message:api.safeDetail(message),
          ...(progress === null ? {} : {progress})
        })
    });

    await publish('IMPORT_COMPLETE', {
      jobId, phase:'done', progress:100, problemId:result.id,
      message:'완료 · 문제 #' + result.id + ' · 변경 ' +
        result.mutations + '개 · 생략 ' + result.skipped + '개'
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
    respond({ok:false, reason:'이미 다른 업로드가 실행 중입니다.'});
    return;
  }
  activeJob = message.jobId;
  respond({ok:true});
  processJob(message.jobId, message.encryptedRecord).finally(() => {
    activeJob = null;
  });
});
