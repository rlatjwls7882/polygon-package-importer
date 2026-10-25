import { ZipArchive } from './zip.js';
import { loadPolygonPackage } from './model.js';
import { syncPackage } from './sync.js';

export async function readTarget(api, id, plan) {
  const listed = await api.call('problems.list', { id });
  if (!Array.isArray(listed)) throw Error('Polygon 문제 목록의 응답 형식이 올바르지 않습니다.');
  const entry = listed.find(problem => String(problem.id) === String(id) && !problem.deleted);
  if (!entry) throw Error('문제 #' + id + '에 접근할 수 없습니다.');
  if (!['WRITE', 'OWNER'].includes(entry.accessType)) {
    throw Error('문제 #' + id + '에 쓰기 권한이 없습니다.');
  }

  const [tests, files, solutions, statements, statementResources, stresses] = await Promise.all([
    api.problem('tests', id, { testset:'tests', noInputs:'false' }),
    api.problem('files', id),
    api.problem('solutions', id),
    api.problem('statements', id),
    api.problem('statementResources', id),
    api.problem('stresses', id)
  ]);

  if (!Array.isArray(tests) || !files || !Array.isArray(solutions) || !statements ||
      !Array.isArray(statementResources) || statementResources.some(f =>
        !f || typeof f.name !== 'string' || !f.name)) {
    throw Error('기존 문제의 지문 첨부 리소스를 포함한 정보를 완전히 읽지 못했습니다.');
  }
  if (Array.isArray(stresses) && stresses.length) {
    throw Error('기존 문제에 Stress 테스트가 있어 덮어쓰기를 중단했습니다.');
  }

  const [validatorTests, checkerTests] = await Promise.all([
    plan.validatorTests.length ? api.problem('validatorTests', id) : Promise.resolve([]),
    plan.checkerTests.length ? api.problem('checkerTests', id) : Promise.resolve([])
  ]);
  return {
    ...entry, tests, files, solutions, statements, statementResources, validatorTests, checkerTests
  };
}

function assertCurrentTarget(before, listed) {
  const after = Array.isArray(listed) && listed.find(p =>
    String(p.id) === String(before.id) && !p.deleted);
  if (!after || !['WRITE', 'OWNER'].includes(after.accessType) ||
      String(before.revision) !== String(after.revision) ||
      String(before.workingCopyRevision ?? '') !== String(after.workingCopyRevision ?? '') ||
      !!before.modified !== !!after.modified) {
    throw Error('작업 중 대상 문제의 권한 또는 리비전이 변경되었습니다. 다시 실행하세요.');
  }
}

export async function executeImport({job, api, onProgress = async () => {}}) {
  if (!job || !job.file || !['create','replace'].includes(job.mode)) {
    throw Error('가져오기 작업 정보가 올바르지 않습니다.');
  }
  if (job.mode === 'replace' && !/^[1-9]\d{0,11}$/.test(String(job.problemId))) {
    throw Error('올바른 Polygon 문제 ID를 입력하세요.');
  }

  let id = null;
  let changed = false;
  const emit = (message, progress = null) => onProgress({message, progress});
  await emit('ZIP 분석 중');
  const archive = await ZipArchive.fromFile(job.file);
  const plan = await loadPolygonPackage(archive);
  if (plan.unsupported.length)
    throw Error('지원하지 않는 패키지: ' + plan.unsupported.join('; '));

  const step = async (label, task) => {
    await emit(label);
    return task();
  };

  let current = null;
  let result = null;
  try {
    if (job.mode === 'replace') {
      id = Number(job.problemId);
      current = await step('문제 #' + id + ' 조회', () => readTarget(api, id, plan));
      const latest = await step('문제 리비전 확인',
        () => api.call('problems.list', {id}));
      assertCurrentTarget(current, latest);
    } else {
      const created = await step('새 Polygon 문제 생성',
        () => api.call('problem.create', {name:plan.name}));
      id = Number(created?.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw Error('새 문제 생성 응답에 올바른 문제 ID가 없습니다.');
      }
      changed = true;
    }

    result = await syncPackage({
      api, id, plan, archive, target:current,
      read:(label, task) => step(label, task),
      write:(label, task) => {
        changed = true;
        return step(label, task);
      }
    });

    let committed = false;
    if (job.commit && (changed || !!current?.modified)) {
      const commit = await step('변경 사항 커밋',
        () => api.problem('commitChanges', id,
          {minorChanges:'true', message:'Import from Polygon ZIP Uploader'}));
      if (!commit || commit.conflictOccurred ||
          (commit.committed !== true && commit.message !== 'No changes')) {
        throw Error('커밋 결과를 확인할 수 없습니다.');
      }
      committed = true;
    }

    const details = '변경 ' + result.mutations + '개 · 건너뜀 ' + result.skipped + '개';
    await emit('문제 #' + id + ' 완료 (' + details + ')', 100);
    return {id, name:plan.name, committed, ...result};
  } catch (error) {
    error.partial = changed;
    error.problemId = id;
    throw error;
  }
}
