// Empty previews mean "regenerate/use the default", never "keep the old text".
export async function sampleContents(archive, plan, test) {
  if (!test.sample) return {input:'', output:'', log:''};
  const input = test.sampleInputPath || test.path;
  const output = test.sampleOutputPath || test.outputPath;
  return {input:input ? await archive.text(input) : '', output:output ? await archive.text(output) : '',
    log:plan.info?.interactive && test.interactionLogPath ? await archive.text(test.interactionLogPath) : ''};
}
