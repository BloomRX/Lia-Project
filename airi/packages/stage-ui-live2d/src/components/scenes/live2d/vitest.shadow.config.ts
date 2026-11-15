import ts from 'typescript'

import { defineConfig } from 'vitest/config'
import { compileScript, parse } from 'vue/compiler-sfc'

// Compile the real SFC without pulling the Stage build or its GPU runtime into QA.
export default defineConfig({
  plugins: [{
    name: 'shadow-lifecycle-sfc',
    enforce: 'pre',
    transform(source, id) {
      if (!id.endsWith('.vue'))
        return
      const { descriptor } = parse(source, { filename: id })
      const script = compileScript(descriptor, { id, inlineTemplate: true }).content
      return {
        code: ts.transpileModule(script, {
          compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
        }).outputText,
        map: null,
      }
    },
  }],
  test: {
    include: ['src/components/scenes/live2d/Model.shadow.spec.ts'],
  },
})
