import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Include the license texts in the single file, so consumers need no companion file. */
export function standaloneBundle(): Plugin {
  return {
    name: 'htpo-standalone-bundle',
    generateBundle(_options, bundle) {
      const outputs = Object.values(bundle);
      const chunk = outputs[0];
      if (outputs.length !== 1 || chunk?.type !== 'chunk' || chunk.fileName !== 'htpo.min.js') {
        this.error('The standalone build must emit exactly one file: htpo.min.js.');
      }
      if (chunk.imports.length || chunk.dynamicImports.length) {
        this.error('The standalone build must not reference external modules or chunks.');
      }

      for (const id of Object.keys(chunk.modules)) {
        const filename = id.replace(/^\0/, '').split('?')[0];
        if (/[\\/]node_modules[\\/]/.test(filename)) this.error(`Runtime package bundled in the dependency-free distribution: ${filename}`);
      }

      const own = JSON.parse(readFileSync('package.json', 'utf8'));
      const notices = [
        `Htpo ${own.version} — standalone browser distribution\n${readFileSync('LICENSE', 'utf8')}`,
        `DejaVu Sans 2.37 (embedded fonts)\n${readFileSync('assets/fonts/LICENSE.txt', 'utf8')}`,
      ];
      // Escape comment terminators from third-party text before embedding it in JS.
      const text = notices.join('\n\n-----\n\n').replaceAll('*/', '* /');
      chunk.code = `/*!\n${text}\n*/\n${chunk.code}`;
    },
  };
}
