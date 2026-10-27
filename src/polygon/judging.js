import { t } from '../i18n.js';
import { infoChanges, boolean, str, sameText } from './compare.js';

export async function syncInfo({api, id, plan, target, apply, unchanged}, currentInfo) {
  const changes = infoChanges(currentInfo, plan.info);
  const conditional = {};
  for (const key of ['interactiveSecondRun', 'useInteractionLogInExampleTests']) {
    if (key in changes) { conditional[key] = changes[key]; delete changes[key]; }
  }
  const wasInteractive = boolean(currentInfo?.interactive);
  // Conditional settings are rejected for a non-interactive problem. Clear them
  // before disabling interaction; enable interaction before setting them.
  if (wasInteractive && !plan.info.interactive) {
    const reset = {};
    for (const key of ['interactiveSecondRun', 'useInteractionLogInExampleTests'])
      if (boolean(currentInfo[key])) reset[key] = 'false';
    if (Object.keys(reset).length)
      await apply(t('syncJudgingSettings'), () => api.problem('updateInfo', id, reset));
  }
  if (Object.keys(changes).length || !target)
    await apply(t('syncTimeMemoryAndIOSettings'), () => api.problem('updateInfo', id, changes));
  else unchanged(t('syncTimeMemoryAndIOSettings'));
  if (plan.info.interactive) {
    if (!wasInteractive || !target) {
      conditional.interactiveSecondRun = String(!!plan.info.interactiveSecondRun);
      conditional.useInteractionLogInExampleTests = String(!!plan.info.useInteractionLogInExampleTests);
    }
    if (Object.keys(conditional).length)
      await apply(t('syncJudgingSettings'), () => api.problem('updateInfo', id, conditional));
  }
}

export async function verifyJudging({api, id, plan, read}) {
  const info = await read(t('syncVerifyJudging'), () => api.problem('info', id));
  if (!info || Object.keys(infoChanges(info, plan.info)).length)
    throw Error(t('syncJudgingMismatch'));
  if (plan.info.interactive) {
    const interactor = await read(t('syncComparingInteractor'), () => api.problem('interactor', id));
    if (interactor !== plan.interactor) throw Error(t('syncJudgingMismatch'));
  }
}

export async function syncJudges({api, id, plan, target, apply, unchanged}, {currentChecker, currentValidator, currentInteractor}) {
  for (const [kind, method, actual] of [
    ['Checker', 'setChecker', currentChecker],
    ['Validator', 'setValidator', currentValidator],
    ['Interactor', 'setInteractor', currentInteractor]
  ]) {
    const prop = kind.toLowerCase();
    if (!plan[prop]) continue;
    if (target && actual === plan[prop]) unchanged(kind);
    else await apply(t('syncSelecting', kind), () => api.problem(method, id, {[prop]:plan[prop]}));
  }
}

async function desiredJudgeTests(plan, archive, kind) {
  const source = kind === 'validator' ? plan.validatorTests : plan.checkerTests;
  return Promise.all(source.map(async test => ({testIndex:test.index, testVerdict:test.verdict,
    testInput:await archive.text(test.inputPath),
    ...(kind === 'checker' ? {testOutput:await archive.text(test.outputPath), testAnswer:await archive.text(test.answerPath)} :
      {testset:test.testset || 'tests', ...(test.group ? {testGroup:test.group} : {})})
  })));
}

function sameJudgeTest(old, props, kind) {
  return old && str(old.expectedVerdict) === props.testVerdict && sameText(str(old.input), props.testInput) &&
    (kind === 'checker' ? sameText(str(old.output), props.testOutput) && sameText(str(old.answer), props.testAnswer) :
      str(old.testset || 'tests') === props.testset && str(old.group) === str(props.testGroup));
}

export async function prepareJudgeTests(context) {
  const {api, id, plan, archive, target, apply} = context;
  context.judgeTests = [];
  for (const kind of ['validator', 'checker']) {
    const wanted = await desiredJudgeTests(plan, archive, kind);
    const previous = target?.[kind + 'Tests'] || [];
    if (previous.some(test => !Number.isInteger(test.index) || test.index < 1 || typeof test.input !== 'string') ||
        new Set(previous.map(test => test.index)).size !== previous.length)
      throw Error(t('formatInvalidJudgeTests'));
    const desired = new Map(wanted.map(props => [props.testIndex, props]));
    const retained = new Map();
    // Deleting changed self-tests first handles swapped/duplicate inputs and
    // removes old group context before groups are disabled or deleted.
    for (const old of previous) {
      const props = desired.get(old.index);
      if (props && sameJudgeTest(old, props, kind)) retained.set(old.index, old);
      else await apply(t('formatDeleteJudgeTest', kind, old.index),
        () => api.problem(kind === 'validator' ? 'deleteValidatorTest' : 'deleteCheckerTest', id, {testIndex:old.index}));
    }
    context.judgeTests.push({kind, wanted, retained, dirty:previous.length !== retained.size || wanted.length !== retained.size});
  }
}

export async function syncJudgeTests(context) {
  const {api, id, apply, unchanged, read} = context;
  if (!context.judgeTests) await prepareJudgeTests(context);
  for (const {kind, wanted, retained, dirty} of context.judgeTests) {
    for (const props of wanted) {
      if (retained.has(props.testIndex)) unchanged(t('syncSelfTest', kind, props.testIndex));
      else await apply(t('syncSelfTest', kind, props.testIndex),
        () => api.problem(kind === 'validator' ? 'saveValidatorTest' : 'saveCheckerTest', id, props));
    }
    if (!dirty) continue;
    const saved = await read(t('formatVerifyJudgeTests', kind), () => api.problem(kind + 'Tests', id));
    if (!Array.isArray(saved) || saved.length !== wanted.length ||
        new Set(saved.map(test => test.index)).size !== saved.length ||
        wanted.some(props => !sameJudgeTest(saved.find(test => test.index === props.testIndex), props, kind)))
      throw Error(t('formatJudgeTestsMismatch', kind));
  }
}
