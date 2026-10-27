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

export async function syncJudgeTests({api, id, plan, archive, target, apply, unchanged}) {
  for (const [kind, tests, previous, method] of [
    ['Validator', plan.validatorTests, target?.validatorTests || [], 'saveValidatorTest'],
    ['Checker', plan.checkerTests, target?.checkerTests || [], 'saveCheckerTest']
  ]) {
    for (const test of tests) {
      const old = previous.find(x => Number(x.index) === test.index);
      const props = {testIndex:test.index, testVerdict:test.verdict,
        testInput:await archive.text(test.inputPath)};
      if (kind === 'Checker') {
        props.testOutput = await archive.text(test.outputPath);
        props.testAnswer = await archive.text(test.answerPath);
      }
      const equal = old && str(old.expectedVerdict || old.verdict || old.testVerdict) === test.verdict &&
        sameText(str(old.input || old.testInput), props.testInput) &&
        (kind !== 'Checker' ||
          (sameText(str(old.output || old.testOutput), props.testOutput) &&
           sameText(str(old.answer || old.testAnswer), props.testAnswer)));
      if (equal) unchanged(t('syncSelfTest', kind, test.index));
      else await apply(t('syncSelfTest', kind, test.index),
        () => api.problem(method, id, props));
    }
  }
}
