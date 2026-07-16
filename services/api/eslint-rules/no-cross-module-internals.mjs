import path from 'node:path';

/**
 * zios/no-cross-module-internals — enforces the modular-monolith boundary
 * (ADR-0001, Blueprint §7.2).
 *
 * Each bounded context lives in `src/modules/<name>/` and exposes a public
 * contract through its `index.ts`. Files inside a module:
 *
 *  - may import their own internals with relative imports;
 *  - may import another module ONLY through the alias `@/modules/<name>`
 *    (i.e. its public index) — never deep paths into that module;
 *  - may not use a relative import that escapes their own module directory.
 */

const MODULES_SEGMENT = path.join('src', 'modules') + path.sep;
const DEEP_ALIAS = /^@\/modules\/[^/]+\/(.+)$/;

/** @type {import('eslint').Rule.RuleModule} */
const noCrossModuleInternals = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce bounded-context module boundaries: cross-module imports must go through the module public index via the @/modules/<name> alias.',
    },
    schema: [],
    messages: {
      escapesModule:
        "Import '{{source}}' escapes module '{{module}}'. Cross-module imports must use the alias '@/modules/<name>' (its public index.ts) — see ADR-0001.",
      deepAlias:
        "Import '{{source}}' reaches into another module's internals. Only '@/modules/<name>' (its public index.ts) may be imported across module boundaries — see ADR-0001.",
    },
  },
  create(context) {
    const filename = context.filename;
    const modulesIndex = filename.indexOf(MODULES_SEGMENT);
    if (modulesIndex === -1) return {};

    const rest = filename.slice(modulesIndex + MODULES_SEGMENT.length);
    const segments = rest.split(path.sep);
    const moduleName = segments[0];
    if (!moduleName || segments.length < 2) return {};

    const moduleRoot = path.join(
      filename.slice(0, modulesIndex + MODULES_SEGMENT.length),
      moduleName,
    );

    /** @param {import('estree').ImportDeclaration | import('estree').ExportNamedDeclaration | import('estree').ExportAllDeclaration} node */
    function check(node) {
      const source = node.source?.value;
      if (typeof source !== 'string') return;

      if (source.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename), source);
        if (resolved !== moduleRoot && !resolved.startsWith(moduleRoot + path.sep)) {
          context.report({
            node,
            messageId: 'escapesModule',
            data: { source, module: moduleName },
          });
        }
        return;
      }

      const deep = DEEP_ALIAS.exec(source);
      if (deep && deep[1] !== 'index') {
        context.report({ node, messageId: 'deepAlias', data: { source } });
      }
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};

export default noCrossModuleInternals;
